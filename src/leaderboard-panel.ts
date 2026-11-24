import {
  LEADERBOARD_SIZE,
  shortenAddress,
  type LeaderboardEntry,
} from "./leaderboard-protocol.ts";
import {
  fetchLeaderboard,
  isUserRejection,
  leaderboardConfigured,
  submitScore,
} from "./leaderboard-client.ts";
import { wallet } from "./wallet.ts";

const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

const money = (value: number) =>
  "$" + Math.floor(value).toLocaleString("en-US");

export type BoardOptions = {
  score?: number;
  submit?: boolean;
};

export class LeaderboardPanel {
  private host: HTMLElement | null = null;
  private unbind: (() => void) | null = null;
  private options: BoardOptions = {};
  private entries: LeaderboardEntry[] | null = null;
  private loadError: string | null = null;
  private status = "";
  private busy: "connect" | "submit" | null = null;
  private posted = false;

  bind(host: HTMLElement, options: BoardOptions = {}) {
    this.unbind?.();
    this.host = host;
    const sameScore = this.options.score === options.score;
    this.options = options;
    if (!sameScore) {
      this.posted = false;
      this.status = "";
    }
    this.unbind = wallet.subscribe(() => this.render());
    void this.refresh();
    this.render();
  }

  unmount() {
    this.unbind?.();
    this.unbind = null;
    this.host = null;
  }

  private async refresh() {
    if (!leaderboardConfigured()) {
      this.entries = [];
      this.loadError = null;
      this.render();
      return;
    }
    try {
      this.entries = await fetchLeaderboard();
      this.loadError = null;
    } catch (error) {
      this.entries = this.entries ?? [];
      this.loadError =
        error instanceof Error ? error.message : "Couldn't reach the board.";
    }
    this.render();
  }

  private async onConnect() {
    if (this.busy) return;
    this.busy = "connect";
    this.status = "";
    this.render();
    try {
      await wallet.connect();
    } catch (error) {
      this.status = isUserRejection(error)
        ? "Connection cancelled."
        : error instanceof Error
          ? error.message
          : "Couldn't connect Phantom.";
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private async onDisconnect() {
    if (this.busy) return;
    await wallet.disconnect();
    this.status = "";
    this.render();
  }

  private async onSubmit() {
    if (this.busy || this.posted || this.options.score == null) return;
    this.busy = "submit";
    this.status = "Waiting for your signature. No SOL will be spent.";
    this.render();
    try {
      this.entries = await submitScore(this.options.score);
      this.posted = true;
      this.status = "Posted to the board.";
      this.loadError = null;
    } catch (error) {
      this.status = isUserRejection(error)
        ? "Signature cancelled. Nothing was posted."
        : error instanceof Error
          ? error.message
          : "Couldn't post this score.";
    } finally {
      this.busy = null;
      this.render();
    }
  }

  private render() {
    const host = this.host;
    if (!host) return;
    const configured = leaderboardConfigured();
    const address = wallet.address;
    const canSubmit =
      !!this.options.submit &&
      this.options.score != null &&
      this.options.score > 0 &&
      configured;
    host.className = "board-panel";
    host.setAttribute("aria-label", "Wallet leaderboard");
    host.innerHTML = `
      <div class="board-head">
        <span class="eyebrow">The board</span>
        <span class="board-live">${configured ? `Top ${LEADERBOARD_SIZE}` : "Not live"}</span>
      </div>
      ${this.renderList(address)}
      <div class="board-wallet">
        ${
          address
            ? `<span class="board-address" title="${esc(address)}">${esc(shortenAddress(address))}</span>
               <button type="button" id="wallet-disconnect" class="secondary">Disconnect</button>`
            : `<button type="button" id="wallet-connect" class="secondary"${this.busy ? " disabled" : ""}>${
                wallet.available || typeof window === "undefined"
                  ? this.busy === "connect"
                    ? "Connecting…"
                    : "Connect Phantom"
                  : "Install Phantom"
              }</button>`
        }
        ${
          canSubmit
            ? `<button type="button" id="score-submit" class="primary"${
                this.busy || this.posted || !address ? " disabled" : ""
              }>${
                this.posted
                  ? "Posted"
                  : this.busy === "submit"
                    ? "Signing…"
                    : "Sign & post score"
              }</button>`
            : ""
        }
      </div>
      <p class="board-note">${this.note(configured, canSubmit, address)}</p>
      <p class="board-status" id="board-status" role="status">${esc(this.status)}</p>
    `;
    host.querySelector("#wallet-connect")?.addEventListener("click", () => {
      void this.onConnect();
    });
    host.querySelector("#wallet-disconnect")?.addEventListener("click", () => {
      void this.onDisconnect();
    });
    host.querySelector("#score-submit")?.addEventListener("click", () => {
      void this.onSubmit();
    });
  }

  private renderList(address: string | null): string {
    if (!leaderboardConfigured()) {
      return `<p class="board-empty">The wallet board goes live once the score service is deployed.</p>`;
    }
    if (this.entries === null) {
      return `<p class="board-empty">Loading the board…</p>`;
    }
    if (this.loadError && this.entries.length === 0) {
      return `<p class="board-empty">${esc(this.loadError)}</p>`;
    }
    if (this.entries.length === 0) {
      return `<p class="board-empty">No scores yet. Finish a run and post the first one.</p>`;
    }
    const rows = this.entries
      .slice(0, LEADERBOARD_SIZE)
      .map((entry) => {
        const yours = !!address && entry.wallet === address;
        return `<li class="${yours ? "is-you" : ""}"><span class="board-rank">${entry.rank}</span><span class="board-wallet-cell">${esc(shortenAddress(entry.wallet))}${yours ? "<small>you</small>" : ""}</span><span class="board-score">${money(entry.score)}</span></li>`;
      })
      .join("");
    return `<ol class="board-list">${rows}</ol>${this.loadError ? `<p class="board-empty">${esc(this.loadError)}</p>` : ""}`;
  }

  private note(configured: boolean, canSubmit: boolean, address: string | null) {
    if (!configured)
      return "Play as usual without a wallet. Posting scores needs the board service.";
    if (canSubmit && !address)
      return "Connect Phantom, then sign a message to post this run. No SOL is spent.";
    if (canSubmit)
      return "Signing proves the score came from your wallet. No transaction, no SOL.";
    return "Connect Phantom to highlight your row. The game works without a wallet.";
  }
}
