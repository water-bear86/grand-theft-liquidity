import * as THREE from "three";
import { Assets, box, label, mat } from "./assets.ts";
import { AlonCharacter } from "./alon.ts";
import { ALON, CANNON, COURSE, WALLET } from "./bagworker.ts";
type Solid = (
  w: number,
  h: number,
  d: number,
  color: string,
  x: number,
  y: number,
  z: number,
) => THREE.Mesh;
export function createBagWorkerDistrict(
  scene: THREE.Scene,
  solid: Solid,
  assets: Assets,
) {
  const cream = "#f8ddac",
    teal = "#377c76",
    ink = "#193c46",
    yellow = "#edc56b";
  const detail = (
    w: number,
    h: number,
    d: number,
    color: string,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = box(w, h, d, color, x, y, z);
    mesh.castShadow = false;
    scene.add(mesh);
    return mesh;
  };
  const sign = (
    text: string,
    x: number,
    y: number,
    z: number,
    w = 6,
    h = 1,
    color = cream,
  ) => {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: label(text, ink, color, 1024, 160, "sign"),
        side: THREE.FrontSide,
      }),
    );
    panel.position.set(x, y, z);
    scene.add(panel);
    return panel;
  };
  detail(15, 0.035, 170, "#515d67", -60, 0.035, -199);
  for (const z of [-233, -280]) {
    detail(60, 0.035, 13, "#515d67", -30, 0.04, z);
    for (let x = -57; x <= -3; x += 7)
      detail(3, 0.02, 0.15, yellow, x, 0.065, z);
    sign("← BAGWORKER BLVD", -8, 3.1, z + 5, 7, 0.9);
    sign("BEACHFRONT →", -53, 2.7, z + 5, 6, 0.8);
  }
  for (const x of [-69, -51]) detail(3, 0.12, 170, "#d8bc97", x, 0.02, -199);
  for (let z = -120; z >= -278; z -= 8)
    detail(0.15, 0.02, 3, yellow, -60, 0.065, z);
  for (const [i, z] of [-134, -168, -202, -269].entries()) {
    const height = 6 + (i % 2) * 2;
    solid(
      13,
      height,
      20,
      ["#dd9b7c", teal, "#d3a36b", "#87a5ac"][i],
      -81,
      height / 2,
      z,
    );
    detail(13.6, 0.3, 20.5, cream, -81, height, z);
    for (let dz = -6; dz <= 6; dz += 4)
      detail(0.08, 2, 2.4, ink, -74.46, 2, z + dz);
    const placard = sign(
      [
        "PROOF OF WORK GYM",
        "EXIT INTERVIEWS",
        "VESTING SPA",
        "CUSTOMER SUPPORT",
      ][i],
      -74.39,
      height - 1.2,
      z,
      9,
      0.9,
    );
    placard.rotation.y = Math.PI / 2;
  }
  sign("BAGWORKER BLVD", -60, 7.3, -227.98, 15, 1.6, yellow);
  sign("BAGWORKER BLVD", -60, 7.3, -228.02, 15, 1.6, yellow).rotation.y =
    Math.PI;
  for (const x of [-69, -51]) solid(0.25, 7.5, 0.25, ink, x, 3.75, -228);
  solid(10, 5, 9, teal, -40, 2.5, -241);
  detail(10.7, 0.3, 9.8, cream, -40, 5, -241);
  const office = sign("FOUNDER SUPPORT", -45.1, 3.6, -241, 8, 1.1);
  office.rotation.y = -Math.PI / 2;
  const refund = sign(
    "NO REFUNDS. CASH ONLY.",
    -45.15,
    2.5,
    -241,
    7,
    0.55,
    yellow,
  );
  refund.rotation.y = -Math.PI / 2;
  const alon = new AlonCharacter(assets.alon);
  alon.group.name = "alon-model-slot";
  alon.group.position.set(ALON.x, ALON.y, ALON.z);
  alon.group.rotation.y = -Math.PI / 2;
  scene.add(alon.group);
  const cash = new THREE.Group();
  cash.add(
    box(0.65, 0.27, 0.34, "#9cb68c", 0, 0, 0),
    box(0.17, 0.29, 0.36, cream, 0, 0, 0),
  );
  for (const y of [-0.09, -0.045, 0.045, 0.09])
    cash.add(box(0.66, 0.012, 0.35, "#d9e5b9", 0, y, 0));
  cash.visible = false;
  scene.add(cash);
  for (const [i, p] of COURSE.entries()) {
    solid(
      p.w,
      p.y,
      p.d,
      i === 1 ? "#d9b45b" : [teal, "#d69c7a", "#899fa6"][i % 3],
      p.x,
      p.y / 2,
      p.z,
    );
    detail(
      p.w + 0.14,
      0.08,
      p.d + 0.14,
      p.checkpoint ? yellow : cream,
      p.x,
      p.y + 0.015,
      p.z,
    );
    if (i === 1) {
      for (const x of [-1.8, 1.8])
        for (const z of [-1.5, 1.5])
          detail(0.36, 0.7, 0.7, ink, p.x + x, 0.45, p.z + z);
    }
    if (i > 1) {
      for (const dx of [-p.w / 2 + 0.25, p.w / 2 - 0.25])
        detail(0.12, 0.08, p.d - 0.4, ink, p.x + dx, p.y + 0.08, p.z);
    }
    if (p.checkpoint && i > 0) {
      detail(0.1, 1.9, 0.1, ink, p.x + p.w / 2 - 0.4, p.y + 1, p.z - 1);
      detail(0.9, 0.6, 0.03, yellow, p.x + p.w / 2 - 0.8, p.y + 1.7, p.z - 1);
    }
  }
  const last = COURSE[COURSE.length - 1];
  // Empty claim tray is the destination; the reward is only handed over back at Alon's office.
  detail(2, 0.16, 1.3, ink, last.x, last.y + 0.18, last.z);
  const guide = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.92, 32),
    new THREE.MeshBasicMaterial({
      color: yellow,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  guide.rotation.x = -Math.PI / 2;
  guide.visible = false;
  scene.add(guide);
  const cannon = new THREE.Group();
  cannon.position.set(CANNON.x, 0, CANNON.z);
  cannon.add(box(2.2, 0.4, 2, ink, 0, 0.3, 0));
  const barrel = new THREE.Group();
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.64, 0.7, 2.7, 16, 1, true),
    mat("#cd795c"),
  );
  tube.rotation.z = Math.PI / 2;
  barrel.add(tube, box(1.6, 0.65, 1.1, yellow, 0.4, -0.4, 0));
  barrel.position.y = 1.3;
  barrel.rotation.z = -0.45;
  cannon.add(barrel);
  scene.add(cannon);
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 1, 4),
    new THREE.MeshBasicMaterial({ color: yellow }),
  );
  arrow.rotation.z = Math.PI / 2;
  arrow.position.set(-3, 0, 0);
  barrel.add(arrow);
  // The landing surface and every rim collider share the mission's target height.
  const deck = WALLET.y - 0.24;
  solid(6.6, deck, 7.4, "#d3a36b", WALLET.x, deck / 2, WALLET.z);
  detail(6.7, 0.08, 7.5, cream, WALLET.x, deck - 0.04, WALLET.z);
  solid(6, 0.24, 7, "#7a9b70", WALLET.x, WALLET.y - 0.12, WALLET.z);
  solid(0.3, 1.2, 7, "#80583e", WALLET.x - 3.1, deck + 0.6, WALLET.z);
  for (const dz of [-3.5, 3.5])
    solid(6.4, 1.2, 0.25, "#80583e", WALLET.x, deck + 0.6, WALLET.z + dz);
  detail(5.5, 0.03, 6.4, "#c5d5a4", WALLET.x, WALLET.y + 0.015, WALLET.z);
  return { alon, cash, cannon, barrel, guide };
}
export type BagWorkerDistrict = ReturnType<typeof createBagWorkerDistrict>;
