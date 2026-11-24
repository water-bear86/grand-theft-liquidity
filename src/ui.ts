import { CHARACTERS, type CharacterId } from "./assets.ts";
import type { IntroFrame } from "./intro.ts";
import type { Game, Notice } from "./game.ts";
import { DRIVING_JOBS, type DrivingJobId } from "./driving-jobs.ts";
import { DEFAULT_MUSIC_VOLUME } from "./audio.ts";
import { TASKS, defenceThread } from "./content.ts";
import type { VoiceCaption } from "./voices.ts";
import {
  CROWN_AIM_LIMIT,
  CROWN_POWER,
  SCENE_COPY,
  type SceneReadout,
} from "./task-scenes.ts";
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
const noticeAuthor = (type: Notice["type"]) =>
  type === "pump" ? "@bagholder420" : "@community";
export interface Actions {
  start: () => void;
  replayIntro: () => void;
  takeControl: () => void;
  touchControlsEnabled: () => boolean;
  setTouchControls: (enabled: boolean) => void;
  mouseLockEnabled: () => boolean;
  mouseLockSupported: () => boolean;
  setMouseLock: (enabled: boolean) => void;
  toggleMouseLock: () => void;
  selectCharacter: (id: CharacterId) => void;
  characterAvailable: (id: CharacterId) => boolean;
  changeCharacter: () => void;
  choose: (index: number) => void;
  dispatch: (id: DrivingJobId) => void;
  dropJob: () => void;
  sceneBack: () => void;
  sceneAssist: () => void;
  sceneAim: (value: number) => void;
  resume: () => void;
  cashout: () => void;
  confirm: () => void;
  pause: () => void;
  mute: () => void;
  setMusicVolume: (volume: number) => void;
  launch: () => void;
  aim: (angle: number) => void;
  save: () => void;
}
export class UI {
  root: HTMLDivElement;
  overlay: HTMLElement;
  lastMode = "";
  lastTask = -1;
  actions: Actions;
  private selectedCharacter: CharacterId = "cabbage";
  private muted = false;
  private musicVolume = DEFAULT_MUSIC_VOLUME;
  private caption: VoiceCaption | null = null;
  private noticeCursor = 0;
  private inbox: Notice[] = [];
  constructor(root: HTMLElement, actions: Actions) {
    this.actions = actions;
    this.root = document.createElement("div");
    this.root.className = "ui";
    this.root.innerHTML = `
      <div id="hud" hidden>
        <section class="objective" aria-label="Route and buyer pressure">
          <div class="objective-top"><span class="eyebrow" id="area"></span><span id="route-count"></span></div>
          <strong id="objective-title"></strong>
          <div class="objective-readouts">
            <span id="objective-detail"></span>
            <span id="drive-waypoint" hidden><i aria-hidden="true">↑</i><span></span></span>
            <span class="ability"><kbd>Q</kbd> <span id="hype-hint"></span></span>
          </div>
          <div class="task-dots" id="task-dots" aria-hidden="true"></div>
          <div class="heat-strip" id="heat-strip">
            <span id="heat-label"></span><span id="strikes" role="img"></span>
            <div class="heat-track" aria-hidden="true"><i id="heat-fill"></i></div>
          </div>
        </section>
        <aside id="market" class="market" aria-label="Fictional coin market">
          <div class="market-head">
            <span class="coin-name" id="coin-name"></span>
            <span class="market-state" id="market-state"></span>
            <button class="icon-button" id="pause" aria-label="Pause game" title="Pause (Esc)"><span class="pause-icon" aria-hidden="true"></span></button>
          </div>
          <div class="market-readout">
            <div><strong id="bag" class="bag"></strong><small id="combo"></small></div>
            <svg class="chart" viewBox="0 0 200 65" role="img" aria-label="Fictional coin value"><path id="chart-area"></path><polyline id="chart-line" fill="none"></polyline></svg>
          </div>
          <div class="market-actions">
            <button class="cashout" id="cashout"><span>Cash out</span><kbd>C</kbd></button>
            <small id="cash-note" class="cash-note">At $1,000</small>
          </div>
          <div class="street-score"><span><i aria-hidden="true"></i><b id="street-viewers">0</b> watching</span><span id="street-loadout"></span></div>
        </aside>
        <div id="street-incident" class="street-incident" role="status" hidden></div>
        <i id="street-sight" class="street-sight" aria-hidden="true" hidden></i>
        <div class="street-feedback">
          <div class="toast" id="toast" role="status" hidden><span id="toast-author"></span><p id="toast-text"></p></div>
          <div class="onboarding" id="controls-hint">
            <span id="move-hint"><kbd>WASD</kbd> Move</span><span id="jump-hint"><kbd>Space</kbd> Jump</span><span id="look-hint">Drag to look</span>
          </div>
        </div>
        <button id="mouse-lock" class="mouse-lock" hidden></button>
        <div class="action-prompt" id="prompt" hidden></div>
      </div>
      <div id="launcher" class="launcher panel" hidden>
        <strong>YOU ARE THE AIRDROP</strong>
        <label>Aim <input id="launch-aim" type="range" min="-15" max="15" value="0" step="0.5" /></label>
        <div class="launch-power" role="meter" aria-label="Launch power" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i class="launch-band"></i><i id="launch-cursor"></i></div>
        <button id="launch-fire" class="primary">Space · launch yourself</button>
      </div>
      <div id="overlay" class="overlay"></div>
      <div id="npc-caption" class="npc-caption" role="status" aria-live="polite" aria-atomic="true" hidden>
        <span id="npc-speaker"></span><p id="npc-line"></p>
      </div>
    `;
    root.append(this.root);
    // Browsers may omit click for a second finger while the joystick is held.
    // Activate a released touch explicitly, and suppress its compatibility click.
    const touches = new Map<
      number,
      { button: HTMLButtonElement; x: number; y: number }
    >();
    let lastTouch: {
      button: HTMLButtonElement;
      time: number;
      pointerId: number;
    } | null = null;
    this.root.addEventListener("pointerdown", (event) => {
      if (
        event.pointerType !== "touch" ||
        event.isPrimary ||
        !(event.target instanceof Element)
      )
        return;
      const button = event.target.closest<HTMLButtonElement>("button");
      if (!button || button.disabled || button.closest(".mobile-controls"))
        return;
      touches.set(event.pointerId, {
        button,
        x: event.clientX,
        y: event.clientY,
      });
    });
    window.addEventListener("pointerup", (event) => {
      const touch = touches.get(event.pointerId);
      touches.delete(event.pointerId);
      if (
        !touch ||
        !touch.button.isConnected ||
        touch.button.disabled ||
        touch.button.closest("[inert]") ||
        Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 12 ||
        !touch.button.contains(
          document.elementFromPoint(event.clientX, event.clientY),
        )
      )
        return;
      lastTouch = {
        button: touch.button,
        time: performance.now(),
        pointerId: event.pointerId,
      };
      touch.button.click();
    });
    window.addEventListener("pointercancel", (event) =>
      touches.delete(event.pointerId),
    );
    window.addEventListener("blur", () => touches.clear());
    window.addEventListener("resize", () => touches.clear());
    this.root.addEventListener(
      "click",
      (event) => {
        if (
          event.detail > 0 &&
          lastTouch &&
          performance.now() - lastTouch.time < 600 &&
          (!(event instanceof PointerEvent) ||
            event.pointerId === lastTouch.pointerId) &&
          event.target instanceof Node &&
          lastTouch.button.contains(event.target)
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    // Wrapped captions and prompts need room at narrow widths and larger text sizes.
    const captionLayout = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const name =
          entry.target.id === "npc-caption"
            ? "--caption-height"
            : "--prompt-height";
        this.root.style.setProperty(
          name,
          `${(entry.target as HTMLElement).offsetHeight}px`,
        );
      }
    });
    captionLayout.observe(this.get("npc-caption"));
    captionLayout.observe(this.get("prompt"));
    this.overlay = this.get("overlay");
    this.get("pause").onclick = actions.pause;
    this.get("mouse-lock").onclick = actions.toggleMouseLock;
    this.get("launch-fire").onclick = actions.launch;
    this.get("launch-aim").addEventListener("input", (event) =>
      actions.aim((event.target as HTMLInputElement).valueAsNumber),
    );
    this.get("cashout").onclick = actions.cashout;
    this.overlay.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(
        this.overlay.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), summary",
        ),
      ).filter((control) => control.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && event.target === first && last) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && event.target === last && first) {
        event.preventDefault();
        first.focus();
      }
    });
  }
  get(id: string) {
    return this.root.querySelector<HTMLElement>("#" + id)!;
  }
  text(id: string, value: string) {
    const element = this.get(id);
    if (element.textContent !== value) element.textContent = value;
  }
  private controlCopy(copy: string) {
    if (!this.actions.touchControlsEnabled()) return copy;
    return copy
      .replace(/^E · /, "Action · ")
      .replace(/^Q · /, "Hype · ")
      .replace(/^Space · /, "Jump · ")
      .replace("R retries checkpoint", "Retry returns to checkpoint")
      .replace("E to aim", "tap Use cannon");
  }
  update(game: Game, distance: number, prompt: string, drive?: { bearing: number; distance: number; assigned: boolean }) {
    prompt = this.controlCopy(prompt);
    const hud = this.get("hud");
    hud.hidden =
      game.mode === "title" ||
      game.mode === "intro" ||
      game.mode === "intro-ready" ||
      (game.mode === "paused" &&
        (game.previousMode === "intro" ||
          game.previousMode === "intro-ready")) ||
      game.mode === "result" ||
      game.mode === "task-scene";
    hud.inert = game.mode !== "playing";
    const task = TASKS[game.completed];
    const driving = drive && !game.onRoadshow && game.drivingJobs.active;
    const waypoint = this.get("drive-waypoint");
    waypoint.hidden = !drive;
    if (drive) {
      waypoint.querySelector("i")!.style.transform = `rotate(${drive.bearing}rad)`;
      waypoint.querySelector("span")!.textContent = Math.round(drive.distance) + " m";
    }
    this.root.classList.toggle("radio-guidance", !!driving);
    this.text("area", driving ? "CAR RADIO" : task?.place.replace(/^\d+ \/ /, "") || "CLUB LIQUID");
    this.text("objective-title", driving ? DRIVING_JOBS[driving].name : task?.title || "You are the Slopmeister.");
    this.text(
      "objective-detail",
      game.onRoadshow
        ? drive?.assigned
          ? (this.actions.touchControlsEnabled() ? game.roadshow.instruction : game.roadshow.instruction.replace("handbrake", "hold Space"))
          : (this.actions.touchControlsEnabled() ? "Tap Drive beside the marked car" : "Press F beside the marked car")
        : drive && driving
        ? (drive.assigned ? game.drivingJobs.instruction : "Get back in your job car")
        : !task
        ? "Route complete"
        : game.bagworker.active && game.pendingChoice !== null
          ? this.controlCopy(game.bagworker.instruction)
          : game.pendingChoice !== null
            ? this.controlCopy(task.actionHint)
            : `${Math.round(distance)} m to next stop`,
    );
    this.text("route-count", driving ? `${game.drivingJobs.cleared.size}/3 jobs` : `${game.completed}/${TASKS.length}`);
    if (this.lastTask !== game.completed) {
      this.get("task-dots").innerHTML = TASKS.map(
        (_, i) =>
          `<i class="${i < game.completed ? "done" : i === game.completed ? "current" : ""}"></i>`,
      ).join("");
      this.lastTask = game.completed;
    }
    this.text("coin-name", "$" + game.coin.ticker);
    this.text("bag", money(game.bag));
    this.text(
      "market-state",
      game.pressurePaused
        ? "On the clock"
        : game.marketCooling
          ? "Cooling"
          : "Live",
    );
    this.get("market").classList.toggle("cooling", game.marketCooling);
    this.text(
      "combo",
      game.pickupTime > 0 ? `×${game.combo * 2} hype` : `×${game.combo} combo`,
    );
    this.text(
      "heat-label",
      game.pressurePaused
        ? "Bag protected during the job"
        : game.buyerCount === 0
          ? "Buyers watching"
          : game.hitGrace > 0
            ? "Buyers catching up"
            : game.heat < 70
              ? "Buyers in pursuit"
              : "Buyers extremely online",
    );
    this.get("heat-strip").classList.toggle(
      "pursuit",
      game.buyerCount > 0 && game.hitGrace <= 0,
    );
    this.get("heat-fill").style.width = game.heat + "%";
    this.text(
      "strikes",
      "●".repeat(game.strikes) + "○".repeat(3 - game.strikes),
    );
    this.get("strikes").setAttribute(
      "aria-label",
      `${game.strikes} of 3 strikes`,
    );
    const max = Math.max(700, ...game.chart),
      min = Math.min(0, ...game.chart);
    const points = game.chart
      .map(
        (v, i) =>
          `${((i / (game.chart.length - 1)) * 200).toFixed(1)},${(60 - ((v - min) / (max - min)) * 54).toFixed(1)}`,
      )
      .join(" ");
    this.get("chart-line").setAttribute("points", points);
    this.get("chart-area").setAttribute(
      "d",
      `M0,65 L${points.replaceAll(" ", " L")} L200,65 Z`,
    );
    this.get("chart-line").classList.toggle("dumping", game.marketCooling);
    const promptNode = this.get("prompt");
    promptNode.hidden = !prompt;
    if (promptNode.dataset.copy !== prompt) {
      promptNode.dataset.copy = prompt;
      const [binding, ...rest] = prompt.split(" · ");
      promptNode.innerHTML = rest.length
        ? `<kbd>${esc(binding)}</kbd><span>${esc(rest.join(" · "))}</span>`
        : esc(prompt);
    }
    if (
      game.mode === "playing" &&
      (this.lastMode === "title" || this.lastMode === "result")
    ) {
      this.inbox = [];
      this.noticeCursor = 0;
    }
    if (game.noticeId !== this.noticeCursor) {
      this.inbox = [
        ...game.notices.filter((notice) => notice.id > this.noticeCursor),
        ...this.inbox,
      ].slice(0, 32);
      this.noticeCursor = game.noticeId;
    }
    const notice = game.notices[0];
    const toast = this.get("toast");
    toast.hidden = game.mode !== "playing" || !notice || notice.age >= 4.1 ||
      (game.activeTime - game.incidentAt < 2.7 && notice.text.startsWith("+250 watching"));
    if (!toast.hidden && notice) {
      toast.dataset.tone = notice.type;
      this.text("toast-author", noticeAuthor(notice.type));
      this.text("toast-text", notice.text);
    }
    this.get("controls-hint").hidden =
      game.mode !== "playing" ||
      game.activeTime >= 5.5 ||
      game.completed !== 0 ||
      !!prompt;
    (this.get("cashout") as HTMLButtonElement).disabled =
      game.bag < 1000 || game.mode !== "playing";
    this.get("cash-note").hidden = game.bag >= 1000;
    this.text(
      "hype-hint",
      game.cooldown > 0 ? `Hype ${Math.ceil(game.cooldown)}s` : "Hype",
    );
    if (this.lastMode !== game.mode) {
      this.lastMode = game.mode;
      this.renderOverlay(game);
    }
  }
  updateLauncher(game: Game) {
    const open = game.mode === "playing" && game.bagworker.phase === "aiming";
    const panel = this.get("launcher");
    if (panel.hidden === open) {
      panel.hidden = !open;
      if (open)
        (this.get("launch-aim") as HTMLInputElement).value = String(
          game.bagworker.aim,
        );
    }
    if (!open) return;
    this.text(
      "launch-fire",
      this.actions.touchControlsEnabled()
        ? "Launch yourself"
        : "Space · launch yourself",
    );
    this.get("launch-cursor").style.left = `${game.bagworker.power * 100}%`;
    panel
      .querySelector("[role=meter]")!
      .setAttribute(
        "aria-valuenow",
        String(Math.round(game.bagworker.power * 100)),
      );
  }
  updateStreet(game: Game, weapon: string, speed: number | null, sliding = false) {
    this.root.classList.toggle("in-car", speed !== null);
    this.text("street-viewers", game.viewers.toLocaleString("en-US"));
    this.text("street-loadout", speed === null ? weapon : `${sliding ? "SKID · " : ""}${Math.round(Math.abs(speed) * 3.6)} km/h`);
    const feedback = this.get("street-incident");
    feedback.hidden = game.mode !== "playing" || game.activeTime - game.incidentAt > 2.7;
    if (!feedback.hidden)
      this.text("street-incident", `+250 watching   ·   −$${game.lastFine.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  }
  button(id: string, fn: () => void) {
    this.overlay
      .querySelector<HTMLElement>("#" + id)
      ?.addEventListener("click", fn);
  }
  updateScene(state: SceneReadout) {
    if (this.lastMode !== "task-scene") return;
    this.text("scene-status", state.status);
    this.text("scene-action", state.action);
    (this.get("scene-action") as HTMLButtonElement).disabled = state.disabled;
    (this.get("scene-back") as HTMLButtonElement).disabled = state.done;
    const power = this.overlay.querySelector<HTMLElement>("#scene-power");
    const aim = this.overlay.querySelector<HTMLInputElement>("#scene-aim");
    if (!power || !aim) return;
    const percent = Math.round(state.power * 100);
    if (power.getAttribute("aria-valuenow") !== String(percent)) {
      power.setAttribute("aria-valuenow", String(percent));
      this.get("scene-power-cursor").style.left = percent + "%";
    }
    aim.disabled = state.disabled;
    const sliderValue = Math.round(state.aim * 20) / 20;
    if (aim.valueAsNumber !== sliderValue) aim.valueAsNumber = sliderValue;
  }
  renderOverlay(game: Game) {
    const mode = game.mode;
    this.overlay.hidden = mode === "playing";
    this.overlay.className = "overlay " + mode;
    if (mode === "playing") {
      this.overlay.replaceChildren();
      return;
    }
    if (mode === "title") {
      this.overlay.innerHTML = `
        <section class="title-screen">
          <div class="edition"><span class="title-coin" aria-hidden="true">$</span> Sunset Strip</div>
          <h1><span>Grand Theft</span><em>Liquidity</em></h1>
          <p class="tagline">Pump your coin. Ruin your dignity.</p>
          <p class="title-description">${TASKS.length} bad decisions to become the Slopmeister.</p>
          <fieldset class="character-picker"><legend>Choose your founder</legend>${CHARACTERS.map((c) => `<label class="character-option"><input type="radio" name="character" value="${c.id}" ${this.selectedCharacter === c.id ? "checked" : ""}><span><strong>${c.name}</strong><small>${this.actions.characterAvailable(c.id) ? c.line : "Model unavailable · stand-in"}</small></span></label>`).join("")}</fieldset>
          <button id="start" class="primary">Enter the trenches <span aria-hidden="true">↗</span></button>
          <button id="replay-intro" class="intro-replay">Watch opening ↗</button>
          ${this.controlSettings()}
          <div class="start-controls">${this.actions.touchControlsEnabled() ? "Joystick + swipe to look" : "Keyboard + mouse"} · Fictional coins</div>
          <a class="github-credit" href="https://github.com/water-bear86" target="_blank" rel="noopener" aria-label="water-bear86 on GitHub">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/></svg>
            <span>water-bear86</span>
          </a>
        </section>
      `;
      this.button("start", this.actions.start);
      this.button("replay-intro", this.actions.replayIntro);
      this.overlay
        .querySelectorAll<HTMLInputElement>("[name=character]")
        .forEach((input) => {
          input.onchange = () => {
            const character = CHARACTERS.find((c) => c.id === input.value);
            if (character) {
              this.selectedCharacter = character.id;
              this.actions.selectCharacter(character.id);
            }
          };
        });
    } else if (mode === "intro" || mode === "intro-ready") {
      this.overlay.innerHTML = `
        <div class="film-edge film-top" aria-hidden="true"></div>
        <div class="film-meta"><span>GTL / Sunset Strip</span><span id="intro-count"></span></div>
        <section class="intro-card" id="intro-card" aria-live="polite" aria-atomic="true"></section>
        <div class="intro-actions">
          ${mode === "intro-ready" ? `<button id="take-control" class="primary">Take control <span aria-hidden="true">↗</span></button>${this.controlSettings()}` : '<button id="intro-skip" class="secondary">Skip opening ↗</button>'}
          <button id="sound" class="intro-sound" aria-pressed="${!this.muted}">${this.muted ? "Sound off" : "Sound on"}</button>
        </div>
        <div class="film-edge film-bottom" aria-hidden="true"><div class="intro-track"><i id="intro-progress"></i></div></div>`;
      this.button("intro-skip", this.actions.takeControl);
      this.button("take-control", this.actions.takeControl);
      this.button("sound", this.actions.mute);
    } else if (mode === "car-radio") {
      const jobs = game.drivingJobs;
      const ids = Object.keys(DRIVING_JOBS) as DrivingJobId[];
      this.overlay.innerHTML = `
        <section class="decision panel radio-panel" role="dialog" aria-modal="true" aria-labelledby="radio-title">
          <div class="eyebrow">Sunset Strip FM · Dispatch</div>
          <h2 id="radio-title">Car radio</h2>
          ${jobs.active
            ? `<p><strong>${DRIVING_JOBS[jobs.active].name}</strong><br>${esc(jobs.instruction)}</p>
               <button id="resume-radio" class="primary">Back to the job</button>
               <button id="drop-job" class="secondary">Drop this job</button>`
            : `<div class="choices">${ids.map(id => {
                const job = DRIVING_JOBS[id], done = jobs.cleared.has(id);
                return `<button id="radio-${id}" ${done ? "disabled" : ""}>
                  <span><strong>${job.name}</strong><small>${job.brief}</small></span>
                  <b class="radio-pay">${done ? "Paid ✓" : job.pay}</b></button>`;
              }).join("")}</div>
              <button id="resume-radio" class="secondary">Back to driving</button>`}
        </section>`;
      for (const id of ids) this.button("radio-" + id, () => this.actions.dispatch(id));
      this.button("resume-radio", this.actions.resume);
      this.button("drop-job", this.actions.dropJob);
    } else if (mode === "choice") {
      const task = TASKS[game.completed];
      this.overlay.innerHTML = `
        <section class="decision panel" role="dialog" aria-modal="true" aria-labelledby="decision-title">
          <div class="eyebrow">${esc(task.place)}</div>
          <h2 id="decision-title">${esc(task.title)}</h2>
          <p>${esc(task.intro)}</p>
          <div class="choices">${task.choices
            .map(
              (choice, i) => `
            <button data-choice="${i}">
              <span><strong>${esc(choice.label)}</strong><small>${esc(choice.detail)}</small></span>
              <span class="choice-arrow" aria-hidden="true">↗</span>
            </button>`,
            )
            .join("")}
          </div>
        </section>
      `;
      this.overlay
        .querySelectorAll<HTMLButtonElement>("[data-choice]")
        .forEach(
          (button) =>
            (button.onclick = () =>
              this.actions.choose(Number(button.dataset.choice))),
        );
    } else if (mode === "task-scene" && game.taskScene) {
      const copy = SCENE_COPY[game.taskScene];
      const aiming =
        game.taskScene === "crown"
          ? `<div class="scene-throw-tools"><div class="scene-power-wrap"><span>Throw power</span><div id="scene-power" class="scene-power" role="meter" aria-label="Throw power" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i class="scene-power-band" style="left:${CROWN_POWER.low * 100}%;width:${(CROWN_POWER.high - CROWN_POWER.low) * 100}%"></i><i id="scene-power-cursor"></i></div></div><label class="scene-aim">Aim <input id="scene-aim" type="range" min="${-CROWN_AIM_LIMIT}" max="${CROWN_AIM_LIMIT}" step="0.05" value="0" /></label></div>`
          : "";
      this.overlay.innerHTML = `
        <section class="task-scene-layout" data-scene="${game.taskScene}" role="dialog" aria-modal="true" aria-labelledby="scene-title">
          <header class="task-scene-header">
            <h2 id="scene-title">${copy.title}</h2><p>${copy.instructions}</p>
          </header>
          <footer class="task-scene-footer">
            ${aiming}
            <p id="scene-status" role="status"></p>
            <div class="task-scene-buttons">
              <button id="scene-action" class="primary">${copy.action}</button>
              <button id="scene-back" class="secondary">Back to choices</button>
            </div>
          </footer>
        </section>
      `;
      this.button("scene-action", this.actions.sceneAssist);
      this.button("scene-back", this.actions.sceneBack);
      this.overlay
        .querySelector<HTMLInputElement>("#scene-aim")
        ?.addEventListener("input", (event) =>
          this.actions.sceneAim(
            (event.currentTarget as HTMLInputElement).valueAsNumber,
          ),
        );
    } else if (mode === "paused") {
      this.overlay.innerHTML = `
        <section class="panel pause-panel" role="dialog" aria-modal="true" aria-labelledby="pause-title">
          <div class="eyebrow">Run paused</div>
          <h2 id="pause-title">Touch grass.</h2>
          <button id="resume" class="primary">Resume run <span aria-hidden="true">↗</span></button>
          <div class="pause-settings">
            <h3>Controls</h3>
            ${this.controlSettings()}
            <button id="sound" class="secondary sound-toggle" aria-pressed="${!this.muted}">${this.muted ? "Sound off" : "Sound on"}</button>
            <label class="music-volume" for="music-volume">
              <span>Music volume</span>
              <input id="music-volume" type="range" min="0" max="100" value="${Math.round(this.musicVolume * 100)}">
              <span id="music-value" aria-hidden="true">${Math.round(this.musicVolume * 100)}%</span>
            </label>
            <dl class="control-list">
              ${
                this.actions.touchControlsEnabled()
                  ? `
              <div><dt>Move</dt><dd>Left joystick · push farther to run</dd></div>
              <div><dt>Look</dt><dd>Swipe the playfield</dd></div>
              <div><dt>Jump / interact</dt><dd>Right-hand buttons</dd></div>
              <div><dt>Hype / retry</dt><dd>Hype button · Retry on rooftops</dd></div>
              <div><dt>Drive</dt><dd>Tap Drive near a car. Steer and accelerate with the stick, hold Handbrake to slide.</dd></div>
              <div><dt>Guns</dt><dd>Tap the gun name to switch. Tap Fire to shoot.</dd></div>
              <div><dt>Pause / cash out</dt><dd>Top-right buttons</dd></div>
              `
                  : `<div><dt>Move</dt><dd><kbd>WASD</kbd> <kbd>Arrows</kbd></dd></div>
              <div><dt>Look</dt><dd>Mouse / drag · <kbd>L</kbd> lock</dd></div>
              <div><dt>Release / pause</dt><dd><kbd>Esc</kbd></dd></div>
              <div><dt>Jump</dt><dd><kbd>Space</kbd></dd></div>
              <div><dt>Interact</dt><dd><kbd>E</kbd></dd></div>
              <div><dt>Hype blast</dt><dd><kbd>Q</kbd></dd></div>
              <div><dt>Enter / leave car</dt><dd><kbd>F</kbd> near a car or once stopped</dd></div>
              <div><dt>Drive</dt><dd><kbd>WASD</kbd> or arrows · <kbd>Space</kbd> handbrake</dd></div>
              <div><dt>Fire / switch gun</dt><dd><kbd>X</kbd> or locked click · <kbd>G</kbd> switches</dd></div>
              <div><dt>Cash out</dt><dd><kbd>C</kbd></dd></div>`
              }
            </dl>
          </div>
          <details class="inbox">
            <summary>Trenches feed</summary>
            <div id="feed">${
              this.inbox.length
                ? this.inbox
                    .map(
                      (notice) => `
                <article class="notification ${notice.type}">
                  <span>${noticeAuthor(notice.type)}</span><p>${esc(notice.text)}</p>
                </article>`,
                    )
                    .join("")
                : "<p>The group chat is quiet.</p>"
            }
            </div>
          </details>
        </section>
      `;
      this.button("resume", this.actions.resume);
      this.button("sound", this.actions.mute);
      this.overlay
        .querySelector<HTMLInputElement>("#music-volume")
        ?.addEventListener("input", (event) => {
          const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
          this.musicVolume = value / 100;
          this.text("music-value", value + "%");
          this.actions.setMusicVolume(this.musicVolume);
        });
    } else if (mode === "cashout") {
      this.overlay.innerHTML = `<section class="panel pause-panel" role="dialog" aria-modal="true" aria-label="Confirm cash out"><div class="eyebrow">PERSONAL LIQUIDITY EVENT</div><h2>Leave with<br>${money(game.bag)}?</h2><p>${game.routeComplete ? "You earned the title. Now write the apology." : `${game.completed}/${TASKS.length} tasks done. The Slopmeister crown stays here.`}</p>${game.kills ? `<p class="incident-receipt">${game.viewers.toLocaleString("en-US")} watching · −$${game.incidentLoss.toLocaleString("en-US")} in incident costs, already deducted.</p>` : ""}<button id="confirm" class="primary">SELL. EXPLAIN LATER. ↗</button><button id="resume" class="secondary">Keep risking it</button></section>`;
      this.button("confirm", this.actions.confirm);
      this.button("resume", this.actions.resume);
    } else if (mode === "victory") {
      this.overlay.innerHTML = `<section class="panel victory-panel" role="dialog" aria-modal="true" aria-label="Slopmeister achieved"><div class="eyebrow">EVERY BAD DECISION. A PERFECT RECORD.</div><h2>All hail the<br><em>Slopmeister.</em></h2><p>${money(game.bag)} of completely fictional conviction.<br>Absolutely no dignity remaining.</p><button id="bank" class="primary">CASH OUT & ADDRESS THE ALLEGATIONS ↗</button><button id="resume" class="secondary">Keep risking it</button></section>`;
      this.button("bank", this.actions.cashout);
      this.button("resume", this.actions.resume);
    } else if (mode === "result") {
      const won = game.ending === "slopmeister",
        failed = game.ending === "bust" || game.ending === "caught";
      const headline = won
        ? "THE SLOPMEISTER."
        : game.ending === "early"
          ? "EXIT LIQUIDITY."
          : game.ending === "caught"
            ? "THEY FOUND YOU."
            : "TERMINAL BOREDOM.";
      const thread = failed
        ? []
        : defenceThread({
            coin: game.coin.name,
            banked: game.banked,
            completed: game.completed,
            slopmeister: won,
            choiceLabels: game.choices.map(
              (choice, i) => TASKS[i].choices[choice].label,
            ),
          });
      this.overlay.innerHTML = `<div class="result-layout"><section class="result-card"><div class="edition">GRAND THEFT LIQUIDITY / RUN RECEIPT</div><h2>${headline}</h2><div class="result-amount">${money(game.banked)}</div><div class="result-caption">${failed ? "UNBANKED GAINS LOST" : "BANKED. SOMEHOW."}</div><div class="result-stats"><span><b>${game.completed}/${TASKS.length}</b> BAD DECISIONS</span><span><b>${money(game.peak)}</b> PEAK DELUSION</span><span><b>${game.viewers.toLocaleString("en-US")}</b> VIEWERS</span><span><b>−$${game.incidentLoss.toLocaleString("en-US")}</b> INCIDENT COSTS · ${game.kills} FATAL</span></div><p class="receipt-quote">${won ? "“Dignity is temporary. This screenshot is forever.”" : failed ? "“We are simply entering a period of strategic reflection.”" : "“This was a personal liquidity event.”"}</p><div class="result-ticker">$${esc(game.coin.ticker)} · ${esc(game.coin.name)}</div><div class="result-actions"><button id="retry" class="primary">ONE MORE BAD IDEA ↗</button><button id="save" class="secondary">Save result card</button><button id="change-character" class="secondary">Change character</button></div><div class="fine-print">Fictional money · Session best ${money(game.best)}</div></section>${thread.length ? `<section class="fake-x"><header><span class="fake-x-mark">𝕏</span><div><strong>Official founder statement</strong><small>A completely fictional social feed</small></div></header>${thread.map((post, i) => `<article><div class="post-author"><span class="avatar">YOU</span><div><strong>You, the founder <span>✓</span></strong><small>@definitely_still_building · ${i + 1}/${thread.length}</small></div></div><p>${esc(post)}</p><footer>♡ ${284 - i * 31} &nbsp; ↻ ${92 + i * 13} &nbsp; ◇ community notes pending</footer></article>`).join("")}</section>` : '<section class="failure-note"><span class="eyebrow">COMMUNITY UPDATE</span><h3>“Is the founder<br>still building?”</h3><p>Your unbanked gains are gone. Your terrible ideas are reusable.</p></section>'}</div>`;
      this.button("retry", this.actions.start);
      this.button("change-character", this.actions.changeCharacter);
      this.button("save", this.actions.save);
    }
    this.overlay
      .querySelectorAll<HTMLInputElement>("[data-mouse-lock]")
      .forEach((control) => {
        control.onchange = () => this.actions.setMouseLock(control.checked);
      });
    this.overlay
      .querySelector<HTMLInputElement>("[data-touch-controls]")
      ?.addEventListener("change", (event) => {
        this.actions.setTouchControls(
          (event.currentTarget as HTMLInputElement).checked,
        );
        this.renderOverlay(game);
        this.overlay
          .querySelector<HTMLInputElement>("[data-touch-controls]")
          ?.focus({ preventScroll: true });
      });
    this.overlay
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }
  private controlSettings() {
    return `<label class="mouse-lock-setting touch-setting"><input type="checkbox" data-touch-controls ${this.actions.touchControlsEnabled() ? "checked" : ""}><span>Touch controls<small>Joystick, jump and action buttons · swipe to look</small></span></label>${this.mouseLockSetting()}`;
  }
  private mouseLockSetting() {
    const supported = this.actions.mouseLockSupported();
    return `<label class="mouse-lock-setting" data-mouse-setting><input type="checkbox" data-mouse-lock ${this.actions.mouseLockEnabled() ? "checked" : ""} ${supported ? "" : "disabled"}><span>${supported ? "Lock mouse during play" : "Click and drag to look"}<small>${supported ? "Esc releases the mouse and pauses" : "Mouse lock is unavailable in this browser"}</small></span></label>`;
  }
  updateMouseLock(
    enabled: boolean,
    locked: boolean,
    supported: boolean,
    allowed: boolean,
  ) {
    const button = this.get("mouse-lock");
    const touch = this.actions.touchControlsEnabled();
    const hint = this.get("controls-hint");
    if (hint.dataset.touch !== String(touch)) {
      hint.dataset.touch = String(touch);
      this.get("move-hint").innerHTML = touch
        ? "Joystick to move"
        : "<kbd>WASD</kbd> Move";
      this.get("jump-hint").innerHTML = touch
        ? "Tap Jump"
        : "<kbd>Space</kbd> Jump";
    }
    button.hidden = touch || !allowed || !supported;
    button.setAttribute("aria-pressed", String(locked));
    this.text("mouse-lock", locked ? "L · Mouse locked" : "L · Lock mouse");
    this.text(
      "look-hint",
      touch
        ? "Swipe to look"
        : locked
          ? "Mouse to look · Esc releases"
          : enabled
            ? "Click to lock mouse"
            : "Drag to look",
    );
    this.overlay
      .querySelectorAll<HTMLInputElement>("[data-mouse-lock]")
      .forEach((control) => {
        control.checked = enabled;
        control.disabled = !supported;
      });
  }
  updateIntro(frame: IntroFrame) {
    const card = this.overlay.querySelector<HTMLElement>("#intro-card");
    if (!card) return;
    if (card.dataset.shot !== frame.shot.id) {
      card.dataset.shot = frame.shot.id;
      card.innerHTML = `<div class="intro-copy"><span class="eyebrow">${esc(frame.shot.eyebrow)}</span><h1>${esc(frame.shot.title)}</h1><p>${esc(frame.shot.line)}</p></div>`;
    }
    this.text(
      "intro-count",
      `${String(frame.index + 1).padStart(2, "0")} / OPENING`,
    );
    this.get("intro-progress").style.transform = `scaleX(${frame.progress})`;
  }
  flash() {
    const node = this.get("market");
    node.classList.remove("pumped");
    void node.offsetWidth;
    node.classList.add("pumped");
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    const button = this.overlay.querySelector<HTMLButtonElement>("#sound");
    if (!button) return;
    button.textContent = muted ? "Sound off" : "Sound on";
    button.setAttribute("aria-pressed", String(!muted));
  }
  setCaption(line: VoiceCaption | null) {
    if (this.caption === line) return;
    this.caption = line;
    this.get("npc-caption").hidden = line === null;
    this.text("npc-speaker", line?.speaker ?? "");
    this.text("npc-line", line?.text ?? "");
  }
}
