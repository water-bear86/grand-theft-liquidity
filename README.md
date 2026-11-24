# Grand Theft Liquidity

A Three.js and Rapier browser game set in a coastal town. Complete eleven ridiculous jobs, protect your fictional coin bag, and become the Slopmeister.

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

The game is fully playable without a wallet. To post scores to the wallet-linked board locally, run the API in a second terminal:

```sh
pnpm dev:api
```

`pnpm dev` proxies `/api` to that process on `http://127.0.0.1:8787`. Without `DATABASE_URL`, scores stay in memory and reset when the API process stops.

The first entry plays an 18-second opening montage with Skip, a final Take control button, and reduced-motion support. The run clock stays frozen throughout. Retry goes straight into play; Watch opening on the title screen replays it.

WASD or arrows move; move the mouse to look when locked, or drag the playfield when unlocked; L toggles mouse lock; Space jumps or fires the cannon; E interacts; R retries a rooftop checkpoint; Q uses hype; C cashes out; Escape releases the mouse and pauses. Mouse lock is optional on the title and pause screens. It releases automatically for mission choices, close-ups and cannon aiming; click the playfield to lock again. If the browser refuses lock, drag-look remains available. On phones and tablets, touch controls switch on automatically. Drag the left joystick to move (push farther to run), swipe the playfield to look, and tap Jump, Hype or the contextual action button on the right. Moving, looking and jumping work together with multiple fingers. Retry appears on the rooftop course; cannon aiming and close-ups use their own touch controls. Pause and Cash out stay at the top right. Touch controls can also be switched on or off from the title or pause screen. Pausing, rotating the device or entering a mission clears held input. Desktop keyboard and mouse controls remain available.

### Driving and street chaos

**Pump the Brakes** is the second story mission. After the motel stunt, get into the marked convertible and drive toward the boardwalk through both camera gates. At the striped press bay, steer and hold the handbrake while moving to give the sponsor its photo. Each gate stays cleared if you miss the slide. The boardwalk CEO mission opens when the photo pays out.

Walk up to a parked car and press **F** to get in. The first convertible sits just left of spawn. Drive with WASD or the arrows. At speed, steer and hold **Space** to kick the rear out. Release Space to carry the slide, then steer into it to straighten up. Hold Space with the wheels straight to stop. On a phone, steer with the stick and hold **Handbrake** with a second thumb. Press F or tap **Exit car** once you are nearly stopped.

While parked, press **E** or tap **Radio** for three optional jobs. Each pays once per run. You can leave your vehicle, return to it, or drop the job on the radio.

- **Proof of Drift** pays $700 for four metres of sideways travel at each of two marked intersections on the way to BagWorker Boulevard.
- **Hot Dog Futures** puts six hot dogs on the roof at the boardwalk. Hard hits knock them off. Club Liquid pays $150 for each one you park with.
- **Exit Ramp** pays $1,000 to land the final ramp jump inside Club Liquid’s striped VIP bay. The valet keeps $40.

Traffic, loose bins, and sandwich boards share the boulevard.

Press **X** or click with the mouse locked to fire. **G** switches between the pistol and scattergun. On touchscreens the joystick steers, accelerates, and reverses. Drive, Handbrake, Fire, and the gun selector are on screen.

Each pedestrian killed by your car or gun brings **250 viewers** and deducts **5% of your current fictional bag** at impact. A person counts once. Stunts, new hype spots, and completed jobs also attract viewers. The run receipt shows total viewers, incident costs, and the cash you banked.

## Checks and build

```sh
pnpm test
pnpm build
pnpm preview
```

The build produces `dist/`. Serve it over HTTP. Tests check mission progression, payouts, checkpoint recovery, market pressure, pause/restart, street routing, score validation, ed25519 signature verification, gallery scoring, pot settlement, payment checks (mock RPC), and replay protection.

## Wallet leaderboard

The title and run-receipt screens show a top-10 board keyed to Solana addresses. Players can optionally connect Phantom (`window.phantom.solana`) and, after a banked run, sign a message that includes the score, a server-issued nonce, and a timestamp. That signature is verified on the API with tweetnacl and bs58. No transaction is sent and no SOL is spent. The game still works if Phantom is missing or the API is offline.

A static site cannot store scores, so `server/` is a small Node service:

- `GET /health` and `GET /api/leaderboard`
- `POST /api/nonce` issues a single-use nonce bound to a wallet
- `POST /api/scores` checks the payload, rate-limits, verifies the ed25519 signature, and keeps the best score per wallet

IP rate limits use the direct socket address and never trust forwarded headers. Behind a reverse proxy, clients sharing a proxy address also share its IP limit.

Storage is pluggable. If `DATABASE_URL` is unset, the process uses an in-memory store (fine for local development, lost on restart). If `DATABASE_URL` points at Postgres, the service creates `scores` and `nonces` tables and persists there. Render Postgres, Neon, or any hosted Postgres works. Disk files such as SQLite are not used, because the Render free web plan does not persist them.


## Shooting gallery

A pay-to-play minigame, unlocked after a wallet signs that it has finished the story once. Entry is **0.05 SOL**, paid with a normal `SystemProgram` transfer from Phantom to a bot-controlled house wallet. There is no escrow and no smart contract.

Rules:

- Six moving targets, five shots, lowest official total wins. Rings are bullseye **5**, then **10**, **15**, **20**. A miss is **25**. After four clean hits (anything but a miss or a forfeit) the fifth shot is skipped, so the floor is **20**.
- Exactly one target hides a forfeit, chosen on the server when the round starts. The server publishes a SHA-256 commitment and reveals the target and salt after the round so players can check it was not changed.
- The pot settles after three completed rounds. The lowest score wins. Ties at that score split the prize evenly (lamport remainder is added to the house cut). If all three forfeit, there is no winner, no house cut, and the whole pot rolls into the next one. When there is a winner, the house takes 5% at settlement.
- Players cannot see anyone else's score in the current pot until it settles.
- The entry screen includes: `Skill game. 18+. Check your local laws.`

The official score is computed on the server from the round seed and the shot aim/timings the client sends. The client preview is unofficial.

### Server setup

The gallery uses the same Node API as the leaderboard (`pnpm dev:api`, or the `gtl-leaderboard` Render service). Set these on that service, never in the repo:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres. Required in production so pots, rounds, and the payout log survive restarts. Without it, the API uses in-memory storage. |
| `SOLANA_RPC_URL` | A trusted Solana RPC used to verify entry payments and to send payouts. Must be the same cluster as the house wallet. |
| `HOUSE_WALLET` | Public address that receives entry payments and, when payouts are live, sends prizes. If omitted, it is derived from the secret. |
| `HOUSE_WALLET_SECRET` | House keypair: JSON byte array, hex, or base58, 32-byte seed or 64-byte secret. Never committed, never logged. Required only when you turn payouts on. |
| `GALLERY_DRY_RUN` | Defaults **on** (unset, `true`, `1`, `yes`, or `on`). While it is on, settlements are recorded and payouts are written to the payout log as `dry_run`, but **no SOL is sent**. Set it to `false` only when you are ready to pay winners from the house wallet. |
| `CORS_ORIGIN` | Same as the leaderboard. |
| `VITE_LEADERBOARD_API` | On the static site, the API origin (no trailing slash). The gallery client uses this same URL. |

Do not advertise paid play while `GALLERY_DRY_RUN` is on: players can still be charged 0.05 SOL, and the entry screen will warn that payouts are disabled. Keep a SOL balance in the house wallet before enabling payouts, enough for prizes plus fees. Payout sending is idempotent (one log row per pot and wallet; a sent row is never paid again).

This branch does not deploy or merge anything. After review, merge into `sol-leaderboard` (or `main` after that PR), set the env vars, then manually deploy the API and the static site if you want it live. Leave auto-deploy off.

### Trust limits and risks

- **Story unlock is spoofable.** The client reports story completion and the wallet signs that message. The server does not independently verify that the story was actually finished.
- **Aim and timing can be assisted.** The server reconstructs hits from the seed and the reported aim/time, rejects shots that are too fast, out of order, out of range, or later than the wall clock, and ignores extra shots after four clean hits. A modified client can still aim perfectly and pick favourable times within that window, because the seed is also needed to render the targets. This is a skill game, not a fully trusted client.
- **No escrow.** Players pay the house wallet directly and trust the operator to settle and pay out. If the house key is leaked, funds can be stolen. If the wallet is empty or RPC fails, payouts can sit in the log as `failed` and can be retried without double-paying once the issue is fixed.
- **RPC trust.** Payment checks and payouts depend on `SOLANA_RPC_URL`. Use a provider you trust.
- **Legal.** A real-money pot with a hidden forfeit may be treated as gambling in some places. The legal line is a notice, not legal advice. Check local laws before enabling live payments.

## Render deployment

`render.yaml` describes the existing static site and a `gtl-leaderboard` Node web service, both built from `main`. Auto-deploy stays off, so releases are triggered explicitly after a review.

To go live with a persistent board:

1. Merge this work and manually deploy (or create) the `gtl-leaderboard` web service from `render.yaml`. It uses Node 24.22.1 and `node --experimental-strip-types server/index.ts`.
2. Create a Postgres database (Render Postgres, or a free Neon database) and set `DATABASE_URL` on that service. Leave it unset only if you are okay with scores resetting whenever the service restarts or sleeps.
3. Confirm `CORS_ORIGIN` is `https://grand-theft-liquidity.onrender.com` (add a custom domain later if you attach one, comma-separated).
4. After the API has a public URL, set `VITE_LEADERBOARD_API` on the static site to that origin, with no trailing slash (for example `https://gtl-leaderboard.onrender.com`).
5. Manually deploy the static site so the client build bakes in the API URL. Then use Manual Deploy on both services after later changes.

Until step 4–5 are done, the game stays playable and the board panel will say it is not live. Render's free web service may spin down when idle; the first request after a sleep can be slow.

The static site still installs the locked dependencies, runs the tests and TypeScript check, then publishes `dist/`.

The Render CLI equivalent is:

```sh
render services create --name grand-theft-liquidity --type static_site --repo https://github.com/water-bear86/grand-theft-liquidity --branch main --build-command 'corepack pnpm install --frozen-lockfile --prod=false && corepack pnpm test && corepack pnpm build' --publish-directory dist --auto-deploy=false --confirm --output json
```

For subsequent releases, use `render deploys create SERVICE_ID --commit COMMIT_SHA --wait --confirm --output json` with the deployed service ID and reviewed commit.

## Assets

`public/assets/provenance.json` records the generated props and the supplied Alon, Cabbage, Cupsultan and Ansem-X models. `scripts/render_audio.py` reproduces the synthesized loops. `scripts/render_voices.mjs` is an optional offline asset-generation tool using a locally supplied `DEEPGRAM_API_KEY`. Deployment uses the committed clips. Original supplied character files are retained outside this repository.

`DESIGN.md` is the initial historical concept. This README describes the eleven-mission game.

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
