export interface Point3 {
  x: number;
  y: number;
  z: number;
}
export const ALON = { x: -52, y: 0, z: -237 };
export const CANNON = { x: -51, y: 1.3, z: -246 };
export const WALLET = { x: -75, y: 0.24, z: -246 };
export const AIRDROP_TASK_ID = 5;
export const PAYROLL_TASK_ID = 6;
export const COURSE = [
  { x: -48, z: -224, y: 0.12, w: 6, d: 6, name: "START", checkpoint: true },
  {
    x: -48,
    z: -218,
    y: 1.4,
    w: 4.8,
    d: 4.8,
    name: "DELIVERY VAN",
    checkpoint: false,
  },
  {
    x: -44,
    z: -212,
    y: 2.8,
    w: 4.8,
    d: 4.8,
    name: "AWNING",
    checkpoint: false,
  },
  {
    x: -48,
    z: -206,
    y: 4.2,
    w: 4.8,
    d: 4.8,
    name: "AIR CONDITIONING",
    checkpoint: false,
  },
  {
    x: -44,
    z: -200,
    y: 5.6,
    w: 6,
    d: 6,
    name: "PROOF OF WORK",
    checkpoint: true,
  },
  {
    x: -48,
    z: -193,
    y: 5.6,
    w: 4.8,
    d: 4.8,
    name: "ROADMAP",
    checkpoint: false,
  },
  {
    x: -44,
    z: -187,
    y: 7,
    w: 4.8,
    d: 4.8,
    name: "Q4 DELIVERABLE",
    checkpoint: true,
  },
  {
    x: -48,
    z: -181,
    y: 7,
    w: 6,
    d: 6,
    name: "ALMOST THERE",
    checkpoint: false,
  },
  {
    x: -44,
    z: -174,
    y: 8.4,
    w: 7,
    d: 7,
    name: "AIRDROP COLLECTION",
    checkpoint: true,
  },
] as const;
export type JobPhase =
  | "idle"
  | "outbound"
  | "return"
  | "report"
  | "stunt"
  | "aiming"
  | "flight"
  | "payday"
  | "paid";

export function platformAt(position: Point3): number {
  return COURSE.findIndex(
    (p) =>
      Math.abs(position.y - p.y) < 0.23 &&
      Math.abs(position.x - p.x) <= p.w / 2 + 0.12 &&
      Math.abs(position.z - p.z) <= p.d / 2 + 0.12,
  );
}

/** Ordered checkpoints are independent of meshes and physics contacts. */
export class BagWorkerJob {
  phase: JobPhase = "idle";
  next = 0;
  checkpoint = 0;
  aim = 0;
  chargeTime = 0;
  get active() {
    return this.phase !== "idle" && this.phase !== "paid";
  }
  get onCourse() {
    return this.phase === "outbound" || this.phase === "return";
  }
  get target(): Point3 {
    if (this.onCourse) return COURSE[this.next];
    if (["stunt", "aiming", "flight"].includes(this.phase)) return CANNON;
    return ALON;
  }
  get power() {
    return 0.2 + 0.75 * (0.5 - 0.5 * Math.cos(this.chargeTime * 2.4));
  }
  get instruction() {
    if (this.phase === "outbound")
      return `Airdrop route · ${this.next}/8 · ${COURSE[this.next].name.toLowerCase()}`;
    if (this.phase === "return")
      return `Go back · platform ${this.next}/8 · retrace the rooftops`;
    if (this.phase === "report")
      return "Back to Alon · tell him there was nothing there";
    if (this.phase === "stunt") return "Get in the parcel cannon · E to aim";
    if (this.phase === "aiming")
      return "Aim at the wallet · launch in the green band";
    if (this.phase === "flight")
      return "Special delivery · land inside the giant wallet";
    if (this.phase === "payday") return "Go to Alon · collect your cash";
    return "";
  }
  start() {
    if (this.phase !== "idle") return false;
    this.phase = "outbound";
    this.next = 0;
    this.checkpoint = 0;
    return true;
  }
  land(index: number): "step" | "checkpoint" | "fakeout" | "returned" | null {
    if (!this.onCourse || index !== this.next) return null;
    if (this.phase === "outbound") {
      if (index === COURSE.length - 1) {
        this.phase = "return";
        this.next = index - 1;
        this.checkpoint = index;
        return "fakeout";
      }
      this.next++;
    } else {
      if (index === 0) {
        this.phase = "report";
        this.checkpoint = 0;
        return "returned";
      }
      this.next--;
    }
    if (COURSE[index].checkpoint) {
      this.checkpoint = index;
      return "checkpoint";
    }
    return "step";
  }
  recover(): Point3 {
    this.next =
      this.phase === "return" ? this.checkpoint - 1 : this.checkpoint + 1;
    return COURSE[this.checkpoint];
  }
  report() {
    if (this.phase !== "report") return false;
    this.phase = "stunt";
    return true;
  }
  enterCannon() {
    if (this.phase !== "stunt") return false;
    this.phase = "aiming";
    this.chargeTime = 0;
    return true;
  }
  fire(): Point3 | null {
    if (this.phase !== "aiming") return null;
    const speed = 10 + this.power * 15;
    const angle = (this.aim * Math.PI) / 180;
    this.phase = "flight";
    return { x: -Math.cos(angle) * speed, y: 12.4, z: Math.sin(angle) * speed };
  }
  finishFlight(position: Point3) {
    if (this.phase !== "flight") return false;
    const hit =
      Math.abs(position.x - WALLET.x) < 2.55 &&
      Math.abs(position.z - WALLET.z) < 3.05 &&
      Math.abs(position.y - WALLET.y) < 0.25;
    this.phase = hit ? "payday" : "stunt";
    return hit;
  }
}
