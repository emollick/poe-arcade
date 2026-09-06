# The Descending Blade

**Tagline:** Survive the Inquisition's cell — hop the rats, time the blade, shun the pit — until Lasalle's trumpets sound.

**Tech:** Matter.js 0.19 rigid bodies (blade on a real pivot constraint, kinematic iron walls that really push, rat bodies, a stable no-rotation prisoner), drawn entirely by hand on a 2D canvas in torch-lit chiaroscuro; all sound synthesized through Web Audio via `createAudio()`.

## Controls
- Desktop: `←` `→` or `A` `D` walk, `Space` / `W` / `↑` hop. `Enter`/`Space` starts, `R` restarts mid-run.
- Touch: left and right thirds of the screen walk, the middle third (or a swipe up anywhere) hops. Portrait phone is the native layout (the arena narrows to 660 world units).

## The look
- Torch rust `#c4561c` (with its highlight `#f0a05a`) against iron `#4a4b4f`; everything else is black, bone `#e6dcc6`, and the ember red `#ff3d1c` reserved for the demons on the walls as they heat.
- Type: UnifrakturMaguntia (title, end titles), Old Standard TT (body, floaties), Pirata One (HUD numerals, buttons).

## How it escalates
- The blade is hung from a pivot on a length-290 constraint and pumped to a target amplitude that widens with time (Poe: "the sweep of the pendulum had increased in extent") and narrows as the walls close. Every centre pass drops the pivot 3.4 units (capped at 205 so the last ten seconds stay beatable: standing beneath the swing is lethal only from ~66s).
- Walls creep from 8s and surge at 18s, 32s, 46s and 60s (each telegraphed by a one-second flare and rising groan). Touching a hot wall costs 10 points and shoves toward the pit.
- Rat waves every 4–8s, growing from 3 to 9, alternating sides and later from both. Hopping one is +2; a bite is −2 and a nudge.
- Score = seconds survived + 5 per hair's-breadth pass (blade edge within 26 units of the head at speed, with a heartbeat and a slow-motion beat) + 2 per rat hopped − penalties, +50 on the trumpet at 72s.
- Best is saved under `poe:pit-and-pendulum:best` and shown on the title.

## Ends
- Sliced: one physics step after contact the blade goes static; the frame cuts to black with only the honed edge — "Down—steadily down it crept."
- Pit: the camera follows him down the shaft as the walls recede above — "the pit, whose horrors had been destined for so bold a recusant as myself".
- Trumpets: fanfare, the blade brakes, the walls groan back, daylight opens from above and Lasalle's arm lifts him out — "An outstretched arm caught my own as I fell, fainting, into the abyss. It was that of General Lasalle."

## Debug / playtest
`window.__poe` exposes `state`, `time`, `score`, `stats`, `man`, `blade`, `walls`, `rats`, `start()`, `title()`, `setInvincible(bool)` and `fastForward(seconds)` (advances the clock and sinks the pivot without simulating). `node games/pit-and-pendulum/playtest.mjs` from the repo root plays through both lose states and the win and writes the screenshots.

## Known limits
- The Matter constraint is a stiff spring, not a rigid rod: under the heaviest braking the rod reads ±5 units. The crescent is held square to the rod each step (`Body.setAngle(-θ)`), so it never spins on its yoke.
- On phones the film grain is skipped and rat count is capped at 12 (20 on desktop).
- Rats never reach the blade's height, so they are never sliced — the blade only kills the prisoner.
- Reduced motion: no screen shake, no slow-motion beat, steady torch, no grain.
