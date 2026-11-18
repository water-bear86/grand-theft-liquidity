import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import {
  animateAvatar,
  makeAvatar,
  type Avatar,
  type CharacterId,
} from "./assets.ts";

function ownedMaterials(group: THREE.Object3D) {
  const materials: THREE.MeshStandardMaterial[] = [];
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const copy = (material: THREE.Material) => {
      const cloned = material.clone();
      if (cloned instanceof THREE.MeshStandardMaterial) materials.push(cloned);
      return cloned;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(copy)
      : copy(object.material);
  });
  return materials;
}

export class CharacterPortrait {
  readonly group: THREE.Group;
  private materials: THREE.MeshStandardMaterial[];
  constructor(group: THREE.Group, idle?: THREE.AnimationClip) {
    this.group = clone(group) as THREE.Group;
    this.materials = ownedMaterials(this.group);
    if (idle) {
      const mixer = new THREE.AnimationMixer(this.group);
      mixer.clipAction(idle).play();
      mixer.update(0);
      // Keep the evaluated standing pose after the temporary mixer is collected.
    }
  }
  coat() {
    this.materials.forEach((m) => m.color.set("#bf944f"));
  }
  paintPoints() {
    this.group.updateWorldMatrix(true, true);
    const find = (name: string, fallback: THREE.Vector3) => {
      let bone: THREE.Object3D | undefined;
      this.group.traverse((o) => {
        if (o.userData.name === name || o.name === name) bone = o;
      });
      return bone
        ? bone.getWorldPosition(new THREE.Vector3())
        : this.group.localToWorld(fallback);
    };
    const face = find("spine.005", new THREE.Vector3(0, 1.65, 0.2)).lerp(
      find("head_end", new THREE.Vector3(0, 1.95, 0.2)),
      this.group.name === "player-cabbage" ? 0.05 : 0.55,
    );
    const points = [
      face,
      find("spine.002", new THREE.Vector3(0, 1.1, 0.2)),
      find("forearm.L", new THREE.Vector3(0.42, 1.1, 0.2)),
      find("forearm.R", new THREE.Vector3(-0.42, 1.1, 0.2)),
    ];
    const front = new THREE.Box3().setFromObject(this.group).max.z + 0.025;
    return points.map((p) => ({ x: p.x, y: p.y, z: front }));
  }
  dispose() {
    this.materials.forEach((m) => m.dispose());
    this.group.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
    });
  }
}

/** The render rig never drives the Rapier capsule: clips are evaluated in place. */
export class PlayerCharacter {
  readonly group = new THREE.Group();
  private fallback?: Avatar;
  private mixer?: THREE.AnimationMixer;
  private idleClip?: THREE.AnimationClip;
  private actions = new Map<string, THREE.AnimationAction>();
  private current = "";
  private lastTime = 0;
  private materials: THREE.MeshStandardMaterial[] = [];
  private originalColors: THREE.Color[] = [];
  constructor(
    readonly id: CharacterId,
    asset?: GLTF,
  ) {
    this.group.name = `player-${id}`;
    if (!asset) {
      this.fallback = makeAvatar(
        id === "cabbage" ? "#f4eee3" : "#c6b389",
        undefined,
        true,
      );
      this.group.add(this.fallback.group);
    } else {
      const model = clone(asset.scene);
      const root = model.getObjectByName("spine");
      const clips = asset.animations.map((source) => {
        const clip = source.clone();
        for (const track of clip.tracks) {
          if (track.name === "spine.position" && root) {
            for (let i = 0; i < track.values.length; i += 3) {
              track.values[i] = root.position.x;
              track.values[i + 2] = root.position.z;
              if (clip.name === "Backflip")
                track.values[i + 1] = root.position.y;
            }
          }
        }
        return clip;
      });
      // Neither source has a plain idle. Hold the upright opening pose of Backflip.
      const standing = clips.find((c) => c.name === "Backflip")!;
      this.idleClip = new THREE.AnimationClip(
        "Standing",
        1,
        standing.tracks.map((t) => {
          const copy = t.clone();
          copy.times = new Float32Array([0]);
          copy.values = t.values.slice(0, t.getValueSize());
          return copy;
        }),
      );
      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of [...clips, this.idleClip])
        this.actions.set(clip.name, this.mixer.clipAction(clip));
      this.actions.get("Standing")!.play();
      this.current = "Standing";
      this.mixer.update(0);
      model.updateMatrixWorld(true);
      model.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh) o.computeBoundingBox();
      });
      const bounds = new THREE.Box3().setFromObject(model);
      const scale = 2 / (bounds.max.y - bounds.min.y);
      const center = bounds.getCenter(new THREE.Vector3());
      model.scale.multiplyScalar(scale);
      model.position.set(
        -center.x * scale,
        -bounds.min.y * scale,
        -center.z * scale,
      );
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = o.receiveShadow = true;
        }
        // Skinned bounds from one pose can cull a flip midway through its arc.
        if (o instanceof THREE.SkinnedMesh) o.frustumCulled = false;
      });
      this.group.add(model);
    }
    this.materials = ownedMaterials(this.group);
    this.originalColors = this.materials.map((m) => m.color.clone());
  }
  reset() {
    this.materials.forEach((m, i) => m.color.copy(this.originalColors[i]));
    this.lastTime = 0;
    this.mixer?.stopAllAction();
    this.current = "Standing";
    this.actions.get("Standing")?.reset().play();
    this.mixer?.update(0);
  }
  coat() {
    this.materials.forEach((m) => m.color.set("#bf944f"));
  }
  portrait() {
    return new CharacterPortrait(this.group, this.idleClip);
  }
  pose(time: number, speed: number, airborne: boolean, stunt: boolean) {
    const delta = Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    if (this.fallback) {
      animateAvatar(this.fallback, time, speed, airborne);
      return;
    }
    const next =
      airborne && stunt
        ? "Backflip"
        : speed > 6
          ? this.actions.has("Running_Wide")
            ? "Running_Wide"
            : "Running"
          : speed > 0.35
            ? "Walking"
            : "Standing";
    const action = this.actions.get(next)!;
    if (next !== this.current) {
      const previous = this.actions.get(this.current)!;
      action.reset().setEffectiveWeight(1).play();
      if (next === "Backflip") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      previous.crossFadeTo(action, 0.12, false);
      this.current = next;
    }
    action.setEffectiveTimeScale(
      next === "Backflip"
        ? action.getClip().duration / 1.02
        : next === "Standing"
          ? 1
          : THREE.MathUtils.clamp(
              speed / (next === "Walking" ? 4 : 10),
              0.65,
              1.5,
            ),
    );
    this.mixer?.update(delta);
  }
}
