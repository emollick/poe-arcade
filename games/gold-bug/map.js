/* The Gold-Bug — map.js
 * The treasure map: an SVG on its own small parchment. Every landmark is an
 * ink drawing that strokes itself in (pathLength=1 + dashoffset) when its key
 * word is decoded. The rival's footprints cross it toward the tree.
 */

const NS = 'http://www.w3.org/2000/svg';

/* Landmark groups keyed by the key word that reveals them. Each is raw SVG
 * markup in a 320x200 box. Strokes only, so they can draw themselves. */
const LANDMARKS = {
  island: `
    <path class="ink w2" d="M 16,118 C 34,96 80,84 138,92 S 236,70 300,80 C 314,96 306,120 288,128 S 214,152 146,146 S 44,148 16,118 Z"/>
    <text class="lbl" x="222" y="62" text-anchor="middle">SULLIVAN’S ISLAND</text>`,
  sea: `
    <path class="ink w1" d="M 8,160 q 8,-5 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0"/>
    <path class="ink w1" d="M 14,172 q 8,-5 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0"/>
    <path class="ink w1" d="M 8,184 q 8,-5 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0"/>
    <path class="ink w1" d="M 40,40 q 8,-5 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0 t 16,0"/>
    <text class="lbl" x="160" y="196" text-anchor="middle">THE ATLANTIC</text>
    <text class="lbl" x="170" y="34" text-anchor="middle">THE CREEK</text>`,
  sand: `
    <path class="ink w1" d="M 40,132 q 10,-8 20,0 M 66,138 q 10,-8 20,0 M 92,134 q 10,-8 20,0 M 118,140 q 10,-8 20,0 M 146,137 q 10,-8 20,0 M 174,141 q 10,-8 20,0 M 202,136 q 10,-8 20,0 M 230,138 q 10,-8 20,0 M 258,132 q 10,-8 20,0"/>
    <path class="ink w1" d="M 52,124 q 8,-6 16,0 M 104,126 q 8,-6 16,0 M 160,128 q 8,-6 16,0 M 216,128 q 8,-6 16,0"/>`,
  skull: `
    <g transform="translate(288,16) scale(0.9)">
      <path class="ink w2" d="M 0,-13 C -10,-13 -14,-4 -13,3 C -12,8 -9,10 -8,13 L 8,13 C 9,10 12,8 13,3 C 14,-4 10,-13 0,-13 Z"/>
      <path class="ink w2" d="M -8,13 L -7,19 L 7,19 L 8,13"/>
      <path class="ink w1" d="M -4,14 v5 M 0,14 v5 M 4,14 v5"/>
      <ellipse class="ink w2" cx="-5" cy="1" rx="3.6" ry="4"/>
      <ellipse class="ink w2" cx="5" cy="1" rx="3.6" ry="4"/>
      <path class="ink w1" d="M 0,6 l -2,4 h4 z"/>
    </g>
    <text class="lbl" x="288" y="47" text-anchor="middle">DEATH’S HEAD</text>`,
  fire: `
    <path class="ink w1" d="M 300,190 c 4,-8 -2,-12 2,-18 c 3,6 8,6 8,14 c 0,6 -6,8 -10,4 Z M 28,192 c 4,-8 -2,-12 2,-18 c 3,6 8,6 8,14 c 0,6 -6,8 -10,4 Z"/>
    <path class="ink w1" d="M 12,104 c 3,-6 -1,-9 2,-14 c 2,4 6,5 6,10 c 0,5 -5,6 -8,4 Z M 306,60 c 3,-6 -1,-9 2,-14 c 2,4 6,5 6,10 c 0,5 -5,6 -8,4 Z"/>
    <text class="lbl" x="22" y="90" text-anchor="middle">held to</text><text class="lbl" x="22" y="98" text-anchor="middle">the fire</text>`,
  kid: `
    <g transform="translate(28,178)">
      <path class="ink w2" d="M -12,0 C -12,-6 -6,-9 2,-8 L 10,-8 C 13,-8 14,-10 16,-13 L 18,-9 L 14,-6 L 12,0 M -12,0 L -13,8 M -8,0 L -8,8 M 6,-2 L 6,8 M 10,-2 L 11,8"/>
      <path class="ink w1" d="M 14,-13 l 3,-5 M 17,-12 l 4,-4 M 12,-7 l 2,1"/>
    </g>
    <text class="lbl" x="30" y="196" text-anchor="middle">KIDD</text>`,
  hostel: `
    <path class="ink w2" d="M 52,112 L 58,98 L 64,104 L 70,88 L 78,100 L 84,94 L 90,112 Z"/>
    <path class="ink w1" d="M 60,112 l 6,-9 M 70,112 l 4,-14 M 78,112 l 3,-8"/>
    <text class="lbl" x="70" y="122" text-anchor="middle">BISHOP’S HOSTEL</text>`,
  seat: `
    <path class="ink w2" d="M 84,95 l 6,-1 l 3,4 l -4,3 z"/>
    <path class="ink w1" d="M 86,92 l 2,-3 l 4,1"/>
    <text class="lbl" x="82" y="82" text-anchor="end">DEVIL’S SEAT</text>`,
  glass: `
    <path class="ink w1 dot" d="M 92,96 L 218,92"/>
    <path class="ink w1" d="M 100,102 l 8,-2 l 2,-1 l 6,-1 l 1,2 l -6,1 l -2,1 l -8,2 z"/>
    <text class="lbl" x="150" y="106" text-anchor="middle">A GOOD GLASS</text>`,
  northeast: `
    <path class="ink w1" d="M 92,96 L 122,74 M 118,74 L 122,74 L 122,78"/>
    <text class="lbl" x="118" y="66" text-anchor="middle">NE by N · 21°13′</text>`,
  tree: `
    <path class="ink w2" d="M 222,132 L 222,104 C 216,100 214,92 218,86 C 210,84 208,74 216,70 C 214,60 226,54 234,60 C 244,54 254,62 250,72 C 258,76 256,86 248,88 C 252,96 246,104 236,104 C 234,112 232,120 232,132 Z"/>
    <path class="ink w2" d="M 224,106 L 202,92 M 236,104 L 258,94"/>
    <path class="ink w1" d="M 226,88 l 4,-6 l 4,6 z M 240,82 l 4,-6 l 4,6 z M 216,80 l 4,-6 l 4,6 z"/>
    <text class="lbl" x="227" y="142" text-anchor="middle">THE TULIP TREE</text>`,
  head: `
    <g transform="translate(206,90) scale(0.42)">
      <path class="ink w2" d="M 0,-13 C -10,-13 -14,-4 -13,3 C -12,8 -9,10 -8,13 L 8,13 C 9,10 12,8 13,3 C 14,-4 10,-13 0,-13 Z"/>
      <ellipse class="ink w2" cx="-5" cy="1" rx="3.6" ry="4"/>
      <ellipse class="ink w2" cx="5" cy="1" rx="3.6" ry="4"/>
      <path class="ink w2" d="M -8,13 L -7,18 L 7,18 L 8,13"/>
    </g>
    <text class="lbl" x="196" y="82" text-anchor="end">THE SEVENTH LIMB</text>`,
  shot: `
    <path class="ink w1 dot" d="M 204,96 L 204,116"/>
    <circle class="ink w2" cx="204" cy="118" r="2.4"/>
    <text class="lbl" x="200" y="128" text-anchor="end">THE SHOT</text>`,
  line: `
    <path class="ink w1 dash" d="M 226,102 L 204,118 L 140,148"/>
    <text class="lbl" x="178" y="136" text-anchor="end">A BEE LINE</text>`,
  x: `
    <path class="gold w3" d="M 133,141 L 147,155 M 147,141 L 133,155"/>
    <path class="ink w1" d="M 116,132 h 12 v 6 h -12 z M 116,135 h 12"/>
    <text class="lbl gold-t" x="150" y="152" text-anchor="start">THE COFFER</text>`,
};

const RIVAL_PATH = 'M 20,150 C 60,150 80,138 108,130 C 140,122 150,132 176,124 C 200,116 166,142 140,148';

const COMPASS = `
  <g class="compass" transform="translate(280,150)">
    <circle class="ink w1" r="14"/><circle class="ink w1" r="3"/>
    <path class="ink w1" d="M 0,-20 L 3,-4 L 0,-2 L -3,-4 Z M 0,20 L 3,4 L 0,2 L -3,4 Z M -20,0 L -4,-3 L -2,0 L -4,3 Z M 20,0 L 4,-3 L 2,0 L 4,3 Z"/>
    <path class="ink w1" d="M 0,-4 L -3,-4 L 0,-20 Z"/>
    <text class="lbl" x="0" y="-24" text-anchor="middle">N</text>
  </g>`;

export function createMap(container) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 320 200');
  svg.setAttribute('class', 'map-svg');
  svg.setAttribute('aria-label', 'The treasure map');
  let inner = COMPASS;
  for (const [name, markup] of Object.entries(LANDMARKS)) inner += `<g class="lm" data-lm="${name}">${markup}</g>`;
  inner += `<path id="rivalPath" d="${RIVAL_PATH}" fill="none" stroke="none"/>
    <g class="steps"></g>
    <g class="rival"><circle class="rival-ring" r="7"/><path class="spade" d="M 0,-7 L 0,2 M -2,-7 h4 M -3.5,2 c 0,3 1.5,5 3.5,6 c 2,-1 3.5,-3 3.5,-6 z"/></g>`;
  svg.innerHTML = inner;
  container.appendChild(svg);

  // give every stroked shape pathLength=1 so CSS can draw it in
  for (const el of svg.querySelectorAll('.lm path, .lm circle, .lm ellipse')) el.setAttribute('pathLength', '1');

  const path = svg.querySelector('#rivalPath');
  const len = path.getTotalLength();
  const steps = svg.querySelector('.steps');
  const rival = svg.querySelector('.rival');
  const revealed = new Set();
  let stepCount = 0;

  function pointAt(t) { return path.getPointAtLength(Math.max(0, Math.min(1, t)) * len); }

  function drawSteps(progress) {
    // one pair of prints per 3% of the path; add or remove to match
    const want = Math.floor(progress * 34);
    while (stepCount < want) {
      const t = (stepCount + 0.5) / 34;
      const p = pointAt(t), q = pointAt(t + 0.01);
      const ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
      const side = stepCount % 2 ? 2.2 : -2.2;
      const e = document.createElementNS(NS, 'ellipse');
      e.setAttribute('rx', '1.1'); e.setAttribute('ry', '2');
      e.setAttribute('class', 'print');
      e.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) rotate(${(ang + 90).toFixed(0)}) translate(${side},0)`);
      steps.appendChild(e);
      stepCount++;
    }
    while (stepCount > want && steps.lastChild) { steps.removeChild(steps.lastChild); stepCount--; }
  }

  return {
    svg,
    revealed,
    reveal(name) {
      const g = svg.querySelector(`.lm[data-lm="${name}"]`);
      if (!g || revealed.has(name)) return false;
      revealed.add(name);
      g.classList.add('on');
      return true;
    },
    has(name) { return revealed.has(name); },
    setRival(progress, urgent) {
      const p = pointAt(progress);
      rival.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
      rival.classList.toggle('urgent', !!urgent);
      drawSteps(progress);
    },
    reset() {
      for (const n of revealed) svg.querySelector(`.lm[data-lm="${n}"]`)?.classList.remove('on');
      revealed.clear();
      steps.innerHTML = ''; stepCount = 0;
      this.setRival(0, false);
    },
  };
}

export const LANDMARK_NAMES = Object.keys(LANDMARKS);
