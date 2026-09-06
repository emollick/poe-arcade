# The Vortex

**Tagline:** You are in the water on the wall of the Maelström; lash yourself to what rises, let go of what plunges, and outlast the tide.

**Tech:** raw WebGL2, no libraries — a full-screen funnel shader (each pixel's ray is unprojected, dropped onto the sea and marched down the analytic funnel surface; shaded as dark water falling into black with log-spiral foam bands turning with the rim, the moon's rays down the wall and a lighter rim; it cross-fades to a calm silver disc with the moon's path across it at the slack) drawn under 300k particles positioned entirely in the vertex shader from a per-particle seed and vortex time (funnel radius, angle, depth, the same spiral foam bands, moonlight rays), additive point sprites drawn twice with a time offset for the motion streak; a ray-marched-free full-screen sky/moon shader; instanced SDF glyph quads for the player, objects and wreckage; multiply-blended vignette; all sound synthesized in Web Audio (filtered pink-noise roar with a resonant peak that rises with the whirl, a whistling band, sub drone, splash/thud transients, silence and a swell at the slack).

**Controls**
- Desktop: `←` `→` / `A` `D` swim around the wall · `↑` / `W` climb outward (costs breath) · `Space` lash to / let go of the nearest object · `Enter` start / again · `M` mute.
- Touch: drag sideways to swim, drag up to climb, tap to lash; plus on-screen `‹ ↑ ›` and a big `lash` button.

**Rules:** you drift inward, faster the deeper you are, and the whirl accelerates over 60 s. Casks and spars (cylinders) lift you; buoys, chests, hull fragments and the smack plunge, the biggest fastest. Cylinders are torn away after 9–15 s. Spinning wreckage sweeps down the wall — dodge it for a streak bonus; a hit stuns you and tears you loose. Survive 80 s: the funnel flattens for the last ten into a silver disc, the moon comes out and lays its path across it, the particles settle into rings, you are thrown to the surface. Lose, and the camera falls into the throat and turns to look up at the rim closing overhead, the moon in the hole. Score: 10/s, x3 while lashed to a cylinder, +100 per dodge (+50 per streak step).

**Palette:** `#020509` black water · `#f2cf7a` moon gold (with `#7ef0c8` phosphorescent foam as the secondary).

**Type:** Playfair Display italic 700 (title along the far rim at 96px+ on desktop; stacked in two lines over the moon's reflection under 600px wide; scores), Spectral 300/500 (body, HUD). The start/again affordance is typography only — a hairline rule and spaced small caps.

**Debug hook:** `window.__poe` — `start()`, `fastForward(seconds)`, `setFF(mult)`, `win()`, `kill()`, `lash()`, `state`. `?q=full|phone` forces the particle tier (used by `playtest.mjs` under SwiftShader).

**Known limits**
- Under software GL (SwiftShader/llvmpipe) the tier drops to 24k particles and the frame budget adapts further; the funnel shader carries the composition at that tier, the particles are sparkle on top. `playtest.mjs` shoots everything at `?q=full` (and writes the play frame as `-desktop`/`-mobile` too) so the delivered frames show the full tier; `verify.mjs` still runs at the software tier.
- The moon and its rays are fixed relative to the camera (the camera orbits with the player, so a world-fixed moon would sweep the sky every rotation).
- The title-on-the-rim text needs the projected arc to fit the viewport; on unusual aspect ratios, and always under 600px wide, it falls back to the stacked title.
