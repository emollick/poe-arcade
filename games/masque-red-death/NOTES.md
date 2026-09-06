# Seven Chambers — The Masque of the Red Death

**Tagline:** Run the masquerade through Poe's seven coloured chambers; when the ebony clock strikes, the revel freezes and the Red Death walks — slip past him to the next door before the last chime, twelve times.

**Tech:** three.js r160 (vendored, import map), first-person WebGL with EffectComposer + UnrealBloomPass + OutputPass, ACES tone mapping, FogExp2 re-tinted per chamber, all textures generated on canvas (leaded glass, corpse mask, blood-dabbled shroud, clock dial), all sound synthesised through Web Audio via `createAudio()` (off-key detuned waltz, footsteps, inharmonic struck bell, his steps).

**Controls**
- Desktop: `←` `→` or `A` `D` sidestep · `W` hurry, `S` hang back · `Space` dash (short, 1.35 s cooldown) · `Enter`/`Space` start and restart.
- Touch: hold the left or right half of the screen to sidestep · double-tap to dash · tap to start/restart. Portrait works (corridor is narrowed to 7 units, wider FOV); landscape is not required.

**The look:** velvet black `#07040a` and blood scarlet `#ff1f1f`. Every other colour is one chamber's single hue (blue, purple, green, orange, white, violet, then the black chamber with scarlet panes). Type: Cinzel Decorative (titles), Cinzel (labels), Cormorant Garamond (body).

**Rules of the run**
- Score: +100 per chamber, +25 × streak for each near-miss (passing a reveler within 1.75 units without touching), +150 × stroke for brushing the Red Death's shroud and living, +300 × stroke for each stroke survived, +1000 at midnight.
- Brushing a reveler costs a fifth of your grace, halves your speed and knocks you sideways; grace regenerates and caps your top speed.
- Stroke *k* rings 2 + *k* chimes; he walks faster and tracks you harder every time. First stroke around ten seconds in, then every ~13 s.
- Win: survive twelve strokes. Lose: he touches you, or the last chime finds you still in his chamber.
- Best score is persisted under `poe:masque-red-death:best` and shown on the title screen.

**Debug hook** (`window.__poe`, used by `playtest.mjs`): `mode`, `run`, `player`, `strike`, `start()`, `setStrikes(n)`, `strikeNow()`, `setMaxDt(s)`, `godmode`, `setInput({left,right,up,down})`, `setX(x)`.

**Known limits**
- The glass floor "reflection" is mirrored geometry beneath a translucent floor (windows, revelers, the Red Death), not a true planar reflection. Reveler reflections are skipped on phones.
- Phones render at DPR 1 with one point light per chamber and lighter bloom; there are seven chambers always in the scene, so a very old phone may drop below 60 fps.
- Rooms are recycled seven ahead, so the enfilade is endless but the seven-colour order never varies (as Poe ordered it).
