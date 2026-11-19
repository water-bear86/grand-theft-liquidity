import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "./game.ts";
import { TASKS, defenceThread } from "./content.ts";
import {
  AIRDROP_TASK_ID,
  PAYROLL_TASK_ID,
  COURSE,
  WALLET,
  BagWorkerJob,
} from "./bagworker.ts";
import { streetRoute } from "./navigation.ts";

test("each station pays once and only the final crown toss earns the Slopmeister ending", () => {
  const game = new Game();
  game.start();
  assert.equal(game.requestCashout(), false);
  for (const [i, task] of TASKS.entries()) {
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

  for (let i = 0; i < 3; i++) {
    assert(game.requestTask());
    assert(game.choose(0));
    assert(game.completeTask());
    assert.equal(game.marketCooling, false);
    assert.equal(game.buyerCount, i === 2 ? 1 : 0);
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
