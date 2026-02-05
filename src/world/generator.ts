import { BlockId } from "../types";
import { CHUNK_SIZE, WORLD_HEIGHT, WORLD_SEA_LEVEL } from "../config";
import { hashRange, ValueNoise2D } from "../noise";
import { ChunkData } from "./chunk";

export class WorldGenerator {
  private readonly seed: number;
  private readonly heightNoise: ValueNoise2D;
  private readonly detailNoise: ValueNoise2D;
  private readonly caveNoise: ValueNoise2D;
  private readonly treeSeed: number;

  constructor(seed: number) {
    this.seed = seed | 0;
    this.heightNoise = new ValueNoise2D(this.seed ^ 0x89ab23);
    this.detailNoise = new ValueNoise2D(this.seed ^ 0x3281cd);
    this.caveNoise = new ValueNoise2D(this.seed ^ 0x7722ff);
    this.treeSeed = this.seed ^ 0x44aa1f;
  }

  generateChunk(cx: number, cz: number): ChunkData {
    const chunk = new ChunkData(cx, cz);

    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        const wx = cx * CHUNK_SIZE + lx;
        const wz = cz * CHUNK_SIZE + lz;
        const height = this.getHeight(wx, wz);

        for (let y = 0; y < WORLD_HEIGHT; y += 1) {
          let block = BlockId.Air;
          if (y <= height) {
            const stoneDepth = height - 4;
            if (y <= stoneDepth) {
              block = BlockId.Stone;
              if (y > 8 && y < height - 3) {
                const cave = this.caveNoise.fbm(wx * 0.08, (wz + y) * 0.08, 3);
                if (cave > 0.72) {
                  block = BlockId.Air;
                }
              }
            } else if (y === height) {
              block = height <= WORLD_SEA_LEVEL + 1 ? BlockId.Sand : BlockId.Grass;
            } else {
              block = height <= WORLD_SEA_LEVEL + 1 ? BlockId.Sand : BlockId.Dirt;
            }
          } else if (y <= WORLD_SEA_LEVEL) {
            block = BlockId.Water;
          }
          chunk.set(lx, y, lz, block);
        }
      }
    }

    this.generateTrees(chunk);
    return chunk;
  }

  private generateTrees(chunk: ChunkData): void {
    for (let lx = 2; lx < CHUNK_SIZE - 2; lx += 1) {
      for (let lz = 2; lz < CHUNK_SIZE - 2; lz += 1) {
        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wz = chunk.cz * CHUNK_SIZE + lz;
        const chance = hashRange(this.treeSeed, wx, wz);
        if (chance < 0.992) {
          continue;
        }

        const groundY = this.findSurface(chunk, lx, lz);
        if (groundY < WORLD_SEA_LEVEL + 1 || groundY > WORLD_HEIGHT - 12) {
          continue;
        }
        if (chunk.get(lx, groundY, lz) !== BlockId.Grass) {
          continue;
        }

        const trunkHeight = 4 + Math.floor(hashRange(this.treeSeed ^ 0xaa1, wx, wz) * 3);
        for (let y = 1; y <= trunkHeight; y += 1) {
          chunk.set(lx, groundY + y, lz, BlockId.Wood);
        }

        const crownBase = groundY + trunkHeight - 1;
        for (let ox = -2; ox <= 2; ox += 1) {
          for (let oz = -2; oz <= 2; oz += 1) {
            for (let oy = 0; oy <= 2; oy += 1) {
              const distance = Math.abs(ox) + Math.abs(oz) + oy;
              if (distance > 4) {
                continue;
              }
              const tx = lx + ox;
              const tz = lz + oz;
              const ty = crownBase + oy;
              if (tx < 0 || tz < 0 || tx >= CHUNK_SIZE || tz >= CHUNK_SIZE || ty >= WORLD_HEIGHT) {
                continue;
              }
              if (chunk.get(tx, ty, tz) === BlockId.Air) {
                chunk.set(tx, ty, tz, BlockId.Leaves);
              }
            }
          }
        }
      }
    }
  }

  private findSurface(chunk: ChunkData, lx: number, lz: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
      const block = chunk.get(lx, y, lz);
      if (block !== BlockId.Air && block !== BlockId.Water) {
        return y;
      }
    }
    return 0;
  }

  private getHeight(wx: number, wz: number): number {
    const base = this.heightNoise.fbm(wx * 0.015, wz * 0.015, 5);
    const detail = this.detailNoise.fbm(wx * 0.05, wz * 0.05, 3);
    const h = 22 + base * 30 + detail * 6;
    return Math.max(6, Math.min(WORLD_HEIGHT - 8, Math.floor(h)));
  }
}
