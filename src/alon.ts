import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { makeAvatar, type Avatar } from "./assets.ts";

export class AlonCharacter {
  readonly group = new THREE.Group();
  private mixer?: THREE.AnimationMixer;
  private idle?: THREE.AnimationAction;
  private extension?: THREE.AnimationAction;
  private hand?: THREE.Object3D;
  private fallback?: Avatar;
  private handoffTime = -1;

  constructor(asset: GLTF | null) {
    const idle = asset?.animations.find((clip) => clip.name === "Idle");
    const extension = asset?.animations.find(
      (clip) => clip.name === "ArmExtension",
    );
    if (!asset || !idle || !extension) {
      this.fallback = makeAvatar("#252c32", "#c79577", true);
      this.group.add(this.fallback.group);
      return;
    }

    const model = clone(asset.scene);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const height = bounds.max.y - bounds.min.y;
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 2 / height;
    model.scale.multiplyScalar(scale);
    model.position.set(
      -center.x * scale,
      -bounds.min.y * scale,
      -center.z * scale,
    );
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        // Include the arm's reach while still culling this NPC away from view.
        if (object instanceof THREE.SkinnedMesh) {
          object.computeBoundingSphere();
          object.boundingSphere!.radius *= 1.5;
        }
      }
      if (object.userData.name === "Hand.R") this.hand = object;
    });
    this.group.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.idle = this.mixer.clipAction(idle).setLoop(THREE.LoopRepeat, Infinity);
    this.extension = this.mixer
      .clipAction(extension)
      .setLoop(THREE.LoopOnce, 1);
    this.extension.clampWhenFinished = true;
    this.reset();
  }

  get handoffElapsed() {
    return this.handoffTime;
  }

  reset() {
    this.handoffTime = -1;
    this.mixer?.stopAllAction();
    this.idle?.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    this.mixer?.update(0);
    if (this.fallback) this.fallback.arms[1].rotation.x = 0;
  }

  handoff() {
    if (this.handoffTime >= 0) return;
    this.handoffTime = 0;
    if (this.extension && this.idle) {
      this.extension
        .reset()
        .setEffectiveWeight(1)
        .setEffectiveTimeScale(1)
        .play();
      this.idle.crossFadeTo(this.extension, 0.16, false);
    }
  }

  update(delta: number) {
    if (delta <= 0) return;
    if (this.handoffTime >= 0) {
      const previous = this.handoffTime;
      const duration = this.extension?.getClip().duration ?? 3;
      this.handoffTime += delta;
      if (previous < duration - 0.18 && this.handoffTime >= duration - 0.18) {
        this.idle
          ?.reset()
          .setEffectiveWeight(1)
          .setEffectiveTimeScale(1)
          .fadeIn(0.18)
          .play();
        this.extension?.fadeOut(0.18);
      }
      if (this.fallback) {
        const reach =
          THREE.MathUtils.smoothstep(this.handoffTime, 0.45, 1.3) *
          (1 - THREE.MathUtils.smoothstep(this.handoffTime, 2, 2.8));
        this.fallback.arms[1].rotation.x = -1.25 * reach;
      }
      if (this.handoffTime >= duration) {
        this.extension?.stop();
        this.idle?.setEffectiveWeight(1);
        this.handoffTime = -1;
      }
    }
    this.mixer?.update(delta);
  }

  handPosition(target: THREE.Vector3) {
    this.group.updateWorldMatrix(true, true);
    if (this.hand) return this.hand.localToWorld(target.set(0, 0.045, 0));
    if (this.fallback)
      return this.fallback.arms[1].localToWorld(target.set(0, -0.45, 0));
    return this.group.localToWorld(target.set(-0.2, 1, 0.45));
  }
}
