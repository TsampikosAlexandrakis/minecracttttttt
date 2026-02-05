export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function copyVec3(from: Vec3, to: Vec3): void {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
}

export function addScaled(out: Vec3, dir: Vec3, scale: number): void {
  out.x += dir.x * scale;
  out.y += dir.y * scale;
  out.z += dir.z * scale;
}

export function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function lengthXZ(v: Vec3): number {
  return Math.hypot(v.x, v.z);
}
