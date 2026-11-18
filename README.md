# Grand Theft Liquidity

A Three.js and Rapier browser game set in a coastal town. Complete ten ridiculous jobs, protect your fictional coin bag, and become the Slopmeister.

Choose Cabbage or Cupsultan on the title screen. Each has animated walking, running and jump stunts, character-specific prop placement, and their own model in mission close-ups. Retry keeps your character; **Change character** on the run receipt returns to the picker. Both use the same movement and collision rules.

The current game includes BagWorker Blvd, an out-and-back rooftop platformer, the fake airdrop, a parcel cannon and giant wallet, and Alon's animated cash handoff. Music, sound effects, six NPC voice clips, and all character/prop assets are bundled locally. Alon's dialogue uses captions.

## Run locally

Use Node.js 24.22.1 (pinned in `.node-version`) and pnpm 10.23.0.

```sh
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

WASD or arrows move; drag the playfield to look; Space jumps or fires the cannon; E interacts; R retries a rooftop checkpoint; Q uses hype; C cashes out; Escape pauses. The game is tuned for keyboard and mouse. Close-ups also accept touch gestures.

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

`public/assets/provenance.json` records the generated props and the optimized user-supplied Alon, Cabbage and Cupsultan models. `scripts/render_audio.py` reproduces the synthesized loops. `scripts/render_voices.mjs` is an optional offline asset-generation tool using a locally supplied `DEEPGRAM_API_KEY`; deployment uses the committed clips and does not invoke it. Original supplied character files are retained outside this repository.

`DESIGN.md` is the initial historical concept; this README describes the implemented ten-mission game.

Player model preparation is an offline step, separate from the game build. To reproduce it with your local source models:

```sh
npm install --prefix /tmp/gtl-assets sharp@0.35.5
NODE_PATH=/tmp/gtl-assets/node_modules node scripts/prepare-player-assets.cjs /path/to/cabbage.glb /path/to/Cup-sultan.glb /path/to/cup-sultan-wide-run.glb
```

This preserves the supplied geometry, skin weights and original clips, reduces embedded textures, and updates provenance hashes. Cupsultan uses the corrected `Running_Wide` clip from the matching rig; the script checks its bind transforms and hierarchy before transferring it. Original files are never modified. Runtime animation removes root travel so the physics controller owns movement. A held upright pose supplies idle; the imported backflip plays during jumps. If a character asset cannot load, an authored stand-in keeps the game playable.
