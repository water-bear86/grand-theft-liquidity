import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Assets, CLUB_SIGN, animateAvatar, label } from "./assets.ts";
import {
  createCity,
  createDrivingJobProps,
  createPressShoot,
  PICKUPS,
  JUMPS,
  BIN_LANDING_RADIUS,
  HOTDOG_VENDOR,
} from "./world.ts";
import { Player, Input } from "./player.ts";
import { MobileControls, type TouchContext } from "./mobile-controls.ts";
import { Game } from "./game.ts";
import { OpeningSequence } from "./intro.ts";
import { AUDIT_TASK_ID, CEO_TASK_ID, ROUTE_STOPS, TASKS } from "./content.ts";
import { UI } from "./ui.ts";
import { TaskScenes } from "./task-scenes.ts";
import { GameAudio } from "./audio.ts";
import type { VoiceId } from "./voices.ts";
import {
  ALON,
  CANNON,
  WALLET,
  AIRDROP_TASK_ID,
  PAYROLL_TASK_ID,
  platformAt,
} from "./bagworker.ts";
import { streetTarget } from "./navigation.ts";
import { StreetCars } from "./vehicles.ts";
import { StreetMayhem, makeGun, type Weapon } from "./street-mayhem.ts";
import "./styles.css";

const PHYSICS_STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.1;

function createSky() {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(430, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        blue: { value: new THREE.Color("#509ebb") },
        haze: { value: new THREE.Color("#f9ceac") },
        sun: { value: new THREE.Color("#ffd7a0") },
      },
      vertexShader: `
        varying vec3 direction;
        void main() {
          direction = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 blue;
        uniform vec3 haze;
        uniform vec3 sun;
        varying vec3 direction;
        void main() {
          vec3 ray = normalize(direction);
          float height = smoothstep(-0.055, 0.53, ray.y);
          vec3 skyColor = mix(haze, blue, height);
          float facingSun = max(0.0, dot(ray, normalize(vec3(0.36, 0.15, -0.92))));
          skyColor += sun * (0.29 * pow(facingSun, 21.0));
          skyColor += sun * smoothstep(0.9989, 0.99918, facingSun) * 1.5;
          gl_FragColor = vec4(skyColor, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  return sky;
}

async function boot() {
  const app = document.querySelector<HTMLElement>("#app")!;
  const loading = (text: string) => {
    const p = app.querySelector(".boot-label");
    if (p) p.textContent = text;
  };
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.domElement.className = "game-canvas";
  renderer.domElement.setAttribute(
    "aria-label",
    "Grand Theft Liquidity 3D playfield",
  );
  const assets = new Assets();
  await Promise.all([RAPIER.init(), assets.load(loading)]);
  app.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e8c5a8");
  scene.fog = new THREE.Fog("#e8c5a8", 98, 348);
  const sky = createSky();
  scene.add(sky);
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const camera = new THREE.PerspectiveCamera(
    62,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );
  scene.add(new THREE.HemisphereLight("#bfddec", "#c59b89", 1.45));
  const sun = new THREE.DirectionalLight("#ffd7ad", 2.65);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const physics = new RAPIER.World({ x: 0, y: -21, z: 0 });
  const city = createCity(scene, physics, assets);
  const player = new Player(physics, assets);
  scene.add(player.group);
  const game = new Game();
  const intro = new OpeningSequence(assets);
  scene.add(intro.group);
  const canLock = () =>
    game.mode === "playing" && game.bagworker.phase !== "aiming";
  const input = new Input(renderer.domElement, () => game.mode === "playing", {
    allowed: canLock,
    onUnlock: () => pause(),
    onError: () =>
      game.notify(
        "Mouse lock unavailable. Click and drag to look; L tries again.",
      ),
  });
  let introSeen = false;
  let introCue = -1;
  const sound = new GameAudio();
  const cars = new StreetCars(scene, physics, assets);
  const jobProps = createDrivingJobProps(scene);
  const updatePressShoot = createPressShoot(scene);
  const cameraForward = new THREE.Vector3();
  city.obstacles.push(...cars.fleet.map((car) => car.group));
  const mayhem = new StreetMayhem(scene, assets, city.crowds, (person, cause) => {
    if (!game.recordFatality(person)) return;
    if (cause === "car") cars.paintHood();
    sound.play("impact");
  });
  const guns = { pistol: makeGun("pistol"), scattergun: makeGun("scattergun") };
  scene.add(guns.pistol, guns.scattergun);
  let rider: ReturnType<Player["portrait"]> | null = null;
  function leaveSeat() {
    if (!rider) return;
    rider.group.removeFromParent();
    rider.dispose();
    rider = null;
  }
  const muzzle = new THREE.Vector3(), aim = new THREE.Vector3(), sightPoint = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let weapon: Weapon = "pistol", lastShot = -Infinity;
  const heard = new Set<VoiceId>();
  const buyerState = Array.from({ length: 3 }, () => ({
    x: 0,
    z: 0,
    active: false,
  }));
  const burst = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.08, 48),
    new THREE.MeshBasicMaterial({
      color: "#e3ff99",
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  burst.rotation.x = -Math.PI / 2;
  scene.add(burst);
  let burstTime = 0;
  let wasCooling = false;
  const cashReceiver = new THREE.Vector3();
  let lastMode = "",
    lastDress = "",
    lastNotice = 0,
    lastTime = performance.now(),
    accumulator = 0,
    uiTime = 0,
    elapsed = 0;
  function begin(withIntro = !introSeen) {
    input.releaseLock();
    input.clear();
    intro.stop();
    taskScenes.close();
    game.start(withIntro);
    leaveSeat();
    cars.reset();
    mayhem.reset();
    player.collider.setEnabled(true);
    weapon = "pistol";
    lastShot = -Infinity;
    if (withIntro) {
      introSeen = true;
      introCue = -1;
      intro.start();
    } else input.requestLock();
    player.reset();
    input.yaw = 0;
    input.pitch = 0.35;
    buyerState.forEach((b) => {
      b.active = false;
    });
    city.buyers.forEach((b) => (b.group.visible = false));
    lastDress = "";
    lastNotice = game.noticeId;
    burstTime = 0;
    wasCooling = false;
    city.bagworker.alon.reset();
    city.bagworker.cash.visible = false;
    heard.clear();
    sound.clearDialogue();
    sound.unlock();
    sound.update(game.mode, player.position.x);
  }
  function takeControl() {
    if (game.mode === "intro") game.finishIntro();
    if (!game.takeControl()) return;
    intro.stop();
    input.clear();
    player.syncRenderPose();
    input.requestLock();
    sound.unlock();
    sound.update(game.mode, player.position.x);
  }
  function pause() {
    game.pause();
    input.releaseLock();
    input.clear();
    sound.update(game.mode, player.position.x);
    ui.setCaption(sound.caption);
  }
  function resume(fromClick = true) {
    input.clear();
    game.resume();
    if (fromClick) input.requestLock();
    sound.unlock();
    sound.update(game.mode, player.position.x);
  }
  function cashout() {
    if (!game.requestCashout())
      game.notify("Need a $1,000 bag before a liquidity event.");
  }
  const taskScenes = new TaskScenes(
    renderer.domElement,
    assets,
    () => {
      if (game.completeTask("scene")) completed();
    },
    motion,
    (cue) => sound.play(cue),
  );
  function backToChoices() {
    if (!taskScenes.readout.done && game.cancelTaskScene()) taskScenes.close();
  }
  const ui = new UI(app, {
    start: () => begin(),
    replayIntro: () => begin(true),
    takeControl,
    touchControlsEnabled: () => input.touchControls,
    setTouchControls: (enabled) => mobile.setEnabled(enabled),
    mouseLockEnabled: () => input.mouseLock,
    mouseLockSupported: () => input.lockSupported,
    setMouseLock: (enabled) => input.setMouseLock(enabled),
    toggleMouseLock: () => input.toggleMouseLock(),
    characterAvailable: (id) => assets.characters.has(id),
    selectCharacter: (id) => {
      if (game.mode === "title") player.selectCharacter(id);
    },
    changeCharacter: () => {
      taskScenes.close();
      leaveSeat();
      cars.reset();
      mayhem.reset();
      player.collider.setEnabled(true);
      player.reset();
      game.mode = "title";
      intro.stop();
      input.releaseLock();
      input.clear();
    },
    choose: (index) => {
      if (game.choose(index)) {
        if (game.taskScene)
          taskScenes.open(game.taskScene, player, game.coin.ticker);
        if (game.completed === AIRDROP_TASK_ID) {
          input.clear();
          input.yaw = Math.PI;
          input.pitch = 0.45;
        }
      }
    },
    dispatch: (id) => {
      const car = cars.mounted;
      if (!car || game.mode !== "car-radio" || !game.drivingJobs.start(id, cars.fleet.indexOf(car))) return;
      game.notify(game.drivingJobs.instruction);
      resume();
      sound.play("mission");
    },
    dropJob: () => {
      if (game.mode !== "car-radio") return;
      game.drivingJobs.cancel();
      game.notify("Dispatch has put the job back on the radio.");
      resume();
    },
    sceneBack: backToChoices,
    sceneAssist: () => taskScenes.assist(),
    sceneAim: (value) => taskScenes.aim(value),
    resume,
    cashout,
    confirm: () => {
      if (game.confirmCashout()) sound.play("cash");
    },
    pause,
    mute: () => {
      sound.setMuted(!sound.muted);
      if (!sound.muted) sound.unlock();
      ui.setMuted(sound.muted);
    },
    setMusicVolume: (volume) => sound.setMusicVolume(volume),
    launch: fireCannon,
    aim: (angle) => {
      if (Number.isFinite(angle))
        game.bagworker.aim = THREE.MathUtils.clamp(angle, -15, 15);
    },
    save: saveCard,
  });
  const mobile = new MobileControls(
    ui.root,
    input,
    () => canLock() && game.bagworker.phase !== "flight",
  );
  function radioReady() {
    const car = cars.mounted;
    return !!car && !game.bagworker.active && !game.onRoadshow && !car.airborne && Math.abs(car.speed) <= 2.5;
  }
  function touchContext(): TouchContext {
    const job = game.bagworker;
    const task = TASKS[game.completed];
    const near = !!task && nearbyTask() < 3.8;
    let action: string | null = null;
    if (near && game.pendingChoice === null) action = "Talk";
    else if (near && task.action === "interact") action = "Interact";
    else if (atHotdogCart()) action = "Observe";
    if (job.active) {
      if (job.onCourse || job.phase === "aiming" || job.phase === "flight")
        action = null;
      else if (job.phase === "report" || job.phase === "payday")
        action = nearbyTask() < 3.6 ? "Talk" : null;
      else if (job.phase === "stunt" && game.pendingChoice !== null)
        action =
          Math.hypot(
            player.position.x - CANNON.x,
            player.position.z - CANNON.z,
          ) < 3.6
            ? "Use cannon"
            : null;
    }
    const street = !job.active;
    const nearCar = street && !cars.mounted && player.position.y < 2.2 &&
      !!cars.nearby(player.position.x, player.position.z);
    if (cars.mounted) action = "Exit car";
    else if (!action && nearCar) action = "Drive";
    return { action, retry: job.onCourse, cooldown: game.cooldown, driving: !!cars.mounted, radioReady: radioReady(),
      nearCar, street, weapon: weapon === "pistol" ? "Pistol" : "Scattergun" };
  }
  if (assets.failed.length)
    game.notify("Some decorative props use a simple fallback.");
  function saveCard() {
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
    const card = document.createElement("canvas");
    card.width = 1080;
    card.height = 1080;
    const ctx = card.getContext("2d")!;
    ctx.fillStyle = "#142a38";
    ctx.fillRect(0, 0, 1080, 1080);
    ctx.fillStyle = "#f9e6bd";
    ctx.fillRect(30, 30, 1020, 1020);
    ctx.fillStyle = "#142a38";
    ctx.fillRect(32, 32, 1016, 1016);
    const frameWidth = 968;
    const frameHeight = 582;
    const frameX = (1080 - frameWidth) / 2;
    const frameY = 302;
    const source = renderer.domElement;
    const sw = source.width,
      sh = source.height;
    const aspect = frameWidth / frameHeight;
    const cropWidth = Math.min(sw, sh * aspect);
    const cropHeight = cropWidth / aspect;
    ctx.drawImage(
      source,
      (sw - cropWidth) / 2,
      (sh - cropHeight) / 2,
      cropWidth,
      cropHeight,
      frameX,
      frameY,
      frameWidth,
      frameHeight,
    );
    ctx.fillStyle = "#fde9bf";
    ctx.font = '800 26px "Avenir Next", Arial';
    ctx.fillText("GRAND THEFT LIQUIDITY", frameX, 86);
    ctx.textAlign = "right";
    ctx.fillText("RUN RECEIPT", 1080 - frameX, 86);
    ctx.textAlign = "left";
    ctx.fillStyle = "#e98c6b";
    ctx.fillRect(frameX, 113, frameWidth, 3);
    ctx.font = '900 92px "Avenir Next Condensed", Impact, Arial';
    ctx.fillStyle = "#ffd092";
    ctx.fillText(
      game.ending === "slopmeister"
        ? "THE SLOPMEISTER"
        : game.ending === "early"
          ? "EXIT LIQUIDITY"
          : game.ending === "caught"
            ? "THEY FOUND YOU"
            : "TERMINAL BOREDOM",
      frameX,
      207,
      frameWidth,
    );
    ctx.fillStyle = "#daf79f";
    ctx.font = '800 35px "Avenir Next", Arial';
    ctx.fillText(
      `$${game.banked.toLocaleString("en-US")} BANKED   /   ${game.completed}/${TASKS.length} TASKS`,
      frameX,
      263,
      frameWidth,
    );
    ctx.fillStyle = "#f5af7d";
    ctx.fillRect(frameX, frameY + frameHeight, frameWidth, 6);
    ctx.fillStyle = "#fde9bf";
    ctx.font = '800 28px "Avenir Next", Arial';
    ctx.fillText(
      game.kills
        ? `${game.viewers.toLocaleString("en-US")} WATCHING   /   −$${game.incidentLoss.toLocaleString("en-US")} INCIDENT COSTS`
        : `${game.viewers.toLocaleString("en-US")} WATCHING   /   DIGNITY IS TEMPORARY.`,
      frameX,
      958,
      frameWidth,
    );
    ctx.font = '500 22px "Avenir Next", Arial';
    ctx.fillText(
      `$${game.coin.ticker}  /  Fictional money. Real embarrassment.`,
      frameX,
      1000,
    );
    card.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "grand-theft-liquidity-receipt.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function completed() {
    sound.play(game.routeComplete ? "victory" : "mission");
    ui.flash();
  }
  function showBurst() {
    burstTime = 0.75;
    burst.position.copy(player.position);
    burst.position.y = 0.09;
    sound.play("hype");
  }
  function nearbyTask() {
    const task = TASKS[game.completed];
    return task
      ? Math.hypot(
          player.position.x - task.position.x,
          player.position.z - task.position.z,
        )
      : 0;
  }
  function atHotdogCart() {
    return (
      Math.hypot(
        player.position.x - HOTDOG_VENDOR.x,
        player.position.z - HOTDOG_VENDOR.z,
      ) < 2.6
    );
  }
  function dialogue() {
    function say(id: VoiceId) {
      if (!heard.has(id) && sound.speak(id)) heard.add(id);
    }
    const near = (stop: { x: number; z: number }, radius: number) =>
      Math.hypot(player.position.x - stop.x, player.position.z - stop.z) <
      radius;
    if (game.mode === "victory") say("club");
    if (game.mode !== "playing") return;
    if (game.completed === 0 && near(ROUTE_STOPS.motel, 11)) say("motel");
    if (game.completed === CEO_TASK_ID + 1 && near(ROUTE_STOPS.boardwalk, 25))
      say("boardwalk");
    if (
      game.completed === AUDIT_TASK_ID + 1 &&
      near(ROUTE_STOPS.laundromat, 23)
    )
      say("laundromat");
    if (game.completed >= AUDIT_TASK_ID + 1 && near(HOTDOG_VENDOR, 14))
      say("hotdog");
    if (game.buyerCount > 0 && game.hitGrace <= 0) say("buyer");
  }
  function fireCannon() {
    if (game.mode !== "playing") return;
    const velocity = game.bagworker.fire();
    if (!velocity) return;
    input.clear();
    player.launch(velocity);
    sound.play("hype");
  }
  function jobInteraction() {
    const job = game.bagworker;
    const close = (point: { x: number; y: number; z: number }) =>
      Math.hypot(player.position.x - point.x, player.position.z - point.z) <
        3.6 && Math.abs(player.position.y - point.y) < 2;
    if (job.phase === "report" && close(ALON)) {
      job.report();
      if (game.completeTask()) {
        sound.say(
          "Alon",
          "You misunderstood. You ARE the airdrop. Get in the cannon. I'll pay you when you land in the wallet.",
        );
        game.requestTask();
      }
      return true;
    }
    if (job.phase === "payday" && close(ALON) && game.completeTask()) {
      city.bagworker.alon.handoff();
      sound.say("Alon", "There's no airdrop. This is payroll.");
      sound.play("cash");
      ui.flash();
      return true;
    }
    if (job.phase === "stunt" && game.pendingChoice !== null && close(CANNON)) {
      if (job.enterCannon()) {
        input.clear();
        player.relocate(CANNON);
        input.yaw = Math.PI / 2;
        input.pitch = 0.45;
      }
      return true;
    }
    return false;
  }
  function updateJob(landed: boolean) {
    const job = game.bagworker;
    if (job.onCourse && player.grounded) {
      const index = platformAt(player.position);
      const event = job.land(index);
      if (event === "fakeout") {
        input.clear();
        input.yaw = 0;
        sound.say(
          "Alon",
          "There's no airdrop. Come back. Yes, all the way back.",
        );
        game.notify("NO AIRDROP. RETURN TO ALON.");
        sound.play("cooling");
      } else if (event === "returned") {
        game.notify("Back on the street. Go see Alon.");
        sound.play("pickup");
      } else if (event === "checkpoint") {
        game.notify("Checkpoint saved · R to retry from here");
        sound.play("pickup");
      }
      if (
        index < 0 &&
        player.position.y < 0.35 &&
        (job.phase === "return" || job.next > 0)
      ) {
        player.relocate(job.recover());
        input.clear();
        sound.play("bump");
        game.notify("Back to the last checkpoint. Your bag is safe.");
      }
    }
    if (job.phase === "flight" && landed) {
      if (job.finishFlight(player.position)) {
        sound.play("mission");
        game.notify("DIRECT DEPOSIT COMPLETE. Collect your cash from Alon.");
      } else {
        player.relocate({ x: CANNON.x + 2.8, y: 0, z: CANNON.z + 1 });
        input.clear();
        sound.play("crownMiss");
        game.notify("Delivery returned. Try the cannon again.");
      }
    }
  }
  function toggleCar() {
    if (cars.mounted) {
      const exit = cars.exit();
      if (!exit) { game.notify("Brake to a crawl and leave room for the door."); return; }
      leaveSeat();
      player.relocate(exit);
      player.collider.setEnabled(true);
    } else {
      if (player.position.y >= 2.2 || !cars.enter(player.position.x, player.position.z)) return;
      player.collider.setEnabled(false);
      const car = cars.mounted!;
      player.ride(car.position);
      rider = player.portrait();
      rider.group.scale.setScalar(1.58 / player.character.height);
      rider.group.position.set(-0.39, 0.03, 0.13);
      rider.group.rotation.y = Math.PI;
      car.group.add(rider.group);
      input.yaw = car.heading;
      if (game.onRoadshow) game.notify("The sponsor paid both camera crews. Drive toward the boardwalk.");
      else game.notify(input.touchControls ? "Tap Radio for driving jobs. Steer and hold Handbrake to slide." : "E opens the car radio · Space + steer to slide · F to get out.");
    }
    input.clear();
  }
  function updateAim() {
    const car = cars.mounted;
    const yaw = car?.heading ?? input.yaw;
    const elevation = car ? -0.025 : THREE.MathUtils.clamp(0.32 - input.pitch, -0.65, 0.6);
    aim.set(-Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), -Math.cos(yaw) * Math.cos(elevation));
    if (car) muzzle.set(0.42, 1.12, -1.9).applyAxisAngle(up, yaw).add(car.position);
    else muzzle.set(-0.34, 1.13, 0.16).applyAxisAngle(up, player.group.rotation.y).add(player.position);
  }
  function fireGun() {
    if (game.activeTime - lastShot < (weapon === "pistol" ? 0.21 : 0.65)) return;
    lastShot = game.activeTime;
    updateAim();
    sound.play(weapon);
    mayhem.shoot(muzzle, aim, weapon, (direction, distance) => {
      const hit = physics.castRay(new RAPIER.Ray(muzzle, direction), distance, true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, player.collider, cars.mounted?.body);
      return hit?.timeOfImpact ?? distance;
    });
  }
  function actions() {
    const task = TASKS[game.completed],
      near = task && nearbyTask() < 3.8;
    if (game.bagworker.phase === "aiming") {
      if (input.take("Space")) fireCannon();
      return;
    }
    if (game.bagworker.phase === "flight") return;
    if (input.take("KeyR") && game.bagworker.onCourse) {
      player.relocate(game.bagworker.recover());
      input.clear();
      return;
    }
    if (input.take("KeyC")) {
      cashout();
      return;
    }
    if (!game.bagworker.active) {
      if (input.take("KeyF")) toggleCar();
      if (input.take("KeyG")) weapon = weapon === "pistol" ? "scattergun" : "pistol";
      if (input.take("KeyX")) fireGun();
    }
    if (cars.mounted) {
      if (input.take("KeyE")) {
        if (radioReady()) game.openCarRadio();
        else game.notify(game.onRoadshow ? "Finish the sponsor shoot to use the radio." : "Park to use the car radio.");
      }
      return;
    }
    if (input.take("KeyE")) {
      if (jobInteraction()) return;
      if (near) {
        if (game.pendingChoice === null) game.requestTask();
        else if (task.action === "interact" && game.completeTask()) completed();
      } else if (atHotdogCart()) {
        const observed = game.usedSpots.has("hotdog");
        game.usedSpots.add("hotdog");
        game.notify(
          observed
            ? "Vendor: Looking at it again won’t put the mustard back."
            : "Vendor: You collapsed the wave function. It’s a hot dog. The bun is still theoretical.",
        );
      }
    }
    if (game.mode === "playing" && input.take("KeyQ")) {
      const spot = TASKS.find(
        (t) =>
          Math.hypot(
            player.position.x - t.position.x,
            player.position.z - t.position.z,
          ) < 7,
      );
      const bagBeforeHype = game.bag;
      if (game.hype(spot ? `crowd-${spot.id}` : undefined)) {
        showBurst();
        if (
          near &&
          game.pendingChoice !== null &&
          task.action === "hype" &&
          game.completeTask()
        )
          completed();
        else if (game.bag > bagBeforeHype) sound.play("pump");
      } else
        game.notify(
          `The chat needs ${Math.ceil(game.cooldown)} seconds to recover.`,
        );
    }
  }
  function simulate(dt: number) {
    const beforeVy = player.vy;
    const steer = Number(input.down.has("KeyD") || input.down.has("ArrowRight"))
      - Number(input.down.has("KeyA") || input.down.has("ArrowLeft")) + input.moveX;
    const throttle = Number(input.down.has("KeyW") || input.down.has("ArrowUp"))
      - Number(input.down.has("KeyS") || input.down.has("ArrowDown")) - input.moveZ;
    const brake = !!cars.mounted && (input.down.has("Space") || input.touchBrake || input.take("Space"));
    cars.step(dt, { steer, throttle, brake });
    let movement = { collided: false, landed: false };
    if (cars.mounted) {
      player.ride(cars.mounted.position);
      physics.timestep = dt;
      physics.step();
      const car = cars.mounted;
      if (game.onRoadshow || game.drivingJobs.active) {
        const distance = Math.hypot(car.position.x - car.previous.x, car.position.z - car.previous.z);
        const sample = { car: cars.fleet.indexOf(car), x: car.position.x, z: car.position.z,
          distance, speed: distance / dt, slipAngle: car.slipAngle, grounded: !car.airborne, impact: car.impact };
        if (game.onRoadshow) {
          const shot = game.filmRoadshow(car.previous, sample, brake || car.drift > 0.18);
          if (shot === "photo") completed();
          else if (shot === "gate") sound.play("pickup");
        } else {
          const event = game.updateDrivingJob(dt, sample);
          if (event?.lostCargo) jobProps.spill(car.group, car.velocity, game.drivingJobs.cargo, event.lostCargo, game.activeTime);
          if (event?.award) sound.play("cash");
          else if (event?.text && event.progress) sound.play("mission");
        }
      }
      input.yaw = cars.mounted.heading;
    } else if (game.bagworker.phase !== "aiming") movement = player.update(dt, input);
    else {
      physics.timestep = dt;
      physics.step();
    }
    mayhem.step(dt, player.position, cars.mounted);
    updateJob(movement.landed);
    if (player.vy > 5 && beforeVy <= 0) sound.play("jump");
    if (movement.collided && game.collide()) sound.play("bump");
    if (movement.landed) {
      const task = TASKS[game.completed];
      if (
        task &&
        game.pendingChoice !== null &&
        task.action === "jump" &&
        nearbyTask() < BIN_LANDING_RADIUS &&
        game.completeTask()
      )
        completed();
    }
    if ((!cars.mounted && !player.grounded && player.position.y > 0.6) ||
      (cars.mounted && cars.mounted.position.y > 0.8))
      JUMPS.forEach((spot, i) => {
        if (
          Math.hypot(player.position.x - spot.x, player.position.z - spot.z) <
            3 &&
          game.stunt(`jump-${i}`)
        ) {
          sound.play("pump");
          ui.flash();
        }
      });
    PICKUPS.forEach((spot, i) => {
      if (
        Math.hypot(player.position.x - spot.x, player.position.z - spot.z) <
          1.3 &&
        player.position.y < 2 &&
        game.pickup(`pickup-${i}`)
      ) {
        sound.play("pickup");
        ui.flash();
      }
    });
    const count = game.buyerCount;
    buyerState.forEach((buyer, i) => {
      if (i >= count) {
        city.buyers[i].group.visible = false;
        buyer.active = false;
        return;
      }
      if (!buyer.active) {
        buyer.active = true;
        buyer.x = (i - 1) * 2;
        buyer.z = Math.min(15, player.position.z + 23 + i * 3);
      }
      const destination = streetTarget(buyer, player.position);
      const dx = destination.x - buyer.x,
        dz = destination.z - buyer.z;
      const length = Math.hypot(dx, dz);
      if (length > 0.4) {
        const speed = 3.35 + game.heat * 0.019;
        buyer.x += (dx / length) * speed * dt;
        buyer.z += (dz / length) * speed * dt;
      }
      const avatar = city.buyers[i];
      avatar.group.visible = true;
      avatar.group.position.set(buyer.x, 0, buyer.z);
      avatar.group.rotation.y = Math.atan2(dx, dz);
      animateAvatar(avatar, game.activeTime + i, 7);
      if (
        Math.hypot(player.position.x - buyer.x, player.position.z - buyer.z) <
          0.95 &&
        player.position.y < 1.4 &&
        game.buyerHit()
      ) {
        player.slow = 0.5;
        sound.play("buyer");
      }
    });
    game.tick(dt);
  }
  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (
      event.code === "Space" &&
      (game.mode === "intro" || game.mode === "intro-ready") &&
      !(
        event.target instanceof HTMLElement &&
        event.target.closest("button, input")
      )
    ) {
      event.preventDefault();
      takeControl();
    }
    if (event.code !== "Escape" || input.justUnlocked) return;
    if (game.mode === "task-scene") backToChoices();
    else if (
      game.mode === "playing" ||
      game.mode === "intro" ||
      game.mode === "intro-ready"
    )
      pause();
    else if (game.mode === "paused" || game.mode === "cashout" || game.mode === "car-radio") resume(false);
  });
  window.addEventListener("blur", () => {
    sound.setBackgrounded(true);
    pause();
  });
  window.addEventListener("focus", () =>
    sound.setBackgrounded(document.hidden),
  );
  document.addEventListener("visibilitychange", () => {
    sound.setBackgrounded(document.hidden || !document.hasFocus());
    if (document.hidden) pause();
  });
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    pause();
  });
  renderer.domElement.addEventListener("webglcontextrestored", () =>
    game.notify("Graphics recovered. Resume when ready."),
  );
  window.addEventListener("resize", () => {
    input.clear();
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    taskScenes.resize();
  });
  function frame(now: number) {
    const delta = Math.min(
      Math.max(0, (now - lastTime) / 1000),
      MAX_FRAME_DELTA,
    );
    lastTime = now;
    elapsed += delta;
    if (game.mode === "intro" && intro.tick(delta)) game.finishIntro();
    const cinematic =
      game.mode === "intro" ||
      game.mode === "intro-ready" ||
      (game.mode === "paused" &&
        (game.previousMode === "intro" || game.previousMode === "intro-ready"));
    intro.group.visible = cinematic;
    player.group.visible = !cinematic && !cars.mounted;
    renderer.domElement.classList.toggle("cinematic", cinematic);
    if (game.mode === "playing") {
      actions();
      accumulator += delta;
      while (game.mode === "playing" && accumulator >= PHYSICS_STEP) {
        simulate(PHYSICS_STEP);
        accumulator -= PHYSICS_STEP;
      }
    }
    if (game.mode !== "playing") accumulator = 0;
    input.syncLock();
    if (lastMode !== game.mode) {
      if (game.mode !== "playing") {
        input.clear();
        player.syncRenderPose();
      }
      lastMode = game.mode;
    }
    const dress = game.choices.join(",");
    if (dress !== lastDress) {
      player.dress(assets, game.choices, game.routeComplete);
      lastDress = dress;
    }
    if (game.noticeId > lastNotice) {
      lastNotice = game.noticeId;
      if (game.notices[0]?.type === "pump") ui.flash();
    }
    // Draw between the last two physics poses so an uneven frame doesn't repeat or skip a pose.
    if (!cars.mounted) player.renderPose(game.mode === "playing" ? accumulator / PHYSICS_STEP : 1);
    if (cinematic) intro.renderCamera(camera, motion.matches);
    else if (game.mode === "title") {
      player.group.rotation.y = 0.1;
      if (camera.aspect < 0.85) {
        camera.position.set(0, 3.5, 15.5);
        camera.lookAt(0, 5, 4);
      } else {
        camera.position.set(-2.8, 2.6, 9.8);
        camera.lookAt(-1.8, 1.1, 4);
      }
    } else if (cars.mounted) cars.updateCamera(camera, delta);
    else if (game.mode === "result" || game.mode === "victory") {
      const target = player.position.clone().add(new THREE.Vector3(0, 1.3, 0));
      const wanted = player.position.clone().add(new THREE.Vector3(-4, 3, -5));
      camera.position.lerp(wanted, Math.min(1, delta * 5));
      camera.lookAt(target);
    } else player.updateCamera(camera, input, city.obstacles, delta);
    const streetPlaying = game.mode === "playing" && !game.bagworker.active;
    const sight = ui.get("street-sight");
    sight.hidden = !streetPlaying;
    guns.pistol.visible = streetPlaying && !cars.mounted && weapon === "pistol";
    guns.scattergun.visible = streetPlaying && !cars.mounted && weapon === "scattergun";
    if (streetPlaying) {
      updateAim();
      const gun = guns[weapon];
      gun.position.copy(muzzle).addScaledVector(aim, -Math.max(0, 0.09 - (game.activeTime - lastShot)));
      gun.lookAt(sightPoint.copy(gun.position).add(aim));
      camera.updateMatrixWorld();
      sightPoint.copy(muzzle).addScaledVector(aim, 22).project(camera);
      sight.style.left = `${(sightPoint.x + 1) * 50}%`;
      sight.style.top = `${(1 - sightPoint.y) * 50}%`;
    }
    const renderedPlayer = cinematic ? intro.focus : cars.mounted?.position ?? player.group.position;
    sky.position.copy(camera.position);
    sun.position.set(renderedPlayer.x + 34, 20, renderedPlayer.z - 19);
    sun.target.position.set(renderedPlayer.x, 0, renderedPlayer.z - 7);
    city.water.material.uniforms.uTime.value = motion.matches ? 0 : elapsed;
    jobProps.animateSpills(game.mode === "title" || game.mode === "result" ? Infinity : game.activeTime);
    const dispatch = game.drivingJobs, jobCar = cars.fleet[dispatch.car];
    const inJobCar = !!jobCar && jobCar === cars.mounted;
    const followDispatch = !!dispatch.active && !game.bagworker.active && !game.onRoadshow;
    city.markers.forEach((marker, i) => {
      marker.children[1].visible =
        i !== AIRDROP_TASK_ID && i !== PAYROLL_TASK_ID;
      marker.visible =
        !cinematic && !followDispatch && !game.onRoadshow && i === game.completed && !game.bagworker.onCourse;
      if (marker.visible)
        marker.children[1].position.y =
          3.7 + (motion.matches ? 0 : Math.sin(elapsed * 2) * 0.1);
    });
    city.pickups.forEach((pickup, i) => {
      pickup.visible = !cinematic && !game.usedSpots.has(`pickup-${i}`);
      pickup.rotation.y = motion.matches ? 0 : elapsed;
      pickup.position.y =
        1.1 + (motion.matches ? 0 : Math.sin(elapsed * 2 + i) * 0.18);
    });
    city.jumps.forEach(
      (jump, i) =>
        (jump.visible = !cinematic && !game.usedSpots.has(`jump-${i}`)),
    );
    if (burstTime > 0) {
      burstTime -= delta;
      burst.scale.setScalar(1 + (1 - burstTime / 0.75) * 7);
      (burst.material as THREE.MeshBasicMaterial).opacity =
        Math.max(0, burstTime / 0.75) * 0.65;
    } else (burst.material as THREE.MeshBasicMaterial).opacity = 0;
    if (game.routeComplete && city.sign.userData.crowned !== true) {
      const material = city.sign.material as THREE.MeshStandardMaterial;
      material.map?.dispose();
      material.map = label(
        "THE SLOPMEISTER",
        CLUB_SIGN.ink,
        CLUB_SIGN.enamel,
        1024,
        115,
        "sign",
      );
      material.needsUpdate = true;
      city.sign.userData.crowned = true;
    }
    if (game.completed === 0 && city.sign.userData.crowned === true) {
      const material = city.sign.material as THREE.MeshStandardMaterial;
      material.map?.dispose();
      material.map = label(
        "CLUB LIQUID",
        CLUB_SIGN.ink,
        CLUB_SIGN.enamel,
        1024,
        115,
        "sign",
      );
      material.needsUpdate = true;
      city.sign.userData.crowned = false;
    }
    const job = game.bagworker;
    const target = job.active
      ? job.phase === "aiming" || job.phase === "flight"
        ? WALLET
        : job.target
      : TASKS[game.completed]?.position;
    const guided =
      !game.onRoadshow && !followDispatch && !!target &&
      (job.active ||
        game.completed === AIRDROP_TASK_ID ||
        player.position.x < -28);
    city.bagworker.guide.visible = !cinematic && guided;
    if (guided && target) {
      const next =
        job.onCourse || job.phase === "aiming" || job.phase === "flight"
          ? target
          : streetTarget(player.position, target);
      city.bagworker.guide.position.set(
        next.x,
        ("y" in next ? (next.y as number) : 0) + 0.15,
        next.z,
      );
      city.bagworker.guide.scale.setScalar(
        1.2 + (motion.matches ? 0 : Math.sin(elapsed * 3) * 0.08),
      );
    }
    city.bagworker.cannon.rotation.y = (job.aim * Math.PI) / 180;
    city.bagworker.alon.update(
      game.mode === "playing" || (game.mode === "intro" && !motion.matches)
        ? delta
        : 0,
    );
    const handoff = city.bagworker.alon.handoffElapsed;
    city.bagworker.cash.visible = handoff >= 0.45 && handoff < 2.4;
    if (city.bagworker.cash.visible) {
      city.bagworker.alon.handPosition(city.bagworker.cash.position);
      cashReceiver.copy(player.position).y += 1.15;
      city.bagworker.cash.position.lerp(
        cashReceiver,
        THREE.MathUtils.smoothstep(handoff, 1.6, 2.35),
      );
      city.bagworker.cash.rotation.y = city.bagworker.alon.group.rotation.y;
    }
    city.auditDrum.rotation.z =
      game.completed > AUDIT_TASK_ID ? elapsed * 7 : 0;
    uiTime += delta;
    if (uiTime > 0.05 || ui.lastMode !== game.mode) {
      uiTime = 0;
      cars.updateVisibility(renderedPlayer);
      const pressCar = game.onRoadshow && !cars.mounted ? cars.nearby(player.position.x, player.position.z, Infinity) : null;
      updatePressShoot(game.onRoadshow && game.mode === "playing" ? game.roadshow.gate : null, pressCar?.position);
      jobProps.update(dispatch, jobCar?.group, inJobCar, followDispatch && !cinematic && game.mode !== "title" && game.mode !== "result");
      if (game.mode === "playing" && game.marketCooling && !wasCooling)
        sound.play("cooling");
      wasCooling = game.marketCooling;
      dialogue();
      sound.update(game.mode, player.position.x, cars.mounted?.speed ?? null, cars.mounted?.slipAngle ?? 0);
      const distance = nearbyTask(),
        task = TASKS[game.completed];
      let prompt = "";
      if (game.mode === "playing" && task && distance < 3.8)
        prompt =
          game.pendingChoice === null
            ? "E · make a bad decision"
            : task.actionHint;
      else if (game.mode === "playing" && atHotdogCart())
        prompt = "E · observe the hot dog";
      if (job.active) {
        if (job.onCourse) prompt = "Space · jump · R retries checkpoint";
        else if (job.phase === "report" || job.phase === "payday")
          prompt = nearbyTask() < 3.6 ? "E · talk to Alon" : "";
        else if (job.phase === "stunt" && game.pendingChoice !== null)
          prompt =
            Math.hypot(
              player.position.x - CANNON.x,
              player.position.z - CANNON.z,
            ) < 3.6
              ? "E · get in the cannon"
              : "";
        else if (job.phase === "aiming" || job.phase === "flight") prompt = "";
      }
      if (game.mode === "playing" && !job.active) {
        if (game.onRoadshow) {
          prompt = !cars.mounted && touchContext().nearCar ? "F · get in for the sponsor shoot" : "";
        } else if (cars.mounted) {
          if (game.completed === CEO_TASK_ID && distance < 18 && !followDispatch) prompt = "F · stop and get out to hire a CEO";
          else prompt = !input.touchControls && radioReady() && !followDispatch ? "E · car radio" : "";
        } else if (!prompt && touchContext().nearCar) prompt = "F · drive";
      }
      const context = touchContext();
      ui.updateStreet(game, context.weapon, cars.mounted?.speed ?? null, (cars.mounted?.slipAngle ?? 0) > 0.20);
      const waypoint = game.onRoadshow ? (cars.mounted ? game.roadshow.target : pressCar?.position)
        : followDispatch ? (inJobCar ? dispatch.target : jobCar?.position) : null;
      let guidance;
      if (waypoint) {
        camera.getWorldDirection(cameraForward);
        const dx = waypoint.x - player.position.x, dz = waypoint.z - player.position.z;
        guidance = { bearing: Math.atan2(cameraForward.x, cameraForward.z) - Math.atan2(dx, dz),
          distance: Math.hypot(dx, dz), assigned: game.onRoadshow ? !!cars.mounted : inJobCar };
      }
      ui.update(
        game,
        job.active
          ? Math.hypot(
              player.position.x - job.target.x,
              player.position.z - job.target.z,
            )
          : distance,
        mobile.enabled
          ? prompt.replace(/^E ·/, `${context.action ?? "Action"} ·`).replace(/^F ·/, `${context.driving ? "Exit car" : "Drive"} ·`)
          : prompt,
        guidance,
      );
      ui.setCaption(sound.caption);
    }
    mobile.update(touchContext());
    ui.updateMouseLock(
      input.mouseLock,
      input.locked,
      input.lockSupported,
      canLock(),
    );
    if (game.mode === "intro" || game.mode === "intro-ready") {
      ui.updateIntro(intro.frame);
      if (introCue !== intro.frame.index) {
        introCue = intro.frame.index;
        sound.play(intro.frame.shot.id === "title" ? "mission" : "introCut");
      }
    }
    ui.updateLauncher(game);
    if (game.mode === "task-scene") taskScenes.update(delta);
    if (game.mode === "task-scene") {
      ui.updateScene(taskScenes.readout);
      renderer.render(taskScenes.scene, taskScenes.camera);
    } else {
      taskScenes.close();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }
  ui.update(game, nearbyTask(), "");
  requestAnimationFrame(frame);
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __gtl: {
        game,
        player,
        input,
        city,
        cars,
        mayhem,
        assets,
        renderer,
        physics,
        taskScenes,
        sound,
        intro,
        camera,
        teleport(x: number, z: number) {
          player.body.setTranslation({ x, y: 0.86, z }, true);
          player.body.setNextKinematicTranslation({ x, y: 0.86, z });
          player.velocity.set(0, 0, 0);
          player.vy = 0;
          physics.step();
          player.position.set(x, 0, z);
          player.syncRenderPose();
        },
        snapshot() {
          return {
            character: player.character.id,
            mode: game.mode,
            bag: game.bag,
            driving: !!cars.mounted,
            speed: cars.mounted?.speed ?? player.speed,
            weapon,
            kills: game.kills,
            viewers: game.viewers,
            incidentLoss: game.incidentLoss,
            completed: game.completed,
            choices: game.choices,
            strikes: game.strikes,
            position: player.position.toArray(),
            grounded: player.grounded,
            drawCalls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
          };
        },
      },
    });
  }
}
boot().catch((error) => {
  console.error(error);
  const app = document.querySelector<HTMLElement>("#app")!;
  app.replaceChildren();
  const card = document.createElement("div");
  card.className = "panel";
  card.style.margin = "10vh auto";
  const title = document.createElement("h2");
  title.textContent = "The coast didn’t load.";
  const text = document.createElement("p");
  text.textContent =
    "Try reloading in a browser with WebGL enabled. Your browser may need hardware acceleration.";
  const button = document.createElement("button");
  button.className = "primary";
  button.textContent = "Reload";
  button.onclick = () => location.reload();
  card.append(title, text, button);
  app.append(card);
});
