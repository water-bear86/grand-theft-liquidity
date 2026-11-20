import type { Input } from "./player.ts";

export interface TouchContext {
  action: string | null;
  retry: boolean;
  cooldown: number;
  driving: boolean;
  radioReady: boolean;
  nearCar: boolean;
  street: boolean;
  weapon: string;
}

/** Touch gestures feed the same input queue as keyboard actions. */
export class MobileControls {
  private root: HTMLDivElement;
  private stick: HTMLDivElement;
  private nub: HTMLElement;
  private action: HTMLButtonElement;
  private hype: HTMLButtonElement;
  private retry: HTMLButtonElement;
  private fire: HTMLButtonElement;
  private radio: HTMLButtonElement;
  private weapon: HTMLButtonElement;
  private jump: HTMLButtonElement;
  private driving = false;
  private pointer: number | null = null;
  private center = { x: 0, y: 0, radius: 1 };
  private held = new Map<number, HTMLButtonElement>();
  private overridden = false;
  private active = false;

  constructor(
    private ui: HTMLElement,
    private input: Input,
    private canPlay: () => boolean,
  ) {
    this.root = document.createElement("div");
    this.root.className = "mobile-controls";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div id="touch-stick" class="touch-stick" aria-label="Movement joystick. Drag to move; farther runs faster.">
        <span class="stick-nub" aria-hidden="true"></span><span class="stick-label" aria-hidden="true">Move</span>
      </div>
      <div class="touch-actions" role="group" aria-label="Game actions">
        <button id="touch-weapon" class="touch-button touch-weapon" aria-label="Switch gun">Pistol</button>
        <button id="touch-fire" class="touch-button touch-fire">Fire</button>
        <button id="touch-retry" class="touch-button touch-retry" hidden>Retry</button>
        <button id="touch-radio" class="touch-button touch-radio" hidden>Radio</button>
        <button id="touch-action" class="touch-button touch-action" disabled>Action</button>
        <button id="touch-hype" class="touch-button touch-hype">Hype</button>
        <button id="touch-jump" class="touch-button touch-jump">Jump <span aria-hidden="true">↑</span></button>
      </div>`;
    ui.append(this.root);
    this.stick = this.root.querySelector<HTMLDivElement>("#touch-stick")!;
    this.nub = this.stick.querySelector<HTMLElement>(".stick-nub")!;
    this.action = this.root.querySelector<HTMLButtonElement>("#touch-action")!;
    this.hype = this.root.querySelector<HTMLButtonElement>("#touch-hype")!;
    this.retry = this.root.querySelector<HTMLButtonElement>("#touch-retry")!;
    this.fire = this.root.querySelector<HTMLButtonElement>("#touch-fire")!;
    this.radio = this.root.querySelector<HTMLButtonElement>("#touch-radio")!;
    this.weapon = this.root.querySelector<HTMLButtonElement>("#touch-weapon")!;
    this.jump = this.root.querySelector<HTMLButtonElement>("#touch-jump")!;
    input.onClear = () => this.reset();
    const coarse = matchMedia("(pointer: coarse)");
    this.setEnabled(coarse.matches, false);
    coarse.addEventListener("change", () => {
      if (!this.overridden) this.setEnabled(coarse.matches, false);
    });
    this.stick.addEventListener("pointerdown", (event) => {
      if (!this.available || this.pointer !== null || event.button !== 0)
        return;
      event.preventDefault();
      const box = this.stick.getBoundingClientRect();
      this.center = {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        radius: box.width * 0.32,
      };
      this.pointer = event.pointerId;
      this.stick.setPointerCapture(event.pointerId);
      this.move(event);
    });
    this.stick.addEventListener("pointermove", (event) => this.move(event));
    const release = (event: PointerEvent) => {
      if (event.pointerId === this.pointer) this.resetStick();
    };
    this.stick.addEventListener("pointerup", release);
    this.stick.addEventListener("pointercancel", release);
    this.stick.addEventListener("lostpointercapture", release);
    for (const [id, code] of [
      ["touch-jump", "Space"],
      ["touch-action", "KeyE"],
      ["touch-hype", "KeyQ"],
      ["touch-retry", "KeyR"],
      ["touch-radio", "KeyE"],
      ["touch-fire", "KeyX"],
      ["touch-weapon", "KeyG"],
    ]) {
      const button = this.root.querySelector<HTMLButtonElement>(`#${id}`)!;
      button.addEventListener("pointerdown", (event) => {
        if (!this.available || button.disabled || event.button !== 0) return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.held.set(event.pointerId, button);
        button.classList.add("held");
        this.input.pressed.add(button.dataset.code ?? code);
        if (button === this.jump && this.driving) this.input.touchBrake = true;
      });
      const up = (event: PointerEvent) => {
        this.held.delete(event.pointerId);
        if (![...this.held.values()].includes(button)) {
          button.classList.remove("held");
          if (button === this.jump) this.input.touchBrake = false;
        }
      };
      button.addEventListener("pointerup", up);
      button.addEventListener("pointercancel", up);
      button.addEventListener("lostpointercapture", up);
      // Keyboard/assistive activation has no pointerdown. Pointer clicks must not queue twice.
      button.addEventListener("click", (event) => {
        if (event.detail === 0 && this.available && !button.disabled)
          this.input.pressed.add(button.dataset.code ?? code);
      });
    }
  }
  get enabled() {
    return this.input.touchControls;
  }
  private get available() {
    return this.active && this.enabled && this.canPlay();
  }
  setEnabled(enabled: boolean, manual = true) {
    if (manual) this.overridden = true;
    this.input.touchControls = enabled;
    this.input.clear();
    if (enabled) this.input.releaseLock();
    this.ui.classList.toggle("touch-mode", enabled);
  }
  private move(event: PointerEvent) {
    if (event.pointerId !== this.pointer || !this.available) return;
    if (event.pointerType === "mouse" && !(event.buttons & 1)) {
      this.resetStick();
      return;
    }
    const x = (event.clientX - this.center.x) / this.center.radius;
    const z = (event.clientY - this.center.y) / this.center.radius;
    const length = Math.hypot(x, z);
    const clamped = Math.min(1, length);
    // A small dead zone prevents drift while resting a thumb on the center.
    const strength = Math.max(0, (clamped - 0.12) / 0.88);
    this.input.moveX = length ? (x / length) * strength : 0;
    this.input.moveZ = length ? (z / length) * strength : 0;
    this.nub.style.transform = `translate(${length ? (x / length) * clamped * this.center.radius : 0}px, ${length ? (z / length) * clamped * this.center.radius : 0}px)`;
  }
  private resetStick() {
    const pointer = this.pointer;
    this.pointer = null;
    this.input.moveX = this.input.moveZ = 0;
    this.nub.style.transform = "";
    if (pointer !== null && this.stick.hasPointerCapture(pointer))
      this.stick.releasePointerCapture(pointer);
  }
  private reset() {
    this.resetStick();
    const held = [...this.held];
    this.held.clear();
    this.input.touchBrake = false;
    for (const [pointer, button] of held) {
      button.classList.remove("held");
      if (button.hasPointerCapture(pointer))
        button.releasePointerCapture(pointer);
    }
  }
  update(context: TouchContext) {
    const active = this.enabled && this.canPlay();
    if (active !== this.active) {
      this.active = active;
      this.reset();
      this.root.hidden = !active;
      this.ui.classList.toggle("touch-playing", active);
    }
    const label = context.action ?? "Action";
    if (this.action.textContent !== label) this.action.textContent = label;
    this.action.disabled = !context.action;
    const carAction = label === "Drive" || label === "Exit car";
    this.action.dataset.code = carAction ? "KeyF" : "KeyE";
    const extraCar = context.street && context.nearCar && !carAction;
    this.retry.hidden = !context.retry && !extraCar;
    this.retry.textContent = extraCar ? "Drive" : "Retry";
    this.retry.dataset.code = extraCar ? "KeyF" : "KeyR";
    if (this.driving !== context.driving) {
      this.driving = context.driving;
      this.root.classList.toggle("driving", context.driving);
      this.jump.textContent = context.driving ? "Handbrake" : "Jump ↑";
      this.stick.querySelector(".stick-label")!.textContent = context.driving ? "Drive" : "Move";
      this.stick.setAttribute("aria-label", context.driving ? "Driving joystick. Forward to accelerate, back to brake or reverse, left and right to steer." : "Movement joystick. Drag to move.");
    }
    this.root.classList.toggle("street-controls", context.street);
    this.fire.hidden = this.weapon.hidden = !context.street;
    this.weapon.textContent = context.weapon;
    this.weapon.setAttribute("aria-label", context.weapon + " equipped. Switch gun");
    this.radio.hidden = !context.driving;
    this.radio.disabled = !context.radioReady;
    this.hype.hidden = context.driving;
    const hype =
      context.cooldown > 0 ? `Hype ${Math.ceil(context.cooldown)}s` : "Hype";
    if (this.hype.textContent !== hype) this.hype.textContent = hype;
    this.hype.disabled = context.cooldown > 0;
  }
}
