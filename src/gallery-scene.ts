import * as THREE from "three";
import {
  CLEAN_HITS_TO_END,
  MISS_SCORE,
  SHOT_COUNT,
  TARGET_RADIUS,
  MIN_SHOT_GAP_SEC,
  type ShotInput,
} from "./gallery-protocol.ts";
import {
  aimWithRecoil,
  applyRelativeDrag,
  isFireControl,
  isGalleryControl,
  isLikelyMobile,
  pointerFromClient,
  preventGesture,
  recoilKick,
  recoilOffset,
  type RecoilImpulse,
} from "./gallery-input.ts";
import {
  CAMERA_ORIGIN,
  actorsAt,
  evaluateRound,
  type ActorPose,
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

function paintSign(title: string, subtitle: string, bg: string, ink: string) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 14;
  ctx.strokeRect(16, 16, size - 32, size - 32);
  ctx.fillStyle = ink;
  ctx.font = "800 92px Avenir Next Condensed, Arial Narrow, Impact, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(title, size / 2, 230);
  ctx.font = "700 42px Avenir Next, Segoe UI, sans-serif";
  ctx.fillText(subtitle, size / 2, 320);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function targetTexture(kind: "live" | "rug" | "bystander" | "bonus") {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const palettes = {
    live: ["#fff1d6", "#ff8c73", "#ffe0a8", "#1b615e"],
    rug: ["#3a1020", "#ff8c73", "#6b1d2c", "#fff1d6"],
    bystander: ["#24364a", "#9db5ba", "#fff1d6", "#142a38"],
    bonus: ["#142a38", "#dffa96", "#ffe0a8", "#1b615e"],
  } as const;
  const rings: [number, string][] = [
    [1, palettes[kind][0]],
    [0.58, palettes[kind][1]],
    [0.32, palettes[kind][2]],
    [0.12, palettes[kind][3]],
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
  if (kind !== "live") {
    ctx.fillStyle = kind === "bonus" ? "#142a38" : "#fff1d6";
    ctx.font = "800 78px Avenir Next Condensed, Arial Narrow, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(kind === "rug" ? "RUG" : kind === "bystander" ? "NPC" : "$", size / 2, size / 2);
  } else {
    ctx.fillStyle = "#dffa96";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 0.045 * size, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function crateTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#6b4a2c";
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "#3a2a16";
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 240, 240);
  ctx.fillStyle = "#ffe0a8";
  ctx.font = "800 42px Avenir Next Condensed, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("LOCKED LP", 128, 140);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type MeshActor = {
  id: string;
  kind: ActorPose["kind"];
  mesh: THREE.Object3D;
};

export class GalleryScene {
  canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private play: HTMLElement;
  private background = new THREE.Group();
  private actors = new Map<string, MeshActor>();
  private dropped = new Set<string>();
  private seed = "";
  private shots: ShotInput[] = [];
  private lastShotAt = -Infinity;
  private started = 0;
  private running = false;
  private finished = false;
  private frame = 0;
  private pointer = { x: 0, y: 0, localX: 0.5, localY: 0.5 };
  private base = { localX: 0.5, localY: 0.5 };
  private recoil: RecoilImpulse[] = [];
  private aimPointer: { id: number; x: number; y: number } | null = null;
  private hooks: GallerySceneHooks;
  private textures: THREE.Texture[];
  private feedback: HTMLElement | null = null;
  private flash: HTMLElement | null = null;
  private hair: HTMLElement | null = null;
  private fireButton: HTMLElement | null = null;
  private onPointerMove: (event: PointerEvent) => void;
  private onPointerDown: (event: PointerEvent) => void;
  private onPointerUp: (event: PointerEvent) => void;
  private onFire: (event: PointerEvent) => void;
  private onTouch: (event: TouchEvent) => void;
  private onResize: () => void;
  private onGesture: (event: Event) => void;

  constructor(host: HTMLElement, hooks: GallerySceneHooks) {
    this.hooks = hooks;
    this.play = host.closest(".gallery-play") ?? host.parentElement ?? host;
    this.play.classList.add("is-live");
    this.canvas = document.createElement("canvas");
    this.canvas.className = "gallery-canvas";
    this.canvas.setAttribute("aria-label", "Shooting gallery range");
    host.append(this.canvas);
    this.hair = this.play.querySelector(".gallery-crosshair");
    this.feedback = this.play.querySelector(".gallery-feedback");
    this.flash = this.play.querySelector(".gallery-flash");
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
    });
    this.renderer.setClearColor(0x0e212c, 1);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);
    this.camera.position.set(CAMERA_ORIGIN.x, CAMERA_ORIGIN.y, CAMERA_ORIGIN.z);
    this.camera.lookAt(0, 1.45, -15);
    const live = targetTexture("live");
    const rug = targetTexture("rug");
    const npc = targetTexture("bystander");
    const bonus = targetTexture("bonus");
    const crate = crateTexture();
    this.textures = [live, rug, npc, bonus, crate];
    this.buildWorld(live, rug, npc, bonus, crate);
    if (isLikelyMobile()) this.play.classList.add("is-touch");
    this.fireButton = this.play.querySelector("#gallery-fire, .gallery-fire");
    this.onResize = () => this.resize();
    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerDown = (event) => this.handlePointerDown(event);
    this.onPointerUp = (event) => this.handlePointerUp(event);
    this.onFire = (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      this.syncDisplayed();
      this.shoot();
    };
    this.onTouch = (event) => {
      if (isGalleryControl(event.target)) return;
      preventGesture(event);
    };
    this.onGesture = (event) => preventGesture(event);
    const pointerOpts = { passive: false } as const;
    this.play.addEventListener("pointermove", this.onPointerMove);
    this.play.addEventListener("pointerdown", this.onPointerDown, pointerOpts);
    this.play.addEventListener("pointerup", this.onPointerUp);
    this.play.addEventListener("pointercancel", this.onPointerUp);
    this.play.addEventListener("touchstart", this.onTouch, pointerOpts);
    this.play.addEventListener("touchmove", this.onTouch, pointerOpts);
    this.play.addEventListener("gesturestart", this.onGesture, pointerOpts);
    this.fireButton?.addEventListener("pointerdown", this.onFire, pointerOpts);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);
    visualViewport?.addEventListener("resize", this.onResize);
    visualViewport?.addEventListener("scroll", this.onResize);
    this.resize();
    this.centerHair();
  }

  start(seed: string) {
    this.seed = seed;
    this.shots = [];
    this.dropped.clear();
    this.lastShotAt = -Infinity;
    this.finished = false;
    this.recoil = [];
    this.started = performance.now();
    this.running = true;
    for (const actor of this.actors.values()) {
      actor.mesh.visible = true;
      if (actor.mesh instanceof THREE.Mesh) {
        actor.mesh.rotation.set(0, 0, 0);
        const material = actor.mesh.material;
        if (material instanceof THREE.MeshStandardMaterial) material.emissive.setHex(0x000000);
      }
    }
    this.tick();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  dispose() {
    this.stop();
    this.play.classList.remove("is-live", "is-touch");
    this.play.removeEventListener("pointermove", this.onPointerMove);
    this.play.removeEventListener("pointerdown", this.onPointerDown);
    this.play.removeEventListener("pointerup", this.onPointerUp);
    this.play.removeEventListener("pointercancel", this.onPointerUp);
    this.play.removeEventListener("touchstart", this.onTouch);
    this.play.removeEventListener("touchmove", this.onTouch);
    this.play.removeEventListener("gesturestart", this.onGesture);
    this.fireButton?.removeEventListener("pointerdown", this.onFire);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onResize);
    visualViewport?.removeEventListener("resize", this.onResize);
    visualViewport?.removeEventListener("scroll", this.onResize);
    for (const texture of this.textures) texture.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  remaining() {
    return Math.max(0, SHOT_COUNT - this.shots.length);
  }

  currentShots() {
    return this.shots.slice();
  }

  private isMousePointer(event: PointerEvent) {
    return event.pointerType === "mouse" || event.pointerType === "";
  }

  private handlePointerDown(event: PointerEvent) {
    if (isFireControl(event.target)) return;
    if (isGalleryControl(event.target)) return;
    if (!this.isMousePointer(event) && event.cancelable) event.preventDefault();
    if (this.isMousePointer(event)) {
      if (event.button !== 0) return;
      this.setBaseFromClient(event.clientX, event.clientY);
      this.syncDisplayed();
      this.shoot();
      return;
    }
    if (this.aimPointer) return;
    this.aimPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try {
      this.play.setPointerCapture(event.pointerId);
    } catch {
      // not all targets allow capture
    }
  }

  private handlePointerMove(event: PointerEvent) {
    if (this.isMousePointer(event)) {
      if (isGalleryControl(event.target)) return;
      this.setBaseFromClient(event.clientX, event.clientY);
      this.syncDisplayed();
      return;
    }
    if (!this.aimPointer || event.pointerId !== this.aimPointer.id) return;
    if (event.cancelable) event.preventDefault();
    const dx = event.clientX - this.aimPointer.x;
    const dy = event.clientY - this.aimPointer.y;
    this.aimPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    const bounds = this.canvas.getBoundingClientRect();
    this.base = applyRelativeDrag(this.base, dx, dy, bounds);
    this.syncDisplayed();
  }

  private handlePointerUp(event: PointerEvent) {
    if (this.aimPointer?.id !== event.pointerId) return;
    try {
      this.play.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
    this.aimPointer = null;
  }

  private setBaseFromClient(clientX: number, clientY: number) {
    const bounds = this.canvas.getBoundingClientRect();
    const mapped = pointerFromClient(clientX, clientY, bounds);
    this.base.localX = mapped.localX;
    this.base.localY = mapped.localY;
  }

  private syncDisplayed(now = performance.now()) {
    const bounds = this.canvas.getBoundingClientRect();
    const offset = recoilOffset(this.recoil, now);
    const displayed = aimWithRecoil(this.base, offset, bounds);
    this.pointer.x = displayed.ndcX;
    this.pointer.y = displayed.ndcY;
    this.pointer.localX = displayed.localX;
    this.pointer.localY = displayed.localY;
    this.placeHair();
  }

  private centerHair() {
    const bounds = this.canvas.getBoundingClientRect();
    this.base.localX = bounds.width / 2;
    this.base.localY = bounds.height / 2;
    this.syncDisplayed();
  }

  private placeHair() {
    if (!this.hair) this.hair = this.play.querySelector(".gallery-crosshair");
    if (!this.hair) return;
    this.hair.style.left = `${this.pointer.localX}px`;
    this.hair.style.top = `${this.pointer.localY}px`;
  }

  private showFeedback(text: string, tone: "hit" | "bonus" | "miss" | "bad") {
    if (!this.feedback) this.feedback = this.play.querySelector(".gallery-feedback");
    if (this.flash) {
      this.flash.classList.remove("is-hot");
      void this.flash.offsetWidth;
      this.flash.classList.add("is-hot");
    }
    if (!this.feedback) return;
    this.feedback.textContent = text;
    this.feedback.dataset.tone = tone;
    this.feedback.style.left = `${this.pointer.localX}px`;
    this.feedback.style.top = `${this.pointer.localY}px`;
    this.feedback.classList.remove("is-on");
    void this.feedback.offsetWidth;
    this.feedback.classList.add("is-on");
  }

  private buildWorld(
    live: THREE.Texture,
    rug: THREE.Texture,
    npc: THREE.Texture,
    bonus: THREE.Texture,
    crate: THREE.Texture,
  ) {
    this.scene.fog = new THREE.Fog(0x0e212c, 18, 64);
    this.scene.add(new THREE.AmbientLight(0xffe0a8, 0.52));
    const key = new THREE.DirectionalLight(0xfff1d6, 1.05);
    key.position.set(-4, 8, 6);
    this.scene.add(key);
    const neon = new THREE.PointLight(0xff8c73, 16, 32, 2);
    neon.position.set(6, 3, -6);
    this.scene.add(neon);
    const mint = new THREE.PointLight(0xdffa96, 8, 24, 2);
    mint.position.set(-7, 4, -10);
    this.scene.add(mint);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(36, 48),
      new THREE.MeshStandardMaterial({ color: 0x16313c, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 24),
      new THREE.MeshStandardMaterial({ color: 0x173a48, roughness: 0.35, metalness: 0.2 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.02, -28);
    this.background.add(water);

    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.7, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x2a1a16, roughness: 0.7 }),
    );
    counter.position.set(0, 0.35, 1.2);
    this.scene.add(counter);

    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 14),
      new THREE.MeshStandardMaterial({ color: 0x12232d, roughness: 1 }),
    );
    back.position.set(0, 4.2, -28);
    this.background.add(back);

    const signs = [
      { title: "WAGMI", subtitle: "LANE 3 OPEN", bg: "#1b615e", ink: "#dffa96", x: -8.5, y: 4.6, z: -22 },
      { title: "RUG PULL", subtitle: "PARKING ONLY", bg: "#6b1d2c", ink: "#fff1d6", x: 8.2, y: 5.1, z: -21.5 },
      { title: "JUMP THE", subtitle: "LIQUIDITY POOL", bg: "#142a38", ink: "#ffe0a8", x: 0.4, y: 6.2, z: -24 },
    ];
    for (const sign of signs) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(5.4, 2.2),
        new THREE.MeshStandardMaterial({
          map: paintSign(sign.title, sign.subtitle, sign.bg, sign.ink),
          roughness: 0.55,
        }),
      );
      mesh.position.set(sign.x, sign.y, sign.z);
      this.textures.push((mesh.material as THREE.MeshStandardMaterial).map!);
      this.background.add(mesh);
    }

    for (let i = 0; i < 5; i++) {
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(3.2 + (i % 2), 4 + (i % 3), 2.4),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0x1a3340 : 0x142a38, roughness: 0.9 }),
      );
      building.position.set(-14 + i * 7, 2.2, -32 - (i % 2) * 2);
      this.background.add(building);
    }

    for (const x of [-11, -3.5, 4.2, 12]) {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.12, 2.4, 6),
        new THREE.MeshStandardMaterial({ color: 0x3a2a16 }),
      );
      trunk.position.set(x, 1.2, -18.5);
      const crown = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x1b615e, roughness: 0.8 }),
      );
      crown.position.set(x, 2.5, -18.5);
      this.background.add(trunk, crown);
    }

    const blimp = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xff8c73, roughness: 0.6 }),
    );
    blimp.scale.set(1.8, 0.7, 0.7);
    blimp.position.set(-16, 8.5, -26);
    blimp.name = "blimp";
    this.background.add(blimp);
    this.scene.add(this.background);

    const liveMat = new THREE.MeshStandardMaterial({
      map: live,
      roughness: 0.45,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(TARGET_RADIUS, 32), liveMat.clone());
      const id = `t:${i}`;
      this.actors.set(id, { id, kind: "target", mesh });
      this.scene.add(mesh);
    }
    const rugMesh = new THREE.Mesh(
      new THREE.CircleGeometry(TARGET_RADIUS * 0.92, 32),
      new THREE.MeshStandardMaterial({ map: rug, roughness: 0.45, side: THREE.DoubleSide }),
    );
    this.actors.set("d:rug", { id: "d:rug", kind: "decoy", mesh: rugMesh });
    this.scene.add(rugMesh);
    const npcMesh = new THREE.Mesh(
      new THREE.CircleGeometry(TARGET_RADIUS * 0.92, 32),
      new THREE.MeshStandardMaterial({ map: npc, roughness: 0.45, side: THREE.DoubleSide }),
    );
    this.actors.set("d:bystander", { id: "d:bystander", kind: "decoy", mesh: npcMesh });
    this.scene.add(npcMesh);
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(0.3, 24),
        new THREE.MeshStandardMaterial({
          map: bonus,
          roughness: 0.3,
          emissive: new THREE.Color(0x1b615e),
          emissiveIntensity: 0.4,
          side: THREE.DoubleSide,
        }),
      );
      const id = `b:${i}`;
      this.actors.set(id, { id, kind: "bonus", mesh });
      this.scene.add(mesh);
    }
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ map: crate, roughness: 0.7 }),
      );
      const id = `c:${i}`;
      this.actors.set(id, { id, kind: "cover", mesh });
      this.scene.add(mesh);
    }
  }

  private resize() {
    const bounds = this.play.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width) || window.innerWidth);
    const height = Math.max(1, Math.round(bounds.height) || window.innerHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.base.localX = Math.min(width, Math.max(0, this.base.localX || width / 2));
    this.base.localY = Math.min(height, Math.max(0, this.base.localY || height / 2));
    this.syncDisplayed();
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

  private poseMesh(actor: MeshActor, pose: ActorPose) {
    actor.mesh.visible = pose.active && !this.dropped.has(pose.id);
    if (!actor.mesh.visible && this.dropped.has(pose.id) && actor.kind !== "cover") {
      actor.mesh.visible = true;
    }
    actor.mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
    if (actor.kind === "cover" && pose.half) {
      actor.mesh.scale.set(pose.half.x * 2, pose.half.y * 2, pose.half.z * 2);
    } else if (actor.kind !== "cover") {
      actor.mesh.lookAt(this.camera.position);
    }
  }

  private shoot() {
    if (!this.running || this.finished) return;
    this.syncDisplayed();
    const t = this.t();
    if (t - this.lastShotAt < MIN_SHOT_GAP_SEC) return;
    const aim = this.aimFromPointer();
    const shot: ShotInput = { t, yaw: aim.yaw, pitch: aim.pitch };
    this.shots.push(shot);
    this.lastShotAt = t;
    this.recoil.push({ kick: recoilKick(this.seed, this.shots.length - 1), at: performance.now() });
    this.syncDisplayed();
    const preview = evaluateRound({
      seed: this.seed,
      forfeitIndex: -1,
      shots: this.shots,
      elapsedSec: t + 0.5,
    });
    let last = `Miss · ${MISS_SCORE}`;
    let tone: "hit" | "bonus" | "miss" | "bad" = "miss";
    const forfeit = false;
    if (!("error" in preview)) {
      const latest = preview.shots.at(-1);
      if (latest?.actorId) this.dropped.add(latest.actorId);
      if (latest?.kind === "decoy") {
        last = latest.actorId === "d:bystander" ? "Hit a tourist · 40" : "Rugged the wrong mark · 40";
        tone = "bad";
      } else if (latest?.kind === "bonus") {
        last = "Airdrop · 0";
        tone = "bonus";
      } else if (latest?.kind === "cover") {
        last = "Hit the locked LP · 25";
        tone = "miss";
      } else if (latest?.targetIndex != null) {
        const mesh = this.actors.get(latest.actorId ?? `t:${latest.targetIndex}`)?.mesh;
        if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshStandardMaterial)
          mesh.material.emissive.setHex(0x1b615e);
        last =
          latest.ring === 0
            ? "Bullseye · 5"
            : latest.ring === 1
              ? "Inner ring · 10"
              : latest.ring === 2
                ? "Middle ring · 15"
                : "Outer ring · 20";
        tone = "hit";
      } else last = `Miss · ${MISS_SCORE}`;
    }
    this.showFeedback(last.replace(" · ", "\n"), tone);
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
      const layout = actorsAt(this.seed, t);
      for (const pose of layout) {
        const actor = this.actors.get(pose.id);
        if (!actor) continue;
        if (this.dropped.has(pose.id) && actor.kind !== "cover") {
          actor.mesh.visible = true;
          if (actor.mesh instanceof THREE.Mesh)
            actor.mesh.rotation.x = Math.min(actor.mesh.rotation.x + 0.08, Math.PI / 2);
          continue;
        }
        this.poseMesh(actor, pose);
      }
      for (const [id, actor] of this.actors) {
        if (!layout.some((pose) => pose.id === id)) actor.mesh.visible = false;
      }
    }
    const blimp = this.background.getObjectByName("blimp");
    if (blimp) blimp.position.x = -16 + Math.sin(t * 0.12) * 18;
    this.background.position.set(this.pointer.x * 0.55, this.pointer.y * 0.22, 0);
    this.syncDisplayed();
    this.renderer.render(this.scene, this.camera);
  };
}

