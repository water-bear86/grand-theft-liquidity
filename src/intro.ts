import * as THREE from "three";
import { Assets, type CharacterId } from "./assets.ts";
import { PlayerCharacter } from "./player-character.ts";

type Point = readonly [number, number, number];
interface Shot {
  id: string;
  start: number;
  end: number;
  eyebrow: string;
  title: string;
  line: string;
  from: Point;
  to: Point;
  target: Point;
  character?: CharacterId;
}
export const INTRO_DURATION = 18;
export const INTRO_SHOTS: readonly Shot[] = [
  {
    id: "coast",
    start: 0,
    end: 4,
    eyebrow: "A SUNSET STRIP STORY",
    title: "Welcome to\nthe trenches.",
    line: "Sunshine. Palm trees. Unreasonable expectations.",
    from: [40, 16, 25],
    to: [27, 10, -5],
    target: [0, 2, -47],
  },
  {
    id: "cabbage",
    start: 4,
    end: 6.5,
    eyebrow: "FRESH SHIRT. TERRIBLE DECISIONS.",
    title: "Cabbage",
    line: "The face of a promising financial mistake.",
    from: [1.7, 1.5, 8.2],
    to: [1.4, 1.4, 7.6],
    target: [-0.8, 1, 4],
    character: "cabbage",
  },
  {
    id: "cupsey",
    start: 6.5,
    end: 9,
    eyebrow: "BIG CUP. BIGGER AMBITIONS.",
    title: "Cupsultan",
    line: "Dressed for success. Prepared for absolutely nothing.",
    from: [1.8, 1.45, 8.4],
    to: [1.5, 1.35, 7.9],
    target: [-0.85, 1, 4],
    character: "cupsey",
  },
  {
    id: "bagworker",
    start: 9,
    end: 11,
    eyebrow: "BAGWORKER BLVD",
    title: "Proof\nof work.",
    line: "The roadmap has a few gaps.",
    from: [-66, 12, -237],
    to: [-62, 15, -229],
    target: [-45, 5, -197],
  },
  {
    id: "alon",
    start: 11,
    end: 12.6,
    eyebrow: "FOUNDER SUPPORT",
    title: "Trust\nAlon.",
    line: "He has a very specific opportunity for you.",
    from: [-56.5, 1.55, -234.5],
    to: [-55.8, 1.5, -235],
    target: [-52, 1.25, -238.2],
  },
  {
    id: "cannon",
    start: 12.6,
    end: 14,
    eyebrow: "A PERSONAL LIQUIDITY EVENT",
    title: "Send it.",
    line: "Your exit strategy has a fuse.",
    from: [-57, 4, -239],
    to: [-56, 3.2, -241],
    target: [-51, 1.8, -246],
  },
  {
    id: "title",
    start: 14,
    end: INTRO_DURATION,
    eyebrow: "TEN BAD DECISIONS. ONE BIG BAG.",
    title: "Grand Theft\nLiquidity",
    line: "Pump your coin. Ruin your dignity.",
    from: [0, 2.5, 14],
    to: [0, 1.3, 7],
    target: [0, 3, -70],
  },
];
export interface IntroFrame {
  shot: Shot;
  index: number;
  progress: number;
}

/** Presentation only: the Game state owns whether simulation may advance. */
export class OpeningSequence {
  readonly group = new THREE.Group();
  readonly focus = new THREE.Vector3();
  elapsed = 0;
  private heroes = new Map<CharacterId, PlayerCharacter>();
  private assets: Assets;
  constructor(assets: Assets) {
    this.assets = assets;
    this.group.visible = false;
  }
  start() {
    this.elapsed = 0;
    if (!this.heroes.size) {
      for (const id of ["cabbage", "cupsey"] as const) {
        const hero = new PlayerCharacter(id, this.assets.characters.get(id));
        hero.group.position.set(0, 0, 4);
        this.heroes.set(id, hero);
        this.group.add(hero.group);
      }
    }
    for (const hero of this.heroes.values()) hero.reset();
    this.group.visible = true;
  }
  stop() {
    this.group.visible = false;
  }
  tick(delta: number) {
    this.elapsed = Math.min(INTRO_DURATION, this.elapsed + Math.max(0, delta));
    return this.elapsed >= INTRO_DURATION;
  }
  get frame(): IntroFrame {
    const index = INTRO_SHOTS.findIndex((shot) => this.elapsed < shot.end);
    const resolved = index < 0 ? INTRO_SHOTS.length - 1 : index;
    return {
      shot: INTRO_SHOTS[resolved],
      index: resolved,
      progress: this.elapsed / INTRO_DURATION,
    };
  }
  renderCamera(camera: THREE.PerspectiveCamera, reducedMotion: boolean) {
    const { shot } = this.frame;
    const progress = THREE.MathUtils.clamp(
      (this.elapsed - shot.start) / (shot.end - shot.start),
      0,
      1,
    );
    const mix = reducedMotion
      ? 0.5
      : THREE.MathUtils.smoothstep(progress, 0, 1);
    camera.position.set(...shot.from).lerp(new THREE.Vector3(...shot.to), mix);
    this.focus.set(...shot.target);
    // Narrow screens keep the character above the lower-third title card.
    if (shot.character && camera.aspect < 0.85) {
      camera.position.set(0.6, 1.9, 9.1);
      this.focus.set(0, 0.5, 4);
    }
    camera.lookAt(this.focus);
    for (const [id, hero] of this.heroes) {
      hero.group.visible = shot.character === id;
      if (hero.group.visible) {
        const poseTime = reducedMotion
          ? 0
          : Math.min(this.elapsed - shot.start, 0.52);
        hero.pose(poseTime, reducedMotion ? 0 : 9, false, false);
      }
    }
  }
}
