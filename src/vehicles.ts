import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Assets, box as part } from "./assets.ts";
import { TRAFFIC_CIRCUIT } from "./navigation.ts";
import { RAMP_CENTERS, RAMP_LENGTH, RAMP_HALF_WIDTH, crossesRampLip, rampHeight, rampLip, rampProgress, rampSlope, rampTakeoffSpeed } from "./ramps.ts";

export type DriveInput = { throttle: number; steer: number; brake: boolean };

export interface Car {
  position: THREE.Vector3;
  previous: THREE.Vector3;
  heading: number;
  speed: number;
  group: THREE.Group;
  collider: RAPIER.Collider;
  body: RAPIER.RigidBody;
  controller: RAPIER.KinematicCharacterController;
  spawn: THREE.Vector3;
  spawnHeading: number;
  routeStart: number;
  waypoint: number;
  velocity: THREE.Vector3;
  drift: number;
  yawRate: number;
  slipAngle: number;
  impact: number;
  launchRampZ: number | null;
  vy: number;
  airborne: boolean;
  lean: number;
  pitch: number;
  compression: number;
  brakeLights: THREE.Group;
  driver: THREE.Group;
  hood: THREE.Group;
  traffic: boolean;
}

const HALF_W = 0.92;
const HALF_H = 0.48;
const HALF_L = 1.9;
const CENTER_Y = 0.47;
const UP = new THREE.Vector3(0, 1, 0);

const GRAVITY = 22;
const MAX_SPEED = 26;
const REVERSE_SPEED = 9;
const ACCEL = 16;
const BRAKE = 26;
const DRAG = 0.9;
const ROAD_GRIP = 12;
const SLIDING_GRIP = 0.95;

function angleBetween(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function forwardOf(heading: number, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(-Math.sin(heading), 0, -Math.cos(heading));
}

function hitWall(controller: RAPIER.KinematicCharacterController) {
  for (let i = 0; i < controller.numComputedCollisions(); i++) {
    const hit = controller.computedCollision(i);
    if (hit && hit.normal1.y < 0.55) return true;
  }
  return false;
}

export class StreetCars {
  scene: THREE.Scene;
  world: RAPIER.World;
  assets: Assets;
  fleet: Car[] = [];
  mounted: Car | null = null;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private cameraCut = true;
  private readonly tracks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16,0.012,1),new THREE.MeshBasicMaterial({color:0x353738}),384);
  private readonly trackPose = new THREE.Object3D();
  private readonly lastTracks = [new THREE.Vector3(), new THREE.Vector3()];
  private trackCursor = 0;
  private drawingTracks = false;
  private filter: RAPIER.QueryFilterFlags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;

  constructor(scene: THREE.Scene, world: RAPIER.World, assets: Assets) {
    this.scene = scene;
    this.world = world;
    this.assets = assets;
    this.tracks.frustumCulled = false;
    this.tracks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.tracks);
    this.buildFleet();
    this.reset();
  }

  private makeCar(x: number, z: number, heading: number, waypoint = -1): Car {
    const group = new THREE.Group();
    const src = this.assets.create("parked-car", 1.3);
    const model = new THREE.Group();
    model.add(src);
    // Normalize: long axis X -> Z, scale to ~1.9 wide x 4.1 long.
    const box = new THREE.Box3().setFromObject(src);
    const size = new THREE.Vector3();
    box.getSize(size);
    const longAxis = size.x >= size.z ? "x" : "z";
    const longLen = Math.max(size.x, size.z);
    const shortLen = Math.min(size.x, size.z);
    const scale = Math.min(1.9 / shortLen, 4.1 / longLen);
    src.scale.multiplyScalar(scale);
    if (longAxis === "x") src.rotation.y = Math.PI / 2;
    const box2 = new THREE.Box3().setFromObject(src);
    src.position.y -= box2.min.y;
    src.position.x -= (box2.min.x + box2.max.x) / 2;
    src.position.z -= (box2.min.z + box2.max.z) / 2;
    src.updateMatrixWorld(true);

    const brakeLights = new THREE.Group();
    const tail = new THREE.MeshBasicMaterial({ color: "#f06151" });
    const lens = new THREE.BoxGeometry(0.23, 0.09, 0.045);
    const rear = (box2.max.z - box2.min.z) * 0.495;
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(lens, tail);
      lamp.position.set(side * 0.65, 0.59, rear);
      brakeLights.add(lamp);
    }
    model.add(brakeLights);
    const hood = new THREE.Group();
    const decal = new THREE.MeshBasicMaterial({
      color: 0xa91331, side: THREE.DoubleSide, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const hoodRay = new THREE.Raycaster();
    for (const [dx, dz, radius] of [[0.14,-1.12,0.4],[-0.17,-1.36,0.16],[0.48,-1.02,0.1],[0.03,-0.94,0.09]]) {
      hoodRay.set(new THREE.Vector3(dx, 3, dz), new THREE.Vector3(0, -1, 0));
      const surface = hoodRay.intersectObject(src, true)[0];
      if (!surface) continue;
      const mark = new THREE.Mesh(new THREE.CircleGeometry(radius, 9), decal);
      const normal = surface.face!.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(surface.object.matrixWorld)).normalize();
      if (normal.y < 0) normal.negate();
      mark.position.copy(surface.point).addScaledVector(normal, 0.009);
      mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      mark.scale.x = 1.3;
      hood.add(mark);
    }
    hood.visible = false;
    model.add(hood);

    const driver = new THREE.Group();
    if (waypoint >= 0) {
      driver.add(part(0.39,0.34,0.24,"#497d82",0,0.93,0),part(0.25,0.27,0.23,"#b98763",0,1.22,0),
        part(0.26,0.08,0.24,"#35383e",0,1.37,0));
      driver.position.set(-0.39,0,0.11);
      model.add(driver);
    }

    group.add(model);
    group.position.set(x, 0, z);
    group.rotation.y = heading;
    this.scene.add(group);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, CENTER_Y, z);
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(HALF_W, HALF_H, HALF_L)
      .setTranslation(0, 0, 0)
      .setFriction(0.4)
      .setRestitution(0.1);
    const collider = this.world.createCollider(colDesc, body);
    const controller = this.world.createCharacterController(0.02);
    controller.enableAutostep(0.3, 0.2, true);
    controller.enableSnapToGround(0.4);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setCharacterMass(900);
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((30 * Math.PI) / 180);

    const car: Car = {
      position: new THREE.Vector3(x, 0, z),
      previous: new THREE.Vector3(x, 0, z),
      heading,
      speed: 0,
      group,
      collider,
      body,
      controller,
      spawn: new THREE.Vector3(x, 0, z), spawnHeading: heading,
      routeStart: waypoint, waypoint, velocity: new THREE.Vector3(), launchRampZ: null,
      drift: 0, yawRate: 0, slipAngle: 0, impact: 0,
      vy: 0,
      airborne: false,
      lean: 0,
      pitch: 0,
      compression: 0,
      brakeLights, driver,
      hood,
      traffic: waypoint >= 0,
    };
    this.fleet.push(car);
    return car;
  }

  private buildFleet(): void {
    this.makeCar(-3.4, 2.5, 0);
    this.makeCar(8.5, -47, Math.PI);
    this.makeCar(-8.6, -98, 0);
    this.makeCar(8.6, -191, Math.PI);
    this.makeCar(-63.8, -221, 0);
    this.makeCar(8.6, -310, Math.PI);
    this.makeCar(3.6, -32, Math.PI, 5);
    this.makeCar(-3.6, -156, 0, 1);
    this.makeCar(-5.8, -31, 0); // Press car outside the motel.
  }

  reset(): void {
    this.mounted = null;
    this.cameraCut = true;
    this.tracks.count = this.trackCursor = 0;
    this.drawingTracks = false;
    for (const car of this.fleet) {
      car.position.copy(car.spawn);
      car.previous.copy(car.spawn);
      car.heading = car.spawnHeading;
      car.waypoint = car.routeStart;
      car.traffic = car.routeStart >= 0;
      car.velocity.set(0, 0, 0);
      car.speed = car.vy = car.lean = car.pitch = car.compression = 0;
      car.drift = car.yawRate = car.slipAngle = car.impact = 0;
      car.brakeLights.visible = false;
      car.driver.visible = car.traffic;
      car.airborne = car.hood.visible = false;
      car.launchRampZ = null;
      this.syncBody(car, true);
      car.group.position.copy(car.position);
      car.group.rotation.set(0, car.heading, 0);
    }
  }

  private syncBody(car: Car, immediate = false): void {
    const center = this.tmpV2.copy(car.position);
    center.y += CENTER_Y;
    this.tmpQ.setFromAxisAngle(UP, car.heading);
    if (immediate) {
      car.body.setTranslation(center, true);
      car.body.setRotation(this.tmpQ, true);
    }
    car.body.setNextKinematicTranslation(center);
    car.body.setNextKinematicRotation(this.tmpQ);
  }

  nearby(x: number, z: number, maxDistance = 4.25): Car | null {
    let best: Car | null = null;
    let bestD = maxDistance;
    for (const car of this.fleet) {
      if (Math.abs(car.speed) > 2.5 || car.airborne) continue;
      const d = Math.hypot(car.position.x - x, car.position.z - z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  enter(x: number, z: number): boolean {
    if (this.mounted) return false;
    const car = this.nearby(x, z);
    if (!car) return false;
    this.mounted = car;
    car.traffic = false;
    car.driver.visible = false;
    this.cameraCut = true;
    return true;
  }

  exit(): THREE.Vector3 | null {
    const car = this.mounted;
    if (!car) return null;
    if (Math.abs(car.speed) > 2.5 || car.airborne) return null;
    const fwd = forwardOf(car.heading);
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const candidates = [
      right.clone().multiplyScalar(2.2),
      right.clone().multiplyScalar(-2.2),
      fwd.clone().multiplyScalar(-3.2),
    ];
    const shape = new RAPIER.Cuboid(0.35, 0.9, 0.35);
    for (const off of candidates) {
      const px = car.position.x + off.x;
      const pz = car.position.z + off.z;
      const py = car.position.y + 1.0;
      const hit = this.world.intersectionWithShape(
        { x: px, y: py, z: pz },
        { x: 0, y: 0, z: 0, w: 1 },
        shape,
        this.filter,
        undefined,
        car.collider,
      );
      if (!hit) {
        this.mounted = null;
        car.speed = car.drift = car.yawRate = car.slipAngle = car.impact = 0;
        car.brakeLights.visible = false;
        this.drawingTracks = false;
        car.velocity.set(0, 0, 0);
        return new THREE.Vector3(px, car.position.y + 0.04, pz);
      }
    }
    return null;
  }

  updateVisibility(focus: THREE.Vector3) {
    for (const car of this.fleet) car.group.visible = car === this.mounted || car.position.distanceToSquared(focus) < 110 * 110;
  }

  paintHood(): void {
    if (this.mounted) this.mounted.hood.visible = true;
  }

  step(dt: number, input: DriveInput): void {
    for (const car of this.fleet) {
      car.previous.copy(car.position);
      if (car === this.mounted) {
        this.driveCar(car, dt, input);
      } else if (car.traffic) {
        this.driveTraffic(car, dt);
      } else continue;
      this.integrate(car, dt, car === this.mounted && input.brake);
    }
  }

  private driveCar(car: Car, dt: number, input: DriveInput): void {
    const throttle = THREE.MathUtils.clamp(input.throttle, -1, 1);
    const steer = THREE.MathUtils.clamp(input.steer, -1, 1);
    const handbrake = input.brake;

    if (!car.airborne) {
      if (throttle > 0) {
        car.speed += ACCEL * throttle * dt;
      } else if (throttle < 0) {
        if (car.speed > 0.5) car.speed += BRAKE * throttle * dt;
        else car.speed += ACCEL * 0.6 * throttle * dt;
      } else {
        car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), DRAG * dt * 4);
      }
      const drifting = handbrake && car.speed > 5 && Math.abs(steer) > 0.12;
      car.drift = THREE.MathUtils.damp(car.drift, drifting ? 1 : 0, drifting ? 12 : 1.45, dt);
      if (handbrake) {
        const drag = drifting ? 5 : BRAKE;
        car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), drag * dt);
      }
      car.speed = THREE.MathUtils.clamp(car.speed, -REVERSE_SPEED, MAX_SPEED);

      const speedFactor = Math.min(Math.abs(car.speed) / 6, 1);
      const roadTurn = THREE.MathUtils.lerp(2.6, 1.65, Math.abs(car.speed) / MAX_SPEED);
      const yaw = -steer * (roadTurn + car.drift * 1.75) * speedFactor * Math.sign(car.speed);
      car.yawRate = THREE.MathUtils.damp(car.yawRate, yaw, handbrake ? 11 : 15, dt);
      car.heading += car.yawRate * dt;
      car.lean = THREE.MathUtils.damp(car.lean, -steer * speedFactor * (0.10 + car.drift * 0.07), 6, dt);
      car.pitch = THREE.MathUtils.lerp(car.pitch, -throttle * 0.04, Math.min(1, dt * 5));
    } else {
      car.lean = THREE.MathUtils.lerp(car.lean, 0, Math.min(1, dt * 2));
      car.pitch = THREE.MathUtils.lerp(car.pitch, 0, Math.min(1, dt * 2));
    }
  }

  private driveTraffic(car: Car, dt: number): void {
    const target = TRAFFIC_CIRCUIT[car.waypoint];
    if (Math.hypot(car.position.x - target.x, car.position.z - target.z) < 2.4)
      car.waypoint = (car.waypoint + 1) % TRAFFIC_CIRCUIT.length;
    const next = TRAFFIC_CIRCUIT[car.waypoint];
    const desired = Math.atan2(car.position.x - next.x, car.position.z - next.z);
    const turn = Math.atan2(Math.sin(desired - car.heading), Math.cos(desired - car.heading));
    car.heading += THREE.MathUtils.clamp(turn, -2.8 * dt, 2.8 * dt);
    car.speed = THREE.MathUtils.damp(car.speed, Math.abs(turn) > 0.5 ? 4.5 : 8.2, 3, dt);
  }

  private integrate(car: Car, dt: number, brake: boolean): void {
    car.impact = 0;
    car.compression = THREE.MathUtils.damp(car.compression, 0, 15, dt);
    if (!car.airborne) {
      const targetHeading = car.heading + (car.speed < 0 ? Math.PI : 0);
      const hasMomentum = car.velocity.lengthSq() > 0.8 && Math.abs(car.speed) > 1;
      const travel = hasMomentum ? Math.atan2(-car.velocity.x, -car.velocity.z) : targetHeading;
      const offset = angleBetween(travel, targetHeading);
      // The tires recover progressively after release. Opposite lock brings the nose back across the path.
      const catching = car.drift > 0.1 && offset * car.yawRate < 0;
      const grip = SLIDING_GRIP + (ROAD_GRIP - SLIDING_GRIP) * (1 - car.drift) ** 2 + (catching ? 2.7 : 0);
      const next = travel + offset * (1 - Math.exp(-grip * dt));
      forwardOf(next, car.velocity).multiplyScalar(Math.abs(car.speed));
    }
    const dx = car.velocity.x * dt, dz = car.velocity.z * dt;
    const { x, y, z } = car.position;
    const surface = Math.abs(x) <= RAMP_HALF_WIDTH + HALF_W
      ? RAMP_CENTERS.find(center => Math.abs(z - center) <= RAMP_LENGTH / 2 + HALF_L)
      : undefined;
    const wasAirborne = car.airborne;
    if (surface !== undefined && !wasAirborne && y > 1 && car.velocity.z < -3 &&
        crossesRampLip(x, z, x + dx, z + dz, surface)) {
      car.vy = rampTakeoffSpeed(-car.velocity.z);
      car.airborne = true;
      car.launchRampZ = surface;
    }
    car.vy -= GRAVITY * dt;
    let rise = 0;
    const frontOffset = surface === undefined ? 0 :
      HALF_L * Math.abs(Math.cos(car.heading)) + HALF_W * Math.abs(Math.sin(car.heading));
    if (surface !== undefined && !car.airborne) {
      // Give the controller the rise under the front of its box. Pushing a level
      // box straight into the hill treats a clean ascent like a series of impacts.
      const front = z - frontOffset;
      rise = Math.max(0, rampHeight(rampProgress(front + dz, surface)) - rampHeight(rampProgress(front, surface)));
    }
    car.controller.computeColliderMovement(car.collider, { x: dx, y: car.vy * dt + rise, z: dz }, this.filter);
    const move = car.controller.computedMovement();
    car.position.x += move.x;
    car.position.y += move.y;
    car.position.z += move.z;
    // Rapier can omit a ground contact when the requested movement rises with the deck.
    const supportedOnRamp = !car.airborne && surface !== undefined && car.position.z > rampLip(surface) &&
      Math.abs(car.position.y - rampHeight(rampProgress(car.position.z - frontOffset, surface))) < 0.12;
    if ((car.controller.computedGrounded() || supportedOnRamp) && car.vy <= 0) {
      if (wasAirborne) {
        const dropSpeed = -car.vy;
        car.compression = Math.min(0.065, dropSpeed * 0.005);
        car.impact = Math.max(0, dropSpeed - (car.launchRampZ === null ? 3 : 9));
      }
      car.vy = -0.3;
      car.airborne = false;
      car.launchRampZ = null;
    } else if (car.vy < -2) {
      car.airborne = true;
    }
    const groundSpeed = Math.hypot(move.x, move.z) / dt;
    const lost = Math.hypot(dx - move.x, dz - move.z) / dt;
    if (lost > 1.5 && (surface === undefined || hitWall(car.controller))) {
      car.impact = Math.max(car.impact, lost);
      car.speed = Math.sign(car.speed) * Math.min(Math.abs(car.speed), groundSpeed);
      car.velocity.set(move.x / dt, 0, move.z / dt);
    }
    car.slipAngle = car.speed > 4 && groundSpeed > 4 && !car.airborne
      ? Math.abs(angleBetween(car.heading, Math.atan2(-move.x, -move.z))) : 0;
    this.syncBody(car);
    car.group.position.copy(car.position);
    if (car.airborne) {
      const arc = Math.atan2(car.vy, Math.max(6, Math.abs(car.speed))) * Math.sign(car.speed);
      car.pitch = THREE.MathUtils.damp(car.pitch, THREE.MathUtils.clamp(arc, -0.24, 0.38), 5, dt);
    } else if (surface !== undefined) {
      const wheelProgress = rampProgress(car.position.z, surface);
      const frontProgress = rampProgress(car.position.z - frontOffset, surface);
      car.group.position.y -= rampHeight(frontProgress) - rampHeight(wheelProgress);
      const slope = rampSlope(wheelProgress);
      car.pitch = THREE.MathUtils.damp(car.pitch, Math.atan(slope) * Math.cos(car.heading), 18, dt);
    }
    car.group.position.y -= car.compression;
    car.group.rotation.set(car.pitch, car.heading, car.lean, "YXZ");
    car.brakeLights.visible = brake;
    if (car === this.mounted) this.drawSkid(car, car.slipAngle > 0.20);
  }

  private drawSkid(car: Car, active: boolean) {
    if (active) {
      const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
      for (let wheel = 0; wheel < 2; wheel++) {
        const side = wheel === 0 ? -0.71 : 0.71;
        const point = this.tmpV.set(car.position.x + sin * 1.35 + cos * side, 0.11,
          car.position.z + cos * 1.35 - sin * side);
        const last = this.lastTracks[wheel];
        if (this.drawingTracks) {
          const dx = point.x - last.x, dz = point.z - last.z;
          const length = Math.hypot(dx, dz);
          if (length < 0.22) continue;
          this.trackPose.position.copy(point).lerp(last, 0.5);
          this.trackPose.rotation.y = Math.atan2(dx, dz);
          this.trackPose.scale.z = length + 0.025;
          this.trackPose.updateMatrix();
          this.tracks.setMatrixAt(this.trackCursor, this.trackPose.matrix);
          this.trackCursor = (this.trackCursor + 1) % this.tracks.instanceMatrix.count;
          this.tracks.count = Math.min(this.tracks.count + 1, this.tracks.instanceMatrix.count);
          this.tracks.instanceMatrix.needsUpdate = true;
        }
        last.copy(point);
      }
    }
    this.drawingTracks = active;
  }

  updateCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    const car = this.mounted;
    if (!car) return;
    let viewHeading = car.heading;
    if (car.speed > 4 && car.velocity.lengthSq() > 16) {
      const travel = Math.atan2(-car.velocity.x, -car.velocity.z);
      viewHeading += angleBetween(car.heading, travel) * 0.74;
    }
    const fwd = forwardOf(viewHeading, this.tmpV);
    const speedPull = THREE.MathUtils.clamp(Math.abs(car.speed) / MAX_SPEED, 0, 1);
    const dist = 7 + speedPull * 3.5;
    const height = 3.2 + speedPull * 0.6;
    const desired = new THREE.Vector3(
      car.position.x - fwd.x * dist,
      car.position.y + height,
      car.position.z - fwd.z * dist,
    );

    // Obstacle clip: raycast from car to desired.
    const origin = new THREE.Vector3(car.position.x, car.position.y + 1.2, car.position.z);
    const dir = desired.clone().sub(origin);
    const len = dir.length();
    if (len > 0.01) {
      dir.normalize();
      const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
      const hit = this.world.castRay(ray, len, true, this.filter, undefined, car.collider);
      if (hit) {
        const t = Math.max(0.2, hit.timeOfImpact - 0.4);
        desired.copy(origin).addScaledVector(dir, t);
      }
    }

    const k = Math.min(1, dt * 6);
    if (this.cameraCut) { this.camPos.copy(desired); this.camLook.copy(car.position); }
    this.camPos.lerp(desired, k);
    camera.position.copy(this.camPos);
    this.camLook.lerp(
      new THREE.Vector3(car.position.x + fwd.x * 3, car.position.y + 1.2, car.position.z + fwd.z * 3),
      Math.min(1, dt * 8),
    );
    camera.lookAt(this.camLook);
    this.cameraCut = false;
  }
}
