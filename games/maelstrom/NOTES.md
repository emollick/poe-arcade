# The Vortex

**Tagline:** You are in the water on the wall of the Maelström; lash yourself to what rises, let go of what plunges, and outlast the tide.

**Tech:** raw WebGL2, no libraries — 300k particles positioned entirely in the vertex shader from a per-particle seed and vortex time (funnel radius, angle, depth, spiral foam bands, moonlight rays), additive point sprites drawn twice with a time offset for the motion streak; a ray-marched-free full-screen sky/moon shader; instanced SDF glyph quads for the player, objects and wreckage; multiply-blended vignette; all sound synthesized in Web Audio (filtered pink-noise roar with a resonant peak that rises with the whirl, a whistling band, sub drone, splash/thud transients, silence and a swell at the slack).

**Controls**
- Desktop: `←` `→` / `A` `D` swim around the wall · `↑` / `W` climb outward (costs breath) · `Space` lash to / let go of the nearest object · `Enter` start / again · `M` mute.
- Touch: drag sideways to swim, drag up to climb, tap to lash; plus on-screen `‹ ↑ ›` and a big `lash` button.

**Rules:** you drift inward, faster the deeper you are, and the whirl accelerates over 60 s. Casks and spars (cylinders) lift you; buoys, chests, hull fragments and the smack plunge, the biggest fastest. Cylinders are torn away after 9–15 s. Spinning wreckage sweeps down the wall — dodge it for a streak bonus; a hit stuns you and tears you loose. Survive 80 s: the funnel flattens for the last ten, the moon comes out, you are thrown to the surface. Score: 10/s, x3 while lashed to a cylinder, +100 per dodge (+50 per streak step).

**Palette:** `#020509` black water · `#f2cf7a` moon gold (with `#7ef0c8` phosphorescent foam as the secondary).

**Type:** Playfair Display italic 700 (title along the far rim, scores), Spectral 300/500 (body, HUD).

**Debug hook:** `window.__poe` — `start()`, `fastForward(seconds)`, `setFF(mult)`, `win()`, `kill()`, `lash()`, `state`. `?q=full|phone` forces the particle tier (used by `playtest.mjs` under SwiftShader).

**Known limits**
- Under software GL (SwiftShader/llvmpipe) the tier drops to 24k particles and the frame budget adapts further; the title still renders but the whirl is sparse.
- The moon and its rays are fixed relative to the camera (the camera orbits with the player, so a world-fixed moon would sweep the sky every rotation).
- The title-on-the-rim text needs the projected arc to fit the viewport; on unusual aspect ratios it falls back to a stacked title.
