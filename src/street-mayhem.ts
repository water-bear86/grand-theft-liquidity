import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Assets, makeAvatar, animateAvatar, box, label, type Avatar } from "./assets.ts";
import type { Car } from "./vehicles.ts";

export type Weapon = "pistol" | "scattergun";
export type HitCause = "car" | "shot";

interface Ped {
  id: string;
  avatar: Avatar;
  home: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  heading: number;
  spin: THREE.Vector3;
  airborne: boolean;
  dead: boolean;
  crossing: boolean;
  crossDir: number;
  initialDir: number;
  bumpCooldown: number;
  fleeTimer: number;
  radius: number;
  height: number;
}

interface Prop {
  mesh: THREE.Object3D;
  home: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  radius: number;
}

interface Stain {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

interface Effect {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  kind: "blood" | "spark" | "tracer" | "flash";
}

const GRAVITY = -22;
const KILL_SPEED = 7;
const CROSSERS = 9;
const MAX_PROPS = 8;
const MAX_STAINS = 24;
const MAX_EFFECTS = 48;
const CULL_DIST = 65;

function sandwichBoard(copy: string) {
  const group = new THREE.Group();
  const front = box(0.85, 1.1, 0.085, "#f1c694", 0, 0.59, 0.15);
  front.rotation.x = -0.23;
  const back = box(0.85, 1.1, 0.075, "#507573", 0, 0.59, -0.15);
  back.rotation.x = 0.23;
  const print = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.42),
    new THREE.MeshBasicMaterial({ map: label(copy, "#204542", "#fff0bb", 256, 96, "sign") }));
  print.position.set(0, 0.09, 0.047);
  front.add(print);
  group.add(front, back);
  return group;
}

// Keep each animated joint, but draw its rigid clothing and skin in one batch.
function batchPedestrian(avatar: Avatar, material: THREE.MeshStandardMaterial) {
  for (const pivot of [avatar.group, ...avatar.arms, ...avatar.legs]) {
    const pieces = pivot.children.filter((child): child is THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> =>
      child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial && !child.material.map);
    if (pieces.length < 2) continue;
    const parts = pieces.map(piece => {
      piece.updateMatrix();
      const geo = piece.geometry.index ? piece.geometry.toNonIndexed() : piece.geometry.clone();
      geo.applyMatrix4(piece.matrix);
      geo.deleteAttribute("uv");
      const count = geo.getAttribute("position").count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) piece.material.color.toArray(colors, i * 3);
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      return geo;
    });
    const merged = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    if (!merged) continue;
    pivot.remove(...pieces);
    const skin = new THREE.Mesh(merged, material);
    skin.castShadow = pivot === avatar.group;
    skin.receiveShadow = true;
    pivot.add(skin);
  }
}

/** The gun points along local +Z so the visible barrel follows the same aim as the shot. */
export function makeGun(weapon: Weapon) {
  const gun = new THREE.Group();
  const long = weapon === "scattergun";
  const finish = long ? "#395963" : "#445158";
  gun.add(box(long ? 0.18 : 0.115, 0.13, long ? 0.52 : 0.27, finish, 0, 0.025, 0.13));
  const grip = box(0.095, 0.22, 0.11, "#96583c", 0, -0.085, 0.015);
  grip.rotation.x = -0.22;
  gun.add(grip);
  if (long) {
    for (const side of [-1,1])
      gun.add(box(0.065, 0.075, 0.46, "#28343b", side*0.042, 0.057, 0.43));
    gun.add(box(0.15, 0.095, 0.22, "#c8814a", 0, -0.06, 0.27));
    gun.add(box(0.12, 0.15, 0.23, "#a56744", 0, -0.035, -0.15));
  } else gun.add(box(0.07, 0.07, 0.09, "#252e35", 0, 0.047, 0.292));
  gun.visible = false;
  return gun;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class StreetMayhem {
  private onKill: (id: string, cause: HitCause) => void;
  private peds: Ped[] = [];
  private props: Prop[] = [];
  private stains: Stain[] = [];
  private effects: Effect[] = [];
  private stainIdx = 0;
  private effectIdx = 0;
  private rand = mulberry(0x5eed);
  private time = 0;
  private bloodMat: THREE.MeshBasicMaterial;
  private poolMat: THREE.MeshBasicMaterial;
  private sparkMat: THREE.MeshBasicMaterial;
  private tracerMat: THREE.MeshBasicMaterial;
  private flashMat: THREE.MeshBasicMaterial;
  private tmpA = new THREE.Vector3();
  private readonly droplet = new THREE.SphereGeometry(0.13, 6, 4);
  private readonly tracer = new THREE.BoxGeometry(0.035, 0.035, 1);

  constructor(scene: THREE.Scene, assets: Assets, crowds: Avatar[], onKill: (id: string, cause: HitCause) => void) {
    this.onKill = onKill;
    this.bloodMat = new THREE.MeshBasicMaterial({ color: 0xb41836 });
    this.poolMat = new THREE.MeshBasicMaterial({ color: 0x80162b, transparent: true, opacity: 0.91, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xfff2a0 });
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });

    const shirts = ["#ea7464", "#4e9aaa", "#f0bc62", "#bd82bb"];
    const skin = ["#bb795e", "#d6a475", "#885e50"];
    const clothing = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    for (let i = 0; i < CROSSERS + crowds.length; i++) {
      const crossing = i < CROSSERS;
      const av = crossing ? makeAvatar(shirts[i % shirts.length], skin[i % skin.length]) : crowds[i - CROSSERS];
      batchPedestrian(av, clothing);
      if (crossing) scene.add(av.group);
      const home = crossing
        ? new THREE.Vector3(-7.5 + this.rand() * 15, 0.07, -11 - i * 36)
        : av.group.position.clone();
      if (i === 0) home.set(-2, 0.07, -11);
      const ped: Ped = {
        id: "ped" + i,
        avatar: av,
        home: home.clone(),
        pos: home.clone(),
        vel: new THREE.Vector3(),
        heading: this.rand() * Math.PI * 2,
        spin: new THREE.Vector3(),
        airborne: false,
        dead: false,
        crossing,
        crossDir: i % 2 === 0 ? -1 : 1,
        initialDir: i % 2 === 0 ? -1 : 1,
        bumpCooldown: 0,
        fleeTimer: 0,
        radius: 0.55,
        height: 1.9,
      };
      this.peds.push(ped);
    }

    const propSpots: [number, number, number][] = [
      [-4, 0, -12], [4.5, 0, -30], [-5, 0, -55], [5, 0, -80],
      [-4.5, 0, -120], [4, 0, -160], [-5, 0, -210], [5, 0, -260],
    ];
    for (let i = 0; i < MAX_PROPS; i++) {
      const spot = propSpots[i];
      const mesh = i % 2 === 0 ? assets.create("bin", 1.1) : sandwichBoard(i % 4 === 1 ? "BUY THE DIP" : "EXIT HERE");
      mesh.position.set(spot[0], spot[1], spot[2]);
      scene.add(mesh);
      this.props.push({
        mesh,
        home: new THREE.Vector3(spot[0], spot[1], spot[2]),
        pos: new THREE.Vector3(spot[0], spot[1], spot[2]),
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        rot: new THREE.Euler(),
        radius: 0.5,
      });
    }

    const outline = new THREE.Shape();
    for (let point = 0; point < 33; point++) {
      const a = point * Math.PI / 16;
      const radius = 0.8 + 0.18 * Math.cos(5*a) + 0.20 * Math.sin(3*a) + 0.13 * Math.sin(8*a);
      const x = Math.cos(a) * radius, y = Math.sin(a) * radius * 0.7;
      if (point === 0) outline.moveTo(x,y); else outline.lineTo(x,y);
    }
    const geo = new THREE.ShapeGeometry(outline);
    for (let i = 0; i < MAX_STAINS; i++) {
      const mesh = new THREE.Mesh(geo, this.poolMat.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.stains.push({ mesh, life: 0, maxLife: 1 });
    }

    for (let i = 0; i < MAX_EFFECTS; i++) {
      const mesh = new THREE.Mesh(this.droplet, this.bloodMat);
      mesh.visible = false;
      scene.add(mesh);
      this.effects.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 1, kind: "blood" });
    }
    this.reset();
  }

  reset(): void {
    this.time = this.stainIdx = this.effectIdx = 0;
    this.rand = mulberry(0x6619);
    for (const p of this.peds) {
      p.pos.copy(p.home);
      p.vel.set(0, 0, 0);
      p.spin.set(0, 0, 0);
      p.airborne = false;
      p.dead = false;
      p.crossDir = p.initialDir;
      p.heading = p.crossing ? p.crossDir * Math.PI / 2 : 0;
      p.bumpCooldown = 0;
      p.fleeTimer = 0;
      p.avatar.group.position.copy(p.home);
      p.avatar.group.rotation.set(0, p.heading, 0);
      p.avatar.group.visible = Math.abs(p.home.z - 4) < CULL_DIST;
      for (const arm of p.avatar.arms) arm.rotation.z = 0;
      animateAvatar(p.avatar, 0, 0);
      if (!p.crossing) p.avatar.arms[1].rotation.x = -1.5;
    }
    for (const pr of this.props) {
      pr.pos.copy(pr.home);
      pr.vel.set(0, 0, 0);
      pr.spin.set(0, 0, 0);
      pr.rot.set(0, 0, 0);
      pr.mesh.position.copy(pr.home);
      pr.mesh.rotation.set(0, 0, 0);
      pr.mesh.visible = Math.abs(pr.home.z - 4) < CULL_DIST;
    }
    for (const s of this.stains) { s.life = 0; s.mesh.visible = false; }
    for (const e of this.effects) { e.life = 0; e.mesh.visible = false; }
  }

  step(dt: number, focus: THREE.Vector3, car: Car | null): void {
    this.time += dt;
    const carSpeed = car ? Math.abs(car.speed) : 0;
    for (const p of this.peds) this.stepPed(p, dt, focus, car, carSpeed);
    for (const pr of this.props) this.stepProp(pr, dt, focus, car);
    this.stepStains(dt);
    this.stepEffects(dt);
  }

  private stepPed(p: Ped, dt: number, focus: THREE.Vector3, car: Car | null, carSpeed: number): void {
    if (p.bumpCooldown > 0) p.bumpCooldown -= dt;
    if (p.fleeTimer > 0) p.fleeTimer -= dt;
    const dist = p.pos.distanceTo(focus);
    const visible = dist < CULL_DIST;
    p.avatar.group.visible = visible;
    if (!visible) return;

    if (p.dead) {
      if (p.airborne) {
        p.vel.y += GRAVITY * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.avatar.group.rotation.x += p.spin.x * dt;
        p.avatar.group.rotation.y += p.spin.y * dt;
        p.avatar.group.rotation.z += p.spin.z * dt;
        if (p.pos.y <= 0.35) {
          p.pos.y = 0.35;
          p.vel.y *= -0.35;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
          p.spin.multiplyScalar(0.5);
          if (Math.abs(p.vel.y) < 1.2) {
            p.airborne = false;
            p.vel.set(0, 0, 0);
            p.avatar.group.rotation.set(Math.PI / 2, p.avatar.group.rotation.y, 0);
            p.pos.y = 0.35;
            this.spawnStain(p.pos);
          }
        }
      }
      p.avatar.group.position.copy(p.pos);
      return;
    }

    const approaching = car && carSpeed > 5 && p.pos.distanceToSquared(car.position) < 30;
    if (approaching && p.bumpCooldown <= 0) p.fleeTimer = 0.55;
    if (p.fleeTimer > 0) {
      this.tmpA.copy(p.pos).sub(focus).setY(0);
      if (this.tmpA.lengthSq() < 0.01) this.tmpA.set(p.initialDir, 0, 0);
      this.tmpA.normalize();
      p.pos.addScaledVector(this.tmpA, 3.2 * dt);
      p.heading = Math.atan2(this.tmpA.x, this.tmpA.z);
    } else if (p.crossing) {
      p.pos.x += p.crossDir * 1.1 * dt;
      if (p.pos.x > 8) { p.crossDir = -1; p.pos.x = 8; }
      if (p.pos.x < -8) { p.crossDir = 1; p.pos.x = -8; }
      p.heading = p.crossDir * Math.PI / 2;
    } else {
      p.pos.lerp(p.home, 1 - Math.exp(-dt * 0.55));
      p.heading = Math.atan2(focus.x - p.pos.x, focus.z - p.pos.z);
    }
    p.avatar.group.position.copy(p.pos);
    p.avatar.group.rotation.set(0, p.heading, 0);
    animateAvatar(p.avatar, this.time + p.home.z, p.fleeTimer > 0 ? 8 : p.crossing ? 3 : 0);
    if (!p.crossing && p.fleeTimer <= 0) p.avatar.arms[1].rotation.x = -1.5;

    if (car && carSpeed > 0.5) this.checkCarHit(p, car, carSpeed);
  }

  private checkCarHit(p: Ped, car: Car, carSpeed: number): void {
    const prev = car.previous;
    const cur = car.position;
    const fwdX = -Math.sin(car.heading);
    const fwdZ = -Math.cos(car.heading);
    const segX = cur.x - prev.x;
    const segZ = cur.z - prev.z;
    const segLen2 = segX * segX + segZ * segZ;
    let t = 0;
    if (segLen2 > 1e-6) {
      t = clamp(((p.pos.x - prev.x) * segX + (p.pos.z - prev.z) * segZ) / segLen2, 0, 1);
    }
    const cx = prev.x + segX * t;
    const cz = prev.z + segZ * t;
    const dx = p.pos.x - cx;
    const dz = p.pos.z - cz;
    const along = dx * fwdX + dz * fwdZ;
    const lateral = Math.abs(dx * fwdZ - dz * fwdX);
    if (Math.abs(p.pos.y - (prev.y + (cur.y-prev.y)*t)) > 1.55) return;
    const bumper = 1.9;
    if (Math.abs(along) < bumper + p.radius && lateral < 0.95 + p.radius) {
      if (carSpeed >= KILL_SPEED) {
        const sign = Math.sign(car.speed);
        this.killPed(p, "car", carSpeed, fwdX*sign, fwdZ*sign);
      } else if (p.bumpCooldown <= 0) {
        p.bumpCooldown = 1.2;
        p.fleeTimer = 2.5;
        const side = Math.sign(dx * -fwdZ + dz * fwdX) || p.initialDir;
        p.pos.x -= fwdZ * side * 0.55;
        p.pos.z += fwdX * side * 0.55;
      }
    }
  }

  private killPed(p: Ped, cause: HitCause, speed: number, dx: number, dz: number): void {
    if (p.dead) return;
    p.dead = true;
    p.airborne = true;
    p.pos.y = Math.max(p.pos.y, 0.6);
    const power = clamp(speed * 0.6, 3, 12);
    p.vel.set(dx * power * 0.9 + (this.rand() - 0.5) * 3, power + 2.8, dz * power * 0.9 + (this.rand() - 0.5) * 3);
    p.avatar.arms[0].rotation.z = -1; p.avatar.arms[1].rotation.z = 1.1;
    p.avatar.legs[0].rotation.x = 0.7; p.avatar.legs[1].rotation.x = -0.55;
    p.spin.set((this.rand() - 0.5) * 8, (this.rand() - 0.5) * 6, (this.rand() - 0.5) * 8);
    this.spawnBloodBurst(p.pos, 11);
    this.spawnStain(p.pos);
    this.onKill(p.id, cause);
  }

  private stepProp(pr: Prop, dt: number, focus: THREE.Vector3, car: Car | null): void {
    const dist = pr.pos.distanceTo(focus);
    pr.mesh.visible = dist < CULL_DIST;
    if (dist >= CULL_DIST) return;

    if (car) {
      const dx = pr.pos.x - car.position.x;
      const dz = pr.pos.z - car.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.25 && Math.abs(car.position.y - pr.pos.y) < 1.4 && Math.abs(car.speed) > 1) {
        const fwdX = -Math.sin(car.heading);
        const fwdZ = -Math.cos(car.heading);
        pr.vel.set(fwdX * car.speed * 0.95 + dx * 2, 5 + Math.abs(car.speed) * 0.44, fwdZ * car.speed * 0.95 + dz * 2);
        pr.spin.set((this.rand() - 0.5) * 10, (this.rand() - 0.5) * 10, (this.rand() - 0.5) * 10);
      }
    }

    if (pr.vel.lengthSq() > 0.01 || pr.pos.y > 0.01) {
      pr.vel.y += GRAVITY * dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.rot.x += pr.spin.x * dt;
      pr.rot.y += pr.spin.y * dt;
      pr.rot.z += pr.spin.z * dt;
      if (pr.pos.y <= 0) {
        pr.pos.y = 0;
        pr.vel.y *= -0.4;
        pr.vel.x *= 0.7;
        pr.vel.z *= 0.7;
        pr.spin.multiplyScalar(0.6);
        if (pr.vel.lengthSq() < 0.2) {
          pr.vel.set(0, 0, 0);
          pr.spin.set(0, 0, 0);
          pr.rot.x = 0;
          pr.rot.z = 0;
        }
      }
      pr.mesh.position.copy(pr.pos);
      pr.mesh.rotation.copy(pr.rot);
    }
  }

  shoot(origin: THREE.Vector3, direction: THREE.Vector3, weapon: Weapon, wallDistance: (direction: THREE.Vector3, maxDistance: number) => number): void {
    const dir = direction.clone().normalize();
    const pellets = weapon === "scattergun" ? 6 : 1;
    const spread = weapon === "scattergun" ? 0.09 : 0.01;
    const maxDist = 60;
    const hitThisShot = new Set<Ped>();
    this.spawnFlash(origin, dir);
    for (let i = 0; i < pellets; i++) {
      const d = dir.clone();
      if (pellets > 1) {
        d.x += (this.rand() - 0.5) * spread;
        d.y += (this.rand() - 0.5) * spread;
        d.z += (this.rand() - 0.5) * spread;
        d.normalize();
      }
      let bestT = Math.min(wallDistance(d, maxDist), maxDist);
      let prop: Prop | null = null;
      let bestPed: Ped | null = null;
      for (const p of this.peds) {
        if (p.dead && !hitThisShot.has(p)) continue;
        const t = this.raySphere(origin, d, p.pos, p.radius + 0.55, p.height);
        if (t >= 0 && t < bestT) { bestT = t; bestPed = p; }
      }
      for (const pr of this.props) {
        const t = this.raySphere(origin, d, pr.pos, pr.radius + 0.2, 1);
        if (t >= 0 && t < bestT) {
          bestT = t;
          bestPed = null;
          prop = pr;
        }
      }
      const hitPoint = origin.clone().addScaledVector(d, bestT);
      this.spawnTracer(origin, hitPoint);
      if (bestPed) {
        hitThisShot.add(bestPed);
        this.killPed(bestPed, "shot", 9, d.x, d.z);
      } else if (prop) {
        prop.vel.set(d.x * 9, 5, d.z * 9);
        prop.spin.set(5, 8, -3);
        this.spawnSpark(hitPoint);
      } else if (bestT < maxDist) this.spawnSpark(hitPoint);
    }
    for (const p of this.peds)
      if (!p.dead && p.pos.distanceToSquared(origin) < 92) p.fleeTimer = 1.25;
  }

  private raySphere(origin: THREE.Vector3, dir: THREE.Vector3, center: THREE.Vector3, radius: number, height: number): number {
    const cy = center.y + height * 0.5;
    const ox = origin.x - center.x;
    const oy = origin.y - cy;
    const oz = origin.z - center.z;
    const b = ox * dir.x + oy * dir.y + oz * dir.z;
    const c = ox * ox + oy * oy + oz * oz - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return c <= 0 ? 0 : t > 0 ? t : -1;
  }

  private spawnBloodBurst(pos: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const e = this.nextEffect();
      if (!e) return;
      e.kind = "blood";
      e.mesh.material = this.bloodMat;
      e.mesh.visible = true;
      e.mesh.position.copy(pos);
      e.mesh.scale.setScalar(0.6 + this.rand() * 0.8);
      e.vel.set((this.rand() - 0.5) * 6, 2 + this.rand() * 5, (this.rand() - 0.5) * 6);
      e.life = e.maxLife = 0.6 + this.rand() * 0.4;
    }
  }

  private spawnSpark(pos: THREE.Vector3): void {
    const e = this.nextEffect();
    if (!e) return;
    e.kind = "spark";
    e.mesh.material = this.sparkMat;
    e.mesh.visible = true;
    e.mesh.position.copy(pos);
    e.mesh.scale.setScalar(0.5);
    e.vel.set((this.rand() - 0.5) * 3, 1 + this.rand() * 2, (this.rand() - 0.5) * 3);
    e.life = e.maxLife = 0.25;
  }

  private spawnFlash(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const e = this.nextEffect();
    if (!e) return;
    e.kind = "flash";
    e.mesh.material = this.flashMat;
    e.mesh.visible = true;
    e.mesh.position.copy(origin).addScaledVector(dir, 0.4);
    e.mesh.scale.setScalar(1.4);
    e.vel.set(0, 0, 0);
    e.life = e.maxLife = 0.16;
  }

  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const e = this.nextEffect();
    if (!e) return;
    e.kind = "tracer";
    e.mesh.geometry = this.tracer;
    e.mesh.material = this.tracerMat;
    e.mesh.visible = true;
    const mid = from.clone().add(to).multiplyScalar(0.5);
    e.mesh.position.copy(mid);
    const len = from.distanceTo(to);
    e.mesh.scale.set(1, 1, Math.max(0.1, len));
    e.mesh.lookAt(to);
    e.vel.set(0, 0, 0);
    e.life = e.maxLife = 0.18;
  }

  private spawnStain(pos: THREE.Vector3): void {
    const s = this.stains[this.stainIdx];
    this.stainIdx = (this.stainIdx + 1) % MAX_STAINS;
    s.mesh.visible = true;
    s.mesh.position.set(pos.x, 0.11 + this.stainIdx * 0.0003, pos.z);
    s.mesh.rotation.set(-Math.PI / 2, 0, this.rand() * Math.PI);
    s.mesh.scale.setScalar(0.8 + this.rand() * 0.8);
    s.life = s.maxLife = 18 + this.rand() * 10;
  }

  private nextEffect(): Effect | null {
    for (let i = 0; i < MAX_EFFECTS; i++) {
      const e = this.effects[(this.effectIdx + i) % MAX_EFFECTS];
      if (e.life <= 0) {
        this.effectIdx = (this.effectIdx + i + 1) % MAX_EFFECTS;
        e.mesh.geometry = this.droplet;
        e.mesh.rotation.set(0,0,0);
        return e;
      }
    }
    return null;
  }

  private stepEffects(dt: number): void {
    for (const e of this.effects) {
      if (e.life <= 0) { e.mesh.visible = false; continue; }
      e.life -= dt;
      if (e.life <= 0) { e.mesh.visible = false; continue; }
      if (e.kind === "blood" || e.kind === "spark") {
        e.vel.y += GRAVITY * dt;
        e.mesh.position.addScaledVector(e.vel, dt);
        if (e.mesh.position.y < 0.05) {
          e.mesh.position.y = 0.05;
          e.vel.set(0, 0, 0);
        }
      }
      if (e.kind === "tracer") continue;
      const k = e.life / e.maxLife;
      e.mesh.scale.setScalar(Math.max(0.05, k * (e.kind === "flash" ? 1.5 : 1.2)));
    }
  }

  private stepStains(dt: number): void {
    for (const s of this.stains) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.91 * Math.min(1, s.life / 2.5);
    }
  }
}
