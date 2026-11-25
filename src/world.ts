import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  Assets,
  CLUB_SIGN,
  box,
  mat,
  label,
  makeAvatar,
  type Avatar,
} from "./assets.ts";
import { ROUTE_STOPS, TASKS } from "./content.ts";
import { HOT_DOG_COUNT, VALET_BAY, PRESS_GATES, PRESS_BAY, type DrivingJobs, type JobPoint } from "./driving-jobs.ts";

import { createBagWorkerDistrict, type BagWorkerDistrict } from "./bagworker-world.ts";
import { RAMP_CENTERS, RAMP_LENGTH, RAMP_HALF_WIDTH, rampHeight, rampSlope, rampMeshData } from "./ramps.ts";

export interface City {
  bagworker: BagWorkerDistrict;
  obstacles: THREE.Object3D[];
  markers: THREE.Group[];
  pickups: THREE.Group[];
  jumps: THREE.Mesh[];
  buyers: Avatar[];
  crowds: Avatar[];
  sign: THREE.Mesh;
  auditDrum: THREE.Group;
  water: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  props: THREE.Group[];
}
export const PICKUPS = [
  { x: 0, z: -53 },
  { x: 13, z: ROUTE_STOPS.boardwalk.z - 8 },
  { x: -4, z: -142 },
  { x: 14.5, z: ROUTE_STOPS.apology.z - 10 },
  { x: 0, z: -225 },
  { x: 0, z: -274 },
  { x: 5, z: -320 },
];
export const JUMPS = [
  { x: 0, z: -47 },
  { x: 0, z: -96 },
  { x: 0, z: -139 },
  { x: 0, z: -185 },
  { x: 0, z: -229 },
  { x: 0, z: -270 },
  { x: 0, z: -317 },
];
export const BIN_LANDING_RADIUS = 1.5;
export const HOTDOG_VENDOR = ROUTE_STOPS.hotdog;

function asphaltTexture(length: number) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(0, 0, size, size);
  let seed = 31928;
  const sample = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < 4300; i++) {
    ctx.fillStyle = i % 3 ? "#7a808919" : "#ffffff9a";
    ctx.fillRect(
      Math.floor(sample() * size),
      Math.floor(sample() * size),
      1 + Math.floor(sample() * 2),
      1,
    );
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, length / 3);
  texture.anisotropy = 4;
  return texture;
}

export function createPressShoot(scene: THREE.Scene) {
  const mint = "#d7ef96", coral = "#ff8f76", ink = "#263844";
  function placard(text: string) {
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({
      map: label(text, ink, mint, 512, 128, "marker"), transparent: true, depthWrite: false,
    }));
    sign.position.y = 4;
    sign.scale.set(3.6, 0.90, 1);
    return sign;
  }
  function cameraStand(side: number) {
    const rig = new THREE.Group();
    rig.add(box(0.07, 1.4, 0.07, ink, 0, 0.75, 0), box(0.55, 0.34, 0.39, ink, 0, 1.5, 0),
      box(0.19, 0.22, 0.24, "#728998", -side * 0.34, 1.5, 0), box(0.09, 0.08, 0.04, coral, 0.14, 1.55, 0.22));
    for (const dir of [-1, 1]) {
      const foot = box(0.065, 0.87, 0.065, ink, dir * 0.18, 0.39, 0);
      foot.rotation.z = dir * 0.40;
      rig.add(foot);
    }
    return rig;
  }
  const gates = PRESS_GATES.map((point, i) => {
    const gate = new THREE.Group();
    for (const side of [-1, 1]) {
      gate.add(box(0.12, 2.7, 0.14, coral, side * point.halfWidth, 1.35, 0));
      const flag = box(0.44, 0.85, 0.055, mint, side * (point.halfWidth - 0.22), 2.22, 0);
      gate.add(flag);
    }
    gate.add(box(point.halfWidth * 2, 0.025, 0.14, mint, 0, 0.115, 0), placard("CAM " + (i + 1)));
    const side = i === 0 ? -1 : 1, camera = cameraStand(side);
    camera.position.x = side * (point.halfWidth + 0.5);
    gate.add(camera);
    gate.position.set(point.x, 0, point.z);
    return gate;
  });
  const bay = new THREE.Group();
  for (const side of [-1, 1]) {
    bay.add(box(0.18, 0.025, PRESS_BAY.halfLength * 2, coral, side * PRESS_BAY.halfWidth, 0.12, 0),
      box(PRESS_BAY.halfWidth * 2, 0.025, 0.18, coral, 0, 0.12, side * PRESS_BAY.halfLength));
  }
  for (let x = -5; x <= 5; x += 2) {
    const stripe = box(0.36, 0.025, 2.2, mint, x, 0.12, 4.8);
    stripe.rotation.y = -0.55;
    bay.add(stripe);
  }
  const pressCamera = cameraStand(1);
  pressCamera.position.x = PRESS_BAY.halfWidth + 1.2;
  bay.add(pressCamera, placard("PRESS BAY"));
  bay.position.set(PRESS_BAY.x, 0, PRESS_BAY.z);
  const carSign = placard("PRESS CAR");
  scene.add(...gates, bay, carSign);
  gates.forEach(gate => { gate.visible = false; });
  bay.visible = carSign.visible = false;
  return (stage: number | null, parkedCar?: JobPoint) => {
    gates.forEach((gate, i) => { gate.visible = stage === i && !parkedCar; });
    bay.visible = stage === gates.length && !parkedCar;
    carSign.visible = stage !== null && !!parkedCar;
    if (parkedCar) carSign.position.set(parkedCar.x, 2.65, parkedCar.z);
  };
}

export function createDrivingJobProps(scene: THREE.Scene) {
  const mint = "#cbf093", coral = "#ff977b", ink = "#293c43";
  const marker = new THREE.Group(), arch = new THREE.Group(), bay = new THREE.Group();
  marker.name = "Car radio waypoint";
  bay.name = "VIP valet bay";
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 64), new THREE.MeshBasicMaterial({ color: mint }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.13;
  marker.add(ring);
  const signs = ["SLIDE HERE", "HOT DOG PICKUP", "CLUB DELIVERY", "TAKEOFF", "VIP VALET", "YOUR CAR"].map(copy =>
    new THREE.SpriteMaterial({ map: label(copy, ink, mint, 512, 128, "marker"), transparent: true, depthWrite: false }));
  const placard = new THREE.Sprite(signs[0]);
  placard.position.y = 4.6;
  placard.scale.set(4.6, 1.15, 1);
  marker.add(placard);

  for (const side of [-1, 1]) {
    arch.add(box(0.16, 4.6, 0.18, mint, side * 3.2, 2.3, 0));
    bay.add(box(0.18, 0.035, 2 * VALET_BAY.halfLength, coral, side * VALET_BAY.halfWidth, 0.10, 0),
      box(2 * VALET_BAY.halfWidth, 0.035, 0.18, coral, 0, 0.10, side * VALET_BAY.halfLength));
  }
  arch.add(box(6.55, 0.2, 0.2, mint, 0, 4.65, 0));
  for (let x = -4; x <= 4; x += 2) {
    const stripe = box(0.45, 0.035, 1.65, "#ffdda0", x, 0.10, 5.9);
    stripe.rotation.y = -0.5;
    bay.add(stripe);
  }
  bay.position.set(VALET_BAY.x, 0, VALET_BAY.z);
  marker.visible = arch.visible = bay.visible = false;
  scene.add(marker, arch, bay);

  const rack = new THREE.Group();
  rack.name = "Hot dog roof rack";
  rack.add(box(1.98, 0.1, 1.6, ink, 0, 1.71, 0.45));
  for (const x of [-0.89, 0.89]) {
    rack.add(box(0.08, 0.14, 1.65, coral, x, 1.8, 0.45));
    for (const z of [-0.24, 1.15]) rack.add(box(0.07, 0.95, 0.07, ink, x, 1.23, z));
  }
  const dogShape = new THREE.CapsuleGeometry(1, 1, 3, 8);
  const bun = mat("#e9ae58"), sausage = mat("#a54332"), mustard = mat("#ffd74b");
  const dogs = Array.from({ length: HOT_DOG_COUNT }, (_, i) => {
    const dog = new THREE.Group();
    for (const [side, material] of [[-1, bun], [0, sausage], [1, bun]] as const) {
      const roll = new THREE.Mesh(dogShape, material);
      roll.rotation.z = Math.PI / 2;
      roll.position.set(0, side === 0 ? 0.095 : 0.065, side * 0.079);
      roll.scale.set(0.095, side === 0 ? 0.27 : 0.24, 0.085);
      dog.add(roll);
    }
    const stripe = new THREE.Mesh(dogShape, mustard);
    stripe.rotation.z = Math.PI / 2;
    stripe.position.y = 0.19;
    stripe.scale.set(0.018, 0.19, 0.024);
    dog.add(stripe);
    dog.position.set((i % 2 - 0.5) * 0.88, 1.78, (Math.floor(i / 2) - 1) * 0.46 + 0.45);
    rack.add(dog);
    return dog;
  });

  const spills = dogs.map(dog => {
    const mesh = dog.clone();
    mesh.name = "Spilled hot dog";
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, start: new THREE.Vector3(), velocity: new THREE.Vector3(), time: 0, spin: 0, yaw: 0 };
  });
  let spillIndex = 0;
  const up = new THREE.Vector3(0, 1, 0);
  function spill(car: THREE.Group, velocity: THREE.Vector3, remaining: number, lost: number, now: number) {
    for (let i = remaining; i < remaining + lost; i++) {
      const item = spills[spillIndex++ % spills.length];
      car.localToWorld(item.start.copy(dogs[i].position));
      item.yaw = car.rotation.y;
      item.spin = i % 2 ? 1 : -1;
      item.velocity.set(item.spin * 3.3, 3.5 + i * 0.19, 1.6).applyAxisAngle(up, item.yaw).addScaledVector(velocity, 0.5);
      item.time = now;
      item.mesh.visible = true;
    }
  }
  function animateSpills(now: number) {
    for (const item of spills) {
      if (!item.mesh.visible) continue;
      const t = now - item.time;
      if (t < 0 || t > 1.6) { item.mesh.visible = false; continue; }
      item.mesh.position.copy(item.start).addScaledVector(item.velocity, t);
      const y = item.mesh.position.y - 9.8 * t * t;
      item.mesh.position.y = Math.max(0.14, y);
      item.mesh.rotation.set(item.spin * Math.min(1, t) * 6, item.yaw + t * 3, 0);
    }
  }
  function update(jobs: DrivingJobs, assigned: THREE.Group | undefined, inAssigned: boolean, visible: boolean) {
    if (jobs.cargo > 0 && assigned) {
      if (rack.parent !== assigned) assigned.add(rack);
      dogs.forEach((dog, i) => { dog.visible = i < jobs.cargo; });
    } else if (rack.parent) rack.removeFromParent();
    const point = inAssigned ? jobs.target : assigned?.position;
    marker.visible = visible && !!jobs.active && !!point;
    arch.visible = bay.visible = marker.visible && inAssigned && jobs.active === "ramp";
    if (!marker.visible || !point) return;
    marker.position.set(point.x, 0, point.z);
    const sign = !inAssigned ? 5 : jobs.active === "drift" ? 0
      : jobs.active === "delivery" ? 1 + jobs.stage : 3 + jobs.stage;
    placard.material = signs[sign];
    const radius = inAssigned ? jobs.markerRadius : 2.4;
    ring.scale.setScalar(radius);
    ring.visible = !(inAssigned && jobs.active === "ramp");
    if (arch.visible && jobs.stage === 0) arch.position.set(point.x, 0, point.z);
    placard.position.y = arch.visible && jobs.stage === 0 ? 5.65 : 4.6;
  }
  return { update, spill, animateSpills };
}

export function createCity(
  scene: THREE.Scene,
  physics: RAPIER.World,
  assets: Assets,
): City {
  const obstacles: THREE.Object3D[] = [];
  function solid(
    w: number,
    h: number,
    d: number,
    color: string,
    x: number,
    y: number,
    z: number,
  ) {
    const mesh = box(w, h, d, color, x, y, z);
    scene.add(mesh);
    obstacles.push(mesh);
    physics.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z),
    );
    return mesh;
  }
  const clubFront = ROUTE_STOPS.finale.z - 11.7;
  const streetStart = 23;
  const streetEnd = clubFront - 12.3;
  const streetLength = streetStart - streetEnd;
  const streetCenter = (streetStart + streetEnd) / 2;
  const groundY = -0.05;
  const cream = "#f8ddac";
  const slate = "#263e49";
  const coral = "#df715a";
  const boardwalk = "#b88868";
  function surface(
    w: number,
    h: number,
    d: number,
    color: string,
    x: number,
    y: number,
    z: number,
  ) {
    const detail = box(w, h, d, color, x, y, z);
    detail.castShadow = false;
    scene.add(detail);
    return detail;
  }
  scene.add(
    box(125, 1, streetLength + 25, "#dfb987", -30, groundY - 0.5, streetCenter),
  );
  // The perimeter already bounds the player. A plane gives the capsule a stable floor contact.
  physics.createCollider(
    new RAPIER.ColliderDesc(
      new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 }),
    ).setTranslation(0, groundY, 0),
  );
  const asphalt = mat("#515d67");
  asphalt.map = asphaltTexture(streetLength);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(15, streetLength), asphalt);
  road.rotateX(-Math.PI / 2);
  road.position.set(0, 0.035, streetCenter);
  road.receiveShadow = true;
  scene.add(road);
  for (const side of [-1, 1]) {
    surface(3, 0.12, streetLength, "#e7c69f", side * 9, 0.02, streetCenter);
    surface(0.25, 0.10, streetLength, cream, side * 7.62, 0.03, streetCenter);
    surface(0.09, 0.014, streetLength, "#c5c6af", side * 6.92, 0.043, streetCenter);
    surface(0.14, 0.014, streetLength, boardwalk, side * 10.26, 0.086, streetCenter);
    for (let z = 15; z > clubFront - 5; z -= 5) {
      surface(2.7, 0.01, 0.045, boardwalk, side * 9.13, 0.084, z);
    }
  }
  surface(0.19, 0.035, streetLength, "#f5d49f", 29.5, -0.02, streetCenter);
  surface(0.57, 0.060, streetLength, "#ca9d72", 29.85, -0.025, streetCenter);
  for (let z = 15; z > clubFront - 4; z -= 8) {
    for (const x of [-0.22, 0.22]) surface(0.1, 0.015, 3, "#e6b46c", x, 0.043, z);
  }
  const crossings = [
    ROUTE_STOPS.motel.z + 10,
    ROUTE_STOPS.boardwalk.z + 5,
    ROUTE_STOPS.laundromat.z + 6,
    ROUTE_STOPS.finale.z + 8,
  ];
  for (const z of crossings) {
    for (let x = -6; x <= 6; x += 1.2) {
      surface(0.56, 0.017, 2.05, "#e9ddc3", x, 0.046, z);
    }
  }
  [-90, 28].forEach((x) =>
    physics.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 10, streetLength / 2 + 1).setTranslation(
        x,
        4,
        streetCenter,
      ),
    ),
  );
  [streetStart, streetEnd].forEach((z) =>
    physics.createCollider(
      RAPIER.ColliderDesc.cuboid(60, 10, 0.5).setTranslation(-30, 4, z),
    ),
  );
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 900),
    new THREE.ShaderMaterial({
      fog: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: { value: 0 },
        shallow: { value: new THREE.Color("#58cbb9") },
        deep: { value: new THREE.Color("#176883") },
        foam: { value: new THREE.Color("#ccf2db") },
      },
      vertexShader: `
        #include <fog_pars_vertex>
        varying vec2 coast;
        void main() {
          coast = (modelMatrix * vec4(position, 1.0)).xz;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <fog_pars_fragment>
        uniform float uTime;
        uniform vec3 shallow;
        uniform vec3 deep;
        uniform vec3 foam;
        varying vec2 coast;
        void main() {
          float shore = coast.x - 31.4;
          float swell = sin(coast.y * 0.14 + shore * 0.57 - uTime * 0.79);
          vec3 waterColor = mix(shallow, deep, smoothstep(0.0, 92.0, shore));
          float ripple = cos(shore * 1.37 + swell * 1.1 + uTime * 0.92);
          float broken = 0.5 + 0.5 * sin(coast.y * 0.49 + shore * 1.3);
          float glint = smoothstep(0.88, 1.0, ripple) * broken;
          float surf = 1.0 - smoothstep(0.13, 0.68, abs(shore - 2.15 - swell * 0.6));
          float detail = 1.0 - smoothstep(38.0, 130.0, length(cameraPosition.xz - coast));
          waterColor = mix(waterColor, foam, (0.19 * glint + 0.72 * surf) * detail);
          gl_FragColor = vec4(waterColor, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(331, -0.22, streetCenter);
  scene.add(water);
  const colors = [
    "#dc997b",
    "#e6bf9c",
    "#81afaa",
    "#e4a262",
    "#ca969f",
    "#85a9be",
  ];
  // Keep the inland frontage open around the utility bin.
  const inlandBlocks = [7, -24, -55, -87, -150, -182, -213, -301, -326];
  inlandBlocks.forEach((z, i) => {
    const height = 7 + (i % 3) * 2;
    solid(12, height, 19, colors[i % colors.length], -18, height / 2, z);
    surface(12.5, 0.43, 19.5, cream, -18, height, z);
    surface(0.21, 0.16, 19.14, coral, -11.94, height - 0.38, z);
    for (let floor = 0; floor < Math.floor(height / 2.7); floor++)
      for (let w = 0; w < 4; w++) {
        scene.add(
          box(0.18, 0.16, 3, cream, -11.8, 1 + floor * 2.6, z - 6 + w * 4),
        );
        const windowZ = z - 6 + w * 4;
        const windowY = 1.8 + floor * 2.6;
        surface(0.08, 1.4, 2.6, "#456475", -11.94, windowY, windowZ);
        surface(0.022, 1.36, 0.095, "#8ea3a3", -11.89, windowY, windowZ);
      }
    if (i % 2 === 0) {
      const canopy = box(4, 0.22, 16, i === 0 ? coral : cream, -9.8, 3, z);
      canopy.rotation.z = -0.1;
      scene.add(canopy);
    }
  });
  const seasideBlocks = [-13, -44, -124, -212, -259, -324];
  seasideBlocks.forEach((z, i) => {
    solid(9, 4.5, 12, colors[(i + 3) % 6], 18, 2.25, z);
    scene.add(box(9.7, 0.4, 12.7, "#e7d6b5", 18, 4.6, z));
    surface(0.1, 2, 6, slate, 13.45, 1.8, z);
    surface(0.12, 0.15, 8.8, cream, 13.4, 2.84, z);
    for (const dz of [-2.2, 0, 2.2]) surface(0.11, 2.05, 0.12, cream, 13.39, 1.8, z + dz);
  });
  function sign(
    text: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    ry = 0,
    bg = "#f4efdc",
    fg = "#23353f",
  ) {
    const textureHeight = THREE.MathUtils.clamp(Math.round(1024 * h / w), 96, 384);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        map: label(text, fg, bg, 1024, textureHeight, "sign"),
        roughness: 0.8,
        side: THREE.DoubleSide,
      }),
    );
    panel.position.set(x, y, z);
    panel.rotation.y = ry;
    scene.add(panel);
    return panel;
  }
  sign(
    "SUNSET MOTEL",
    -10.9,
    6,
    ROUTE_STOPS.motel.z + 4,
    12,
    2,
    Math.PI / 2,
    "#203b4c",
    "#ffdaaa",
  );
  surface(0.23, 6.2, 0.24, slate, -11.13, 3.1, ROUTE_STOPS.motel.z + 13);
  surface(3.9, 1.31, 0.16, coral, -11.13, 5.68, ROUTE_STOPS.motel.z + 13);
  sign("MOTEL", -11.13, 5.68, ROUTE_STOPS.motel.z + 13.1, 3.65, 1.08, 0, cream);
  sign("SUNSET SUPPLY", 13.37, 3.38, -13, 7.6, 0.95, -Math.PI / 2, "#376a70", cream);
  sign("FREE WIFI / NO REFUNDS", -10.85, 3, -8, 9, 0.8, Math.PI / 2);
  sign(
    "THE DIP · COLD DRINKS",
    13.4,
    3.8,
    -44,
    9,
    1.3,
    -Math.PI / 2,
    "#d8eeae",
  );
  scene.add(
    box(15, 0.095, 18, "#ceb99d", -15, 0.006, ROUTE_STOPS.utility.z),
    box(15, 0.095, 17, "#c8bcae", 15.9, 0.006, ROUTE_STOPS.apology.z - 1.5),
  );
  for (const z of [ROUTE_STOPS.apology.z + 5, ROUTE_STOPS.apology.z - 4]) {
    scene.add(box(3.1, 0.22, 0.86, "#c99278", 20, 0.58, z));
    for (const dx of [-1, 1])
      scene.add(box(0.17, 0.5, 0.68, "#537278", 20 + dx, 0.25, z));
  }
  sign(
    "UTILITY UNDER CONSTRUCTION",
    -21.2,
    2.45,
    ROUTE_STOPS.utility.z - 4.8,
    6.2,
    0.85,
    0,
    "#f4da7e",
  );
  sign(
    "APOLOGIES ACCEPTED HERE",
    21.6,
    2.45,
    ROUTE_STOPS.apology.z - 5.8,
    5.9,
    0.82,
    0,
    "#e9aebd",
  );
  sign(
    "CLUB LIQUID · STREET TEAM",
    -9.8,
    3.5,
    ROUTE_STOPS.streetTeam.z - 1.2,
    5.4,
    0.8,
    0,
    "#ddff91",
  );

  const laundryZ = ROUTE_STOPS.laundromat.z;
  solid(12, 5, 9, "#489a93", -16.5, 2.5, laundryZ - 6);
  scene.add(
    box(12.8, 0.3, 9.6, cream, -16.5, 5.04, laundryZ - 5.8),
    box(11.8, 0.22, 3, "#df847a", -16.5, 2.9, laundryZ - 1.2),
    box(8.5, 2.55, 0.11, slate, -18, 1.43, laundryZ - 1.44),
  );
  for (let i = 0; i < 9; i++) {
    surface(0.61, 0.23, 3.03, cream, -22.0 + i * 1.36, 2.91, laundryZ - 1.2);
  }
  sign("EXIT LIQUIDITY", -16.5, 4.32, laundryZ - 1.43, 10.2, 1.05, 0, slate, "#ffdfa0");
  sign("LAUNDROMAT", -16.5, 3.52, laundryZ - 1.4, 6.6, 0.62, 0, "#cbefe2");
  const auditDrum = new THREE.Group();
  auditDrum.position.set(-11.9, 0.99, laundryZ - 0.48);
  solid(1.65, 1.86, 1.2, "#eceddb", -11.9, 0.93, laundryZ - 1.15);
  const washerDoor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.58, 0.58, 0.08, 24),
    mat("#39646a"),
  );
  washerDoor.rotation.x = Math.PI / 2;
  auditDrum.add(
    washerDoor,
    box(0.21, 0.59, 0.035, "#bcdee0", -0.11, 0.08, 0.055),
    box(0.18, 0.4, 0.035, "#f9d58c", 0.2, -0.12, 0.058),
  );
  scene.add(auditDrum);
  sign("AUDIT CYCLE", -11.9, 1.69, laundryZ - 0.52, 1.4, 0.22, 0, "#dfffb0");

  const hotdogX = HOTDOG_VENDOR.x + 2.6,
    hotdogZ = HOTDOG_VENDOR.z;
  solid(2.75, 0.85, 1.55, coral, hotdogX, 0.43, hotdogZ);
  scene.add(
    box(2.94, 0.13, 1.68, "#f2e6c9", hotdogX, 0.89, hotdogZ),
    box(0.09, 1.91, 0.09, "#567487", hotdogX + 1.27, 1.65, hotdogZ - 0.66),
    box(0.09, 1.91, 0.09, "#567487", hotdogX - 1.27, 1.65, hotdogZ - 0.66),
  );
  for (let i = 0; i < 7; i++) {
    scene.add(
      box(
        0.43,
        0.16,
        2.05,
        i % 2 ? coral : cream,
        hotdogX - 1.29 + i * 0.43,
        2.59,
        hotdogZ,
      ),
    );
  }
  sign(
    "QUANTUM HOT DOGS",
    hotdogX,
    2.38,
    hotdogZ + 1.02,
    3.1,
    0.42,
    0,
    slate,
    "#ffebba",
  );
  sign(
    "OBSERVE TO ORDER",
    hotdogX,
    0.49,
    hotdogZ + 0.79,
    2.35,
    0.36,
    0,
    "#f6dfad",
  );
  const vendor = makeAvatar("#dbd8fa", "#a97959");
  vendor.group.position.set(hotdogX + 0.45, 0, hotdogZ - 1.06);
  vendor.group.rotation.y = -Math.PI / 4;
  vendor.group.add(box(0.48, 0.18, 0.5, "#f7efdf", 0, 1.96, 0));
  scene.add(vendor.group);
  const sausage = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.11, 0.54, 4, 8),
    mat("#b86445"),
  );
  sausage.rotation.z = Math.PI / 2;
  sausage.position.set(hotdogX - 0.56, 1.12, hotdogZ + 0.36);
  scene.add(
    sausage,
    box(0.69, 0.19, 0.35, "#eec282", hotdogX - 0.56, 1.04, hotdogZ + 0.36),
  );

  const deskX = ROUTE_STOPS.incident.x - 3.4,
    deskZ = ROUTE_STOPS.incident.z;
  scene.add(box(8.2, 0.09, 7.4, "#c9b49a", deskX, 0.02, deskZ));
  solid(3.4, 0.86, 1.7, "#3d4c58", deskX, 0.43, deskZ - 0.15);
  scene.add(
    box(3.6, 0.08, 1.85, "#2b3944", deskX, 0.89, deskZ - 0.15),
    box(0.12, 2.15, 0.12, "#567487", deskX + 1.55, 1.85, deskZ - 0.85),
    box(0.12, 2.15, 0.12, "#567487", deskX - 1.55, 1.85, deskZ - 0.85),
    box(3.7, 0.1, 2.1, "#df715a", deskX, 2.95, deskZ - 0.15),
    box(1.15, 0.06, 0.8, "#1b242c", deskX - 0.4, 0.95, deskZ + 0.2),
    box(0.55, 0.28, 0.4, "#d2a85a", deskX + 1.05, 1.05, deskZ + 0.15),
  );
  sign("TREASURY OPS", deskX, 2.62, deskZ + 0.92, 3.15, 0.4, 0, slate, "#ffebba");
  sign("WAR ROOM", deskX, 0.48, deskZ + 0.72, 2.05, 0.32, 0, "#7c3a32", "#f7e2c2");

  const boothX = 17.1,
    boothZ = ROUTE_STOPS.apology.z - 10.2;
  scene.add(box(11, 0.11, 9, "#c9b2c6", 16, 0.017, boothZ));
  solid(2.9, 3.2, 0.22, "#b3647e", boothX, 1.6, boothZ - 1.08);
  for (const side of [-1, 1]) {
    solid(
      0.16,
      3.15,
      1.7,
      "#894d70",
      boothX + side * 1.37,
      1.58,
      boothZ - 0.24,
    );
  }
  scene.add(
    box(3.3, 0.24, 2.55, "#f19db0", boothX, 3.23, boothZ),
    box(0.48, 0.86, 0.3, "#334451", boothX - 0.43, 1.53, boothZ - 0.85),
    box(0.095, 0.68, 0.21, "#f9ddab", boothX - 0.61, 1.57, boothZ - 0.63),
  );
  sign("FOUNDER HOTLINE", boothX, 2.78, boothZ + 0.94, 2.84, 0.4, 0, "#f5d7a5");
  sign(
    "REFUNDS: PRESS 1",
    boothX,
    1.92,
    boothZ - 1.22,
    2.2,
    0.27,
    Math.PI,
    "#f9edcf",
  );
  sign(
    "BUTTON 1 WAS REMOVED",
    boothX,
    1.59,
    boothZ - 1.22,
    2.2,
    0.27,
    Math.PI,
    "#f9edcf",
  );

  const dockX = 17,
    dockZ = ROUTE_STOPS.boardwalk.z - 8.5;
  scene.add(box(12, 0.1, 12, "#d8ae87", 15, 0, dockZ + 9.5));
  for (let i = -8; i <= 8; i++) {
    scene.add(
      box(
        13.6,
        0.12,
        0.56,
        i % 2 ? "#c49772" : "#d8ae87",
        dockX,
        0.01,
        dockZ + i * 0.59,
      ),
    );
  }
  for (const x of [18.7, 24]) {
    scene.add(box(0.17, 2.72, 0.2, "#ebdbb8", x, 1.36, dockZ + 5.2));
  }
  sign(
    "SEAGULL YACHT CLUB",
    21.35,
    2.4,
    dockZ + 5.2,
    5.8,
    0.83,
    0,
    "#275963",
    "#eff5d4",
  );
  const pool = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.6, 0.35, 28),
    mat("#74bad2"),
  );
  pool.position.set(dockX + 2, 0.18, dockZ - 1.1);
  const poolRim = new THREE.Mesh(
    new THREE.TorusGeometry(2.52, 0.15, 8, 32),
    mat("#a6dceb"),
  );
  poolRim.rotateX(Math.PI / 2);
  poolRim.position.set(dockX + 2, 0.4, dockZ - 1.1);
  const yacht = new THREE.Mesh(
    new THREE.CylinderGeometry(1.35, 0.94, 0.37, 5),
    mat("#fff0df"),
  );
  yacht.position.set(dockX + 2, 0.59, dockZ - 1.1);
  yacht.scale.z = 0.75;
  yacht.rotation.y = -Math.PI / 2;
  scene.add(
    pool,
    poolRim,
    yacht,
    box(0.67, 0.31, 0.76, "#f09bad", dockX + 2, 0.87, dockZ - 1.1),
  );
  const captain = assets.create("gull", 0.83);
  captain.position.set(dockX + 2, 0.93, dockZ - 1.1);
  captain.rotation.y = -Math.PI / 3;
  scene.add(
    captain,
    box(3.45, 0.92, 0.16, "#385654", dockX + 2, 0.59, dockZ - 4.75),
  );
  sign(
    "CAPACITY: ONE SEAGULL",
    dockX + 2,
    0.85,
    dockZ - 4.86,
    3.1,
    0.26,
    Math.PI,
    "#f9edcf",
  );
  sign(
    "HUMAN MEMBERS MAY WATCH",
    dockX + 2,
    0.53,
    dockZ - 4.86,
    3.1,
    0.25,
    Math.PI,
    "#f9edcf",
  );

  solid(32, 10, 10, "#243846", 0, 5, clubFront - 5);
  scene.add(box(33, 0.6, 11, "#ed827e", 0, 10, clubFront - 5));
  solid(3, 5, 1, "#e3807c", -9, 2.5, clubFront + 0.5);
  solid(3, 5, 1, "#e3807c", 9, 2.5, clubFront + 0.5);
  surface(12, 5, 0.2, "#111f2b", 0, 2.5, clubFront + 0.15);
  surface(13.3, 0.22, 0.64, "#eea366", 0, 5.06, clubFront + 0.34);
  for (const x of [-13, -11.9, 11.9, 13]) {
    surface(0.14, 4.65, 0.05, "#e7899c", x, 2.75, clubFront + 0.04);
  }
  const clubSign = sign(
    "CLUB LIQUID",
    0,
    7.4,
    clubFront + 0.3,
    25,
    2.8,
    0,
    CLUB_SIGN.enamel,
    CLUB_SIGN.ink,
  );
  const coin = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, 0.65, 24),
    new THREE.MeshStandardMaterial({
      color: "#f9ce5c",
      emissive: "#b28618",
      emissiveIntensity: 0.35,
      metalness: 0.25,
      roughness: 0.4,
    }),
  );
  coin.rotation.x = Math.PI / 2;
  coin.position.set(0, 14.6, clubFront - 3);
  scene.add(coin);
  const coinRim = new THREE.Mesh(
    new THREE.TorusGeometry(2.5, 0.092, 8, 40),
    new THREE.MeshBasicMaterial({ color: "#ffe8ac" }),
  );
  coinRim.position.set(0, 14.6, clubFront - 2.63);
  scene.add(coinRim);
  sign("$LOP", 0, 14.6, clubFront - 2.58, 3.5, 1.12, 0, "#edb85d", "#593b2a");
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 2, 20, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: "#f0d795",
      transparent: true,
      opacity: 0.035,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  beam.position.set(0, 22, clubFront - 4);
  scene.add(beam);
  for (let i = 0; 17 - i * 9.3 > streetEnd + 7; i++) {
    const palm = assets.create("palm", 7.5 + (i % 3));
    palm.position.set(i % 2 ? 25 : -10.5, 0, 17 - i * 9.3);
    palm.rotation.y = i * 1.3;
    scene.add(palm);
  }
  for (let i = 0; -i * 17 > streetEnd + 8; i++) {
    const z = -i * 17;
    const nearServicePath =
      Math.abs(z - ROUTE_STOPS.boardwalk.z) < 12 ||
      Math.abs(z - HOTDOG_VENDOR.z) < 12;
    const x = i % 2 && !nearServicePath ? 10.5 : -10.5;
    scene.add(
      box(0.14, 6, 0.14, "#526369", x, 3, z),
      box(1.3, 0.16, 0.55, "#f9d9a1", x, 6, z),
    );
  }
  const markers: THREE.Group[] = [],
    props: THREE.Group[] = [];
  TASKS.forEach((task) => {
    const g = new THREE.Group();
    g.position.set(task.position.x, 0.087, task.position.z);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.54, 2.8, 48),
      new THREE.MeshBasicMaterial({
        color: CLUB_SIGN.enamel,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    const pin = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: label(String(task.id + 1), CLUB_SIGN.ink, CLUB_SIGN.enamel, 128, 128, "marker"),
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    pin.position.y = 3.7;
    pin.scale.set(0.89, 0.89, 1);
    g.add(pin);
    scene.add(g);
    markers.push(g);
    if (task.action === "jump") {
      const { x, z } = task.position;
      for (const side of [-1, 1]) {
        solid(3.7, 0.92, 0.18, "#37775b", x, 0.46, z + side * 1.76);
        solid(0.18, 0.92, 3.52, "#37775b", x + side * 1.76, 0.46, z);
        scene.add(
          box(3.8, 0.12, 0.25, "#b9e3a0", x, 0.94, z + side * 1.76),
          box(0.25, 0.12, 3.8, "#b9e3a0", x + side * 1.76, 0.94, z),
        );
      }
      sign("THE UTILITY", x, 0.54, z + 1.87, 2.6, 0.42, 0, "#d9eea9");
      return;
    }
    if (!task.prop) return;
    const prop = assets.create(
      task.prop,
      task.prop === "gull" ? 1.6 : task.prop === "crown" ? 2.5 : 2,
    );
    prop.position.set(
      task.position.x + (task.position.x <= 0 ? -2.6 : 2.6),
      0.1,
      task.position.z,
    );
    scene.add(prop);
    props.push(prop);
  });
  const pickups = PICKUPS.map((pos) => {
    const g = new THREE.Group();
    g.position.set(pos.x, 1.1, pos.z);
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.55),
      new THREE.MeshStandardMaterial({
        color: "#f88db7",
        emissive: "#ca3d7e",
        emissiveIntensity: 0.2,
        roughness: 0.3,
      }),
    );
    g.add(mesh);
    scene.add(g);
    return g;
  });
  const jumps = JUMPS.map((pos) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.8, 2, 32),
      new THREE.MeshBasicMaterial({
        color: "#f6cf75",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      }),
    );
    ring.position.set(pos.x, 0.06, pos.z);
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);
    return ring;
  });
  const rampData = rampMeshData();
  const rampGeometry = new THREE.BufferGeometry();
  rampGeometry.setAttribute("position", new THREE.BufferAttribute(rampData.vertices, 3));
  rampGeometry.setIndex(new THREE.BufferAttribute(rampData.indices, 1));
  rampGeometry.computeVertexNormals();
  const rampSurface = mat("#b8976b");
  for (const z of RAMP_CENTERS) {
    const ramp = new THREE.Mesh(rampGeometry, rampSurface);
    ramp.name = "Street ramp";
    ramp.position.z = z;
    ramp.receiveShadow = ramp.castShadow = true;
    scene.add(ramp);
    obstacles.push(ramp);
    physics.createCollider(RAPIER.ColliderDesc.trimesh(
      rampData.vertices, rampData.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
    ).setTranslation(0, 0, z));
    for (const u of [0.78, 0.91, 0.98]) {
      const stripe = surface(RAMP_HALF_WIDTH * 2 - 0.14, 0.015, 0.12, cream,
        0, 0.015 + rampHeight(u), z + RAMP_LENGTH * (0.5 - u));
      stripe.rotation.x = Math.atan(rampSlope(u));
    }
  }
  const crowds: Avatar[] = [];
  TASKS.forEach((task) => {
    if (task.action === "airdrop" || task.action === "launch") return;
    for (let k = 0; k < 3; k++) {
      const npc = makeAvatar(
        ["#c9e57c", "#f09cb7", "#89d5cd"][k],
        ["#bd8864", "#e6b992", "#8e624e"][k],
      );
      npc.group.position.set(
        task.position.x + (k - 1) * 1.5,
        0,
        task.position.z - 3.5,
      );
      npc.arms[1].rotation.x = -1.5;
      const phone = box(0.16, 0.25, 0.06, "#203d43", 0, -0.42, 0.04);
      npc.arms[1].add(phone);
      if (k === 2) {
        const placard = box(0.9, 0.55, 0.05, "#f4e2a6", 0, 0.2, 0.15);
        npc.arms[1].add(placard);
      }
      scene.add(npc.group);
      crowds.push(npc);
    }
  });
  const buyers = Array.from({ length: 3 }, (_, i) => {
    const npc = makeAvatar(["#e95d65", "#9c80bc", "#deaa5a"][i]);
    npc.group.visible = false;
    scene.add(npc.group);
    return npc;
  });
  for (let i = 0; i < 8; i++) {
    const cloud = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(4, 7, 5),
        new THREE.MeshBasicMaterial({ color: "#fff1dd" }),
      );
      ball.position.set(j * 4, j % 2, 0);
      ball.scale.y = 0.35;
      cloud.add(ball);
    }
    cloud.position.set(-85 + i * 25, 38 + (i % 2) * 7, -100 - (i % 3) * 55);
    scene.add(cloud);
  }
  const bagworker = createBagWorkerDistrict(scene, solid, assets);
  // Merge static architecture by material; keep collision proxies independent.
  scene.updateMatrixWorld(true);
  const batches = new Map<string, THREE.Mesh[]>();
  for (const node of [...scene.children]) {
    if (
      !(node instanceof THREE.Mesh) ||
      !(node.material instanceof THREE.MeshStandardMaterial) ||
      node.material.map
    )
      continue;
    const m = node.material;
    const key = [
      m.color.getHex(),
      m.emissive.getHex(),
      m.emissiveIntensity,
      m.roughness,
      m.metalness,
      m.side,
      node.castShadow,
      node.receiveShadow,
    ].join(":");
    const batch = batches.get(key) || [];
    batch.push(node);
    batches.set(key, batch);
  }
  for (const meshes of batches.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) =>
      mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),
    );
    const geometry = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (!geometry) continue;
    const combined = new THREE.Mesh(geometry, meshes[0].material);
    combined.castShadow = meshes[0].castShadow;
    combined.receiveShadow = meshes[0].receiveShadow;
    scene.add(combined);
    meshes.forEach((mesh) => scene.remove(mesh));
  }
  physics.step();
  return {
    bagworker,
    obstacles,
    markers,
    pickups,
    jumps,
    buyers,
    crowds,
    sign: clubSign,
    auditDrum,
    water,
    props,
  };
}
