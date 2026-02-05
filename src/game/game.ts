import * as THREE from "three";
import {
  FIXED_DT,
  MAX_FRAME_DT,
  VIEW_DISTANCE_CHUNKS,
  WORLD_HEIGHT,
  WORLD_VERSION
} from "../config";
import { blockIdToDrop, BLOCK_DEFS, itemToBlockId } from "../blocks";
import { IndexedDbSaveRepository } from "../save/indexeddb";
import { TerrainRenderer } from "../render/terrainRenderer";
import { WorldGenerator } from "../world/generator";
import { WorldStore } from "../world/world";
import { BlockId, PlayerSaveState } from "../types";
import { InputController } from "./input";
import { Inventory } from "./inventory";
import { craft, RECIPES } from "./crafting";
import { PlayerController } from "./player";
import { aabbIntersectsBlock } from "./physics";
import { voxelRaycast, VoxelHit } from "./raycast";
import { Hud } from "../ui/hud";
import { HostileMob } from "./mob";
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from "../config";

export class Game {
  private readonly root: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly input: InputController;
  private readonly saveRepo = new IndexedDbSaveRepository();
  private readonly player = new PlayerController();
  private readonly clock = new THREE.Clock();
  private readonly hud: Hud;
  private readonly blockOutline: THREE.LineSegments;
  private readonly fpsCounter = { frames: 0, elapsed: 0, fps: 0 };
  private readonly rayOrigin = new THREE.Vector3();
  private readonly rayDirection = new THREE.Vector3();

  private world!: WorldStore;
  private terrainRenderer!: TerrainRenderer;
  private inventory = Inventory.createStarterInventory();
  private rafId: number | null = null;
  private accumulator = 0;
  private initialized = false;
  private hoveredBlock: VoxelHit | null = null;
  private miningTarget = "";
  private miningProgress = 0;
  private craftingVisible = false;
  private saveTimer = 0;
  private unloadTimer = 0;
  private mobSpawnTimer = 0;
  private mobs: HostileMob[] = [];

  constructor(root: HTMLElement) {
    this.root = root;

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.domElement.className = "game-canvas";
    this.root.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87b7ff);
    this.scene.fog = new THREE.Fog(0x87b7ff, 60, 230);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
    this.input = new InputController(this.renderer.domElement);
    this.hud = new Hud(this.root);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(50, 120, 20);
    this.scene.add(sun);

    const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
    const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    this.blockOutline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
    this.blockOutline.visible = false;
    this.scene.add(this.blockOutline);

    window.addEventListener("resize", this.onResize);
    window.addEventListener("pagehide", () => {
      void this.persistState();
    });
  }

  async init(): Promise<void> {
    await this.saveRepo.init();

    const meta = await this.saveRepo.loadWorldMeta();
    const seed = meta?.seed ?? Math.floor(Math.random() * 2_147_483_647);
    if (!meta) {
      await this.saveRepo.saveWorldMeta({ seed, version: WORLD_VERSION });
    }

    const worldGenerator = new WorldGenerator(seed);
    this.world = new WorldStore(worldGenerator, this.saveRepo, seed);
    this.terrainRenderer = new TerrainRenderer(this.scene, this.world);

    const playerState = await this.saveRepo.loadPlayer();
    this.restorePlayerState(playerState);

    await this.warmStartChunks();

    this.initialized = true;
    this.frame();
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const mob of this.mobs) {
      mob.dispose(this.scene);
    }
    this.mobs = [];
    this.terrainRenderer.dispose();
    this.renderer.dispose();
  }

  private async warmStartChunks(): Promise<void> {
    const maxTicks = 120;
    for (let i = 0; i < maxTicks; i += 1) {
      this.world.queueChunksAround(this.player.position.x, this.player.position.z, 3);
      this.world.processLoadQueue();
      if (this.world.getLoadedChunkCount() >= 25) {
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 8));
    }

    const spawnY = this.findSurfaceY(Math.floor(this.player.position.x), Math.floor(this.player.position.z));
    if (this.player.position.y < spawnY + 2) {
      this.player.position.y = spawnY + 2;
    }
  }

  private frame = (): void => {
    if (!this.initialized) {
      return;
    }

    const frameDt = Math.min(MAX_FRAME_DT, this.clock.getDelta());
    this.accumulator += frameDt;
    this.fpsCounter.frames += 1;
    this.fpsCounter.elapsed += frameDt;
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
    this.terrainRenderer.update(2);
    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.frame);
  };

  private updateFixed(dt: number): void {
    this.handleInventorySelection();
    this.handleCraftingInput();

    this.world.queueChunksAround(this.player.position.x, this.player.position.z, VIEW_DISTANCE_CHUNKS);
    this.world.processLoadQueue();

    this.player.update(dt, this.input, this.world);
    this.hoveredBlock = this.getTargetBlock();
    this.updateBlockOutline();
    this.handleBlockInteraction(dt);
    this.handleCombat();

    this.unloadTimer += dt;
    if (this.unloadTimer >= 2.5) {
      this.unloadTimer = 0;
      void this.world.unloadFarChunks(this.player.position.x, this.player.position.z);
    }

    this.mobSpawnTimer += dt;
    if (this.mobSpawnTimer >= 4) {
      this.mobSpawnTimer = 0;
      this.trySpawnMob();
    }
    this.updateMobs(dt);

    this.saveTimer += dt;
    if (this.saveTimer >= 3) {
      this.saveTimer = 0;
      void this.persistState();
    }

    this.updateHud();
  }

  private handleInventorySelection(): void {
    const wheel = this.input.consumeWheelSteps();
    if (wheel !== 0) {
      this.inventory.scrollSelected(wheel);
    }
    for (let i = 1; i <= 9; i += 1) {
      if (this.input.wasKeyPressed(`Digit${i}`)) {
        this.inventory.setSelected(i - 1);
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
        craft(this.inventory, RECIPES[i]);
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
      this.tryPlaceBlock(hit);
    }

    if (!hit || !this.input.isMouseDown(0)) {
      this.miningTarget = "";
      this.miningProgress = 0;
      return;
    }

    const target = `${hit.x}:${hit.y}:${hit.z}`;
    if (target !== this.miningTarget) {
      this.miningTarget = target;
      this.miningProgress = 0;
    }

    const hardness = Math.max(0.2, BLOCK_DEFS[hit.block].hardness);
    const selected = this.inventory.getSelectedStack();
    const toolMultiplier = selected?.item === "pickaxe" ? 1.8 : 1;
    const miningSpeed = 1.0 * toolMultiplier;
    this.miningProgress += (miningSpeed / hardness) * dt;

    if (this.miningProgress >= 1) {
      this.breakBlock(hit);
      this.miningProgress = 0;
      this.miningTarget = "";
    }
  }

  private tryPlaceBlock(hit: VoxelHit): void {
    const selected = this.inventory.getSelectedStack();
    if (!selected) {
      return;
    }
    const placeBlock = itemToBlockId(selected.item);
    if (placeBlock === null) {
      return;
    }

    const px = hit.x + hit.normal.x;
    const py = hit.y + hit.normal.y;
    const pz = hit.z + hit.normal.z;
    if (py < 0 || py >= WORLD_HEIGHT) {
      return;
    }
    const existing = this.world.getBlock(px, py, pz);
    if (existing !== BlockId.Air && existing !== BlockId.Water) {
      return;
    }

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

    if (this.world.setBlock(px, py, pz, placeBlock)) {
      this.inventory.consumeSelected(1);
    }
  }

  private breakBlock(hit: VoxelHit): void {
    const block = this.world.getBlock(hit.x, hit.y, hit.z);
    if (block === BlockId.Air || block === BlockId.Water) {
      return;
    }
    if (this.world.setBlock(hit.x, hit.y, hit.z, BlockId.Air)) {
      const drop = blockIdToDrop(block);
      if (drop) {
        this.inventory.add(drop, 1);
      }
    }
  }

  private handleCombat(): void {
    if (!this.input.wasMousePressed(0) || this.hoveredBlock) {
      return;
    }
    this.player.getEyePosition(this.rayOrigin);
    this.player.getViewDirection(this.rayDirection);

    let closest: HostileMob | null = null;
    let closestT = Number.POSITIVE_INFINITY;
    for (const mob of this.mobs) {
      const t = mob.rayDistance(this.rayOrigin, this.rayDirection, 3.5);
      if (t === null || t >= closestT) {
        continue;
      }
      closest = mob;
      closestT = t;
    }

    if (closest) {
      const selected = this.inventory.getSelectedStack();
      const damage = selected?.item === "pickaxe" ? 4 : 2;
      closest.takeDamage(damage);
    }
  }

  private updateMobs(dt: number): void {
    const survivors: HostileMob[] = [];
    for (const mob of this.mobs) {
      mob.update(dt, this.world, this.player);
      if (mob.isDead()) {
        this.inventory.add("dirt", 1);
        mob.dispose(this.scene);
      } else {
        survivors.push(mob);
      }
    }
    this.mobs = survivors;
  }

  private trySpawnMob(): void {
    if (this.mobs.length >= 8) {
      return;
    }
    const angle = Math.random() * Math.PI * 2;
    const radius = 10 + Math.random() * 12;
    const x = Math.floor(this.player.position.x + Math.cos(angle) * radius);
    const z = Math.floor(this.player.position.z + Math.sin(angle) * radius);

    const y = this.findSurfaceY(x, z) + 1;
    if (Math.abs(y - this.player.position.y) > 18) {
      return;
    }
    if (!this.world.hasChunk(Math.floor(x / 16), Math.floor(z / 16))) {
      return;
    }
    const mob = new HostileMob(this.scene, x + 0.5, y, z + 0.5);
    this.mobs.push(mob);
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

  private updateHud(): void {
    this.hud.updateHealth(this.player.health);
    this.hud.updateHotbar(this.inventory);
    this.hud.updateCrafting(RECIPES, this.inventory);
    this.hud.updateDebug([
      `FPS: ${this.fpsCounter.fps.toFixed(0)}`,
      `Chunks: ${this.world.getLoadedChunkCount()}`,
      `Chunk Queue: ${this.world.getLoadQueueLength()}`,
      `Mobs: ${this.mobs.length}`,
      `Mesh Rebuild (ms): ${this.terrainRenderer.lastBuildDurationMs.toFixed(2)}`,
      `Pos: ${this.player.position.x.toFixed(1)}, ${this.player.position.y.toFixed(1)}, ${this.player.position.z.toFixed(1)}`
    ]);
  }

  private async persistState(): Promise<void> {
    await this.world.flushDirtyChunks();
    await this.saveRepo.savePlayer(this.serializePlayerState());
  }

  private serializePlayerState(): PlayerSaveState {
    return {
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
      vx: this.player.velocity.x,
      vy: this.player.velocity.y,
      vz: this.player.velocity.z,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      health: this.player.health,
      selectedSlot: this.inventory.selectedSlot,
      hotbar: this.inventory.serialize()
    };
  }

  private restorePlayerState(state: PlayerSaveState | null): void {
    if (!state) {
      this.player.position.set(0, 55, 0);
      this.player.velocity.set(0, 0, 0);
      this.player.yaw = 0;
      this.player.pitch = 0;
      this.player.health = 20;
      this.inventory = Inventory.createStarterInventory();
      return;
    }

    this.player.position.set(state.x, state.y, state.z);
    this.player.velocity.set(state.vx, state.vy, state.vz);
    this.player.yaw = state.yaw;
    this.player.pitch = state.pitch;
    this.player.health = state.health;
    this.inventory = new Inventory(state.hotbar);
    this.inventory.setSelected(state.selectedSlot);
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
