# Grand Theft Liquidity

A Three.js and Rapier browser game set in a coastal town. Complete ten ridiculous jobs, protect your fictional coin bag, and become the Slopmeister.

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

`public/assets/provenance.json` records the generated props and the optimized user-supplied Alon model. `scripts/render_audio.py` reproduces the synthesized loops. `scripts/render_voices.mjs` is an optional offline asset-generation tool using a locally supplied `DEEPGRAM_API_KEY`; deployment uses the committed clips and does not invoke it. Original supplied character files are retained outside this repository.

`DESIGN.md` is the initial historical concept; this README describes the implemented ten-mission game.
