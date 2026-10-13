// Raalhu wave forecast. One plain script (no modules) so the page also works
// when index.html is opened straight from disk.
(function () {
'use strict';

// ===================== codec =====================
// Shared constants and helpers: value decoding, map projection, colour ramps,
// units and time formatting. No DOM access in here.

const MVT_OFFSET_H = 5; // Maldives Time = UTC+5, no daylight saving

// ---------------------------------------------------------------- layers
// `ramp` stops run from low to high. Wave height and power use a stretched
// (gamma) scale so most of the colours fall on the small waves inside the atoll.
const RAMPS = {
  sea: ['#f7fcfd', '#e3f4f2', '#c5e8e2', '#9dd8d3', '#70c3cb', '#4aa8c6', '#3489bc', '#2c6aac', '#2b4d94', '#2a3373', '#221c4d'],
  period: ['#fbfdf3', '#e6f5d8', '#c4e8c4', '#98d6ba', '#6dbfb8', '#4ba3b7', '#3884b1', '#3364a3', '#32478c', '#2a2c66'],
  cyclic: ['#3f63c9', '#35a7b8', '#4fb86a', '#d3c63a', '#e58a2e', '#d1495b', '#9a4fb5', '#3f63c9'],
  spread: ['#f4fbef', '#cdebc5', '#93d2a3', '#52b38c', '#2a8f84', '#1f6a78', '#1b4764'],
  power: ['#f7fcfd', '#e3f4f2', '#c5e8e2', '#9dd8d3', '#70c3cb', '#4aa8c6', '#3489bc', '#2c6aac', '#2b4d94', '#2a3373', '#221c4d'],
  bed: ['#f6f2fb', '#dcd1ef', '#bba9e0', '#9a80cf', '#7c5abb', '#613a9c', '#44246f'],
  depth: ['#e8fbf6', '#b9ecea', '#84d3e3', '#55b0d8', '#3a88c4', '#2f62a5', '#274382', '#1c2a5c'],
};

const LAYERS = [
  { id: 'hs', gl: 0, name: 'Wave height', short: 'Height', ramp: 'sea', kind: 'length', needs: 'hs', gamma: 0.5,
    ticks: { m: [0, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8], ft: [0, 0.5, 1, 2, 3, 5, 7, 10, 15, 20] },
    note: 'Significant wave height. The colour scale is stretched at the low end to show the small waves inside the lagoon.' },
  { id: 'tm01', gl: 2, name: 'Mean period', short: 'Period', ramp: 'period', unit: 's', needs: 'tm01',
    note: 'Average time between wave crests. Short periods are local wind chop; long periods are ocean swell.' },
  { id: 'dir', gl: 3, name: 'Wave direction', short: 'Direction', ramp: 'cyclic', unit: '°', needs: 'dir',
    note: 'Where the most energetic waves come from.' },
  { id: 'power', gl: 4, name: 'Wave power', short: 'Power', ramp: 'power', unit: 'kW/m', needs: 'tm01', gamma: 0.5,
    ticks: { m: [0, 0.1, 0.5, 1, 2, 5, 10, 20, 40, 80, 150, 300], ft: [0, 0.1, 0.5, 1, 2, 5, 10, 20, 40, 80, 150, 300] },
    note: 'Energy carried per metre of wave crest (deep-water estimate from height and mean period).' },
  { id: 'dspr', gl: 5, name: 'Directional spread', short: 'Spread', ramp: 'spread', unit: '°', needs: 'dspr',
    note: 'How widely wave directions fan out. Low values mean clean, lined-up swell; high values mean a confused sea.' },
];
const LAYER_INDEX = Object.fromEntries(LAYERS.map(l => [l.id, l.gl]));

// ---------------------------------------------------------------- decoding
// One forecast frame is a PNG holding two tiles side by side:
//   left  R = wave height   G = mean period  B = direction
//   right R = peak period   G = spread       B = seabed motion
// `px` is [r,g,b] of the left tile, `px2` of the right tile.
function decode(px, px2, enc) {
  const s = px[0];
  if (s >= enc.land) return null;
  const hs = enc.hs_max * (s / 253) ** 2;
  const tm01 = px[1] * enc.period_step;
  return {
    hs, tm01,
    dir: (px[2] / 256) * 360,
    tp: px2[0] * enc.period_step,
    dspr: px2[1] * enc.dspr_step,
    urms: enc.urms_max * (px2[2] / 255) ** 2,
    power: 0.49 * hs * hs * tm01,
  };
}

// ---------------------------------------------------------------- UTM <-> WGS84
const A = 6378137, F = 1 / 298.257223563, K0 = 0.9996;
const E2 = F * (2 - F), EP2 = E2 / (1 - E2);
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

function toLatLon(x, y, zone) {
  x -= 500000;
  const m = y / K0;
  const mu = m / (A * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu);
  const c1 = EP2 * Math.cos(p1) ** 2, t1 = Math.tan(p1) ** 2;
  const n1 = A / Math.sqrt(1 - E2 * Math.sin(p1) ** 2);
  const r1 = A * (1 - E2) / (1 - E2 * Math.sin(p1) ** 2) ** 1.5;
  const d = x / (n1 * K0);
  const lat = p1 - (n1 * Math.tan(p1) / r1) * (d * d / 2
    - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6 / 720);
  const lon = (d - (1 + 2 * t1 + c1) * d ** 3 / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5 / 120) / Math.cos(p1);
  return [deg(lat), deg(lon) + zone * 6 - 183];
}

function toUTM(lat, lon, zone) {
  const la = rad(lat), lo = rad(lon), lo0 = rad(zone * 6 - 183);
  const n = A / Math.sqrt(1 - E2 * Math.sin(la) ** 2);
  const t = Math.tan(la) ** 2, c = EP2 * Math.cos(la) ** 2, a = Math.cos(la) * (lo - lo0);
  const m = A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * la
    - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * la)
    + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * la) - (35 * E2 ** 3 / 3072) * Math.sin(6 * la));
  const x = K0 * n * (a + (1 - t + c) * a ** 3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5 / 120) + 500000;
  const y = K0 * (m + n * Math.tan(la) * (a * a / 2 + (5 - t + 9 * c + 4 * c * c) * a ** 4 / 24
    + (61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6 / 720));
  return [x, y];
}

// ---------------------------------------------------------------- colour
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

function rampBytes(name, n = 256) {
  const stops = RAMPS[name].map(hexRgb), out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = (i / (n - 1)) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(p)), f = p - k;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f);
    out[i * 4 + 3] = 255;
  }
  return out;
}
const rampCss = name => `linear-gradient(90deg, ${RAMPS[name].join(',')})`;
function rampColor(name, t) {
  const b = rampBytes(name, 64), i = Math.max(0, Math.min(63, Math.round(t * 63))) * 4;
  return `rgb(${b[i]},${b[i + 1]},${b[i + 2]})`;
}

// ---------------------------------------------------------------- numbers and units
function niceCeil(v, steps = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 500]) {
  return steps.find(s => s >= v) ?? v;
}
function niceStep(span, target = 5) {
  const raw = span / target, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

const FT = 3.28084, KN = 1.943844;
const U = {
  len(m, units) { return units === 'ft' ? m * FT : m; },
  lenUnit(units) { return units === 'ft' ? 'ft' : 'm'; },
  hs(m, units) {
    if (m == null || !isFinite(m)) return '–';
    const v = U.len(m, units);
    return v.toFixed(units === 'ft' || v >= 1 ? 1 : 2);
  },
  depth(m, units) { const v = U.len(m, units); return v >= 100 ? Math.round(v / 10) * 10 + '' : v >= 10 ? Math.round(v) + '' : v.toFixed(1); },
  speed(ms, units) { return units === 'ft' ? ms * KN : ms; },
  speedUnit(units) { return units === 'ft' ? 'kn' : 'm/s'; },
  kn(ms) { return ms * KN; },
};

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = d => COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];

function fmtLatLon(lat, lon) {
  const f = (v, pos, neg) => {
    const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
    return `${d}°${m.toFixed(2).padStart(5, '0')}′${v >= 0 ? pos : neg}`;
  };
  return `${f(lat, 'N', 'S')}  ${f(lon, 'E', 'W')}`;
}

// ---------------------------------------------------------------- time (always shown in Maldives Time)
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mvt = ms => new Date(ms + MVT_OFFSET_H * 3600e3);
const T = {
  hm(ms) { const d = mvt(ms); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; },
  hour(ms) { return mvt(ms).getUTCHours(); },
  day(ms) { const d = mvt(ms); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; },
  dayLong(ms) { const d = mvt(ms); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; },
  fromYmd(s) { return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); },
  ymdLabel(s) { const d = new Date(T.fromYmd(s)); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; },
  ago(ms) {
    const h = (Date.now() - ms) / 3600e3;
    if (h < 1) return 'less than an hour ago';
    if (h < 36) return `${Math.round(h)} h ago`;
    return `${Math.round(h / 24)} days ago`;
  },
};

// circular mean-ish interpolation between two bearings
function lerpDir(a, b, f) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * f + 360) % 360;
}

// ===================== chart =====================
// Small SVG time-series chart used in the side panel.

const arrow = (x, y, dirFrom, len = 12, cls = 'arr') => {
  // arrow pointing the way the waves (or wind) travel
  const th = (dirFrom + 180) * Math.PI / 180, dx = Math.sin(th) * len / 2, dy = -Math.cos(th) * len / 2;
  const hx = Math.sin(th - 2.6) * 4.5, hy = -Math.cos(th - 2.6) * 4.5, kx = Math.sin(th + 2.6) * 4.5, ky = -Math.cos(th + 2.6) * 4.5;
  const f = n => n.toFixed(1);
  return `<path class="${cls}" d="M${f(x - dx)} ${f(y - dy)}L${f(x + dx)} ${f(y + dy)}M${f(x + dx + hx)} ${f(y + dy + hy)}L${f(x + dx)} ${f(y + dy)}L${f(x + dx + kx)} ${f(y + dy + ky)}"/>`;
};
const arrowIcon = dirFrom => `<svg class="da" viewBox="0 0 16 16">${arrow(8, 8, dirFrom, 12, '')}</svg>`;

/**
 * o: { w, times[ms], main[], mainUnit, per[]?, per2[]?, dir[]?, t (float index) }
 * main is already in display units. Returns { svg, xOf, iOf }.
 */
function seriesChart(o) {
  const n = o.times.length, L = 30, R = 10, w = Math.max(220, o.w);
  const hasPer = !!o.per, top = o.dir ? 26 : 8, mh = 84, pTop = top + mh + 22, ph = 46;
  const H = (hasPer ? pTop + ph : top + mh) + 24;
  const x = i => L + (n > 1 ? i / (n - 1) : 0) * (w - L - R);
  const ok = v => v != null && isFinite(v);
  const mMax = niceCeil(Math.max(0.1, ...o.main.filter(ok)) * 1.08, [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50]);
  const my = v => top + mh - (v / mMax) * mh;
  const line = (arr, y) => { let d = '', pen = false; arr.forEach((v, i) => { if (!ok(v)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; }); return d; };
  let s = `<svg viewBox="0 0 ${w} ${H}" height="${H}" role="img" aria-label="Forecast through the day">`;

  for (const f of [0, 0.5, 1]) {
    const yy = top + mh - f * mh, v = mMax * f;
    s += `<line class="grid" x1="${L}" x2="${w - R}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end">${+v.toFixed(2)}</text>`;
  }
  const firstOk = o.main.findIndex(ok), lastOk = n - 1 - [...o.main].reverse().findIndex(ok);
  if (firstOk >= 0) {
    s += `<path class="hs-area" d="${line(o.main, my)}L${x(lastOk).toFixed(1)} ${top + mh}L${x(firstOk).toFixed(1)} ${top + mh}Z"/>`;
    s += `<path class="hs-line" d="${line(o.main, my)}"/>`;
  }
  let py = null;
  if (hasPer) {
    const all = [...o.per, ...(o.per2 || [])].filter(ok);
    const lo = Math.floor(Math.min(...all, 99)), hi = Math.max(lo + 2, Math.ceil(Math.max(...all, 0)));
    py = v => pTop + ph - ((v - lo) / (hi - lo)) * ph;
    for (const v of [lo, hi]) s += `<line class="grid" x1="${L}" x2="${w - R}" y1="${py(v)}" y2="${py(v)}"/><text x="${L - 6}" y="${py(v) + 4}" text-anchor="end">${v}</text>`;
    if (o.per2) s += `<path class="per2-line" d="${line(o.per2, py)}"/>`;
    s += `<path class="per-line" d="${line(o.per, py)}"/>`;
  }
  // direction arrows + hour labels
  const gap = (w - L - R) / Math.max(1, n - 1), every = gap * 3 >= 40 ? 3 : 6, aEvery = gap * 2 >= 22 ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const hr = T.hour(o.times[i]);
    if (o.dir && i % aEvery === 0 && ok(o.dir[i]) && ok(o.main[i])) s += arrow(x(i), 11, o.dir[i]);
    if (hr % every === 0) s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle"${hr === 0 ? ' class="lab"' : ''}>${hr === 0 ? T.day(o.times[i]).split(' ')[0] : String(hr).padStart(2, '0')}</text>`;
  }
  // time cursor
  const i0 = Math.floor(o.t), f = o.t - i0, i1 = Math.min(n - 1, i0 + 1), cx = x(o.t);
  const at = arr => ok(arr[i0]) && ok(arr[i1]) ? arr[i0] + (arr[i1] - arr[i0]) * f : null;
  s += `<line class="cur" x1="${cx}" x2="${cx}" y1="${top - 4}" y2="${H - 22}"/>`;
  const mv = at(o.main); if (mv != null) s += `<circle class="cur-dot" cx="${cx}" cy="${my(mv)}" r="4.5"/>`;
  if (hasPer) { const pv = at(o.per); if (pv != null) s += `<circle class="cur-dot" cx="${cx}" cy="${py(pv)}" r="4"/>`; }
  s += '</svg>';
  return { svg: s, iOf: px => Math.max(0, Math.min(n - 1, (px - L) / (w - L - R) * (n - 1))) };
}

// ===================== map =====================
// WaveMap: WebGL field renderer with pan/zoom, plus two 2D canvases on top
// (moving wave streaks, and labels / graticule / markers).

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;

const FRAG = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uF0, uF1, uDepth, uLut;
uniform vec2 uRes; uniform vec3 uView; uniform vec3 uGrid; uniform ivec2 uN;
uniform float uT; uniform int uLayer; uniform vec2 uRange; uniform vec4 uEnc;
uniform float uContours, uGamma, uAlpha, uBase; uniform float uLevels[12]; uniform int uNLev; uniform vec3 uLand, uShore;
const float DEPTHS[3] = float[3](2., 5., 10.);
out vec4 frag;
struct Acc { float wet; float land; float outside; float v; vec2 d; };
void tap(sampler2D tex, ivec2 ij, float w, inout Acc a) {
  ij = clamp(ij, ivec2(0), uN - 1);
  vec3 p = texelFetch(tex, ij, 0).rgb * 255.0;
  if (p.r > 254.5) { a.outside += w; return; }
  if (p.r > 253.5) { a.land += w; return; }
  vec3 q = texelFetch(tex, ij + ivec2(uN.x, 0), 0).rgb * 255.0;
  float hs = uEnc.x * (p.r / 253.0) * (p.r / 253.0);
  float v = hs;
  if (uLayer == 1) v = q.r * uEnc.y;
  else if (uLayer == 2) v = p.g * uEnc.y;
  else if (uLayer == 4) v = 0.49 * hs * hs * p.g * uEnc.y;
  else if (uLayer == 5) v = q.g * uEnc.z;
  else if (uLayer == 6) v = uEnc.w * (q.b / 255.0) * (q.b / 255.0);
  float ang = p.b / 256.0 * 6.28318530718;
  a.wet += w; a.v += w * v; a.d += w * vec2(sin(ang), cos(ang));
}
void frame(sampler2D tex, vec2 g, float w, inout Acc a) {
  vec2 p = g - 0.5; ivec2 i = ivec2(floor(p)); vec2 f = fract(p);
  tap(tex, i, w * (1. - f.x) * (1. - f.y), a);
  tap(tex, i + ivec2(1, 0), w * f.x * (1. - f.y), a);
  tap(tex, i + ivec2(0, 1), w * (1. - f.x) * f.y, a);
  tap(tex, i + ivec2(1, 1), w * f.x * f.y, a);
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 w = vec2(uView.x + (px.x - uRes.x * .5) / uView.z, uView.y - (px.y - uRes.y * .5) / uView.z);
  vec2 g = vec2((w.x - uGrid.x) / uGrid.z, (uGrid.y - w.y) / uGrid.z);
  vec2 n = vec2(uN);
  bool inside = g.x >= 0. && g.y >= 0. && g.x <= n.x && g.y <= n.y;
  vec2 gc = clamp(g, vec2(0.), n);
  Acc a = Acc(0., 0., 0., 0., vec2(0.));
  frame(uF0, gc, 1. - uT, a);
  if (uT > 0.001) frame(uF1, gc, uT, a);
  float lf = a.land / max(a.land + a.wet, 1e-5);
  vec3 dp = texture(uDepth, gc / n).rgb * 255.;
  float depth = (dp.r * 256. + dp.g) / 10.;
  float landm0 = step(.5, lf);
  float v = a.v / max(a.wet, 1e-5);
  if (uLayer == 3) v = mod(degrees(atan(a.d.x, a.d.y)) + 360., 360.);
  if (uLayer == 7) v = depth;
  float t = clamp((v - uRange.x) / (uRange.y - uRange.x), 0., 1.);
  t = pow(t, uGamma);
  vec3 col = texture(uLut, vec2(t * (255. / 256.) + .5 / 256., .5)).rgb;
  float fv = fwidth(v);
  if (uNLev > 0 && fv > 1e-5) {
    float l = 0.;
    for (int i = 0; i < uNLev; i++) l = max(l, 1. - smoothstep(0., 1.3, abs(v - uLevels[i]) / fv));
    col = mix(col, col * .72, l * .3);
  }
  if (uContours > 0.) {
    float fw = max(fwidth(depth), 1e-4), l = 0.;
    for (int i = 0; i < 3; i++) l = max(l, 1. - smoothstep(0., 1.25, abs(depth - DEPTHS[i]) / fw));
    col = mix(col, vec3(.07, .16, .25), l * .55 * (1. - landm0));
  }
  float aa = fwidth(lf) * 1.1 + 1e-4;
  float landm = smoothstep(.5 - aa, .5 + aa, lf);
  float shore = (1. - smoothstep(0., aa * 2.2, abs(lf - .5))) * step(0.002, a.land);
  if (!inside || a.outside > .5) { frag = vec4(0.); return; }
  float al = 1.;
  if (uBase > .5) al = mix(uAlpha, 0., landm);     // real map shows through, and fully on land
  else col = mix(col, uLand, landm);
  col = mix(col, uShore, shore * .85);
  al = max(al, shore * .85);
  frag = vec4(col * al, al);
}`;

const FONT = '"Schibsted Grotesk", system-ui, sans-serif';

// Free map tiles that need no account or key. Each needs its credit shown on the map.
const BASEMAPS = {
  satellite: { maxZoom: 17, credit: 'Imagery © Esri, Maxar, Earthstar Geographics',
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}` },
  street: { maxZoom: 18, credit: '© OpenStreetMap contributors',
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` },
};

class WaveMap {
  constructor(el, hooks = {}) {
    this.el = el; this.hooks = hooks;
    this.base_c = el.querySelector('canvas.base'); this.bx = this.base_c.getContext('2d');
    this.tiles = new Map(); this.baseOK = false;
    this.gl_c = el.querySelector('canvas.gl');
    this.fx_c = el.querySelector('canvas.fx');
    this.ov_c = el.querySelector('canvas.ov');
    this.fx = this.fx_c.getContext('2d');
    this.ov = this.ov_c.getContext('2d');
    this.view = { cx: 0, cy: 0, s: 0.01 };
    this.t = 0; this.layer = 'hs'; this.range = [0, 1]; this.iso = 0; this.hsScale = 1;
    this.opts = { motion: 'streaks', contours: true, labels: true, basemap: 'satellite', alpha: 0.8 };
    this.places = []; this.spots = []; this.selected = null;
    this.tex = new Map(); this.fields = new Map(); this.luts = {};
    this.parts = []; this.ok = this._initGL();
    this._bind();
    new ResizeObserver(() => this.resize()).observe(el);
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // ------------------------------------------------------------ GL setup
  _initGL() {
    const gl = this.gl = this.gl_c.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true });
    if (!gl) return false;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const pr = this.prog = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['uF0', 'uF1', 'uDepth', 'uLut', 'uRes', 'uView', 'uGrid', 'uN', 'uT', 'uLayer', 'uRange', 'uEnc', 'uGamma', 'uLevels', 'uNLev', 'uContours', 'uAlpha', 'uBase', 'uLand', 'uShore'])
      this.u[n] = gl.getUniformLocation(pr, n);
    gl.uniform1i(this.u.uF0, 0); gl.uniform1i(this.u.uF1, 1); gl.uniform1i(this.u.uDepth, 2); gl.uniform1i(this.u.uLut, 3);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    return true;
  }
  _texFrom(src, filter) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }
  _lut(name) {
    if (this.luts[name]) return this.luts[name];
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rampBytes(name));
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    return (this.luts[name] = t);
  }

  // ------------------------------------------------------------ data
  setGrid(grid, depthBitmap) {
    this.grid = grid;
    this.x1 = grid.x0 + grid.nx * grid.dx; this.y0 = grid.y1 - grid.ny * grid.dx;
    if (this.ok) { if (this.depthTex) this.gl.deleteTexture(this.depthTex); this.depthTex = this._texFrom(depthBitmap, this.gl.LINEAR); }
    this.clearFrames();
    this.fit();
  }
  /** provider(k) -> Promise<ImageBitmap> */
  setFrames(provider, count) { this.clearFrames(); this.provider = provider; this.count = count; }
  clearFrames() {
    if (this.ok) for (const t of this.tex.values()) if (t.tex) this.gl.deleteTexture(t.tex);
    this.tex.clear(); this.fields.clear(); this.pending = new Set();
  }
  _want(k) {
    if (k < 0 || k >= this.count || !this.provider) return null;
    const e = this.tex.get(k);
    if (e) { e.used = performance.now(); return e.tex; }
    if (!this.pending.has(k)) {
      this.pending.add(k);
      const prov = this.provider;
      prov(k).then(bmp => {
        this.pending.delete(k);
        if (prov !== this.provider || !bmp) return;
        this.tex.set(k, { tex: this.ok ? this._texFrom(bmp, this.gl.NEAREST) : null, used: performance.now() });
        this.fields.set(k, this._field(bmp));
        if (this.tex.size > 8) {               // drop least recently used
          const old = [...this.tex.entries()].sort((a, b) => a[1].used - b[1].used)[0];
          if (this.ok) this.gl.deleteTexture(old[1].tex);
          this.tex.delete(old[0]); this.fields.delete(old[0]);
        }
        this.dirty = true;
        this.hooks.onFrameReady?.(k);
      }).catch(() => this.pending.delete(k));
    }
    return null;
  }
  ready(k) { return this.tex.has(k); }
  preload(k) { this._want(k); }

  // low-resolution direction / height field for streaks and arrows
  _field(bmp) {
    const g = this.grid, fw = 200, fh = Math.round(200 * g.ny / g.nx);
    const c = this._fc || (this._fc = document.createElement('canvas'));
    c.width = fw; c.height = fh;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = false;
    x.drawImage(bmp, 0, 0, g.nx, g.ny, 0, 0, fw, fh);
    const d = x.getImageData(0, 0, fw, fh).data, hs = new Float32Array(fw * fh), dir = new Float32Array(fw * fh);
    const e = g.encoding;
    for (let i = 0; i < fw * fh; i++) {
      const s = d[i * 4];
      hs[i] = s >= e.land ? NaN : e.hs_max * (s / 253) ** 2;
      dir[i] = d[i * 4 + 2] / 256 * 360;
    }
    return { fw, fh, hs, dir };
  }
  _fieldAt(wx, wy) {
    const f = this.fields.get(Math.round(this.t)) || this.fields.get(Math.floor(this.t)) || this.fields.get(Math.ceil(this.t));
    if (!f) return null;
    const g = this.grid;
    const i = Math.floor((wx - g.x0) / (g.nx * g.dx) * f.fw), j = Math.floor((g.y1 - wy) / (g.ny * g.dx) * f.fh);
    if (i < 0 || j < 0 || i >= f.fw || j >= f.fh) return null;
    const hs = f.hs[j * f.fw + i];
    if (hs !== hs) return null;
    // wind is one value for the whole atoll; 15 m/s (about 30 kn) draws at full length
    if (this.opts.arrows === 'wind' && this.wind) return { hs: this.wind.speed / 15 * this.hsScale, dir: this.wind.dir, wave: hs };
    return { hs, dir: f.dir[j * f.fw + i], wave: hs };
  }

  // ------------------------------------------------------------ state setters
  setTime(t) { this.t = t; this.dirty = true; }
  setLayer(id, range, levels, ramp, hsScale, gamma = 1) { this.layer = id; this.range = range; this.levels = levels || []; this.ramp = ramp; this.hsScale = hsScale; this.gamma = gamma; this.dirty = true; this._clearFx(); }
  setOptions(o) { Object.assign(this.opts, o); this.dirty = true; this._clearFx(); }
  setPlaces(places, spots) { this.places = places || []; this.spots = spots || []; this.dirty = true; }
  setSelected(pt) { this.selected = pt; this.dirty = true; }

  // ------------------------------------------------------------ view
  resize() {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const had = this.W > 0;
    this.W = r.width; this.H = r.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [this.base_c, this.gl_c, this.ov_c]) { c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr); }
    this.fdpr = Math.min(this.dpr, 1.5);
    this.fx_c.width = Math.round(this.W * this.fdpr); this.fx_c.height = Math.round(this.H * this.fdpr);
    if (!had && this.grid) this.fit(); else this._clamp();
    this._seed(); this.dirty = true;
  }
  fitScale() {
    const g = this.grid, pad = this.pad || { l: 0, r: 0, t: 0, b: 0 };
    return Math.min((this.W - pad.l - pad.r) / (g.nx * g.dx), (this.H - pad.t - pad.b) / (g.ny * g.dx)) * 0.985;
  }
  fit() {
    if (!this.grid || !this.W) return;
    const pad = this.pad || { l: 0, r: 0, t: 0, b: 0 }, s = this.fitScale();
    this.view = { s, cx: (this.grid.x0 + this.x1) / 2 - (pad.l - pad.r) / 2 / s, cy: (this.y0 + this.grid.y1) / 2 + (pad.t - pad.b) / 2 / s };
    this._changed();
  }
  _clamp() {
    if (!this.grid || !this.W) return;
    const v = this.view, min = this.fitScale() * 0.6, max = 30 / this.grid.dx;
    v.s = Math.max(min, Math.min(max, v.s));
    v.cx = Math.max(this.grid.x0, Math.min(this.x1, v.cx));
    v.cy = Math.max(this.y0, Math.min(this.grid.y1, v.cy));
  }
  _changed() { this._clamp(); this.dirty = true; this._clearFx(); this.hooks.onView?.(); }
  toScreen(wx, wy) { const v = this.view; return [this.W / 2 + (wx - v.cx) * v.s, this.H / 2 - (wy - v.cy) * v.s]; }
  toWorld(sx, sy) { const v = this.view; return [v.cx + (sx - this.W / 2) / v.s, v.cy - (sy - this.H / 2) / v.s]; }
  inDomain(wx, wy) { const g = this.grid; return g && wx >= g.x0 && wx <= this.x1 && wy >= this.y0 && wy <= g.y1; }
  zoomBy(f, sx = this.W / 2, sy = this.H / 2) {
    const [wx, wy] = this.toWorld(sx, sy), v = this.view;
    v.s *= f; this._clamp();
    v.cx = wx - (sx - this.W / 2) / v.s; v.cy = wy + (sy - this.H / 2) / v.s;
    this._changed();
  }
  flyTo(wx, wy, minZoom = 2.2) {
    const target = Math.max(this.view.s, this.fitScale() * minZoom), from = { ...this.view }, t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / 450), e = 1 - (1 - k) ** 3;
      this.view = { s: from.s + (target - from.s) * e, cx: from.cx + (wx - from.cx) * e, cy: from.cy + (wy - from.cy) * e };
      this._changed();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  _bind() {
    const el = this.ov_c, pts = new Map();
    let moved = 0, pinch = 0, last = null;
    const pos = e => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    el.addEventListener('pointerdown', e => {
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } pts.set(e.pointerId, pos(e)); moved = 0;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
      last = pos(e); el.classList.add('drag');
    });
    el.addEventListener('pointermove', e => {
      const p = pos(e);
      if (!pts.has(e.pointerId)) { this._hover(p); return; }
      const prev = pts.get(e.pointerId); pts.set(e.pointerId, p);
      if (pts.size === 1) {
        moved += Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]);
        this.view.cx -= (p[0] - prev[0]) / this.view.s; this.view.cy += (p[1] - prev[1]) / this.view.s;
        this._changed();
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this.zoomBy(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        pinch = d; moved = 99;
      }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      const p = pos(e); pts.delete(e.pointerId); pinch = 0; el.classList.remove('drag');
      if (moved < 6 && pts.size === 0 && e.type === 'pointerup') {
        const hit = this._hitSpot(p);
        const [wx, wy] = hit ? [hit.x, hit.y] : this.toWorld(p[0], p[1]);
        if (this.inDomain(wx, wy)) this.hooks.onPick?.(wx, wy, hit);
      }
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => this.hooks.onHover?.(null));
    el.addEventListener('wheel', e => {
      e.preventDefault(); const p = pos(e);
      this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)), p[0], p[1]);
    }, { passive: false });
    el.addEventListener('dblclick', e => { const p = pos(e); this.zoomBy(1.8, p[0], p[1]); });
  }
  _hitSpot(p) {
    let best = null, bd = 14;
    for (const s of this.spots) { const q = this.toScreen(s.x, s.y), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  _hover(p) {
    const hit = this._hitSpot(p);
    this.ov_c.classList.toggle('hit', !!hit);
    const [wx, wy] = this.toWorld(p[0], p[1]);
    this.hooks.onHover?.(this.inDomain(wx, wy) ? { wx, wy, sx: p[0], sy: p[1], spot: hit } : null);
  }

  // ------------------------------------------------------------ drawing
  _loop(now) {
    requestAnimationFrame(this._loop);
    if (!this.grid || !this.W) return;
    if (this.dirty) { this.dirty = false; this._base(); this.draw(); this._overlay(); }
    if (this.opts.motion === 'streaks' && !document.hidden) this._streaks(now);
  }
  draw() {
    if (!this.ok) return;
    const gl = this.gl, g = this.grid, u = this.u;
    const k0 = Math.max(0, Math.min(this.count - 1, Math.floor(this.t))), k1 = Math.min(this.count - 1, k0 + 1);
    let f = this.t - k0, t0 = this._want(k0), t1 = f > 0.001 ? this._want(k1) : null;
    if (!t0 && t1) { t0 = t1; f = 0; }
    if (!t1) { t1 = t0; f = 0; }
    gl.viewport(0, 0, this.gl_c.width, this.gl_c.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!t0) return;
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, t1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this._lut(this.ramp || 'sea'));
    const e = g.encoding, v = this.view;
    gl.uniform2f(u.uRes, this.gl_c.width, this.gl_c.height);
    gl.uniform3f(u.uView, v.cx, v.cy, v.s * this.dpr);
    gl.uniform3f(u.uGrid, g.x0, g.y1, g.dx);
    gl.uniform2i(u.uN, g.nx, g.ny);
    gl.uniform1f(u.uT, f);
    gl.uniform1i(u.uLayer, LAYER_INDEX[this.layer] ?? 0);
    gl.uniform2f(u.uRange, this.range[0], this.range[1]);
    gl.uniform4f(u.uEnc, e.hs_max, e.period_step, e.dspr_step, e.urms_max);
    const lv = new Float32Array(12); (this.levels || []).slice(0, 12).forEach((x, i) => { lv[i] = x; });
    gl.uniform1fv(u.uLevels, lv); gl.uniform1i(u.uNLev, Math.min(12, (this.levels || []).length)); gl.uniform1f(u.uGamma, this.gamma || 1);
    gl.uniform1f(u.uContours, this.opts.contours && g.has_depth ? 1 : 0);
    const based = this.opts.basemap !== 'none' && this.baseOK;
    gl.uniform1f(u.uBase, based ? 1 : 0); gl.uniform1f(u.uAlpha, based ? this.opts.alpha : 1);
    gl.uniform3f(u.uLand, 0.953, 0.906, 0.765); gl.uniform3f(u.uShore, 0.07, 0.16, 0.25);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _overlay() {
    const c = this.ov, d = this.dpr, W = this.W, H = this.H, g = this.grid, zone = g.utm_zone;
    c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, W, H);
    const ink = '#0d2b3e', halo = 'rgba(255,255,255,.88)';

    // graticule
    const [la0, lo0] = toLatLon(...this.toWorld(0, H), zone), [la1, lo1] = toLatLon(...this.toWorld(W, 0), zone);
    const steps = [1, 2, 5, 10, 15, 30, 60].map(m => m / 60);
    const pxPerDeg = W / Math.max(lo1 - lo0, 1e-6), st = steps.find(s => s * pxPerDeg >= 110) || 1;
    const lab = (v, a, b) => { const x = Math.abs(v) + 1e-9, dg = Math.floor(x), m = Math.round((x - dg) * 60); return `${dg}°${String(m).padStart(2, '0')}′${v >= 0 ? a : b}`; };
    c.lineWidth = 1; c.strokeStyle = 'rgba(13,43,62,.16)'; c.font = `500 11px ${FONT}`; c.textBaseline = 'middle';
    const lp = this.pad || { l: 0, t: 0, b: 0, r: 0 };
    const label = (txt, x, y, align = 'left') => {
      c.textAlign = align; c.lineWidth = 3; c.strokeStyle = halo; c.lineJoin = 'round'; c.strokeText(txt, x, y);
      c.fillStyle = 'rgba(13,43,62,.72)'; c.fillText(txt, x, y); c.lineWidth = 1; c.strokeStyle = 'rgba(13,43,62,.16)';
    };
    for (let la = Math.ceil(la0 / st) * st; la <= la1; la += st) {
      const a = this.toScreen(...toUTM(la, lo0, zone)), b = this.toScreen(...toUTM(la, lo1, zone));
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      if (a[1] > lp.t + 30 && a[1] < H - lp.b - 14) label(lab(la, 'N', 'S'), W - (a[1] < 250 ? 62 : 8), (a[1] + b[1]) / 2 - 8, 'right');
    }
    for (let lo = Math.ceil(lo0 / st) * st; lo <= lo1; lo += st) {
      const a = this.toScreen(...toUTM(la0, lo, zone)), b = this.toScreen(...toUTM(la1, lo, zone));
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      if (b[0] > lp.l + 40 && b[0] < W - lp.r - 70) label(lab(lo, 'E', 'W'), b[0] + 5, H - lp.b - 10);
    }

    if (this.opts.motion === 'arrows') this._arrows(c);

    // forecast points
    for (const s of this.spots) {
      const [x, y] = this.toScreen(s.x, s.y);
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      c.beginPath(); c.arc(x, y, 4.5, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1.6; c.strokeStyle = ink; c.stroke();
    }
    // island names
    if (this.opts.labels) {
      c.font = `600 12.5px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle';
      const boxes = [];
      for (const p of this.places) {
        const [x, y] = this.toScreen(p.x, p.y);
        if (x < 0 || y < 0 || x > W || y > H) continue;
        const w = c.measureText(p.name).width, left = p.x < (g.x0 + this.x1) / 2;
        const bx = left ? x - w - 9 : x + 9, box = [bx - 2, y - 9, bx + w + 2, y + 9];
        if (boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        boxes.push(box);
        c.lineWidth = 3.5; c.strokeStyle = halo; c.lineJoin = 'round'; c.strokeText(p.name, bx, y);
        c.fillStyle = ink; c.fillText(p.name, bx, y);
      }
    }
    // selected point
    if (this.selected) {
      const [x, y] = this.toScreen(this.selected.x, this.selected.y), m = '#c2187a';
      c.lineWidth = 5; c.strokeStyle = 'rgba(255,255,255,.9)'; c.beginPath(); c.arc(x, y, 9, 0, 7); c.stroke();
      c.lineWidth = 2.5; c.strokeStyle = m; c.beginPath(); c.arc(x, y, 9, 0, 7); c.stroke();
      c.beginPath(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(x + dx * 13, y + dy * 13); c.lineTo(x + dx * 19, y + dy * 19); } c.stroke();
      c.beginPath(); c.arc(x, y, 2.2, 0, 7); c.fillStyle = m; c.fill();
    }
    // scale bar
    const km = niceStep(110 / this.view.s / 1000, 1), bw = km * 1000 * this.view.s, bx = W - lp.r - 16 - bw, by = H - lp.b - 30;
    c.lineWidth = 4; c.strokeStyle = halo; c.beginPath(); c.moveTo(bx, by - 5); c.lineTo(bx, by); c.lineTo(bx + bw, by); c.lineTo(bx + bw, by - 5); c.stroke();
    c.lineWidth = 1.6; c.strokeStyle = ink; c.stroke();
    c.font = `600 11px ${FONT}`; c.textBaseline = 'bottom';
    label(`${km >= 1 ? km : km * 1000} ${km >= 1 ? 'km' : 'm'}`, bx + bw / 2, by - 4, 'center');
  }

  _arrows(c) {
    const step = 46, W = this.W, H = this.H;
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
      const f = this._fieldAt(...this.toWorld(x, y)); if (!f) continue;
      const n = Math.min(1, f.hs / this.hsScale), len = 9 + 13 * Math.sqrt(n), th = (f.dir + 180) * Math.PI / 180;
      c.save(); c.translate(x, y); c.rotate(th);
      c.beginPath(); c.moveTo(0, len / 2); c.lineTo(0, -len / 2); c.moveTo(-4, -len / 2 + 5); c.lineTo(0, -len / 2); c.lineTo(4, -len / 2 + 5);
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.lineWidth = 3.4; c.strokeStyle = 'rgba(255,255,255,.75)'; c.stroke();
      c.lineWidth = 1.5; c.strokeStyle = 'rgba(13,43,62,.9)'; c.stroke();
      c.restore();
    }
  }

  // moving streaks that travel with the waves
  _seed() {
    const n = Math.round(Math.min(1400, Math.max(300, this.W * this.H / 900)));
    this.parts = Array.from({ length: n }, () => ({ x: 0, y: 0, age: 0 }));
  }
  _clearFx() { if (this.fx && this.W) { this.fx.setTransform(1, 0, 0, 1, 0, 0); this.fx.clearRect(0, 0, this.fx_c.width, this.fx_c.height); } for (const p of this.parts) p.age = 0; }
  _streaks(now) {
    if (now - (this._lastFx || 0) < 30) return;
    this._lastFx = now;
    const c = this.fx, d = this.fdpr, W = this.W, H = this.H, s = this.view.s;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'destination-in'; c.fillStyle = 'rgba(0,0,0,.9)'; c.fillRect(0, 0, this.fx_c.width, this.fx_c.height);
    c.globalCompositeOperation = 'source-over'; c.setTransform(d, 0, 0, d, 0, 0);
    const dark = new Path2D(), light = new Path2D(), useHs = this.layer === 'hs';
    for (const p of this.parts) {
      if (p.age <= 0) { [p.x, p.y] = this.toWorld(Math.random() * W, Math.random() * H); p.age = 25 + Math.random() * 70; }
      const f = this._fieldAt(p.x, p.y);
      if (!f) { p.age = 0; continue; }
      const n = Math.min(1, f.hs / this.hsScale), sp = (0.35 + 1.5 * Math.sqrt(n)) / s, th = (f.dir + 180) * Math.PI / 180;
      const nx = p.x + Math.sin(th) * sp, ny = p.y + Math.cos(th) * sp;
      const a = this.toScreen(p.x, p.y), b = this.toScreen(nx, ny);
      const path = useHs && Math.sqrt(Math.min(1, f.wave / this.hsScale)) > 0.52 ? light : dark;
      path.moveTo(a[0], a[1]); path.lineTo(b[0], b[1]);
      p.x = nx; p.y = ny; p.age--;
    }
    c.lineWidth = 1.3; c.lineCap = 'round';
    c.strokeStyle = 'rgba(13,43,62,.42)'; c.stroke(dark);
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.stroke(light);
  }

  // ------------------------------------------------------------ background map tiles
  // Standard web-map tiles are in Web Mercator; over an atoll-sized area near the
  // equator that differs from the model's UTM grid by well under a pixel per tile,
  // so each tile is simply placed by its corner coordinates.
  _base() {
    const c = this.bx, d = this.dpr, W = this.W, H = this.H, src = BASEMAPS[this.opts.basemap];
    c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, W, H);
    if (!src || !this.grid) return;
    const zone = this.grid.utm_zone;
    const [la0, lo0] = toLatLon(...this.toWorld(0, H), zone), [la1, lo1] = toLatLon(...this.toWorld(W, 0), zone);
    const z = Math.max(6, Math.min(src.maxZoom, Math.ceil(Math.log2(156543.03 * Math.cos(la0 * Math.PI / 180) * this.view.s) - 0.35)));
    const n = 2 ** z, tx = lon => (lon + 180) / 360 * n, ty = lat => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n;
    const lonOf = (x, zz) => x / 2 ** zz * 360 - 180, latOf = (y, zz) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** zz))) * 180 / Math.PI;
    const place = (x, y, zz) => { const a = this.toScreen(...toUTM(latOf(y, zz), lonOf(x, zz), zone)), b = this.toScreen(...toUTM(latOf(y + 1, zz), lonOf(x + 1, zz), zone)); return [a[0], a[1], b[0] - a[0], b[1] - a[1]]; };
    const get = (x, y, zz) => {
      const key = `${this.opts.basemap}/${zz}/${x}/${y}`; let t = this.tiles.get(key);
      if (!t) {
        t = { img: new Image(), ok: false }; t.img.crossOrigin = 'anonymous';
        t.img.onload = () => { t.ok = true; this.baseOK = true; this.dirty = true; };
        t.img.src = src.url(zz, x, y); this.tiles.set(key, t);
        if (this.tiles.size > 260) this.tiles.delete(this.tiles.keys().next().value);
      }
      return t;
    };
    const x0 = Math.floor(tx(lo0)), x1 = Math.floor(tx(lo1)), y0 = Math.floor(ty(la1)), y1 = Math.floor(ty(la0));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 80) return;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const t = get(x, y, z), [px, py, pw, ph] = place(x, y, z);
      if (t.ok) { c.drawImage(t.img, Math.floor(px), Math.floor(py), Math.ceil(pw) + 1, Math.ceil(ph) + 1); continue; }
      for (let up = 1; up <= 4 && z - up >= 6; up++) {       // show a coarser tile while the sharp one loads
        const f = 2 ** up, p = this.tiles.get(`${this.opts.basemap}/${z - up}/${Math.floor(x / f)}/${Math.floor(y / f)}`);
        if (p && p.ok) { const sz = p.img.width / f; c.drawImage(p.img, (x % f) * sz, (y % f) * sz, sz, sz, Math.floor(px), Math.floor(py), Math.ceil(pw) + 1, Math.ceil(ph) + 1); break; }
      }
    }
  }

  /** current view as one canvas (for saving a picture) */
  snapshot(bg) {
    const out = document.createElement('canvas'); out.width = this.gl_c.width; out.height = this.gl_c.height;
    const x = out.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, out.width, out.height);
    const m = this.opts.motion; if (m === 'streaks') this.opts.motion = 'arrows';
    this._base(); this.draw();
    try { x.drawImage(this.base_c, 0, 0); x.getImageData(0, 0, 1, 1); } catch { /* map tiles without sharing permission */ }
    x.drawImage(this.gl_c, 0, 0);
    this._overlay(); x.drawImage(this.ov_c, 0, 0);
    this.opts.motion = m; this.dirty = true;
    return out;
  }
}

// ===================== app =====================
// Raalhu wave forecast: page logic (data loading, state, panels, timeline).

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DATA = 'data/';

const state = {
  index: null, atoll: null, date: null, grid: null, meta: null, places: [],
  t: 0, layer: 'hs', units: store.get('raalhu-units') === 'ft' ? 'ft' : 'm',
  tab: 'point', sel: null, playing: false,
};
let map, frames, depthBmp, selToken = 0;

// ------------------------------------------------------------------ loading
// Data files are small scripts that put their content in window.RAALHU_DATA.
// Loading them with a <script> tag works on a web server and also when
// index.html is opened straight from disk (where fetch() is blocked).
const REG = (window.RAALHU_DATA = window.RAALHU_DATA || {});
function getData(key, tag) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${DATA}${key}.js${tag ? `?v=${tag}` : ''}`;
    s.onload = () => { const v = REG[key]; delete REG[key]; s.remove(); v === undefined ? reject(new Error(key)) : resolve(v); };
    s.onerror = () => { s.remove(); reject(new Error(key)); };
    document.head.append(s);
  });
}
async function getBitmap(key, tag) {
  const bin = atob((await getData(key, tag)).png), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });
  try { return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); }
  catch { return createImageBitmap(blob); }
}

/** Hourly frame images. Bitmaps are kept in a small cache on low-memory devices. */
class Frames {
  constructor(base, names, tag) {
    this.base = base; this.names = names; this.tag = tag; this.cache = new Map(); this.done = new Map();
    this.max = (navigator.deviceMemory || 4) < 4 ? 8 : names.length;
  }
  bitmap(k) {
    let p = this.cache.get(k);
    if (!p) {
      p = getBitmap(`${this.base}${this.names[k]}`, this.tag).then(b => { this.done.set(k, b); return b; });
      p.catch(() => this.cache.delete(k));
      this.cache.set(k, p);
      if (this.cache.size > this.max) {
        const old = this.cache.keys().next().value;
        this.cache.delete(old); this.done.get(old)?.close?.(); this.done.delete(old);
      }
    } else { this.cache.delete(k); this.cache.set(k, p); }
    return p;
  }
  peek(k) { return this.done.get(k) || null; }
  async warm(alive) { for (let k = 0; k < this.names.length && alive(); k++) { try { await this.bitmap(k); } catch { /* retried on demand */ } } }
}

// ------------------------------------------------------------------ reading values out of frames
const sc = document.createElement('canvas'); sc.width = 4; sc.height = 2;
const sx = sc.getContext('2d', { willReadFrequently: true }); sx.imageSmoothingEnabled = false;

function cell(wx, wy) {
  const g = state.grid, gx = (wx - g.x0) / g.dx - 0.5, gy = (g.y1 - wy) / g.dx - 0.5;
  const i = clamp(Math.floor(gx), 0, g.nx - 2), j = clamp(Math.floor(gy), 0, g.ny - 2);
  const fx = clamp(gx - i, 0, 1), fy = clamp(gy - j, 0, 1);
  return { i, j, w: [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy] };
}
/** Bilinear read of one frame at a map position; null on land. */
function sample(bmp, wx, wy) {
  const g = state.grid, { i, j, w } = cell(wx, wy);
  sx.clearRect(0, 0, 4, 2);
  sx.drawImage(bmp, i, j, 2, 2, 0, 0, 2, 2);
  sx.drawImage(bmp, i + g.nx, j, 2, 2, 2, 0, 2, 2);
  const d = sx.getImageData(0, 0, 4, 2).data;
  const acc = { hs: 0, tm01: 0, tp: 0, dspr: 0, urms: 0, power: 0 }; let wet = 0, sn = 0, cs = 0;
  for (let k = 0; k < 4; k++) {
    const a = ((k >> 1) * 4 + (k & 1)) * 4, b = a + 8;
    const v = decode([d[a], d[a + 1], d[a + 2]], [d[b], d[b + 1], d[b + 2]], g.encoding);
    if (!v) continue;
    wet += w[k]; for (const key in acc) acc[key] += w[k] * v[key];
    sn += w[k] * Math.sin(v.dir * Math.PI / 180); cs += w[k] * Math.cos(v.dir * Math.PI / 180);
  }
  if (wet < 0.5) return null;
  for (const key in acc) acc[key] /= wet;
  acc.dir = (Math.atan2(sn, cs) * 180 / Math.PI + 360) % 360;
  return acc;
}
function depthAt(wx, wy) {
  if (!depthBmp || !state.grid.has_depth) return null;
  const { i, j, w } = cell(wx, wy);
  sx.clearRect(0, 0, 4, 2); sx.drawImage(depthBmp, i, j, 2, 2, 0, 0, 2, 2);
  const d = sx.getImageData(0, 0, 2, 2).data; let wet = 0, sum = 0;
  for (let k = 0; k < 4; k++) if (d[k * 4 + 2] === 0) { wet += w[k]; sum += w[k] * (d[k * 4] * 256 + d[k * 4 + 1]) / 10; }
  return wet < 0.5 ? null : sum / wet;
}

// ------------------------------------------------------------------ layers and scales
function layerList() {
  const vars = new Set(state.meta?.vars || []);
  return LAYERS.filter(l => l.needs === 'depth' ? state.grid?.has_depth : vars.has(l.needs));
}
function layerRange(id) {
  const r = state.meta?.ranges || {}, hs = r.hs?.[1] ?? 2, tm = r.tm01?.[1] ?? 10;
  // height and period use fixed scales so a colour means the same thing every day;
  // they only stretch when a day goes beyond them
  const per = k => { const lo = Math.floor(r[k]?.[0] ?? 4), hi = Math.ceil(r[k]?.[1] ?? 12); return [lo, Math.max(hi, lo + 2)]; };
  switch (id) {
    case 'hs': return [0, Math.max(3, niceCeil(hs * 1.05))];
    case 'tp': return per('tp');
    case 'tm01': return per('tm01');
    case 'dir': return [0, 360];
    case 'power': return [0, niceCeil(0.49 * hs * hs * tm * 0.85, [1, 2, 3, 5, 8, 10, 15, 20, 30, 40, 60, 80, 100, 150, 200, 300, 500])];
    case 'dspr': return [Math.floor((r.dspr?.[0] ?? 10) / 5) * 5, Math.ceil((r.dspr?.[1] ?? 60) / 5) * 5];
    case 'urms': return [0, niceCeil(r.urms?.[1] ?? 0.5, [0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2, 3])];
    case 'depth': return [0, 60];
  }
  return [0, 1];
}
const layerDef = () => LAYERS.find(l => l.id === state.layer);
function layerUnit(l) { return l.kind === 'length' ? U.lenUnit(state.units) : l.kind === 'speed' ? U.speedUnit(state.units) : l.unit; }
function layerFactor(l) { return l.kind === 'length' ? U.len(1, state.units) : l.kind === 'speed' ? U.speed(1, state.units) : 1; }
function legendTicks(l) {
  const [a, b] = layerRange(l.id), k = layerFactor(l);
  if (l.id === 'dir') return { levels: [], ticks: [[0, 'N'], [0.25, 'E'], [0.5, 'S'], [0.75, 'W'], [1, 'N']] };
  if (l.gamma) {
    const vals = l.ticks[state.units === 'ft' && l.kind === 'length' ? 'ft' : 'm'].filter(v => v / k <= b * 1.001);
    let last = -1; const ticks = [];
    for (const v of vals) { const p = (v / k / b) ** l.gamma; if (p - last > 0.085 || v === 0) { ticks.push([p, String(v)]); last = p; } }
    return { levels: vals.slice(1).map(v => v / k), ticks };
  }
  const step = niceStep((b - a) * k, 5), ticks = [];
  for (let v = Math.ceil(a * k / step - 1e-9) * step; v <= b * k + 1e-9; v += step) ticks.push([(v / k - a) / (b - a), String(+v.toFixed(2))]);
  return { levels: ticks.map(([p]) => a + p * (b - a)), ticks };
}
function applyLayer() {
  const l = layerDef(), lt = legendTicks(l);
  map.setLayer(l.id, layerRange(l.id), lt.levels, l.ramp, layerRange('hs')[1], l.gamma || 1);
  $('#legend').innerHTML = `<h3>${esc(l.name)} <span>${esc(layerUnit(l))}</span></h3>
    <div class="rampbar" style="background:${rampCss(l.ramp)}"></div>
    <div class="lticks">${lt.ticks.map(([p, s], i) => `<b class="${i === lt.ticks.length - 1 && p > 0.97 ? 'end' : ''}" style="left:${(p * 100).toFixed(1)}%">${s}</b>`).join('')}</div>
    <p>${esc(l.note)}</p><p id="arrowNote"></p>`;
  if (state.meta) updateWind();
  for (const b of document.querySelectorAll('#layers button')) b.setAttribute('aria-pressed', b.dataset.layer === l.id);
}
function renderLayers() {
  const list = layerList();
  if (!list.some(l => l.id === state.layer)) state.layer = list[0]?.id || 'hs';
  $('#layers').innerHTML = list.map(l => `<button data-layer="${l.id}" aria-pressed="false" title="${esc(l.note)}"><i style="background:${rampCss(l.ramp)}"></i>${esc(l.short)}</button>`).join('');
}

// ------------------------------------------------------------------ time
const frameMs = k => Date.parse(state.meta.t0) + state.meta.hours[k] * 3600e3;
const tMs = t => { const k = Math.floor(t), f = t - k; return frameMs(k) + f * ((frameMs(Math.min(nFrames() - 1, k + 1)) - frameMs(k)) || 3600e3); };
const nFrames = () => state.meta.frames.length;

// wind used for the map arrows (one value for the whole atoll, from the model forcing)
function updateWind() {
  const f = state.meta.forcing, v = f ? valuesAt({ speed: f.wind_speed, dir: f.wind_dir }, state.t) : null;
  map.wind = v && v.speed != null && v.dir != null ? v : null;
  const el = $('#arrowNote');
  if (el) el.textContent = map.opts.motion === 'off' ? '' : map.opts.arrows === 'wind' && map.wind
    ? `Arrows show the wind: ${Math.round(U.kn(v.speed))} kn from ${compass(v.dir)}, the same over the whole atoll.`
    : 'Arrows show the way the waves travel.';
}
function setTime(t, quiet) {
  state.t = clamp(t, 0, nFrames() - 1);
  map.setTime(state.t);
  updateWind();
  const ms = tMs(state.t);
  $('#tClock').textContent = T.hm(ms); $('#tDay').textContent = `${T.day(ms)}, Maldives time`;
  $('#thumb').style.left = `${state.t / Math.max(1, nFrames() - 1) * 100}%`;
  $('#track').setAttribute('aria-valuenow', Math.round(state.t));
  $('#track').setAttribute('aria-valuetext', `${T.day(ms)} ${T.hm(ms)}`);
  if (!quiet) { renderPane(); syncHash(); } else paneSoon();
}
let paneTimer = 0;
function paneSoon() { if (!paneTimer) paneTimer = setTimeout(() => { paneTimer = 0; renderPane(); }, 140); }

function renderTimeline() {
  const n = nFrames(), tr = $('#track'), w = tr.clientWidth || 600, gap = w / Math.max(1, n - 1);
  const every = gap * 3 >= 46 ? 3 : gap * 6 >= 46 ? 6 : 12;
  tr.setAttribute('aria-valuemax', n - 1);
  let h = '';
  for (let k = 0; k < n; k++) {
    const ms = frameMs(k), hr = T.hour(ms), p = k / Math.max(1, n - 1) * 100, maj = hr % every === 0;
    h += `<i class="${maj ? 'maj' : ''}" style="left:${p}%"></i>`;
    if (maj && p > 2 && p < 98) h += `<b class="${hr === 0 ? 'day' : ''}" style="left:${p}%">${hr === 0 ? T.day(ms).split(' ').slice(0, 2).join(' ') : String(hr).padStart(2, '0') + ':00'}</b>`;
  }
  $('#ticks').innerHTML = h;
  const s = state.meta.stats?.hs_max || [], mx = Math.max(0.01, ...s.filter(v => v != null));
  $('#spark').setAttribute('viewBox', `0 0 ${n - 1} 1`);
  $('#spark').innerHTML = `<path d="M0 1${s.map((v, i) => `L${i} ${(1 - (v || 0) / mx * 0.9).toFixed(3)}`).join('')}L${n - 1} 1Z"/>`;
  const now = (Date.now() - frameMs(0)) / 3600e3, inRun = now >= 0 && now <= n - 1;
  $('#nowMark').hidden = !inRun; $('#nowBtn').hidden = !inRun;
  if (inRun) $('#nowMark').style.left = `${now / (n - 1) * 100}%`;
}
function nowIndex() { const now = (Date.now() - frameMs(0)) / 3600e3; return now >= 0 && now <= nFrames() - 1 ? Math.round(now) : null; }

let lastTick = 0;
function playLoop(now) {
  if (!state.playing) return;
  requestAnimationFrame(playLoop);
  const dt = Math.min(100, now - lastTick); lastTick = now;
  let t = state.t + dt / 650; const n = nFrames();
  if (t >= n - 1) t = 0;
  const k = Math.floor(t);
  map.preload(Math.min(n - 1, k + 2));
  if (!map.ready(k) || !map.ready(Math.min(n - 1, k + 1))) { map.preload(k); map.preload(k + 1); return; }
  setTime(t, true);
}
function setPlaying(on) {
  state.playing = on; $('#app').classList.toggle('playing', on);
  $('#playBtn').setAttribute('aria-label', on ? 'Pause' : 'Play the forecast');
  if (on) { lastTick = performance.now(); requestAnimationFrame(playLoop); } else setTime(Math.round(state.t));
}

// ------------------------------------------------------------------ selected point
function nearPlace(x, y) {
  let best = null, bd = 1800;
  for (const p of state.places) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
  return best;
}
async function pick(wx, wy, spot, opts = {}) {
  const [lat, lon] = toLatLon(wx, wy, state.grid.utm_zone);
  const near = spot ? null : nearPlace(wx, wy);
  const sel = { x: wx, y: wy, lat, lon, name: spot ? spot.name : near ? `Near ${near.name}` : 'Selected point', spot, depth: depthAt(wx, wy), series: null, land: false };
  if (spot && spot.hs) sel.series = { hs: spot.hs, tp: spot.tp || [], tm01: spot.tm01 || [], dir: spot.dir || [], dspr: spot.dspr || [], urms: [], power: spot.hs.map((h, i) => h == null || spot.tm01?.[i] == null ? null : 0.49 * h * h * spot.tm01[i]) };
  state.sel = sel; map.setSelected(sel);
  if (!opts.keepTab) { state.tab = 'point'; setTabs(); }
  if (opts.fly) map.flyTo(wx, wy);
  if (matchMedia('(max-width: 860px)').matches && !opts.quiet && $('#panel').dataset.sheet === 'peek') $('#panel').dataset.sheet = 'half';
  renderPane(); syncHash();
  const token = ++selToken, f = frames, keys = ['hs', 'tp', 'tm01', 'dir', 'dspr', 'urms', 'power'], out = Object.fromEntries(keys.map(k => [k, []]));
  let any = false;
  for (let k = 0; k < nFrames(); k++) {
    let v = null;
    try { v = sample(await f.bitmap(k), wx, wy); } catch { /* frame missing */ }
    if (token !== selToken || f !== frames) return;
    any = any || !!v;
    for (const key of keys) out[key].push(v ? v[key] : null);
  }
  sel.series = out; sel.land = !any;
  renderPane();
}
function valuesAt(series, t) {
  const k = Math.floor(t), k1 = Math.min(nFrames() - 1, k + 1), f = t - k, o = {};
  for (const key in series) {
    const a = series[key][k], b = series[key][k1];
    o[key] = a == null ? null : b == null || f === 0 ? a : key === 'dir' ? lerpDir(a, b, f) : a + (b - a) * f;
  }
  return o;
}

// ------------------------------------------------------------------ side panel
const fmt = (v, d = 1) => v == null || !isFinite(v) ? '–' : v.toFixed(d);
function rose(dir) {
  if (dir == null) return '';
  const th = (dir + 180) * Math.PI / 180, r = 27, sxp = 46 - Math.sin(th) * r, syp = 46 + Math.cos(th) * r, ex = 46 + Math.sin(th) * r, ey = 46 - Math.cos(th) * r;
  const h = a => `${(ex + Math.sin(th + a) * 11).toFixed(1)} ${(ey - Math.cos(th + a) * 11).toFixed(1)}`;
  return `<svg class="rose" viewBox="0 0 92 92" aria-hidden="true"><circle class="ring" cx="46" cy="46" r="36"/>
    <text x="46" y="8">N</text><text x="87" y="49">E</text><text x="46" y="91">S</text><text x="5" y="49">W</text>
    <path class="arrow" d="M${sxp.toFixed(1)} ${syp.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}"/><path class="arrow" d="M${h(2.65)}L${ex.toFixed(1)} ${ey.toFixed(1)}L${h(-2.65)}Z"/></svg>`;
}
let chartMap = null;
function chartBlock(o) {
  const c = seriesChart({ ...o, w: Math.min(520, ($('#pane').clientWidth || 348) - 36), times: state.meta.hours.map((_, k) => frameMs(k)), t: state.t });
  chartMap = c.iOf;
  return `<div class="chart" id="chart">${c.svg}</div>`;
}
function panePoint() {
  const s = state.sel, u = state.units;
  if (!s) return `<div class="pt-head"><h2>Read the forecast anywhere</h2><p>Tap or click the map to see wave height, period and direction at that point through the day.</p></div>`;
  let h = `<div class="pt-head"><h2>${esc(s.name)}</h2><p>${fmtLatLon(s.lat, s.lon)}${s.depth != null ? `, water ${U.depth(s.depth, u)} ${U.lenUnit(u)} deep` : ''}</p></div>`;
  if (!s.series) return h + `<p class="empty">Reading the forecast for this point…</p>`;
  if (s.land) return h + `<p class="empty">This point is on land or dry reef in the model. Tap the water nearby.</p>`;
  const v = valuesAt(s.series, state.t), ms = tMs(state.t);
  h += `<div class="hero"><div><div class="big">${U.hs(v.hs, u)}<small>${U.lenUnit(u)}</small></div>
      <p class="cap">Wave height at ${T.hm(ms)}, ${T.day(ms)}</p>
      <p class="dirline">${v.dir == null ? '' : `From ${compass(v.dir)} <span>${Math.round(v.dir)}°</span>`}</p></div>${rose(v.dir)}</div>`;
  const facts = [];
  if (s.series.tm01.length) facts.push(['Mean period', fmt(v.tm01), 's']);
  if (s.series.power.length) facts.push(['Wave power', fmt(v.power, v.power >= 10 ? 0 : 1), 'kW/m']);
  if (s.series.dspr.length) facts.push(['Spread', fmt(v.dspr, 0), '°']);
  if (v.hs != null) facts.push(['Biggest waves', '~' + U.hs(v.hs * 1.9, u), U.lenUnit(u)]);
  h += `<dl class="facts">${facts.map(([a, b, c]) => `<div><dt>${a}</dt><dd>${b}<small>${c}</small></dd></div>`).join('')}</dl>`;
  const hs = s.series.hs, mx = Math.max(...hs.filter(x => x != null)), ki = hs.indexOf(mx);
  h += `<h3 class="sub">Through the day <span>peaks ${U.hs(mx, u)} ${U.lenUnit(u)} at ${T.hm(frameMs(ki))}</span></h3>`;
  h += chartBlock({ main: hs.map(x => x == null ? null : U.len(x, u)), per: s.series.tm01, dir: s.series.dir });
  h += `<div class="key"><span><i></i>Height (${U.lenUnit(u)})</span><span><i class="k2"></i>Mean period (s)</span></div>`;
  h += `<div class="acts"><button class="btn" id="copyLink">Copy link to this point</button><button class="btn" id="csvBtn">Download table</button></div>`;
  h += `<p class="note">Wave height is the significant height. About one wave in a thousand reaches the "biggest waves" figure. Experimental model output, not for navigation.</p>`;
  return h;
}
function panePlaces() {
  const sp = state.meta.spots || [], u = state.units, top = layerRange('hs')[1];
  if (!sp.length) return `<p class="empty">No forecast points are set up for this atoll yet. Tap the map to read any location.</p>`;
  const rows = sp.map((s, i) => {
    const v = valuesAt({ hs: s.hs || [], tp: s.tm01 || [], dir: s.dir || [] }, state.t), mx = Math.max(...(s.hs || []).filter(x => x != null));
    return `<tr data-i="${i}" class="${state.sel?.spot === s ? 'on' : ''}" tabindex="0"><td><i class="sw" style="background:${rampColor('sea', Math.sqrt(clamp((v.hs || 0) / top, 0, 1)))}"></i>${esc(s.name)}</td>
      <td><b>${U.hs(v.hs, u)}</b></td><td>${fmt(v.tp, 0)}</td><td>${v.dir == null ? '–' : arrowIcon(v.dir) + compass(v.dir)}</td><td>${U.hs(mx, u)}</td></tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr><th>At ${T.hm(tMs(state.t))}</th><th>Height ${U.lenUnit(u)}</th><th>Period s</th><th>From</th><th>Day max</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note">These points sit in open water just off each island. Select one to see its full day and find it on the map.</p>`;
}
function paneOffshore() {
  const f = state.meta.forcing, u = state.units;
  if (!f) return `<p class="empty">No wind or offshore swell data was published with this run.</p>`;
  const v = valuesAt({ ws: f.wind_speed, dir: f.wind_dir }, state.t), ms = tMs(state.t);
  let h = `<div class="pt-head"><h2>Wind over the atoll</h2><p>From the global forecast that drives the model, at ${T.hm(ms)}</p></div>`;
  if (v.ws != null) {
    h += `<div class="wind">${rose(v.dir)}<div><div class="big">${fmt(U.kn(v.ws), 0)}<small>kn</small></div><p class="dirline">From ${compass(v.dir)} <span>${Math.round(v.dir)}°, ${fmt(v.ws)} m/s</span></p></div></div>`;
    h += chartBlock({ main: f.wind_speed.map(x => x == null ? null : U.kn(x)), dir: f.wind_dir });
    h += `<div class="key"><span><i></i>Wind speed (kn), arrows show where it blows to</span></div>`;
  }
  const b = (f.boundaries || []).filter(s => s.hs.some(x => x != null));
  if (b.length) {
    h += `<h3 class="sub">Open-ocean swell arriving at the model edge</h3><table class="tbl"><thead><tr><th>Side</th><th>Height ${U.lenUnit(u)}</th><th>Period s</th><th>From</th></tr></thead><tbody>`;
    for (const s of b) { const q = valuesAt({ hs: s.hs, tp: s.tp, dir: s.dir }, state.t); h += `<tr><td>${esc(s.name)}</td><td><b>${U.hs(q.hs, u)}</b></td><td>${fmt(q.tp, 0)}</td><td>${q.dir == null ? '–' : arrowIcon(q.dir) + compass(q.dir)}</td></tr>`; }
    h += `</tbody></table>`;
  }
  return h + `<p class="note">Source: NOAA GFS-Wave, ${esc(state.meta.cycle)} run. The model carries this swell and wind across the reefs and into the lagoon.</p>`;
}
function renderPane() {
  if (!state.meta) return;
  const p = $('#pane'), top = p.scrollTop;
  p.innerHTML = state.tab === 'places' ? panePlaces() : state.tab === 'offshore' ? paneOffshore() : panePoint();
  p.scrollTop = top;
  const s = state.sel, v = s?.series && !s.land ? valuesAt({ hs: s.series.hs }, state.t) : null;
  $('#grip').innerHTML = `<i></i><span>${s ? `${esc(s.name)}${v?.hs != null ? `: ${U.hs(v.hs, state.units)} ${U.lenUnit(state.units)}` : ''}` : 'Tap the map to read the forecast'}</span>`;
}
function setTabs() { for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', b.dataset.tab === state.tab); }

function downloadCsv() {
  const s = state.sel; if (!s?.series) return;
  const q = (v, d = 2) => v == null ? '' : v.toFixed(d);
  const rows = [['time_maldives', 'wave_height_m', 'mean_period_s', 'direction_from_deg', 'spread_deg', 'wave_power_kw_per_m']];
  state.meta.hours.forEach((_, k) => { const ms = frameMs(k), d = new Date(ms + 5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    rows.push([d, q(s.series.hs[k]), q(s.series.tm01[k], 1), q(s.series.dir[k], 0), q(s.series.dspr[k], 0), q(s.series.power[k], 1)]); });
  const head = `# Raalhu / MEWFS experimental forecast, ${state.atoll}, run ${state.date} ${state.meta.cycle}\n# ${s.name}, lat ${s.lat.toFixed(5)}, lon ${s.lon.toFixed(5)}\n# Not for navigation.\n`;
  save(new Blob([head + rows.map(r => r.join(',')).join('\n') + '\n'], { type: 'text/csv' }), `raalhu_${state.atoll}_${state.date}_${s.lat.toFixed(4)}N_${s.lon.toFixed(4)}E.csv`);
}
function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

// ------------------------------------------------------------------ address bar
let hashTimer = 0;
function syncHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    if (!state.meta) return;
    const p = new URLSearchParams({ a: state.atoll, d: state.date, t: Math.round(state.t), l: state.layer });
    if (state.sel) p.set('p', `${state.sel.lat.toFixed(4)},${state.sel.lon.toFixed(4)}`);
    try { history.replaceState(null, '', '#' + p.toString().replace(/%2C/g, ',')); } catch { /* not allowed for some local files */ }
  }, 250);
}
const readHash = () => Object.fromEntries(new URLSearchParams(location.hash.slice(1)));

// ------------------------------------------------------------------ header
function renderHeader() {
  const A = state.index.atolls;
  $('#atollSel').innerHTML = Object.entries(A).map(([k, v]) => `<option value="${esc(k)}" ${k === state.atoll ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
  const dates = [...A[state.atoll].dates].reverse();
  $('#dateSel').innerHTML = dates.map(d => `<option value="${d}" ${d === state.date ? 'selected' : ''}>${T.ymdLabel(d)}</option>`).join('');
  const i = A[state.atoll].dates.indexOf(state.date);
  $('#prevDay').disabled = i <= 0; $('#nextDay').disabled = i >= A[state.atoll].dates.length - 1;
  const m = state.meta, run = $('#runInfo'), latest = i === A[state.atoll].dates.length - 1;
  const stale = latest && Date.now() - frameMs(nFrames() - 1) > 6 * 3600e3;
  if (m.notice) { run.classList.add('stale'); run.textContent = m.notice; return; }
  run.classList.toggle('stale', stale);
  run.textContent = stale ? `Latest forecast is for ${T.ymdLabel(state.date)}. No newer run has been published yet.`
    : `Model run ${T.ymdLabel(state.date).split(' ').slice(0, 3).join(' ')} ${m.cycle}, published ${T.ago(Date.parse(m.generated))}`;
}
function stepDay(n) { const d = state.index.atolls[state.atoll].dates, i = d.indexOf(state.date) + n; if (i >= 0 && i < d.length) loadDay(d[i]); }

// ------------------------------------------------------------------ atoll / day
function message(title, body) { const m = $('#mapMsg'); m.hidden = !title; m.innerHTML = title ? `<h2>${title}</h2><p>${body}</p>` : ''; }

async function loadAtoll(name) {
  state.atoll = name; state.sel = null;
  const grid = await getData(`${name}/grid`, Date.now());
  depthBmp = await getBitmap(`${name}/depth`, state.index.updated ? encodeURIComponent(state.index.updated) : Date.now());
  state.grid = grid;
  state.places = (grid.places || []).map(p => { const [x, y] = toUTM(p.lat, p.lon, grid.utm_zone); return { ...p, x, y }; });
  map.setGrid(grid, depthBmp);
}
async function loadDay(date, hash = {}) {
  const wasPlaying = state.playing; if (wasPlaying) setPlaying(false);
  const base = `${state.atoll}/${date}/`;
  let meta;
  try { meta = await getData(base + 'meta', Date.now()); }
  catch { message('This forecast day is missing', 'Pick another day from the list above.'); return; }
  message();
  const keep = state.sel && !hash.p ? state.sel : null;
  state.date = date; state.meta = meta;
  frames = new Frames(base, meta.frames, encodeURIComponent(meta.generated || date));
  const fr = frames;
  map.setFrames(k => fr.bitmap(k), meta.frames.length);
  map.setPlaces(state.places, meta.spots || []);
  if (hash.l && LAYERS.some(l => l.id === hash.l)) state.layer = hash.l;
  renderLayers(); applyLayer(); renderHeader(); renderTimeline();
  const ht = parseInt(hash.t, 10);
  setTime(Number.isFinite(ht) ? ht : nowIndex() ?? 0, true);
  // selection: from the link, the previous point, or the first listed place
  let pt = null;
  if (hash.p) { const [la, lo] = hash.p.split(',').map(Number); if (isFinite(la) && isFinite(lo)) pt = toUTM(la, lo, state.grid.utm_zone); }
  const spots = meta.spots || [];
  const hit = pt && spots.find(s => Math.hypot(s.x - pt[0], s.y - pt[1]) < 60);
  if (pt && map.inDomain(pt[0], pt[1])) pick(pt[0], pt[1], hit, { quiet: true, keepTab: true });
  else if (keep) pick(keep.x, keep.y, keep.spot ? spots.find(s => s.name === keep.spot.name) : null, { quiet: true, keepTab: true });
  else if (spots.length) pick(spots[0].x, spots[0].y, spots[0], { quiet: true, keepTab: true });
  else { state.sel = null; map.setSelected(null); renderPane(); }
  fr.warm(() => fr === frames);
  if (wasPlaying) setPlaying(true);
}

// ------------------------------------------------------------------ wiring
function bindUI() {
  $('#atollSel').onchange = async e => { await loadAtoll(e.target.value); loadDay(state.index.atolls[state.atoll].dates.at(-1)); };
  $('#dateSel').onchange = e => loadDay(e.target.value);
  $('#prevDay').onclick = () => stepDay(-1); $('#nextDay').onclick = () => stepDay(1);
  $('#layers').onclick = e => { const b = e.target.closest('button'); if (b) { state.layer = b.dataset.layer; applyLayer(); syncHash(); } };
  for (const b of document.querySelectorAll('.seg button')) b.onclick = () => {
    state.units = b.dataset.units; store.set('raalhu-units', state.units);
    for (const x of document.querySelectorAll('.seg button')) x.setAttribute('aria-pressed', x === b);
    applyLayer(); renderPane();
  };
  for (const x of document.querySelectorAll('.seg button')) x.setAttribute('aria-pressed', x.dataset.units === state.units);
  $('#themeBtn').onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark'; store.set('raalhu-theme', document.documentElement.dataset.theme);
  };
  $('#discBtn').onclick = () => $('#disc').showModal();
  $('#disc').addEventListener('close', () => store.set('raalhu-seen', '1'));
  $('#zoomIn').onclick = () => map.zoomBy(1.6); $('#zoomOut').onclick = () => map.zoomBy(1 / 1.6); $('#zoomFit').onclick = () => map.fit();
  $('#optBtn').onclick = () => { const p = $('#optPop'); p.hidden = !p.hidden; $('#optBtn').setAttribute('aria-expanded', !p.hidden); };
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.tools')) { $('#optPop').hidden = true; $('#optBtn').setAttribute('aria-expanded', 'false'); } });
  for (const r of document.querySelectorAll('input[name=motion]')) r.onchange = () => { map.setOptions({ motion: r.value }); store.set('raalhu-motion', r.value); if (state.meta) updateWind(); };
  // ARROWS_DEFAULT: 'wind' or 'waves' - what the arrows show for a first-time visitor
  const ARROWS_DEFAULT = 'wind', ar0 = store.get('raalhu-arrows') || ARROWS_DEFAULT;
  map.setOptions({ arrows: ar0 }); { const r = document.querySelector(`input[name=arrows][value=${ar0}]`); if (r) r.checked = true; }
  for (const r of document.querySelectorAll('input[name=arrows]')) r.onchange = () => { map.setOptions({ arrows: r.value }); store.set('raalhu-arrows', r.value); if (state.meta) updateWind(); };
  $('#optContours').onchange = e => map.setOptions({ contours: e.target.checked });
  $('#optLabels').onchange = e => map.setOptions({ labels: e.target.checked });
  const setBase = v => { map.setOptions({ basemap: v }); store.set('raalhu-base', v); $('#attr').textContent = BASEMAPS[v] ? BASEMAPS[v].credit : ''; $('#optAlpha').disabled = v === 'none'; };
  for (const r of document.querySelectorAll('input[name=basemap]')) r.onchange = () => setBase(r.value);
  const base0 = store.get('raalhu-base') || 'satellite', rb = document.querySelector(`input[name=basemap][value=${base0}]`);
  if (rb) { rb.checked = true; setBase(base0); }
  const al0 = +(store.get('raalhu-alpha') || 80); $('#optAlpha').value = al0; map.setOptions({ alpha: al0 / 100 });
  $('#optAlpha').oninput = e => { map.setOptions({ alpha: e.target.value / 100 }); store.set('raalhu-alpha', e.target.value); };
  $('#saveImg').onclick = () => {
    const c = map.snapshot(getComputedStyle(document.documentElement).getPropertyValue('--mapbg').trim() || '#dde7ec'), x = c.getContext('2d'), d = c.width / map.W, l = layerDef(), ms = tMs(state.t);
    x.scale(d, d); x.fillStyle = 'rgba(255,255,255,.92)'; x.fillRect(0, 0, map.W, 34); x.fillStyle = '#0d2b3e'; x.font = '600 14px "Schibsted Grotesk", system-ui, sans-serif'; x.textBaseline = 'middle';
    x.fillText(`Raalhu / MEWFS experimental forecast   ${state.index.atolls[state.atoll].name}   ${l.name} (${layerUnit(l)})   ${T.dayLong(ms)} ${T.hm(ms)} Maldives time   Not for navigation`, 12, 17);
    // colour key
    const lt = legendTicks(l), kx = 12, ky = map.H - 44, kw = Math.min(280, map.W - 24), gr = x.createLinearGradient(kx + 10, 0, kx + kw - 10, 0);
    RAMPS[l.ramp].forEach((col, i, a) => gr.addColorStop(i / (a.length - 1), col));
    x.fillStyle = 'rgba(255,255,255,.92)'; x.fillRect(kx, ky - 6, kw, 40); x.fillStyle = gr; x.fillRect(kx + 10, ky, kw - 20, 10);
    x.fillStyle = '#0d2b3e'; x.font = '500 11px "Schibsted Grotesk", system-ui, sans-serif'; x.textAlign = 'center';
    for (const [p, txt] of lt.ticks) x.fillText(txt, kx + 10 + p * (kw - 20), ky + 22);
    c.toBlob(b => save(b, `raalhu_${state.atoll}_${state.date}_${l.id}_${T.hm(ms).replace(':', '')}.png`));
  };
  $('#playBtn').onclick = () => setPlaying(!state.playing);
  $('#stepBack').onclick = () => { setPlaying(false); setTime(Math.round(state.t) - 1); };
  $('#stepFwd').onclick = () => { setPlaying(false); setTime(Math.round(state.t) + 1); };
  $('#nowBtn').onclick = () => { setPlaying(false); const k = nowIndex(); if (k != null) setTime(k); };

  // timeline scrubbing
  const tr = $('#track'); let drag = false;
  const at = e => { const r = tr.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * (nFrames() - 1); };
  tr.addEventListener('pointerdown', e => { drag = true; try { tr.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } if (state.playing) setPlaying(false); setTime(at(e), true); });
  tr.addEventListener('pointermove', e => { if (drag) setTime(at(e), true); });
  const end = e => { if (drag) { drag = false; setTime(Math.round(at(e))); } };
  tr.addEventListener('pointerup', end); tr.addEventListener('pointercancel', end);
  tr.addEventListener('keydown', e => { const d = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[e.key]; if (d) { e.preventDefault(); e.stopPropagation(); setPlaying(false); setTime(Math.round(state.t) + d); } });
  document.addEventListener('keydown', e => {
    if (e.target.closest('select, input, dialog, [role=slider]') || (e.key === ' ' && e.target.closest('button, a'))) return;
    if (e.key === 'ArrowLeft') { setPlaying(false); setTime(Math.round(state.t) - 1); }
    else if (e.key === 'ArrowRight') { setPlaying(false); setTime(Math.round(state.t) + 1); }
    else if (e.key === ' ') { e.preventDefault(); setPlaying(!state.playing); }
    else if (e.key === '+' || e.key === '=') map.zoomBy(1.4); else if (e.key === '-') map.zoomBy(1 / 1.4);
  });

  // side panel
  document.querySelector('.tabs').onclick = e => { const b = e.target.closest('button'); if (b) { state.tab = b.dataset.tab; setTabs(); renderPane(); $('#pane').scrollTop = 0; } };
  $('#grip').onclick = () => { const p = $('#panel'); p.dataset.sheet = { peek: 'half', half: 'full', full: 'peek' }[p.dataset.sheet]; };
  const pane = $('#pane'); let cdrag = false;
  const chartT = e => { const c = e.target.closest('#chart'); if (!c || !chartMap) return null; const r = c.getBoundingClientRect(); return chartMap((e.clientX - r.left) / r.width * c.querySelector('svg').viewBox.baseVal.width); };
  pane.addEventListener('pointerdown', e => { const t = chartT(e); if (t != null) { cdrag = true; setPlaying(false); setTime(Math.round(t)); } });
  pane.addEventListener('pointermove', e => { if (cdrag && e.buttons) { const t = chartT(e); if (t != null && Math.round(t) !== Math.round(state.t)) setTime(Math.round(t)); } else cdrag = false; });
  pane.addEventListener('click', e => {
    const row = e.target.closest('tr[data-i]');
    if (row) { const s = state.meta.spots[+row.dataset.i]; pick(s.x, s.y, s, { fly: true }); return; }
    if (e.target.id === 'csvBtn') downloadCsv();
    if (e.target.id === 'copyLink') { clearTimeout(hashTimer); const b = e.target; navigator.clipboard?.writeText(location.href).then(() => { b.textContent = 'Link copied'; setTimeout(() => { if (b.isConnected) b.textContent = 'Copy link to this point'; }, 1600); }, () => { b.textContent = 'Copy the address from your browser'; }); }
  });
  pane.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest('tr[data-i]')?.click(); });
  let rz = 0; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (state.meta) { renderTimeline(); renderPane(); } }, 150); });
}

let tipRaf = 0;
function hover(h) {
  const tip = $('#tip');
  if (!h || !state.meta) { tip.hidden = true; return; }
  cancelAnimationFrame(tipRaf);
  tipRaf = requestAnimationFrame(() => {
    const bmp = frames.peek(Math.round(state.t)); if (!bmp) { tip.hidden = true; return; }
    const v = sample(bmp, h.wx, h.wy), u = state.units, l = layerDef();
    if (!v) { tip.hidden = true; return; }
    let main = `${U.hs(v.hs, u)} ${U.lenUnit(u)}`;
    if (l.id === 'depth') { const d = depthAt(h.wx, h.wy); main = d == null ? main : `${U.depth(d, u)} ${U.lenUnit(u)} deep`; }
    else if (l.id === 'power') main = `${fmt(v.power, 1)} kW/m`;
    else if (l.id === 'dspr') main = `${fmt(v.dspr, 0)}° spread`;
    else if (l.id === 'urms') main = `${fmt(U.speed(v.urms, u), 2)} ${U.speedUnit(u)}`;
    else if (l.id === 'tm01') main = `${fmt(v.tm01)} s mean`;
    tip.innerHTML = `${h.spot ? `<small>${esc(h.spot.name)}</small><br>` : ''}<b>${main}</b><br><small>${l.id === 'hs' || l.id === 'dir' ? '' : `${U.hs(v.hs, u)} ${U.lenUnit(u)}, `}${fmt(v.tm01, 0)} s from ${compass(v.dir)}</small>`;
    tip.hidden = false;
    const flip = h.sx > map.W - 170;
    tip.style.left = `${h.sx}px`; tip.style.top = `${h.sy}px`; tip.style.transform = flip ? 'translate(calc(-100% - 14px), -50%)' : '';
  });
}

async function boot() {
  const th = store.get('raalhu-theme'); if (th) document.documentElement.dataset.theme = th;
  map = new WaveMap($('#map'), { onPick: (x, y, spot) => pick(x, y, spot), onHover: hover });
  map.resize();
  const motion = store.get('raalhu-motion') || (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'arrows' : 'streaks');
  map.setOptions({ motion }); const r = document.querySelector(`input[name=motion][value=${motion}]`); if (r) r.checked = true;
  bindUI();
  if (!store.get('raalhu-seen')) $('#disc').showModal();
  if (!map.ok) { message('This browser cannot draw the map', 'The forecast map needs WebGL 2, which every current browser supports. Try updating your browser.'); return; }
  try { state.index = await getData('index', Date.now()); }
  catch { message('No forecast has been published yet', 'The first model run will appear here once it is uploaded.'); return; }
  const hash = readHash(), names = Object.keys(state.index.atolls);
  if (!names.length) { message('No forecast has been published yet', 'The first model run will appear here once it is uploaded.'); return; }
  const atoll = names.includes(hash.a) ? hash.a : names[0], dates = state.index.atolls[atoll].dates;
  try {
    await loadAtoll(atoll);
    await loadDay(dates.includes(hash.d) ? hash.d : dates.at(-1), hash);
  } catch (err) { console.error(err); message('The forecast could not be loaded', 'Check your connection and reload the page.'); }
}
boot();

// small hook used by automated checks
window.__raalhu = { state, sample: (k, x, y) => frames.bitmap(k).then(b => sample(b, x, y)), map: () => map };

})();
