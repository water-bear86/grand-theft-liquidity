import * as THREE from "three";
import {
  CLEAN_HITS_TO_END,
  MISS_SCORE,
  SHOT_COUNT,
  TARGET_COUNT,
  TARGET_RADIUS,
  MIN_SHOT_GAP_SEC,
  type ShotInput,
} from "./gallery-protocol.ts";
import {
  CAMERA_ORIGIN,
  evaluateRound,
  layoutAt,
} from "./gallery-sim.ts";

export type GallerySceneHooks = {
  onShot: (info: {
    remaining: number;
    score: number;
    last: string;
    forfeit: boolean;
    finished: boolean;
    skippedFifth: boolean;
  }) => void;
  onFinished: (shots: ShotInput[], forfeit: boolean) => void;
};

function targetTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rings: [number, string][] = [
    [1, "#fff1d6"],
    [0.58, "#ff8c73"],
    [0.32, "#ffe0a8"],
    [0.12, "#1b615e"],
  ];
  for (const [frac, color] of rings) {
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(size / 2, size / 2, frac * (size / 2 - 4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#142a38";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#dffa96";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 0.045 * size, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class GalleryScene {
  canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private targets: THREE.Mesh[] = [];
  private dropped = new Set<number>();
  private seed = "";
  private forfeitUnknown = true;
  private shots: ShotInput[] = [];
  private lastShotAt = -Infinity;
  private started = 0;
  private running = false;
  private finished = false;
  private frame = 0;
  private pointer = { x: 0, y: 0 };
  private hooks: GallerySceneHooks;
  private onMove: (event: PointerEvent) => void;
  private onClick: (event: PointerEvent) => void;
  private onResize: () => void;

  constructor(host: HTMLElement, hooks: GallerySceneHooks) {
    this.hooks = hooks;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "gallery-canvas";
    host.append(this.canvas);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x0e212c, 1);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 80);
    this.camera.position.set(CAMERA_ORIGIN.x, CAMERA_ORIGIN.y, CAMERA_ORIGIN.z);
    this.camera.lookAt(0, 1.45, -15);
    this.buildWorld();
    this.onResize = () => this.resize();
    this.onMove = (event) => {
      const bounds = this.canvas.getBoundingClientRect();
      this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      this.pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
      const hair = this.canvas.parentElement?.querySelector<HTMLElement>(".gallery-crosshair");
      if (hair) {
        hair.style.left = `${event.clientX - bounds.left}px`;
        hair.style.top = `${event.clientY - bounds.top}px`;
      }
    };
    this.onClick = (event) => {
      this.onMove(event);
      this.shoot();
    };
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerdown", this.onClick);
    window.addEventListener("resize", this.onResize);
    this.resize();
  }

  start(seed: string) {
    this.seed = seed;
    this.shots = [];
    this.dropped.clear();
    this.lastShotAt = -Infinity;
    this.finished = false;
    this.forfeitUnknown = true;
    this.started = performance.now();
    this.running = true;
    for (const mesh of this.targets) {
      mesh.visible = true;
      mesh.rotation.set(0, 0, 0);
      (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
    }
    this.tick();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  dispose() {
    this.stop();
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerdown", this.onClick);
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
    this.canvas.remove();
  }

  remaining() {
    return Math.max(0, SHOT_COUNT - this.shots.length);
  }

  currentShots() {
    return this.shots.slice();
  }

  private buildWorld() {
    this.scene.fog = new THREE.Fog(0x0e212c, 12, 36);
    this.scene.add(new THREE.AmbientLight(0xffe0a8, 0.55));
    const key = new THREE.DirectionalLight(0xfff1d6, 1.15);
    key.position.set(-4, 8, 6);
    this.scene.add(key);
    const rim = new THREE.PointLight(0xff8c73, 18, 28, 2);
    rim.position.set(6, 3, -6);
    this.scene.add(rim);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(28, 48),
      new THREE.MeshStandardMaterial({ color: 0x16313c, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.7, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x2a1a16, roughness: 0.7 }),
    );
    counter.position.set(0, 0.35, 1.2);
    this.scene.add(counter);
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 9),
      new THREE.MeshStandardMaterial({ color: 0x12232d, roughness: 1 }),
    );
    back.position.set(0, 3.4, -19);
    this.scene.add(back);
    const tex = targetTexture();
    const geometry = new THREE.CircleGeometry(TARGET_RADIUS, 48);
    for (let i = 0; i < TARGET_COUNT; i++) {
      const material = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.45,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      this.targets.push(mesh);
      this.scene.add(mesh);
    }
    // Stands
    for (let i = 0; i < TARGET_COUNT; i++) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.05, 2.4, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a2a22 }),
      );
      post.position.set((i - (TARGET_COUNT - 1) / 2) * 1.85, 0.7, -15.6);
      this.scene.add(post);
    }
  }

  private resize() {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth || window.innerWidth;
    const height = parent?.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  private t() {
    return (performance.now() - this.started) / 1000;
  }

  private aimFromPointer() {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(this.pointer.x, this.pointer.y), this.camera);
    const dir = ray.ray.direction;
    const horiz = Math.hypot(dir.x, dir.z);
    return {
      yaw: Math.atan2(dir.x, -dir.z),
      pitch: Math.atan2(dir.y, horiz),
    };
  }

  private shoot() {
    if (!this.running || this.finished) return;
    const t = this.t();
    if (t - this.lastShotAt < MIN_SHOT_GAP_SEC) return;
    const aim = this.aimFromPointer();
    const shot: ShotInput = { t, yaw: aim.yaw, pitch: aim.pitch };
    this.shots.push(shot);
    this.lastShotAt = t;
    const preview = evaluateRound({
      seed: this.seed,
      forfeitIndex: -1,
      shots: this.shots,
      elapsedSec: t + 0.5,
    });
    let last = "Miss · 25";
    let forfeit = false;
    if (!("error" in preview)) {
      const latest = preview.shots.at(-1);
      if (latest?.targetIndex != null) {
        this.dropped.add(latest.targetIndex);
        const mesh = this.targets[latest.targetIndex];
        if (mesh) (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x1b615e);
        last =
          latest.ring === 0
            ? "Bullseye · 5"
            : latest.ring === 1
              ? "Inner ring · 10"
              : latest.ring === 2
                ? "Middle ring · 15"
                : "Outer ring · 20";
      } else last = `Miss · ${MISS_SCORE}`;
    }
    const done =
      this.shots.length >= SHOT_COUNT ||
      (!("error" in preview) && preview.cleanHits >= CLEAN_HITS_TO_END);
    this.hooks.onShot({
      remaining: Math.max(0, SHOT_COUNT - this.shots.length),
      score: "error" in preview || preview.status !== "scored" ? 0 : preview.score,
      last,
      forfeit,
      finished: done,
      skippedFifth: !("error" in preview) && preview.skippedFifth,
    });
    if (done) {
      this.finished = true;
      this.hooks.onFinished(this.shots, false);
    }
  }

  private tick = () => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.tick);
    const t = this.t();
    if (this.seed) {
      const layout = layoutAt(this.seed, t);
      for (const pose of layout) {
        const mesh = this.targets[pose.index];
        if (!mesh) continue;
        if (this.dropped.has(pose.index)) {
          mesh.rotation.x = Math.min(mesh.rotation.x + 0.08, Math.PI / 2);
          continue;
        }
        mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
        mesh.lookAt(this.camera.position);
      }
    }
    this.renderer.render(this.scene, this.camera);
  };
}
