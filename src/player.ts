import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { type Assets, CHARACTERS, type CharacterId } from "./assets.ts";
import { PlayerCharacter } from "./player-character.ts";

export class Input {
  down = new Set<string>();
  pressed = new Set<string>();
  yaw = 0;
  pitch = 0.35;
  touchControls = false;
  moveX = 0;
  moveZ = 0;
  onClear?: () => void;
  mouseLock = typeof HTMLElement.prototype.requestPointerLock === "function";
  private lockPending = false;
  private releaseRequested = false;
  private wasLocked = false;
  private lockGeneration = 0;
  private unlockedAt = -Infinity;
  private canvas: HTMLCanvasElement;
  private lockOptions: {
    allowed: () => boolean;
    onUnlock: () => void;
    onError: () => void;
  };
  get locked() {
    return document.pointerLockElement === this.canvas;
  }
  get justUnlocked() {
    return performance.now() - this.unlockedAt < 250;
  }
  get lockSupported() {
    return typeof this.canvas.requestPointerLock === "function";
  }
  private drag: { pointerId: number; x: number; y: number } | null = null;
  constructor(
    canvas: HTMLCanvasElement,
    isPlaying: () => boolean,
    lockOptions: {
      allowed: () => boolean;
      onUnlock: () => void;
      onError: () => void;
    },
  ) {
    this.canvas = canvas;
    this.lockOptions = lockOptions;
    document.addEventListener("pointerlockchange", () => {
      const locked = this.locked;
      const wasLocked = this.wasLocked;
      this.wasLocked = locked;
      this.lockPending = false;
      this.cancelLook();
      if (locked) {
        if (
          this.touchControls ||
          !this.mouseLock ||
          !this.lockOptions.allowed() ||
          this.releaseRequested
        )
          this.releaseLock();
      } else {
        const requested = this.releaseRequested;
        this.releaseRequested = false;
        if (wasLocked) {
          this.unlockedAt = performance.now();
          this.clear();
          if (!requested && this.lockOptions.allowed())
            this.lockOptions.onUnlock();
        }
      }
    });
    document.addEventListener("pointerlockerror", () =>
      this.lockFailed(this.lockGeneration),
    );
    window.addEventListener("mousemove", (event) => {
      if (this.locked && this.lockOptions.allowed())
        this.look(event.movementX, event.movementY);
    });
    window.addEventListener("keydown", (event) => {
      if (
        !isPlaying() ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.code === "Space" &&
          event.target instanceof HTMLElement &&
          event.target.closest("button, summary, a[href]"))
      )
        return;
      if (event.code === "KeyL" && !event.repeat) {
        event.preventDefault();
        this.toggleMouseLock();
        return;
      }
      if (
        [
          "Space",
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(event.code)
      )
        event.preventDefault();
      if (!event.repeat) this.pressed.add(event.code);
      this.down.add(event.code);
    });
    window.addEventListener("keyup", (event) => this.down.delete(event.code));
    canvas.addEventListener("pointerdown", (event) => {
      if (
        !isPlaying() ||
        !this.lockOptions.allowed() ||
        this.drag ||
        event.button !== 0 ||
        (event.pointerType === "mouse" && !event.isPrimary)
      )
        return;
      if (
        !this.touchControls &&
        this.mouseLock &&
        event.pointerType === "mouse" &&
        this.lockOptions.allowed()
      ) {
        this.requestLock();
        return;
      }
      this.drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      canvas.setPointerCapture(event.pointerId);
    });
    const endDrag = (event: PointerEvent) => {
      if (event.pointerId === this.drag?.pointerId) this.cancelLook();
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("lostpointercapture", endDrag);
    window.addEventListener("pointerout", (event) => {
      if (event.relatedTarget === null) endDrag(event);
    });
    window.addEventListener("pointermove", (event) => {
      const drag = this.drag;
      if (
        this.locked ||
        !this.lockOptions.allowed() ||
        drag?.pointerId !== event.pointerId
      )
        return;
      if (event.pointerType === "mouse" && !(event.buttons & 1)) {
        endDrag(event);
        return;
      }
      this.look(event.clientX - drag.x, event.clientY - drag.y);
      drag.x = event.clientX;
      drag.y = event.clientY;
    });
  }
  private cancelLook() {
    const pointerId = this.drag?.pointerId;
    this.drag = null;
    if (pointerId !== undefined && this.canvas.hasPointerCapture(pointerId))
      this.canvas.releasePointerCapture(pointerId);
  }
  private look(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.yaw -= x * 0.0025;
    this.pitch = THREE.MathUtils.clamp(this.pitch + y * 0.002, 0.12, 0.85);
  }
  setMouseLock(enabled: boolean) {
    this.mouseLock = enabled && this.lockSupported;
    if (!this.mouseLock) this.releaseLock();
  }
  toggleMouseLock() {
    this.setMouseLock(!this.locked);
    if (this.mouseLock) this.requestLock();
  }
  requestLock() {
    if (
      this.touchControls ||
      !this.mouseLock ||
      !this.lockSupported ||
      !this.lockOptions.allowed() ||
      this.locked ||
      this.lockPending
    )
      return;
    const generation = ++this.lockGeneration;
    this.lockPending = true;
    this.releaseRequested = false;
    try {
      // Older browsers return void; change/error events remain authoritative.
      const pending = this.canvas.requestPointerLock();
      pending?.catch(() => this.lockFailed(generation));
    } catch {
      this.lockFailed(generation);
    }
  }
  private lockFailed(generation: number) {
    if (generation !== this.lockGeneration || !this.lockPending) return;
    this.lockPending = false;
    this.mouseLock = false;
    this.releaseRequested = false;
    this.lockOptions.onError();
  }
  releaseLock() {
    if (!this.locked && !this.lockPending) return;
    ++this.lockGeneration;
    this.lockPending = false;
    this.releaseRequested = true;
    if (this.locked) document.exitPointerLock();
  }
  syncLock() {
    if (this.touchControls || !this.lockOptions.allowed()) this.releaseLock();
  }
  take(code: string) {
    const value = this.pressed.has(code);
    this.pressed.delete(code);
    return value;
  }
  clear() {
    this.down.clear();
    this.pressed.clear();
    this.moveX = this.moveZ = 0;
    this.cancelLook();
    this.onClear?.();
  }
}

export class Player {
  readonly group = new THREE.Group();
  character: PlayerCharacter;
  private characters = new Map<CharacterId, PlayerCharacter>();
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  physics: RAPIER.World;
  velocity = new THREE.Vector3();
  position = new THREE.Vector3();
  private previousPosition = new THREE.Vector3();
  private heading = Math.PI;
  private previousHeading = Math.PI;
  private previousTime = 0;
  grounded = false;
  vy = 0;
  speed = 0;
  slow = 0;
  time = 0;
  didJump = false;
  launched = false;
  private jumpBuffer = 0;
  private coyoteTime = 0;
  private cameraOffset = new THREE.Vector3();
  ray = new THREE.Raycaster();
  cosmetics = new THREE.Group();
  constructor(physics: RAPIER.World, assets: Assets) {
    for (const { id } of CHARACTERS)
      this.characters.set(
        id,
        new PlayerCharacter(id, assets.characters.get(id)),
      );
    this.character = this.characters.get("cabbage")!;
    this.group.add(this.character.group);
    this.physics = physics;
    this.body = physics.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.86, 4),
    );
    this.collider = physics.createCollider(
      RAPIER.ColliderDesc.capsule(0.5, 0.32),
      this.body,
    );
    this.controller = physics.createCharacterController(0.025);
    this.controller.enableAutostep(0.25, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.group.add(this.cosmetics);
    this.reset();
  }
  selectCharacter(id: CharacterId) {
    const next = this.characters.get(id);
    if (!next || next === this.character) return;
    this.character.group.removeFromParent();
    this.character = next;
    this.group.add(next.group);
    this.reset();
  }
  portrait() {
    const portrait = this.character.portrait();
    portrait.group.add(this.cosmetics.clone(true));
    return portrait;
  }
  reset() {
    this.body.setTranslation({ x: 0, y: 0.86, z: 4 }, true);
    this.body.setNextKinematicTranslation({ x: 0, y: 0.86, z: 4 });
    this.position.set(0, 0, 4);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.speed = 0;
    this.vy = 0;
    this.slow = 0;
    this.didJump = false;
    this.launched = false;
    this.jumpBuffer = this.coyoteTime = 0;
    this.time = 0;
    this.heading = Math.PI;
    this.syncRenderPose();
    this.renderPose(1);
    this.cameraOffset.set(0, 2.5, 7);
    this.character.reset();
    this.cosmetics.clear();
  }
  relocate(position: { x: number; y: number; z: number }) {
    this.body.setTranslation(
      { x: position.x, y: position.y + 0.86, z: position.z },
      true,
    );
    this.body.setNextKinematicTranslation({
      x: position.x,
      y: position.y + 0.86,
      z: position.z,
    });
    this.position.set(position.x, position.y, position.z);
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    this.speed = 0;
    this.slow = 0;
    this.grounded = false;
    this.didJump = false;
    this.launched = false;
    this.jumpBuffer = this.coyoteTime = 0;
    this.syncRenderPose();
    this.renderPose(1);
  }
  launch(velocity: { x: number; y: number; z: number }) {
    this.velocity.set(velocity.x, 0, velocity.z);
    this.vy = velocity.y;
    this.launched = true;
    this.didJump = true;
    this.grounded = false;
    this.jumpBuffer = this.coyoteTime = 0;
  }
  syncRenderPose() {
    this.previousPosition.copy(this.position);
    this.previousHeading = this.heading;
    this.previousTime = this.time;
  }
  renderPose(alpha: number) {
    this.group.position.lerpVectors(
      this.previousPosition,
      this.position,
      alpha,
    );
    this.group.rotation.y = THREE.MathUtils.lerp(
      this.previousHeading,
      this.heading,
      alpha,
    );
    const time = THREE.MathUtils.lerp(this.previousTime, this.time, alpha);
    this.character.pose(time, this.speed, !this.grounded, this.didJump);
  }
  update(dt: number, input: Input): { collided: boolean; landed: boolean } {
    this.syncRenderPose();
    this.time += dt;
    this.slow = Math.max(0, this.slow - dt);
    let x =
      Number(input.down.has("KeyD") || input.down.has("ArrowRight")) -
      Number(input.down.has("KeyA") || input.down.has("ArrowLeft"));
    let z =
      Number(input.down.has("KeyS") || input.down.has("ArrowDown")) -
      Number(input.down.has("KeyW") || input.down.has("ArrowUp"));
    x += input.moveX;
    z += input.moveZ;
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    const maxSpeed = this.slow > 0 ? 5 : 11.5;
    const targetX =
      (x * Math.cos(input.yaw) + z * Math.sin(input.yaw)) * maxSpeed;
    const targetZ =
      (-x * Math.sin(input.yaw) + z * Math.cos(input.yaw)) * maxSpeed;
    const blend = 1 - Math.exp(-dt * (length ? 10 : 14));
    if (!this.launched) {
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, targetX, blend);
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, targetZ, blend);
    }
    const wasGrounded = this.grounded;
    this.coyoteTime = this.grounded ? 0.1 : Math.max(0, this.coyoteTime - dt);
    this.jumpBuffer = input.take("Space")
      ? 0.12
      : Math.max(0, this.jumpBuffer - dt);
    if (!this.launched && this.jumpBuffer > 0 && this.coyoteTime > 0) {
      this.vy = 10.8;
      this.didJump = true;
      this.jumpBuffer = this.coyoteTime = 0;
    }
    this.vy -= 21 * dt;
    const desired = {
      x: this.velocity.x * dt,
      y: this.vy * dt,
      z: this.velocity.z * dt,
    };
    this.controller.computeColliderMovement(this.collider, desired);
    const corrected = this.controller.computedMovement();
    const p = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: p.x + corrected.x,
      y: p.y + corrected.y,
      z: p.z + corrected.z,
    });
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = -0.1;
    this.physics.timestep = dt;
    this.physics.step();
    const now = this.body.translation();
    this.position.set(now.x, now.y - 0.85, now.z);
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.speed > 0.3) {
      const angle = Math.atan2(this.velocity.x, this.velocity.z);
      this.heading +=
        Math.atan2(
          Math.sin(angle - this.heading),
          Math.cos(angle - this.heading),
        ) * Math.min(1, dt * 14);
    }
    const collided =
      this.speed > 2 &&
      Math.hypot(desired.x - corrected.x, desired.z - corrected.z) > 0.025 &&
      this.hitWall(desired);
    if (collided) this.slow = Math.max(this.slow, 0.35);
    const landed = !wasGrounded && this.grounded && this.didJump;
    if (landed) {
      this.didJump = false;
      this.launched = false;
    }
    return { collided, landed };
  }
  private hitWall(desired: RAPIER.Vector) {
    const walkableNormalY = Math.cos(this.controller.maxSlopeClimbAngle());
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const normal = this.controller.computedCollision(i)?.normal1;
      if (
        normal &&
        normal.y < walkableNormalY &&
        normal.x * desired.x + normal.z * desired.z < 0
      ) {
        return true;
      }
    }
    return false;
  }
  updateCamera(
    camera: THREE.PerspectiveCamera,
    input: Input,
    obstacles: THREE.Object3D[],
    dt: number,
  ) {
    const target = this.group.position
      .clone()
      .add(new THREE.Vector3(0, 1.5, 0));
    const direction = new THREE.Vector3(
      Math.sin(input.yaw) * Math.cos(input.pitch),
      Math.sin(input.pitch),
      Math.cos(input.yaw) * Math.cos(input.pitch),
    );
    this.ray.set(target, direction);
    this.ray.far = 6.8;
    const hit = this.ray
      .intersectObjects(obstacles, true)
      .find((h) => h.distance > 0.1);
    const distance = hit ? Math.max(0.8, hit.distance - 0.35) : 6.8;
    // Ease the orbit offset while following the rendered player's movement directly.
    this.cameraOffset.lerp(
      direction.multiplyScalar(distance),
      hit ? 1 : 1 - Math.exp(-dt * 12),
    );
    camera.position.copy(target).add(this.cameraOffset);
    camera.position.y = Math.max(0.65, camera.position.y);
    camera.lookAt(target);
  }
  dress(assets: Assets, choices: number[], crowned: boolean) {
    this.cosmetics.clear();
    this.cosmetics.scale.setScalar(this.character.height / 2);
    const cupsey = this.character.id === "cupsey";
    if (choices[0] === 2) {
      this.character.coat();
      const jar = assets.create("peanut-butter-jar", 0.45);
      jar.position.set(cupsey ? 0.72 : 0.5, cupsey ? 0.3 : 0.7, 0.2);
      this.cosmetics.add(jar);
    }
    if (choices[1] === 2) {
      const gull = assets.create("gull", 0.7);
      gull.position.set(cupsey ? -0.83 : -0.5, cupsey ? 1.4 : 1.52, -0.1);
      this.cosmetics.add(gull);
    }
    if (choices[2] === 2) {
      const bin = assets.create("bin", cupsey ? 0.65 : 1);
      bin.position.set(0, cupsey ? 0.04 : 0.4, 0);
      bin.scale.x *= cupsey ? 1.7 : 1.3;
      bin.scale.z *= 1.3;
      this.cosmetics.add(bin);
    }
    if (choices[4] === 2) {
      const banana = assets.create("banana", cupsey ? 0.9 : 1.3);
      banana.position.set(cupsey ? 0.85 : 0.6, cupsey ? 0.3 : 0.65, 0);
      banana.rotation.z = 0.4;
      this.cosmetics.add(banana);
    }
    if (crowned) {
      const crown = assets.create("crown", 0.7);
      crown.position.set(0, 1.99, 0);
      this.cosmetics.add(crown);
    }
  }
}
