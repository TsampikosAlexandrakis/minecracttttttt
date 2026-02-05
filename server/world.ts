import fs from "node:fs";
import path from "node:path";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../src/config";
import { BlockId } from "../src/types";
import { chunkKey, ChunkData } from "../src/world/chunk";
import { WorldGenerator } from "../src/world/generator";

const BLOCKS_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

export class AuthoritativeWorld {
  private readonly generator: WorldGenerator;
  private readonly roomDir: string;
  private readonly chunksDir: string;
  private readonly chunks = new Map<string, ChunkData>();
  private readonly dirty = new Set<string>();

  constructor(seed: number, roomDir: string) {
    this.generator = new WorldGenerator(seed);
    this.roomDir = roomDir;
    this.chunksDir = path.join(this.roomDir, "chunks");
    fs.mkdirSync(this.chunksDir, { recursive: true });
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= WORLD_HEIGHT) {
      return BlockId.Air;
    }
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    const cx = Math.floor(fx / CHUNK_SIZE);
    const cz = Math.floor(fz / CHUNK_SIZE);
    const lx = mod(fx, CHUNK_SIZE);
    const lz = mod(fz, CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    return chunk.get(lx, y, lz);
  }

  setBlock(x: number, y: number, z: number, block: BlockId): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) {
      return false;
    }
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    const cx = Math.floor(fx / CHUNK_SIZE);
    const cz = Math.floor(fz / CHUNK_SIZE);
    const lx = mod(fx, CHUNK_SIZE);
    const lz = mod(fz, CHUNK_SIZE);
    const key = chunkKey(cx, cz);
    const chunk = this.getChunk(cx, cz);
    const old = chunk.get(lx, y, lz);
    if (old === block) {
      return false;
    }
    chunk.set(lx, y, lz, block);
    this.dirty.add(key);
    return true;
  }

  encodeChunkBase64(cx: number, cz: number): string {
    const chunk = this.getChunk(cx, cz);
    return Buffer.from(chunk.blocks.buffer).toString("base64");
  }

  flushDirtyChunks(): void {
    for (const key of this.dirty) {
      const [cxString, czString] = key.split(":");
      const cx = Number(cxString);
      const cz = Number(czString);
      const chunk = this.chunks.get(key);
      if (!chunk) {
        continue;
      }
      const filePath = this.chunkPath(cx, cz);
      fs.writeFileSync(filePath, Buffer.from(chunk.blocks.buffer));
    }
    this.dirty.clear();
  }

  getChunk(cx: number, cz: number): ChunkData {
    const key = chunkKey(cx, cz);
    const cached = this.chunks.get(key);
    if (cached) {
      return cached;
    }

    const filePath = this.chunkPath(cx, cz);
    let chunk: ChunkData;
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath);
      const length = raw.byteLength / Uint16Array.BYTES_PER_ELEMENT;
      if (length === BLOCKS_PER_CHUNK) {
        const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
        chunk = new ChunkData(cx, cz, new Uint16Array(bytes.slice(0)));
      } else {
        chunk = this.generator.generateChunk(cx, cz);
      }
    } else {
      chunk = this.generator.generateChunk(cx, cz);
    }

    this.chunks.set(key, chunk);
    return chunk;
  }

  private chunkPath(cx: number, cz: number): string {
    return path.join(this.chunksDir, `${cx}_${cz}.bin`);
  }
}

function mod(a: number, b: number): number {
  const r = a % b;
  return r < 0 ? r + b : r;
}
