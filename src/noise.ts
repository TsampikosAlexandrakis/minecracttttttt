function hashInt(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function hash2(seed: number, x: number, z: number): number {
  const n = hashInt(seed ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495));
  return n / 0xffffffff;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export class ValueNoise2D {
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed | 0;
  }

  sample(x: number, z: number): number {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = x0 + 1;
    const z1 = z0 + 1;

    const tx = smoothstep(x - x0);
    const tz = smoothstep(z - z0);

    const v00 = hash2(this.seed, x0, z0);
    const v10 = hash2(this.seed, x1, z0);
    const v01 = hash2(this.seed, x0, z1);
    const v11 = hash2(this.seed, x1, z1);

    const a = lerp(v00, v10, tx);
    const b = lerp(v01, v11, tx);
    return lerp(a, b, tz);
  }

  fbm(x: number, z: number, octaves = 4): number {
    let frequency = 1;
    let amplitude = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      sum += this.sample(x * frequency, z * frequency) * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return sum / norm;
  }
}

export function hashRange(seed: number, x: number, z: number): number {
  return hash2(seed, x, z);
}
