import { wallet } from "./wallet.ts";
import { isLikelyMobile } from "./gallery-input.ts";
import { shortenAddress } from "./leaderboard-protocol.ts";
import {
  ENTRY_SOL,
  LEGAL_LINE,
  TARGET_COUNT,
  lamportsToSol,
  type ShotInput,
} from "./gallery-protocol.ts";
import {
  fetchGalleryStatus,
  galleryConfigured,
  isUserRejection,
  enterFree,
  loadPendingEntry,
  payAndEnter,
  redeemPendingEntry,
  reportStoryComplete,
  submitGalleryRound,
  type GalleryStatus,
  type IssuedRound,
  type PublicPot,
  type SubmitResult,
} from "./gallery-client.ts";
import { GalleryScene } from "./gallery-scene.ts";
import { evaluateRound } from "./gallery-sim.ts";

const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export class GalleryPanel {
  private host: HTMLElement | null = null;
  private unbind: (() => void) | null = null;
  private scene: GalleryScene | null = null;
  private status: GalleryStatus | null = null;
  private loadError: string | null = null;
  private note = "";
  private busy: string | null = null;
  private phase: "lobby" | "playing" | "result" = "lobby";
  private round: IssuedRound | null = null;
  private outcome: SubmitResult | null = null;
  private hud = { remaining: 5, score: 0, last: "Five shots. Skip rugs, tourists, and the cursed one.", skippedFifth: false };
  private canUnlock: boolean;
  private onClose: () => void;
  private practice = false;
  private practiceSeed = "";
  private practiceForfeit = 0;

  constructor(options: { canUnlock: boolean; onClose: () => void }) {
    this.canUnlock = options.canUnlock;
    this.onClose = options.onClose;
  }

  setCanUnlock(value: boolean) {
    this.canUnlock = value;
    this.render();
  }

  bind(host: HTMLElement) {
    this.unbind?.();
    this.host = host;
    this.phase = "lobby";
    this.outcome = null;
    this.round = null;
    this.practice = false;
    this.note = "";
    this.loadError = null;
    this.busy = null;
    this.unbind = wallet.subscribe(() => {
      void this.refresh();
      this.render();
    });
    void this.refresh();
    this.render();
  }

  unmount() {
    this.scene?.dispose();
    this.scene = null;
    this.host?.classList.remove("is-playing");
    this.host?.closest(".overlay")?.classList.remove("is-playing");
    this.unbind?.();
    this.unbind = null;
    this.host = null;
  }

  private async refresh() {
    if (!galleryConfigured()) {
      this.status = null;
      this.loadError = null;
      this.render();
      return;
    }
    try {
      this.status = await fetchGalleryStatus(wallet.address);
      this.loadError = null;
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : "Couldn't reach the range.";
    }
    this.render();
  }

  private actionError(error: unknown, fallback: string): string {
    if (isUserRejection(error)) return "Signature cancelled.";
    if (error instanceof Error && error.message.trim()) return error.message;
    return fallback;
  }

  private async onConnect() {
    if (this.busy) {
      this.note = "Hang on, a Phantom request is already in progress.";
      this.render();
      return;
    }
    this.busy = "connect";
    this.note = "Opening Phantom…";
    this.render();
    try {
      await wallet.connect();
      this.note = "";
      await this.refresh();
    } catch (error) {
      this.note = isUserRejection(error)
        ? "Connection cancelled."
        : error instanceof Error
          ? error.message
          : "Couldn't connect Phantom.";
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async onUnlock() {
    if (this.busy) {
      this.note = "Hang on, the last unlock request is still in progress.";
      this.render();
      return;
    }
    this.busy = "unlock";
    this.note = "Requesting a signing nonce from the range…";
    this.render();
    try {
      await reportStoryComplete((status) => {
        this.note = status;
        this.render();
      });
      this.note = "Story unlock signed. The range is open for this wallet.";
      await this.refresh();
    } catch (error) {
      this.note = this.actionError(error, "Couldn't sign the unlock.");
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async onPractice() {
    if (this.busy) return;
    try {
    this.practice = true;
    this.round = null;
    this.outcome = null;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    this.practiceSeed = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    this.practiceForfeit = Math.floor(Math.random() * TARGET_COUNT);
    this.phase = "playing";
    this.hud = { remaining: 5, score: 0, last: "Practice card. Official scoring stays on the range.", skippedFifth: false };
    this.note = "";
    this.render();
    const stage = this.host?.querySelector<HTMLElement>(".gallery-stage");
    if (!stage) throw new Error("The range failed to open.");
    this.scene?.dispose();
    this.scene = new GalleryScene(stage, {
      onShot: (info) => {
        this.hud = {
          remaining: info.remaining,
          score: info.score,
          last: info.last,
          skippedFifth: info.skippedFifth,
        };
        this.renderHud();
      },
      onFinished: (shots) => {
        void this.finish(shots);
      },
    });
    this.scene.start(this.practiceSeed);
    } catch (error) {
      this.practice = false;
      this.phase = "lobby";
      this.note = error instanceof Error ? error.message : "The range failed to open.";
      this.render();
    }
  }

  private async onResume() {
    if (this.busy) return;
    const pending = loadPendingEntry(wallet.address);
    if (!pending) {
      this.note = "No saved paid entry for this wallet.";
      this.render();
      return;
    }
    this.busy = "enter";
    this.note = "Resuming your paid entry…";
    this.render();
    try {
      const round = await redeemPendingEntry(pending, (status) => {
        this.note = status;
        this.render();
      });
      this.busy = null;
      this.launch(round);
    } catch (error) {
      this.note = error instanceof Error ? error.message : "Couldn't resume the entry.";
      this.phase = "lobby";
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private launch(round: IssuedRound) {
    this.round = round;
    this.phase = "playing";
    this.hud = { remaining: 5, score: 0, last: "Five shots. Skip rugs, tourists, and the cursed one.", skippedFifth: false };
    this.note = "";
    this.render();
    const stage = this.host?.querySelector<HTMLElement>(".gallery-stage");
    if (!stage) throw new Error("The range failed to open.");
    this.scene?.dispose();
    this.scene = new GalleryScene(stage, {
      onShot: (info) => {
        this.hud = {
          remaining: info.remaining,
          score: info.score,
          last: info.last,
          skippedFifth: info.skippedFifth,
        };
        this.renderHud();
      },
      onFinished: (shots) => {
        void this.finish(shots);
      },
    });
    this.scene.start(round.seed);
  }

  private async onEnter() {
    if (this.busy) {
      this.note = "Hang on, a range request is already in progress.";
      this.render();
      return;
    }
    this.busy = "enter";
    const dry = this.status?.dryRun !== false;
    this.note = dry
      ? "Approve the free test-entry signature in Phantom. No SOL will be sent."
      : "Approve the 0.05 SOL transfer in Phantom…";
    this.render();
    try {
      const onStatus = (status: string) => {
        this.note = status;
        this.render();
      };
      const round = dry ? await enterFree(onStatus) : await payAndEnter(onStatus);
      this.round = round;
      this.phase = "playing";
      this.hud = { remaining: 5, score: 0, last: "Five shots. Skip rugs, tourists, and the cursed one.", skippedFifth: false };
      this.note = "";
      this.render();
      const stage = this.host?.querySelector<HTMLElement>(".gallery-stage");
      if (!stage) throw new Error("The range failed to open.");
      this.scene?.dispose();
      this.scene = new GalleryScene(stage, {
        onShot: (info) => {
          this.hud = {
            remaining: info.remaining,
            score: info.score,
            last: info.last,
            skippedFifth: info.skippedFifth,
          };
          this.renderHud();
        },
        onFinished: (shots) => {
          void this.finish(shots);
        },
      });
      this.scene.start(round.seed);
    } catch (error) {
      this.note = isUserRejection(error)
        ? "Payment cancelled. No entry was opened."
        : error instanceof Error
          ? error.message
          : "Couldn't enter the range.";
      this.phase = "lobby";
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async finish(shots: ShotInput[], abandon = false) {
    if (this.practice) {
      const elapsedSec = shots.at(-1)?.t ?? 0;
      const preview = abandon
        ? null
        : evaluateRound({
            seed: this.practiceSeed,
            forfeitIndex: this.practiceForfeit,
            shots,
            elapsedSec: elapsedSec + 0.5,
          });
      const scored = !abandon && preview && !("error" in preview);
      this.outcome = {
        result: scored
          ? {
              status: preview.status,
              score: preview.score,
              shots: preview.shots,
              cleanHits: preview.cleanHits,
              skippedFifth: preview.skippedFifth,
            }
          : { status: "forfeit", score: null, shots: [], cleanHits: 0, skippedFifth: false },
        reveal: { forfeitIndex: this.practiceForfeit, salt: "practice" },
        commitment: "practice",
        seed: this.practiceSeed,
        roundId: "practice",
        wallet: wallet.address ?? "",
        pot: { id: "practice", status: "open", potLamports: 0, rolloverLamports: 0, paidCount: 0, completedCount: 0, playersNeeded: 3, yours: null },
        settlement: null,
        commitmentMatches: true,
      };
      this.phase = "result";
      this.scene?.stop();
      this.note = abandon
        ? "Practice abandoned. No official card was filed."
        : "Practice only. This card was scored in your browser and was not submitted.";
      this.practice = false;
      this.render();
      return;
    }
    if (!this.round || this.busy === "submit") return;
    this.busy = "submit";
    this.note = "The range is scoring your card…";
    this.renderHud();
    try {
      const outcome = await submitGalleryRound({
        token: this.round.token,
        shots,
        abandon,
      });
      this.outcome = outcome;
      this.phase = "result";
      this.scene?.stop();
      this.note = outcome.commitmentMatches
        ? "Forfeit commitment verified."
        : "Warning: the revealed forfeit target did not match the commitment.";
    } catch (error) {
      this.note = error instanceof Error ? error.message : "Couldn't submit this round.";
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async onAbandon() {
    if (!this.round) {
      this.onClose();
      return;
    }
    if (this.phase === "playing" && !this.practice && !confirm("Leave now and you forfeit this entry. The 0.05 SOL stays in the pot."))
      return;
    if (this.phase === "playing" && this.practice && this.scene) {
      this.scene.stop();
      this.practice = false;
      this.phase = "lobby";
      this.note = "Practice closed.";
      this.render();
      return;
    }
    this.scene?.stop();
    await this.finish(this.scene?.currentShots() ?? [], true);
  }

  private renderHud() {
    const remaining = this.host?.querySelector("[data-hud-remaining]");
    const score = this.host?.querySelector("[data-hud-score]");
    const last = this.host?.querySelector("[data-hud-last]");
    if (remaining) remaining.textContent = String(this.hud.remaining);
    if (score) score.textContent = String(this.hud.score);
    if (last)
      last.textContent = this.hud.skippedFifth
        ? "Four clean hits. The fifth shot stands down."
        : this.hud.last;
  }

  private render() {
    const host = this.host;
    if (!host) return;
    const playing = this.phase === "playing";
    host.classList.toggle("is-playing", playing);
    host.closest(".overlay")?.classList.toggle("is-playing", playing);
    if (playing) {
      if (!host.querySelector(".gallery-stage")) {
        host.innerHTML = this.playHtml();
        this.wire();
      }
      this.renderHud();
      return;
    }
    this.scene?.dispose();
    this.scene = null;
    host.innerHTML = this.phase === "result" ? this.resultHtml() : this.lobbyHtml();
    this.wire();
  }

  private wire() {
    const host = this.host;
    if (!host) return;
    host.querySelector("#gallery-back")?.addEventListener("click", () => void this.onAbandon());
    host.querySelector("#gallery-connect")?.addEventListener("click", () => void this.onConnect());
    host.querySelector("#gallery-unlock")?.addEventListener("click", () => void this.onUnlock());
    host.querySelector("#gallery-enter")?.addEventListener("click", () => void this.onEnter());
    host.querySelector("#gallery-practice")?.addEventListener("click", () => void this.onPractice());
    host.querySelector("#gallery-resume")?.addEventListener("click", () => void this.onResume());
    host.querySelector("#gallery-again")?.addEventListener("click", () => {
      this.phase = "lobby";
      this.outcome = null;
      this.round = null;
      void this.refresh();
      this.render();
    });
  }

  private lobbyHtml(): string {
    const configured = galleryConfigured();
    const status = this.status;
    const address = wallet.address;
    const dry = status?.dryRun !== false;
    const skipStory = dry && !!status?.configured;
    const ready = configured && !!status?.configured && !!address && (skipStory || !!status.storyCompleted);
    return `
      <section class="gallery-lobby">
        <div class="edition">THE RANGE / 0.05 SOL</div>
        <h2>Shooting <em>Gallery</em></h2>
        <p class="gallery-legal">${esc(LEGAL_LINE)}</p>
        <p>Six moving targets, plus rugs, tourists, locked-LP cover and short-lived airdrops. Five shots. Lowest total wins. One live target hides a forfeit, committed in advance and revealed after you finish. Misses, cover and unfired shots cost 25, decoys cost 40, airdrops are 0. Four clean hits and the fifth shot stands down, so the floor is 20 — or 0 if you catch enough airdrops.</p>
        <ul class="gallery-rules">
          <li>Each round is server-seeded. Paths, timing, cover and decoys are new every entry, and the official card is scored on the server from your aim and timestamps. Watching one layout will not farm the next.</li>
          <li>Entry is a normal ${ENTRY_SOL} SOL transfer to the house wallet. No escrow, no contract.</li>
          <li>The pot settles after three finished rounds. Ties at the lowest score split the prize. If all three forfeit, the pot rolls forward. House cut is 5% when there is a winner.</li>
          <li>Scores stay blind until the pot settles.</li>
          <li>You have to finish the story once, then sign an unlock with this wallet. That report is spoofable; the range takes the signature on trust.</li>
        </ul>
        ${dry && status?.configured ? `<p class="gallery-warning">Payouts are in dry run. Entries are free and pay nothing out. No SOL is taken.</p>` : ""}
        ${skipStory ? `<p class="gallery-note" role="status">Test mode: story requirement skipped</p>` : ""}
        ${!configured ? `<p class="gallery-warning">The range goes live once the score service is deployed.</p>` : ""}
        ${this.potHtml(status?.pot, true)}
        <div class="gallery-actions">
          ${!address ? `<button type="button" id="gallery-connect" class="primary" ${this.busy ? "disabled" : ""}>${wallet.available ? "Connect Phantom ↗" : isLikelyMobile() ? "Open in Phantom ↗" : "Connect Phantom ↗"}</button>` : `<div class="gallery-wallet">${esc(shortenAddress(address))}</div>`}
          ${address && !skipStory && !status?.storyCompleted && this.canUnlock ? `<button type="button" id="gallery-unlock" class="secondary" ${this.busy ? "disabled" : ""}>${this.busy === "unlock" ? "Signing unlock…" : "Sign story unlock ↗"}</button>` : ""}
          ${address && !skipStory && !status?.storyCompleted && !this.canUnlock ? `<p class="gallery-warning" role="status">Beat the story as the Slopmeister in this session, then come back here and sign the unlock. Reloading the page resets that in-session flag; after you sign, the unlock is stored on the server.</p>` : ""}
          ${!dry && address && loadPendingEntry(address) ? `<button type="button" id="gallery-resume" class="primary" ${this.busy ? "disabled" : ""}>Resume my paid entry ↗</button>` : ""}
          <button type="button" id="gallery-enter" class="primary" ${ready && !this.busy ? "" : "disabled"}>${dry ? "Enter free (test mode)" : `Pay ${ENTRY_SOL} SOL and enter ↗`}</button>
          <button type="button" id="gallery-practice" class="secondary">Practice the range</button>
          <button type="button" id="gallery-back" class="secondary">Back to title</button>
        </div>
        ${this.note || this.loadError ? `<p class="gallery-warning gallery-status" role="alert">${esc(this.note || this.loadError || "")}</p>` : `<p class="gallery-note" role="status"></p>`}
        <a class="github-credit" href="https://github.com/water-bear86" target="_blank" rel="noopener" aria-label="water-bear86 on GitHub">
          <span>water-bear86</span>
        </a>
      </section>`;
  }

  private playHtml(): string {
    return `
      <section class="gallery-play">
        <div class="gallery-stage"></div>
        <div class="gallery-flash" aria-hidden="true"></div>
        <div class="gallery-crosshair" aria-hidden="true"></div>
        <div class="gallery-feedback" aria-live="polite"></div>
        <div class="gallery-hud">
          <span>Shots <b data-hud-remaining>${this.hud.remaining}</b></span>
          <span>Card <b data-hud-score>${this.hud.score}</b></span>
          <span data-hud-last>${esc(this.hud.last)}</span>
        </div>
        <p class="gallery-tip">On a phone, drag to aim and tap FIRE. On a computer, click to shoot. Shots land on the crosshair, then the sight kicks. Lowest official card wins — rugs and tourists cost 40, cover is a miss, airdrops are 0.</p>
        <button type="button" id="gallery-back" class="secondary gallery-forfeit">Forfeit and leave</button>
        <button type="button" id="gallery-fire" class="gallery-fire" aria-label="Fire">FIRE</button>
      </section>`;
  }

  private resultHtml(): string {
    const outcome = this.outcome;
    if (!outcome) return this.lobbyHtml();
    const practice = outcome.pot.id === "practice";
    const title =
      outcome.result.status === "forfeit"
        ? practice
          ? "Practice closed"
          : "Forfeit"
        : outcome.result.score === 20
          ? "A 20. The floor."
          : `You scored ${outcome.result.score}`;
    const summary = practice
      ? outcome.result.status === "forfeit"
        ? "Practice ended without a scored card."
        : `Practice total: <strong>${outcome.result.score}</strong>. This was scored in your browser and was not submitted.`
      : outcome.result.status === "forfeit"
        ? (outcome.result.shots as unknown[] | undefined)?.length
          ? "You hit the cursed target. You're out of this pot."
          : "You left the round, so this entry is forfeit. You're out of this pot."
        : `Official total: <strong>${outcome.result.score}</strong>. ${outcome.result.skippedFifth ? "The fifth shot was skipped." : ""}`;
    return `
      <section class="gallery-lobby">
        <div class="edition">${practice ? "PRACTICE CARD" : "OFFICIAL CARD"}</div>
        <h2>${esc(title)}</h2>
        <p>${summary}</p>
        <p class="gallery-note">${practice ? "Practice does not reveal or settle a pot." : `${outcome.commitmentMatches ? "The revealed forfeit target matches the pre-round commitment." : "The revealed forfeit target did not match the commitment."} Hidden target #${outcome.reveal.forfeitIndex + 1}.`}</p>
        ${practice ? "" : this.potHtml(outcome.pot, false)}
        ${practice ? "" : this.settlementHtml(outcome.pot)}
        <p class="gallery-note">${esc(this.note)}</p>
        <div class="gallery-actions">
          <button type="button" id="gallery-again" class="primary">Back to the range ↗</button>
          <button type="button" id="gallery-back" class="secondary">Title screen</button>
        </div>
        <a class="github-credit" href="https://github.com/water-bear86" target="_blank" rel="noopener"><span>water-bear86</span></a>
      </section>`;
  }

  private potHtml(pot: PublicPot | null | undefined, blind: boolean): string {
    if (!pot) return "";
    const sol = lamportsToSol(pot.potLamports);
    if (pot.status === "settled" && pot.entries) {
      const rows = pot.entries
        .map((entry) => {
          const you = wallet.address === entry.wallet;
          const score = entry.status === "forfeit" ? "forfeit" : String(entry.score);
          return `<li class="${you ? "is-you" : ""}"><span>${esc(shortenAddress(entry.wallet))}${you ? " · you" : ""}</span><span>${esc(score)}</span></li>`;
        })
        .join("");
      return `<div class="gallery-pot"><div class="eyebrow">${pot.mode === "test" ? "SETTLED TEST POT · NO REAL SOL" : `SETTLED POT · ${esc(sol)} SOL`}</div><ol>${rows}</ol></div>`;
    }
    const yours =
      pot.yours?.status === "scored"
        ? `Your official card: ${pot.yours.score}.`
        : pot.yours?.status === "forfeit"
          ? "You forfeited this pot."
          : pot.yours?.status === "playing"
            ? "Your round is open."
            : "";
    if (pot.mode === "test")
      return `<div class="gallery-pot"><div class="eyebrow">TEST POT · NO REAL SOL</div><p>${pot.paidCount}/${pot.playersNeeded} free test entries. Nothing is paid in or out while the range is in test mode.</p><p>${esc(yours)}${blind ? " Rival scores stay hidden until this pot settles." : ""}</p></div>`;
    return `<div class="gallery-pot"><div class="eyebrow">OPEN POT</div><p>${pot.paidCount}/${pot.playersNeeded} entered · ${esc(sol)} SOL in the pot${pot.rolloverLamports ? ` including ${lamportsToSol(pot.rolloverLamports)} rolled over` : ""}.</p><p>${esc(yours)}${blind ? " Rival scores stay hidden until this pot settles." : ""}</p></div>`;
  }

  private settlementHtml(pot: PublicPot): string {
    const settlement = pot.settlement;
    if (!settlement) return "";
    if (settlement.kind === "rollover")
      return pot.mode === "test"
        ? `<p>No winner. Test pots don't roll over, so the next one starts empty.</p>`
        : `<p>No winner. The pot rolls into the next one. No house cut this time.</p>`;
    const winners = settlement.winners.map((walletId) => esc(shortenAddress(walletId))).join(", ");
    const payouts = settlement.payouts
      .map((payout) => {
        const state =
          payout.status === "dry_run"
            ? "logged, not sent (dry run)"
            : payout.status === "sent"
              ? `sent ${payout.txSignature ? shortenAddress(payout.txSignature) : ""}`
              : payout.status === "sending"
                ? "sending…"
                : payout.status === "pending" || payout.status === "held" || payout.status === "failed"
                  ? "queued, paying out shortly"
                  : payout.status;
        return `${esc(shortenAddress(payout.wallet))} · ${lamportsToSol(payout.lamports)} SOL · ${esc(state)}`;
      })
      .join("<br>");
    return `<p>Lowest score ${settlement.winningScore} wins. ${winners}. House cut ${lamportsToSol(settlement.houseCutLamports)} SOL.</p><p>${payouts}</p>`;
  }
}
