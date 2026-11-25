import * as THREE from "three";
import { Assets, box, label, mat, type AssetKey } from "./assets.ts";
import type { Player } from "./player.ts";
import type { CharacterPortrait } from "./player-character.ts";
import type { TaskSceneId } from "./content.ts";
import type { AudioCue } from "./audio.ts";

export const SCENE_COPY = {
  spread: {
    title: "Skin in the game",
    instructions: "Spread peanut butter on your face, shirt, and both arms.",
    action: "Dab next spot",
  },
  contract: {
    title: "The crumbs clause",
    instructions:
      "Drag three crumbs onto the contract to get the gull’s signature.",
    action: "Offer one crumb",
  },
  peel: {
    title: "Peel the partner",
    instructions: "Drag each yellow tab down to peel the banana.",
    action: "Peel one strip",
  },
  hotdog: {
    title: "Schrödinger’s special",
    instructions: "Slide the lids aside. Find the hot dog and tap it to serve.",
    action: "Slide next lid",
  },
  crown: {
    title: "Crown toss",
    instructions:
      "Hold the crown and drag sideways to aim. Release when power is in the green band.",
    action: "Charge crown",
  },
  incident: {
    title: "We got hacked.",
    instructions:
      "Pocket the treasury, post the incident note, and sell the cover story. This is all in-game fiction.",
    action: "Safest move",
  },
} satisfies Record<
  TaskSceneId,
  { title: string; instructions: string; action: string }
>;

export const CROWN_POWER = { low: 0.42, high: 0.72 };
export const CROWN_AIM_LIMIT = 2.25;

export interface SceneReadout {
  status: string;
  action: string;
  disabled: boolean;
  done: boolean;
  power: number;
  aim: number;
}

type Point = { x: number; y: number };
type Drag = {
  move?: (at: Point) => void;
  release?: (at: Point) => void;
  cancel?: () => void;
};
type SceneControls = {
  press: (at: Point) => Drag | null;
  assist: () => void;
  aim?: (value: number) => void;
  tick?: (dt: number) => void;
};

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const STAGE_PALETTES = {
  spread: ["#b87754", "#303640"],
  contract: ["#548e7c", "#1b3f49"],
  peel: ["#b1864d", "#3e3e44"],
  hotdog: ["#4d8d9d", "#183744"],
  crown: ["#587c80", "#182b3b"],
  incident: ["#3d5a66", "#141c28"],
} satisfies Record<TaskSceneId, [string, string]>;

function stageBackground(id: TaskSceneId) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const [light, dark] = STAGE_PALETTES[id];
  const vignette = ctx.createRadialGradient(120, 103, 8, 128, 128, 175);
  vignette.addColorStop(0, light);
  vignette.addColorStop(1, dark);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#f7e7bb14";
  ctx.lineWidth = 0.7;
  for (let x = -size; x < size; x += 21) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + size * 0.53, size);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class TaskScenes {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-4, 4, 2.8, -2.8, 0.1, 40);
  id: TaskSceneId | null = null;
  readout: SceneReadout = {
    status: "",
    action: "",
    disabled: false,
    done: false,
    power: 0,
    aim: 0,
  };
  private canvas: HTMLCanvasElement;
  private assets: Assets;
  private onComplete: () => void;
  private onCue: (cue: AudioCue) => void;
  private motion: MediaQueryList;
  private controls: SceneControls | null = null;
  private drag: { pointerId: number; gesture: Drag } | null = null;
  private portraits: CharacterPortrait[] = [];
  private borrowed: THREE.Object3D[] = [];
  private stage = new THREE.Group();
  private settle: number | null = null;
  private minWidth = 6.8;

  constructor(
    canvas: HTMLCanvasElement,
    assets: Assets,
    onComplete: () => void,
    motion: MediaQueryList,
    onCue: (cue: AudioCue) => void,
  ) {
    this.canvas = canvas;
    this.assets = assets;
    this.onComplete = onComplete;
    this.onCue = onCue;
    this.motion = motion;
    this.camera.position.set(0, 0, 8);
    canvas.addEventListener("pointerdown", (event) => {
      if (
        !this.controls ||
        this.drag ||
        this.readout.disabled ||
        (event.pointerType === "mouse" && !event.isPrimary) ||
        event.button !== 0
      )
        return;
      const gesture = this.controls.press(this.point(event));
      if (gesture) this.drag = { pointerId: event.pointerId, gesture };
    });
    window.addEventListener("pointermove", (event) => {
      const drag = this.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (event.pointerType === "mouse" && !(event.buttons & 1)) {
        this.cancelDrag();
        return;
      }
      drag.gesture.move?.(this.point(event));
    });
    window.addEventListener("pointerup", (event) => {
      const drag = this.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      this.drag = null;
      if (!this.readout.disabled) drag.gesture.release?.(this.point(event));
    });
    window.addEventListener("pointercancel", (event) => {
      if (event.pointerId === this.drag?.pointerId) this.cancelDrag();
    });
    window.addEventListener("pointerout", (event) => {
      if (
        event.relatedTarget === null &&
        event.pointerId === this.drag?.pointerId
      )
        this.cancelDrag();
    });
    window.addEventListener("blur", () => this.cancelDrag());
  }

  open(id: TaskSceneId, player: Player, ticker: string) {
    this.close();
    this.id = id;
    this.readout = {
      status: "",
      action: SCENE_COPY[id].action,
      disabled: false,
      done: false,
      power: 0,
      aim: 0,
    };
    this.minWidth = {
      spread: 5.25,
      contract: 6.1,
      peel: 4.3,
      hotdog: 6.25,
      incident: 6.4,
      crown: 5.85,
    }[id];
    this.resize();
    this.scene.background = stageBackground(id);
    const sun = new THREE.DirectionalLight("#ffe1b5", 2.65);
    sun.position.set(-2.7, 4.5, 6);
    this.scene.add(
      new THREE.HemisphereLight("#cedfee", "#b28165", 1.5),
      sun,
      this.stage,
    );
    if (id === "spread") this.controls = this.spread(player);
    else if (id === "contract") this.controls = this.contract();
    else if (id === "peel") this.controls = this.peel();
    else if (id === "hotdog") this.controls = this.hotdog(ticker);
    else if (id === "incident") this.controls = this.incident();
    else this.controls = this.crown(player);
  }

  close() {
    if (!this.id) return;
    this.cancelDrag();
    this.controls = null;
    this.id = null;
    this.settle = null;
    this.borrowed.forEach((asset) => asset.removeFromParent());
    this.borrowed = [];
    this.portraits.forEach((p) => p.dispose());
    this.portraits = [];
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.stage.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      if (Array.isArray(object.material))
        object.material.forEach((m) => materials.add(m));
      else materials.add(object.material);
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) {
      if (
        m instanceof THREE.MeshBasicMaterial ||
        m instanceof THREE.MeshStandardMaterial
      )
        m.map?.dispose();
      m.dispose();
    }
    this.stage.clear();
    this.scene.clear();
    if (this.scene.background instanceof THREE.Texture)
      this.scene.background.dispose();
    this.scene.background = null;
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const aspect = width / height;
    // Give the card enough vertical room for its title and controls in short windows.
    const viewHeight = Math.max(
      height < 480 ? 9.3 : height < 620 ? 6.8 : 5.7,
      this.minWidth / aspect,
    );
    this.camera.left = (-viewHeight * aspect) / 2;
    this.camera.right = -this.camera.left;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -this.camera.top;
    this.camera.position.y = height < 480 ? -0.63 : 0;
    this.camera.updateProjectionMatrix();
  }

  assist() {
    if (!this.readout.disabled && !this.drag) this.controls?.assist();
  }

  aim(value: number) {
    if (!this.readout.disabled && !this.drag) this.controls?.aim?.(value);
  }

  update(dt: number) {
    this.controls?.tick?.(dt);
    if (this.settle === null) return;
    this.settle -= dt;
    if (this.settle > 0) return;
    this.settle = null;
    this.onComplete();
  }

  private point(event: PointerEvent): Point {
    const bounds = this.canvas.getBoundingClientRect();
    const u = (event.clientX - bounds.left) / bounds.width;
    const v = (event.clientY - bounds.top) / bounds.height;
    return {
      x: THREE.MathUtils.lerp(this.camera.left, this.camera.right, u),
      y:
        this.camera.position.y +
        THREE.MathUtils.lerp(this.camera.top, this.camera.bottom, v),
    };
  }

  private cancelDrag() {
    this.drag?.gesture.cancel?.();
    this.drag = null;
  }

  private finish(status: string) {
    this.readout.status = status;
    this.readout.action = "Done";
    this.readout.disabled = true;
    this.readout.done = true;
    this.settle = 1.15;
  }

  private block(
    w: number,
    h: number,
    d: number,
    color: string,
    x: number,
    y: number,
    z: number,
  ) {
    const mesh = box(w, h, d, color, x, y, z);
    this.stage.add(mesh);
    return mesh;
  }

  private card(
    text: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    color: string,
    ink = "#214049",
  ) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: label(
          text,
          ink,
          color,
          512,
          THREE.MathUtils.clamp(Math.round((512 * h) / w), 72, 256),
          "sign",
        ),
      }),
    );
    mesh.position.set(x, y, z);
    this.stage.add(mesh);
    return mesh;
  }

  private setWall(
    width: number,
    height: number,
    y: number,
    z: number,
    plaster: string,
    enamel: string,
  ) {
    this.block(width + 0.13, height + 0.14, 0.14, "#253e4b", 0, y, z - 0.035);
    this.block(width, height, 0.11, plaster, 0, y, z);
    for (const direction of [-1, 1]) {
      const trimY = y + direction * (height * 0.5 - 0.12);
      this.block(width - 0.13, 0.055, 0.025, enamel, 0, trimY, z + 0.063);
    }
  }

  private marker(
    x: number,
    y: number,
    z: number,
    radius: number,
    color: string,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.89, radius, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    mesh.position.set(x, y, z);
    this.stage.add(mesh);
    return mesh;
  }

  private addProp(
    key: AssetKey,
    height: number,
    x: number,
    y: number,
    z: number,
  ) {
    const prop = this.assets.create(key, height);
    prop.position.set(x, y, z);
    this.stage.add(prop);
    this.borrowed.push(prop);
    return prop;
  }

  private incident(): SceneControls {
    this.setWall(7.6, 4.15, 0.35, -1.15, "#243544", "#6f8b8c");
    this.card("TREASURY OPS", 0, 1.86, -1.02, 3.4, 0.42, "#152028", "#f3d38a");
    this.card("WAR ROOM", -2.35, 1.28, -1.01, 1.9, 0.32, "#7c3a32", "#f7e2c2");
    this.block(5.4, 0.16, 2.3, "#6b5340", 0, -1.18, 0.35);
    this.block(4.8, 0.08, 1.8, "#3c4650", 0, -1.08, 0.4);
    // A closed laptop. The playable feed lives in the HTML board, not a real wallet screen.
    this.block(1.55, 0.06, 1.05, "#1b242c", 0.15, -1.02, 0.55);
    this.block(1.55, 0.9, 0.07, "#9aa7ae", 0.15, -0.55, 0.08);
    this.card("INCIDENT", 0.15, -0.52, 0.13, 1.2, 0.28, "#1b242c", "#f3d38a");
    this.block(0.62, 0.34, 0.42, "#d2a85a", -1.7, -0.9, 0.7);
    this.block(0.62, 0.22, 0.42, "#c9943f", -1.7, -0.62, 0.7);
    this.block(0.18, 0.7, 0.18, "#35584d", 2.05, -0.75, 0.55);
    this.block(0.55, 0.16, 0.55, "#3f6a4e", 2.05, -0.36, 0.55);
    return { press: () => null, assist: () => {} };
  }

  private spread(player: Player): SceneControls {

    const portrait = player.portrait();
    const hero = portrait.group;
    // Keep the taller street model inside the close-up stage and its gesture area.
    hero.scale.setScalar((1.55 * 2) / player.character.height);
    hero.position.set(0, -1.55, 0.15);
    this.stage.add(hero);
    this.borrowed.push(hero);
    this.portraits.push(portrait);
    this.setWall(4.5, 3.45, 0.09, -0.8, "#f0c587", "#ad7357");
    for (const x of [-1.99, -1.78, 1.78, 1.99])
      this.block(0.08, 3.12, 0.025, "#e8a974", x, 0.09, -0.735);
    this.block(4.2, 0.15, 1, "#3d807a", 0, -1.63, -0.01);
    this.block(4.2, 0.046, 1.02, "#f6cf8a", 0, -1.66, -0.01);
    this.addProp("peanut-butter-jar", 1.16, 1.55, -1.45, 0.43).rotation.y =
      -0.25;
    this.card("CRUNCHY", 1.53, -1.1, 1.05, 0.76, 0.26, "#f8ddb0");

    const areas = portrait.paintPoints().map((point, i) => ({
      ...point,
      rx: i < 2 ? 0.28 : 0.18,
      ry: i < 2 ? 0.28 : 0.22,
      guide: this.marker(point.x, point.y, point.z + 0.02, 0.19, "#8f502c"),
      covered: false,
    }));
    const butter = new THREE.MeshBasicMaterial({ color: "#b66b2e" });
    const brush = new THREE.CircleGeometry(0.115, 9);
    const stamps: THREE.Mesh[] = [];
    this.readout.status = "0 of 4 spots coated";
    const paint = (at: Point) => {
      const area = areas.find(
        (zone) =>
          Math.hypot(
            (at.x - zone.x) / (zone.rx + 0.08),
            (at.y - zone.y) / (zone.ry + 0.07),
          ) < 1,
      );
      if (!area || this.readout.disabled) return;
      const x = THREE.MathUtils.clamp(
        at.x,
        area.x - area.rx * 0.75,
        area.x + area.rx * 0.75,
      );
      const y = THREE.MathUtils.clamp(
        at.y,
        area.y - area.ry * 0.75,
        area.y + area.ry * 0.75,
      );
      const previous = stamps[stamps.length - 1];
      if (
        stamps.length < 68 &&
        (!previous || distance(previous.position, { x, y }) > 0.055)
      ) {
        const mark = new THREE.Mesh(brush, butter);
        mark.position.set(x, y, area.z + 0.018 + stamps.length * 0.00038);
        mark.scale.set(1 + (stamps.length % 3) * 0.15, 1.25, 1);
        mark.rotation.z = stamps.length * 0.71;
        stamps.push(mark);
        this.stage.add(mark);
      }
      if (area.covered) return;
      area.covered = true;
      this.onCue("spread");
      area.guide.visible = false;
      const covered = areas.filter((zone) => zone.covered).length;
      this.readout.status = covered + " of 4 spots coated";
      if (covered === areas.length) {
        portrait.coat();
        this.finish("Full coverage. Absolutely no notes.");
      }
    };
    return {
      press: (at) => {
        paint(at);
        let last = at;
        return {
          move: (next) => {
            // Fill the stroke between input samples, including on a quick touch swipe.
            const steps = Math.min(
              24,
              Math.max(1, Math.ceil(distance(last, next) / 0.11)),
            );
            for (let i = 1; i <= steps; i++)
              paint({
                x: THREE.MathUtils.lerp(last.x, next.x, i / steps),
                y: THREE.MathUtils.lerp(last.y, next.y, i / steps),
              });
            last = next;
          },
        };
      },
      assist: () => {
        const next = areas.find((area) => !area.covered);
        if (next) paint(next);
      },
    };
  }

  private contract(): SceneControls {
    this.setWall(5.6, 2.75, 0.21, -1.05, "#bccfaf", "#6a9b87");
    this.block(5.4, 0.39, 1.05, "#285950", 0, -1.15, 0);
    this.block(5.4, 0.095, 1.1, "#e1a975", 0, -0.9, 0);
    this.block(5.35, 0.055, 1.12, "#6ba39a", 0, -1.14, 0);
    const gull = this.addProp("gull", 1.72, 0.9, -0.84, -0.26);
    gull.rotation.y = -1.23;
    this.block(1.57, 0.9, 0.12, "#fcf5df", 0.9, -0.46, 0.64).rotation.z = -0.07;
    this.card("CEO CONTRACT", 0.9, -0.19, 0.72, 1.41, 0.19, "#f9e8bf");
    this.card("X", 0.26, -0.69, 0.72, 0.18, 0.15, "#fcf5df", "#98715c");
    const signature = this.card(
      "SIGNED: GULL",
      0.91,
      -0.68,
      0.76,
      1.15,
      0.2,
      "#fcf5df",
      "#b85c5e",
    );
    signature.rotation.z = -0.11;
    signature.visible = false;
    const drop = { x: 0.91, y: -0.48 };
    const rim = this.marker(drop.x, drop.y, 0.82, 0.43, "#9c5a36");
    this.block(1.93, 0.6, 0.12, "#f8e9c9", -1.5, -0.5, 0.6);
    this.card("BRIBES", -1.5, -0.96, 0.6, 1.18, 0.24, "#f4d584");
    const geometry = new THREE.DodecahedronGeometry(0.18);
    const material = mat("#d39343");
    const crumbs = [-2.08, -1.5, -0.92].map((x, index) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, -0.5, 0.95);
      mesh.rotation.set(0.37, index * 1.2, index * 0.4);
      this.stage.add(mesh);
      return { mesh, x, eaten: false };
    });
    let bites = 0;
    let bob = 0;
    this.readout.status = "0 of 3 crumbs accepted";
    const feed = (crumb: (typeof crumbs)[number]) => {
      crumb.eaten = true;
      this.onCue("crumb");
      crumb.mesh.visible = false;
      bob = this.motion.matches ? 0 : 0.48;
      bites++;
      this.readout.status = bites + " of 3 crumbs accepted";
      if (bites === crumbs.length) {
        signature.visible = true;
        rim.visible = false;
        this.finish("Signed. The CEO declined to read the contract.");
      }
    };
    return {
      press: (at) => {
        const crumb = crumbs.find(
          (item) => !item.eaten && distance(at, item.mesh.position) < 0.3,
        );
        if (!crumb) return null;
        const reset = () => crumb.mesh.position.set(crumb.x, -0.5, 0.95);
        return {
          move: (next) => crumb.mesh.position.set(next.x, next.y, 1.2),
          release: (next) => {
            if (distance(next, drop) <= 0.59) feed(crumb);
            else {
              reset();
              this.readout.status = "Try dropping the crumb on the contract.";
            }
          },
          cancel: reset,
        };
      },
      assist: () => {
        const crumb = crumbs.find((item) => !item.eaten);
        if (crumb) feed(crumb);
      },
      tick: (dt) => {
        bob = Math.max(0, bob - dt);
        gull.rotation.z = -Math.sin((bob / 0.48) * Math.PI) * 0.22;
        gull.position.y = -0.84 + Math.sin((bob / 0.48) * Math.PI) * 0.18;
      },
    };
  }

  private peel(): SceneControls {
    this.setWall(3.65, 3.8, 0.02, -0.86, "#e9c477", "#ae7955");
    this.block(3.1, 0.19, 0.89, "#365b65", 0, -1.61, -0.12);
    this.card(
      "STRATEGIC PARTNER",
      0,
      -1.58,
      0.4,
      2.46,
      0.27,
      "#365b65",
      "#ffe2a1",
    );
    const base = new THREE.Vector3(-0.33, -1.12, 0);
    const path = new THREE.CatmullRomCurve3([
      base.clone(),
      new THREE.Vector3(0.02, -0.65, 0),
      new THREE.Vector3(0.28, 0.03, 0),
      new THREE.Vector3(0.31, 0.67, 0),
      new THREE.Vector3(0.08, 1.43, 0),
    ]);
    const flesh = new THREE.Mesh(
      new THREE.TubeGeometry(path, 20, 0.248, 10, false),
      mat("#fff0c6"),
    );
    this.stage.add(flesh);
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.248, 10, 8),
      mat("#fff0c6"),
    );
    crown.position.copy(path.getPoint(1));
    this.stage.add(crown);

    // Three curved strips share the fruit's center line and hinge at the bottom.
    const strips = [0, 1, 2].map((i) => {
      const positions: number[] = [],
        indices: number[] = [];
      const midpoint = [(7 * Math.PI) / 6, Math.PI / 2, -Math.PI / 6][i];
      const rows = 22,
        sides = 7;
      for (let row = 0; row <= rows; row++) {
        const t = row / rows;
        const point = path.getPoint(t).sub(base);
        const direction = path.getTangent(t);
        for (let col = 0; col <= sides; col++) {
          const angle =
            midpoint + (col / sides - 0.5) * ((Math.PI * 2) / 3 - 0.025);
          const radius = 0.291 + 0.028 * Math.sin(t * Math.PI);
          const cross = Math.cos(angle) * radius;
          positions.push(
            point.x + direction.y * cross,
            point.y - direction.x * cross,
            Math.sin(angle) * radius,
          );
          if (row === rows || col === sides) continue;
          const a = row * (sides + 1) + col;
          indices.push(
            a,
            a + 1,
            a + sides + 1,
            a + 1,
            a + sides + 2,
            a + sides + 1,
          );
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const material = mat(["#e9ab38", "#facb48", "#efb43a"][i]);
      material.side = THREE.DoubleSide;
      const hinge = new THREE.Group();
      hinge.position.copy(base);
      hinge.add(new THREE.Mesh(geometry, material));
      this.stage.add(hinge);
      const target = { x: [-0.48, 0.08, 0.64][i], y: [1.24, 1.62, 1.24][i] };
      const tab = this.block(
        0.27,
        0.24,
        0.1,
        "#ffdc58",
        target.x,
        target.y,
        0.49,
      );
      tab.rotation.z = [0.27, 0, -0.27][i];
      const arrow = this.card("↓", 0, 0, 0, 0.18, 0.16, "#ffe174", "#493737");
      arrow.position.set(0, 0, 0.052);
      tab.add(arrow);
      const guide = this.marker(target.x, target.y, 0.57, 0.21, "#895127");
      return {
        hinge,
        tab,
        guide,
        target,
        peeled: false,
        opening: 0,
        display: 0,
        i,
      };
    });
    this.readout.status = "0 of 3 strips peeled";
    const open = (strip: (typeof strips)[number]) => {
      strip.peeled = true;
      this.onCue("peel");
      strip.opening = 1;
      strip.tab.visible = false;
      strip.guide.visible = false;
      const peeled = strips.filter((candidate) => candidate.peeled).length;
      this.readout.status = peeled + " of 3 strips peeled";
      if (peeled === strips.length)
        this.finish("The strategic partner has been unwrapped.");
    };
    return {
      press: (at) => {
        const strip = strips.find(
          (candidate) =>
            !candidate.peeled && distance(at, candidate.target) < 0.33,
        );
        if (!strip) return null;
        const move = (next: Point) => {
          strip.opening = THREE.MathUtils.clamp((at.y - next.y) / 1.05, 0, 1);
          strip.tab.position.y = strip.target.y - strip.opening * 0.55;
          strip.guide.visible = strip.opening < 0.08;
        };
        const reset = () => {
          strip.opening = 0;
          strip.tab.position.y = strip.target.y;
          strip.guide.visible = true;
        };
        return {
          move,
          release: (next) => {
            move(next);
            if (strip.opening >= 0.7) open(strip);
            else {
              reset();
              this.readout.status = "Pull a little farther down.";
            }
          },
          cancel: reset,
        };
      },
      assist: () => {
        const strip = strips.find((candidate) => !candidate.peeled);
        if (strip) open(strip);
      },
      tick: (dt) => {
        for (const strip of strips) {
          strip.display = THREE.MathUtils.damp(
            strip.display,
            strip.opening,
            16,
            dt,
          );
          strip.hinge.rotation.x = [0.19, 2.18, 0.19][strip.i] * strip.display;
          strip.hinge.rotation.z = [1.54, 0.12, -1.53][strip.i] * strip.display;
        }
      },
    };
  }

  private hotdog(ticker: string): SceneControls {
    this.setWall(5.95, 3.05, 0.05, -0.9, "#f2d7ab", "#ba7459");
    for (let i = 0; i < 9; i++) {
      this.block(
        0.66,
        0.29,
        0.13,
        i % 2 === 0 ? "#d87961" : "#ffe1ad",
        (i - 4) * 0.66,
        1.43,
        -0.75,
      );
    }
    this.card(
      "QUANTUM HOT DOGS",
      0,
      1.1,
      -0.7,
      2.94,
      0.37,
      "#253e4b",
      "#ffe4ae",
    );
    this.block(5.84, 0.14, 1.2, "#ecc68f", 0, -0.87, -0.25);
    this.block(5.64, 0.44, 0.93, "#bc674c", 0, -1.13, -0.32);
    this.block(5.64, 0.05, 0.975, "#f3c58c", 0, -1.19, -0.32);
    // Keep the order stable on re-entry, with a different layout for different coins.
    const dish =
      [...ticker].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 3;
    const trayY = -0.52;
    const coverY = -0.62;
    const coverShape = new THREE.SphereGeometry(
      0.68,
      24,
      10,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2,
    );
    const trays = [-1.85, 0, 1.85].map((x, i) => {
      this.block(1.62, 0.14, 0.92, "#d5c1a1", x, -0.73, 0.07);
      this.block(1.53, 0.09, 0.88, "#fff2d3", x, -0.65, 0.1);
      const lid = new THREE.Group();
      lid.position.set(x, coverY, 0.68);
      const enamel = mat(["#6199b0", "#cf7f72", "#66a58e"][i]);
      enamel.roughness = 0.34;
      const dome = new THREE.Mesh(coverShape, enamel);
      dome.scale.z = 0.71;
      lid.add(
        dome,
        box(1.43, 0.075, 0.78, "#35505b", 0, -0.015, 0),
        box(0.4, 0.13, 0.22, "#ffe1a4", 0, 0.71, 0),
      );
      this.stage.add(lid);
      const side = (i - dish + 3) % 3 === 1;
      const caption =
        i === dish
          ? "There it is. Tap the hot dog to serve."
          : side
            ? "Just mustard. The hot dog is sold separately from itself."
            : "An IOU for one bun. Estimated delivery: next quarter.";
      const item = new THREE.Group();
      item.position.set(x, trayY, 0.36);
      if (i === dish) {
        const bun = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.177, 0.8, 5, 12),
          mat("#e8af6f"),
        );
        const sausage = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.099, 0.87, 5, 12),
          mat("#af6147"),
        );
        bun.rotation.z = sausage.rotation.z = Math.PI / 2;
        sausage.position.set(-0.018, 0.13, 0.09);
        item.add(bun, sausage);
      } else if (side) {
        const zigzag = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-0.45, 0.14, 0.18),
          new THREE.Vector3(-0.2, -0.04, 0.18),
          new THREE.Vector3(0.05, 0.13, 0.18),
          new THREE.Vector3(0.26, -0.04, 0.18),
          new THREE.Vector3(0.43, 0.12, 0.18),
        ]);
        item.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(zigzag, 21, 0.04, 7, false),
            mat("#ecb941"),
          ),
        );
      } else {
        const iou = this.card(
          "IOU ONE BUN",
          0,
          0.03,
          0.23,
          1.15,
          0.45,
          "#fff7db",
          "#85534d",
        );
        iou.rotation.z = -0.11;
        item.add(iou);
      }
      item.visible = false;
      this.stage.add(item);
      return { x, i, lid, item, caption, opened: false };
    });
    this.readout.status = "Inspect the covered trays.";
    const reveal = (tray: (typeof trays)[number], amount: number) => {
      tray.lid.position.set(
        tray.x + (tray.i - 1) * amount * 0.35,
        coverY + 0.77 * amount,
        0.68,
      );
      tray.lid.rotation.z = (tray.i - 1) * amount * 0.26;
      tray.item.visible = tray.opened || amount > 0.56;
    };
    const serve = () => {
      if (trays[dish].opened)
        this.finish("Lunch confirmed. The bun is in the next update.");
    };
    const open = (tray: (typeof trays)[number]) => {
      tray.opened = true;
      this.onCue("lid");
      reveal(tray, 1);
      this.readout.status = tray.caption;
      if (trays[dish].opened) this.readout.action = "Serve hot dog";
    };
    const target = { x: trays[dish].x, y: trayY };
    return {
      press: (at) => {
        if (trays[dish].opened && distance(at, target) < 0.56) {
          return {
            release: (next) => {
              if (distance(next, target) < 0.56) serve();
            },
          };
        }
        const tray = trays.find(
          (candidate) =>
            !candidate.opened &&
            Math.abs(at.x - candidate.x) < 0.71 &&
            at.y > coverY - 0.06 &&
            at.y < coverY + 0.85,
        );
        if (!tray) return null;
        const lift = (next: Point) =>
          THREE.MathUtils.clamp(
            Math.max(Math.abs(next.x - at.x), next.y - at.y) / 0.83,
            0,
            1,
          );
        return {
          move: (next) => reveal(tray, lift(next)),
          release: (next) => {
            if (lift(next) >= 0.77) open(tray);
            else {
              reveal(tray, 0);
              this.readout.status = "Slide the lid a little farther.";
            }
          },
          cancel: () => reveal(tray, 0),
        };
      },
      assist: () => {
        if (trays[dish].opened) serve();
        else {
          const tray = trays.find((candidate) => !candidate.opened);
          if (tray) open(tray);
        }
      },
    };
  }

  private crown(player: Player): SceneControls {
    this.setWall(5.48, 3.55, 0.05, -1.16, "#94b4a1", "#497e76");
    this.block(3.88, 0.23, 1.12, "#ba845e", 0.69, -0.96, -0.26);
    this.block(3.92, 0.055, 1.14, "#ffe0a7", 0.69, -0.98, -0.26);
    this.card(
      "HORSESHOE COURT",
      -1.12,
      0.93,
      -0.76,
      1.89,
      0.38,
      "#284650",
      "#ffe0a7",
    );
    this.card("CROWN DIVISION", -1.12, 0.57, -0.75, 1.6, 0.24, "#d1ddb2");
    const portrait = player.portrait();
    this.portraits.push(portrait);
    const hero = portrait.group;
    hero.position.set(0.76, -0.87, -0.04);
    hero.rotation.set(0, -0.13, 0);
    hero.scale.setScalar(2 / player.character.height);
    this.stage.add(hero);
    this.borrowed.push(hero);

    const target = new THREE.Vector3(
      hero.position.x,
      hero.position.y + 2,
      0.01,
    );
    const launcher = new THREE.Vector3(0, -1.62, 0.85);
    this.block(1.42, 0.2, 0.68, "#386a66", launcher.x, -1.74, launcher.z);
    this.block(1.41, 0.045, 0.7, "#dfba73", launcher.x, -1.74, launcher.z);
    const crown = this.addProp(
      "crown",
      0.95,
      launcher.x,
      launcher.y,
      launcher.z,
    );
    const headMark = this.marker(
      target.x,
      target.y + 0.12,
      0.94,
      0.43,
      "#51967c",
    );
    const sight = this.marker(0, target.y + 0.12, 1.05, 0.14, "#cc874a");
    let charging = false,
      chargeTime = 0;
    let confetti: THREE.Group | null = null,
      celebrationTime = 0;
    let flight: {
      time: number;
      destination: THREE.Vector3;
      landed: boolean;
      miss: string;
    } | null = null;
    this.readout.status = "Line up the small ring with your head.";
    const aim = (value: number) => {
      this.readout.aim = THREE.MathUtils.clamp(
        value,
        -CROWN_AIM_LIMIT,
        CROWN_AIM_LIMIT,
      );
      sight.position.x = this.readout.aim;
      (sight.material as THREE.MeshBasicMaterial).color.set(
        Math.abs(this.readout.aim - target.x) <= 0.41 ? "#499379" : "#cc874a",
      );
    };
    const charge = () => {
      if (charging || flight || this.readout.disabled) return false;
      charging = true;
      chargeTime = 0;
      this.readout.power = 0;
      this.readout.action = "Toss crown";
      this.readout.status = "Release in the green band.";
      return true;
    };
    const release = () => {
      if (!charging) return;
      charging = false;
      const power = this.readout.power;
      const aligned = Math.abs(this.readout.aim - target.x) <= 0.41;
      const powered = power >= CROWN_POWER.low && power <= CROWN_POWER.high;
      const landed = aligned && powered;
      flight = {
        time: 0,
        destination: landed
          ? target.clone()
          : new THREE.Vector3(
              this.readout.aim,
              powered ? target.y - 0.7 : target.y + (power - 0.57) * 3.65,
              -0.12,
            ),
        landed,
        miss: !powered
          ? power < CROWN_POWER.low
            ? "Short throw."
            : "Too much power."
          : "Missed the head.",
      };
      this.readout.disabled = true;
      this.readout.status = "Crown in the air…";
      this.readout.action = "Crown in the air…";
    };
    return {
      press: (at) => {
        if (
          distance(at, { x: launcher.x, y: launcher.y + 0.31 }) > 0.63 ||
          !charge()
        )
          return null;
        const startAim = this.readout.aim;
        const move = (next: Point) => aim(startAim + next.x - at.x);
        return {
          move,
          release: (next) => {
            move(next);
            release();
          },
          cancel: () => {
            charging = false;
            this.readout.power = 0;
            this.readout.action = "Charge crown";
            this.readout.status = "Hold the crown to try again.";
          },
        };
      },
      aim,
      assist: () => {
        if (charging) release();
        else charge();
      },
      tick: (dt) => {
        if (confetti) {
          celebrationTime += dt;
          confetti.children.forEach((piece, i) => {
            const angle = i * 2.39996;
            piece.position.x =
              Math.cos(angle) * celebrationTime * (1.1 + (i % 4) * 0.33);
            piece.position.y =
              Math.sin(angle) * celebrationTime * 1.45 -
              celebrationTime * celebrationTime * 1.55;
            piece.rotation.y += dt * 5;
          });
        }
        if (charging) {
          chargeTime += dt;
          const sweep = (chargeTime / 1.08) % 2;
          this.readout.power = sweep > 1 ? 2 - sweep : sweep;
          crown.rotation.y = chargeTime * 1.5;
          return;
        }
        if (!flight) return;
        flight.time += dt;
        const t = Math.min(flight.time / 0.72, 1);
        crown.position.lerpVectors(launcher, flight.destination, t);
        crown.position.y += Math.sin(t * Math.PI) * 1.16;
        crown.rotation.set(0, t * Math.PI * 2, Math.sin(t * Math.PI) * 0.23);
        if (t < 1) return;
        const shot = flight;
        flight = null;
        if (shot.landed) {
          this.onCue("crownHit");
          crown.rotation.set(0, -0.13, 0);
          headMark.visible = false;
          sight.visible = false;
          if (!this.motion.matches) {
            confetti = new THREE.Group();
            const paper = new THREE.PlaneGeometry(0.095, 0.15);
            const colors = ["#ffbf71", "#f68d77", "#dffa96"].map(
              (color) =>
                new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
            );
            for (let i = 0; i < 20; i++) {
              const piece = new THREE.Mesh(paper, colors[i % colors.length]);
              piece.rotation.z = i * 1.8;
              confetti.add(piece);
            }
            confetti.position.set(target.x, target.y + 0.29, 1.22);
            this.stage.add(confetti);
          }
          this.finish("Ringer. All hail the Slopmeister.");
        } else {
          this.onCue("crownMiss");
          crown.position.copy(launcher);
          crown.rotation.set(0, 0, 0);
          this.readout.disabled = false;
          this.readout.power = 0;
          this.readout.action = "Charge crown";
          this.readout.status = shot.miss + " Take another toss.";
        }
      },
    };
  }
}
