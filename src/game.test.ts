import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "./game.ts";
import { DrivingJobs, PRESS_BAY, PRESS_GATES, Roadshow, type DriveSample } from "./driving-jobs.ts";
import { INCIDENT_TASK_ID, TASKS, UTILITY_TASK_ID, defenceThread } from "./content.ts";
import {
  AIRDROP_TASK_ID,
  PAYROLL_TASK_ID,
  COURSE,
  WALLET,
  BagWorkerJob,
} from "./bagworker.ts";
import { streetRoute } from "./navigation.ts";

function drivingSample(x: number, z: number, overrides: Partial<DriveSample> = {}): DriveSample {
  return { car: 0, x, z, distance: 0.35, speed: 21, slipAngle: 0, grounded: true, impact: 0, ...overrides };
}

function filmSponsorShoot(game: Game) {
  for (const gate of PRESS_GATES) {
    assert.equal(game.filmRoadshow({ x: 0, z: gate.z + 0.2 }, drivingSample(0, gate.z - 0.15), false), "gate");
  }
  for (let i = 0; i < 3; i++) {
    const z = PRESS_BAY.z - i * 0.35;
    const shot = game.filmRoadshow({ x: 0, z: z + 0.35 }, drivingSample(0, z, { slipAngle: 0.8 }), true);
    assert.equal(shot, i === 2 ? "photo" : null);
  }
}

test("each station pays once and only the final crown toss earns the Slopmeister ending", () => {
  const game = new Game();
  game.start();
  assert.equal(game.requestCashout(), false);
  for (const [i, task] of TASKS.entries()) {
    assert.equal(task.id, i);
    if (task.action === "drive") {
      assert.equal(game.requestTask(), false);
      assert.equal(game.completeTask(), false);
      filmSponsorShoot(game);
      assert.equal(game.completed, i + 1);
      continue;
    }
    assert.equal(game.requestTask(), true);
    assert.equal(game.choose(2), true);
    const scene = task.choices[2].scene ?? task.scene;
    if (scene) {
      assert.equal(game.taskScene, scene);
      assert.equal(game.completeTask(), false);
    } else {
      assert.equal(game.completeTask("scene"), false);
    }
    if (task.action === "airdrop") {
      for (let n = 0; n < COURSE.length; n++) game.bagworker.land(n);
      for (let n = COURSE.length - 2; n >= 0; n--) game.bagworker.land(n);
      game.bagworker.report();
    }
    if (task.action === "launch") {
      game.bagworker.enterCannon();
      game.bagworker.fire();
      game.bagworker.finishFlight(WALLET);
    }
    if (scene === "incident") {
      assert.equal(game.completeTask("scene"), false);
      while (!game.incident?.done) assert.equal(game.incident?.assist(), true);
    }
    assert.equal(game.completeTask(scene ? "scene" : "street"), true);
    const bag = game.bag;
    assert.equal(game.completeTask(scene ? "scene" : "street"), false);
    assert.equal(game.bag, bag);
    assert.equal(game.completed, i + 1);
    assert.equal(game.mode, i === TASKS.length - 1 ? "victory" : "playing");
  }
  assert.equal(game.mode, "victory");
  assert.equal(game.requestCashout(), true);
  assert.equal(game.confirmCashout(), true);
  assert.equal(game.ending, "slopmeister");
  const banked = game.banked;
  game.finish("caught");
  assert.equal(game.banked, banked);
});
test("early cash-out and the accompanying defence reflect only completed tasks", () => {
  const game = new Game();
  game.start();
  game.requestTask();
  game.choose(2);
  game.completeTask("scene");
  assert(game.requestCashout());
  assert(game.confirmCashout());
  assert.equal(game.ending, "early");
  assert.equal(game.completed, 1);
  const posts = defenceThread({
    coin: game.coin.name,
    banked: game.banked,
    completed: 1,
    slopmeister: false,
    choiceLabels: [TASKS[0].choices[2].label],
  });
  const thread = posts.join(" ");
  assert(thread.includes("1 of " + TASKS.length));
  assert(thread.includes("peanut butter"));
  assert(!thread.includes("seagull"));
  assert(thread.split(/\s+/).length >= 250);
  assert(thread.split(/\s+/).length <= 400);
});
test("menus and pause freeze all pressure timers and value", () => {
  const game = new Game();
  game.start();
  game.idle = 20;
  game.cooldown = 5;
  game.pickupTime = 3;
  game.requestTask();
  game.tick(0.05);
  assert.equal(game.bag, 500);
  assert.equal(game.cooldown, 5);
  assert.equal(game.pickupTime, 3);
  game.choose(2);
  assert.equal(game.mode, "task-scene");
  game.tick(0.05);
  assert.equal(game.bag, 500);
  assert.equal(game.cooldown, 5);
  assert.equal(game.pickupTime, 3);
  assert.equal(game.requestCashout(), false);
  assert(game.cancelTaskScene());
  assert.equal(game.mode, "choice");
  assert.equal(game.pendingChoice, null);
  assert.equal(game.completeTask("scene"), false);
  game.choose(0);
  game.pause();
  game.tick(0.05);
  assert.equal(game.bag, 500);
  game.resume();
  game.tick(0.05);
  assert.equal(game.cooldown, 4.95);
});
test("capture loses gains and overlap cannot cause three immediate strikes", () => {
  const game = new Game();
  game.start();
  game.bag = 9000;
  assert(game.buyerHit());
  assert(!game.buyerHit());
  assert(!game.buyerHit());
  assert.equal(game.strikes, 1);
  game.hitGrace = 0;
  game.buyerHit();
  game.hitGrace = 0;
  game.buyerHit();
  assert.equal(game.mode, "result");
  assert.equal(game.ending, "caught");
  assert.equal(game.banked, 0);
});
test("restart resets transient state and keeps only session best", () => {
  const game = new Game();
  game.start();
  game.bag = 4500;
  game.requestCashout();
  game.confirmCashout();
  game.usedSpots.add("pickup-0");
  game.choices = [2];
  game.completed = 1;
  game.strikes = 2;
  game.start();
  assert.equal(game.best, 4500);
  assert.equal(game.bag, 500);
  assert.equal(game.mode, "playing");
  assert.equal(game.completed, 0);
  assert.deepEqual(game.choices, []);
  assert.equal(game.usedSpots.size, 0);
  assert.equal(game.strikes, 0);
});
test("repeating a spectacle or pickup cannot farm money or stack multipliers", () => {
  const game = new Game();
  game.start();
  assert(game.stunt("jump-0"));
  const value = game.bag;
  assert(!game.stunt("jump-0"));
  assert.equal(game.bag, value);
  assert(game.pickup("pickup-0"));
  assert(!game.pickup("pickup-0"));
  assert.equal(game.pickupTime, 8);
  assert(game.hype("crowd-0"));
  game.cooldown = 0;
  const after = game.bag;
  assert(game.hype("crowd-0"));
  assert.equal(game.bag, after);
});
test("boredom collapse cannot race a confirmed cash-out or mutate an ending", () => {
  const game = new Game();
  game.start();
  game.bag = 1;
  game.idle = 20;
  game.tick(0.05);
  assert.equal(game.ending, "bust");
  assert.equal(game.bag, 0);
  assert(!game.requestCashout());
  game.start();
  game.bag = 1500;
  game.idle = 20;
  game.requestCashout();
  game.tick(0.05);
  assert.equal(game.bag, 1500);
  game.confirmCashout();
  game.tick(0.05);
  assert.equal(game.banked, 1500);
});

test("a slower player has time before the bag cools or buyers can land a hit", () => {
  const game = new Game();
  game.start();
  game.idle = 15.95;
  game.tick(0.05);
  assert.equal(game.bag, 500);
  assert.equal(game.marketCooling, false);
  game.tick(0.05);
  assert.equal(game.marketCooling, true);
  assert.equal(game.bag, 499);

  for (let i = 0; i <= UTILITY_TASK_ID; i++) {
    if (game.onRoadshow) filmSponsorShoot(game);
    else {
      assert(game.requestTask());
      assert(game.choose(0));
      assert(game.completeTask());
    }
    assert.equal(game.marketCooling, false);
    assert.equal(game.buyerCount, i === UTILITY_TASK_ID ? 1 : 0);
  }
  assert.equal(game.hitGrace, 5);
  assert.equal(game.buyerHit(), false);
  game.hitGrace = 0;
  assert(game.buyerHit());
  assert.equal(game.hitGrace, 4.5);
});

test("fake airdrop requires every outward and return landing, then a successful stunt before cash", () => {
  const game = new Game();
  game.start();
  game.completed = AIRDROP_TASK_ID;
  game.choices = [2, 2, 2, 2, 2];
  game.bag = 5000;
  game.requestTask();
  game.choose(2);
  const bag = game.bag;
  assert.equal(game.completeTask(), false);
  assert.equal(game.bagworker.land(8), null);
  for (let n = 0; n < COURSE.length; n++) game.bagworker.land(n);
  assert.equal(game.bagworker.phase, "return");
  assert.equal(game.bagworker.report(), false);
  assert.equal(game.bagworker.land(0), null);
  for (let n = COURSE.length - 2; n >= 0; n--) game.bagworker.land(n);
  assert(game.bagworker.report());
  assert(game.completeTask());
  assert.equal(game.bag, bag);
  assert.equal(game.completed, PAYROLL_TASK_ID);
  game.requestTask();
  game.choose(2);
  assert.equal(game.completeTask(), false);
  game.bagworker.enterCannon();
  game.bagworker.fire();
  assert.equal(
    game.bagworker.finishFlight({ x: WALLET.x + 12, y: 0, z: WALLET.z }),
    false,
  );
  assert.equal(game.completeTask(), false);
  assert.equal(game.bag, bag);
  game.bagworker.enterCannon();
  game.bagworker.fire();
  assert(game.bagworker.finishFlight(WALLET));
  assert(game.completeTask());
  assert.equal(game.bag, bag + 1000);
  assert.equal(game.bagworker.phase, "paid");
  assert.equal(game.completeTask(), false);
  assert.equal(game.bag, bag + 1000);
});

test("course falls recover from the right checkpoint in either direction", () => {
  const job = new BagWorkerJob();
  job.start();
  for (let n = 0; n <= 5; n++) job.land(n);
  assert.deepEqual(job.recover(), COURSE[4]);
  assert.equal(job.next, 5);
  for (let n = 5; n < COURSE.length; n++) job.land(n);
  assert.deepEqual(job.recover(), COURSE[8]);
  assert.equal(job.next, 7);
  job.land(7);
  job.land(6);
  job.land(5);
  assert.deepEqual(job.recover(), COURSE[6]);
  assert.equal(job.next, 5);
});

test("the job protects the bag, pause freezes cannon timing, and restart clears its state", () => {
  const game = new Game();
  game.start();
  game.completed = AIRDROP_TASK_ID;
  game.bag = 5000;
  game.idle = 20;
  game.requestTask();
  game.choose(2);
  for (let n = 0; n < 1200; n++) game.tick(0.05);
  assert.equal(game.bag, 5000);
  assert.equal(game.buyerCount, 0);
  assert.equal(game.buyerHit(), false);
  for (let n = 0; n < COURSE.length; n++) game.bagworker.land(n);
  for (let n = COURSE.length - 2; n >= 0; n--) game.bagworker.land(n);
  game.bagworker.report();
  game.completeTask();
  game.requestTask();
  game.choose(2);
  game.bagworker.enterCannon();
  game.tick(0.05);
  const charge = game.bagworker.chargeTime;
  game.pause();
  game.tick(0.05);
  assert.equal(game.bagworker.chargeTime, charge);
  game.resume();
  game.tick(0.05);
  assert(game.bagworker.chargeTime > charge);
  game.start();
  assert.equal(game.bagworker.phase, "idle");
  assert.equal(game.bagworker.next, 0);
  assert.equal(game.pressurePaused, false);
});

test("routes between the streets pass through an actual cross street", () => {
  const route = streetRoute({ x: 0, z: -207 }, { x: -60, z: -200 });
  assert(route.some((p) => p.x === 0 && p.z === -233));
  assert(route.some((p) => p.x === -60 && p.z === -233));
  for (let n = 1; n < route.length; n++)
    assert(route[n].x === route[n - 1].x || route[n].z === route[n - 1].z);
});

test("opening and ready screen freeze the run and cannot pay or start a job", () => {
  const game = new Game();
  game.start(true);
  assert.equal(game.takeControl(), false);
  for (const mode of ["intro", "intro-ready"] as const) {
    assert.equal(game.mode, mode);
    const before = JSON.stringify(game);
    game.tick(30);
    assert.equal(game.requestTask(), false);
    assert.equal(game.pickup("pickup-0"), false);
    assert.equal(game.stunt("jump-0"), false);
    assert.equal(game.buyerHit(), false);
    assert.equal(JSON.stringify(game), before);
    game.pause();
    assert.equal(game.mode, "paused");
    game.tick(30);
    assert.equal(game.finishIntro(), false);
    assert.equal(game.takeControl(), false);
    game.resume();
    assert.equal(game.mode, mode);
    if (mode === "intro") assert(game.finishIntro());
  }
  assert(game.takeControl());
  assert.equal(game.takeControl(), false);
  assert.equal(game.finishIntro(), false);
  game.tick(0.05);
  assert.equal(game.activeTime, 0.05);
  game.start();
  assert.equal(game.mode, "playing");
  assert.equal(game.activeTime, 0);
});

test("the raised wallet rejects ground and rim landings and allows a clean retry", () => {
  const game = new Game();
  game.start();
  game.completed = PAYROLL_TASK_ID;
  game.bagworker.phase = "stunt";
  game.requestTask();
  game.choose(2);
  const bag = game.bag;
  for (const miss of [
    { ...WALLET, y: 0 },
    { ...WALLET, y: WALLET.y - 0.24 },
    { ...WALLET, y: WALLET.y + 0.96 },
    { ...WALLET, x: WALLET.x - 3.1 },
    { ...WALLET, z: WALLET.z + 3.5 },
  ]) {
    assert(game.bagworker.enterCannon());
    assert(game.bagworker.fire());
    assert.equal(game.bagworker.finishFlight(miss), false);
    assert.equal(game.bagworker.phase, "stunt");
    assert.equal(game.completeTask(), false);
    assert.equal(game.bag, bag);
  }
  assert(game.bagworker.enterCannon());
  assert(game.bagworker.fire());
  assert(game.bagworker.finishFlight(WALLET));
  assert(game.completeTask());
  assert.equal(game.bag, bag + 1000);
  assert.equal(game.completeTask(), false);
});

test("fatalities trade five percent of the current bag for 250 viewers exactly once per person", () => {
  const game = new Game();
  game.start();
  game.bag = 2000;
  game.combo = 4;
  game.pickupTime = 8;
  assert.equal(game.recordFatality("crossing-1"), true);
  assert.equal(game.recordFatality("crossing-1"), false);
  assert.equal(game.bag, 1900);
  assert.equal(game.viewers, 250);
  assert.equal(game.recordFatality("crossing-2"), true);
  assert.equal(game.bag, 1805);
  assert.equal(game.incidentLoss, 195);
  assert.equal(game.kills, 2);
  assert.equal(game.viewers, 500);
  assert.equal(game.requestCashout(), true);
  assert.equal(game.recordFatality("crossing-3"), false);
  assert.equal(game.confirmCashout(), true);
  assert.equal(game.banked, 1805);
  game.start();
  assert.equal(game.viewers, 0);
  assert.equal(game.incidentLoss, 0);
  assert.equal(game.recordFatality("crossing-1"), true);
  assert.equal(game.best, 1805);
});

test("an incident can take a bag below cash-out eligibility and protected missions freeze it", () => {
  const game = new Game();
  game.start();
  game.bag = 1001;
  game.pause();
  assert.equal(game.recordFatality("walker"), false);
  game.resume();
  game.bagworker.start();
  assert.equal(game.recordFatality("walker"), false);
  game.bagworker.phase = "paid";
  assert.equal(game.recordFatality("walker"), true);
  assert.equal(game.bag, 950.95);
  assert.equal(game.requestCashout(), false);
  assert.equal(game.incidentLoss, 50.05);
});

test("the press shoot requires both forward passes and genuine tire slip inside the photo bay", () => {
  const shoot = new Roadshow();
  const first = PRESS_GATES[0], second = PRESS_GATES[1];
  const pass = (x: number, z: number, car = 0) =>
    shoot.update({ x, z: z + 0.2 }, drivingSample(x, z - 0.15, { car }), false);
  pass(0, second.z);
  pass(first.halfWidth + 2, first.z);
  pass(0, first.z, -1);
  shoot.update({ x: 0, z: first.z - 0.2 }, drivingSample(0, first.z + 0.15), false);
  shoot.update({ x: 0, z: first.z + 6 }, drivingSample(0, first.z - 6), false);
  assert.equal(shoot.gate, 0);
  assert.equal(pass(0, first.z), "gate");
  assert.equal(pass(0, second.z), "gate");
  const slide = (x: number, slipAngle: number, handbrake: boolean, grounded = true) =>
    shoot.update({ x, z: PRESS_BAY.z + 0.35 }, drivingSample(x, PRESS_BAY.z, { slipAngle, grounded }), handbrake);
  for (let i = 0; i < 5; i++) {
    slide(PRESS_BAY.halfWidth + 2, 0.8, true);
    slide(0, 0.02, true);
    slide(0, 0.8, false);
    slide(0, 0.8, true, false);
  }
  assert.equal(shoot.photoTaken, false);
  slide(0, 0.8, true);
  slide(PRESS_BAY.halfWidth + 2, 0.8, true);
  assert.equal(shoot.slidingMetres, 0);
  assert.equal(shoot.gate, 2);
  slide(0, 0.8, true);
  slide(0, 0.8, true);
  assert.equal(slide(0, 0.8, true), "photo");
  assert.equal(slide(0, 0.8, true), null);
});

test("the story driving task keeps its own payout and preserves an existing radio booking", () => {
  const game = new Game();
  game.start();
  game.drivingJobs.start("delivery", 0);
  game.requestTask();
  game.choose(0);
  game.completeTask();
  assert.equal(game.onRoadshow, true);
  assert.equal(game.openCarRadio(), false);
  assert.equal(game.completeTask("drive"), false);
  game.pause();
  const gate = PRESS_GATES[0];
  assert.equal(game.filmRoadshow({ x: 0, z: gate.z + 0.2 }, drivingSample(0, gate.z - 0.1), false), null);
  game.resume();
  const before = game.bag, combo = game.combo, watching = game.viewers;
  filmSponsorShoot(game);
  assert.equal(TASKS[game.completed].title, "Hire a CEO.");
  assert.equal(game.bag - before, 500 * combo);
  assert.equal(game.viewers - watching, 75);
  assert.equal(game.completeTask("drive"), false);
  assert.equal(game.drivingJobs.active, "delivery");
  assert.equal(game.drivingJobs.cargo, 0);
  game.start();
  assert.equal(game.roadshow.gate, 0);
  assert.equal(game.roadshow.photoTaken, false);
});

const wheelSample: DriveSample = {
  car: 0, x: 0, z: 0, distance: 0, speed: 0, slipAngle: 0, grounded: true, impact: 0,
};

test("the radio freezes the run, and only real slides at both corners pay the fixed sponsor fee", () => {
  const game = new Game();
  game.start();
  assert.ok(game.openCarRadio());
  game.tick(0.05);
  assert.equal(game.activeTime, 0);
  assert.equal(game.recordFatality("crossing"), false);
  assert.ok(game.drivingJobs.start("drift", 0));
  game.resume();
  game.combo = 4;
  game.pickupTime = 5;
  const step = (x: number, z: number, options: Partial<DriveSample> = {}) =>
    game.updateDrivingJob(1/60, { ...wheelSample, x, z, distance: 0.3, speed: 18, slipAngle: 0.7, ...options });
  for (let i = 0; i < 25; i++) {
    step(-57, -233); // Second corner first.
    step(-2, -232, { car: 1 });
    step(-2, -232, { grounded: false });
    step(-2, -232, { slipAngle: 0 });
    step(-2, -232, { distance: 0 });
  }
  assert.equal(game.drivingJobs.slidingMetres, 0);
  for (let i = 0; i < 24; i++) step(-2, -232);
  assert.equal(game.drivingJobs.stage, 1);
  for (let i = 0; i < 40; i++) step(-57, -233);
  assert.deepEqual([game.bag, game.viewers, game.completed], [1200, 120, 0]);
  assert.equal(game.drivingJobs.start("drift", 0), false);
  game.start();
  assert.equal(game.drivingJobs.cleared.size, 0);
  game.bagworker.start();
  assert.equal(game.openCarRadio(), false);
});

test("only the assigned delivery car can load, lose and cash in its roof cargo", () => {
  const game = new Game();
  game.start();
  const jobs = game.drivingJobs;
  const tick = (overrides: Partial<DriveSample> = {}, count = 1) => {
    for (let i = 0; i < count; i++) game.updateDrivingJob(1/60, {
      ...wheelSample, car: 2, x: 5.4, z: -72, ...overrides,
    });
  };
  assert.ok(jobs.start("delivery", 2));
  tick({}, 10);
  tick({ speed: 4 });
  tick({}, 12);
  assert.equal(jobs.cargo, 0);
  tick({}, 12);
  assert.equal(jobs.cargo, 6);
  tick({ impact: 15, car: 1 });
  assert.equal(jobs.cargo, 6);
  tick({ impact: 14 }, 9);
  assert.equal(jobs.cargo, 4);
  tick({}, 55);
  tick({ impact: 7 });
  assert.equal(jobs.cargo, 3);
  tick({ car: 1, x: 4, z: -333 }, 30);
  assert.equal(jobs.active, "delivery");
  tick({ x: 4, z: -333 }, 35);
  assert.deepEqual([jobs.earnings, game.bag, game.viewers, jobs.cargo], [450, 950, 90, 0]);
  assert.equal(jobs.start("delivery", 2), false);
});

test("an empty roof cancels without paying and a fresh delivery can be booked", () => {
  const jobs = new DrivingJobs();
  jobs.start("delivery", 0);
  const s = { ...wheelSample, x: 5.4, z: -72 };
  for (let i = 0; i < 25; i++) jobs.update(1/60, s);
  for (let hit = 0; hit < 3; hit++) {
    jobs.update(1/60, { ...s, impact: 15 });
    for (let i = 0; i < 54; i++) jobs.update(1/60, s);
  }
  assert.deepEqual([jobs.active, jobs.cleared.size, jobs.earnings], [null, 0, 0]);
  assert.ok(jobs.start("delivery", 1));
  assert.equal(jobs.cargo, 0);
});

test("the valet pays only for a flight from the last ramp that touches down inside the bay", () => {
  const jobs = new DrivingJobs();
  jobs.start("ramp", 0);
  const step = (x: number, z: number, grounded: boolean, launchRampZ?: number) =>
    jobs.update(1/60, { ...wheelSample, x, z, speed: 20, grounded, launchRampZ, distance: 0.33 });
  step(0, -333, true);
  step(0, -311, true);
  step(0, -295, true); // Driving away disarms the old approach.
  step(0, -332, false);
  step(0, -333, true);
  assert.equal(jobs.stage, 0);
  step(0, -319, false, -226);
  assert.equal(jobs.stage, 0);
  step(0, -314, true);
  step(0, -319, false, -314);
  assert.equal(jobs.stage, 1);
  step(8, -334, true);
  assert.equal(jobs.stage, 0);
  assert.equal(jobs.earnings, 0);
  step(0, -314, true);
  step(0, -319, false, -314);
  const landing = step(0, -333, true);
  assert.equal(landing?.award, 960);
  assert.equal(landing?.viewers, 125);
  assert.equal(step(0, -333, true), null);
  assert.equal(jobs.earnings, 960);
});

test("the radio rewards progress toward a target once per stretch of road", () => {
  const game = new Game();
  game.start();
  game.drivingJobs.start("delivery", 0);
  const drive = (z: number) => game.updateDrivingJob(1/60, { ...wheelSample, z, distance: 0.25 });
  drive(0);
  game.idle = 15;
  drive(-4);
  assert.equal(game.idle, 15);
  drive(-14);
  assert.equal(game.idle, 0);
  game.idle = 12;
  drive(-2);
  drive(-15);
  assert.equal(game.idle, 12);
});

test("a handbrake turn preserves sideways travel after release and opposite lock catches it", async () => {
  const THREE = await import("three");
  const { default: RAPIER } = await import("@dimforge/rapier3d-compat");
  const { StreetCars } = await import("./vehicles.ts");
  await RAPIER.init();
  function release(countersteer: number) {
    const world = new RAPIER.World({ x: 0, y: -22, z: 0 });
    try {
      world.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(0, -0.05, 0));
      const assets = { create: () => new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 1, 4))) };
      const cars = new StreetCars(new THREE.Scene(), world, assets as unknown as import("./assets.ts").Assets);
      assert.ok(cars.enter(-3.4, 2.5));
      const car = cars.mounted!;
      const run = (frames: number, throttle: number, steer: number, brake: boolean) => {
        for (let i = 0; i < frames; i++) { cars.step(1/60, { throttle, steer, brake }); world.step(); }
      };
      run(80, 1, 0, false);
      assert.equal(car.slipAngle, 0);
      run(22, 0, -1, true);
      run(18, 0, countersteer, false);
      return car.slipAngle;
    } finally { world.free(); }
  }
  const coasting = release(0);
  assert.ok(coasting > 0.36, `held slide after release: ${coasting}`);
  assert.ok(release(1) < coasting * 0.65);
});

test("street ramps carry speed to the lip and give the valet a real, controllable landing", async () => {
  const THREE = await import("three");
  const { default: RAPIER } = await import("@dimforge/rapier3d-compat");
  const { StreetCars } = await import("./vehicles.ts");
  const { FINAL_RAMP, RAMP_CENTERS, rampLip, rampMeshData } = await import("./ramps.ts");
  const { VALET_BAY } = await import("./driving-jobs.ts");
  await RAPIER.init();
  const data = rampMeshData();
  function drive(center: number, targetSpeed: number, lane = 0) {
    const world = new RAPIER.World({ x: 0, y: -22, z: 0 });
    try {
      world.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(0, -0.05, 0));
      world.createCollider(RAPIER.ColliderDesc.trimesh(data.vertices, data.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setTranslation(0, 0, center));
      const assets = { create: () => new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 1, 4))) };
      const cars = new StreetCars(new THREE.Scene(), world, assets as unknown as import("./assets.ts").Assets);
      const car = cars.fleet[0];
      car.spawn.set(lane, 0, center + 32);
      cars.reset();
      for (const parked of cars.fleet.slice(1)) {
        parked.traffic = false;
        parked.collider.setEnabled(false);
      }
      assert.ok(cars.enter(lane, center + 32));
      let airborneAt: number | null = null, touchdownAt: number | null = null, lipHeight = 0;
      let minUphillSpeed = Infinity, maxUphillImpact = 0, landingImpact = 0;
      for (let frame = 0; frame < 420; frame++) {
        const wasFlying = car.airborne;
        cars.step(1 / 60, { throttle: car.speed < targetSpeed ? 1 : 0, steer: 0, brake: false });
        world.step();
        if (car.position.z <= center + 7 && car.position.z > rampLip(center)) {
          minUphillSpeed = Math.min(minUphillSpeed, car.speed);
          maxUphillImpact = Math.max(maxUphillImpact, car.impact);
        }
        if (!wasFlying && car.launchRampZ === center) {
          airborneAt = car.position.z;
          lipHeight = car.position.y;
        }
        if (wasFlying && !car.airborne) {
          touchdownAt = car.position.z;
          landingImpact = car.impact;
          break;
        }
      }
      return { airborneAt, touchdownAt, lipHeight, minUphillSpeed, maxUphillImpact, landingImpact };
    } finally { world.free(); }
  }
  for (const [i, center] of RAMP_CENTERS.entries()) {
    const speed = [12, 16, 21, 26][i];
    const run = drive(center, speed);
    assert.ok(run.airborneAt !== null && Math.abs(run.airborneAt - rampLip(center)) < 0.5);
    assert.ok(run.lipHeight > 1.8 && run.minUphillSpeed >= speed - 0.4, JSON.stringify({ center, speed, ...run }));
    assert.equal(run.maxUphillImpact, 0);
    assert.ok(run.touchdownAt !== null && run.touchdownAt < rampLip(center) - 5);
    assert.ok(run.landingImpact < 6.5, "clean jumps keep the roof cargo");
  }
  for (const speed of [12, 18, 25]) {
    const { touchdownAt } = drive(FINAL_RAMP, speed);
    assert.ok(touchdownAt !== null && Math.abs(touchdownAt - VALET_BAY.z) < VALET_BAY.halfLength, JSON.stringify({ speed, touchdownAt }));
  }
  assert.equal(drive(FINAL_RAMP, 18, 2.85).airborneAt, null, "grazing a side cannot score a takeoff");
});

test("the test jump opens the war room and pays only if the cover holds", () => {
  const game = new Game();
  game.jumpToIncident();
  assert.equal(game.completed, INCIDENT_TASK_ID);
  assert.equal(game.bag, 2500);
  assert.equal(game.requestTask(), true);
  assert.equal(game.choose(2), true);
  assert.equal(game.taskScene, "incident");
  assert.equal(game.completeTask("scene"), false);
  while (!game.incident?.done) assert.equal(game.incident?.assist(), true);
  assert.equal(game.incident?.result, "cover");
  const before = game.bag;
  assert.equal(game.completeTask("scene"), true);
  assert(game.bag > before);
  assert.equal(game.completed, INCIDENT_TASK_ID + 1);
  assert.equal(game.mode, "playing");
});

test("a blown cover completes the job without the payout", () => {
  const game = new Game();
  game.jumpToIncident();
  const startBag = game.bag;
  game.requestTask();
  game.choose(2);
  const job = game.incident!;
  assert.equal(job.choose("skim"), true);
  assert.equal(job.choose("clown"), true);
  assert.equal(job.choose("wire"), true);
  assert.equal(job.choose("gm"), true);
  assert.equal(job.result, "exposed");
  assert.equal(game.completeTask("scene"), true);
  assert.equal(game.bag, startBag);
  assert.equal(game.completed, INCIDENT_TASK_ID + 1);
  assert.equal(game.mode, "playing");
  assert(game.notices[0]?.text.includes("ONCHAINOLIVE"));
});

test("backing out of the war room clears the incident", () => {
  const game = new Game();
  game.jumpToIncident();
  game.requestTask();
  game.choose(0);
  assert(game.incident);
  assert.equal(game.cancelTaskScene(), true);
  assert.equal(game.incident, null);
  assert.equal(game.mode, "choice");
  assert.equal(game.completeTask("scene"), false);
});
