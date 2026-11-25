import test from "node:test";
import assert from "node:assert/strict";
import {
  INCIDENT_DISCLAIMER,
  INCIDENT_START_SUSPICION,
  INCIDENT_THRESHOLD,
  IncidentJob,
  isIncidentJumpRequest,
} from "./incident.ts";

const FICTION_TERMS = [
  "seed phrase",
  "secret phrase",
  "recovery phrase",
  "phantom",
  "connect wallet",
  "sign this",
];

function collectCopy(job: IncidentJob) {
  const view = job.view();
  return [
    view.heading,
    view.body,
    view.disclaimer,
    view.status,
    view.action,
    ...view.options.flatMap((option) => [option.label, option.detail]),
    ...view.hops.map((hop) => hop.label),
  ]
    .join(" ")
    .toLowerCase();
}

test("the safest path holds the cover even after emptying the treasury", () => {
  const job = new IncidentJob(2);
  assert.equal(job.suspicion, INCIDENT_START_SUSPICION[2]);
  while (!job.done) assert.equal(job.assist(), true);
  assert.equal(job.result, "cover");
  assert(job.suspicion < INCIDENT_THRESHOLD);
  assert.deepEqual(job.route, ["pond", "mistport", "cold"]);
  const view = job.view();
  assert.equal(view.action, "Pocket the bag");
  assert.match(view.heading, /cover story holds/i);
  assert.equal(view.disclaimer, INCIDENT_DISCLAIMER);
});

test("clumsy hops and a loud lounge post blow the cover", () => {
  const job = new IncidentJob(2);
  assert.equal(job.choose("skim"), true);
  assert.equal(job.choose("clown"), true);
  assert.equal(job.choose("wire"), true);
  assert.equal(job.choose("gm"), true);
  assert.equal(job.result, "exposed");
  assert(job.suspicion >= INCIDENT_THRESHOLD);
  assert.equal(job.view().action, "Walk it off");
  assert.match(job.view().heading, /sleuths posted a thread/i);
  assert.match(job.view().body, /OnChainOlive/);
});

test("a modest skim can still fail, and claiming your own bounty is riskier than a cutout", () => {
  const loud = new IncidentJob(0);
  loud.choose("skim");
  loud.choose("clown");
  loud.choose("wire");
  loud.choose("gm");
  assert.equal(loud.result, "exposed");

  const self = new IncidentJob(2);
  self.choose("skim");
  self.choose("calm");
  self.choose("pond");
  self.choose("mistport");
  self.choose("cold");
  self.choose("bounty");
  const before = self.suspicion;
  self.choose("claim");
  assert.equal(self.step, "result");
  assert(self.suspicion > before);

  const cutout = new IncidentJob(2);
  cutout.choose("skim");
  cutout.choose("calm");
  cutout.choose("pond");
  cutout.choose("mistport");
  cutout.choose("cold");
  cutout.choose("bounty");
  cutout.choose("cutout");
  assert.equal(cutout.result, "cover");
  assert(cutout.suspicion < self.suspicion);
});

test("illegal hops are ignored and assist will not take a sloppy wire", () => {
  const job = new IncidentJob(1);
  assert.equal(job.choose("calm"), false);
  assert.equal(job.choose("cold"), false);
  job.choose("skim");
  job.choose("nation");
  assert.equal(job.choose("cold"), false);
  assert.equal(job.choose("mistport"), false);
  job.assist();
  assert.deepEqual(job.route, ["pond"]);
  assert.equal(job.choose("wire"), false);
  job.assist();
  job.assist();
  assert.deepEqual(job.route, ["pond", "mistport", "cold"]);
  assert.equal(job.step, "discord");
});

test("copy stays fictional and never asks for a wallet or seed", () => {
  const job = new IncidentJob(2);
  const seen: string[] = [collectCopy(job)];
  const path = ["skim", "nation", "pond", "pocket", "cold", "bounty", "claim"];
  for (const id of path) {
    assert.equal(job.choose(id), true);
    seen.push(collectCopy(job));
  }
  const text = seen.join("\n");
  assert(text.includes(INCIDENT_DISCLAIMER.toLowerCase()));
  assert(text.includes("in-game"));
  for (const term of FICTION_TERMS) assert(!text.includes(term), term);
});

test("the test jump reads a mission query or hash", () => {
  assert.equal(isIncidentJumpRequest("?mission=incident", ""), true);
  assert.equal(isIncidentJumpRequest("?task=incident", ""), true);
  assert.equal(isIncidentJumpRequest("", "#incident"), true);
  assert.equal(isIncidentJumpRequest("?mission=gallery", "#title"), false);
  assert.equal(isIncidentJumpRequest("", ""), false);
});
