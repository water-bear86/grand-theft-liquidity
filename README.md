# Grand Theft Liquidity

A Three.js and Rapier browser game set in a coastal town. Complete ten ridiculous jobs, protect your fictional coin bag, and become the Slopmeister.

Choose Cabbage, Cupsultan or Ansem-X on the title screen. All three walk, run and appear in mission close-ups. Ansem-X stands 25% taller and uses his own airborne jump. Cabbage and Cupsultan backflip. Retry keeps your character, and **Change character** on the run receipt returns to the picker. All three share the same movement and collision rules.

The current game includes BagWorker Blvd, an out-and-back rooftop platformer, the fake airdrop, a parcel cannon and giant wallet, and Alon's animated cash handoff. BagWorker keeps street and shop signs, with the floating names, platform numbers and instruction boards removed. The wallet sits on a raised loading platform to one side of the cannon, requiring both aim and power timing. Music, sound effects, six NPC voice clips, and all character/prop assets are bundled locally. Alon's dialogue uses captions.

## Run locally

Use Node.js 24.22.1 (pinned in `.node-version`) and pnpm 10.23.0.

```sh
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

The first entry plays an 18-second opening montage with Skip, a final Take control button, and reduced-motion support. The run clock stays frozen throughout. Retry goes straight into play; Watch opening on the title screen replays it.

WASD or arrows move; move the mouse to look when locked, or drag the playfield when unlocked; L toggles mouse lock; Space jumps or fires the cannon; E interacts; R retries a rooftop checkpoint; Q uses hype; C cashes out; Escape releases the mouse and pauses. Mouse lock is optional on the title and pause screens. It releases automatically for mission choices, close-ups and cannon aiming; click the playfield to lock again. If the browser refuses lock, drag-look remains available. On phones and tablets, touch controls switch on automatically. Drag the left joystick to move (push farther to run), swipe the playfield to look, and tap Jump, Hype or the contextual action button on the right. Moving, looking and jumping work together with multiple fingers. Retry appears on the rooftop course; cannon aiming and close-ups use their own touch controls. Pause and Cash out stay at the top right. Touch controls can also be switched on or off from the title or pause screen. Pausing, rotating the device or entering a mission clears held input. Desktop keyboard and mouse controls remain available.

## Checks and build

```sh
pnpm test
pnpm build
pnpm preview
```

The build produces `dist/`. Serve it over HTTP. Tests check mission progression, payouts, checkpoint recovery, market pressure, pause/restart, and street routing.

## Render deployment

`render.yaml` describes a static site built from `main`. Render installs the locked dependencies, runs the rule tests and TypeScript check, then publishes `dist/`. No backend, database, or runtime API key is required. Deploys are triggered explicitly after changes are pushed.

The Render CLI equivalent is:

```sh
render services create --name grand-theft-liquidity --type static_site --repo https://github.com/water-bear86/grand-theft-liquidity --branch main --build-command 'corepack pnpm install --frozen-lockfile --prod=false && corepack pnpm test && corepack pnpm build' --publish-directory dist --auto-deploy=false --confirm --output json
```

For subsequent releases, use `render deploys create SERVICE_ID --commit COMMIT_SHA --wait --confirm --output json` with the deployed service ID and reviewed commit.

## Assets

`public/assets/provenance.json` records the generated props and the supplied Alon, Cabbage, Cupsultan and Ansem-X models. `scripts/render_audio.py` reproduces the synthesized loops. `scripts/render_voices.mjs` is an optional offline asset-generation tool using a locally supplied `DEEPGRAM_API_KEY`. Deployment uses the committed clips. Original supplied character files are retained outside this repository.

`DESIGN.md` is the initial historical concept; this README describes the implemented ten-mission game.

Player model preparation is an offline step, separate from the game build. To reproduce it with your local source models:

```sh
npm install --prefix /tmp/gtl-assets sharp@0.35.5
NODE_PATH=/tmp/gtl-assets/node_modules node scripts/prepare-player-assets.cjs /path/to/cabbage.glb /path/to/Cup-sultan.glb /path/to/cup-sultan-wide-run.glb
```

This preserves the supplied geometry, skin weights and original clips, reduces embedded textures, and updates provenance hashes. Cupsultan uses the corrected `Running_Wide` clip from the matching rig; the script checks its bind transforms and hierarchy before transferring it. Original files are never modified. Runtime animation removes root travel so the physics controller owns movement. A held upright pose supplies idle; the imported backflip plays during jumps. If a character asset cannot load, an authored stand-in keeps the game playable.

To prepare Ansem-X, use the Meshy robot export and the cyborg running clip recorded in provenance.

```sh
npm install --prefix /tmp/gtl-assets @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 draco3d@1.5.7 meshoptimizer@1.1.1
NODE_PATH=/tmp/gtl-assets/node_modules node scripts/prepare-ansem-asset.mjs /path/to/robot-clips.glb /path/to/running-with-skin.glb
```

The script keeps the robot's breathing idle, walk and jump, adapts the run to his skeleton, and bundles those four motions in a single GLB. The physics controller supplies travel and jump height.
