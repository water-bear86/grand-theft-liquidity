import { coinName, INCIDENT_TASK_ID, TASKS, UTILITY_TASK_ID, type TaskSceneId } from "./content.ts";
import { DrivingJobs, Roadshow, type DriveSample, type JobPoint } from "./driving-jobs.ts";

import { BagWorkerJob, AIRDROP_TASK_ID, PAYROLL_TASK_ID } from "./bagworker.ts";
import { IncidentJob } from "./incident.ts";

const MARKET_GRACE_SECONDS = 16;
const MARKET_DECAY_PER_SECOND = 20;
const FIRST_PURSUIT_TASK_COUNT = UTILITY_TASK_ID + 1;
const TASK_HIT_GRACE = 5;
const BUYER_HIT_GRACE = 4.5;

export type Mode =
  | "title"
  | "intro"
  | "intro-ready"
  | "playing"
  | "choice"
  | "car-radio"
  | "task-scene"
  | "paused"
  | "cashout"
  | "victory"
  | "result"
  | "gallery";
export type Ending = "early" | "slopmeister" | "caught" | "bust";
export interface Notice {
  id: number;
  text: string;
  type: "pump" | "dump" | "info";
  age: number;
}
export class Game {
  mode: Mode = "title";
  bagworker = new BagWorkerJob();
  incident: IncidentJob | null = null;
  drivingJobs = new DrivingJobs();
  roadshow = new Roadshow();
  get onRoadshow() {
    return TASKS[this.completed]?.action === "drive";
  }
  get pressurePaused() {
    return this.bagworker.active;
  }
  coin = coinName();
  bag = 500;
  peak = 500;
  banked = 0;
  viewers = 0;
  incidentLoss = 0;
  incidentAt = -Infinity;
  lastFine = 0;
  private fatalities = new Set<string>();
  get kills() {
    return this.fatalities.size;
  }
  best = 0;
  combo = 1;
  heat = 0;
  strikes = 0;
  completed = 0;
  pendingChoice: number | null = null;
  choices: number[] = [];
  idle = 0;
  activeTime = 0;
  cooldown = 0;
  pickupTime = 0;
  hitGrace = 0;
  collideGrace = 0;
  chart: number[] = [180, 220, 200, 280, 260, 340, 310, 400, 420, 500];
  chartTime = 0;
  ending: Ending | null = null;
  /** Set by the "We got hacked" test jump. A run that skipped ahead never counts as beating the story. */
  testJump = false;
  notices: Notice[] = [];
  noticeId = 0;
  usedSpots = new Set<string>();
  previousMode: Mode = "playing";
  get routeComplete() {
    return this.completed === TASKS.length;
  }
  get marketCooling() {
    return !this.pressurePaused && this.idle > MARKET_GRACE_SECONDS;
  }
  get buyerCount() {
    if (this.pressurePaused || this.completed < FIRST_PURSUIT_TASK_COUNT)
      return 0;
    return Math.min(3, 1 + Math.floor(Math.max(0, this.heat - 45) / 27));
  }
  get taskScene(): TaskSceneId | null {
    if (this.pendingChoice === null) return null;
    const task = TASKS[this.completed];
    return task?.choices[this.pendingChoice]?.scene ?? task?.scene ?? null;
  }
  start(withIntro = false) {
    const best = this.best;
    Object.assign(this, new Game());
    this.best = best;
    this.mode = withIntro ? "intro" : "playing";
    this.notify("Your coin is pumping. Try not to be normal.");
  }
  jumpToIncident() {
    this.start(false);
    this.completed = INCIDENT_TASK_ID;
    this.testJump = true;
    this.bag = 2500;
    this.peak = 2500;
    this.chart.push(2500);
    this.idle = 0;
    this.heat = 0;
    this.hitGrace = 30;
    this.notify("Test jump: the treasury is looking liquid.");
  }
  finishIntro() {
    if (this.mode !== "intro") return false;
    this.mode = "intro-ready";
    return true;
  }
  takeControl() {
    if (this.mode !== "intro-ready") return false;
    this.mode = "playing";
    return true;
  }
  notify(text: string, type: Notice["type"] = "info") {
    this.notices.unshift({ id: ++this.noticeId, text, type, age: 0 });
    this.notices = this.notices.slice(0, 3);
  }
  tick(dt: number) {
    if (this.mode !== "playing") return;
    dt = Math.min(Math.max(dt, 0), 0.05);
    this.activeTime += dt;
    const graceRemaining = Math.max(0, MARKET_GRACE_SECONDS - this.idle);
    if (!this.pressurePaused) this.idle += dt;
    if (this.bagworker.phase === "aiming") this.bagworker.chargeTime += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.pickupTime = Math.max(0, this.pickupTime - dt);
    this.hitGrace = Math.max(0, this.hitGrace - dt);
    this.collideGrace = Math.max(0, this.collideGrace - dt);
    this.notices.forEach((n) => (n.age += dt));
    this.notices = this.notices.filter((n) => n.age < 6);
    if (this.marketCooling) {
      this.combo = 1;
      const coolingTime = Math.max(0, dt - graceRemaining);
      this.bag = Math.max(0, this.bag - MARKET_DECAY_PER_SECOND * coolingTime);
    }
    this.chartTime += dt;
    if (this.chartTime >= 0.3) {
      this.chartTime = 0;
      this.chart.push(this.bag);
      if (this.chart.length > 48) this.chart.shift();
    }
    if (this.bag <= 0) this.finish("bust");
  }
  openCarRadio() {
    if (this.mode !== "playing" || this.bagworker.active || this.onRoadshow) return false;
    this.mode = "car-radio";
    return true;
  }
  filmRoadshow(previous: JobPoint, sample: DriveSample, handbrakeSlide: boolean) {
    if (this.mode !== "playing" || !this.onRoadshow || this.pendingChoice === null) return null;
    const shot = this.roadshow.update(previous, sample, handbrakeSlide);
    if (shot === "gate") {
      this.idle = 0;
      this.notify(this.roadshow.gate === 1 ? "Camera one has you. Keep driving." : "Both cameras rolling. Slide through the press bay.");
    } else if (shot === "photo") this.completeTask("drive");
    return shot;
  }
  updateDrivingJob(dt: number, sample: DriveSample) {
    if (this.mode !== "playing" || this.pressurePaused || this.onRoadshow) return;
    const result = this.drivingJobs.update(dt, sample);
    if (!result) return;
    if (result.progress || result.award) this.idle = 0;
    if (result.award) {
      this.bag += result.award;
      this.peak = Math.max(this.peak, this.bag);
      this.viewers += result.viewers ?? 0;
      this.notify(`${result.text} +$${result.award} · +${result.viewers} watching`, "pump");
    } else if (result.text) this.notify(result.text);
    return result;
  }
  requestTask() {
    if (
      this.mode !== "playing" ||
      this.pendingChoice !== null ||
      this.completed >= TASKS.length
    )
      return false;
    this.mode = "choice";
    return true;
  }
  choose(index: number) {
    if (
      this.mode !== "choice" ||
      !Number.isInteger(index) ||
      !TASKS[this.completed]?.choices[index]
    )
      return false;
    this.pendingChoice = index;
    if (this.completed === AIRDROP_TASK_ID) this.bagworker.start();
    if (this.completed === INCIDENT_TASK_ID) this.incident = new IncidentJob(index);
    this.mode = this.taskScene ? "task-scene" : "playing";
    this.idle = 0;
    return true;
  }
  cancelTaskScene() {
    if (this.mode !== "task-scene") return false;
    this.pendingChoice = null;
    this.incident = null;
    this.mode = "choice";
    return true;
  }
  completeTask(source: "street" | "scene" | "drive" = "street") {
    const mode = source === "scene" ? "task-scene" : "playing";
    if (
      this.mode !== mode ||
      this.pendingChoice === null ||
      this.completed >= TASKS.length
    )
      return false;
    if ((source === "drive") !== this.onRoadshow || (this.onRoadshow && !this.roadshow.photoTaken)) return false;
    if (this.completed === AIRDROP_TASK_ID && this.bagworker.phase !== "stunt")
      return false;
    if (this.completed === PAYROLL_TASK_ID && this.bagworker.phase !== "payday")
      return false;
    if (this.completed === INCIDENT_TASK_ID && !this.incident?.result)
      return false;
    const payroll = this.completed === PAYROLL_TASK_ID;
    const exposed = this.incident?.result === "exposed";
    const choice = TASKS[this.completed].choices[this.pendingChoice];
    this.choices.push(this.pendingChoice);
    this.completed++;
    this.viewers += exposed ? 40 : 75;
    // The sponsor shoot starts the moment the motel job ends.
    this.pendingChoice = this.onRoadshow ? 0 : null;
    this.incident = null;
    if (exposed) {
      this.heat = Math.min(100, this.heat + 28);
      this.combo = 1;
      this.notify("ONCHAINOLIVE POSTED A THREAD. THE COVER IS GLASS.", "dump");
    } else {
      if (choice.reward > 0) this.award(choice.reward);
      this.notify(choice.reaction, "pump");
      this.heat = Math.min(100, this.heat + 16);
    }
    if (payroll) this.bagworker.phase = "paid";
    if (this.buyerCount > 0)
      this.hitGrace = Math.max(this.hitGrace, TASK_HIT_GRACE);
    if (this.routeComplete) {
      this.mode = "victory";
      this.notify("THE SLOPMEISTER HAS ARRIVED.", "pump");
    } else this.mode = "playing";
    return true;
  }
  award(base: number) {
    this.bag += base * this.combo * (this.pickupTime > 0 ? 2 : 1);
    this.peak = Math.max(this.peak, this.bag);
    this.combo = Math.min(4, this.combo + 1);
    this.idle = 0;
  }
  stunt(id: string) {
    if (this.mode !== "playing" || this.usedSpots.has(id)) return false;
    this.usedSpots.add(id);
    this.viewers += 40;
    this.award(100);
    this.heat = Math.min(100, this.heat + 5);
    this.notify("AIRTIME IS A BUSINESS MODEL.", "pump");
    return true;
  }
  hype(id?: string) {
    if (this.mode !== "playing" || this.cooldown > 0) return false;
    this.cooldown = 8;
    this.heat = Math.min(100, this.heat + 7);
    if (id && !this.usedSpots.has(id)) {
      this.usedSpots.add(id);
      this.viewers += 25;
      this.award(80);
      this.notify("The crowd has discovered your lack of shame.", "pump");
    }
    return true;
  }
  recordFatality(person: string) {
    if (this.mode !== "playing" || this.pressurePaused || this.fatalities.has(person))
      return false;
    this.fatalities.add(person);
    // Charge the bag once, at impact. Cash-out already banks this net balance.
    const fine = Math.min(this.bag, Math.round(this.bag * 5) / 100);
    this.bag -= fine;
    this.incidentLoss = Math.round((this.incidentLoss + fine) * 100) / 100;
    this.lastFine = fine;
    this.incidentAt = this.activeTime;
    this.viewers += 250;
    this.notify(`+250 watching · −$${fine.toLocaleString("en-US", { maximumFractionDigits: 2 })} from your bag`, "dump");
    return true;
  }
  pickup(id: string) {
    if (this.mode !== "playing" || this.usedSpots.has(id)) return false;
    this.usedSpots.add(id);
    this.pickupTime = 8;
    this.idle = 0;
    this.notify("×2 HYPE · MAXIMUM BAD IDEAS", "pump");
    return true;
  }
  collide() {
    if (this.mode !== "playing" || this.collideGrace > 0) return false;
    this.collideGrace = 0.8;
    this.combo = 1;
    this.notify("Momentum lost. The chat noticed.", "dump");
    return true;
  }
  buyerHit() {
    if (this.mode !== "playing" || this.pressurePaused || this.hitGrace > 0)
      return false;
    this.hitGrace = BUYER_HIT_GRACE;
    this.strikes++;
    this.combo = 1;
    this.bag = Math.max(0, this.bag - 120);
    this.notify("“BRO. WHERE IS THE UTILITY?”", "dump");
    if (this.strikes >= 3) this.finish("caught");
    else if (this.bag <= 0) this.finish("bust");
    return true;
  }
  requestCashout() {
    if ((this.mode !== "playing" && this.mode !== "victory") || this.bag < 1000)
      return false;
    this.previousMode = this.mode;
    this.mode = "cashout";
    return true;
  }
  confirmCashout() {
    if (this.mode !== "cashout" || this.bag < 1000) return false;
    this.finish(this.routeComplete ? "slopmeister" : "early");
    return true;
  }
  finish(ending: Ending) {
    if (this.mode === "result") return;
    this.ending = ending;
    this.banked =
      ending === "early" || ending === "slopmeister" ? Math.floor(this.bag) : 0;
    this.best = Math.max(this.best, this.banked);
    this.mode = "result";
  }
  pause() {
    if (
      this.mode === "playing" ||
      this.mode === "intro" ||
      this.mode === "intro-ready"
    ) {
      this.previousMode = this.mode;
      this.mode = "paused";
    }
  }
  resume() {
    if (this.mode === "car-radio") this.mode = "playing";
    else if (this.mode === "paused") this.mode = this.previousMode;
    else if (this.mode === "cashout") this.mode = this.previousMode;
    else if (this.mode === "victory") {
      this.mode = "playing";
      this.idle = 0;
      this.hitGrace = 3;
    }
  }
}
