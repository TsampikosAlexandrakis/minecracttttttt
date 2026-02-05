import { Vec3 } from "./vector";

export interface CollisionWorld {
  isSolid(x: number, y: number, z: number): boolean;
}

export interface CollisionBody {
  halfWidth: number;
  height: number;
}

export interface CollisionResult {
  onGround: boolean;
  hitX: boolean;
  hitZ: boolean;
}

function collides(world: CollisionWorld, position: Vec3, body: CollisionBody): boolean {
  const minX = Math.floor(position.x - body.halfWidth);
  const maxX = Math.floor(position.x + body.halfWidth);
  const minY = Math.floor(position.y);
  const maxY = Math.floor(position.y + body.height - 1e-5);
  const minZ = Math.floor(position.z - body.halfWidth);
  const maxZ = Math.floor(position.z + body.halfWidth);
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        if (world.isSolid(x, y, z)) {
          return true;
        }
      }
    }
  }
  return false;
}

function moveAxis(
  axis: "x" | "y" | "z",
  position: Vec3,
  velocity: Vec3,
  dt: number,
  world: CollisionWorld,
  body: CollisionBody
): boolean {
  const delta = velocity[axis] * dt;
  if (delta === 0) {
    return false;
  }
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.2));
  const stepDelta = delta / steps;
  for (let i = 0; i < steps; i += 1) {
    const candidate = { ...position };
    candidate[axis] += stepDelta;
    if (collides(world, candidate, body)) {
      velocity[axis] = 0;
      return true;
    }
    position.x = candidate.x;
    position.y = candidate.y;
    position.z = candidate.z;
  }
  return false;
}

export function moveWithCollisions(
  position: Vec3,
  velocity: Vec3,
  dt: number,
  world: CollisionWorld,
  body: CollisionBody
): CollisionResult {
  const hitX = moveAxis("x", position, velocity, dt, world, body);
  const hitZ = moveAxis("z", position, velocity, dt, world, body);
  const hitY = moveAxis("y", position, velocity, dt, world, body);
  return {
    onGround: hitY && velocity.y === 0,
    hitX,
    hitZ
  };
}

export function aabbIntersectsBlock(position: Vec3, body: CollisionBody, bx: number, by: number, bz: number): boolean {
  const minX = position.x - body.halfWidth;
  const maxX = position.x + body.halfWidth;
  const minY = position.y;
  const maxY = position.y + body.height;
  const minZ = position.z - body.halfWidth;
  const maxZ = position.z + body.halfWidth;
  return (
    minX < bx + 1 &&
    maxX > bx &&
    minY < by + 1 &&
    maxY > by &&
    minZ < bz + 1 &&
    maxZ > bz
  );
}
