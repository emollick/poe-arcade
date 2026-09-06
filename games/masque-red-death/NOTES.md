# Seven Chambers — The Masque of the Red Death

**Tagline:** Run the masquerade through Poe's seven coloured chambers; when the ebony clock strikes, the revel freezes and the Red Death walks — slip past him to the next door before the last chime, twelve times.

**Tech:** three.js r160 (vendored, import map), first-person WebGL with EffectComposer + UnrealBloomPass + OutputPass, ACES tone mapping, FogExp2 re-tinted per chamber, all textures generated on canvas (leaded glass, corpse mask, blood-dabbled shroud, clock dial), all sound synthesised through Web Audio via `createAudio()` (off-key detuned waltz, footsteps, inharmonic struck bell, his steps).

**Controls**
- Desktop: `←` `→` or `A` `D` sidestep · `W` hurry, `S` hang back · `Space` sidestep-dash (22 u/s for 0.28 s in the held direction, or the last direction held; 1.35 s cooldown) · `Enter`/`Space` start and restart.
- Touch: hold the left or right half of the screen to sidestep · double-tap to dash toward the tapped side · tap to start/restart. Portrait works (corridor is narrowed to 7 units, wider FOV); landscape is not required.

**The look:** velvet black `#07040a` and blood scarlet `#ff1f1f`. Every other colour is one chamber's single hue (blue, purple, green, orange, white, violet, then the black chamber with scarlet panes). Type: Cinzel Decorative (titles), Cinzel (labels), Cormorant Garamond (body).

**Rules of the run**
- Score: +100 per chamber, +25 × streak for each near-miss (passing a reveler within 1.75 units without touching), +150 × stroke for brushing the Red Death's shroud and living, +300 × stroke for each stroke survived, +1000 at midnight.
- Brushing a reveler costs a fifth of your grace, halves your speed and knocks you sideways; grace regenerates and caps your top speed.
- Stroke *k* rings 2 + *k* chimes; he walks at 4.2 + 0.5k and follows you sideways at 1.2 + 0.5k (phone: 3.6 + 0.5k and 1.0 + 0.42k) against your 7.5 strafe, so from about stroke VI a plain cut-back no longer clears him and the sidestep is the move. First stroke about ten seconds after you enter, then every ~13 s.
- Because he tracks you, the dash is sideways, not forward: running for the door drives you into him. The title how-to says so.
- Win: survive twelve strokes. Lose: he touches you, or the last chime finds you still in his chamber.
- Best score is persisted under `poe:masque-red-death:best` and shown on the title screen.

**Debug hook** (`window.__poe`, used by `playtest.mjs` and `bot.mjs`): `mode`, `run`, `player`, `strike`, `rd`, `time`, `start()`, `abort()`, `setStrikes(n)`, `respawn()`, `strikeNow()`, `setMaxDt(s)`, `step(dt)` (advance the simulation without rendering), `godmode`, `setInput({left,right,up,down})`, `setX(x)`, `dash()`, `revelers()`, `setResolution(s)`.

**Tuning bot** (`node games/masque-red-death/bot.mjs [--phone] [--trials N] [--runs N] [--trace k --who reader]`, from the repo root): drives the game headlessly through `step(dt)` with three human-ish players (200 ms reaction, ~60 ms decision cadence, ±80 ms timing scatter): a *hugger* who runs to the far wall and stays, a *reader* who goes to the wall and cuts back across him when he looms (no sidestep), and a *stepper* who waits mid-lane and sidesteps at a quarter second to contact. Survival per stroke (that stroke alone, k−1 already survived) and full-run outcomes, desktop / phone:

| stroke | hugger | reader | stepper |
|---|---|---|---|
| I | 100% / 30% | 96% / 95% | 92% / 100% |
| II | 71% / 10% | 96% / 100% | 79% / 100% |
| III | 58% / 10% | 100% / 100% | 96% / 95% |
| IV | 33% / 20% | 100% / 100% | 96% / 100% |
| V | 8% / 0% | 79% / 85% | 92% / 95% |
| VI | 0% / 5% | 58% / 25% | 92% / 85% |
| VII | 4% / 0% | 33% / 15% | 92% / 95% |
| VIII | 13% / 0% | 8% / 0% | 83% / 100% |
| IX–XII | 0% | 0% | 83–100% / 90–95% |

Full runs: the hugger dies by stroke II–III, the reader reaches V–VII and never midnight, the stepper reaches midnight in 33% (desktop) / 25% (phone) of runs with a median of 6–7 strokes. So I–IV are survivable by reading him, VI+ demands the sidestep, and twelve is hard but reachable.

**Known limits**
- The glass floor "reflection" is mirrored geometry beneath a translucent floor (windows, revelers, the Red Death), not a true planar reflection. Reveler reflections are skipped on phones.
- Phones render at the real device pixel ratio (capped at 2, antialias off) at 3/4 resolution during the run and full resolution on the title and end screens, with one point light per chamber and lighter bloom; there are seven chambers always in the scene, so a very old phone may drop below 60 fps.
- Chamber walls carry one generated greyscale texture (panelled dado, rail, damask striping, lozenge frieze) multiplied by the chamber's hue; the end wall shares it in world units.
- Rooms are recycled seven ahead, so the enfilade is endless but the seven-colour order never varies (as Poe ordered it).

**Polish pass (playtest review)**
- Fixed: `resetRun()` set `nextStrike` to an absolute 8 s while the game clock runs from page load, so any run started after 8 s got its first stroke at the first door (~1.5 s in). Timers in reset are now relative to `time`. Also `danceFrozen` was never cleared, so a death mid-stroke left the revel frozen for the next run.
- Dash is a sidestep; tracking ramp re-tuned with the bot above; how-to gained the line that he follows you.
- Win title split onto two spans (`clamp(32px, 5.2vw, 76px)`, `max-width: 12ch`); the redundant `.fine` line under the title is gone.
- `playtest.mjs` shoots the play frames at stroke II with the Red Death inside five units, stepping the simulation deterministically.
