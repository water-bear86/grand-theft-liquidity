# Grand Theft Liquidity Game Design Draft

**Design draft · 18 November 2026 · One afternoon to a playable build**

You sprint across a sunburnt coastal town, perform six increasingly stupid public tasks to pump a fictional meme coin, dodge furious buyers, and cash out into an embarrassingly long fake-X defence of your actions.

The game is **Grand Theft Liquidity**. The player becomes **the Slopmeister**. The aim is one funny, shareable ten-second moment inside a complete, replayable run.

# Selected direction

The player is **you**, represented by a simple self-insert character rather than a named protagonist. Play is on foot, fast and exaggerated, with big airtime and a close camera behind the character. A hype blast attracts attention. Colliding with scenery costs speed and breaks the combo.

The world is a bright, low-poly beachfront strip with palms, motels, and a club under a giant glowing coin sign. Tony Hawk is the reference for movement energy, readable routes, and coastal attitude; the prototype still uses an on-foot character. Humour comes from environmental details, dialogue, and the stupid things you actually do.

Each run starts with a randomly named fictional coin already pumping. The market is entirely simulated. Bigger stupidity makes more money; boring play and lost momentum cause the painful dumps. The phone carries the chart and increasingly ridiculous messages. Angry buyers supply the threat.

**Scope:** one small 3D level, one route, six tasks, one main loop, one afternoon. The recommended platform is a desktop browser. The mechanics, task scripts, numbers, and cuts below are proposals for review, not additional decisions already made by the user.

# Core loop

**Run to the next task → choose the most ridiculous response → perform it in the world → coin pumps and buyers get angrier → keep moving or cash out.**

The central rule is **“more stupid, more bucks.”** Skill keeps you moving and alive; the most humiliating choice earns the biggest reward. The choices should be funny even when the best-paying answer is obvious.

Keep forward movement fast between tasks. A brief task choice pauses the simulation so reading a joke does not lose money. On selection, play resumes and the player performs a small action in the scene. Selecting an answer alone should not be the whole spectacle.

# Run structure and endings

| Situation | Proposed rule |
| --- | --- |
| Start | Spawn on the motel strip with a fresh coin name, an already-rising chart, and the first task visible. No character creator or launch wizard. |
| Cross-town race | The route runs from the motel to the club. Urgency comes from hype decay and angry buyers; there is no countdown and no separate racing opponent. |
| Six tasks | All six are required for the full route completion. They unlock in order. Cashing out early abandons the remaining tasks. |
| Early cash-out | Once the minimum bag value is reached, cash out anywhere. This ends the run with an early-exit result and the fake-X defence. It does not earn the Slopmeister title. |
| Full completion | Finish task six at the club to become the Slopmeister. This pauses for a short victory beat, then offers Cash out or Keep risking it. Completion does not silently bank money. |
| Failure | Buyer capture or a fully collapsed bag ends the run and loses its unbanked gains. A failure result offers an immediate retry. |
| Progress | Every run starts with equal abilities and resources. Resolve the high-score/persistence tension by keeping a personal best only for the current page session; no permanent upgrades or saves. |

**Scope reconciliation:** “cross-town race” and “no timer” become an untimed escape route under market pressure. “Cash out anywhere” and “six tasks” become two distinct outcomes: leave early, or complete the mission and earn the title. These are recommended resolutions, not hidden changes to the answers.

# Six proposed tasks

These are draft jokes for review. All six use one reusable structure: enter a task zone, read three short options, select one, perform the station’s simple action, then receive its prop effect, payout, and phone reaction. Choices alter the gag and reward without creating eighteen separate minigames.

Use three shared completion actions: **interact**, **jump through a marked space**, and **hype blast inside a marked space**. The visual result should remain visible during the run where practical.

| Stop | Task and ridiculous choice | Small physical payoff |
| --- | --- | --- |
| 1. Motel forecourt | Get noticed: film a stunt / rage-bait tourists / **cover yourself in peanut butter**. | Interact beside the jar; the character turns sticky brown, a jar appears in hand, and phones light up. “WHITEPAPER UPDATED: CRUNCHY.” |
| 2. Boardwalk | Establish leadership: announce a roadmap / appoint an influencer / **declare a seagull your CEO**. | Pick up the gull mascot and hype-blast its tiny press conference. “CEO HAS STOLEN A CHIP.” |
| 3. Service alley | Reveal the utility: explain the product / unveil merch / **wear a bin and call yourself the infrastructure**. | Attach a bin costume and jump through a marked opening. The costume is visual; collision remains simple. |
| 4. Promenade | Address concerns: publish accounts / host an AMA / **apologise to a peanut-butter jar for having weak hands**. | Interact at the jar’s podium while a few spectators film. A confession floods the phone. |
| 5. Club queue | Secure a partnership: pay a promoter / promise an airdrop / **conduct a board meeting with an inflatable banana**. | Hype-blast beside the banana and spectators. “STRATEGIC PARTNERSHIP CONFIRMED. NO QUESTIONS.” |
| 6. Club coin sign | Deliver the finale: thank the community / promise more utility / **crown yourself the Slopmeister in front of your angry buyers**. | Reach the final mark and fire the hype blast; a crown attaches, the sign celebrates, and the phone erupts. |

The six-stop route should still work if the wording or props change. Preserve the peanut-butter task and the Slopmeister finale as the strongest anchors. Do not require bespoke cinematics, mocap, a rigged seagull, costume physics, or unique gameplay systems for these gags.

# Movement and pressure

| Control | Proposed binding |
| --- | --- |
| Move | WASD |
| Look | Mouse, with a close third-person camera |
| Jump | Space; generous airtime and forgiving landings |
| Interact | E near a marked task |
| Hype blast | Q; visible cooldown |
| Cash out | C once eligible, with a short confirmation to avoid an accidental ending |
| Pause | Escape; browser focus loss pauses too |

Prioritise a responsive character and a camera that stays outside walls. Basic jumping is part of movement; the hype blast is the one special ability. Avoid ledge grabbing, grinding, climbing, vehicles, and a full stunt-animation system in this build.

**Proposed buyer behaviour:** loud actions raise a visible heat value. Introduce one angry buyer, then at most two more as heat rises. They follow the authored route through clear lanes, using simple chase behaviour rather than city-wide navigation. A buyer hit slows the player, breaks the combo, and adds a strike; three strikes mean capture. A short contact cooldown prevents a single overlap from causing instant failure.

Show all requested population types with one shared character style: stationary filmers, sign-carrying shillers, and angry holders, plus a few parked vehicles and props. Only the angry buyers need active pursuit.

# Market rules

Keep one understandable simulated **bag value** behind the chart. This is fictional money, not a tradable token or a claim about real markets. Coin names change between runs; difficulty and rewards do not.

**Proposed starting tuning, to adjust after playing:**

- Start at 500 fictional bucks; cash-out eligibility begins at 1,000.

- Each task pays 100, 250, or 500 before multipliers. The most absurd choice gets the highest reward.

- A short chain of meaningful actions raises a combo from ×1 to a maximum of ×4. Scenery collisions reset it to ×1.

- After four seconds without a meaningful action, the combo expires and the bag loses 50 bucks per second. Hitting zero is a market-collapse failure.

- Meaningful actions are task completions, first-time marked jumps, and hype blasts at fresh spectator spots. Repeating a safe jump or shouting at the same crowd cannot farm the chart indefinitely.

- Include one pickup type: a temporary ×2 hype multiplier lasting eight seconds. A fresh pickup refreshes duration; it does not stack the multiplier.

- Hype blast has a proposed eight-second cooldown. It attracts attention and raises heat; it is not a combat weapon.

Freeze these timers in task menus, pause, and result screens. Only a completed task awards its payout, once. The same inputs and events should produce inspectable results; no external price feed or runtime AI is needed.

# Phone and cash-out defence

The compact phone shows the coin name, current bag value, chart, task count, and cash-out eligibility. Keep heat, capture strikes, and ability cooldown easy to see without expanding the phone. Use authored notifications tied to game events, with a small visible queue so bursts do not cover the action.

A cash-out ends in a screenshot-friendly card: coin name, banked value, tasks completed, ending label, and the player in their accumulated ridiculous outfit. Put the **lengthy fake-X defence below that card**, so it remains part of the joke without spoiling the screenshot.

Proposed implementation: an authored 250–400-word thread assembled from templates using the actual coin name, task choices, amount, and whether the player left early. No live posting, X account connection, or generated text service. The thread should defensively reinterpret the player’s actual behaviour.

**Example voice for the defence**

> First, I want to address the completely false narrative that I “covered myself in peanut butter, appointed a bird CEO, and left.” Each of those decisions was communicated through the appropriate channels. The channels were mostly people filming me outside a motel.
>
> The sale was a personal liquidity event. It has absolutely no bearing on the long-term fundamentals of the banana partnership. The seagull remains fully aligned, subject to its ongoing chip acquisition strategy.
>
> I understand that some community members have concerns. Chasing the founder down the promenade is not the governance process we outlined. Please allow the team time to build.

The finished thread should be longer than this excerpt, with a concise headline and several replies or sections. Failure gets its own shorter reaction; it must not claim money was successfully banked.

# Art and audio

Use bright low-poly coastal shapes, readable ramps, saturated signage, palms, motel colours, and a glowing club landmark. The Tony Hawk reference guides energy and environment readability; use original characters, textures, signage, and music.

**Selected asset preference:** use Higgsfield to generate most objects. **Proposed afternoon interpretation:** generate a small reusable kit, then repeat those objects throughout a simple authored level. The kit is a palm, parked car, peanut-butter jar, gull mascot, bin, and inflatable banana. Roads, collision geometry, building shells, the crown, and readable sign text remain simple authored geometry or UI. A basic articulated avatar avoids making a new character rig the critical path.

The connected Higgsfield catalog exposes text-to-3D and image-to-GLB routes. A usable game asset still needs inspection for scale, orientation, materials, face count, and loading cost. Generation turnaround and cleanup have not been measured for this project. Confirm the generation quote before submitting jobs; no generation was started for this document.

The preference to generate most objects is not silently dropped if time runs out. The fallback requiring approval is a smaller generated kit mixed with intentionally styled simple geometry. Keep collision independent of decorative meshes so asset swaps do not change gameplay.

**Audio proposal:** a few short effects for jump, impact, hype, pump, dump, and notification. Add one available, appropriately licensed or generated loop only if ready in time. No voiced dialogue, radio system, or bespoke soundtrack dependency.

# Afternoon scope and cuts

**Protect these must-haves:**

1. Responsive on-foot movement, jumping, and a working close chase camera.

2. One connected motel-to-club route with six complete task encounters.

3. The peanut-butter gag and the Slopmeister finale visibly happening in 3D.

4. A simulated bag, phone chart, hype blast, combo, boredom decay, and one pickup type.

5. A minimal angry-buyer threat, working failure, and immediate restart.

6. Early cash-out and full-route outcomes, a clean result card, and the fake-X defence.

**Proposed cut order:** extra background population and parked-car variety; extra generated prop variants; music; elaborate particles and secondary animation. If pursuit is too costly, reduce to one clearly telegraphed buyer. If market tuning is too costly, simplify combo arithmetic before removing the link between stupidity and price. Retain all six task beats, but keep their actions shared.

**Outside this afternoon:** live tokens, wallet connections, real trades, backend economy, accounts, multiplayer, driving, combat, ragdolls, traffic simulation, a large open world, branching story, persistent progression, automatic video capture, and social posting.

The preferred next session is more authored missions, characters, and story.

# Proposed build plan

Use **four hours as a planning budget for an afternoon**, subject to the working environment and asset availability. This is a timebox, not a delivery guarantee. Generated-asset waiting time can exceed it. Start asset work after its quote and scope are approved, and keep it separate from the critical gameplay path.

| Timebox | Deliverable and checkpoint |
| --- | --- |
| 0–20 minutes | Confirm the minimal project setup and asset quote. Lay out the route and one task zone. Check that the game loads locally. |
| 20–75 minutes | Build movement, camera, jump, collisions, and the full traversable route. If moving around is not enjoyable, spend the next slice here and cut dressing. |
| 75–135 minutes | Finish the shared task interaction and all six task records. Add bag value, hype blast, boredom, and cash-out. The complete mission must be playable now. |
| 135–185 minutes | Add the minimum buyer threat, phone reactions, failure/restart, result card, and defence thread. Integrate ready assets with a strict import-and-check budget. |
| 185–240 minutes | Tune and fix a complete run. Prioritise the peanut-butter sequence and Slopmeister reveal. Check the ten-second clip, text readability, restart, and loading/failure states. |

**Polish priority proposed for the unanswered question:** make the peanut-butter-to-phone-pump moment funny and immediately legible, while keeping movement and camera competent enough to enjoy reaching it. A beautiful street without that interaction does not pass.

# Proposed implementation files

The user approved implementation on 18 November 2026. The local prototype now exists under `/Users/angusdurrie/Development/codex/2026-11-18/rif/work/grand-theft-liquidity`. The file plan below records the intended module boundaries; the implemented version also includes Rapier for character collision, an isolated pnpm workspace, and seven game-rule tests.

Prefer plain TypeScript, Vite, and Three.js for this small browser build. Separate gameplay state from rendering, use simple collision shapes, and use native DOM UI for the phone, choices, and ending. Avoid a backend, physics dependency, or generic game framework unless inspection exposes a concrete need.

| Create | Purpose |
| --- | --- |
| `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `index.html` | Minimal dependencies, locked versions, typing, and page entry. |
| `src/main.ts` | Startup, asset loading, update/render loop, pause, restart, and cleanup. |
| `src/world.ts` | One route, decorative instances, lighting, task markers, and simple collision shapes. |
| `src/player.ts` | Input, movement, jump, follow camera, collisions, and cosmetic attachments. |
| `src/game.ts` | Serializable run state, market rules, task completion, heat, buyer threat, endings, and session best. |
| `src/content.ts` | Six task records, choices, coin-name parts, notifications, and defence-thread text. |
| `src/ui.ts`, `src/styles.css` | Phone, task choices, minimal status, pause, result card, and defence thread. |
| `src/assets.ts` | Explicit asset manifest, scale/orientation settings, and fallback mapping. |
| `public/assets/palm.glb`, `parked-car.glb`, `peanut-butter-jar.glb`, `gull.glb`, `bin.glb`, `banana.glb` | Intended reusable generated kit; actual imports depend on completed, inspected outputs. |
| `public/assets/provenance.json` | Asset origin, generation reference or license, and any relevant usage restrictions. |

No existing project files are planned for modification or removal. Before coding, verify dependency versions and the final asset outputs, refine this list if necessary, and obtain explicit approval under the supplied AGENTS instructions.

# Risks and decisions still open

| Tension | Proposed resolution |
| --- | --- |
| Six tasks versus one afternoon | Six authored records sharing one interaction system and three simple action types. No six bespoke minigames. |
| Higgsfield for most objects versus a hard timebox | Reuse a small kit extensively. Approve the budget and a simple-geometry fallback before generation. Do not promise unverified completion times. |
| All NPC types versus implementation cost | Reuse one character style. Static spectators and shillers; only buyers chase. |
| Big airtime versus a close camera | Keep streets open, use generous camera clearance, and test landings and walls early. |
| No persistent progress versus keeping a best | Session-only best with equal starting conditions. |
| Run without a timer versus boredom pressure | No countdown. Decay is a gameplay pressure that pauses during reading and focus loss. |
| Asset model generation versus a usable character | Use a simple avatar first; character rigging is a separate scope decision. |

Still open for approval: the six draft task scripts; numerical tuning and capture rules; desktop-browser platform and proposed controls; session-only best; the asset quote/fallback; minimal audio; and the proposed polish/cut order. The Slopmeister identity is selected; requiring all six tasks before awarding it is the recommended completion rule.

# Acceptance checks

- **The ten-second test:** a screen recording of the peanut-butter action, visible price jump, and absurd phone reactions is funny without narration.

- **The complete-run test:** all six tasks can be completed in order, the Slopmeister reveal works, and the player can then cash out.

- **The early-exit test:** cash-out is unavailable below the target, works above it, ends the run once, and clearly records incomplete tasks.

- **The failure test:** capture and market collapse lose the current bag; retry resets coin, tasks, heat, strikes, multipliers, props, and UI consistently.

- **The fairness test:** menus and focus loss pause pressure; a single buyer overlap cannot inflict three instant hits; scenery collisions slow the player and break the combo without ending the run by themselves.

- **The scoring test:** tasks cannot pay twice, old crowd spots cannot be farmed, the pickup cannot stack without limit, and cash-out cannot also be processed as failure.

- **The presentation test:** phone text is readable on the target desktop viewport, bursts do not obscure the character, the camera avoids clipping, and the result card is clean enough to screenshot.

- **The asset test:** every included asset loads at the intended scale and orientation; a missing asset produces a deliberate fallback or clear load error. Record performance on the actual test machine rather than claiming an unmeasured frame rate.

**Prototype status · 18 November 2026:** the local desktop-browser build is implemented. It includes the complete six-task route, on-foot movement and jumping, hype blast, simulated market, angry buyers, early cash-out, Slopmeister ending, authored fake-X defence, and downloadable result card. Five Higgsfield GLB props were generated and integrated; the banana uses authored geometry after its generation was rejected by the provider’s daily limit. DeepSeek was attempted twice, but its local Harness failed during startup before accepting a task, so it contributed no code.

**Validation:** the TypeScript/Vite build and seven game-rule tests pass. Chromium browser testing covered task choices, endings, result-card download, pause, restart, and a narrow viewport. A separate full playthrough reached all six tasks using keyboard movement without teleporting or changing game state. This is a local prototype; no public publication, deployment, real token activity, or social posting was performed.

