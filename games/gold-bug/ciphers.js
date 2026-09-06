/* The Gold-Bug — ciphers.js
 * A real monoalphabetic substitution engine plus the three rounds.
 * Round 3 is Captain Kidd's actual cipher with Poe's actual symbol table.
 */

/* Poe's own table, from Legrand's solution ("5 represents a", etc.).
 * The real ciphertext decodes with exactly these 21 symbols. */
export const KIDD_TABLE = {
  a: '5', b: '2', c: '-', d: '†', e: '8', f: '1', g: '3', h: '4', i: '6', l: '0',
  m: '9', n: '*', o: '‡', p: '.', r: '(', s: ')', t: ';', u: '?', v: '¶', w: ']', y: ':',
};

/* The symbol pool for the random alphabets: Kidd's characters first, then a
 * few more marks of the same period so a 26-letter text can still be keyed. */
export const SYMBOL_POOL = [
  '8', ';', '4', '‡', ')', '*', '5', '6', '(', '†', '1', '0', '9', '2', ':', '3',
  '?', '¶', '-', '.', ']', '§', '&', '=', '+', '!',
];

/* English letter order, as Legrand gives it: "the succession runs thus". */
export const ENGLISH_ORDER = 'eaoidhnrstuycfglmwbkpqxz';

export const ROUNDS = [
  {
    id: 1,
    name: 'The Island',
    intro: 'Sullivan’s Island. The rival has just landed on the shore, spade in hand.',
    // Poe, The Gold-Bug, opening description of Sullivan's Island (verbatim, trimmed).
    text: 'this island consists of little else than the sea sand',
    keywords: ['island', 'sea', 'sand'],
    budget: 42,          // seconds before the rival crosses this stretch of the map
    knock: 5,            // seconds pushed back per key word
  },
  {
    id: 2,
    name: 'The Parchment',
    intro: 'He is crossing the dunes. Hold the parchment to the fire and read what appears.',
    // After Legrand's account of the skull and the kid appearing upon the parchment.
    text: 'i held the parchment to the fire and the skull came out upon it and beneath it the figure of a kid',
    keywords: ['skull', 'fire', 'kid'],
    budget: 62,
    knock: 7,
  },
  {
    id: 3,
    name: 'Kidd’s Cipher',
    intro: 'He is in the woods beneath the tulip tree. This is Kidd’s own hand.',
    // The real message, with the real symbol table. Poe's text reads
    // "twenty-one degrees" (the ciphertext ;]8*;:‡*8 decodes to TWENTYONE).
    text: 'a good glass in the bishops hostel in the devils seat twenty one degrees and thirteen minutes northeast and by north main branch seventh limb east side shoot from the left eye of the deaths head a bee line from the tree through the shot fifty feet out',
    keywords: ['hostel', 'seat', 'glass', 'northeast', 'tree', 'head', 'shot', 'line'],
    budget: 95,
    knock: 6,
    fixed: KIDD_TABLE,
  },
];

/* Legrand's method, delivered as pop-in marginalia. */
export const HINTS = [
  'Now, in English, the letter which most frequently occurs is e.',
  'Of all words in the language, “the” is most usual: three marks, the last of them your e.',
  'A mark standing alone must be a or i.',
  'After e the succession runs a o i d h n r s t u y c f g l m w b k p q x z.',
  'A doubled mark is most often ee, oo, ss, tt or ll.',
  'Find your t, your h and your e, and every “the” on the page becomes a lantern.',
  'A four-mark word ending in your e, with your t at its head: try t-r-e-e.',
  'Legrand’s lens: choose a mark and see it everywhere at once.',
];

function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Builds a fresh cipher for a round: {letters, table, inverse, words, counts, order}. */
export function buildCipher(round, rnd = Math.random) {
  const letters = [...new Set(round.text.replace(/[^a-z]/g, ''))];
  let table;
  if (round.fixed) {
    table = { ...round.fixed };
  } else {
    const syms = shuffle(SYMBOL_POOL, rnd).slice(0, letters.length);
    table = {};
    letters.forEach((l, i) => { table[l] = syms[i]; });
  }
  const inverse = {};
  for (const [l, s] of Object.entries(table)) inverse[s] = l;

  const words = round.text.split(' ').map((w) => ({
    plain: w,
    symbols: [...w].map((ch) => table[ch]),
    key: round.keywords.includes(w),
  }));

  const counts = {};
  for (const ch of round.text) if (ch !== ' ') counts[table[ch]] = (counts[table[ch]] || 0) + 1;
  const order = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));

  return { letters, table, inverse, words, counts, order, text: round.text };
}

/** Frequency analysis of an arbitrary symbol string (what the chart draws). */
export function frequencies(symbolsString) {
  const counts = {};
  for (const ch of symbolsString) if (ch !== ' ') counts[ch] = (counts[ch] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([sym, n]) => ({ sym, n }));
}

/** The real ciphertext as Poe printed it, for the marginalia / self-check. */
export const KIDD_CIPHERTEXT =
  '53‡‡†305))6*;4826)4‡.)4‡);806*;48†8¶60))85;;]8*;:‡*8†83(88)5*†;46(;88*96*?;8)*‡(;485);5*†2:*‡(;4956*2(5*-4)8¶8*;4069285);)6†8)4‡‡;1(‡9;48081;8:8‡1;48†85;4)485†528806*81(‡9;48;(88;4(‡?34;48)4‡;161;:188;‡?;';
