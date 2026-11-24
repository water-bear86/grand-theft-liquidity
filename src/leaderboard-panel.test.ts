import test, { mock } from "node:test";
import assert from "node:assert/strict";

const pending: { score: number; resolve: (value: never[]) => void; reject: (error: Error) => void }[] = [];
mock.module("./leaderboard-client.ts", {
  exports: {
    fetchLeaderboard: async () => [],
    isUserRejection: () => false,
    leaderboardConfigured: () => true,
    submitScore: (score: number) => new Promise((resolve, reject) => {
      pending.push({ score, resolve, reject });
    }),
  },
});
mock.module("./wallet.ts", {
  exports: {
    wallet: {
      address: "wallet-address",
      available: true,
      subscribe: () => () => {},
    },
  },
});
const { LeaderboardPanel } = await import("./leaderboard-panel.ts");

function host() {
  return {
    className: "",
    innerHTML: "",
    setAttribute() {},
    querySelector() { return null; },
  } as unknown as HTMLElement;
}

test("stale submissions cannot change a newly bound run", async () => {
  const panel = new LeaderboardPanel();
  const first = host();
  panel.bind(first, { score: 1000, submit: true });
  const oldSubmit = panel["onSubmit"]();
  assert.equal(pending[0]?.score, 1000);
  panel.unmount();
  const second = host();
  panel.bind(second, { score: 5000, submit: true });
  const newSubmit = panel["onSubmit"]();
  assert.equal(pending[1]?.score, 5000);
  pending[0]!.resolve([]);
  await oldSubmit;
  assert.match(second.innerHTML, /Signing…/);
  assert.doesNotMatch(second.innerHTML, /Posted to the board/);
  pending[1]!.resolve([]);
  await newSubmit;
  assert.match(second.innerHTML, /Posted to the board/);

  panel.unmount();
  const sameScore = host();
  panel.bind(sameScore, { score: 5000, submit: true });
  assert.match(sameScore.innerHTML, /Sign & post score/);
  const rejected = panel["onSubmit"]();
  panel.unmount();
  const next = host();
  panel.bind(next, { score: 5000, submit: true });
  pending[2]!.reject(new Error("old error"));
  await rejected;
  assert.doesNotMatch(next.innerHTML, /old error|Signing…|Posted to the board/);
  panel.unmount();
});
