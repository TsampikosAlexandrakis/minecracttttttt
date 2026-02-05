import * as THREE from "three";
import { BlockId } from "../types";
import { BLOCK_DEFS, isSolidBlock } from "../blocks";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../config";
import { parseChunkKey } from "../world/chunk";

interface RenderChunkState {
  meshDirty: boolean;
}

export interface RenderWorld {
  forEachChunk(callback: (key: string, state: RenderChunkState) => void): void;
  hasChunk(cx: number, cz: number): boolean;
  getBlock(x: number, y: number, z: number): BlockId;
}

const CARDINAL_NEIGHBORS: Array<[number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];

export class TerrainRenderer {
  private readonly scene: THREE.Scene;
  private readonly world: RenderWorld;
  private readonly chunkGroups = new Map<string, THREE.Group>();
  private readonly cubeGeometry: THREE.BoxGeometry;
  private readonly materials = new Map<BlockId, THREE.MeshLambertMaterial>();
  private readonly dummy = new THREE.Object3D();

  lastBuildDurationMs = 0;

  constructor(scene: THREE.Scene, world: RenderWorld) {
    this.scene = scene;
    this.world = world;
    this.cubeGeometry = new THREE.BoxGeometry(1, 1, 1);

    for (const value of Object.values(BlockId)) {
      if (typeof value !== "number") {
        continue;
      }
      if (value === BlockId.Air) {
        continue;
      }
      const def = BLOCK_DEFS[value];
      this.materials.set(
        value,
        new THREE.MeshLambertMaterial({
          color: def.color
        })
      );
    }
  }

  update(maxChunkRebuilds = 2): void {
    const startedAt = performance.now();
    this.removeStaleChunkGroups();

    let rebuilt = 0;
    this.world.forEachChunk((key, state) => {
      if (rebuilt >= maxChunkRebuilds) {
        return;
      }
      if (!state.meshDirty) {
        return;
      }
      this.rebuildChunk(key);
      state.meshDirty = false;
      rebuilt += 1;
    });

    this.lastBuildDurationMs = performance.now() - startedAt;
  }

  dispose(): void {
    for (const group of this.chunkGroups.values()) {
      this.disposeGroup(group);
    }
    this.chunkGroups.clear();
    this.cubeGeometry.dispose();
    for (const material of this.materials.values()) {
      material.dispose();
    }
  }

  private removeStaleChunkGroups(): void {
    for (const [key, group] of this.chunkGroups.entries()) {
      const { cx, cz } = parseChunkKey(key);
      if (this.world.hasChunk(cx, cz)) {
        continue;
      }
      this.disposeGroup(group);
      this.chunkGroups.delete(key);
    }
  }

  private disposeGroup(group: THREE.Group): void {
    this.scene.remove(group);
    for (const child of group.children) {
      const mesh = child as THREE.InstancedMesh;
      mesh.dispose();
    }
  }

  private rebuildChunk(key: string): void {
    const existing = this.chunkGroups.get(key);
    if (existing) {
      this.disposeGroup(existing);
      this.chunkGroups.delete(key);
    }

    const coords = parseChunkKey(key);
    const worldXBase = coords.cx * CHUNK_SIZE;
    const worldZBase = coords.cz * CHUNK_SIZE;
    const instancesByBlock = new Map<BlockId, Array<[number, number, number]>>();

    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let y = 0; y < WORLD_HEIGHT; y += 1) {
          const wx = worldXBase + lx;
          const wz = worldZBase + lz;
          const block = this.world.getBlock(wx, y, wz);
          if (block === BlockId.Air || block === BlockId.Water) {
            continue;
          }
          if (!this.isBlockVisible(wx, y, wz)) {
            continue;
          }
          let entries = instancesByBlock.get(block);
          if (!entries) {
            entries = [];
            instancesByBlock.set(block, entries);
          }
          entries.push([wx, y, wz]);
        }
      }
    }

    const group = new THREE.Group();
    group.name = `chunk:${key}`;

    for (const [block, positions] of instancesByBlock.entries()) {
      if (positions.length === 0) {
        continue;
      }
      const material = this.materials.get(block);
      if (!material) {
        continue;
      }
      const mesh = new THREE.InstancedMesh(this.cubeGeometry, material, positions.length);
      let index = 0;
      for (const [wx, y, wz] of positions) {
        this.dummy.position.set(wx + 0.5, y + 0.5, wz + 0.5);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(index, this.dummy.matrix);
        index += 1;
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }

    this.scene.add(group);
    this.chunkGroups.set(key, group);
  }

  private isBlockVisible(x: number, y: number, z: number): boolean {
    for (const [dx, dy, dz] of CARDINAL_NEIGHBORS) {
      const neighbor = this.world.getBlock(x + dx, y + dy, z + dz);
      if (!isSolidBlock(neighbor)) {
        return true;
      }
    }
    return false;
  }
}
