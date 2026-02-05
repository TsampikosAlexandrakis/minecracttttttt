import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
import {
  BlockDelta,
  ClientMessage,
  NetMobState,
  NetPlayerState,
  parseClientMessage,
  serializeMessage,
  ServerMessage
} from "../src/shared/protocol";
import {
  DEFAULT_ROOM_CODE,
  MAX_PLAYERS_PER_ROOM,
  PROTOCOL_VERSION,
  SERVER_SNAPSHOT_RATE,
  SERVER_TICK_RATE,
  SERVER_VIEW_DISTANCE_CHUNKS
} from "../src/shared/constants";
import {
  GRAVITY,
  CHUNK_SIZE,
  HOTBAR_SIZE,
  PLAYER_EYE_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_JUMP_SPEED,
  PLAYER_SPRINT_SPEED,
  PLAYER_WALK_SPEED,
  WORLD_HEIGHT
} from "../src/config";
import { BLOCK_DEFS, blockIdToDrop, isSolidBlock, itemToBlockId } from "../src/blocks";
import { BlockId } from "../src/types";
import { chunkKey } from "../src/world/chunk";
import { craftRecipe } from "./crafting";
import { addItem, consumeSelected, createStarterInventory, serializeInventory, ServerInventory } from "./inventory";
import { aabbIntersectsBlock, moveWithCollisions } from "./physics";
import { distanceSquared, vec3, Vec3 } from "./vector";
import { AuthoritativeWorld } from "./world";

interface PlayerControl {
  seq: number;
  dt: number;
  moveX: number;
  moveZ: number;
  jump: boolean;
  sprint: boolean;
  yaw: number;
  pitch: number;
}

interface ServerPlayer {
  id: string;
  ws: WebSocket;
  nickname: string;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  onGround: boolean;
  inventory: ServerInventory;
  knownChunks: Set<string>;
  control: PlayerControl;
  lastMineAtMs: number;
  lastAttackAtMs: number;
  lastProcessedSeq: number;
}

interface ServerMob {
  id: number;
  position: Vec3;
  velocity: Vec3;
  health: number;
  onGround: boolean;
  attackCooldown: number;
}

interface PersistedPlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  health: number;
  selectedSlot: number;
  hotbar: ServerInventory["hotbar"];
}

export class RoomServer {
  private readonly roomCode: string;
  private readonly maxPlayers: number;
  private readonly dataDir: string;
  private readonly roomDir: string;
  private readonly playersDir: string;
  private readonly world: AuthoritativeWorld;
  private readonly players = new Map<string, ServerPlayer>();
  private readonly socketToPlayerId = new Map<WebSocket, string>();
  private readonly changedBlocks: BlockDelta[] = [];
  private readonly mobs = new Map<number, ServerMob>();

  private tick = 0;
  private tickHandle: NodeJS.Timeout | null = null;
  private saveTimerTicks = 0;
  private mobSpawnTimerTicks = 0;
  private playerCounter = 0;
  private mobCounter = 0;

  constructor(seed: number, dataDir: string, roomCode = DEFAULT_ROOM_CODE, maxPlayers = MAX_PLAYERS_PER_ROOM) {
    this.roomCode = roomCode;
    this.maxPlayers = maxPlayers;
    this.dataDir = dataDir;
    this.roomDir = path.join(this.dataDir, this.roomCode);
    this.playersDir = path.join(this.roomDir, "players");

    fs.mkdirSync(this.playersDir, { recursive: true });
    this.world = new AuthoritativeWorld(seed, this.roomDir);
    this.writeMeta(seed);
  }

  start(): void {
    if (this.tickHandle) {
      return;
    }
    const intervalMs = Math.max(1, Math.floor(1000 / SERVER_TICK_RATE));
    this.tickHandle = setInterval(() => this.updateTick(), intervalMs);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.persistAll();
  }

  handleConnection(ws: WebSocket): void {
    ws.on("message", (raw) => {
      if (typeof raw !== "string" && !(raw instanceof Buffer)) {
        return;
      }
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      const message = parseClientMessage(text);
      if (!message) {
        this.sendRaw(ws, {
          type: "error",
          code: "bad_message",
          message: "Malformed client message"
        });
        return;
      }
      this.handleMessage(ws, message);
    });

    ws.on("close", () => {
      const playerId = this.socketToPlayerId.get(ws);
      if (!playerId) {
        return;
      }
      this.removePlayer(playerId);
    });
  }

  private handleMessage(ws: WebSocket, message: ClientMessage): void {
    const playerId = this.socketToPlayerId.get(ws);
    if (!playerId) {
      if (message.type !== "hello") {
        this.sendRaw(ws, { type: "error", code: "not_joined", message: "Send hello before other messages" });
        return;
      }
      this.handleHello(ws, message);
      return;
    }

    const player = this.players.get(playerId);
    if (!player) {
      this.sendRaw(ws, { type: "error", code: "state_error", message: "Unknown player" });
      return;
    }

    switch (message.type) {
      case "input":
        player.control = {
          seq: message.seq,
          dt: message.dt,
          moveX: clamp(message.moveX, -1, 1),
          moveZ: clamp(message.moveZ, -1, 1),
          jump: message.jump,
          sprint: message.sprint,
          yaw: message.yaw,
          pitch: clamp(message.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01)
        };
        break;
      case "action_mine":
        this.handleMineAction(player, message.target.x, message.target.y, message.target.z);
        break;
      case "action_place":
        this.handlePlaceAction(player, message.target, message.normal, message.selectedSlot);
        break;
      case "action_craft":
        if (craftRecipe(player.inventory, message.recipeId)) {
          this.sendInventory(player);
        }
        break;
      case "action_attack":
        this.handleAttackAction(player, message.targetEntityId);
        break;
      case "hotbar_select":
        if (message.slot >= 0 && message.slot < HOTBAR_SIZE) {
          player.inventory.selectedSlot = message.slot;
          this.sendInventory(player);
        }
        break;
      case "ping":
        this.send(player, { type: "pong", clientTime: message.clientTime, serverTime: Date.now() });
        break;
      case "hello":
        this.send(player, { type: "error", code: "already_joined", message: "Already joined room" });
        break;
      default:
        break;
    }
  }

  private handleHello(ws: WebSocket, message: Extract<ClientMessage, { type: "hello" }>): void {
    if (message.clientVersion !== PROTOCOL_VERSION) {
      this.sendRaw(ws, {
        type: "error",
        code: "version_mismatch",
        message: `Client protocol ${message.clientVersion} != server ${PROTOCOL_VERSION}`
      });
      ws.close();
      return;
    }

    if (message.roomCode !== this.roomCode) {
      this.sendRaw(ws, {
        type: "error",
        code: "room_not_found",
        message: "Room code does not match this server"
      });
      ws.close();
      return;
    }

    if (this.players.size >= this.maxPlayers) {
      this.sendRaw(ws, { type: "error", code: "room_full", message: "Room is full" });
      ws.close();
      return;
    }

    const id = `p${this.playerCounter++}`;
    const saved = this.loadPlayerState(message.nickname);
    const spawnPos = saved
      ? vec3(saved.x, saved.y, saved.z)
      : this.computeSpawnPoint(Math.floor(Math.random() * 16), Math.floor(Math.random() * 16));
    const player: ServerPlayer = {
      id,
      ws,
      nickname: message.nickname,
      position: spawnPos,
      velocity: saved ? vec3(saved.vx, saved.vy, saved.vz) : vec3(),
      yaw: saved?.yaw ?? 0,
      pitch: saved?.pitch ?? 0,
      health: saved?.health ?? 20,
      onGround: false,
      inventory: saved
        ? {
            selectedSlot: saved.selectedSlot,
            hotbar: saved.hotbar.map((slot) => (slot ? { item: slot.item, count: slot.count } : null))
          }
        : createStarterInventory(),
      knownChunks: new Set<string>(),
      control: {
        seq: 0,
        dt: 1 / SERVER_TICK_RATE,
        moveX: 0,
        moveZ: 0,
        jump: false,
        sprint: false,
        yaw: saved?.yaw ?? 0,
        pitch: saved?.pitch ?? 0
      },
      lastMineAtMs: 0,
      lastAttackAtMs: 0,
      lastProcessedSeq: 0
    };

    this.players.set(id, player);
    this.socketToPlayerId.set(ws, id);
    this.send(player, {
      type: "welcome",
      playerId: player.id,
      serverTick: this.tick,
      seed: this.readSeedFromMeta(),
      roomCode: this.roomCode,
      maxPlayers: this.maxPlayers
    });
    this.sendInventory(player);
    this.sendVisibleChunks(player);
  }

  private handleMineAction(player: ServerPlayer, x: number, y: number, z: number): void {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    if (!this.withinReach(player, bx, by, bz, 6.2)) {
      return;
    }
    const block = this.world.getBlock(bx, by, bz);
    if (block === BlockId.Air || block === BlockId.Water) {
      return;
    }
    const now = Date.now();
    const hardness = Math.max(0.2, BLOCK_DEFS[block].hardness);
    const minIntervalMs = hardness * 180;
    if (now - player.lastMineAtMs < minIntervalMs) {
      return;
    }
    if (this.world.setBlock(bx, by, bz, BlockId.Air)) {
      player.lastMineAtMs = now;
      this.changedBlocks.push({ x: bx, y: by, z: bz, block: BlockId.Air });
      const drop = blockIdToDrop(block);
      if (drop) {
        addItem(player.inventory, drop, 1);
        this.sendInventory(player);
      }
    }
  }

  private handlePlaceAction(
    player: ServerPlayer,
    target: { x: number; y: number; z: number },
    normal: { x: number; y: number; z: number },
    selectedSlot: number
  ): void {
    if (selectedSlot < 0 || selectedSlot >= HOTBAR_SIZE) {
      return;
    }
    player.inventory.selectedSlot = selectedSlot;

    const slot = player.inventory.hotbar[selectedSlot];
    if (!slot) {
      return;
    }
    const placeBlock = itemToBlockId(slot.item);
    if (placeBlock === null) {
      return;
    }

    const px = Math.floor(target.x + normal.x);
    const py = Math.floor(target.y + normal.y);
    const pz = Math.floor(target.z + normal.z);
    if (py < 0 || py >= WORLD_HEIGHT) {
      return;
    }

    if (!this.withinReach(player, px, py, pz, 6.2)) {
      return;
    }

    const existing = this.world.getBlock(px, py, pz);
    if (existing !== BlockId.Air && existing !== BlockId.Water) {
      return;
    }

    if (
      aabbIntersectsBlock(
        player.position,
        { halfWidth: PLAYER_HALF_WIDTH, height: PLAYER_HEIGHT },
        px,
        py,
        pz
      )
    ) {
      return;
    }

    if (!consumeSelected(player.inventory, 1)) {
      return;
    }
    if (this.world.setBlock(px, py, pz, placeBlock)) {
      this.changedBlocks.push({ x: px, y: py, z: pz, block: placeBlock });
      this.sendInventory(player);
    }
  }

  private handleAttackAction(player: ServerPlayer, targetEntityId: number): void {
    const mob = this.mobs.get(targetEntityId);
    if (!mob) {
      return;
    }
    const now = Date.now();
    if (now - player.lastAttackAtMs < 280) {
      return;
    }
    const reachSq = 3.6 * 3.6;
    const eye = vec3(player.position.x, player.position.y + PLAYER_EYE_HEIGHT, player.position.z);
    const mobCenter = vec3(mob.position.x, mob.position.y + 0.9, mob.position.z);
    if (distanceSquared(eye, mobCenter) > reachSq) {
      return;
    }
    player.lastAttackAtMs = now;
    const slot = player.inventory.hotbar[player.inventory.selectedSlot];
    const damage = slot?.item === "pickaxe" ? 4 : 2;
    mob.health -= damage;
    if (mob.health <= 0) {
      this.mobs.delete(mob.id);
      addItem(player.inventory, "dirt", 1);
      this.sendInventory(player);
    }
  }

  private updateTick(): void {
    this.tick += 1;
    const dt = 1 / SERVER_TICK_RATE;

    this.updatePlayers(dt);
    this.mobSpawnTimerTicks += 1;
    if (this.mobSpawnTimerTicks >= SERVER_TICK_RATE * 4) {
      this.mobSpawnTimerTicks = 0;
      this.trySpawnMob();
    }
    this.updateMobs(dt);

    this.sendChunksIfNeeded();
    if (this.tick % Math.max(1, Math.floor(SERVER_TICK_RATE / SERVER_SNAPSHOT_RATE)) === 0) {
      this.broadcastSnapshot();
    }

    this.saveTimerTicks += 1;
    if (this.saveTimerTicks >= SERVER_TICK_RATE * 5) {
      this.saveTimerTicks = 0;
      this.persistAll();
    }
  }

  private updatePlayers(dt: number): void {
    for (const player of this.players.values()) {
      const control = player.control;
      player.yaw = control.yaw;
      player.pitch = control.pitch;

      const speed = control.sprint ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;
      const forwardX = Math.sin(player.yaw);
      const forwardZ = Math.cos(player.yaw);
      const rightX = forwardZ;
      const rightZ = -forwardX;
      const desiredX = rightX * control.moveX + forwardX * control.moveZ;
      const desiredZ = rightZ * control.moveX + forwardZ * control.moveZ;
      const accel = 20;
      const step = Math.min(1, accel * dt);
      player.velocity.x += (desiredX * speed - player.velocity.x) * step;
      player.velocity.z += (desiredZ * speed - player.velocity.z) * step;
      player.velocity.y -= GRAVITY * dt;
      if (control.jump && player.onGround) {
        player.velocity.y = PLAYER_JUMP_SPEED;
        player.onGround = false;
      }

      const collision = moveWithCollisions(player.position, player.velocity, dt, this, {
        halfWidth: PLAYER_HALF_WIDTH,
        height: PLAYER_HEIGHT
      });
      player.onGround = collision.onGround;
      player.lastProcessedSeq = control.seq;

      if (player.position.y < -20 || player.health <= 0) {
        player.health = 20;
        const spawn = this.computeSpawnPoint(0, 0);
        player.position.x = spawn.x;
        player.position.y = spawn.y;
        player.position.z = spawn.z;
        player.velocity.x = 0;
        player.velocity.y = 0;
        player.velocity.z = 0;
      }
    }
  }

  private updateMobs(dt: number): void {
    for (const mob of this.mobs.values()) {
      let targetPlayer: ServerPlayer | null = null;
      let bestDistSq = Number.POSITIVE_INFINITY;
      for (const player of this.players.values()) {
        const distSq = distanceSquared(player.position, mob.position);
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          targetPlayer = player;
        }
      }

      if (targetPlayer && bestDistSq < 20 * 20) {
        const dx = targetPlayer.position.x - mob.position.x;
        const dz = targetPlayer.position.z - mob.position.z;
        const len = Math.hypot(dx, dz) || 1;
        mob.velocity.x = (dx / len) * 2.5;
        mob.velocity.z = (dz / len) * 2.5;
      } else {
        mob.velocity.x *= Math.max(0, 1 - 8 * dt);
        mob.velocity.z *= Math.max(0, 1 - 8 * dt);
      }

      mob.velocity.y -= GRAVITY * dt;
      const collision = moveWithCollisions(mob.position, mob.velocity, dt, this, {
        halfWidth: 0.35,
        height: 1.8
      });
      mob.onGround = collision.onGround;
      if ((collision.hitX || collision.hitZ) && mob.onGround) {
        mob.velocity.y = 6.0;
      }

      if (mob.attackCooldown > 0) {
        mob.attackCooldown -= dt;
      }
      if (targetPlayer && bestDistSq < 1.6 * 1.6 && mob.attackCooldown <= 0) {
        targetPlayer.health = Math.max(0, targetPlayer.health - 2);
        mob.attackCooldown = 1.0;
        this.send(targetPlayer, { type: "event", kind: "damage", payload: { amount: 2 } });
        if (targetPlayer.health <= 0) {
          this.send(targetPlayer, { type: "event", kind: "death", payload: {} });
        }
      }
    }
  }

  private trySpawnMob(): void {
    if (this.players.size === 0 || this.mobs.size >= 8) {
      return;
    }
    const players = Array.from(this.players.values());
    const target = players[Math.floor(Math.random() * players.length)];
    const angle = Math.random() * Math.PI * 2;
    const radius = 10 + Math.random() * 8;
    const x = Math.floor(target.position.x + Math.cos(angle) * radius);
    const z = Math.floor(target.position.z + Math.sin(angle) * radius);
    const y = this.findSurfaceY(x, z) + 1;
    if (Math.abs(y - target.position.y) > 20) {
      return;
    }
    const mob: ServerMob = {
      id: this.mobCounter++,
      position: vec3(x + 0.5, y, z + 0.5),
      velocity: vec3(),
      health: 10,
      onGround: false,
      attackCooldown: 0
    };
    this.mobs.set(mob.id, mob);
  }

  private sendChunksIfNeeded(): void {
    for (const player of this.players.values()) {
      this.sendVisibleChunks(player);
    }
  }

  private sendVisibleChunks(player: ServerPlayer): void {
    const center = worldToChunk(player.position.x, player.position.z);
    const keep = new Set<string>();
    for (let dx = -SERVER_VIEW_DISTANCE_CHUNKS; dx <= SERVER_VIEW_DISTANCE_CHUNKS; dx += 1) {
      for (let dz = -SERVER_VIEW_DISTANCE_CHUNKS; dz <= SERVER_VIEW_DISTANCE_CHUNKS; dz += 1) {
        const cx = center.cx + dx;
        const cz = center.cz + dz;
        const key = chunkKey(cx, cz);
        keep.add(key);
        if (player.knownChunks.has(key)) {
          continue;
        }
        this.send(player, {
          type: "chunk_data",
          cx,
          cz,
          blocksBase64: this.world.encodeChunkBase64(cx, cz)
        });
        player.knownChunks.add(key);
      }
    }

    for (const key of player.knownChunks) {
      if (keep.has(key)) {
        continue;
      }
      player.knownChunks.delete(key);
    }
  }

  private broadcastSnapshot(): void {
    const players: NetPlayerState[] = Array.from(this.players.values()).map((player) => {
      const inv = serializeInventory(player.inventory);
      return {
        id: player.id,
        nickname: player.nickname,
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        vx: player.velocity.x,
        vy: player.velocity.y,
        vz: player.velocity.z,
        yaw: player.yaw,
        pitch: player.pitch,
        health: player.health,
        hotbar: inv.hotbar,
        selectedSlot: inv.selectedSlot,
        lastProcessedSeq: player.lastProcessedSeq
      };
    });
    const mobs: NetMobState[] = Array.from(this.mobs.values()).map((mob) => ({
      id: mob.id,
      x: mob.position.x,
      y: mob.position.y,
      z: mob.position.z,
      health: mob.health
    }));
    const deltas = this.changedBlocks.splice(0, this.changedBlocks.length);

    const snapshot: ServerMessage = {
      type: "snapshot",
      tick: this.tick,
      players,
      mobs,
      changedBlocks: deltas
    };
    for (const player of this.players.values()) {
      this.send(player, snapshot);
    }
  }

  private sendInventory(player: ServerPlayer): void {
    const inv = serializeInventory(player.inventory);
    this.send(player, {
      type: "inventory_update",
      hotbar: inv.hotbar,
      selectedSlot: inv.selectedSlot
    });
  }

  private send(player: ServerPlayer, message: ServerMessage): void {
    this.sendRaw(player.ws, message);
  }

  private sendRaw(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(serializeMessage(message));
  }

  private removePlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }
    this.persistPlayer(player);
    this.players.delete(playerId);
    this.socketToPlayerId.delete(player.ws);
  }

  private persistAll(): void {
    this.world.flushDirtyChunks();
    for (const player of this.players.values()) {
      this.persistPlayer(player);
    }
  }

  private persistPlayer(player: ServerPlayer): void {
    const payload: PersistedPlayerState = {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      vx: player.velocity.x,
      vy: player.velocity.y,
      vz: player.velocity.z,
      yaw: player.yaw,
      pitch: player.pitch,
      health: player.health,
      selectedSlot: player.inventory.selectedSlot,
      hotbar: player.inventory.hotbar.map((slot) => (slot ? { item: slot.item, count: slot.count } : null))
    };
    fs.writeFileSync(this.playerFile(player.nickname), JSON.stringify(payload, null, 2), "utf8");
  }

  private loadPlayerState(nickname: string): PersistedPlayerState | null {
    const filePath = this.playerFile(nickname);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as PersistedPlayerState;
      if (!Array.isArray(parsed.hotbar)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private playerFile(nickname: string): string {
    const safe = nickname.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.playersDir, `${safe}.json`);
  }

  private findSurfaceY(x: number, z: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
      const block = this.world.getBlock(x, y, z);
      if (block !== BlockId.Air && block !== BlockId.Water) {
        return y;
      }
    }
    return 20;
  }

  private withinReach(player: ServerPlayer, x: number, y: number, z: number, range: number): boolean {
    const eye = vec3(player.position.x, player.position.y + PLAYER_EYE_HEIGHT, player.position.z);
    const center = vec3(x + 0.5, y + 0.5, z + 0.5);
    return distanceSquared(eye, center) <= range * range;
  }

  isSolid(x: number, y: number, z: number): boolean {
    const block = this.world.getBlock(x, y, z);
    return isSolidBlock(block);
  }

  private computeSpawnPoint(x: number, z: number): Vec3 {
    const y = this.findSurfaceY(x, z) + 2;
    return vec3(x + 0.5, y, z + 0.5);
  }

  private writeMeta(seed: number): void {
    const metaPath = path.join(this.roomDir, "meta.json");
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ roomCode: this.roomCode, seed, protocolVersion: PROTOCOL_VERSION }, null, 2),
      "utf8"
    );
  }

  private readSeedFromMeta(): number {
    try {
      const metaPath = path.join(this.roomDir, "meta.json");
      const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { seed?: number };
      return typeof parsed.seed === "number" ? parsed.seed : 0;
    } catch {
      return 0;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function worldToChunk(x: number, z: number): { cx: number; cz: number } {
  return {
    cx: Math.floor(Math.floor(x) / CHUNK_SIZE),
    cz: Math.floor(Math.floor(z) / CHUNK_SIZE)
  };
}
