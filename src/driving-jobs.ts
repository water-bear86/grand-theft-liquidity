import { FINAL_RAMP, RAMP_HALF_WIDTH } from "./ramps.ts";

export type DrivingJobId = "drift" | "delivery" | "ramp";

export interface JobPoint {
  x: number;
  z: number;
}

export interface DriveSample {
  car: number;
  x: number;
  z: number;
  distance: number;
  speed: number;
  slipAngle: number;
  grounded: boolean;
  launchRampZ?: number | null;
  impact: number;
}

export const PRESS_GATES = [
  { x: 0, z: -38, halfWidth: 7.1 },
  { x: 0, z: -60, halfWidth: 7.1 },
] as const;
export const PRESS_BAY = { x: 0, z: -76, halfWidth: 6.3, halfLength: 7 } as const;

export class Roadshow {
  gate = 0;
  photoTaken = false;
  slidingMetres = 0;

  get target(): JobPoint {
    if (this.gate < PRESS_GATES.length) return PRESS_GATES[this.gate];
    return PRESS_BAY;
  }

  get instruction(): string {
    if (this.photoTaken) return "Photo captured. Mission complete.";
    if (this.gate < PRESS_GATES.length) {
      return `Drive through camera ${this.gate + 1}/${PRESS_GATES.length} toward the boardwalk`;
    }
    return "Steer and handbrake through the striped press bay";
  }

  update(previous: JobPoint, sample: DriveSample, handbrakeSlide: boolean): "gate" | "photo" | null {
    if (this.photoTaken) return null;
    if (!Number.isInteger(sample.car) || sample.car < 0) return null;
    if (!(sample.speed > 0)) return null;

    const dx = sample.x - previous.x;
    const dz = sample.z - previous.z;
    const travel = Math.hypot(dx, dz);
    if (!(travel > 0 && travel <= 1.5)) return null;

    if (this.gate < PRESS_GATES.length) {
      const g = PRESS_GATES[this.gate];
      if (dz >= 0) return null;
      const t = (g.z - previous.z) / dz;
      if (t < 0 || t > 1) return null;
      const crossX = previous.x + dx * t;
      if (Math.abs(crossX - g.x) > g.halfWidth) return null;
      this.gate++;
      return "gate";
    }

    const inBay =
      Math.abs(sample.x - PRESS_BAY.x) <= PRESS_BAY.halfWidth &&
      Math.abs(sample.z - PRESS_BAY.z) <= PRESS_BAY.halfLength;
    if (!inBay || !sample.grounded || sample.speed < 4) {
      this.slidingMetres = 0;
      return null;
    }
    if (!handbrakeSlide || sample.slipAngle < 0.23) {
      this.slidingMetres = 0;
      return null;
    }
    const sideways = travel * Math.sin(Math.min(Math.PI / 2, sample.slipAngle));
    this.slidingMetres += sideways;
    if (this.slidingMetres < 0.65) return null;
    this.photoTaken = true;
    return "photo";
  }
}

export const DRIVING_JOBS: Record<
  DrivingJobId,
  { name: string; brief: string; pay: string }
> = {
  drift: {
    name: "Proof of Drift",
    brief: "Our sponsor wants the chart to trade sideways. Drift both marked corners.",
    pay: "$700",
  },
  delivery: {
    name: "Hot Dog Futures",
    brief: "Haul six hot dogs from the boardwalk to Club Liquid. You eat the losses.",
    pay: "$150 per dog",
  },
  ramp: {
    name: "Exit Ramp",
    brief: "Jump the last ramp into the VIP valet bay. Parking comes out of your fee.",
    pay: "$960",
  },
};

const DRIFT_POINTS: JobPoint[] = [
  { x: -2, z: -232 },
  { x: -57, z: -233 },
];
const DRIFT_RADIUS = 10.5;
const DRIFT_NEEDED = 4;
const DRIFT_MIN_SPEED = 6;
const DRIFT_SLIP_MIN = 0.23;
const DRIFT_SLIP_MAX = 1.38;
const DRIFT_AWARD = 700;
const DRIFT_VIEWERS = 120;

const PICKUP: JobPoint = { x: 5.4, z: -72 };
const PICKUP_RADIUS = 4.6;
const PICKUP_MAX_SPEED = 2.2;
const PICKUP_DWELL = 0.35;
const DROPOFF: JobPoint = { x: 4, z: -333 };
export const HOT_DOG_COUNT = 6;
const DOG_PAY = 150;
const DELIVERY_VIEWERS = 90;
const SPILL_COOLDOWN = 0.85;

const ARCH: JobPoint = { x: 0, z: FINAL_RAMP };
export const VALET_BAY = { x: 0, z: -332.5, halfWidth: 5.4, halfLength: 8.5 };
const APPROACH_SPEED = 10;
const RAMP_AWARD = 960;
const RAMP_VIEWERS = 125;

const PROGRESS_STEP = 12;

interface JobEvent {
  text?: string;
  award?: number;
  viewers?: number;
  progress?: boolean;
  lostCargo?: number;
}

export class DrivingJobs {
  active: DrivingJobId | null = null;
  car = -1;
  stage = 0;
  cargo = 0;
  cleared: Set<DrivingJobId> = new Set();
  earnings = 0;
  slidingMetres = 0;

  private dwell = 0;
  private spillTimer = 0;
  private progressDistance = Infinity;

  get target(): JobPoint | null {
    if (this.active === "drift") return DRIFT_POINTS[this.stage];
    if (this.active === "delivery") return this.stage === 0 ? PICKUP : DROPOFF;
    if (this.active === "ramp") return this.stage === 0 ? ARCH : VALET_BAY;
    return null;
  }

  get markerRadius() {
    if (this.active === "drift") return DRIFT_RADIUS;
    if (this.active === "delivery") return PICKUP_RADIUS;
    return RAMP_HALF_WIDTH;
  }

  get instruction() {
    if (this.active === "drift")
      return `Corner ${this.stage + 1}/2 · ${this.slidingMetres.toFixed(1)}/${DRIFT_NEEDED} m sideways`;
    if (this.active === "delivery") return this.stage === 0
      ? "Park at the boardwalk pickup to load six dogs"
      : `${this.cargo}/${HOT_DOG_COUNT} dogs on the roof · Park at Club Liquid`;
    if (this.active === "ramp") return this.stage === 0
      ? "Take the last ramp toward Club Liquid at 36 km/h or faster"
      : "Touch down inside the striped VIP bay";
    return "";
  }

  start(id: DrivingJobId, car: number): boolean {
    if (!Object.hasOwn(DRIVING_JOBS, id) || this.active || this.cleared.has(id) ||
        !Number.isInteger(car) || car < 0) return false;
    this.active = id;
    this.car = car;
    return true;
  }

  cancel() {
    this.active = null;
    this.car = -1;
    this.stage = this.cargo = this.slidingMetres = 0;
    this.dwell = this.spillTimer = 0;
    this.progressDistance = Infinity;
  }

  private finish(id: DrivingJobId, award: number, viewers: number, text: string): JobEvent {
    this.cleared.add(id);
    this.earnings += award;
    this.cancel();
    return { award, viewers, text };
  }

  update(dt: number, s: DriveSample): JobEvent | null {
    const target = this.target;
    if (!target || this.car !== s.car || !(dt > 0)) return null;
    const distance = Math.hypot(s.x - target.x, s.z - target.z);
    const oldStage = this.stage;
    const event = this.active === "drift" ? this.driftCorner(s, distance)
      : this.active === "delivery" ? this.deliver(dt, s, distance) : this.jump(s);
    if (this.stage !== oldStage || !this.active) this.progressDistance = Infinity;
    if (event) return event;
    if (this.progressDistance === Infinity) this.progressDistance = distance;
    // Only new ground toward the drop counts. Circling and idling do not keep the market warm.
    if (s.distance > 0 && this.progressDistance - distance >= PROGRESS_STEP) {
      this.progressDistance = distance;
      return { progress: true };
    }
    return null;
  }

  private driftCorner(s: DriveSample, distance: number): JobEvent | null {
    if (distance > DRIFT_RADIUS || !s.grounded || s.speed < DRIFT_MIN_SPEED ||
        s.slipAngle < DRIFT_SLIP_MIN || s.slipAngle > DRIFT_SLIP_MAX) return null;
    this.slidingMetres += s.distance * Math.abs(Math.sin(s.slipAngle));
    if (this.slidingMetres < DRIFT_NEEDED) return null;
    if (this.stage === 1) return this.finish("drift", DRIFT_AWARD, DRIFT_VIEWERS, "Both corners verified. The chart is flat.");
    this.slidingMetres = 0;
    this.stage = 1;
    return { text: "First corner clipped. Turn west onto BagWorker Boulevard.", progress: true };
  }

  private deliver(dt: number, s: DriveSample, distance: number): JobEvent | null {
    this.spillTimer = Math.max(0, this.spillTimer - dt);
    if (this.stage === 1 && s.impact >= 6.5 && this.spillTimer === 0) {
      const lost = Math.min(this.cargo, s.impact >= 13 ? 2 : 1);
      this.cargo -= lost;
      this.spillTimer = SPILL_COOLDOWN;
      this.dwell = 0;
      if (this.cargo === 0) {
        this.cancel();
        return { text: "The hot dog market has crashed. Rebook on the car radio.", lostCargo: lost };
      }
      return { text: `${lost === 1 ? "One dog" : "Two dogs"} off the roof. ${this.cargo} left.`, lostCargo: lost };
    }
    this.dwell = s.grounded && s.speed <= PICKUP_MAX_SPEED && distance <= PICKUP_RADIUS
      ? this.dwell + dt : 0;
    if (this.dwell < PICKUP_DWELL) return null;
    this.dwell = 0;
    if (this.stage === 0) {
      this.stage = 1;
      this.cargo = HOT_DOG_COUNT;
      return { text: "Six dogs on the roof. Club Liquid is buying.", progress: true };
    }
    return this.finish("delivery", this.cargo * DOG_PAY, DELIVERY_VIEWERS,
      `${this.cargo} hot dog${this.cargo === 1 ? "" : "s"} delivered.`);
  }

  private jump(s: DriveSample): JobEvent | null {
    if (this.stage === 0) {
      if (s.grounded || s.launchRampZ !== FINAL_RAMP || s.speed < APPROACH_SPEED) return null;
      this.stage = 1;
      return { text: "Airborne. Aim for the VIP stripes.", progress: true };
    }
    if (!s.grounded) return null;
    if (Math.abs(s.x - VALET_BAY.x) <= VALET_BAY.halfWidth &&
        Math.abs(s.z - VALET_BAY.z) <= VALET_BAY.halfLength)
      return this.finish("ramp", RAMP_AWARD, RAMP_VIEWERS, "$1,000 appearance fee less $40 for parking.");
    this.stage = 0;
    return { text: "Valet declined delivery. Circle back to the last ramp." };
  }
}
