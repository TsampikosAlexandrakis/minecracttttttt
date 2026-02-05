import * as THREE from "three";
import {
  FIXED_DT,
  MAX_FRAME_DT,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT
} from "../config";
import { BLOCK_DEFS } from "../blocks";
import { InputController } from "./input";
import { Inventory } from "./inventory";
import { PlayerController } from "./player";
import { TerrainRenderer } from "../render/terrainRenderer";
import { Hud } from "../ui/hud";
import { RECIPES } from "./crafting";
import { voxelRaycast, VoxelHit } from "./raycast";
import { aabbIntersectsBlock } from "./physics";
import { BlockId } from "../types";
import { NetworkWorldStore } from "../net/networkWorld";
import { NetworkClient } from "../net/networkClient";
import { DEFAULT_ROOM_CODE, MAX_PLAYERS_PER_ROOM, PROTOCOL_VERSION } from "../shared/constants";
import { NetMobState, NetPlayerState, ServerMessage } from "../shared/protocol";

interface MultiplayerOptions {
  serverUrl: string;
  roomCode: string;
  nickname: string;
}

interface RemotePlayerVisual {
  mesh: THREE.Mesh;
  target: THREE.Vector3;
}

interface RemoteMobVisual {
  id: number;
  mesh: THREE.Mesh;
  target: THREE.Vector3;
  health: number;
}

interface PendingInput {
  seq: number;
  dt: number;
  moveX: number;
  moveZ: number;
  jump: boolean;
  sprint: boolean;
  yaw: number;
  pitch: number;
}

export class MultiplayerGame {
  private readonly root: HTMLElement;
  private readonly options: MultiplayerOptions;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly input: InputController;
  private readonly player = new PlayerController();
  private readonly world = new NetworkWorldStore();
  private readonly terrainRenderer: TerrainRenderer;
  private readonly hud: Hud;
  private readonly network = new NetworkClient();
  private readonly clock = new THREE.Clock();
  private readonly blockOutline: THREE.LineSegments;
  private readonly rayOrigin = new THREE.Vector3();
  private readonly rayDirection = new THREE.Vector3();
  private readonly fpsCounter = { frames: 0, elapsed: 0, fps: 0 };
  private readonly pendingInputs: PendingInput[] = [];
  private readonly remotePlayers = new Map<string, RemotePlayerVisual>();
  private readonly remoteMobs = new Map<number, RemoteMobVisual>();

  private localPlayerId = "";
  private tick = 0;
  private initialized = false;
  private rafId: number | null = null;
  private accumulator = 0;
  private hoveredBlock: VoxelHit | null = null;
  private miningTarget = "";
  private miningProgress = 0;
  private craftingVisible = false;
  private inventory = Inventory.createStarterInventory();
  private inputSeq = 0;
  private netRttMs = 0;
  private pingTimer = 0;
  private lastServerMessage = "";
  private welcomeResolver: ((message: Extract<ServerMessage, { type: "welcome" }>) => void) | null = null;
  private lastWelcome: Extract<ServerMessage, { type: "welcome" }> | null = null;

  constructor(root: HTMLElement, options: MultiplayerOptions) {
    this.root = root;
    this.options = {
      serverUrl: options.serverUrl,
      roomCode: options.roomCode || DEFAULT_ROOM_CODE,
      nickname: options.nickname || "Player"
    };

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.domElement.className = "game-canvas";
    this.root.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x80aff4);
    this.scene.fog = new THREE.Fog(0x80aff4, 60, 230);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(50, 120, 20);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
    this.input = new InputController(this.renderer.domElement);
    this.terrainRenderer = new TerrainRenderer(this.scene, this.world);
    this.hud = new Hud(this.root);

    const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
    const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    this.blockOutline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
    this.blockOutline.visible = false;
    this.scene.add(this.blockOutline);

    window.addEventListener("resize", this.onResize);
  }

  async init(): Promise<void> {
    this.network.onMessage((message) => this.onServerMessage(message));
    this.network.onClose(() => {
      this.lastServerMessage = "Disconnected from server";
    });
    await this.network.connect(this.options.serverUrl);
    this.network.send({
      type: "hello",
      nickname: this.options.nickname,
      roomCode: this.options.roomCode,
      clientVersion: PROTOCOL_VERSION
    });

    const welcome = await this.awaitWelcome();
    this.localPlayerId = welcome.playerId;
    this.lastServerMessage = `Connected to room ${welcome.roomCode} (${MAX_PLAYERS_PER_ROOM} max)`;

    this.initialized = true;
    this.frame();
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const remote of this.remotePlayers.values()) {
      this.scene.remove(remote.mesh);
      remote.mesh.geometry.dispose();
      (remote.mesh.material as THREE.Material).dispose();
    }
    for (const mob of this.remoteMobs.values()) {
      this.scene.remove(mob.mesh);
      mob.mesh.geometry.dispose();
      (mob.mesh.material as THREE.Material).dispose();
    }
    this.remotePlayers.clear();
    this.remoteMobs.clear();
    this.network.close();
    this.terrainRenderer.dispose();
    this.renderer.dispose();
  }

  private awaitWelcome(timeoutMs = 8000): Promise<Extract<ServerMessage, { type: "welcome" }>> {
    if (this.lastWelcome) {
      return Promise.resolve(this.lastWelcome);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.localPlayerId) {
          reject(new Error("Server did not respond with welcome in time"));
        }
      }, timeoutMs);
      this.welcomeResolver = (message) => {
        clearTimeout(timeout);
        resolve(message);
      };
    });
  }

  private frame = (): void => {
    if (!this.initialized) {
      return;
    }

    const dt = Math.min(MAX_FRAME_DT, this.clock.getDelta());
    this.accumulator += dt;
    this.fpsCounter.frames += 1;
    this.fpsCounter.elapsed += dt;
    if (this.fpsCounter.elapsed >= 1) {
      this.fpsCounter.fps = this.fpsCounter.frames / this.fpsCounter.elapsed;
      this.fpsCounter.frames = 0;
      this.fpsCounter.elapsed = 0;
    }

    while (this.accumulator >= FIXED_DT) {
      this.updateFixed(FIXED_DT);
      this.accumulator -= FIXED_DT;
      this.input.endFrame();
    }

    this.player.applyToCamera(this.camera);
    this.updateRemoteVisuals();
    this.terrainRenderer.update(3);
    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.frame);
  };

  private updateFixed(dt: number): void {
    this.handleInventorySelection();
    this.handleCraftingInput();

    this.player.update(dt, this.input, this.world);
    this.hoveredBlock = this.getTargetBlock();
    this.updateBlockOutline();
    this.handleBlockInteraction(dt);
    this.handleCombat();

    const pending = this.captureMovementInput(dt);
    this.pendingInputs.push(pending);
    this.network.send({
      type: "input",
      ...pending
    });
    if (this.pendingInputs.length > 120) {
      this.pendingInputs.shift();
    }

    this.pingTimer += dt;
    if (this.pingTimer >= 1.0) {
      this.pingTimer = 0;
      this.network.send({ type: "ping", clientTime: performance.now() });
    }

    this.updateHud();
  }

  private captureMovementInput(dt: number): PendingInput {
    const moveX = (this.input.isKeyDown("KeyD") ? 1 : 0) - (this.input.isKeyDown("KeyA") ? 1 : 0);
    const moveZ = (this.input.isKeyDown("KeyS") ? 1 : 0) - (this.input.isKeyDown("KeyW") ? 1 : 0);
    const magnitude = Math.hypot(moveX, moveZ);
    const normalizedX = magnitude > 0 ? moveX / magnitude : 0;
    const normalizedZ = magnitude > 0 ? moveZ / magnitude : 0;
    this.inputSeq += 1;
    return {
      seq: this.inputSeq,
      dt,
      moveX: normalizedX,
      moveZ: normalizedZ,
      jump: this.input.isKeyDown("Space"),
      sprint: this.input.isKeyDown("ShiftLeft"),
      yaw: this.player.yaw,
      pitch: this.player.pitch
    };
  }

  private handleInventorySelection(): void {
    const wheel = this.input.consumeWheelSteps();
    if (wheel !== 0) {
      this.inventory.scrollSelected(wheel);
      this.network.send({ type: "hotbar_select", slot: this.inventory.selectedSlot });
    }
    for (let i = 1; i <= 9; i += 1) {
      if (this.input.wasKeyPressed(`Digit${i}`)) {
        this.inventory.setSelected(i - 1);
        this.network.send({ type: "hotbar_select", slot: this.inventory.selectedSlot });
      }
    }
  }

  private handleCraftingInput(): void {
    if (this.input.wasKeyPressed("KeyC")) {
      this.craftingVisible = !this.craftingVisible;
      this.hud.setCraftingVisible(this.craftingVisible);
    }
    if (!this.craftingVisible) {
      return;
    }
    for (let i = 0; i < RECIPES.length; i += 1) {
      if (this.input.wasKeyPressed(`Digit${i + 1}`)) {
        this.network.send({ type: "action_craft", recipeId: RECIPES[i].id });
      }
    }
  }

  private getTargetBlock(): VoxelHit | null {
    this.player.getEyePosition(this.rayOrigin);
    this.player.getViewDirection(this.rayDirection);
    return voxelRaycast(this.world, this.rayOrigin, this.rayDirection, 6);
  }

  private updateBlockOutline(): void {
    if (!this.hoveredBlock) {
      this.blockOutline.visible = false;
      return;
    }
    this.blockOutline.visible = true;
    this.blockOutline.position.set(
      this.hoveredBlock.x + 0.5,
      this.hoveredBlock.y + 0.5,
      this.hoveredBlock.z + 0.5
    );
  }

  private handleBlockInteraction(dt: number): void {
    const hit = this.hoveredBlock;
    if (this.input.wasMousePressed(2) && hit) {
      const selected = this.inventory.getSelectedStack();
      if (!selected) {
        return;
      }
      const px = hit.x + hit.normal.x;
      const py = hit.y + hit.normal.y;
      const pz = hit.z + hit.normal.z;
      if (
        aabbIntersectsBlock(
          this.player.position,
          { halfWidth: PLAYER_HALF_WIDTH, height: PLAYER_HEIGHT },
          px,
          py,
          pz
        )
      ) {
        return;
      }
      this.network.send({
        type: "action_place",
        target: { x: hit.x, y: hit.y, z: hit.z },
        normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
        selectedSlot: this.inventory.selectedSlot
      });
    }

    if (!hit || !this.input.isMouseDown(0)) {
      this.miningTarget = "";
      this.miningProgress = 0;
      return;
    }

    const key = `${hit.x}:${hit.y}:${hit.z}`;
    if (this.miningTarget !== key) {
      this.miningTarget = key;
      this.miningProgress = 0;
    }
    const hardness = Math.max(0.2, BLOCK_DEFS[hit.block].hardness);
    const selected = this.inventory.getSelectedStack();
    const toolMultiplier = selected?.item === "pickaxe" ? 1.8 : 1;
    this.miningProgress += (1.0 * toolMultiplier * dt) / hardness;
    if (this.miningProgress >= 1) {
      this.network.send({
        type: "action_mine",
        target: { x: hit.x, y: hit.y, z: hit.z }
      });
      this.miningProgress = 0;
      this.miningTarget = "";
    }
  }

  private handleCombat(): void {
    if (!this.input.wasMousePressed(0) || this.hoveredBlock) {
      return;
    }
    this.player.getEyePosition(this.rayOrigin);
    this.player.getViewDirection(this.rayDirection);

    let closestId: number | null = null;
    let closestT = Number.POSITIVE_INFINITY;
    for (const mob of this.remoteMobs.values()) {
      const toCenter = new THREE.Vector3().subVectors(mob.mesh.position, this.rayOrigin);
      const t = toCenter.dot(this.rayDirection);
      if (t < 0 || t > 3.5 || t >= closestT) {
        continue;
      }
      const closestPoint = this.rayOrigin.clone().addScaledVector(this.rayDirection, t);
      if (closestPoint.distanceToSquared(mob.mesh.position) > 0.8 * 0.8) {
        continue;
      }
      closestT = t;
      closestId = mob.id;
    }
    if (closestId !== null) {
      this.network.send({ type: "action_attack", targetEntityId: closestId });
    }
  }

  private onServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.localPlayerId = message.playerId;
        this.tick = message.serverTick;
        this.lastServerMessage = `Welcome ${this.options.nickname}`;
        this.lastWelcome = message;
        this.welcomeResolver?.(message);
        this.welcomeResolver = null;
        break;
      case "chunk_data": {
        const blocks = this.world.decodeChunkBase64(message.blocksBase64);
        this.world.setChunk(message.cx, message.cz, blocks);
        break;
      }
      case "snapshot":
        this.tick = message.tick;
        for (const delta of message.changedBlocks) {
          this.world.applyBlockDelta(delta.x, delta.y, delta.z, delta.block as BlockId);
        }
        this.applySnapshotPlayers(message.players);
        this.applySnapshotMobs(message.mobs);
        break;
      case "inventory_update":
        this.inventory = new Inventory(message.hotbar as never);
        this.inventory.setSelected(message.selectedSlot);
        break;
      case "event":
        if (message.kind === "damage") {
          this.lastServerMessage = "You took damage";
        } else if (message.kind === "death") {
          this.lastServerMessage = "You died";
        }
        break;
      case "pong":
        this.netRttMs = Math.max(0, performance.now() - message.clientTime);
        break;
      case "error":
        this.lastServerMessage = `${message.code}: ${message.message}`;
        break;
      default:
        break;
    }
  }

  private applySnapshotPlayers(players: NetPlayerState[]): void {
    const seen = new Set<string>();
    for (const state of players) {
      seen.add(state.id);
      if (state.id === this.localPlayerId) {
        this.applyLocalReconciliation(state);
        continue;
      }
      let visual = this.remotePlayers.get(state.id);
      if (!visual) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 1.8, 0.7),
          new THREE.MeshLambertMaterial({ color: 0x2d60b4 })
        );
        this.scene.add(mesh);
        visual = { mesh, target: new THREE.Vector3() };
        this.remotePlayers.set(state.id, visual);
      }
      visual.target.set(state.x, state.y + 0.9, state.z);
    }

    for (const [id, visual] of this.remotePlayers.entries()) {
      if (seen.has(id)) {
        continue;
      }
      this.scene.remove(visual.mesh);
      visual.mesh.geometry.dispose();
      (visual.mesh.material as THREE.Material).dispose();
      this.remotePlayers.delete(id);
    }
  }

  private applyLocalReconciliation(state: NetPlayerState): void {
    const authPos = new THREE.Vector3(state.x, state.y, state.z);
    const dist = authPos.distanceTo(this.player.position);
    if (dist > 2.5) {
      this.player.position.copy(authPos);
    } else if (dist > 0.15) {
      this.player.position.lerp(authPos, 0.35);
    }
    this.player.velocity.set(state.vx, state.vy, state.vz);
    this.player.health = state.health;
    this.player.yaw = state.yaw;
    this.player.pitch = state.pitch;

    this.inventory = new Inventory(state.hotbar as never);
    this.inventory.setSelected(state.selectedSlot);

    if (typeof state.lastProcessedSeq === "number") {
      while (this.pendingInputs.length > 0 && this.pendingInputs[0].seq <= state.lastProcessedSeq) {
        this.pendingInputs.shift();
      }
    }
  }

  private applySnapshotMobs(mobs: NetMobState[]): void {
    const seen = new Set<number>();
    for (const state of mobs) {
      seen.add(state.id);
      let visual = this.remoteMobs.get(state.id);
      if (!visual) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 1.8, 0.7),
          new THREE.MeshLambertMaterial({ color: 0x9c2d2d })
        );
        this.scene.add(mesh);
        visual = {
          id: state.id,
          mesh,
          target: new THREE.Vector3(state.x, state.y + 0.9, state.z),
          health: state.health
        };
        this.remoteMobs.set(state.id, visual);
      }
      visual.target.set(state.x, state.y + 0.9, state.z);
      visual.health = state.health;
    }

    for (const [id, mob] of this.remoteMobs.entries()) {
      if (seen.has(id)) {
        continue;
      }
      this.scene.remove(mob.mesh);
      mob.mesh.geometry.dispose();
      (mob.mesh.material as THREE.Material).dispose();
      this.remoteMobs.delete(id);
    }
  }

  private updateRemoteVisuals(): void {
    for (const remote of this.remotePlayers.values()) {
      remote.mesh.position.lerp(remote.target, 0.25);
    }
    for (const mob of this.remoteMobs.values()) {
      mob.mesh.position.lerp(mob.target, 0.25);
    }
  }

  private updateHud(): void {
    this.hud.updateHealth(this.player.health);
    this.hud.updateHotbar(this.inventory);
    this.hud.updateCrafting(RECIPES, this.inventory);
    this.hud.updateDebug([
      `Mode: Multiplayer`,
      `FPS: ${this.fpsCounter.fps.toFixed(0)}`,
      `Chunks: ${this.world.getLoadedChunkCount()}`,
      `Remote Players: ${this.remotePlayers.size}`,
      `Remote Mobs: ${this.remoteMobs.size}`,
      `Tick: ${this.tick}`,
      `Ping: ${this.netRttMs.toFixed(0)}ms`,
      `Server: ${this.lastServerMessage}`,
      `Pos: ${this.player.position.x.toFixed(1)}, ${this.player.position.y.toFixed(1)}, ${this.player.position.z.toFixed(1)}`
    ]);
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
