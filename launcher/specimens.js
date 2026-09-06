/* poe-arcade — launcher/specimens.js
 * Nine hand-drawn SVG specimens, one per drawer. Each is a self-contained
 * 160x120 drawing; the looping animations are CSS classes in launcher.css so
 * they can be damped under prefers-reduced-motion from one place.
 */

const svg = (slug, inner, defs = '') =>
  `<svg class="sp sp-${slug}" viewBox="-50 0 260 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">` +
  (defs ? `<defs>${defs}</defs>` : '') + inner + `</svg>`;

/* 1 — The Tell-Tale Heart: a heart in a bell jar, beating over a faint trace */
const tellTaleHeart = () => svg('tell-tale-heart', `
  <rect x="-50" width="260" height="120" fill="#0a0908"/>
  <ellipse cx="80" cy="103" rx="46" ry="6" fill="#000" opacity=".6"/>
  <rect x="42" y="96" width="76" height="9" rx="2" fill="url(#tthBase)"/>
  <path d="M54 97 V44 a26 26 0 0 1 52 0 V97 Z" fill="url(#tthJar)" stroke="rgba(190,215,235,.35)" stroke-width="1.2"/>
  <g class="beat">
    <path d="M80 87 C 63 74, 58 62, 64 55 C 69 49, 78 51, 80 58 C 82 51, 91 49, 96 55 C 102 62, 97 74, 80 87 Z" fill="url(#tthHeart)"/>
    <path d="M73 56 c-3 4 -3 9 -1 13" stroke="rgba(255,150,150,.35)" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M78 50 c 1 -5 4 -8 6 -9 M84 52 c 3 -3 7 -4 10 -3" stroke="#4a0a0c" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  </g>
  <path d="M60 50 v42" stroke="rgba(255,255,255,.16)" stroke-width="3" stroke-linecap="round"/>
  <path d="M100 56 v30" stroke="rgba(255,255,255,.07)" stroke-width="2" stroke-linecap="round"/>
  <path class="ecg" d="M14 112 h28 l3 -6 l4 12 l4 -20 l4 18 l3 -4 h86" fill="none" stroke="#c0161b" stroke-width="1.1" stroke-linejoin="round" stroke-dasharray="6 140"/>
`, `
  <linearGradient id="tthBase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a3a2c"/><stop offset="1" stop-color="#1d1611"/></linearGradient>
  <linearGradient id="tthJar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(170,200,230,.10)"/><stop offset=".5" stop-color="rgba(170,200,230,.02)"/><stop offset="1" stop-color="rgba(170,200,230,.12)"/></linearGradient>
  <radialGradient id="tthHeart" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#c2262a"/><stop offset=".55" stop-color="#7a0f12"/><stop offset="1" stop-color="#3a0507"/></radialGradient>
`);

/* 2 — The Masque of the Red Death: a mask whose halo walks the seven rooms */
const masqueRedDeath = () => svg('masque-red-death', `
  <rect x="-50" width="260" height="120" fill="#1a0b2e"/>
  <circle class="mglow" cx="80" cy="60" r="34" fill="#1e3f8f" filter="url(#mblur)"/>
  <path d="M40 58 C 22 50, 8 58, 6 74 M120 58 C 138 50, 152 58, 154 74" stroke="#c9a227" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".8"/>
  <path d="M40 60 C 45 40, 70 44, 80 54 C 90 44, 115 40, 120 60 C 118 78, 100 84, 92 74 C 88 70, 84 70, 80 74 C 76 70, 72 70, 68 74 C 60 84, 42 78, 40 60 Z" fill="url(#mMask)" stroke="#e0b64a" stroke-width="1.3"/>
  <ellipse cx="63" cy="60" rx="8" ry="5" fill="#0d0518"/>
  <ellipse cx="97" cy="60" rx="8" ry="5" fill="#0d0518"/>
  <path d="M63 47 c 6 -8 14 -10 17 -6 c 3 -4 11 -2 17 6" stroke="#e0b64a" stroke-width="1" fill="none" opacity=".7"/>
  <path d="M80 58 l2 6 l-2 6 l-2 -6 z" fill="#e0b64a" opacity=".85"/>
  <path d="M96 76 c 1 4 -1 8 -2 10" stroke="#c8102e" stroke-width="2.2" stroke-linecap="round" fill="none"/>
  <text x="80" y="108" text-anchor="middle" font-family="'IM Fell English SC','IM Fell English',serif" font-size="9" fill="rgba(224,182,74,.55)" letter-spacing="2">XII</text>
`, `
  <filter id="mblur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
  <linearGradient id="mMask" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d21a35"/><stop offset=".6" stop-color="#8a0c1e"/><stop offset="1" stop-color="#4a0510"/></linearGradient>
`);

/* 3 — The Pit and the Pendulum: a crescent blade on a rod, catching the light */
const pitAndPendulum = () => svg('pit-and-pendulum', `
  <rect x="-50" width="260" height="120" fill="#0b0a08"/>
  <path d="M-50 0 h260 v40 L80 62 L-50 40 Z" fill="#141210" opacity=".8"/>
  <ellipse cx="80" cy="110" rx="52" ry="7" fill="#000"/>
  <ellipse cx="80" cy="110" rx="52" ry="7" fill="none" stroke="#3a2a1c" stroke-width="1.2"/>
  <g class="pend">
    <line x1="80" y1="6" x2="80" y2="74" stroke="#7c6d5a" stroke-width="2"/>
    <line x1="79" y1="6" x2="79" y2="74" stroke="rgba(255,255,255,.18)" stroke-width=".6"/>
    <path d="M36 74 Q 80 104 124 74 Q 80 86 36 74 Z" fill="url(#ppSteel)" stroke="#2a2420" stroke-width=".8"/>
    <path class="glint" d="M46 78 Q 80 96 114 78" stroke="#fff3d6" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </g>
  <circle cx="80" cy="6" r="3.2" fill="#c9a227"/>
  <circle cx="80" cy="6" r="1.2" fill="#3a2a10"/>
`, `
  <linearGradient id="ppSteel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5a5650"/><stop offset=".45" stop-color="#d8d2c6"/><stop offset=".6" stop-color="#c4602a"/><stop offset="1" stop-color="#4a4640"/></linearGradient>
`);

/* 4 — The Fall of the House of Usher: the house, its reflection, the fissure */
const houseOfUsher = () => svg('house-of-usher', `
  <rect x="-50" width="260" height="120" fill="#1c2230"/>
  <rect class="flash" x="-50" width="260" height="120" fill="#eef4ff" opacity="0"/>
  <rect x="-50" y="66" width="260" height="54" fill="#0f141c"/>
  <g id="usherHouse" fill="#07090d">
    <rect x="34" y="40" width="92" height="26"/>
    <rect x="30" y="26" width="18" height="40"/>
    <rect x="112" y="22" width="18" height="44"/>
    <path d="M46 40 L 80 20 L 114 40 Z"/>
    <path d="M28 26 L 39 12 L 50 26 Z M110 22 L 121 6 L 132 22 Z"/>
    <rect x="76" y="50" width="8" height="16" fill="#3b2f10" opacity=".9"/>
    <rect x="56" y="48" width="5" height="8" fill="#0f0f0f"/><rect x="100" y="48" width="5" height="8" fill="#0f0f0f"/>
    <rect x="36" y="34" width="5" height="7" fill="#0f0f0f"/><rect x="118" y="30" width="5" height="7" fill="#0f0f0f"/>
  </g>
  <g transform="translate(0,132) scale(1,-1)" opacity=".28">
    <use href="#usherHouse"/>
  </g>
  <g stroke="#1c2230" stroke-width="1.5" opacity=".9">
    <line x1="-30" y1="76" x2="190" y2="76"/><line x1="-50" y1="84" x2="210" y2="84"/><line x1="-20" y1="93" x2="180" y2="93"/><line x1="-50" y1="102" x2="210" y2="102"/>
  </g>
  <path class="crack" d="M80 22 l3 8 l-4 6 l5 9 l-3 8 l4 7 l-2 6" fill="none" stroke="#d0342c" stroke-width="1.4" stroke-linejoin="round" stroke-dasharray="60" stroke-dashoffset="60"/>
  <path class="crack" d="M80 66 l1 6 l-3 6 l4 8" fill="none" stroke="#8b1a1a" stroke-width="1" stroke-dasharray="60" stroke-dashoffset="60" opacity=".5"/>
  <circle cx="132" cy="12" r="5" fill="#c9d2dd" opacity=".5"/>
`);

/* 5 — A Descent into the Maelström: the whirl, and the moon over it */
const maelstrom = () => {
  // A spiral of alternating half-circles, radius growing each half turn.
  let d = 'M80 62';
  let x = 80, y = 62;
  for (let i = 1; i <= 11; i++) {
    const r = i * 3.6;
    const dx = (i % 2 ? 1 : -1) * 2 * r;
    d += ` a${r} ${r} 0 0 ${i % 2 ? 1 : 0} ${dx} 0`;
    x += dx;
  }
  return svg('maelstrom', `
    <rect x="-50" width="260" height="120" fill="#030507"/>
    <circle cx="132" cy="18" r="9" fill="#dfeeea"/>
    <circle cx="129" cy="15" r="2" fill="#b9d3cb" opacity=".6"/><circle cx="135" cy="21" r="1.4" fill="#b9d3cb" opacity=".5"/>
    <circle cx="132" cy="18" r="14" fill="none" stroke="#b9e6dc" stroke-width=".6" opacity=".25"/>
    <g class="whirl">
      <circle cx="80" cy="62" r="46" fill="none" stroke="#b9e6dc" stroke-width="1" stroke-dasharray="4 7" opacity=".35"/>
      <circle cx="80" cy="62" r="36" fill="none" stroke="#b9e6dc" stroke-width="1" stroke-dasharray="6 5" opacity=".45"/>
      <path d="${d}" fill="none" stroke="#b9e6dc" stroke-width="1.4" stroke-dasharray="7 4" stroke-linecap="round" opacity=".85"/>
    </g>
    <g class="whirl2">
      <circle cx="80" cy="62" r="26" fill="none" stroke="#e6fbf5" stroke-width=".8" stroke-dasharray="3 9" opacity=".5"/>
    </g>
    <circle cx="80" cy="62" r="4" fill="#000" stroke="#b9e6dc" stroke-width=".5" opacity=".9"/>
    <path d="M118 96 l4 -4 h10 l3 4 z" fill="#0d1416" stroke="#b9e6dc" stroke-width=".8" opacity=".8"/>
    <line x1="127" y1="92" x2="127" y2="82" stroke="#b9e6dc" stroke-width=".8" opacity=".7"/>
  `);
};

/* 6 — The Gold-Bug: the scarab pinned to parchment over Kidd's cipher */
const goldBug = () => svg('gold-bug', `
  <rect x="-50" width="260" height="120" fill="url(#gbPaper)"/>
  <ellipse cx="34" cy="26" rx="14" ry="9" fill="#b39a6a" opacity=".25"/>
  <ellipse cx="128" cy="98" rx="20" ry="8" fill="#a88a58" opacity=".22"/>
  <text x="80" y="108" text-anchor="middle" font-family="'Special Elite','IM Fell English',serif" font-size="11" fill="rgba(70,45,20,.55)" letter-spacing="1">53‡‡†305))6*;4826)</text>
  <text x="80" y="16" text-anchor="middle" font-family="'Special Elite','IM Fell English',serif" font-size="9" fill="rgba(70,45,20,.35)" letter-spacing="1">4‡.)4‡);806*;48†8</text>
  <g stroke="#5a4a1a" stroke-width="1.8" stroke-linecap="round" fill="none">
    <path d="M66 52 l-14 -8 l-6 2 M66 62 l-16 2 l-4 6 M68 72 l-12 10 l-2 6"/>
    <path d="M94 52 l14 -8 l6 2 M94 62 l16 2 l4 6 M92 72 l12 10 l2 6"/>
  </g>
  <ellipse cx="80" cy="36" rx="7" ry="6" fill="#8d6b12"/>
  <path d="M75 32 l-5 -7 M85 32 l5 -7" stroke="#5a4a1a" stroke-width="1.4" stroke-linecap="round"/>
  <ellipse cx="80" cy="62" rx="18" ry="24" fill="url(#gbShell)" stroke="#5a4310" stroke-width="1"/>
  <ellipse cx="80" cy="44" rx="15" ry="7" fill="#a07a12" opacity=".9"/>
  <line x1="80" y1="46" x2="80" y2="85" stroke="#5a4310" stroke-width="1"/>
  <circle cx="72" cy="66" r="2.4" fill="#2a1e08" opacity=".7"/><circle cx="88" cy="66" r="2.4" fill="#2a1e08" opacity=".7"/><circle cx="80" cy="78" r="2.2" fill="#2a1e08" opacity=".7"/>
  <g clip-path="url(#gbClip)"><rect class="glint-sweep" x="-30" y="30" width="18" height="70" fill="url(#gbGlint)" transform="skewX(-20)"/></g>
  <line x1="80" y1="52" x2="98" y2="24" stroke="#8c8c8c" stroke-width="1.4"/>
  <line x1="80" y1="52" x2="98" y2="24" stroke="#f4f4f4" stroke-width=".5"/>
  <circle cx="99" cy="22" r="2.6" fill="#1a1a1a"/>
`, `
  <radialGradient id="gbPaper" cx=".5" cy=".5" r=".75"><stop offset="0" stop-color="#e6d3ad"/><stop offset=".7" stop-color="#d9c39a"/><stop offset="1" stop-color="#b89c68"/></radialGradient>
  <radialGradient id="gbShell" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffe58a"/><stop offset=".4" stop-color="#c9a227"/><stop offset="1" stop-color="#6b4f0c"/></radialGradient>
  <linearGradient id="gbGlint" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <clipPath id="gbClip"><ellipse cx="80" cy="62" rx="18" ry="24"/></clipPath>
`);

/* 7 — The Cask of Amontillado: a wall laid course by course, the bell above */
const amontillado = () => {
  let courses = '';
  const bw = 22, bh = 9, cols = 5, x0 = 24;
  for (let c = 0; c < 6; c++) {
    const y = 104 - c * (bh + 1.5);
    const off = c % 2 ? bw / 2 : 0;
    let bricks = '';
    for (let i = -1; i <= cols; i++) {
      const x = x0 + i * (bw + 1.5) + off;
      const right = x0 + cols * (bw + 1.5) - 1.5;
      const cx = Math.max(x, x0), cw = Math.min(x + bw, right) - cx;
      if (cw < 2) continue;
      const tone = ['#c27a2a', '#b56a26', '#d98b2b', '#a85f22', '#c9822c'][(i + c * 2 + 7) % 5];
      bricks += `<rect x="${cx.toFixed(1)}" y="${y}" width="${cw.toFixed(1)}" height="${bh}" rx=".6" fill="${tone}"/>`;
    }
    courses += `<g class="course c${c + 1}">${bricks}</g>`;
  }
  return svg('amontillado', `
    <rect x="-50" width="260" height="120" fill="#0e0d0b"/>
    <path d="M22 106 V54 a36 36 0 0 1 72 0 V106" fill="#1a1512" stroke="#3a2f26" stroke-width="2"/>
    <path d="M30 106 V56 a28 28 0 0 1 56 0 V106" fill="#050403"/>
    <g fill="#e8e2d4" opacity=".08"><circle cx="58" cy="60" r="5"/><rect x="50" y="68" width="16" height="3"/></g>
    <g class="jester">
      <path d="M58 42 c -6 -14 4 -22 10 -30" stroke="#5a1d78" stroke-width="5" fill="none" stroke-linecap="round"/>
      <circle cx="69" cy="10" r="5" fill="url(#amBell)" stroke="#8a6a2a" stroke-width=".6"/>
      <path d="M66 12 h6" stroke="#4a3810" stroke-width="1"/>
    </g>
    ${courses}
    <rect x="-50" y="106" width="260" height="4" fill="#2a2320"/>
    <path d="M112 100 l6 -12 l14 -2 l3 13 z" fill="#3a2a1c" opacity=".9"/>
    <ellipse cx="124" cy="101" rx="14" ry="3" fill="#000" opacity=".7"/>
    <rect x="110" y="88" width="30" height="13" rx="6" fill="#2b2016" stroke="#5a4634" stroke-width="1"/>
  `, `
    <radialGradient id="amBell" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffe89a"/><stop offset=".6" stop-color="#c9a227"/><stop offset="1" stop-color="#6b4f0c"/></radialGradient>
  `);
};

/* 8 — The Raven: engraved on the pallid bust, one feather falling */
const theRaven = () => svg('the-raven', `
  <rect x="-50" width="260" height="120" fill="#efe6d3"/>
  <rect x="-50" width="260" height="120" fill="url(#rvHatch)" opacity=".35"/>
  <rect x="46" y="98" width="68" height="14" fill="#111"/>
  <rect x="50" y="94" width="60" height="5" fill="#3a3a3a"/>
  <path d="M56 94 c 0 -10 6 -14 14 -16 c 4 -1 6 -6 6 -12 c -6 -2 -8 -10 -6 -16 c 3 -8 17 -8 20 0 c 2 6 0 14 -6 16 c 0 6 2 11 6 12 c 8 2 14 6 14 16 Z" fill="url(#rvHatch2)" stroke="#111" stroke-width="1.2"/>
  <path d="M74 60 c 2 -4 10 -4 12 0" stroke="#111" stroke-width=".8" fill="none"/>
  <path d="M78 42 c 6 -4 10 -2 14 4 c -2 -10 -10 -10 -14 -4 Z" fill="#111"/>
  <g fill="#111">
    <path d="M82 48 c -8 -14 2 -24 12 -22 c 2 -6 8 -8 12 -8 l 8 3 l -7 2 c 0 6 -2 12 -8 14 c 4 6 2 12 -6 14 c -6 1 -9 0 -11 -3 Z"/>
    <path d="M70 50 l 12 -6 l 6 5 l -14 6 Z"/>
    <path d="M88 44 c 8 -4 16 0 18 6 c -6 2 -14 0 -18 -6 Z" opacity=".9"/>
  </g>
  <path d="M92 20 l3 -1 M94 26 l4 2" stroke="#efe6d3" stroke-width=".8"/>
  <circle cx="102" cy="18" r="1" fill="#efe6d3"/>
  <g class="feather">
    <path d="M124 40 c 6 -6 10 -6 12 -2 c -2 6 -8 10 -14 8 Z" fill="#111"/>
    <path d="M122 46 c 4 -4 8 -6 14 -8" stroke="#efe6d3" stroke-width=".6" fill="none"/>
  </g>
  <text x="80" y="117" text-anchor="middle" font-family="'IM Fell English SC','IM Fell English',serif" font-size="8" fill="#111" letter-spacing="3" opacity=".75">NEVERMORE</text>
`, `
  <pattern id="rvHatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="4" stroke="#111" stroke-width=".35"/></pattern>
  <pattern id="rvHatch2" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><rect width="3" height="3" fill="#e2d8c2"/><line x1="0" y1="0" x2="0" y2="3" stroke="#111" stroke-width=".5"/></pattern>
`);

/* 9 — The Black Cat: a plaster patch, a hairline crack, one eye behind it */
const blackCat = () => svg('black-cat', `
  <rect x="-50" width="260" height="120" fill="#e8dfcf"/>
  <rect x="-50" width="260" height="120" fill="url(#bcPlaster)"/>
  <path d="M20 8 c 30 4 40 30 60 44" stroke="#c9bfae" stroke-width="1" fill="none" opacity=".5"/>
  <path d="M60 22 l6 10 l-3 8 l8 6 l-2 9 l10 4 l2 10 l-6 12 l4 14" fill="none" stroke="#3a3128" stroke-width="1" stroke-linejoin="round"/>
  <path d="M60 22 l6 10 l-3 8 l8 6 l-2 9 l10 4 l2 10 l-6 12 l4 14" fill="none" stroke="#fff" stroke-width=".6" opacity=".5" transform="translate(1,1)"/>
  <path d="M71 50 c 6 -8 26 -8 34 0 c -6 10 -26 10 -34 0 Z" fill="#0b0a0a"/>
  <g class="eye">
    <path d="M73 50 c 6 -8 24 -8 30 0 c -6 8 -24 8 -30 0 Z" fill="url(#bcIris)"/>
    <ellipse cx="88" cy="50" rx="2.2" ry="7" fill="#0b0a0a"/>
    <circle cx="84" cy="46" r="1.6" fill="#fff" opacity=".8"/>
  </g>
  <path d="M71 50 c 6 -8 26 -8 34 0" fill="none" stroke="#3a3128" stroke-width=".8"/>
  <path d="M96 14 l4 -8 M98 12 l6 -2" stroke="#c9bfae" stroke-width=".8" opacity=".7"/>
  <path d="M110 84 l14 -6 M120 92 l16 2" stroke="#c9bfae" stroke-width=".8" opacity=".6"/>
  <path d="M40 92 c 8 2 10 8 8 16" stroke="#8a7f6e" stroke-width=".8" fill="none" opacity=".4"/>
`, `
  <radialGradient id="bcPlaster" cx=".5" cy=".5" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#8a7f6e" stop-opacity=".25"/></radialGradient>
  <radialGradient id="bcIris" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#e3f28a"/><stop offset=".5" stop-color="#b5c93a"/><stop offset="1" stop-color="#5f6d12"/></radialGradient>
`);

export const SPECIMENS = {
  'tell-tale-heart': tellTaleHeart,
  'masque-red-death': masqueRedDeath,
  'pit-and-pendulum': pitAndPendulum,
  'house-of-usher': houseOfUsher,
  'maelstrom': maelstrom,
  'gold-bug': goldBug,
  'amontillado': amontillado,
  'the-raven': theRaven,
  'black-cat': blackCat,
};
