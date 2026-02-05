import { CHUNK_SIZE, WORLD_HEIGHT } from "../config";
import { BlockId } from "../types";
import { chunkKey } from "../world/chunk";
import { isSolidBlock } from "../blocks";

interface ChunkState {
  blocks: Uint16Array;
  meshDirty: boolean;
}

export class NetworkWorldStore {
  private readonly chunks = new Map<string, ChunkState>();

  forEachChunk(callback: (key: string, state: ChunkState) => void): void {
    for (const [key, state] of this.chunks.entries()) {
      callback(key, state);
    }
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  getLoadedChunkCount(): number {
    return this.chunks.size;
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= WORLD_HEIGHT) {
      return BlockId.Air;
    }
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    const cx = Math.floor(fx / CHUNK_SIZE);
    const cz = Math.floor(fz / CHUNK_SIZE);
    const lx = ((fx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((fz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const state = this.chunks.get(chunkKey(cx, cz));
    if (!state) {
      return BlockId.Air;
    }
    return state.blocks[index(lx, y, lz)] as BlockId;
  }

  setChunk(cx: number, cz: number, blocks: Uint16Array): void {
    const key = chunkKey(cx, cz);
    this.chunks.set(key, { blocks, meshDirty: true });
    this.markNeighborChunksDirty(cx, cz);
  }

  applyBlockDelta(x: number, y: number, z: number, block: BlockId): void {
    if (y < 0 || y >= WORLD_HEIGHT) {
      return;
    }
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    const cx = Math.floor(fx / CHUNK_SIZE);
    const cz = Math.floor(fz / CHUNK_SIZE);
    const lx = ((fx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((fz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const key = chunkKey(cx, cz);
    const state = this.chunks.get(key);
    if (!state) {
      return;
    }
    state.blocks[index(lx, y, lz)] = block;
    state.meshDirty = true;
    this.markNeighborChunksDirty(cx, cz, lx, lz);
  }

  isSolid(x: number, y: number, z: number): boolean {
    return isSolidBlock(this.getBlock(x, y, z));
  }

  decodeChunkBase64(base64: string): Uint16Array {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      bytes[i] = raw.charCodeAt(i);
    }
    return new Uint16Array(bytes.buffer);
  }

  private markNeighborChunksDirty(cx: number, cz: number, lx?: number, lz?: number): void {
    if (lx === undefined || lz === undefined) {
      this.markChunkDirty(cx - 1, cz);
      this.markChunkDirty(cx + 1, cz);
      this.markChunkDirty(cx, cz - 1);
      this.markChunkDirty(cx, cz + 1);
      return;
    }
    if (lx === 0) {
      this.markChunkDirty(cx - 1, cz);
    } else if (lx === CHUNK_SIZE - 1) {
      this.markChunkDirty(cx + 1, cz);
    }
    if (lz === 0) {
      this.markChunkDirty(cx, cz - 1);
    } else if (lz === CHUNK_SIZE - 1) {
      this.markChunkDirty(cx, cz + 1);
    }
  }

  private markChunkDirty(cx: number, cz: number): void {
    const state = this.chunks.get(chunkKey(cx, cz));
    if (state) {
      state.meshDirty = true;
    }
  }
}

function index(lx: number, y: number, lz: number): number {
  return lx + lz * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
}
