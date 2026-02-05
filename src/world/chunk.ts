import { CHUNK_SIZE, WORLD_HEIGHT } from "../config";
import { BlockId } from "../types";

export class ChunkData {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint16Array;

  constructor(cx: number, cz: number, existing?: Uint16Array) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = existing ?? new Uint16Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
  }

  get(localX: number, y: number, localZ: number): BlockId {
    if (!this.inBounds(localX, y, localZ)) {
      return BlockId.Air;
    }
    return this.blocks[this.index(localX, y, localZ)] as BlockId;
  }

  set(localX: number, y: number, localZ: number, blockId: BlockId): void {
    if (!this.inBounds(localX, y, localZ)) {
      return;
    }
    this.blocks[this.index(localX, y, localZ)] = blockId;
  }

  private index(localX: number, y: number, localZ: number): number {
    return localX + localZ * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
  }

  private inBounds(localX: number, y: number, localZ: number): boolean {
    return (
      localX >= 0 &&
      localX < CHUNK_SIZE &&
      localZ >= 0 &&
      localZ < CHUNK_SIZE &&
      y >= 0 &&
      y < WORLD_HEIGHT
    );
  }
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx}:${cz}`;
}

export function parseChunkKey(key: string): { cx: number; cz: number } {
  const [cx, cz] = key.split(":");
  return { cx: Number(cx), cz: Number(cz) };
}
