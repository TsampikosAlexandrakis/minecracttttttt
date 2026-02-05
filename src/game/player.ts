import * as THREE from "three";
import {
  GRAVITY,
  PLAYER_EYE_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_JUMP_SPEED,
  PLAYER_SPRINT_SPEED,
  PLAYER_WALK_SPEED
} from "../config";
import { InputController } from "./input";
import { CollisionWorld, moveWithCollisions } from "./physics";

export class PlayerController {
  readonly position = new THREE.Vector3(0, 50, 0);
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  health = 20;
  onGround = false;

  update(dt: number, input: InputController, world: CollisionWorld): void {
    const look = input.consumeLookDelta();
    this.yaw -= look.dx * 0.0022;
    this.pitch -= look.dy * 0.0022;
    this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch));

    const moveInput = new THREE.Vector3();
    if (input.isKeyDown("KeyW")) moveInput.z -= 1;
    if (input.isKeyDown("KeyS")) moveInput.z += 1;
    if (input.isKeyDown("KeyA")) moveInput.x -= 1;
    if (input.isKeyDown("KeyD")) moveInput.x += 1;
    if (moveInput.lengthSq() > 0) {
      moveInput.normalize();
    }

    const speed = input.isKeyDown("ShiftLeft") ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const desiredX = right.x * moveInput.x + forward.x * moveInput.z;
    const desiredZ = right.z * moveInput.x + forward.z * moveInput.z;

    // Critically damp toward movement target for responsive controls.
    const accel = 20;
    this.velocity.x += (desiredX * speed - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (desiredZ * speed - this.velocity.z) * Math.min(1, accel * dt);

    this.velocity.y -= GRAVITY * dt;
    if (input.isKeyDown("Space") && this.onGround) {
      this.velocity.y = PLAYER_JUMP_SPEED;
      this.onGround = false;
    }

    const collision = moveWithCollisions(this.position, this.velocity, dt, world, {
      halfWidth: PLAYER_HALF_WIDTH,
      height: PLAYER_HEIGHT
    });
    this.onGround = collision.onGround;
  }

  applyToCamera(camera: THREE.PerspectiveCamera): void {
    camera.position.set(this.position.x, this.position.y + PLAYER_EYE_HEIGHT, this.position.z);
    camera.rotation.order = "YXZ";
    camera.rotation.y = this.yaw;
    camera.rotation.x = this.pitch;
  }

  getEyePosition(target = new THREE.Vector3()): THREE.Vector3 {
    target.set(this.position.x, this.position.y + PLAYER_EYE_HEIGHT, this.position.z);
    return target;
  }

  getViewDirection(target = new THREE.Vector3()): THREE.Vector3 {
    target.set(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    return target.normalize();
  }

  takeDamage(amount: number): void {
    this.health = Math.max(0, this.health - amount);
  }
}
