import * as THREE from "three";
import { GRAVITY, MOB_HALF_WIDTH, MOB_HEIGHT, MOB_SPEED } from "../config";
import { CollisionWorld, moveWithCollisions } from "./physics";
import { PlayerController } from "./player";

let mobIdCounter = 0;

export class HostileMob {
  readonly id: number;
  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();
  readonly mesh: THREE.Mesh;
  health = 10;
  attackCooldown = 0;
  onGround = false;

  constructor(scene: THREE.Scene, x: number, y: number, z: number) {
    this.id = mobIdCounter++;
    this.position = new THREE.Vector3(x, y, z);
    const geometry = new THREE.BoxGeometry(0.7, 1.8, 0.7);
    const material = new THREE.MeshLambertMaterial({ color: 0x9c2d2d });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(this.position).add(new THREE.Vector3(0, MOB_HEIGHT * 0.5, 0));
    scene.add(this.mesh);
  }

  update(dt: number, world: CollisionWorld, player: PlayerController): void {
    const toPlayer = new THREE.Vector3().subVectors(player.position, this.position);
    const horizontalDistance = Math.hypot(toPlayer.x, toPlayer.z);

    if (horizontalDistance < 20) {
      const dirX = toPlayer.x / Math.max(0.001, horizontalDistance);
      const dirZ = toPlayer.z / Math.max(0.001, horizontalDistance);
      this.velocity.x = dirX * MOB_SPEED;
      this.velocity.z = dirZ * MOB_SPEED;
    } else {
      this.velocity.x *= Math.max(0, 1 - 8 * dt);
      this.velocity.z *= Math.max(0, 1 - 8 * dt);
    }

    this.velocity.y -= GRAVITY * dt;
    const collision = moveWithCollisions(this.position, this.velocity, dt, world, {
      halfWidth: MOB_HALF_WIDTH,
      height: MOB_HEIGHT
    });
    this.onGround = collision.onGround;

    if ((collision.hitX || collision.hitZ) && this.onGround) {
      this.velocity.y = 6.2;
    }

    if (this.attackCooldown > 0) {
      this.attackCooldown -= dt;
    } else if (horizontalDistance < 1.5 && Math.abs(player.position.y - this.position.y) < 1.3) {
      player.takeDamage(2);
      this.attackCooldown = 1.0;
    }

    this.mesh.position.copy(this.position).add(new THREE.Vector3(0, MOB_HEIGHT * 0.5, 0));
  }

  rayDistance(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): number | null {
    const toCenter = new THREE.Vector3().subVectors(this.mesh.position, origin);
    const t = toCenter.dot(direction);
    if (t < 0 || t > maxDistance) {
      return null;
    }
    const closest = origin.clone().addScaledVector(direction, t);
    const distSq = closest.distanceToSquared(this.mesh.position);
    return distSq <= 0.8 * 0.8 ? t : null;
  }

  takeDamage(amount: number): void {
    this.health -= amount;
  }

  isDead(): boolean {
    return this.health <= 0;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
