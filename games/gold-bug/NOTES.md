# The Gold-Bug — Kidd’s Cipher

**Tagline:** Break Captain Kidd’s cipher and read the map before the rival with the spade finds the tree.

**Tech (one line):** a real monoalphabetic substitution engine with live frequency analysis as the mechanic (round 3 is Poe’s actual ciphertext and symbol table, verified to encode byte-for-byte), on a procedurally weathered parchment canvas (layered value noise, tea stains, foxing, creases, a noise-masked scorched edge with a live ember layer), a self-drawing SVG treasure map, and fully synthesized Web Audio.

## Controls
- **Desktop:** click a mark (in the text or in the frequency chart) then type its letter. `Backspace` clears, `Esc` deselects, `←`/`→`/`Tab` move between marks by frequency, `Space`/`Enter` jump to the next unsolved mark. Typing with nothing selected fills the most frequent unsolved mark. `1` Legrand’s hint, `2` Legrand’s lens (dims every other mark), `3` sound. `Enter` starts / restarts.
- **Touch:** tap a mark, then tap a letter on the strip (or tap a letter first, then the mark). The cipher panel scrolls vertically on long rounds. Interludes advance on tap.

## The look
- Iron-gall ink **#3b2314** on tea-brown parchment **#d8bb8c**; the bug’s gold **#d4a017** is the single accent; plaintext is written in sanguine #8a3319.
- Type: IM Fell English / IM Fell English SC for passage and headings, Special Elite for the marks. Special Elite has no `‡`, so Kidd’s double dagger is set as `†` with a second bar drawn in CSS.

## Rules
- Three rounds, each with a fresh random alphabet (round 3 always uses Kidd’s real table): 42 / 62 / 95 seconds of rival-walking per round; each decoded key word draws a landmark on the map and pushes him back 5–7 s. A wrong letter bleeds on the page, resets the streak and costs the rival one stride (1.2 s). Stuck 25 s → Legrand lays a finger on a mark (−100). Score = 50 + 10×streak per unaided letter, +100 per landmark, +10 per second to spare at the end of a round.
- Best score persists in `poe:gold-bug:best` and shows on the title.

## Known limits
- Poe’s message reads “twenty-one degrees” (the ciphertext `;]8*;:‡*8` decodes to TWENTYONE); the brief said “forty-one”, the game follows the ciphertext. Kidd’s message is shown with word divisions (as Legrand divides it), apostrophes and hyphens dropped.
- Round 2’s text is Legrand’s account of the skull and the kid in paraphrase; round 1 (Poe’s island sentence, trimmed), round 3 and the win quotation are verbatim. The lose line quotes “We dug very steadily for two hours.” and finishes in the story’s voice.
- Returning players who remember Kidd’s table will clear round 3 fast; the score (time-based) rewards that on purpose.
- `playtest.mjs` reaches the win by entering every substitution through the UI; only the loss uses the `window.__poe.rush()` hook to hurry the rival.
