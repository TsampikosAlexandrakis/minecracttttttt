import { CHUNK_SIZE, VIEW_DISTANCE_CHUNKS, WORLD_HEIGHT } from "../config";
import { BlockId } from "../types";
import { isSolidBlock } from "../blocks";
import { IndexedDbSaveRepository } from "../save/indexeddb";
import { chunkKey, ChunkData, parseChunkKey } from "./chunk";
import { WorldGenerator } from "./generator";

interface ChunkState {
  chunk: ChunkData;
  dirty: boolean;
  meshDirty: boolean;
  lastTouched: number;
}

export class WorldStore {
  private readonly generator: WorldGenerator;
  private readonly saveRepo: IndexedDbSaveRepository;
  private readonly worldKeyPrefix: string;
  private readonly chunks = new Map<string, ChunkState>();
  private readonly loadQueue: Array<{ cx: number; cz: number }> = [];
  private readonly queuedKeys = new Set<string>();
  private readonly loadingKeys = new Set<string>();
  private maxConcurrentLoads = 2;

  constructor(generator: WorldGenerator, saveRepo: IndexedDbSaveRepository, seed: number) {
    this.generator = generator;
    this.saveRepo = saveRepo;
    this.worldKeyPrefix = `${seed}:`;
  }

  getLoadedChunkCount(): number {
    return this.chunks.size;
  }

  getLoadQueueLength(): number {
    return this.loadQueue.length + this.loadingKeys.size;
  }

  forEachChunk(callback: (key: string, state: ChunkState) => void): void {
    for (const [key, state] of this.chunks.entries()) {
      callback(key, state);
    }
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  queueChunksAround(x: number, z: number, radius = VIEW_DISTANCE_CHUNKS): void {
    const center = worldToChunk(x, z);
    const targets: Array<{ cx: number; cz: number; dist2: number }> = [];

    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const cx = center.cx + dx;
        const cz = center.cz + dz;
        const key = chunkKey(cx, cz);
        if (this.chunks.has(key) || this.queuedKeys.has(key) || this.loadingKeys.has(key)) {
          continue;
        }
        targets.push({ cx, cz, dist2: dx * dx + dz * dz });
      }
    }

    targets.sort((a, b) => a.dist2 - b.dist2);
    for (const target of targets) {
      const key = chunkKey(target.cx, target.cz);
      this.loadQueue.push({ cx: target.cx, cz: target.cz });
      this.queuedKeys.add(key);
    }
  }

  processLoadQueue(): void {
    while (this.loadingKeys.size < this.maxConcurrentLoads && this.loadQueue.length > 0) {
      const next = this.loadQueue.shift();
      if (!next) {
        return;
      }
      const key = chunkKey(next.cx, next.cz);
      this.queuedKeys.delete(key);
      if (this.chunks.has(key) || this.loadingKeys.has(key)) {
        continue;
      }
      this.loadingKeys.add(key);
      void this.loadChunk(next.cx, next.cz).finally(() => {
        this.loadingKeys.delete(key);
      });
    }
  }

  async unloadFarChunks(x: number, z: number, radius = VIEW_DISTANCE_CHUNKS + 2): Promise<void> {
    const center = worldToChunk(x, z);
    const removals: string[] = [];
    for (const [key, state] of this.chunks.entries()) {
      const { cx, cz } = parseChunkKey(key);
      const dx = Math.abs(cx - center.cx);
      const dz = Math.abs(cz - center.cz);
      if (dx > radius || dz > radius) {
        if (state.dirty) {
          await this.saveRepo.saveChunk(this.storageChunkKey(cx, cz), state.chunk.blocks);
        }
        removals.push(key);
      }
    }

    for (const key of removals) {
      this.chunks.delete(key);
    }
  }

  async flushDirtyChunks(): Promise<void> {
    for (const [key, state] of this.chunks.entries()) {
      if (!state.dirty) {
        continue;
      }
      const { cx, cz } = parseChunkKey(key);
      await this.saveRepo.saveChunk(this.storageChunkKey(cx, cz), state.chunk.blocks);
      state.dirty = false;
    }
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= WORLD_HEIGHT) {
      return BlockId.Air;
    }
    const { cx, cz, lx, lz } = worldToChunkLocal(x, z);
    const state = this.chunks.get(chunkKey(cx, cz));
    if (!state) {
      return BlockId.Air;
    }
    state.lastTouched = performance.now();
    return state.chunk.get(lx, y, lz);
  }

  setBlock(x: number, y: number, z: number, block: BlockId): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) {
      return false;
    }
    const { cx, cz, lx, lz } = worldToChunkLocal(x, z);
    const key = chunkKey(cx, cz);
    const state = this.chunks.get(key);
    if (!state) {
      return false;
    }

    const oldBlock = state.chunk.get(lx, y, lz);
    if (oldBlock === block) {
      return false;
    }

    state.chunk.set(lx, y, lz, block);
    state.dirty = true;
    state.meshDirty = true;
    state.lastTouched = performance.now();

    if (lx === 0) {
      this.markChunkMeshDirty(cx - 1, cz);
    } else if (lx === CHUNK_SIZE - 1) {
      this.markChunkMeshDirty(cx + 1, cz);
    }
    if (lz === 0) {
      this.markChunkMeshDirty(cx, cz - 1);
    } else if (lz === CHUNK_SIZE - 1) {
      this.markChunkMeshDirty(cx, cz + 1);
    }

    return true;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return isSolidBlock(this.getBlock(x, y, z));
  }

  async saveChunkIfDirty(cx: number, cz: number): Promise<void> {
    const key = chunkKey(cx, cz);
    const state = this.chunks.get(key);
    if (!state || !state.dirty) {
      return;
    }
    await this.saveRepo.saveChunk(this.storageChunkKey(cx, cz), state.chunk.blocks);
    state.dirty = false;
  }

  private markChunkMeshDirty(cx: number, cz: number): void {
    const state = this.chunks.get(chunkKey(cx, cz));
    if (state) {
      state.meshDirty = true;
    }
  }

  private storageChunkKey(cx: number, cz: number): string {
    return `${this.worldKeyPrefix}${cx}:${cz}`;
  }

  private async loadChunk(cx: number, cz: number): Promise<void> {
    const key = chunkKey(cx, cz);
    const persisted = await this.saveRepo.loadChunk(this.storageChunkKey(cx, cz));
    const chunk = persisted ? new ChunkData(cx, cz, persisted) : this.generator.generateChunk(cx, cz);
    this.chunks.set(key, {
      chunk,
      dirty: false,
      meshDirty: true,
      lastTouched: performance.now()
    });

    // Neighbor chunks need remesh when a border chunk appears/disappears.
    this.markChunkMeshDirty(cx - 1, cz);
    this.markChunkMeshDirty(cx + 1, cz);
    this.markChunkMeshDirty(cx, cz - 1);
    this.markChunkMeshDirty(cx, cz + 1);
  }
}

export function worldToChunk(x: number, z: number): { cx: number; cz: number } {
  return {
    cx: floorDiv(Math.floor(x), CHUNK_SIZE),
    cz: floorDiv(Math.floor(z), CHUNK_SIZE)
  };
}

function worldToChunkLocal(x: number, z: number): { cx: number; cz: number; lx: number; lz: number } {
  const fx = Math.floor(x);
  const fz = Math.floor(z);
  const cx = floorDiv(fx, CHUNK_SIZE);
  const cz = floorDiv(fz, CHUNK_SIZE);
  const lx = mod(fx, CHUNK_SIZE);
  const lz = mod(fz, CHUNK_SIZE);
  return { cx, cz, lx, lz };
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

function mod(a: number, b: number): number {
  const result = a % b;
  return result < 0 ? result + b : result;
}
