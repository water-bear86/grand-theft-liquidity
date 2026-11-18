import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
export const CHARACTERS = [
  { id: "cabbage", name: "Cabbage", line: "Fresh shirt. Terrible decisions." },
  { id: "cupsey", name: "Cupsultan", line: "Big cup. Bigger ambitions." },
] as const;
export type CharacterId = (typeof CHARACTERS)[number]["id"];

export const CLUB_SIGN = { ink: "#172c3a", enamel: "#d8f784" };
export type AssetKey =
  | "palm"
  | "parked-car"
  | "peanut-butter-jar"
  | "gull"
  | "bin"
  | "banana"
  | "crown";
export const mat = (color: THREE.ColorRepresentation) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.88, flatShading: true });
export function box(
  w: number,
  h: number,
  d: number,
  color: THREE.ColorRepresentation,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
export function label(
  text: string,
  color = "#182c37",
  background = "#f4efdc",
  width = 1024,
  height = 256,
  design: "plain" | "sign" | "marker" = "plain",
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = background;
  if (design === "marker") {
    context.beginPath();
    context.roundRect(8, 6, width - 16, height - 31, 18);
    context.fill();
    context.beginPath();
    context.moveTo(width * 0.37, height - 26);
    context.lineTo(width * 0.63, height - 26);
    context.lineTo(width * 0.5, height - 9);
    context.fill();
  } else {
    context.fillRect(0, 0, width, height);
  }
  if (design === "sign") {
    const inset = height * 0.075;
    context.strokeStyle = color;
    context.lineWidth = Math.max(1, inset * 0.32);
    context.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  }
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const scale = design === "marker" ? 0.52 : 0.58;
  const face = design === "plain" ? "Arial" : '"Avenir Next Condensed", Arial';
  context.font = `900 ${Math.min(height * scale, width / (text.length * 0.65))}px ${face}`;
  context.fillText(
    text,
    width / 2,
    height * (design === "marker" ? 0.43 : 0.52),
    width * 0.9,
  );
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
export class Assets {
  characters = new Map<CharacterId, GLTF>();
  models = new Map<AssetKey, THREE.Group>();
  alon: GLTF | null = null;
  failed: string[] = [];
  async load(progress: (text: string) => void) {
    const keys: AssetKey[] = [
      "palm",
      "parked-car",
      "peanut-butter-jar",
      "gull",
      "bin",
    ];
    let done = 0;
    const progressLabel = () =>
      progress(
        `Dressing the coast · ${++done}/${keys.length + 1 + CHARACTERS.length}`,
      );
    await Promise.all([
      ...CHARACTERS.map(async ({ id }) => {
        try {
          const gltf = await new GLTFLoader().loadAsync(
            `${import.meta.env.BASE_URL}assets/${id}.glb`,
          );
          const names = new Set(gltf.animations.map((c) => c.name));
          const height = new THREE.Box3()
            .setFromObject(gltf.scene)
            .getSize(new THREE.Vector3()).y;
          if (
            !["Running", "Walking", "Backflip"].every((n) => names.has(n)) ||
            !Number.isFinite(height) ||
            height <= 0
          )
            throw new Error("Invalid character rig");
          this.characters.set(id, gltf);
        } catch (error) {
          this.failed.push(id);
          console.warn(
            `Character unavailable: ${id}; using authored stand-in`,
            error,
          );
        } finally {
          progressLabel();
        }
      }),
      ...keys.map(async (key) => {
        try {
          const gltf = await new GLTFLoader().loadAsync(
            `${import.meta.env.BASE_URL}assets/${key}.glb`,
          );
          const model = gltf.scene;
          model.updateMatrixWorld(true);
          const bounds = new THREE.Box3().setFromObject(model);
          const size = bounds.getSize(new THREE.Vector3());
          const center = bounds.getCenter(new THREE.Vector3());
          if (!Number.isFinite(size.y) || size.y <= 0)
            throw new Error("Empty model");
          const wrapper = new THREE.Group();
          model.scale.multiplyScalar(1 / size.y);
          model.position.set(
            -center.x / size.y,
            -bounds.min.y / size.y,
            -center.z / size.y,
          );
          model.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.castShadow = true;
              object.receiveShadow = true;
            }
          });
          wrapper.add(model);
          this.models.set(key, wrapper);
        } catch (error) {
          this.failed.push(key);
          console.warn(`Asset unavailable: ${key}`, error);
        }
        progressLabel();
      }),
      new GLTFLoader()
        .loadAsync(`${import.meta.env.BASE_URL}assets/alon.glb`)
        .then((gltf) => {
          const clips = new Set(gltf.animations.map((clip) => clip.name));
          gltf.scene.updateMatrixWorld(true);
          const bounds = new THREE.Box3().setFromObject(gltf.scene);
          const height = bounds.max.y - bounds.min.y;
          if (
            !clips.has("Idle") ||
            !clips.has("ArmExtension") ||
            !Number.isFinite(height) ||
            height <= 0
          )
            throw new Error(
              "Alon model is missing its rigged animations or geometry",
            );
          this.alon = gltf;
        })
        .catch((error) => {
          this.failed.push("alon");
          console.warn(
            "Alon model unavailable; using the authored character",
            error,
          );
        })
        .finally(progressLabel),
    ]);
  }
  create(key: AssetKey, height = 1): THREE.Group {
    if (!this.models.has(key)) this.models.set(key, this.authored(key));
    const group = this.models.get(key)!.clone(true);
    group.scale.setScalar(height);
    return group;
  }
  authored(key: AssetKey): THREE.Group {
    const g = new THREE.Group();
    if (key === "banana") {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.6, 0.2, 0),
        new THREE.Vector3(-0.4, 0.6, 0),
        new THREE.Vector3(0, 0.8, 0),
        new THREE.Vector3(0.5, 0.6, 0),
        new THREE.Vector3(0.7, 0.25, 0),
      ]);
      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 8, 0.14, 5, false),
        mat("#f2d249"),
      );
      mesh.castShadow = true;
      g.add(mesh);
    } else if (key === "crown") {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.45, 0.22, 8),
        mat("#f9c434"),
      );
      ring.position.y = 0.11;
      g.add(ring);
      for (let i = 0; i < 6; i++) {
        const tooth = new THREE.Mesh(
          new THREE.ConeGeometry(0.15, 0.45, 4),
          mat("#ffd968"),
        );
        tooth.position.set(
          Math.sin((i * Math.PI) / 3) * 0.4,
          0.4,
          Math.cos((i * Math.PI) / 3) * 0.4,
        );
        g.add(tooth);
      }
    } else if (key === "palm") {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.04, 0.8, 5),
        mat("#a47a54"),
      );
      trunk.position.y = 0.4;
      g.add(trunk);
      for (let i = 0; i < 6; i++) {
        const leaf = box(
          0.06,
          0.025,
          0.6,
          "#428565",
          Math.sin(i) * 0.18,
          0.85,
          Math.cos(i) * 0.18,
        );
        leaf.rotation.set(0.3, i, 0);
        g.add(leaf);
      }
    } else if (key === "parked-car") {
      g.add(
        box(2, 0.6, 1, "#ee7b95", 0, 0.3, 0),
        box(1, 0.4, 0.85, "#c6e4e5", -0.1, 0.8, 0),
      );
    } else if (key === "gull") {
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 6, 4),
        mat("#fff6de"),
      );
      body.position.y = 0.5;
      g.add(body, box(0.12, 0.12, 0.4, "#edb553", 0, 0.7, 0.35));
    } else {
      g.add(
        box(0.7, 0.9, 0.7, key === "bin" ? "#3c7b55" : "#c99443", 0, 0.45, 0),
        box(0.8, 0.1, 0.8, key === "bin" ? "#233f37" : "#cb5343", 0, 0.95, 0),
      );
    }
    return g;
  }
}
export interface Avatar {
  group: THREE.Group;
  legs: THREE.Group[];
  arms: THREE.Group[];
  body: THREE.Mesh;
  skin: THREE.MeshStandardMaterial;
}
export function makeAvatar(
  shirt = "#f4eee3",
  skinColor = "#bf8d6d",
  featured = false,
): Avatar {
  const group = new THREE.Group();
  const skin = mat(skinColor);
  const body = box(0.67, 0.6, 0.37, shirt, 0, 1.12, 0);
  if (featured) {
    body.geometry.dispose();
    body.geometry = new RoundedBoxGeometry(0.67, 0.6, 0.37, 1, 0.045);
  }
  group.add(body);
  const head = new THREE.Mesh(
    featured
      ? new RoundedBoxGeometry(0.42, 0.43, 0.4, 1, 0.042)
      : new THREE.BoxGeometry(0.42, 0.43, 0.4),
    skin,
  );
  head.position.y = 1.67;
  head.castShadow = true;
  group.add(head);
  group.add(
    box(0.45, 0.13, 0.43, "#253640", 0, 1.92, 0),
    box(0.42, 0.11, 0.035, "#122831", 0, 1.71, 0.216),
  );
  if (featured) {
    group.add(
      box(0.48, 0.037, 0.33, "#3f716e", 0, 1.865, 0.16),
      box(0.27, 0.16, 0.014, "#e76d57", 0, 1.18, -0.186),
      box(0.19, 0.033, 0.016, "#ffe1a3", 0, 1.18, -0.194),
    );
  }
  const legs: THREE.Group[] = [],
    arms: THREE.Group[] = [];
  [-1, 1].forEach((side) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.19, 0.81, 0);
    leg.add(box(0.27, 0.35, 0.3, "#e77157", 0, -0.16, 0));
    const calf = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.28, 0.2), skin);
    calf.position.y = -0.48;
    leg.add(calf, box(0.24, 0.15, 0.4, "#f5efe0", 0, -0.68, 0.06));
    if (featured) leg.add(box(0.25, 0.035, 0.41, "#36716d", 0, -0.736, 0.06));
    group.add(leg);
    legs.push(leg);
    const arm = new THREE.Group();
    arm.position.set(side * 0.43, 1.38, 0);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.48, 0.2), skin);
    hand.position.y = -0.26;
    arm.add(hand);
    group.add(arm);
    arms.push(arm);
  });
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return { group, legs, arms, body, skin };
}
export function animateAvatar(
  avatar: Avatar,
  time: number,
  speed: number,
  airborne = false,
) {
  const walk = Math.sin(time * 12) * Math.min(speed / 10, 1) * 0.75;
  avatar.legs[0].rotation.x = airborne ? -0.6 : walk;
  avatar.legs[1].rotation.x = airborne ? 0.4 : -walk;
  avatar.arms[0].rotation.x = airborne ? -1.2 : -walk;
  avatar.arms[1].rotation.x = airborne ? -1.2 : walk;
}
