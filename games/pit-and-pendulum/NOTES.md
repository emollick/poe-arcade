# The Descending Blade

**Tagline:** Survive the Inquisition's cell — hop the rats, time the blade, shun the pit — until Lasalle's trumpets sound.

**Tech:** Matter.js 0.19 rigid bodies (blade on a real pivot constraint, kinematic iron walls that really push, rat bodies, a stable no-rotation prisoner), drawn entirely by hand on a 2D canvas in torch-lit chiaroscuro; all sound synthesized through Web Audio via `createAudio()`.

## Controls
- Desktop: `←` `→` or `A` `D` walk, `Space` / `W` / `↑` hop. `Enter`/`Space` starts, `R` restarts mid-run.
- Touch: left and right thirds of the screen walk, the middle third (or a swipe up anywhere) hops. Portrait phone is the native layout (the arena narrows to 660 world units); the floor sits at 70% of the height, the chain climbs to the top edge, and the touch glyphs sit in the flagstone band below the floor.

## The look
- Torch rust `#c4561c` (with its highlight `#f0a05a`) against iron `#4a4b4f`; everything else is black, bone `#e6dcc6`, and the ember red `#ff3d1c` reserved for the demons on the walls as they heat.
- Type: UnifrakturMaguntia (title, end titles), Old Standard TT (body, floaties), Pirata One (HUD numerals, buttons).

## How it escalates
- The blade is hung from a pivot on a length-290 constraint and pumped to a target amplitude that widens with time (Poe: "the sweep of the pendulum had increased in extent") and narrows as the walls close. The pivot starts at 60 and every centre pass (every ~1.34s) drops it 3.4 units, capped at 190 (reached ~51s). Hopping under the crescent at the lip of the pit is lethal from ~25s, standing there from ~46s. Because the crescent hangs square to its rod, its outer wing rises toward the wall: at the deepest pivot the strip from ~135 to ~209 units off the centre is the only ground the edge clears, and it clears it by a hair.
- Walls creep from 4s (`0.45 · (t−4)/(72−4)`) and surge at 12s, 32s, 46s and 60s (each telegraphed by a one-second flare and rising groan). Touching a hot wall costs 4 points, staggers him for 0.12s and flings him toward the pit at 11 units/step (about 80–110 units). Once the iron is more than 60% lit its heat reaches out from the face — up to 35 units at full heat, drawn as a glowing strip of flagstones — and sears him without a touch, so hugging the wall stops being a refuge from about 40s.
- Rat waves from 3.5s and then every 4–6s (`5.0 − prog·2.3 + rand`), growing from 3 to 9, alternating sides and later from both. A rat running at the pit shoves him (one at a time, for 12 steps, then it scrambles through him); a rat running away from the pit only bites. Hopping one is +1; a bite is −2 and a nudge.
- Score = seconds survived + 10 per hair's-breadth pass (the true lowest point of the crescent over his head and shoulders within 26 units, at speed, with a heartbeat and a slow-motion beat) + 1 per rat hopped − penalties, +50 on the trumpet at 72s. The near-pass test walks the plates' vertices, not the body's bounds, so passes keep paying to the very end.
- Best is saved under `poe:pit-and-pendulum:best` and shown on the title.

## Measured (playtest bots, desktop 1440x900, uncontended)
- No input at all: shoved into the pit by the rat tide at ~21s (11–13s when the machine is busy and rat waves bunch).
- Ledge camper (hugs the wall at half−40, hops rats when the blade is >120 units away): seared and sliced at ~61s in three of four runs; the one win came under heavy CPU contention.
- Blade timer (stands at the innermost spot the whole swing clears, hops under while there is room for a hair's breadth at the apex, hops rats only when the swing leaves a window): wins, 276–296 points, 18–19 hair's-breadth passes.

## Ends
- Sliced: one physics step after contact the blade goes static; the frame cuts to black with only the honed edge — "Down—steadily down it crept."
- Pit: the camera follows him down for a moment, then the view turns and looks back up the shaft — a receding column of brick, the lit rectangle of the cell shrinking above, the crescent still swinging across it — "the pit, whose horrors had been destined for so bold a recusant as myself".
- Trumpets: fanfare, the blade brakes, the walls groan back, daylight opens from above and Lasalle's arm lifts him out — "An outstretched arm caught my own as I fell, fainting, into the abyss. It was that of General Lasalle."

## Debug / playtest
`window.__poe` exposes `state`, `time`, `score`, `stats`, `man`, `blade` (position, velocity, pivot depth, swing reach, live clearance over his head), `bladeShape` (the crescent's plates in its own frame, for bots that predict passes), `walls`, `rats`, `input`, `start()`, `title()`, `setInvincible(bool)` and `fastForward(seconds)` (advances the clock and sinks the pivot without simulating). `node games/pit-and-pendulum/playtest.mjs` from the repo root measures the three bots above, plays through both lose states and the win, and writes the screenshots (the poster frame `pit-and-pendulum-play.png` is shot at ~1:02 of the blade timer's run: walls hot, demons lit, blade low); `playtest.mjs measure [none|ledge|blade]` runs only the bots.

## Known limits
- The Matter constraint is a stiff spring, not a rigid rod: under the heaviest braking the rod reads ±5 units. The crescent is held square to the rod each step (`Body.setAngle(-θ)`), so it never spins on its yoke.
- On phones the film grain is skipped and rat count is capped at 12 (20 on desktop).
- Rats never reach the blade's height, so they are never sliced — the blade only kills the prisoner. Rats have a bone-pale belly stroke so they read against the flagstones.
- Reduced motion: no screen shake, no slow-motion beat, steady torch, no grain.
