import * as THREE from "three";
import { BlockId } from "../types";

interface RaycastWorld {
  getBlock(x: number, y: number, z: number): BlockId;
}

export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  normal: THREE.Vector3;
  block: BlockId;
}

function intBound(s: number, ds: number): number {
  if (ds > 0) {
    return (Math.ceil(s) - s) / ds;
  }
  if (ds < 0) {
    return (s - Math.floor(s)) / -ds;
  }
  return Number.POSITIVE_INFINITY;
}

export function voxelRaycast(
  world: RaycastWorld,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number
): VoxelHit | null {
  const dir = direction.clone().normalize();
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;

  const tDeltaX = dir.x === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.x);
  const tDeltaY = dir.y === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.y);
  const tDeltaZ = dir.z === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dir.z);

  let tMaxX = intBound(origin.x, dir.x);
  let tMaxY = intBound(origin.y, dir.y);
  let tMaxZ = intBound(origin.z, dir.z);

  let traveled = 0;
  let normal = new THREE.Vector3(0, 0, 0);

  while (traveled <= maxDistance) {
    const block = world.getBlock(x, y, z);
    if (block !== BlockId.Air && block !== BlockId.Water) {
      return { x, y, z, normal, block };
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      traveled = tMaxX;
      tMaxX += tDeltaX;
      normal = new THREE.Vector3(-stepX, 0, 0);
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      traveled = tMaxY;
      tMaxY += tDeltaY;
      normal = new THREE.Vector3(0, -stepY, 0);
    } else {
      z += stepZ;
      traveled = tMaxZ;
      tMaxZ += tDeltaZ;
      normal = new THREE.Vector3(0, 0, -stepZ);
    }
  }

  return null;
}
