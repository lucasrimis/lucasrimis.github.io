'use strict';
(function () {
const W = window.WORLD;
const [BX0, BZ0, BX1, BZ1] = W.bounds;
const EM = 80; // extra margin of the playable extent
const EX0 = BX0 - EM, EZ0 = BZ0 - EM, EX1 = BX1 + EM, EZ1 = BZ1 + EM;

const SUN = (() => { const v = [-0.5, 0.78, -0.38], l = Math.hypot(...v); return v.map(x => x / l); })();
// ---------------- utils ----------------
function rngFor(x, z, k) {
  let a = (Math.round(x * 10) * 73856093) ^ (Math.round(z * 10) * 19349663) ^ ((k || 0) * 83492791);
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const jit = (c, r, amt) => { const m = 1 + (r() - 0.5) * 2 * amt; return [Math.min(255, c[0] * m), Math.min(255, c[1] * m), Math.min(255, c[2] * m)]; };
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

// vertex flag (stored in colour alpha)
const F_SKYF = 2;   // céu com dissolver (uFade)
const F_PLAIN = 255, F_TEX = 204, F_WATER = 140, F_PAVE = 100, F_FAR = 50, F_UNLIT = 20, F_GLOW = 11, F_SKY = 5;

// ---------------- mesh builder ----------------
class Builder {
  constructor(cap) { this.cap = cap || 2048; this._alloc(this.cap); this.n = 0; }
  _alloc(cap) {
    const nb = new ArrayBuffer(cap * 20);
    if (this.u) new Uint8Array(nb).set(this.u);
    this.buf = nb; this.f = new Float32Array(nb); this.b = new Int8Array(nb); this.u = new Uint8Array(nb);
  }
  v(p, n, c, fl) {
    if (this.n >= this.cap) { this.cap *= 2; this._alloc(this.cap); }
    const o = this.n * 5, bo = this.n * 20 + 12;
    this.f[o] = p[0]; this.f[o + 1] = p[1]; this.f[o + 2] = p[2];
    this.b[bo] = Math.round(n[0] * 127); this.b[bo + 1] = Math.round(n[1] * 127); this.b[bo + 2] = Math.round(n[2] * 127);
    this.u[bo + 4] = c[0]; this.u[bo + 5] = c[1]; this.u[bo + 6] = c[2]; this.u[bo + 7] = fl;
    this.n++;
  }
  tri(a, b, c, n, col, fl) { this.v(a, n, col, fl); this.v(b, n, col, fl); this.v(c, n, col, fl); }
  quad(a, b, c, d, n, col, fl) { this.tri(a, b, c, n, col, fl); this.tri(a, c, d, n, col, fl); }
  reset() { this.n = 0; }
}
function faceN(a, b, c, up) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  if (up && ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  return [nx, ny, nz];
}
// local frame: world = o + u*ax + y*ay + v*az
function frame(x, y, z, ang) { const c = Math.cos(ang), s = Math.sin(ang); return { o: [x, y, z], ax: [c, 0, s], ay: [0, 1, 0], az: [-s, 0, c] }; }
// objetos do cenário que podem ser copiados no esconde-esconde (tipo, posição, ângulo, extras)
const PROPS = [];
const LATE_NOTES = [];   // mensagens criadas antes da lista de NPCs existir
const DOGS = [];
const DOG_NAMES = { pitbull: 'Marley', bull: 'Branca', yorkieRoupa: 'Bob', yorkie: 'Junior', beagle: 'Pantufa', labrador: 'Balu', pastor: 'Zatara', golden: 'Laica' };         // cachorros soltos em quintais (andam sozinhos)
// relógio do jogo: 1 hora do jogo = 1 minuto real (o dia inteiro dura 24 minutos), igual para todos os jogadores
const DAY_SEC = 24 * 60;
function gameClock() { const sec = Date.now() / 1000 + (window.__timeShift || 0); const day = Math.floor(sec / DAY_SEC); return { day, h: (sec - day * DAY_SEC) / 60, sec, dayStart: day * DAY_SEC }; }
let PEAK_A = -Math.PI / 2;   // direção (a partir do centro do mapa) do pico mais alto da serra: o sol nasce e se põe atrás dele
let PORTELA_PARK = null;     // onde a bicicleta do Portela fica parada
let GATE116 = null;          // portão de correr da casa 116
let GATE489 = null;          // porta de madeira da casa 389 (abre para dentro para a Pantufa)
const angOf = T => Math.atan2(T.ax[2], T.ax[0]);
function P(T, u, y, v) { return [T.o[0] + u * T.ax[0] + y * T.ay[0] + v * T.az[0], T.o[1] + u * T.ax[1] + y * T.ay[1] + v * T.az[1], T.o[2] + u * T.ax[2] + y * T.ay[2] + v * T.az[2]]; }
function N(T, u, y, v) { return [u * T.ax[0] + y * T.ay[0] + v * T.az[0], u * T.ax[1] + y * T.ay[1] + v * T.az[1], u * T.ax[2] + y * T.ay[2] + v * T.az[2]]; }
// child frame rotated around local v axis (swing in the u-y plane) at a pivot
function swing(T, pu, py, pv, phi) {
  const c = Math.cos(phi), s = Math.sin(phi);
  const o = P(T, pu, py, pv);
  const ax = N(T, c, s, 0), ay = N(T, -s, c, 0);
  return { o, ax, ay, az: T.az };
}
function box(B, T, u0, u1, y0, y1, v0, v1, top, side, fl, bottom) {
  fl = fl || F_PLAIN;
  const p = (u, y, v) => P(T, u, y, v);
  B.quad(p(u0, y1, v0), p(u1, y1, v0), p(u1, y1, v1), p(u0, y1, v1), N(T, 0, 1, 0), top, fl);
  B.quad(p(u0, y0, v0), p(u0, y0, v1), p(u0, y1, v1), p(u0, y1, v0), N(T, -1, 0, 0), side, fl);
  B.quad(p(u1, y0, v0), p(u1, y1, v0), p(u1, y1, v1), p(u1, y0, v1), N(T, 1, 0, 0), side, fl);
  B.quad(p(u0, y0, v0), p(u0, y1, v0), p(u1, y1, v0), p(u1, y0, v0), N(T, 0, 0, -1), side, fl);
  B.quad(p(u0, y0, v1), p(u1, y0, v1), p(u1, y1, v1), p(u0, y1, v1), N(T, 0, 0, 1), side, fl);
  if (bottom) B.quad(p(u0, y0, v0), p(u1, y0, v0), p(u1, y0, v1), p(u0, y0, v1), N(T, 0, -1, 0), side, fl);
}
const UP = [0, 1, 0];

// ---------------- triangulation (ear clipping) ----------------
function triangulate(pts) {
  const n = pts.length; if (n < 3) return [];
  let area = 0; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const idx = []; for (let i = 0; i < n; i++) idx.push(i);
  if (area < 0) idx.reverse();
  const out = []; let guard = 0;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross(a, b, c) <= 0) continue;
      let ok = true;
      for (const j of idx) { if (j === ia || j === ib || j === ic) continue; if (inside(pts[j], a, b, c)) { ok = false; break; } }
      if (!ok) continue;
      out.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}
function flatPoly(B, pts, y, col, fl) {
  for (const [a, b, c] of triangulate(pts)) B.tri([pts[a][0], y, pts[a][1]], [pts[b][0], y, pts[b][1]], [pts[c][0], y, pts[c][1]], UP, col, fl);
}
function inPoly(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// ---------------- chunks ----------------
const CH = 100;
const chunks = new Map();
function chunkB(x, z) {
  const k = Math.floor(x / CH) + ',' + Math.floor(z / CH);
  let c = chunks.get(k);
  if (!c) { c = { B: new Builder(4096), cx: (Math.floor(x / CH) + 0.5) * CH, cz: (Math.floor(z / CH) + 0.5) * CH }; chunks.set(k, c); }
  return c.B;
}
const ground = new Builder(1 << 14);   // big ground, always drawn
const farB = new Builder(1 << 14);     // mountains & clouds (no shadow pass)

// ---------------- palettes ----------------
const C = {
  grass: hex('#6fa64a'), grass2: hex('#5f9a43'), park: hex('#7db556'), wood: hex('#3f7a37'),
  asphalt: hex('#4a4b55'), asphalt2: hex('#55565f'), dirt: hex('#a77b52'), walk: hex('#bdb6a6'), curb: hex('#d8d3c6'),
  path: hex('#c79e72'), line: hex('#f2efe4'), yline: hex('#f2c94c'), water: hex('#2f78b8'), sand: hex('#d9c48d'),
  pitch: hex('#4ea64b'), plaza: hex('#c9c3b6'), concrete: hex('#b9b4aa'), trunk: hex('#6b4a2f'),
};
const WALLS = ['#f1ece0', '#efe1b8', '#e9c9a7', '#f3d7c9', '#cfe1e6', '#d5e6cf', '#e6e3dc', '#f6e7a8', '#e8bfa1', '#d9d4ec'].map(hex);
const ROOFS = ['#b5532f', '#9a432a', '#6d717b', '#e9e6df'].map(hex);
const LEAF = ['#3d7f35', '#4c8c3a', '#2f6c33', '#5a9a40', '#467a2c'].map(hex);
const IPE = ['#e9c13a', '#d86fa8', '#a46fd0', '#f0d24a'].map(hex);
const CARS = ['#d63b2f', '#f2f2f2', '#2b2f36', '#9aa3ad', '#2e5fa8', '#c8c8c8', '#1d1d22', '#7b2f2f', '#e8e2cf'].map(hex);

// ---------------- terrain (real elevation, SRTM 30 m) ----------------
const DEM = W.dem, PJ = W.proj;
const clampN = (v, a, b) => v < a ? a : v > b ? b : v;
const sstep = (a, b, x) => { const t = clampN((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function demRaw(x, z) {
  if (!DEM) return 0;
  const lon = x / PJ.KX + PJ.lon0, lat = -z / PJ.KZ + PJ.lat0;
  const c = clampN((lon - DEM.lon0) / DEM.step - 0.5, 0, DEM.cols - 1.0001), r = clampN((DEM.lat0 - lat) / DEM.step - 0.5, 0, DEM.rows - 1.0001);
  const i = Math.floor(r), j = Math.floor(c), fr = r - i, fc = c - j;
  const g = (ii, jj) => DEM.data[clampN(ii, 0, DEM.rows - 1) * DEM.cols + clampN(jj, 0, DEM.cols - 1)] / 10;
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = k => cr(g(i + k, j - 1), g(i + k, j), g(i + k, j + 1), g(i + k, j + 2), fc);
  return cr(row(-1), row(0), row(1), row(2), fr);
}
let DEM_MEAN = 0; if (DEM) { let s = 0; for (const v of DEM.data) s += v / 10; DEM_MEAN = s / DEM.data.length; }
function demFar(x, z) { // outside the playable extent: fade towards the mean
  const cx = clampN(x, EX0, EX1), cz = clampN(z, EZ0, EZ1), d = Math.hypot(x - cx, z - cz);
  return demRaw(x, z) * (1 - sstep(500, 900, d)) + DEM_MEAN * sstep(500, 900, d);
}
function segDistT(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L ? clampN(((x - ax) * dx + (z - az) * dz) / L, 0, 1) : 0;
  return [Math.hypot(x - (ax + t * dx), z - (az + t * dz)), ax + t * dx, az + t * dz];
}
function polyEdgeDist(x, z, pts) { let b = 1e9; for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; b = Math.min(b, segDistT(x, z, a[0], a[1], c[0], c[1])[0]); } return b; }
function centroid(pts) { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; }

// road segments grid (for flattening the road beds)
const RG = 30, roadGrid = new Map();
for (const r of W.roads) {
  const reach = r.h + r.sw;
  for (let i = 0; i < r.pts.length - 1; i++) {
    const a = r.pts[i], b = r.pts[i + 1], m = reach + 16;
    for (let gx = Math.floor((Math.min(a[0], b[0]) - m) / RG); gx <= Math.floor((Math.max(a[0], b[0]) + m) / RG); gx++)
      for (let gz = Math.floor((Math.min(a[1], b[1]) - m) / RG); gz <= Math.floor((Math.max(a[1], b[1]) + m) / RG); gz++) {
        const k = gx + ',' + gz; if (!roadGrid.has(k)) roadGrid.set(k, []); roadGrid.get(k).push([a, b, reach, r.h, r.t === 'footway']);
      }
  }
}
// single road-surface field: height of the nearest road centreline (constant across the road width)
function roadSurf(x, z) {
  let best = null;
  for (const [a, b, reach, half, foot] of roadGrid.get(Math.floor(x / RG) + ',' + Math.floor(z / RG)) || []) {
    const [d, px, pz] = segDistT(x, z, a[0], a[1], b[0], b[1]);
    const e = d - reach;
    if (!best || e < best.e) best = { e, ec: d - half, px, pz, foot };
  }
  if (best) best.h = demRaw(x, z); // one continuous surface shared by every road layer
  return best;
}
function roadY(x, z) { return demRaw(x, z); }
const LAKE = W.areas.find(a => a.t === 'water');
const LAKE_LEVEL = LAKE ? Math.min(...LAKE.pts.map(p => demRaw(p[0], p[1]))) - 0.3 : 0;
const PITCH = W.areas.find(a => a.t === 'pitch');
const PITCH_H = PITCH ? PITCH.pts.reduce((s, p) => s + demRaw(p[0], p[1]), 0) / PITCH.pts.length : 0;
const CREEK = W.creek || null, CREEK2 = W.creek2 || null;
const creekD = (x, z, C) => { let d = 1e9; for (let k = 0; k < C.length - 1; k++) d = Math.min(d, segDistT(x, z, C[k][0], C[k][1], C[k + 1][0], C[k + 1][1])[0]); return d; };

const TS = 5; // terrain lattice spacing (m)
const LW = Math.ceil((EX1 - EX0) / TS) + 1, LH = Math.ceil((EZ1 - EZ0) / TS) + 1;
const LAT = new Float32Array(LW * LH), LOT = 26;   // profundidade dos lotes nivelados com a calçada (m)
for (let j = 0; j < LH; j++) for (let i = 0; i < LW; i++) {
  const x = EX0 + i * TS, z = EZ0 + j * TS;
  let h = demRaw(x, z);
  // flatten road beds
  const rs = roadSurf(x, z);
  if (rs && !rs.foot && rs.e < LOT + 10) {   // lotes ao longo das ruas ficam na altura da calçada (casas e muros alinhados com ela)
    const lot = rs.h, under = rs.h - 0.22;
    h = rs.e < 0.8 ? under : rs.e < LOT ? lot : lot + (h - lot) * sstep(LOT, LOT + 10, rs.e);
  } else if (rs && rs.e < TS + 8) {
    const target = rs.h - (rs.foot ? 0.12 : 0.22), inner = TS + 0.8;
    h = rs.e < inner ? target : target + (h - target) * sstep(inner, TS + 8, rs.e);
  }
  if (PITCH) { const inside = inPoly(x, z, PITCH.pts), d = inside ? 0 : polyEdgeDist(x, z, PITCH.pts); h = h + (PITCH_H - h) * sstep(8, 0, d); }
  if (LAKE) {
    const inside = inPoly(x, z, LAKE.pts), d = polyEdgeDist(x, z, LAKE.pts);
    if (inside) h = LAKE_LEVEL - 1.8 * sstep(0, 6, d);
    else h = Math.max(h, LAKE_LEVEL + 0.25 - Math.max(0, d - 2) * 0.35) + 0 * (h);
  }
  if (CREEK) {
    let d = 1e9; for (let k = 0; k < CREEK.length - 1; k++) d = Math.min(d, segDistT(x, z, CREEK[k][0], CREEK[k][1], CREEK[k + 1][0], CREEK[k + 1][1])[0]);
    if (d < 6) h -= 1.5 * sstep(6, 1.5, d);
  }
  if (CREEK2) { const d = creekD(x, z, CREEK2); if (d < 4.5) h -= 1.1 * sstep(4.5, 1.2, d); }   // valinha da continuação do riacho
  if (rs && rs.e < (rs.foot ? TS + 0.8 : 0.8)) h = Math.min(h, rs.h - (rs.foot ? 0.12 : 0.22));
  LAT[j * LW + i] = h;
}
// cada casa fica na altura da calçada da sua rua; o terreno em volta é rebaixado para não atravessar paredes
for (const h of W.houses) {
  const [cx, cz, w, d, ang, , , , , , , , , face] = h, setb = h[16] || 0, real = ((h[15] || 0) & 4) !== 0;
  const T0 = frame(cx, 0, cz, ang), sg = (Math.cos(face) * T0.az[0] + Math.sin(face) * T0.az[2]) > 0 ? 1 : -1;
  let S = null;
  for (let k = 0; k < 14 && S === null; k++) { const p = P(T0, 0, 0, sg * (d / 2 + (real ? setb : 2.4) + 0.5 + k)); const rs = roadSurf(p[0], p[2]); if (rs && !rs.foot && rs.e <= 0.5) S = rs.h; }
  if (S === null) continue;
  h.S = S;
  const M = 7.2, u0 = -w / 2 - M, u1 = w / 2 + M, v0 = -d / 2 - M, v1 = d / 2 + M, mvv = sg * (d / 2 + (real ? setb : 2.4));
  const ext = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => P(T0, u, 0, v));
  const xi0 = Math.max(0, Math.floor((Math.min(...ext.map(p => p[0])) - EX0) / TS)), xi1 = Math.min(LW - 1, Math.ceil((Math.max(...ext.map(p => p[0])) - EX0) / TS));
  const zi0 = Math.max(0, Math.floor((Math.min(...ext.map(p => p[2])) - EZ0) / TS)), zi1 = Math.min(LH - 1, Math.ceil((Math.max(...ext.map(p => p[2])) - EZ0) / TS));
  for (let j = zi0; j <= zi1; j++) for (let i = xi0; i <= xi1; i++) {
    const x = EX0 + i * TS - cx, z = EZ0 + j * TS - cz, u = x * T0.ax[0] + z * T0.ax[2], v = x * T0.az[0] + z * T0.az[2];
    if (u < u0 || u > u1 || v < v0 || v > v1) continue;
    const k = j * LW + i; LAT[k] = Math.min(LAT[k], S - 0.02);
  }
}
function groundAt(x, z) {
  const fx = (x - EX0) / TS, fz = (z - EZ0) / TS;
  if (fx < 0 || fz < 0 || fx >= LW - 1 || fz >= LH - 1) return demFar(x, z);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = LAT[j * LW + i], b = LAT[j * LW + i + 1], c = LAT[(j + 1) * LW + i + 1], d = LAT[(j + 1) * LW + i];
  return u >= v ? a + (b - a) * u + (c - b) * v : a + (d - a) * v + (c - d) * u;
}
function latH(i, j, x, z) { return (i >= 0 && j >= 0 && i < LW && j < LH) ? LAT[j * LW + i] : demFar(x, z); }

// terrain mesh: fine lattice inside the extent, geometric growth outside (no cracks)
{
  const xs = [], zs = [];
  const grow = (lo, hi, step0, sign, arr) => { let s = step0, v = sign > 0 ? hi : lo; const out = []; for (let k = 0; k < 14; k++) { s *= 1.7; v += sign * s; out.push(v); } return out; };
  const R = 1700, cxm = (BX0 + BX1) / 2, czm = (BZ0 + BZ1) / 2;
  const leftX = []; { let s = TS, v = EX0; while (v > cxm - R) { s = Math.min(s * 1.6, 160); v -= s; leftX.unshift(v); } }
  const rightX = []; { let s = TS, v = EX0 + (LW - 1) * TS; while (v < cxm + R) { s = Math.min(s * 1.6, 160); v += s; rightX.push(v); } }
  const topZ = []; { let s = TS, v = EZ0; while (v > czm - R) { s = Math.min(s * 1.6, 160); v -= s; topZ.unshift(v); } }
  const botZ = []; { let s = TS, v = EZ0 + (LH - 1) * TS; while (v < czm + R) { s = Math.min(s * 1.6, 160); v += s; botZ.push(v); } }
  const ix = [], iz = [];
  for (const v of leftX) { xs.push(v); ix.push(-1); }
  for (let i = 0; i < LW; i++) { xs.push(EX0 + i * TS); ix.push(i); }
  for (const v of rightX) { xs.push(v); ix.push(-1); }
  for (const v of topZ) { zs.push(v); iz.push(-1); }
  for (let j = 0; j < LH; j++) { zs.push(EZ0 + j * TS); iz.push(j); }
  for (const v of botZ) { zs.push(v); iz.push(-1); }
  const HV = new Float32Array(xs.length * zs.length);
  for (let b = 0; b < zs.length; b++) for (let a = 0; a < xs.length; a++)
    HV[b * xs.length + a] = (ix[a] >= 0 && iz[b] >= 0) ? LAT[iz[b] * LW + ix[a]] : demFar(xs[a], zs[b]);
  const wood = W.areas.filter(a => a.t === 'wood'), parks = W.areas.filter(a => a.t === 'park' || a.t === 'island'), strips = W.areas.filter(a => a.t === 'strip'), unis = W.areas.filter(a => a.t === 'uni');
  const h2 = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
  const G1 = hex('#6fa64a'), G2 = hex('#63a044'), G3 = hex('#79ad50'), DRY = hex('#9aa556'), SAND = C.sand, MUD = hex('#6e5a3a');
  function cellCol(x, z, slope, inner) {
    if (inner) {
      if (LAKE && (inPoly(x, z, LAKE.pts) || polyEdgeDist(x, z, LAKE.pts) < 3)) return [SAND, F_TEX];
      if (CREEK) { let d = 1e9; for (let k = 0; k < CREEK.length - 1; k++) d = Math.min(d, segDistT(x, z, CREEK[k][0], CREEK[k][1], CREEK[k + 1][0], CREEK[k + 1][1])[0]); if (d < 3.2) return [MUD, F_TEX]; }
      if (CREEK2 && creekD(x, z, CREEK2) < 1.3) return [MUD, F_TEX];
      if (PITCH && inPoly(x, z, PITCH.pts)) return [C.pitch, F_TEX];
      for (const a of strips) if (inPoly(x, z, a.pts)) return [hex('#4f8f3e'), F_TEX];
      for (const a of wood) if (inPoly(x, z, a.pts)) return [jit(C.wood, () => h2(x, z), 0.05), F_TEX];
      for (const a of unis) if (inPoly(x, z, a.pts)) return [C.plaza, F_TEX];
      for (const a of parks) if (inPoly(x, z, a.pts)) return [C.park, F_TEX];
    }
    const n = h2(Math.floor(x / 23), Math.floor(z / 23));
    let c = n < 0.33 ? G1 : n < 0.66 ? G2 : G3;
    if (slope > 0.12) c = [c[0] + (DRY[0] - c[0]) * 0.35, c[1] + (DRY[1] - c[1]) * 0.35, c[2] + (DRY[2] - c[2]) * 0.35];
    return [c, F_TEX];
  }
  const NX = xs.length;
  for (let b = 0; b < zs.length - 1; b++) for (let a = 0; a < NX - 1; a++) {
    const x0 = xs[a], x1 = xs[a + 1], z0 = zs[b], z1 = zs[b + 1];
    const pa = [x0, HV[b * NX + a], z0], pb = [x1, HV[b * NX + a + 1], z0], pc = [x1, HV[(b + 1) * NX + a + 1], z1], pd = [x0, HV[(b + 1) * NX + a], z1];
    const inner = ix[a] >= 0 && ix[a + 1] >= 0 && iz[b] >= 0 && iz[b + 1] >= 0;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const slope = Math.max(Math.abs(pb[1] - pa[1]) / (x1 - x0), Math.abs(pd[1] - pa[1]) / (z1 - z0));
    const [col, fl] = cellCol(cx, cz, slope, inner);
    const B = inner ? chunkB(cx, cz) : ground;
    B.tri(pa, pb, pc, faceN(pa, pb, pc, true), col, fl);
    B.tri(pa, pc, pd, faceN(pa, pc, pd, true), col, fl);
  }
  // backstop plane far below (hides any seam)
  ground.quad([cxm - 2500, -6, czm - 2500], [cxm + 2500, -6, czm - 2500], [cxm + 2500, -6, czm + 2500], [cxm - 2500, -6, czm + 2500], UP, C.grass, F_TEX);
}
// draped flat polygon (small polygons only)
function flatPolyD(B, pts, off, col, fl) {
  for (const [a, b, c] of triangulate(pts)) B.tri([pts[a][0], groundAt(pts[a][0], pts[a][1]) + off, pts[a][1]], [pts[b][0], groundAt(pts[b][0], pts[b][1]) + off, pts[b][1]], [pts[c][0], groundAt(pts[c][0], pts[c][1]) + off, pts[c][1]], UP, col, fl);
}
function surfAt(x, z) {
  const r = roadSurf(x, z);
  if (r && r.e <= 0) return r.h + (r.foot ? 0.03 : r.ec <= 0 ? 0.18 : 0.06);
  return groundAt(x, z);
}
// tilted frame that follows the ground along the heading (cars)
function groundFrame(x, z, ang, lift, len) {
  const c = Math.cos(ang), s = Math.sin(ang), L = len || 1.8;
  const hf = surfAt(x + c * L, z + s * L), hb = surfAt(x - c * L, z - s * L), hl = surfAt(x + s * 0.8, z - c * 0.8), hr = surfAt(x - s * 0.8, z + c * 0.8);
  const p = Math.atan2(hf - hb, 2 * L), cp = Math.cos(p), sp = Math.sin(p);
  const ax = [c * cp, sp, s * cp], az = [-s, 0, c];
  const ay = [az[1] * ax[2] - az[2] * ax[1], az[2] * ax[0] - az[0] * ax[2], az[0] * ax[1] - az[1] * ax[0]];
  return { o: [x, Math.max((hf + hb) / 2, (hl + hr) / 2) + (lift || 0), z], ax, ay, az };
}

// ---------------- areas ----------------
const POIS = [];
for (const a of W.areas) {
  const [cx, cz] = centroid(a.pts);
  const B = chunkB(cx, cz);
  if (a.t === 'water') {
    flatPoly(B, a.pts, LAKE_LEVEL, C.water, F_WATER);
    POIS.push({ n: 'Lago', x: cx, z: cz, y: 4 });
  } else if (a.t === 'park') POIS.push({ n: a.n, x: cx, z: cz, y: 6 });
  else if (a.t === 'uni') POIS.push({ n: 'AEDB · Dom Bosco', x: cx, z: cz, y: 14 });
  else if (a.t === 'grass') {
    for (const [i0, i1, i2] of triangulate(a.pts)) { const q = [a.pts[i0], a.pts[i1], a.pts[i2]].map(p => [p[0], roadY(p[0], p[1]) + 0.26, p[1]]); B.tri(q[0], q[1], q[2], UP, C.park, F_TEX); }
    for (let i = 0; i < a.pts.length; i++) { const p0 = a.pts[i], p1 = a.pts[(i + 1) % a.pts.length]; const y0 = roadY(p0[0], p0[1]) + 0.26, y1 = roadY(p1[0], p1[1]) + 0.26; B.quad([p0[0], y0, p0[1]], [p1[0], y1, p1[1]], [p1[0], y1 - 0.4, p1[1]], [p0[0], y0 - 0.4, p0[1]], faceN([p0[0], 0, p0[1]], [p1[0], 0, p1[1]], [p0[0], 1, p0[1]]), C.curb, F_PLAIN); }
  }
  else if (a.t === 'pitch') {
    const y = PITCH_H + 0.06;
    const p = a.pts; const L = (q0, q1, w) => {
      const dx = q1[0] - q0[0], dz = q1[1] - q0[1], l = Math.hypot(dx, dz), nx = -dz / l * w, nz = dx / l * w;
      B.quad([q0[0] - nx, y, q0[1] - nz], [q1[0] - nx, y, q1[1] - nz], [q1[0] + nx, y, q1[1] + nz], [q0[0] + nx, y, q0[1] + nz], UP, C.line, F_PLAIN);
    };
    const ins = p.map(q => [q[0] + (cx - q[0]) * 0.06, q[1] + (cz - q[1]) * 0.06]);
    for (let i = 0; i < 4; i++) L(ins[i], ins[(i + 1) % 4], 0.15);
    const d01 = Math.hypot(ins[1][0] - ins[0][0], ins[1][1] - ins[0][1]), d12 = Math.hypot(ins[2][0] - ins[1][0], ins[2][1] - ins[1][1]);
    const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (d01 > d12) L(m(ins[0], ins[1]), m(ins[2], ins[3]), 0.15); else L(m(ins[1], ins[2]), m(ins[3], ins[0]), 0.15);
    for (let i = 0; i < 24; i++) { const a0 = i / 24 * Math.PI * 2, a1 = (i + 1) / 24 * Math.PI * 2; L([cx + Math.cos(a0) * 6, cz + Math.sin(a0) * 6], [cx + Math.cos(a1) * 6, cz + Math.sin(a1) * 6], 0.13); }
    const goal = (q0, q1) => { const g = m(q0, q1), dx = q1[0] - q0[0], dz = q1[1] - q0[1]; const T = frame(g[0], PITCH_H, g[1], Math.atan2(dz, dx)); box(B, T, -3.6, -3.4, 0, 2.4, -0.1, 0.1, C.line, C.line); box(B, T, 3.4, 3.6, 0, 2.4, -0.1, 0.1, C.line, C.line); box(B, T, -3.6, 3.6, 2.3, 2.5, -0.1, 0.1, C.line, C.line); };
    if (d01 > d12) { goal(ins[1], ins[2]); goal(ins[3], ins[0]); } else { goal(ins[0], ins[1]); goal(ins[2], ins[3]); }
    POIS.push({ n: a.n || 'Campo', x: cx, z: cz, y: 5 });
  } else if (a.t === 'building') {
    const r = rngFor(cx, cz, 9);
    const pts = a.pts, hs = pts.map(p => groundAt(p[0], p[1])), y0 = Math.min(...hs) - 0.5, y1 = Math.max(...hs) + 4.2;
    flatPoly(B, pts, y1, hex('#d9d2c3'), F_TEX);
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
      const n = faceN([p0[0], 0, p0[1]], [p1[0], 0, p1[1]], [p0[0], 1, p0[1]]);
      B.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], n, jit(hex('#e7e1d2'), r, 0.03), F_PLAIN);
    }
  }
}
POIS.push({ n: 'Morada da Colina', x: W.label[0], z: W.label[1], y: 26, big: true });

// ---------------- roads (draped on the terrain) ----------------
const SEGS = [];
function strip(B, pts, half, off, col, fl, lat, hf, skirt) {
  lat = lat || 1; hf = hf || roadY;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 0.01) continue;
    const ux = dx / l, uz = dz / l, nx = -uz, nz = ux, n = Math.max(1, Math.ceil(l / 2.5));
    for (let k = 0; k < n; k++) {
      const t0 = l * k / n, t1 = l * (k + 1) / n;
      for (let q = 0; q < lat; q++) {
        const o0 = -half + 2 * half * q / lat, o1 = -half + 2 * half * (q + 1) / lat;
        const V = (t, o) => { const x = a[0] + ux * t + nx * o, z = a[1] + uz * t + nz * o; return [x, hf(x, z) + off, z]; };
        B.quad(V(t0, o1), V(t1, o1), V(t1, o0), V(t0, o0), UP, col, fl);
      }
      if (skirt) for (const sgn of [-1, 1]) {
        const o = sgn * half, x0 = a[0] + ux * t0 + nx * o, z0 = a[1] + uz * t0 + nz * o, x1 = a[0] + ux * t1 + nx * o, z1 = a[1] + uz * t1 + nz * o;
        const y0 = hf(x0, z0) + off, y1 = hf(x1, z1) + off;
        B.quad([x0, y0, z0], [x1, y1, z1], [x1, y1 - skirt, z1], [x0, y0 - skirt, z0], [nx * sgn, 0, nz * sgn], C.curb, F_PLAIN);
      }
    }
  }
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i], seg = 12, c = [x, hf(x, z) + off, z];
    for (let k = 0; k < seg; k++) {
      const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
      const p0x = x + Math.cos(a0) * half, p0z = z + Math.sin(a0) * half, p1x = x + Math.cos(a1) * half, p1z = z + Math.sin(a1) * half;
      const q0 = [p0x, hf(p0x, p0z) + off, p0z], q1 = [p1x, hf(p1x, p1z) + off, p1z];
      B.tri(c, q0, q1, UP, col, fl);
      if (skirt) B.quad(q0, q1, [q1[0], q1[1] - skirt, q1[2]], [q0[0], q0[1] - skirt, q0[2]], [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)], C.curb, F_PLAIN);
    }
  }
}
function dashed(B, pts, off, y, w, dash, gap, col) {
  if (gap === 0) { dash = 2.5; }
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 0.01) continue;
    const ux = dx / l, uz = dz / l, nx = -uz, nz = ux;
    let t = carry;
    while (t < l) {
      const t1 = Math.min(l, t + dash);
      const V = (tt, o) => { const x = a[0] + ux * tt + nx * (off + o), z = a[1] + uz * tt + nz * (off + o); return [x, roadY(x, z) + y, z]; };
      B.quad(V(t, w), V(t1, w), V(t1, -w), V(t, -w), UP, col, F_PLAIN);
      t += dash + gap;
    }
    carry = t - l;
  }
}
function trim(pts, d0, d1) {
  let L = 0; const cum = [0];
  for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(L); }
  if (L < d0 + d1 + 2) return null;
  const at = s => { for (let i = 1; i < pts.length; i++) if (cum[i] >= s) { const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; } return pts[pts.length - 1]; };
  const out = [at(d0)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > d0 && cum[i] < L - d1) out.push(pts[i]);
  out.push(at(L - d1));
  return out;
}
const ROUTES = [];
for (const r of W.roads) {
  const pts = r.pts;
  const pieces = [[pts[0]]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    pieces[pieces.length - 1].push(pts[i]);
    if ((acc > 70 || (r.real && acc > 15)) && i < pts.length - 1) { pieces.push([pts[i]]); acc = 0; }
  }
  for (const pc of pieces) {
    const [cx, cz] = centroid(pc);
    const B = chunkB(cx, cz);
    if (r.t === 'footway') { strip(B, pc, r.h, 0.03, C.path, F_TEX, 1, null, 0.5); continue; }
    if (r.sw > 0) { strip(B, pc, r.h + r.sw, 0.06, C.walk, F_TEX, 1, null, 0.9); strip(B, pc, r.h + 0.25, 0.12, C.curb, F_PLAIN); }
    const pv = r.pave || (r.real && (W.paveZones || []).some(([zx, zz, zr]) => Math.hypot(cx - zx, cz - zz) < zr));
    strip(B, pc, r.h, 0.18, pv ? hex('#8f8c84') : r.dirt ? C.dirt : (r.t === 'secondary' ? C.asphalt : r.real ? hex('#5a5b62') : C.asphalt2), pv ? F_PAVE : F_TEX, 1, null, r.sw > 0 ? 0 : 0.9);
  }
  if (r.cl && !r.dirt) { const tp = trim(pts, 7, 7); if (tp) { const [cx, cz] = centroid(tp); dashed(chunkB(cx, cz), tp, 0, 0.24, 0.08, 1e9, 0, C.yline); } }
  if (!r.dirt && !r.ring && !r.pave && !r.real) {
    const tp = trim(pts, 7, 7);
    if (tp) {
      const [cx, cz] = centroid(tp); const B = chunkB(cx, cz);
      if (r.t === 'secondary' && r.h > 4) { dashed(B, tp, 0, 0.24, 0.12, 1e9, 0, C.yline); }
      else if (r.t === 'secondary') { dashed(B, tp, 0, 0.24, 0.1, 4, 4, C.line); dashed(B, tp, r.h - 0.5, 0.24, 0.08, 1e9, 0, C.line); dashed(B, tp, -(r.h - 0.5), 0.24, 0.08, 1e9, 0, C.line); }
      else if (r.t === 'residential') dashed(B, tp, 0, 0.24, 0.08, 2.5, 3, C.yline);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) SEGS.push({ a: pts[i], b: pts[i + 1], n: r.n, t: r.t, h: r.h });
  let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if ((r.t === 'residential' || r.t === 'secondary' || r.t === 'living_street') && len > 60 && !r.ring) ROUTES.push({ pts, len, h: r.h, t: r.t });
}

// ---------------- creek (riacho) ----------------
if (CREEK) {
  const cp = trim(CREEK, 22, 22);
  if (cp) {
    for (let i = 0; i < cp.length - 1; i += 6) {
      const piece = cp.slice(i, i + 7);
      if (piece.length < 2) continue;
      const [cx, cz] = centroid(piece), B = chunkB(cx, cz);
      strip(B, piece, 1.3, 0.45, hex('#3a7fb0'), F_WATER, 2, groundAt);
      const r = rngFor(cx, cz, 11);
      for (let k = 0; k < piece.length - 1; k++) {
        const a = piece[k], b = piece[k + 1];
        for (let j = 0; j < 3; j++) {
          if (r() < 0.5) continue;
          const t = r(), side = r() < 0.5 ? -1 : 1, dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
          const x = a[0] + dx * t - dz / l * side * (1.8 + r() * 1.2), z = a[1] + dz * t + dx / l * side * (1.8 + r() * 1.2);
          const s = 0.25 + r() * 0.4, g = jit(hex('#8a8a82'), r, 0.12);
          box(B, frame(x, groundAt(x, z) - 0.1, z, r() * 3), -s, s, 0, s * 0.9, -s * 0.8, s * 0.8, g, g);
        }
      }
    }
    POIS.push({ n: 'Riacho', x: centroid(cp)[0], z: centroid(cp)[1], y: 3 });
  }
}
// continuação do riacho na faixa entre a R. Carlos Ferreira Pinto e a R. Eurycliders (passa por tubos de cimento)
if (CREEK2) {
  const cp = CREEK2;
  for (let i = 0; i < cp.length - 1; i += 5) {
    const piece = cp.slice(i, i + 6); if (piece.length < 2) continue;
    const [cx, cz] = centroid(piece), B = chunkB(cx, cz), r = rngFor(cx, cz, 12);
    strip(B, piece, 0.9, 0.45, hex('#3a7fb0'), F_WATER, 2, groundAt);
    for (let k = 0; k < piece.length - 1; k++) {
      const a = piece[k], b = piece[k + 1];
      for (let j = 0; j < 2; j++) {
        if (r() < 0.45) continue;
        const t = r(), side = r() < 0.5 ? -1 : 1, dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, o = 1.25 + r() * 0.8;
        const x = a[0] + dx * t - dz / l * side * o, z = a[1] + dz * t + dx / l * side * o, sz = 0.2 + r() * 0.3, g = jit(hex('#8a8a82'), r, 0.12);
        box(B, frame(x, groundAt(x, z) - 0.1, z, r() * 3), -sz, sz, 0, sz * 0.9, -sz * 0.8, sz * 0.8, g, g);
      }
    }
  }
}
// tubos de cimento (manilhas) com cabeceira de concreto
for (const c of (W.culverts || [])) {
  const B = chunkB(c.x, c.z), g = groundAt(c.x, c.z), yc = g + 0.55, T = frame(c.x, 0, c.z, c.a);
  const CON = hex('#a9a69d'), CON2 = hex('#8f8c84'), DARK = hex('#1c1f22'), n = 10, R0 = 0.62, R1 = 0.47, U0 = -0.35, U1 = 2.2;
  const ring = (k, r, u) => { const a = k / n * Math.PI * 2; return P(T, u, yc + Math.sin(a) * r, Math.cos(a) * r); };
  for (let k = 0; k < n; k++) {
    const a0 = ring(k, R0, U0), a1 = ring(k + 1, R0, U0), b1 = ring(k + 1, R0, U1), b0 = ring(k, R0, U1);
    B.quad(a0, a1, b1, b0, faceN(a0, a1, b1), k % 2 ? CON : CON2, F_PLAIN);                      // casca externa
    const i0 = ring(k, R1, U0), i1 = ring(k + 1, R1, U0), j1 = ring(k + 1, R1, U1), j0 = ring(k, R1, U1);
    B.quad(i0, i1, j1, j0, faceN(j0, j1, i1), DARK, F_PLAIN);                                       // interior escuro
    B.quad(a0, a1, i1, i0, N(T, -1, 0, 0), CON, F_PLAIN);                                           // borda da boca
  }
  { const cc = P(T, U1 - 0.05, yc, 0); for (let k = 0; k < n; k++) B.tri(cc, ring(k, R1, U1 - 0.05), ring(k + 1, R1, U1 - 0.05), N(T, -1, 0, 0), DARK, F_PLAIN); }
  B.quad(P(T, U0, yc - 0.3, -0.36), P(T, U1, yc - 0.3, -0.36), P(T, U1, yc - 0.3, 0.36), P(T, U0, yc - 0.3, 0.36), UP, hex('#2d5c7a'), F_PLAIN);  // fio d'água dentro
  // cabeceira de concreto em volta da boca
  const top = yc + 1.0, bot = g - 0.6;
  box(B, T, 0.15, 0.5, bot, top, -1.6, -R0, CON, CON2); box(B, T, 0.15, 0.5, bot, top, R0, 1.6, CON, CON2);
  box(B, T, 0.15, 0.5, yc + R0 - 0.05, top, -R0, R0, CON, CON2); box(B, T, 0.15, 0.5, bot, yc - R0 + 0.05, -R0, R0, CON, CON2);
  box(B, T, 0.1, 0.55, top, top + 0.12, -1.7, 1.7, hex('#bdb9ae'), CON2);
}

// ---------------- collision mask ----------------
const MR = 2;
const MW = Math.ceil((EX1 - EX0) * MR), MH = Math.ceil((EZ1 - EZ0) * MR);
const mcv = document.createElement('canvas'); mcv.width = MW; mcv.height = MH;
const mx = mcv.getContext('2d');
mx.setTransform(MR, 0, 0, MR, -EX0 * MR, -EZ0 * MR);
mx.fillStyle = '#000';
function maskRect(T, u0, u1, v0, v1) {
  const a = P(T, u0, 0, v0), b = P(T, u1, 0, v0), c = P(T, u1, 0, v1), d = P(T, u0, 0, v1);
  mx.beginPath(); mx.moveTo(a[0], a[2]); mx.lineTo(b[0], b[2]); mx.lineTo(c[0], c[2]); mx.lineTo(d[0], d[2]); mx.closePath(); mx.fill();
}
function maskCircle(x, z, r) { mx.beginPath(); mx.arc(x, z, r, 0, Math.PI * 2); mx.fill(); }
for (const a of W.areas) if (a.t === 'water' || a.t === 'building') { mx.beginPath(); a.pts.forEach((p, i) => i ? mx.lineTo(p[0], p[1]) : mx.moveTo(p[0], p[1])); mx.closePath(); mx.fill(); }

// ---------------- houses ----------------
function gableRoof(B, T, w, d, H, rh, o, col, wallCol) {
  const p = (u, y, v) => P(T, u, y, v);
  const a = p(-w / 2 - o, H - o * rh / (d / 2), -d / 2 - o), b = p(w / 2 + o, H - o * rh / (d / 2), -d / 2 - o), c = p(w / 2 + o, H + rh, 0), dd = p(-w / 2 - o, H + rh, 0);
  B.quad(a, b, c, dd, faceN(a, b, c, true), col, F_TEX);
  const e = p(-w / 2 - o, H - o * rh / (d / 2), d / 2 + o), f = p(w / 2 + o, H - o * rh / (d / 2), d / 2 + o);
  B.quad(e, f, c, dd, faceN(e, f, c, true), col, F_TEX);
  B.tri(p(-w / 2, H, -d / 2), p(-w / 2, H, d / 2), p(-w / 2, H + rh, 0), N(T, -1, 0, 0), wallCol, F_PLAIN);
  B.tri(p(w / 2, H, -d / 2), p(w / 2, H + rh, 0), p(w / 2, H, d / 2), N(T, 1, 0, 0), wallCol, F_PLAIN);
}
function hipRoof(B, T, w, d, H, rh, o, col) {
  const p = (u, y, v) => P(T, u, y, v);
  const W2 = w / 2 + o, D2 = d / 2 + o, rr = Math.max(0, W2 - D2), y0 = H - 0.15;
  const r0 = p(-rr, H + rh, 0), r1 = p(rr, H + rh, 0);
  const c00 = p(-W2, y0, -D2), c10 = p(W2, y0, -D2), c11 = p(W2, y0, D2), c01 = p(-W2, y0, D2);
  B.quad(c00, c10, r1, r0, faceN(c00, c10, r1, true), col, F_TEX);
  B.quad(c11, c01, r0, r1, faceN(c11, c01, r0, true), col, F_TEX);
  B.tri(c10, c11, r1, faceN(c10, c11, r1, true), col, F_TEX);
  B.tri(c01, c00, r0, faceN(c01, c00, r0, true), col, F_TEX);
}
function wallFeat(B, T, u0, u1, y0, y1, vf, sg, col) {
  const e = 0.04 * sg;
  B.quad(P(T, u0, y0, vf + e), P(T, u1, y0, vf + e), P(T, u1, y1, vf + e), P(T, u0, y1, vf + e), N(T, 0, 0, sg), col, F_PLAIN);
}
function sideFeat(B, T, v0, v1, y0, y1, uf, sg, col) {
  const e = 0.04 * sg;
  B.quad(P(T, uf + e, y0, v0), P(T, uf + e, y0, v1), P(T, uf + e, y1, v1), P(T, uf + e, y1, v0), N(T, sg, 0, 0), col, F_PLAIN);
}
const GLASS = hex('#2c3f58'), GLASS2 = hex('#3d5675'), SILL = hex('#f4f1ea'), DOOR = hex('#7a4b2a'), GARAGE = hex('#8d939b'), WALLGRAY = hex('#c9c5bb'), STONE = hex('#9b968b');
function cornersH(T, w, d) { const hs = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]].map(([u, v]) => { const p = P(T, u, 0, v); return groundAt(p[0], p[2]); }); return [Math.min(...hs), Math.max(...hs)]; }
for (const h of W.houses) {
  const [cx, cz, w, d, ang, floors, wc, rc, pool, px, pz, pw, pd, face, seed] = h;
  const hf = h[15] || 0, setb = h[16] || 0, real = (hf & 4) !== 0;
  const r = rngFor(cx, cz, seed);
  const B = chunkB(cx, cz);
  const T0 = frame(cx, 0, cz, ang);
  const [hmin, hmax0] = cornersH(T0, w, d), hmax = h.S !== undefined ? h.S : hmax0;   // base na altura da calçada
  const T = frame(cx, hmax + 0.05, cz, ang);
  const wall = jit(WALLS[(wc + seed) % WALLS.length], r, 0.04);
  const H = floors * 3.0;
  const sg = (Math.cos(face) * T.az[0] + Math.sin(face) * T.az[2]) > 0 ? 1 : -1;
  const vf = sg * d / 2;
  // foundation / retaining base on slopes (arrimo)
  box(B, T, -w / 2 - 0.15, w / 2 + 0.15, hmin - hmax - 0.6, 0.0, -d / 2 - 0.15, d / 2 + 0.15, STONE, STONE);
  box(B, T, -w / 2, w / 2, 0, 0.35, -d / 2 - 0.05, d / 2 + 0.05, WALLGRAY, WALLGRAY);
  box(B, T, -w / 2, w / 2, 0.35, H, -d / 2, d / 2, wall, wall);
  if (floors === 2 && r() < 0.5) box(B, T, -w / 2 - 0.05, w / 2 + 0.05, 2.9, 3.1, -d / 2 - 0.05, d / 2 + 0.05, SILL, SILL);
  const roofType = rc === 3 ? 'flat' : (r() < 0.5 ? 'gable' : 'hip');
  const rcol = jit(ROOFS[rc], r, 0.06);
  if (roofType === 'flat') {
    box(B, T, -w / 2 - 0.1, w / 2 + 0.1, H, H + 0.6, -d / 2 - 0.1, d / 2 + 0.1, hex('#d8d4cb'), wall);
    if (r() < 0.8) { const tu = (r() - 0.5) * (w - 3), tv = (r() - 0.5) * (d - 3); box(B, T, tu - 0.8, tu + 0.8, H + 0.6, H + 1.9, tv - 0.8, tv + 0.8, hex('#3b78c4'), hex('#2f66ad')); }
  } else {
    const rh = Math.min(w, d) * (roofType === 'gable' ? 0.32 : 0.3);
    if (w >= d) (roofType === 'gable' ? gableRoof(B, T, w, d, H, rh, 0.55, rcol, wall) : hipRoof(B, T, w, d, H, rh, 0.55, rcol));
    else {
      const T2 = { o: T.o, ax: T.az, ay: T.ay, az: [-T.ax[0], 0, -T.ax[2]] };
      (roofType === 'gable' ? gableRoof(B, T2, d, w, H, rh, 0.55, rcol, wall) : hipRoof(B, T2, d, w, H, rh, 0.55, rcol));
    }
    if (hf & 1) { // placas solares on one slope
      const [Tr, wr, dr] = w >= d ? [T, w, d] : [{ o: T.o, ax: T.az, ay: T.ay, az: [-T.ax[0], 0, -T.ax[2]] }, d, w];
      const yv = v => H + rh * (1 - Math.abs(v) / (dr / 2)) + 0.07;
      const v0 = -dr / 2 + 0.8, v1 = -0.7, uh = wr * (roofType === 'hip' ? 0.22 : 0.32);
      const n = Math.max(2, Math.round(uh * 2 / 1.05));
      for (let k = 0; k < n; k++) { const a = -uh + 2 * uh * k / n + 0.04, b = -uh + 2 * uh * (k + 1) / n - 0.04;
        const p0 = P(Tr, a, yv(v0), v0), p1 = P(Tr, b, yv(v0), v0), p2 = P(Tr, b, yv(v1), v1), p3 = P(Tr, a, yv(v1), v1);
        B.quad(p0, p1, p2, p3, faceN(p0, p1, p2, true), hex('#1f2f4f'), F_PLAIN); }
    }
  }
  const garage = w >= 10 && r() < 0.75;
  const gu = garage ? (r() < 0.5 ? -1 : 1) * (w / 2 - 2.1) : 0;
  const du = garage ? -gu * 0.35 : (r() - 0.5) * (w - 4);
  if (garage) wallFeat(B, T, gu - 1.5, gu + 1.5, 0.05, 2.5, vf, sg, GARAGE);
  wallFeat(B, T, du - 0.55, du + 0.55, 0.35, 2.4, vf, sg, DOOR);
  for (let f = 0; f < floors; f++) {
    const y0 = f * 3 + 1.0, y1 = f * 3 + 2.3;
    const nwin = Math.max(1, Math.floor((w - 2) / 3.2));
    for (let k = 0; k < nwin; k++) {
      const u = -w / 2 + 1.6 + (k + 0.5) * (w - 3.2) / nwin;
      const front = !(f === 0 && (Math.abs(u - du) < 1.4 || (garage && Math.abs(u - gu) < 2.2)));
      if (front) { wallFeat(B, T, u - 0.6, u + 0.6, y0, y1, vf, sg, k % 2 ? GLASS : GLASS2); wallFeat(B, T, u - 0.75, u + 0.75, y0 - 0.18, y0, vf, sg, SILL); }
      wallFeat(B, T, u - 0.6, u + 0.6, y0, y1, -vf, -sg, GLASS);
    }
    const nside = Math.max(1, Math.floor((d - 2) / 3.5));
    for (let k = 0; k < nside; k++) {
      const v = -d / 2 + 1.5 + (k + 0.5) * (d - 3) / nside;
      if (r() < 0.7) sideFeat(B, T, v - 0.5, v + 0.5, y0, y1, w / 2, 1, GLASS);
      if (r() < 0.7) sideFeat(B, T, v - 0.5, v + 0.5, y0, y1, -w / 2, -1, GLASS);
    }
  }
  // driveway draped on the ground
  const dwU = garage ? gu : du;
  const nDrive = real ? Math.ceil((setb + 1.6) / 2) : 5;
  for (let k = 0; k < nDrive; k++) {
    const va = vf + sg * 2 * k, vb = vf + sg * 2 * (k + 1);
    const D = (u, v) => { const p = P(T0, u, 0, v); return [p[0], Math.max(groundAt(p[0], p[2]), k === 0 ? 0 : -1e9) + 0.09, p[2]]; };
    B.quad(D(dwU - 1.5, va), D(dwU + 1.5, va), D(dwU + 1.5, vb), D(dwU - 1.5, vb), UP, C.concrete, F_TEX);
  }
  // front wall (muro) with a gap at the driveway
  const mv = vf + sg * (real ? setb : 2.4), mh = real ? 1.9 : r() < 0.3 ? 1.0 : 1.7, mcol = r() < 0.5 ? wall : jit(WALLGRAY, r, 0.05);
  const gap0 = dwU - 1.7, gap1 = dwU + 1.7, mu0 = real ? -w / 2 - 0.4 : -w / 2 - 1.2, mu1 = real ? w / 2 + 0.4 : w / 2 + 1.2;
  const GRAD = [hex('#f2f2ee'), hex('#1e1f22'), hex('#6b4428'), hex('#2f4a36'), hex('#8a8f96')];
  const gcol = GRAD[seed % GRAD.length];
  const muro = (u0, u1) => {
    const pa = P(T0, u0, 0, mv), pb = P(T0, u1, 0, mv);
    let ha = groundAt(pa[0], pa[2]), hb = groundAt(pb[0], pb[2]);
    const lo = Math.min(ha, hb); if (h.S !== undefined) { ha = hb = h.S; }
    if (real && (hf & 2)) { // gradil: low wall + iron bars + pillars
      const y0 = Math.min(lo, ha) - 0.6, yb = Math.max(ha, hb) + 0.7, yt = Math.max(ha, hb) + mh;
      box(B, T0, u0, u1, y0, yb, mv - 0.12, mv + 0.12, hex('#e2ddd2'), mcol);
      box(B, T0, u0, u1, yt - 0.06, yt, mv - 0.03, mv + 0.03, gcol, gcol);
      for (let u = u0 + 0.12; u < u1 - 0.05; u += 0.22) box(B, T0, u - 0.025, u + 0.025, yb, yt, mv - 0.025, mv + 0.025, gcol, gcol);
      for (const u of [u0, u1]) box(B, T0, u - 0.18, u + 0.18, y0, yt + 0.12, mv - 0.18, mv + 0.18, mcol, mcol);
    } else box(B, T0, u0, u1, Math.min(lo, ha) - 0.6, Math.max(ha, hb) + mh, mv - 0.12, mv + 0.12, hex('#e2ddd2'), mcol);
    maskRect(T0, u0, u1, mv - 0.15, mv + 0.15);
  };
  const condo = (hf & 32) !== 0;
  if (!condo && (real || r() < 0.85)) { if (gap0 > mu0) muro(mu0, gap0); if (gap1 < mu1) muro(gap1, mu1); }
  if (real && !condo) {
    // gate in the driveway gap (portão)
    const pa = P(T0, gap0, 0, mv), ga = h.S !== undefined ? h.S : groundAt(pa[0], pa[2]);
    box(B, T0, gap0, gap1, ga, ga + 2.0, mv - 0.05, mv + 0.05, gcol === GRAD[0] ? hex('#c9ccd0') : gcol, gcol);
    for (let u = gap0 + 0.2; u < gap1; u += 0.4) box(B, T0, u - 0.02, u + 0.02, ga + 0.1, ga + 1.9, mv - 0.07, mv + 0.07, hex('#00000000'.slice(0, 7)), hex('#2a2a2a'));
    maskRect(T0, gap0, gap1, mv - 0.1, mv + 0.1);
    // side walls between neighbouring lots, from the property line to the house
    for (const su of [-w / 2 - 0.4, w / 2 + 0.4]) { const pa2 = P(T0, su, 0, mv), g2r = groundAt(pa2[0], pa2[2]), g2 = h.S !== undefined ? h.S : g2r; const v0 = Math.min(mv, vf), v1 = Math.max(mv, vf); box(B, T0, su - 0.1, su + 0.1, Math.min(g2, g2r) - 0.6, g2 + 1.9, v0, v1, hex('#e2ddd2'), mcol); }
    // sacada (balcony) on sobrados
    if ((hf & 8) && floors === 2) {
      const bw = w * 0.55, bu = (r() - 0.5) * (w - bw - 1), y = 3.0;
      const vb0 = vf, vb1 = vf + sg * 1.3, lo = Math.min(vb0, vb1), hi = Math.max(vb0, vb1);
      box(B, T, bu - bw / 2, bu + bw / 2, y - 0.15, y, lo, hi, hex('#e9e5dc'), hex('#d8d3c8'));
      box(B, T, bu - bw / 2, bu + bw / 2, y + 0.95, y + 1.02, vb1 - 0.04, vb1 + 0.04, gcol, gcol);
      for (let u = bu - bw / 2 + 0.1; u < bu + bw / 2; u += 0.2) box(B, T, u - 0.02, u + 0.02, y, y + 0.95, vb1 - 0.02, vb1 + 0.02, gcol, gcol);
      for (const su of [bu - bw / 2, bu + bw / 2]) box(B, T, su - 0.02, su + 0.02, y + 0.95, y + 1.02, lo, hi, gcol, gcol);
      wallFeat(B, T, bu - 0.6, bu + 0.6, y, y + 2.2, vf, sg, hex('#5a3b26'));
    }
    // lixeira (trash basket on a pole) on the sidewalk
    if (hf & 16) {
      const lu = (gap1 < w / 2 - 0.6 ? w / 2 - 0.8 : -w / 2 + 0.8), lv = mv + sg * 0.6, p = P(T0, lu, 0, lv), gy = surfAt(p[0], p[2]);
      const TL = frame(p[0], gy, p[2], ang);
      box(B, TL, -0.03, 0.03, 0, 1.1, -0.03, 0.03, hex('#55595f'), hex('#55595f'));
      box(B, TL, -0.28, 0.28, 1.1, 1.45, -0.2, 0.2, hex('#7a7f86'), hex('#8f949a'));
      box(B, TL, -0.24, 0.24, 1.44, 1.46, -0.16, 0.16, hex('#2b2d30'), hex('#2b2d30'));
      maskCircle(p[0], p[2], 0.15); PROPS.push({ k: 'lixeira', x: p[0], z: p[2], a: ang });
    }
  }
  maskRect(T0, -w / 2, w / 2, -d / 2, d / 2);
  if (pool) {
    const P0 = frame(px, 0, pz, ang);
    const [pmin, pmax] = cornersH(P0, pd + 2, pw + 2);
    const PT = frame(px, pmax + 0.06, pz, ang);
    box(B, PT, -pd / 2 - 1, pd / 2 + 1, pmin - pmax - 0.5, 0, -pw / 2 - 1, pw / 2 + 1, hex('#e7dcc3'), STONE);
    const pq = (u, v, y) => P(PT, u, y, v);
    B.quad(pq(-pd / 2, -pw / 2, 0.03), pq(pd / 2, -pw / 2, 0.03), pq(pd / 2, pw / 2, 0.03), pq(-pd / 2, pw / 2, 0.03), UP, hex('#3fb4e0'), F_WATER);
    maskRect(PT, -pd / 2, pd / 2, -pw / 2, pw / 2);
  }
}

// ---------------- utility poles with wires (Rua Albert Sabin) ----------------
{
  const PL = W.poles || [], wire = hex('#1b1b1b');
  const tops = PL.map(([x, z, pa]) => { const y = surfAt(x, z); const B = chunkB(x, z);
    // rua mais próxima: o braço da luminária aponta para ela
    let best = null, bd = 1e9;
    for (const sg of SEGS) { if (sg.t === 'footway') continue; const [d, t] = segDistT(x, z, sg.a[0], sg.a[1], sg.b[0], sg.b[1]); if (d < bd) { bd = d; best = { sg, t }; } }
    let ra = 0;
    if (best) { const { sg, t } = best, qx = sg.a[0] + (sg.b[0] - sg.a[0]) * t, qz = sg.a[1] + (sg.b[1] - sg.a[1]) * t; ra = Math.atan2(qz - z, qx - x); if (bd < 0.3) ra = Math.atan2(sg.b[1] - sg.a[1], sg.b[0] - sg.a[0]) + Math.PI / 2; }
    if (pa !== undefined) ra = pa;   // a rua de onde o poste foi gerado
    const T = frame(x, y, z, ra);   // u = em direção à rua, v = ao longo da rua
    box(B, T, -0.14, 0.14, -0.3, 9, -0.14, 0.14, hex('#b9b6ad'), hex('#a7a49b'));
    box(B, T, -0.07, 0.07, 8.4, 8.55, -0.9, 0.9, hex('#8a8780'), hex('#8a8780'));   // cruzeta ao longo da rua
    for (const v of [-0.75, 0, 0.75]) { box(B, T, -0.05, 0.05, 8.55, 8.75, v - 0.05, v + 0.05, hex('#f0eee8'), hex('#d9d6cf')); }   // isoladores
    box(B, T, -0.2, 0.2, 6.4, 6.9, -0.2, 0.2, hex('#7e848c'), hex('#6c7279'));
    // braço curvo de iluminação pública + luminária "pétala" (como na foto)
    const ARM = hex('#9a9890'), arm = [[0.12, 6.0], [0.6, 6.25], [1.1, 6.6], [1.5, 7.05], [1.85, 7.45], [2.2, 7.65], [2.55, 7.7]];
    for (let k = 0; k < arm.length - 1; k++) beam(B, P(T, arm[k][0], arm[k][1], 0), P(T, arm[k + 1][0], arm[k + 1][1], 0), 0.08, ARM);
    box(B, T, 2.35, 3.05, 7.58, 7.74, -0.22, 0.22, hex('#c9cbc6'), hex('#aeb1ad'));   // corpo da luminária
    box(B, T, 2.45, 2.95, 7.66, 7.8, -0.17, 0.17, hex('#d8dad5'), hex('#bfc2bd'));     // tampa arredondada
    box(B, T, 2.42, 2.98, 7.52, 7.58, -0.18, 0.18, hex('#e9e4d0'), hex('#e9e4d0'));   // difusor (acende à noite)
    maskCircle(x, z, 0.2); PROPS.push({ k: 'poste', x, z, a: ra }); return [x, y, z]; });
  // liga cada poste ao vizinho mais próximo para cada lado da sua rua (antes só ligava postes seguidos na lista e alguns ficavam sem fio)
  const cross = (ax, az, bx, bz, cx, cz, dx, dz) => { const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax), d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx); return d1 * d2 < 0 && d3 * d4 < 0; };
  const crossesRoad = (ax, az, bx, bz) => SEGS.some(sg => sg.t !== 'footway' && cross(ax, az, bx, bz, sg.a[0], sg.a[1], sg.b[0], sg.b[1]));   // fio não passa por cima de rua
  const links = new Set(), pairs = [];
  PL.forEach(([x, z, pa], i) => {
    const sa = (pa !== undefined ? pa : 0) + Math.PI / 2, sx = Math.cos(sa), sz = Math.sin(sa);
    for (const dir of [1, -1]) { let best = -1, bd = 62;
      PL.forEach(([x2, z2], j) => { if (j === i) return; const dx = x2 - x, dz = z2 - z, d = Math.hypot(dx, dz); if (d < 4 || d >= bd) return; const c = (dx * sx + dz * sz) * dir / d; if (c > 0.82 && !crossesRoad(x, z, x2, z2)) { bd = d; best = j; } });
      if (best >= 0) { const k = Math.min(i, best) + ',' + Math.max(i, best); if (!links.has(k)) { links.add(k); pairs.push([i, best]); } } }
  });
  for (const [ia, ib] of pairs) {
    const a = tops[ia], b = tops[ib];
    const B = chunkB((a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
    for (const [h, off] of [[8.55, -0.8], [8.55, 0.8], [8.55, 0], [6.7, 0]]) {
      const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz), ox = -dz / l * off * 0.0 + (off ? (dz / l) * 0 : 0);
      const pa = [a[0] + (off ? -dz / l * off : 0), a[1] + h, a[2] + (off ? dx / l * off : 0)], pb = [b[0] + (off ? -dz / l * off : 0), b[1] + h, b[2] + (off ? dx / l * off : 0)];
      const n = 4; let prev = pa;
      for (let k = 1; k <= n; k++) { const t = k / n, sag = Math.sin(t * Math.PI) * 0.55; const p = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t - sag, pa[2] + (pb[2] - pa[2]) * t]; beam(B, prev, p, 0.03, wire, F_UNLIT); prev = p; }
    }
  }
  for (const lm of (W.landmarks || [])) if (lm.type === 'esquina' && !(W.landmarks || []).some(l => l.type === 'as2011' && l.id === '84')) {   // substituída pela casa 84 (Street View 2011) // casa de esquina com jardim (Albert Sabin x Cel. Bruno)
    const [ux, uz] = lm.u, [vx, vz] = lm.v;
    const WP2 = (u, v) => [lm.x + ux * u + vx * v, lm.z + uz * u + vz * v];
    const B = chunkB(...WP2(17, 17));
    const T0 = { o: [lm.x, 0, lm.z], ax: [ux, 0, uz], ay: [0, 1, 0], az: [vx, 0, vz] };
    const at2 = (u, v, lift) => { const p = WP2(u, v); return { o: [p[0], groundAt(p[0], p[1]) + (lift || 0), p[1]], ax: T0.ax, ay: T0.ay, az: T0.az }; };
    // lawn
    const U0 = 6.2, V0 = 6.2, U1 = 32, V1 = 30, n = 8;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const a0 = U0 + (U1 - U0) * i / n, a1 = U0 + (U1 - U0) * (i + 1) / n, b0 = V0 + (V1 - V0) * j / n, b1 = V0 + (V1 - V0) * (j + 1) / n;
      const q = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(([u, v]) => { const p = WP2(u, v); return [p[0], groundAt(p[0], p[1]) + 0.04, p[1]]; });
      B.quad(q[0], q[1], q[2], q[3], UP, (i + j) % 2 ? hex('#6fae4c') : hex('#76b553'), F_TEX);
    }
    // house (one storey, hip roof), set back in the lot
    const hc = at2(20, 19, 0); const [hmin, hmax] = cornersH(frame(hc.o[0], 0, hc.o[2], Math.atan2(uz, ux)), 13, 11);
    const T = { o: [hc.o[0], hmax + 0.1, hc.o[2]], ax: T0.ax, ay: T0.ay, az: T0.az }, wall = hex('#efe0c8');
    box(B, T, -6.5, 6.5, hmin - hmax - 0.5, 0.35, -5.5, 5.5, hex('#c9c5bb'), hex('#c9c5bb'));
    box(B, T, -6.5, 6.5, 0.35, 3.0, -5.5, 5.5, wall, wall);
    hipRoof(B, T, 13, 11, 3.0, 2.6, 0.7, hex('#b5532f'));
    for (const u of [-4, -1, 2.5]) wallFeat(B, T, u - 0.7, u + 0.7, 1.0, 2.3, -5.5, -1, hex('#2c3f58'));
    for (const v of [-3, 0.5, 3.5]) sideFeat(B, T, v - 0.7, v + 0.7, 1.0, 2.3, -6.5, -1, hex('#2c3f58'));
    wallFeat(B, T, 4.2, 5.4, 0.35, 2.5, -5.5, -1, hex('#7a4b2a'));
    maskRect(frame(hc.o[0], 0, hc.o[2], Math.atan2(uz, ux)), -6.5, 6.5, -5.5, 5.5);
    // palms and shrubs in the garden
    for (const [u, v, k, s2] of [[9, 9.5, 3, 1.15], [11, 22, 3, 1.0], [27, 9, 0, 1.0]]) { const p = WP2(u, v); tree(chunkB(p[0], p[1]), p[0], p[1], k, s2, true); }
    for (const [u, v] of [[8, 14], [14, 8], [8, 26]]) { const S = at2(u, v, 0); box(B, S, -0.7, 0.7, 0, 0.9, -0.7, 0.7, hex('#3f8c3a'), hex('#357a31')); PROPS.push({ k: 'arbusto', x: S.o[0], z: S.o[2], a: Math.atan2(uz, ux), s: 1.4 }); }
    // low white wall with gradil on both street sides, behind a grass verge
    const WL = (u0, v0, u1, v1) => {
      const L = Math.hypot(u1 - u0, v1 - v0), m = Math.ceil(L / 2);
      for (let k = 0; k < m; k++) { const a = WP2(u0 + (u1 - u0) * k / m, v0 + (v1 - v0) * k / m), b = WP2(u0 + (u1 - u0) * (k + 1) / m, v0 + (v1 - v0) * (k + 1) / m);
        const ya = groundAt(a[0], a[1]), yb = groundAt(b[0], b[1]);
        beam(B, [a[0], ya + 0.45, a[1]], [b[0], yb + 0.45, b[1]], 0.9, hex('#ece9e2'));
        beam(B, [a[0], ya + 1.55, a[1]], [b[0], yb + 1.55, b[1]], 0.05, hex('#f4f4f4'));
        for (let q = 0; q < 8; q++) { const t = q / 8, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, y = ya + (yb - ya) * t; beam(B, [x, y + 0.9, z], [x, y + 1.55, z], 0.035, hex('#f4f4f4')); }
        mx.beginPath(); mx.lineWidth = 0.4; mx.strokeStyle = '#000'; mx.moveTo(a[0], a[1]); mx.lineTo(b[0], b[1]); mx.stroke(); }
    };
    WL(U0, V0 + 3.5, U0, V1); WL(U0 + 3.5, V0, U1, V0);
  }
  for (const lm of (W.landmarks || [])) if (lm.type === 'sobrado9') { // sobrado de esquina Darci de Carvalho x Cel. José Fernando Bruno (Street View 10/2024)
    const [ux, uz] = lm.u, [vx, vz] = lm.v;
    const WP0 = (u, v) => [lm.x + ux * u + vx * v, lm.z + uz * u + vz * v];
    const SH = -3, WP = (u, v) => WP0(u + SH, v);           // tudo deslocado 3 m em direção à esquina
    const sideU = v => (5.5 - lm.sn[1] * v) / lm.sn[0] - SH;  // linha do muro ao longo da Cel. Bruno (esquina obtusa)
    const B = chunkB(...WP(15, 14));
    const AX = [ux, 0, uz], AZ = [vx, 0, vz];
    const at = (u, v, y) => { const p = WP(u, v); return { o: [p[0], y === undefined ? groundAt(p[0], p[1]) : y, p[1]], ax: AX, ay: [0, 1, 0], az: AZ }; };
    const gy = (u, v) => { const p = WP(u, v); return groundAt(p[0], p[1]); };
    const GREEN = hex('#cfe6a8'), GREEN2 = hex('#c6df9c'), STONEC = hex('#cdbfa9'), STONED = hex('#b3a58f'), CAP = hex('#e6e0cf'), TILE = hex('#c45a3a'), TILE2 = hex('#b44f33');
    const BROWN = hex('#5b3326'), BROWN2 = hex('#4a2a1f'), CREAM = hex('#f6efd8'), CREAM2 = hex('#e8ecc8'), BRICK = hex('#9c4a36'), WHITE = hex('#f3f1ea');
    // garden lawn + patio inside the lot
    const U1 = 24.5, V0 = 4.85, V1 = 24.5, LU = (s, v) => sideU(v) + (U1 - sideU(v)) * s;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      const s0 = i / 6, s1 = (i + 1) / 6, b0 = V0 + (V1 - V0) * j / 6, b1 = V0 + (V1 - V0) * (j + 1) / 6;
      const q = [[s0, b0], [s1, b0], [s1, b1], [s0, b1]].map(([s, v]) => { const p = WP(LU(s, v), v); return [p[0], groundAt(p[0], p[1]) + 0.05, p[1]]; });
      const patio = LU(s0, b0) >= 10 && b1 <= 9.5;
      B.quad(q[0], q[1], q[2], q[3], UP, patio ? hex('#cfc6b4') : (i + j) % 2 ? hex('#6aa64a') : hex('#72ae50'), F_TEX);
    }
    // ---- muro: painéis verde-claro entre pilares revestidos de pedra ----
    const panel = (u0, v0, u1, v1, h) => {
      const L = Math.hypot(u1 - u0, v1 - v0), m = Math.max(1, Math.round(L / 3.2));
      for (let k = 0; k < m; k++) {
        const ua = u0 + (u1 - u0) * k / m, va = v0 + (v1 - v0) * k / m, ub = u0 + (u1 - u0) * (k + 1) / m, vb = v0 + (v1 - v0) * (k + 1) / m;
        const a = WP(ua, va), b = WP(ub, vb), ya = groundAt(a[0], a[1]), yb = groundAt(b[0], b[1]), yl = Math.min(ya, yb) - 0.5, yt = Math.max(ya, yb) + h;
        const T = frame(a[0], 0, a[1], Math.atan2(b[1] - a[1], b[0] - a[0])), l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        box(B, T, 0, l, yl, Math.max(ya, yb) + 0.35, -0.16, 0.16, STONED, STONED);           // rodapé de pedra
        box(B, T, 0, l, Math.max(ya, yb) + 0.35, yt, -0.12, 0.12, CAP, k % 2 ? GREEN : GREEN2);
        box(B, T, -0.02, l + 0.02, yt, yt + 0.08, -0.17, 0.17, CAP, CAP);                    // capa
        box(B, T, -0.28, 0.28, yl, yt + 0.16, -0.24, 0.24, STONEC, STONEC);                  // pilar
        if (k === m - 1) box(B, T, l - 0.28, l + 0.28, yl, yt + 0.16, -0.24, 0.24, STONEC, STONEC);
        mx.beginPath(); mx.lineWidth = 0.5; mx.strokeStyle = '#000'; mx.moveTo(a[0], a[1]); mx.lineTo(b[0], b[1]); mx.stroke();
      }
    };
    const MV = 5.0, H = 2.15;
    panel(sideU(24.5), 24.5, sideU(6.6), 6.6, H);   // lado da Cel. Bruno
    panel(sideU(6.6), 6.6, sideU(MV) + 1.2, MV, H);  // canto chanfrado
    panel(sideU(MV) + 1.2, MV, 11.0, MV, H);         // frente, à esquerda do portão
    panel(18.3, MV, 24.5, MV, H);            // frente, à direita da portaria
    panel(24.5, MV, 24.5, 24.5, H);          // lateral direita (fecha o lote)
    panel(24.5, 24.5, sideU(24.5), 24.5, H); // fundo
    { const yard = { x: WP(0, 0)[0], z: WP(0, 0)[1], u: lm.u, v: lm.v, u0: 8.2, u1: 23.8, v0: 21.7, v1: 24.0, nu0: 0, nu1: 0, nv: -1 };   // Laica no quintal dos fundos
      const p = WP(15, 22.8); DOGS.push({ kind: 'golden', x: p[0], z: p[1], a: Math.random() * 6.28, yard, tx: p[0], tz: p[1], wait: 1, ph: 0, wag: 0, spd: 0 }); }
    // ---- portaria: pilares de pedra, portão de garagem marrom, portinha e telhadinho de barro ----
    const g0 = gy(14.5, MV), G = at(0, 0, g0);
    for (const [a, b] of [[11.0, 11.7], [15.5, 16.4], [17.5, 18.3]]) box(B, G, a, b, -0.5, 2.55, MV - 0.3, MV + 0.3, STONEC, STONEC);
    box(B, G, 11.7, 15.5, -0.1, 2.35, MV - 0.06, MV + 0.06, BROWN, BROWN);                  // portão da garagem
    for (let k = 1; k < 9; k++) box(B, G, 11.75, 15.45, k * 0.26, k * 0.26 + 0.03, MV - 0.09, MV + 0.09, BROWN2, BROWN2);
    for (const [a, b] of [[12.1, 13.4], [13.8, 15.1]]) box(B, G, a, b, 1.5, 1.8, MV - 0.1, MV + 0.1, hex('#8e7f6a'), hex('#8e7f6a'));
    box(B, G, 16.4, 17.5, -0.1, 2.3, MV - 0.06, MV + 0.06, BROWN, BROWN);                  // portinha social
    box(B, G, 16.55, 17.35, 1.5, 1.85, MV - 0.09, MV + 0.09, hex('#8e7f6a'), hex('#8e7f6a'));
    box(B, G, 15.75, 16.15, 1.6, 1.85, MV - 0.33, MV - 0.3, hex('#e9e4d6'), hex('#e9e4d6'));   // número
    box(B, G, 10.8, 18.5, 2.55, 2.7, MV - 0.55, MV + 0.55, CAP, CAP);                       // laje
    { const TR = at(14.65, MV, g0 + 2.7); hipRoof(B, TR, 7.7, 1.1, 0.0, 0.55, 0.25, TILE); }
    maskRect(at(0, 0, 0), 11.0, 18.3, MV - 0.2, MV + 0.2);
    // caixa de correio + medidor no painel da direita
    box(B, G, 19.6, 20.1, 1.0, 1.55, MV - 0.22, MV - 0.12, hex('#7a4a2c'), hex('#6a3f25'));
    box(B, G, 22.3, 22.9, 0.6, 1.1, MV - 0.18, MV - 0.12, hex('#b9b6ad'), hex('#a7a49b'));
    // ---- sobrado ----
    const hu0 = 7.6, hu1 = 24.0, hv0 = 9.0, hv1 = 21.0, hw = hu1 - hu0, hd = hv1 - hv0;
    const HC = at((hu0 + hu1) / 2, (hv0 + hv1) / 2, 0);
    const [hmin, hmax] = cornersH(HC, hw, hd);
    const T = at((hu0 + hu1) / 2, (hv0 + hv1) / 2, hmax + 0.1), u = x => x - (hu0 + hu1) / 2, v = y => y - (hv0 + hv1) / 2;
    box(B, T, -hw / 2, hw / 2, hmin - hmax - 0.5, 0.3, -hd / 2, hd / 2, hex('#c9c5bb'), hex('#c9c5bb'));
    box(B, T, -hw / 2, hw / 2, 0.3, 3.1, v(hv0 + 0.4), hd / 2, CREAM2, CREAM2);              // térreo
    box(B, T, -hw / 2 - 0.1, hw / 2 + 0.1, 3.0, 3.3, v(hv0) - 0.6, hd / 2 + 0.1, CAP, CAP); // laje da varanda
    box(B, T, -hw / 2, hw / 2, 3.3, 6.1, v(hv0 + 1.8), hd / 2, CREAM, CREAM);               // andar de cima recuado
    // beiral de telha entre os andares, lado da Rua Nove A
    { const Ts = { o: P(T, -hw / 2 - 0.5, 3.15, 0), ax: [-AX[0], 0, -AX[2]], ay: [0, 1, 0], az: AZ };
      const q = (a, y, b) => P(Ts, a, y, b); B.quad(q(-0.05, 0.25, -hd / 2), q(-0.05, 0.25, hd / 2), q(0.75, -0.15, hd / 2), q(0.75, -0.15, -hd / 2), UP, TILE2, F_TEX); }
    // varanda de cima: colunas, arcos e balaústre branco trabalhado
    const vf = v(hv0) - 0.45, vw = v(hv0 + 1.8);
    const cols = [];
    for (let k = 0; k <= 5; k++) cols.push(-hw / 2 + 0.3 + (hw - 0.6) * k / 5);
    for (const cu of cols) box(B, T, cu - 0.17, cu + 0.17, 3.3, 5.75, vf - 0.17, vf + 0.17, WHITE, hex('#e8e4d8'));
    box(B, T, -hw / 2, hw / 2, 5.75, 6.15, vf - 0.2, vw, CAP, WHITE);                        // viga
    for (let k = 0; k < cols.length - 1; k++) { const a = cols[k] + 0.17, b = cols[k + 1] - 0.17, m = (a + b) / 2, s = (b - a) / 2;
      for (let j = 0; j < 4; j++) { const t = (j + 1) / 5, h = 5.75 - 0.42 * Math.sqrt(1 - t * t) * 0 - 0.42 * (1 - Math.sqrt(1 - t * t * 0.95)) - 0.08 * j; // arcos
        box(B, T, m - s, m - s * t, h - 0.12, 5.75, vf - 0.13, vf + 0.13, WHITE, WHITE); box(B, T, m + s * t, m + s, h - 0.12, 5.75, vf - 0.13, vf + 0.13, WHITE, WHITE); } }
    for (let k = 0; k < cols.length - 1; k++) { const a = cols[k] + 0.17, b = cols[k + 1] - 0.17;
      box(B, T, a, b, 4.25, 4.35, vf - 0.08, vf + 0.08, WHITE, WHITE); box(B, T, a, b, 3.3, 3.4, vf - 0.06, vf + 0.06, WHITE, WHITE);
      for (let q = a + 0.12; q < b - 0.05; q += 0.3) { box(B, T, q - 0.035, q + 0.035, 3.4, 4.25, vf - 0.03, vf + 0.03, WHITE, WHITE); box(B, T, q - 0.11, q + 0.11, 3.75, 3.9, vf - 0.025, vf + 0.025, WHITE, WHITE); } }
    // portas-janelas em arco, marrom escuro com venezianas
    const archWin = (cu, y0, y1, wv, sg, side) => {
      const F = side ? (a, b, c, d) => sideFeat(B, T, a, b, c, d, wv, sg, BROWN2) : (a, b, c, d) => wallFeat(B, T, a, b, c, d, wv, sg, BROWN2);
      F(cu - 0.6, cu + 0.6, y0, y1 - 0.3); F(cu - 0.45, cu + 0.45, y1 - 0.3, y1 - 0.1); F(cu - 0.25, cu + 0.25, y1 - 0.1, y1);
      const S = side ? (a, b) => sideFeat(B, T, a, b, y0, y1 - 0.3, wv, sg, BROWN) : (a, b) => wallFeat(B, T, a, b, y0, y1 - 0.3, wv, sg, BROWN);
      S(cu - 1.0, cu - 0.65); S(cu + 0.65, cu + 1.0);
    };
    for (let k = 0; k < cols.length - 1; k++) if (k !== 3) archWin((cols[k] + cols[k + 1]) / 2, 3.3, 5.6, vw, -1);
    for (const cu of [-4.5, 0, 4.5]) archWin(cu, 0.6, 2.7, v(hv0 + 0.4), -1);
    for (const cv of [-3.5, 1, 4.5]) { archWin(cv, 3.4, 5.6, -hw / 2, -1, true); archWin(cv, 0.7, 2.7, -hw / 2, -1, true); }
    // colunas de tijolinho
    for (const bu of [cols[3] + 0.9]) { box(B, T, bu - 0.3, bu + 0.3, 3.3, 5.75, vw - 0.05, vw + 0.3, BRICK, BRICK); box(B, T, bu - 0.3, bu + 0.3, 0.3, 3.0, v(hv0 + 0.4) - 0.3, v(hv0 + 0.4), BRICK, BRICK); }
    box(B, T, hw / 2 - 1.6, hw / 2 - 0.9, 4.9, 5.35, vw - 0.25, vw, hex('#e9e9e4'), hex('#d6d6d0'));     // ar-condicionado
    // telhado de barro em quatro águas + chaminé de tijolo
    hipRoof(B, T, hw, hd, 6.15, 2.3, 0.8, TILE);
    box(B, T, 1.6, 2.5, 6.6, 9.1, -1.5, -0.6, BRICK, BRICK); box(B, T, 1.45, 2.65, 9.1, 9.3, -1.65, -0.45, hex('#6c3426'), hex('#6c3426'));
    maskRect(at(0, 0, 0), hu0, hu1, hv0, hv1);
    // coqueiro no canto do jardim, árvore escura ao fundo, plantas junto ao muro
    { const p = WP(8.4, 7.6); tree(chunkB(p[0], p[1]), p[0], p[1], 3, 1.25, true); }
    { const p = WP(sideU(22) + 2.5, 22); tree(chunkB(p[0], p[1]), p[0], p[1], 0, 1.1, true); }
    for (const [pu, pv] of [[19.5, 6.0], [22.5, 6.2], [sideU(12) + 1.2, 12], [sideU(16) + 1.2, 16]]) { const S = at(pu, pv); box(B, S, -0.5, 0.5, 0, 0.8, -0.5, 0.5, hex('#4c8f3d'), hex('#3f7c33'), F_TEX); PROPS.push({ k: 'arbusto', x: S.o[0], z: S.o[2], a: Math.atan2(uz, ux), s: 1.0 }); }
  }
  for (const lm of (W.landmarks || [])) if (lm.type === 'as2011') {   // casas 369, 84 e 489 da R. Albert Sabin (Street View 10/2011)
    const [ux, uz] = lm.u, [vx, vz] = lm.v, WP = (u, v) => [lm.x + ux * u + vx * v, lm.z + uz * u + vz * v];
    const AX = [ux, 0, uz], AZ = [vx, 0, vz], AZ2 = [-vz, 0, vx];
    const at = (u, v, y) => { const p = WP(u, v); return { o: [p[0], y === undefined ? groundAt(p[0], p[1]) : y, p[1]], ax: AX, ay: [0, 1, 0], az: AZ }; };
    const atR = (u, v, y) => { const p = WP(u, v); return { o: [p[0], y, p[1]], ax: AZ, ay: [0, 1, 0], az: AZ2 }; };   // girado: eixo ao longo da profundidade
    const B = chunkB(...WP((lm.u0 + lm.u1) / 2, 12)), r = rngFor(lm.x, lm.z, 2011), MV = 4.9, T0 = at(0, 0, 0);
    const gp = (u, v) => { const p = WP(u, v); return groundAt(p[0], p[1]); };
    const gmin = (u0, u1, v0, v1) => Math.min(gp(u0, v0), gp(u1, v0), gp(u0, v1), gp(u1, v1));
    const gmax = (u0, u1, v0, v1) => Math.max(gp(u0, v0), gp(u1, v0), gp(u0, v1), gp(u1, v1));
    const mline = (u0, v0, u1, v1) => { mx.beginPath(); mx.lineWidth = 0.5; const p0 = WP(u0, v0), p1 = WP(u1, v1); mx.moveTo(p0[0], p0[1]); mx.lineTo(p1[0], p1[1]); mx.stroke(); };
    // muro ao longo da rua (u) ou de lado (v), em pedaços que acompanham o terreno
    const wallU = (u0, u1, v, h, c, c2, th = 0.1) => { const n = Math.max(1, Math.ceil((u1 - u0) / 3.5)); for (let k = 0; k < n; k++) { const a = u0 + (u1 - u0) * k / n, b = u0 + (u1 - u0) * (k + 1) / n; box(B, at(0, 0, gmin(a, b, v, v)), a, b, -0.6, h, v - th, v + th, c, c2 || c); } maskRect(T0, u0, u1, v - th - 0.05, v + th + 0.05); mline(u0, v, u1, v); };
    const wallV = (u, v0, v1, h, c, c2, th = 0.1) => { const n = Math.max(1, Math.ceil((v1 - v0) / 3.5)); for (let k = 0; k < n; k++) { const a = v0 + (v1 - v0) * k / n, b = v0 + (v1 - v0) * (k + 1) / n; box(B, at(0, 0, gmin(u, u, a, b)), u - th, u + th, -0.6, h, a, b, c, c2 || c); } maskRect(T0, u - th - 0.05, u + th + 0.05, v0, v1); mline(u, v0, u, v1); };
    const win = (T, u0, u1, y0, y1, v, sg, grille) => {   // janela na face v (sg = lado de fora)
      wallFeat(B, T, u0 - 0.08, u1 + 0.08, y0 - 0.08, y1 + 0.08, v, sg, hex('#f2efe6')); wallFeat(B, T, u0, u1, y0, y1, v + sg * 0.01, sg, hex('#2d3a46'));
      if (grille) for (let gu = u0 + 0.12; gu < u1 - 0.05; gu += 0.16) wallFeat(B, T, gu, gu + 0.035, y0, y1, v + sg * 0.02, sg, hex('#eef0ec'));
      wallFeat(B, T, u0 - 0.12, u1 + 0.12, y0 - 0.14, y0 - 0.06, v + sg * 0.02, sg, hex('#f4f1ea'));
    };
    const winS = (T, v0, v1, y0, y1, u, sg) => { sideFeat(B, T, v0 - 0.08, v1 + 0.08, y0 - 0.08, y1 + 0.08, u, sg, hex('#f2efe6')); sideFeat(B, T, v0, v1, y0, y1, u + sg * 0.01, sg, hex('#2d3a46')); };
    const body = (u0, u1, v0, v1, h, wc) => { const g = gmin(u0, u1, v0, v1), T = at(0, 0, g); box(B, T, u0, u1, -0.6, h + (gmax(u0, u1, v0, v1) - g), v0, v1, wc, wc); maskRect(T0, u0, u1, v0, v1); return { T, g, top: h + (gmax(u0, u1, v0, v1) - g) }; };
    const TILE = hex('#b4573b'), TILE2 = hex('#c0663f');
    if (lm.id === '84') {   // casa térrea comprida na esquina com a Cel. Bruno, muro branco-acinzentado manchado
      const WL = hex('#d3cfc6'), WL2 = hex('#c4c0b6'), GR = hex('#a29e95');
      wallU(-27, -6.6, MV, 1.9, WL, WL2);
      for (let k = 0; k < 9; k++) { const u0 = -26 + r() * 19, y0 = 0.2 + r() * 1.2; wallFeat(B, at(0, 0, gp(u0, MV)), u0, u0 + 0.4 + r() * 1.4, y0, y0 + 0.2 + r() * 0.5, MV - 0.1, -1, r() < 0.5 ? GR : hex('#b9b5ab')); }   // manchas de mofo
      for (let u = -27; u < -6.6; u += 3.5) wallFeat(B, at(0, 0, gp(u, MV)), u, Math.min(-6.6, u + 3.5), 0, 0.3, MV - 0.1, -1, hex('#9a968d'));
      { const g = gp(-6.1, MV), T = at(0, 0, g); box(B, T, -6.6, -5.0, -0.6, 2.15, MV - 0.18, MV + 0.18, hex('#bdbab3'), hex('#b2afa8'));   // pilar da esquina
        box(B, T, -6.3, -5.85, 1.05, 1.6, MV - 0.26, MV - 0.18, hex('#8b8c89'), hex('#7c7d7a')); box(B, T, -5.75, -5.35, 1.2, 1.5, MV - 0.24, MV - 0.18, hex('#6f706d'), hex('#6f706d')); maskRect(T0, -6.6, -5.0, MV - 0.3, MV + 0.2); }
      // lado da Cel. Bruno: um trecho de muro e depois grade marrom sobre mureta, com o jardim de grama
      wallV(-5.1, MV, 6.6, 1.9, WL, WL2);
      { const FE = hex('#6a4a38'), LW = hex('#cbc6bc');
        wallV(-5.1, 6.6, 22, 0.45, LW, LW, 0.12);
        for (let v = 6.6; v < 22; v += 0.16) { const g = gp(-5.1, v), T = at(0, 0, g); box(B, T, -5.13, -5.07, 0.45, 1.75, v, v + 0.035, FE, FE); }
        for (let v = 6.6; v <= 22.01; v += 2.2) { const g = gp(-5.1, v), T = at(0, 0, g); box(B, T, -5.17, -5.03, 0, 1.85, v - 0.07, v + 0.07, FE, FE); }
        for (const y of [0.55, 1.7]) { const g = gmin(-5.1, -5.1, 6.6, 22); box(B, at(0, 0, g), -5.14, -5.06, y, y + 0.05, 6.6, 22, FE, FE); } }
      wallV(-5.1, 22, 24, 1.9, WL, WL2); wallU(-27, -5.1, 24, 1.9, hex('#c9c5bb')); wallV(-27, MV, 24, 1.9, hex('#c9c5bb'));
      // casa: bloco principal + ala virada para a Cel. Bruno, telhado de quatro águas
      const CW = hex('#eadfc2');
      const M = body(-24.5, -11, 9, 18.5, 3.0, CW), Mc = at((-24.5 - 11) / 2, (9 + 18.5) / 2, M.g);
      hipRoof(B, Mc, 13.5, 9.5, M.top, 1.7, 0.7, TILE);
      const E = body(-11, -7.2, 10.5, 18.5, 3.0, CW), Ec = at((-11 - 7.2) / 2, 14.5, E.g);
      hipRoof(B, { o: Ec.o, ax: AZ, ay: [0, 1, 0], az: AZ2 }, 8, 3.8, E.top, 1.3, 0.6, TILE2);
      for (const [a, b] of [[-23, -21.6], [-19.5, -18.1], [-15.5, -14.1]]) win(M.T, a, b, 1.0, 2.2, 9, -1, true);
      wallFeat(B, M.T, -17.4, -16.4, 0, 2.2, 9, -1, hex('#7a4b2a'));                                                // porta
      for (const [a, b] of [[11.5, 12.7], [15, 16.2]]) { winS(E.T, a, b, 0.9, 2.1, -7.2, 1); sideFeat(B, E.T, a + 0.15, b - 0.15, 2.1, 2.35, -7.19, 1, hex('#2d3a46')); sideFeat(B, E.T, a + 0.35, b - 0.35, 2.35, 2.5, -7.19, 1, hex('#2d3a46')); }   // janelas em arco
      // varanda com colunas na frente do bloco principal
      { const g = M.g, T = at(0, 0, g); box(B, T, -22.5, -12.5, 2.75, 2.95, 7.0, 9.0, TILE, TILE); box(B, T, -22.6, -12.4, 2.95, 3.05, 7.6, 9.0, TILE2, TILE2);
        for (const u of [-22.2, -19, -16, -12.8]) box(B, T, u - 0.12, u + 0.12, -0.3, 2.75, 7.1, 7.35, hex('#f3ede0'), hex('#e6dfd0'));
        const q = [[-22.5, 7.0], [-12.5, 7.0], [-12.5, 9], [-22.5, 9]].map(([u, v]) => { const p = WP(u, v); return [p[0], g + 0.06, p[1]]; }); B.quad(q[0], q[1], q[2], q[3], UP, hex('#b8a48d'), F_TEX); }
      for (const [u, v] of [[-9, 6.5], [-6.5, 20], [-26, 21]]) { const S = at(u, v); box(B, S, -0.6, 0.6, 0, 0.9, -0.6, 0.6, hex('#4c8f3d'), hex('#3f7c33'), F_TEX); }
    } else if (lm.id === '369') {   // muro de blocos sem reboco, portão azul descascado, casa creme recuada
      const BL = hex('#b4a58f'), BL2 = hex('#a99a84'), PIL = hex('#cbc4b7'), CAP = hex('#a85537');
      const pillar = u => { const g = gp(u, MV), T = at(0, 0, g); box(B, T, u - 0.2, u + 0.2, -0.6, 2.15, MV - 0.18, MV + 0.18, PIL, PIL); box(B, T, u - 0.26, u + 0.26, 2.15, 2.27, MV - 0.24, MV + 0.24, CAP, CAP); };
      wallU(-7, -6.1, MV, 2.0, PIL); pillar(-7);
      { const g = gp(-5.6, MV), T = at(0, 0, g); box(B, T, -6.1, -5.15, -0.6, 2.0, MV - 0.05, MV + 0.05, hex('#5d8fb4'), hex('#4f7fa3')); maskRect(T0, -6.1, -5.15, MV - 0.1, MV + 0.1); }   // portinha azul
      wallU(-5.15, -1.35, MV, 2.0, BL, BL2);
      for (let u = -5.15; u < -1.35; u += 0.4) for (let y = 0.0; y < 2.0; y += 0.2) { const k = Math.round(y / 0.2) % 2; const T = at(0, 0, gp(u, MV)); wallFeat(B, T, u + k * 0.2, Math.min(-1.35, u + k * 0.2 + 0.015), y, y + 0.2, MV - 0.1, -1, hex('#958873')); wallFeat(B, T, u, Math.min(-1.35, u + 0.4), y, y + 0.015, MV - 0.1, -1, hex('#958873')); }
      for (const u of [-5.15, -3.25, -1.35]) pillar(u);
      { const g = gp(0.5, MV), T = at(0, 0, g), BLU = hex('#5f93b6');                     // portão de garagem azul, tinta descascando
        box(B, T, -1.35, 2.45, -0.6, 2.0, MV - 0.06, MV + 0.06, BLU, hex('#4f80a2')); maskRect(T0, -1.35, 2.45, MV - 0.1, MV + 0.1);
        for (let k = 0; k < 14; k++) { const u0 = -1.2 + r() * 3.3, y0 = 0.15 + r() * 1.6; wallFeat(B, T, u0, Math.min(2.4, u0 + 0.1 + r() * 0.35), y0, y0 + 0.08 + r() * 0.3, MV - 0.06, -1, r() < 0.6 ? hex('#a9c8dc') : hex('#8a7a66')); }
        for (let u = -1.1; u < 2.4; u += 0.45) wallFeat(B, T, u, u + 0.03, 0.1, 1.95, MV - 0.065, -1, hex('#4a7896')); }
      pillar(2.45);
      wallV(-7, MV, 26, 2.0, hex('#c9c5bb')); wallV(2.6, MV, 26, 2.0, hex('#c9c5bb')); wallU(-7, 2.6, 26, 2.0, hex('#c9c5bb'));
      // casa creme: corpo com telhado de duas águas paralelo à rua + volume da frente com a empena virada para a rua
      const CW = hex('#efe3c8');
      const M = body(-6, 1.9, 10, 19, 3.0, CW); gableRoof(B, at(-2.05, 14.5, M.g), 7.9, 9, M.top, 1.6, 0.6, TILE, CW);
      const F = body(-6, -1.2, 7.5, 10, 3.0, CW); gableRoof(B, atR(-3.6, 8.75, F.g), 2.5, 4.8, F.top, 1.3, 0.5, TILE2, CW);
      win(F.T, -4.6, -2.6, 1.0, 2.2, 7.5, -1, true); win(M.T, -0.2, 1.4, 1.0, 2.2, 10, -1, true);
      { const q = [[-1.35, MV + 0.1], [2.45, MV + 0.1], [2.45, 10], [-1.35, 10]].map(([u, v]) => { const p = WP(u, v); return [p[0], groundAt(p[0], p[1]) + 0.07, p[1]]; }); B.quad(q[0], q[1], q[2], q[3], UP, hex('#aaa79e'), F_TEX); }   // garagem

    } else if (lm.id === '389') {   // fachada do print de 2026: muro bege frisado, número 389, porta recuada com degraus, portão de madeira marrom
      const BG = hex('#dcc89c'), BG2 = hex('#cdb98e'), FR = hex('#b9a57c'), CAPC = hex('#c9b78f'), STAIN = hex('#a99e83'), WD = hex('#5b3a27'), WD2 = hex('#4a2f1f'), WD3 = hex('#6b4630');
      const frisos = (T, u0, u1, y1, v) => { for (let y = 0.35; y < y1 - 0.1; y += 0.36) wallFeat(B, T, u0, u1, y, y + 0.025, v, -1, FR); };
      const seg = (u0, u1, h, th = 0.12) => { const T = at(0, 0, gmin(u0, u1, MV, MV)); box(B, T, u0, u1, -0.6, h, MV - th, MV + th, BG, BG2); maskRect(T0, u0, u1, MV - th - 0.05, MV + th + 0.05); mline(u0, MV, u1, MV); frisos(T, u0, u1, h, MV - th); wallFeat(B, T, u0, u1, 0, 0.3, MV - th - 0.005, -1, STAIN); return T; };
      const cap = (T, u0, u1, y, o = 0.06) => box(B, T, u0 - o, u1 + o, y, y + 0.12, MV - 0.2, MV + 0.16, CAPC, BG2);
      const pilar = (u0, u1, h) => { const T = at(0, 0, gmin(u0, u1, MV, MV)); box(B, T, u0, u1, -0.6, h, MV - 0.2, MV + 0.16, BG, BG2); maskRect(T0, u0, u1, MV - 0.25, MV + 0.2); for (let y = 0.35; y < h - 0.1; y += 0.36) wallFeat(B, T, u0, u1, y, y + 0.025, MV - 0.2, -1, FR); return T; };
      // trecho esquerdo com o número, a caixa de correio preta e a caixinha cinza
      const TA = seg(2.6, 4.75, 2.25); cap(TA, 2.6, 4.75, 2.25, 0.02);
      wallFeat(B, TA, 3.6, 4.4, 1.15, 1.55, MV - 0.12, -1, hex('#2b2d30'));                  // caixa de correio
      wallFeat(B, TA, 3.0, 3.2, 1.25, 1.55, MV - 0.12, -1, hex('#8d8a82'));
      wallFeat(B, TA, 3.05, 3.35, 0.28, 0.48, MV - 0.12, -1, hex('#55524c'));                  // respiro
      { // "389" em relevo escuro, em segmentos
        const D = hex('#6e675a'), x0 = 3.55, y0 = 1.72, w = 0.13, h = 0.24, t = 0.025;
        const segs = { 3: 'abcdg', 8: 'abcdefg', 9: 'abcdfg' };
        [3, 8, 9].forEach((dg, i) => { const ux = x0 + i * (w + 0.06); for (const c of segs[dg]) {
          const r_ = { a: [0, w, h - t, h], b: [w - t, w, h / 2, h], c: [w - t, w, 0, h / 2], d: [0, w, 0, t], e: [0, t, 0, h / 2], f: [0, t, h / 2, h], g: [0, w, h / 2 - t / 2, h / 2 + t / 2] }[c];
          wallFeat(B, TA, ux + r_[0], ux + r_[1], y0 + r_[2], y0 + r_[3], MV - 0.125, -1, D); } }); }
      // porta de madeira recuada, com dois degraus na frente
      { const u0 = 4.75, u1 = 5.85, g = gmin(u0, u1, MV, MV), T = at(0, 0, g);
        box(B, T, u0, u1, 2.15, 2.5, MV - 0.12, MV + 0.12, BG, BG2);                            // verga
        for (const [a, b] of [[u0, u0 + 0.12], [u1 - 0.12, u1]]) box(B, T, a, b, -0.6, 2.15, MV - 0.12, MV + 0.45, BG, BG2);
        GATE489 = { T: at(u0 + 0.12, MV + 0.44, g), L: u1 - u0 - 0.24, open: 0, want: 0, WP, door: true, WD, WD2 };   // porta: desenhada a cada quadro (abre para a Pantufa)
        box(B, T, u0 - 0.1, u1 + 0.1, -0.6, 0.13, MV - 0.55, MV + 0.4, hex('#b9b4a8'), hex('#a9a498'));   // degraus
        box(B, T, u0 + 0.05, u1 - 0.05, 0.13, 0.25, MV - 0.25, MV + 0.4, hex('#b9b4a8'), hex('#a9a498'));
        maskRect(T0, u0, u0 + 0.12, MV - 0.12, MV + 0.5); maskRect(T0, u1 - 0.12, u1, MV - 0.12, MV + 0.5); }
      // trecho mais alto à direita da porta (frontão), terminando em rampa até o pilar do portão
      const TB = seg(5.85, 8.25, 2.45); cap(TB, 4.75, 7.75, 2.5, 0.02);
      { const T = TB; for (let k = 0; k < 6; k++) { const a = 7.75 + k * 0.083, y = 2.5 - k * 0.06; box(B, T, a, a + 0.09, y - 0.1, y + 0.12, MV - 0.2, MV + 0.16, CAPC, BG2); }   // capa descendo em rampa
        box(B, T, 7.75, 8.25, 2.45, 2.5, MV - 0.12, MV + 0.12, BG, BG2);
        for (let k = 0; k < 7; k++) { const u0 = 6 + r() * 2, y0 = 0.4 + r() * 1.4; wallFeat(B, T, u0, u0 + 0.2 + r() * 0.5, y0, y0 + 0.1 + r() * 0.3, MV - 0.125, -1, r() < 0.5 ? STAIN : hex('#ddd3b8')); } }
      // pilares + viga sobre o portão de madeira de correr (tábuas na diagonal)
      const TP1 = pilar(8.3, 8.85, 2.35), TP2 = pilar(12.45, 13.4, 2.35);
      { const T = at(0, 0, gmin(8.3, 13.4, MV, MV)); box(B, T, 8.2, 13.5, 2.35, 2.62, MV - 0.28, MV + 0.16, CAPC, BG2); }
      { const u0 = 8.85, u1 = 12.45, T = at(0, 0, gmin(u0, u1, MV, MV)), h = 2.3;
        box(B, T, u0, u1, 0.03, h, MV - 0.04, MV + 0.06, WD, WD2); maskRect(T0, u0, u1, MV - 0.1, MV + 0.1);
        box(B, T, u0, u1, h - 0.28, h - 0.24, MV - 0.06, MV - 0.04, WD2, WD2);                    // tábua de cima
        for (let y = 0.05; y < h - 0.3; y += 0.09) for (let k = -12; k < 30; k++) { const a = u0 + k * 0.3 + y * 1.1; if (a < u0 || a + 0.05 > u1) continue; wallFeat(B, T, a, a + 0.05, y, y + 0.09, MV - 0.04, -1, (k % 3) ? WD2 : WD3); }
        const q = [[u0, MV + 0.1], [u1, MV + 0.1], [u1, 9], [u0, 9]].map(([u, v]) => { const p = WP(u, v); return [p[0], groundAt(p[0], p[1]) + 0.07, p[1]]; }); B.quad(q[0], q[1], q[2], q[3], UP, hex('#aaa79e'), F_TEX); }
      wallV(13.4, MV, 26, 2.0, hex('#c9c5bb')); wallU(2.6, 13.6, 26, 2.0, hex('#c9c5bb'));
      // casa térrea creme, telhado de quatro águas, aparecendo por cima do muro
      { const CW = hex('#eadcbc'); const M = body(3.2, 12.8, 9.5, 19, 3.1, CW); hipRoof(B, at(8.0, 14.25, M.g), 9.6, 9.5, M.top, 1.7, 0.7, TILE);
        win(M.T, 4.2, 5.6, 1.0, 2.2, 9.5, -1, true); wallFeat(B, M.T, 6.4, 7.4, 0, 2.2, 9.5, -1, hex('#7a4b2a')); }
      { const p = WP(3.2, 3.4); tree(chunkB(p[0], p[1]), p[0], p[1], 0, 0.85, true); }       // árvore na calçada, à esquerda
    } else if (lm.id === '489') {   // sobrado verde-menta (prints 2022/2024): garagem com quarto aberto em cima à esquerda, varanda elevada, grade branca
      const MT = hex('#b5d1c2'), MT2 = hex('#a6c3b4'), MTD = hex('#94b2a3'), RAIL = hex('#eef0ec'), RAIL2 = hex('#dfe2de'), DK = hex('#33393d');
      const pil = (u, w, h) => { const T = at(0, 0, gp(u, MV)); box(B, T, u - w, u + w, -0.6, h, MV - w, MV + w, MT, MT2); box(B, T, u - w - 0.04, u + w + 0.04, h, h + 0.08, MV - w - 0.04, MV + w + 0.04, MTD, MTD); box(B, T, u - 0.05, u + 0.05, h + 0.08, h + 0.3, MV - 0.05, MV + 0.05, RAIL, RAIL); maskRect(T0, u - w, u + w, MV - w, MV + w); };
      const bars = (u0, u1, y0, y1, step, tips) => { for (let u = u0 + step / 2; u < u1; u += step) { const T = at(0, 0, gp(u, MV)); box(B, T, u - 0.017, u + 0.017, y0, y1, MV - 0.017, MV + 0.017, RAIL, RAIL2); if (tips) box(B, T, u - 0.04, u + 0.04, y1, y1 + 0.12, MV - 0.03, MV + 0.03, RAIL, RAIL2); } };
      const rails = (u0, u1, ys) => { const T = at(0, 0, gmin(u0, u1, MV, MV)); for (const y of ys) box(B, T, u0, u1, y, y + 0.045, MV - 0.025, MV + 0.025, RAIL, RAIL2); };
      // frente: portão de correr da garagem, portãozinho, mureta verde com grade branca
      pil(-6.25, 0.25, 2.1);
      bars(-6.0, -1.55, 0.05, 1.95, 0.14, true); rails(-6.0, -1.55, [0.05, 0.95, 1.85]); maskRect(T0, -6.0, -1.55, MV - 0.05, MV + 0.05);
      { const T = at(0, 0, gp(-3.8, MV)); box(B, T, -3.95, -3.65, 0.9, 1.15, MV - 0.04, MV - 0.02, hex('#f4f4f2'), hex('#f4f4f2')); }   // placa do portão
      pil(-1.35, 0.2, 2.25);
      bars(-1.15, 0.2, 0.05, 1.95, 0.14, true); rails(-1.15, 0.2, [0.05, 0.95, 1.85]); maskRect(T0, -1.15, 0.2, MV - 0.05, MV + 0.05);
      pil(0.4, 0.2, 2.25);
      wallU(0.6, 6.5, MV, 0.55, MT, MT2, 0.14);
      bars(0.6, 6.5, 0.55, 1.85, 0.13, true); rails(0.6, 6.5, [0.6, 1.2, 1.82]);
      for (const u of [3.3, 6.3]) pil(u, 0.17, 1.95);
      wallV(-6.5, MV, 24, 2.2, hex('#d2bfa3'), hex('#c4b195')); wallV(6.5, MV, 24, 2.2, hex('#d2bfa3'), hex('#c4b195')); wallU(-6.5, 6.5, 24, 2.2, hex('#d2bfa3'), hex('#c4b195'));
      for (const [a, b, c, d] of [[-6.5, -6.5, MV, 24], [6.5, 6.5, MV, 24], [-6.5, 6.5, 24, 24]]) { const T = at(0, 0, gmin(a, b, c, d)); box(B, T, Math.min(a, b) - 0.14, Math.max(a, b) + 0.14, 2.2, 2.3, Math.min(c, d) - 0.14, Math.max(c, d) + 0.14, TILE, TILE); }   // muro bege com capa de telha (visto da Cel. Bruno)
      const g0 = gmin(-6.2, 5.2, 5.5, 18.5), T = at(0, 0, g0), FL = 2.75, H1 = FL + 2.75, H2 = H1 + 2.75;   // rua (garagem) / varanda e porta principal / sacada
      // garagem aberta embaixo + quarto de cima com mureta e vão aberto (como no print de 2022)
      { const u0 = -6.0, u1 = -1.5, v0 = 6.0, v1 = 13.0, y0 = 2.75;
        box(B, T, u0, u1, -0.6, 0.06, v0, v1, hex('#b3b0a8'), hex('#b3b0a8'));                                   // piso da garagem
        for (const [cu, cv] of [[u0 + 0.2, v0 + 0.2], [u1 - 0.2, v0 + 0.2]]) { box(B, T, cu - 0.2, cu + 0.2, 0, y0, cv - 0.2, cv + 0.2, MT, MT2); maskRect(T0, cu - 0.2, cu + 0.2, cv - 0.2, cv + 0.2); }
        box(B, T, u0, u0 + 0.2, 0, y0, v0 + 2.5, v1, MT, MT2); maskRect(T0, u0, u0 + 0.2, v0 + 2.5, v1);          // parede lateral do fundo da garagem
        box(B, T, u0, u1, y0, y0 + 0.3, v0, v1, MTD, MT2);                                                      // laje
        box(B, T, u0, u1, y0 + 0.3, y0 + 1.25, v0, v0 + 0.18, MT, MT2);                                          // mureta da frente
        box(B, T, u0, u0 + 0.18, y0 + 0.3, y0 + 1.25, v0, v1, MT, MT2);                                          // mureta da lateral esquerda
        box(B, T, u0 + 0.18, u1, y0 + 0.3, y0 + 2.5, v1 - 0.15, v1, DK, DK);                                     // fundo escuro do quarto aberto
        box(B, T, u0 + 0.18, u1, y0 + 0.3, y0 + 0.32, v0 + 0.18, v1 - 0.15, hex('#9a8f80'), hex('#9a8f80'));
        for (const [cu, cv] of [[u0 + 0.12, v0 + 0.12], [u1 - 0.1, v0 + 0.12], [u0 + 0.12, v1 - 0.3]]) box(B, T, cu - 0.12, cu + 0.12, y0 + 0.3, y0 + 2.5, cv - 0.12, cv + 0.12, MT, MT2);   // pilarzinhos do vão
        box(B, T, u0, u1, y0 + 2.5, y0 + 2.62, v0, v1, MT2, MT2);
        hipRoof(B, at((u0 + u1) / 2, (v0 + v1) / 2, g0), u1 - u0, v1 - v0, y0 + 2.62, 0.9, 0.5, TILE); }
      // corpo principal (térreo elevado + 1º andar), telhado de duas águas com empena virada para a lateral
      { const u0 = -3.2, u1 = 5.0, v0 = 9.5, v1 = 18.0;
        box(B, T, u0, u1, -0.6, H2, v0, v1, MT, MT2); maskRect(T0, u0, u1, v0, v1);
        for (const y of [FL, H1]) box(B, T, u0 - 0.03, u1 + 0.03, y - 0.08, y + 0.06, v0 - 0.03, v1 + 0.03, MTD, MTD);
        gableRoof(B, at((u0 + u1) / 2, (v0 + v1) / 2, g0), u1 - u0, v1 - v0, H2, 1.7, 0.6, TILE, MT);
        wallFeat(B, T, -2.4, -1.2, FL, FL + 2.2, v0, -1, hex('#7a3d2a'));                                     // porta vermelha
        win(T, 0.3, 1.8, FL + 0.9, FL + 2.2, v0, -1, false);
        win(T, -1.9, -0.6, H1 + 0.7, H1 + 1.9, v0, -1, false);                                               // janela do 1º andar
        // sacadinha com porta, telhadinho em dois pilares brancos
        wallFeat(B, T, 2.3, 3.4, H1, H1 + 2.2, v0, -1, hex('#2d4a44'));
        box(B, T, 1.8, 4.0, H1 - 0.05, H1 + 0.1, v0 - 1.0, v0, hex('#e9ebe8'), hex('#d8dad6'));
        box(B, T, 1.8, 4.0, H1 + 0.1, H1 + 0.55, v0 - 1.0, v0 - 0.95, RAIL, RAIL2);
        for (const cu of [1.9, 3.9]) box(B, T, cu - 0.07, cu + 0.07, H1 + 0.1, H1 + 2.45, v0 - 0.97, v0 - 0.83, RAIL, RAIL2);
        box(B, T, 1.6, 4.2, H1 + 2.45, H1 + 2.6, v0 - 1.25, v0, TILE, TILE); box(B, T, 1.7, 4.1, H1 + 2.6, H1 + 2.75, v0 - 0.9, v0, TILE2, TILE2);
        box(B, T, 4.2, 4.65, H1 + 1.6, H1 + 2.0, v0 - 0.25, v0, hex('#eeeeea'), hex('#d9d9d4'));                // ar-condicionado
        // lateral esquerda (vista da Cel. Bruno): janelas com toldo cinza + ar-condicionado
        const awn = (vc, y) => { sideFeat(B, T, vc - 0.6, vc + 0.6, y, y + 1.1, u0, -1, hex('#2d3a46')); box(B, T, u0 - 0.55, u0, y + 1.0, y + 1.35, vc - 0.75, vc + 0.75, hex('#8a8c8a'), hex('#777977')); };
        awn(14.5, H1 + 0.7); awn(16.3, FL + 0.8); sideFeat(B, T, 11, 12, 0.8, 1.8, u0, -1, hex('#2d3a46'));
        box(B, T, u0 - 0.3, u0, H1 + 1.7, H1 + 2.1, 11.2, 11.8, hex('#eeeeea'), hex('#d9d9d4')); }
      // volume térreo na lateral esquerda, com a empena virada para a Cel. Bruno
      { const u0 = -6.0, u1 = -3.2, v0 = 13.0, v1 = 18.0;
        box(B, T, u0, u1, -0.6, 3.2, v0, v1, MT, MT2); maskRect(T0, u0, u1, v0, v1);
        gableRoof(B, at((u0 + u1) / 2, (v0 + v1) / 2, g0), u1 - u0, v1 - v0, 3.2, 1.1, 0.4, TILE, MT); }
      // varanda no nível da porta principal (em cima da garagem), coberta, guarda-corpo branco trabalhado
      { const u0 = -1.5, u1 = 5.0, v0 = 6.9, v1 = 9.5;
        box(B, T, u0, u1, -0.6, FL, v0, v1, MT, MT2); maskRect(T0, u0, u1, v0, v1);                           // parede do porão embaixo da varanda
        box(B, T, u0, u1, FL - 0.05, FL + 0.08, v0 - 0.08, v1, MTD, MTD);
        wallFeat(B, T, 2.0, 2.4, 1.2, 1.6, v0, -1, hex('#e9ebe8'));                                             // caixinha de luz
        for (let u = u0 + 0.15; u < u1 - 0.1; u += 0.22) { box(B, T, u - 0.05, u + 0.05, FL + 0.08, FL + 1.0, v0 + 0.02, v0 + 0.1, RAIL, RAIL2); if (Math.round((u - u0) / 0.22) % 3 === 1) box(B, T, u - 0.09, u + 0.09, FL + 0.35, FL + 0.75, v0 + 0.01, v0 + 0.11, RAIL, RAIL2); }   // balaústres com enfeite
        box(B, T, u0, u1, FL + 1.0, FL + 1.07, v0, v0 + 0.14, RAIL, RAIL);
        for (const cu of [u0 + 0.12, 1.6, 4.85]) box(B, T, cu - 0.12, cu + 0.12, FL, FL + 2.45, v0 + 0.02, v0 + 0.26, MT, MT2);
        box(B, T, u0 - 0.1, u1 + 0.6, FL + 2.45, FL + 2.6, v0 - 0.45, v1, TILE, TILE); box(B, T, u0, u1 + 0.5, FL + 2.6, FL + 2.72, v0 - 0.1, v1, TILE2, TILE2);
        box(B, T, u1 + 0.3, u1 + 0.42, 0.2, FL + 2.5, v0 + 0.1, v0 + 0.22, hex('#d9dbd8'), hex('#d9dbd8'));     // calha
        // escada que sobe da esquerda para a direita, entre a grade e a parede, até a varanda
        const n = 12, s0 = -1.0, s1 = 3.4, sv0 = 5.15, sv1 = 6.9, STEP = hex('#c3c6c1'), STEP2 = hex('#b2b5b0');
        for (let k = 0; k < n; k++) { const a = s0 + (s1 - s0) * k / n, b = s0 + (s1 - s0) * (k + 1) / n; box(B, T, a, b, -0.6, FL * (k + 1) / n, sv0, sv1, STEP, STEP2); }
        box(B, T, s1, u1, -0.6, FL, sv0, sv1, STEP, STEP2);                                                     // patamar
        maskRect(T0, s0, u1, sv0, sv1);
        // corrimão branco acompanhando a escada
        for (let k = 0; k <= n; k += 2) { const u = s0 + (s1 - s0) * k / n, y = FL * k / n; box(B, T, u - 0.03, u + 0.03, y, y + 0.95, sv0 + 0.03, sv0 + 0.09, RAIL, RAIL2); }
        { const p0 = P(T, s0, 0.95, sv0 + 0.06), p1 = P(T, s1, FL + 0.95, sv0 + 0.06); beam(B, p0, p1, 0.04, RAIL); }
        box(B, T, s1, u1, FL + 0.95, FL + 1.0, sv0 + 0.03, sv0 + 0.09, RAIL, RAIL);
        for (let u = s1; u < u1; u += 0.22) box(B, T, u - 0.02, u + 0.02, FL, FL + 0.95, sv0 + 0.04, sv0 + 0.08, RAIL, RAIL2); }
      // grama na calçada, lixeira de cesto no poste, aroeira-salsa na frente
      { const q = [[0.6, 3.6], [6.4, 3.6], [6.4, 4.7], [0.6, 4.7]].map(([u, v]) => { const p = WP(u, v); return [p[0], groundAt(p[0], p[1]) + 0.05, p[1]]; }); B.quad(q[0], q[1], q[2], q[3], UP, hex('#6aa64c'), F_TEX); }
      { const p = WP(4.2, 4.1), T2 = at(4.2, 4.1), LX = hex('#3a3d40'); box(B, T2, -0.03, 0.03, 0, 0.95, -0.03, 0.03, LX, LX);
        for (const [a, b] of [[-0.25, -0.22], [0.22, 0.25]]) box(B, T2, a, b, 0.95, 1.3, -0.2, 0.2, LX, LX);
        for (let k = -2; k <= 2; k++) box(B, T2, -0.25, 0.25, 0.95, 1.3, k * 0.09 - 0.01, k * 0.09 + 0.01, LX, LX);
        box(B, T2, -0.25, 0.25, 0.95, 0.98, -0.2, 0.2, LX, LX); maskCircle(p[0], p[1], 0.15); PROPS.push({ k: 'lixeira', x: p[0], z: p[1], a: Math.atan2(uz, ux) }); }
      { const T2 = at(-0.5, 5.6); for (let k = 0; k < 6; k++) { const a = k * 1.05; box(B, T2, Math.cos(a) * 0.2 - 0.05, Math.cos(a) * 0.2 + 0.05, 0, 0.6 + (k % 3) * 0.15, Math.sin(a) * 0.2 - 0.12, Math.sin(a) * 0.2 + 0.12, hex('#5f9443'), hex('#4e7f37')); } }   // plantinha atrás da grade (como no print de 2024)
      { const p = WP(-6.9, 6.5); tree(chunkB(p[0], p[1]), p[0], p[1], 3, 1.3, true); }   // palmeira do vizinho à esquerda
      { const yard = { x: lm.x, z: lm.z, u: lm.u, v: lm.v, u0: -6.0, u1: 6.0, v0: 18.5, v1: 23.6, nu0: 0, nu1: 0, nv: -1 };   // quintal dos fundos: Balu e Zatara
        for (const [kind, du, dv] of [['labrador', -3, 21], ['pastor', 3, 21.5]]) { const p = WP(du, dv); DOGS.push({ kind, x: p[0], z: p[1], a: Math.random() * 6.28, yard, tx: p[0], tz: p[1], wait: Math.random() * 3, ph: Math.random() * 6, wag: 0, spd: 0 }); } }
    }
  }
  { // fim da R. Silvio Mageste da Silva (borda oeste, no alto): árvore grande à direita e o túmulo do Balu
    const r = W.roads.find(r => r.n === 'Rua Silvio Mageste da Silva');
    if (r) { let best = null; for (let i = 0; i < r.pts.length - 1; i++) { const a = r.pts[i], b = r.pts[i + 1]; for (let t = 0; t <= 1; t += 0.02) { const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; if (z > 0 && x > EX0 + 9 && (!best || x < best.x)) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); best = { x, z, fx: (b[0] - a[0]) / L, fz: (b[1] - a[1]) / L }; } } }
      if (best) { const rx = -best.fz, rz = best.fx, tx = best.x + rx * 7.5, tz = best.z + rz * 7.5;   // direita de quem chega pela rua
        const Bt = chunkB(tx, tz), T = frame(tx, groundAt(tx, tz) - 0.2, tz, 0.4), TR = hex('#5d4128'), L1 = hex('#3f7a2e'), L2 = hex('#4d8c36'), L3 = hex('#356b27');
        box(Bt, T, -0.6, 0.6, 0, 4.2, -0.6, 0.6, TR, TR);
        for (const [a, h] of [[0, 3.6], [2.1, 3.3], [4.2, 3.8]]) { const c = Math.cos(a), s_ = Math.sin(a); beam(Bt, P(T, 0, 3.4, 0), P(T, c * 2.6, h + 1.2, s_ * 2.6), 0.35, TR); }
        box(Bt, T, -5.2, 5.2, 4.2, 6.6, -4.8, 4.8, L1, L3); box(Bt, T, -4.2, 4.6, 6.6, 8.4, -3.8, 4.2, L2, L1); box(Bt, T, -2.8, 2.6, 8.4, 9.6, -2.4, 2.8, L1, L1);
        for (const [u, v] of [[-5.8, 1], [5.6, -1.5], [1, 5.2], [-1.5, -5.4]]) box(Bt, T, u - 1.6, u + 1.6, 4.6, 6.2, v - 1.6, v + 1.6, L2, L3);
        maskCircle(tx, tz, 0.7);
        // túmulo: monte de terra com cruz de galhos amarrados, entre a árvore e a rua
        const gx = tx - rx * 3.2 + best.fx * 0.5, gz = tz - rz * 3.2 + best.fz * 0.5, G = frame(gx, groundAt(gx, gz), gz, Math.atan2(rz, rx)), DIRT = hex('#6b4a2e'), DIRT2 = hex('#5c3f27'), BR = hex('#6e5134');
        box(Bt, G, -0.55, 0.55, -0.2, 0.18, -0.9, 0.9, DIRT, DIRT2); box(Bt, G, -0.4, 0.4, 0.18, 0.32, -0.7, 0.7, DIRT2, DIRT2); box(Bt, G, -0.2, 0.2, 0.32, 0.38, -0.4, 0.4, DIRT, DIRT);
        for (const [u, v] of [[0.3, 0.5], [-0.25, -0.4], [0.1, -0.7]]) box(Bt, G, u - 0.06, u + 0.06, 0.2, 0.3, v - 0.05, v + 0.05, hex('#8a8478'), hex('#7a7468'));   // pedrinhas
        beam(Bt, P(G, 0.48, 0.1, 0.0), P(G, 0.5, 1.05, 0.03), 0.07, BR);                       // galho de pé
        beam(Bt, P(G, 0.49, 0.75, -0.3), P(G, 0.49, 0.78, 0.32), 0.06, BR);                     // travessa
        box(Bt, G, 0.43, 0.56, 0.7, 0.83, -0.05, 0.05, hex('#c9b98a'), hex('#c9b98a'));          // amarração de barbante
        box(Bt, G, 0.32, 0.44, 0.33, 0.4, 0.15, 0.3, hex('#d8c54a'), hex('#c23a2a'));             // florzinhas
        maskCircle(gx, gz, 0.5);
        LATE_NOTES.push({ name: '', style: 'note', x: gx, z: gz, y: groundAt(gx, gz) + 0.9, base: 0, look: 0, t: 0, r: 3.2, says: ['R.I.P. Balu'] });
        window.__grave = [gx, gz]; } }
  }
  for (const lm of (W.landmarks || [])) if (lm.type === 'baldio') {   // terreno baldio (Street View 10/2011): terra batida, capim, arvorezinhas secas e a ladeira cortada em degraus
    const [ux, uz] = lm.u, [vx, vz] = lm.v, WP = (u, v) => [lm.x + ux * u + vx * v, lm.z + uz * u + vz * v];
    const AX = [ux, 0, uz], AZ = [vx, 0, vz], r = rngFor(lm.x, lm.z, 11);
    const at = (u, v, y) => { const p = WP(u, v); return { o: [p[0], y === undefined ? groundAt(p[0], p[1]) : y, p[1]], ax: AX, ay: [0, 1, 0], az: AZ }; };
    const gp = (u, v) => { const p = WP(u, v); return groundAt(p[0], p[1]); };
    const U0 = -34, U1 = 46, V0 = 5.6, VS = 44, V1 = 62;
    const DIRT = [hex('#9b6f48'), hex('#a77a50'), hex('#8e6440'), hex('#b0835a')], GR = [hex('#7f9a4a'), hex('#8aa452'), hex('#6f8c40'), hex('#9aa85e')];
    // chão: retalhos de terra batida e capim
    for (let u = U0; u < U1; u += 2) for (let v = V0; v < VS; v += 2) {
      const B = chunkB(...WP(u + 1, v + 1)), n = r(), c = n < 0.55 ? DIRT[Math.floor(r() * 4)] : GR[Math.floor(r() * 4)];
      const q = [[u, v], [u + 2, v], [u + 2, v + 2], [u, v + 2]].map(([a, b]) => { const p = WP(a, b); return [p[0], groundAt(p[0], p[1]) + 0.06, p[1]]; });
      B.quad(q[0], q[1], q[2], q[3], UP, c, F_TEX);
      if (n > 0.55 && r() < 0.6) for (let k = 0; k < 3; k++) { const tu = u + r() * 2, tv = v + r() * 2, T = at(tu, tv); box(B, T, -0.12, 0.12, 0, 0.25 + r() * 0.35, -0.12, 0.12, GR[Math.floor(r() * 4)], GR[2]); }   // tufos de capim
    }
    // barranquinho na beira da calçada (como no Street View)
    for (let u = U0; u < U1; u += 3) { const B = chunkB(...WP(u, V0)), T = at(u + 1.5, V0 + 0.8); box(B, T, -1.5, 1.5, -0.3, 0.2 + r() * 0.25, -0.8, 0.8, DIRT[Math.floor(r() * 4)], hex('#a0714a'), F_TEX); }
    // arvorezinhas secas, galhos finos
    for (const [tu, tv] of [[-6, 9], [4, 12], [-18, 16], [14, 20], [26, 14], [-26, 26], [6, 30]]) { const B = chunkB(...WP(tu, tv)), T = at(tu, tv), BR = hex('#6b5a48'), base = P(T, 0, 0, 0), top = P(T, 0, 2.6 + r(), 0);
      beam(B, base, top, 0.1, BR);
      for (let k = 0; k < 5; k++) { const a = r() * 6.28, y = 1.3 + r() * 1.4, l = 0.7 + r() * 0.8, p0 = P(T, 0, y, 0), p1 = [p0[0] + Math.cos(a) * l, p0[1] + 0.6 + r() * 0.5, p0[2] + Math.sin(a) * l]; beam(B, p0, p1, 0.05, BR); }
      const p = WP(tu, tv); maskCircle(p[0], p[1], 0.15); }
    // lixinho jogado
    for (let k = 0; k < 10; k++) { const tu = U0 + 4 + r() * (U1 - U0 - 8), tv = V0 + 1 + r() * 6, B = chunkB(...WP(tu, tv)), T = at(tu, tv); box(B, T, -0.15, 0.15, 0.04, 0.1, -0.1, 0.1, [hex('#e8e8e2'), hex('#5a8ad0'), hex('#d9d2b0')][k % 3], hex('#cfcfc8')); }
    // ladeira do morro ao fundo, cortada em degraus pela escavadeira (barro vermelho com capim em cima)
    const RED = hex('#b2552e'), RED2 = hex('#9d4826'), RED3 = hex('#c46a3c'), TOPG = hex('#7d9246');
    const steps = 5, sd = (V1 - VS) / steps, sh = 1.6;
    for (let u = U0; u < U1; u += 4) { const B = chunkB(...WP(u + 2, (VS + V1) / 2)), g = Math.min(gp(u, VS), gp(u + 4, VS));
      for (let k = 0; k < steps; k++) { const T = at(0, 0, g), v0 = VS + k * sd, y1 = (k + 1) * sh + (r() - 0.5) * 0.25;
        box(B, T, u, u + 4.02, -1.0, y1, v0, V1, k % 2 ? RED : RED3, RED2);
        const q = [[u, v0 + 0.05], [u + 4.02, v0 + 0.05], [u + 4.02, v0 + sd * 0.45], [u, v0 + sd * 0.45]].map(([a, b]) => P(T, a, y1 + 0.02, b)); B.quad(q[0], q[1], q[2], q[3], UP, TOPG, F_TEX);   // capinzal no patamar
        for (let j = 0; j < 3; j++) wallFeat(B, T, u + r() * 3.5, u + 0.3 + r() * 3.7, y1 - 0.3 - r() * 1.0, y1 - 0.15 - r() * 0.5, v0, -1, RED2);   // marcas da escavadeira
      }
      maskRect(at(0, 0, 0), u, u + 4, VS + 0.1, V1); }
    // rampinhas de tábua (lado esquerdo de quem olha da rua) e a BMX parada do lado
    const WOOD = hex('#a8834f'), WOOD2 = hex('#8e6c3d'), WOOD3 = hex('#c39a5f'), BLK = hex('#9b968c'), BLK2 = hex('#857f74');
    const ramp = (cu, cv, ang, L, h, w) => {   // sobe ao longo de "ang" (em relação ao eixo v do terreno)
      const p = WP(cu, cv), g = groundAt(p[0], p[1]), B = chunkB(p[0], p[1]);
      const ca = Math.cos(ang), sa = Math.sin(ang), F = [AZ[0] * ca + AX[0] * sa, 0, AZ[2] * ca + AX[2] * sa], S = [AX[0] * ca - AZ[0] * sa, 0, AX[2] * ca - AZ[2] * sa];
      const t = Math.atan2(h, L), Tt = { o: [p[0], g + 0.02, p[1]], ax: S, ay: [-F[0] * Math.sin(t), Math.cos(t), -F[2] * Math.sin(t)], az: [F[0] * Math.cos(t), Math.sin(t), F[2] * Math.cos(t)] };
      const Ll = Math.hypot(L, h);
      for (let k = 0; k < 4; k++) { const a = -w / 2 + k * w / 4; box(B, Tt, a + 0.01, a + w / 4 - 0.01, 0, 0.04, 0, Ll, k % 2 ? WOOD : WOOD3, WOOD2); }   // tábuas
      box(B, Tt, -w / 2 - 0.02, w / 2 + 0.02, 0.04, 0.07, Ll * 0.33, Ll * 0.33 + 0.08, WOOD2, WOOD2); box(B, Tt, -w / 2 - 0.02, w / 2 + 0.02, 0.04, 0.07, Ll * 0.72, Ll * 0.72 + 0.08, WOOD2, WOOD2);
      const Tb = { o: [p[0] + F[0] * (L - 0.25), g, p[1] + F[2] * (L - 0.25)], ax: S, ay: [0, 1, 0], az: F };   // tijolos/blocos embaixo da ponta alta
      box(B, Tb, -w / 2 + 0.05, w / 2 - 0.05, 0, h - 0.02, -0.2, 0.2, BLK, BLK2); for (let y = 0.19; y < h; y += 0.19) box(B, Tb, -w / 2 + 0.04, w / 2 - 0.04, y, y + 0.015, -0.205, 0.205, BLK2, BLK2);
      const q = P(Tb, 0, 0, 0); maskCircle(q[0], q[2], 0.3);
    };
    ramp(30, 16, 0.3, 2.2, 0.55, 1.0); ramp(35, 22, -0.4, 1.8, 0.4, 0.9); ramp(26, 25, 2.9, 2.5, 0.7, 1.1);
    { const p = WP(33, 18.6), g = groundAt(p[0], p[1]), B = chunkB(p[0], p[1]), tl = 0.2, a0 = Math.atan2(AX[2], AX[0]) + 0.5;   // BMX vermelha, apoiada inclinada
      const K = { o: [p[0], g, p[1]], ax: [Math.cos(a0), 0, Math.sin(a0)], ay: [-Math.sin(a0) * Math.sin(tl), Math.cos(tl), Math.cos(a0) * Math.sin(tl)], az: [-Math.sin(a0) * Math.cos(tl), -Math.sin(tl), Math.cos(a0) * Math.cos(tl)] };
      const tire = hex('#17181b'), fr = hex('#d12f2f'), chrome = hex('#c9cdd2'), rr = 0.25;
      const wheel = cu => { for (let q = 0; q < 12; q++) { const b0 = q / 12 * Math.PI * 2, b1 = (q + 1) / 12 * Math.PI * 2; beam(B, P(K, cu + Math.cos(b0) * rr, rr + Math.sin(b0) * rr, 0), P(K, cu + Math.cos(b1) * rr, rr + Math.sin(b1) * rr, 0), 0.07, tire); } for (let q = 0; q < 6; q++) { const b = q / 6 * Math.PI; beam(B, P(K, cu - Math.cos(b) * rr * 0.9, rr - Math.sin(b) * rr * 0.9, 0), P(K, cu + Math.cos(b) * rr * 0.9, rr + Math.sin(b) * rr * 0.9, 0), 0.012, chrome); } };
      wheel(-0.42); wheel(0.42);
      const rear = P(K, -0.42, rr, 0), crank = P(K, -0.05, 0.27, 0), seat = P(K, -0.22, 0.68, 0), head = P(K, 0.3, 0.72, 0), front = P(K, 0.42, rr, 0);
      beam(B, rear, crank, 0.04, fr); beam(B, rear, seat, 0.04, fr); beam(B, crank, seat, 0.05, fr); beam(B, crank, head, 0.055, fr); beam(B, seat, head, 0.05, fr); beam(B, head, front, 0.04, chrome);
      box(B, K, -0.34, -0.1, 0.72, 0.77, -0.06, 0.06, tire, tire);                                   // selim
      beam(B, head, P(K, 0.26, 0.98, 0), 0.035, chrome); beam(B, P(K, 0.26, 0.98, -0.3), P(K, 0.26, 0.98, 0.3), 0.035, chrome);   // guidão alto
      for (const sv of [-0.3, 0.3]) beam(B, P(K, 0.26, 0.98, sv), P(K, 0.2, 0.98, sv), 0.05, tire);
      for (const sv of [-0.12, 0.12]) box(B, K, -0.1, 0.0, 0.25, 0.29, sv - 0.06, sv + 0.06, hex('#2a2a2a'), hex('#2a2a2a'));   // pedais
      maskCircle(p[0], p[1], 0.5); }
    for (const [u0, u1] of [[U0, U0], [U1, U1]]) { const B = chunkB(...WP(u0, (VS + V1) / 2)), g = gp(u0, VS), T = at(0, 0, g); for (let k = 0; k < steps; k++) { const v0 = VS + k * sd; box(B, T, u0 - 0.01, u0 + 0.01, -1, (k + 1) * sh, v0, V1, RED2, RED2); } }
  }
  for (const lm of (W.landmarks || [])) if (lm.type === 'wandir1') {   // casa amarela da R. Wandir de Carvalho (Street View): grade branca sobre mureta cinza, varanda à esquerda, óculo redondo
    const [ux, uz] = lm.u, [vx, vz] = lm.v, WP = (u, v) => [lm.x + ux * u + vx * v, lm.z + uz * u + vz * v];
    const AX = [ux, 0, uz], AZ = [vx, 0, vz], U = a => -32.5 - a;   // a = metros da esquerda para a direita de quem olha da rua
    const at = (u, v, y) => { const p = WP(u, v); return { o: [p[0], y === undefined ? groundAt(p[0], p[1]) : y, p[1]], ax: AX, ay: [0, 1, 0], az: AZ }; };
    const B = chunkB(...WP(U(7), 12)), T0 = at(0, 0, 0);
    const gp = (u, v) => { const p = WP(u, v); return groundAt(p[0], p[1]); };
    const gs = [gp(U(0), 5), gp(U(14), 5), gp(U(0), 19), gp(U(14), 19)], g = Math.max(...gs), LB = Math.min(...gs) - g - 0.6, T = at(0, 0, g);
    const YL = hex('#ece0a2'), YL2 = hex('#ddd192'), WH = hex('#f1f2ef'), WH2 = hex('#dfe0dd'), GT = hex('#6f7884'), GT2 = hex('#626a75'), TILE = hex('#b9573a'), DK = hex('#2a2c2f');
    const MV = 5.15;
    const bx = (a0, a1, y0, y1, v0, v1, c, c2) => box(B, T, U(a1), U(a0), y0, y1, v0, v1, c, c2 || c);
    const wf = (a0, a1, y0, y1, v, c) => wallFeat(B, T, U(a1), U(a0), y0, y1, v, -1, c);
    // muro: pilares brancos, mureta de pastilha cinza-azulada, grade branca com arabescos
    for (const [a0, a1, h] of [[0, 0.3, 2.0], [3.5, 3.75, 2.0], [5.0, 5.25, 2.0], [13.6, 14.0, 2.35]]) { bx(a0, a1, LB, h, MV - 0.15, MV + 0.15, WH, WH2); maskRect(T0, U(a1), U(a0), MV - 0.2, MV + 0.2); }
    bx(5.25, 13.6, LB, 0.95, MV - 0.12, MV + 0.12, GT, GT2); maskRect(T0, U(13.6), U(5.25), MV - 0.17, MV + 0.17);
    for (let y = 0.12; y < 0.95; y += 0.12) wf(5.25, 13.6, y, y + 0.012, MV - 0.12, hex('#58606a'));
    bx(5.25, 13.6, 0.95, 1.0, MV - 0.14, MV + 0.14, WH, WH2);
    const grade = (a0, a1, y0, y1) => { for (let a = a0 + 0.06; a < a1; a += 0.13) { bx(a, a + 0.03, y0, y1, MV - 0.015, MV + 0.015, WH, WH2); bx(a - 0.015, a + 0.045, y1, y1 + 0.1, MV - 0.02, MV + 0.02, WH, WH2); }
      for (const y of [y0 + 0.02, y1 - 0.05]) bx(a0, a1, y, y + 0.04, MV - 0.02, MV + 0.02, WH, WH2);
      for (let a = a0 + 0.1; a < a1 - 0.2; a += 0.26) bx(a, a + 0.18, y0 + 0.12, y0 + 0.2, MV - 0.02, MV + 0.02, WH, WH2); };   // faixa de arabescos
    grade(5.25, 13.6, 1.0, 1.85);
    grade(0.3, 3.5, 0.05, 1.85); maskRect(T0, U(3.5), U(0.3), MV - 0.05, MV + 0.05);   // portão da garagem
    grade(3.75, 5.0, 0.05, 1.85); maskRect(T0, U(5.0), U(3.75), MV - 0.05, MV + 0.05); // portãozinho
    // casa térrea amarela em L (planta do Lucas): fundo largo, frente avançando à direita com a janela; no recuo, óculo e porta
    const vF = 9.0, vR = 12.6, v1 = 21.0, aL = 3.8, aM = 7.0, aR = 11.5, H = 2.9;
    bx(aL, aR, LB, H, vR, v1, YL, YL2); bx(aM, aR, LB, H, vF, vR, YL, YL2); maskRect(T0, U(aR), U(aL), vR, v1); maskRect(T0, U(aR), U(aM), vF, vR);
    bx(aL - 0.3, aR + 0.3, LB, 0.15, vF - 0.3, v1, hex('#b5b0a5'), hex('#a7a297'));   // calçadinha / piso da varanda
    hipRoof(B, at(U((0.35 + aR) / 2), (vF + v1) / 2, g), aR - 0.35, v1 - vF, H + 0.05, 2.2, 0.6, TILE);   // telhado cobre também o recuo (varanda) e a garagem
    bx(aL, aL + 0.25, 0.15, H, vF + 0.05, vF + 0.3, YL, YL2); { const p = P(T, U(aL + 0.12), 0, vF + 0.17); maskCircle(p[0], p[2], 0.2); }   // pilar da varanda
    bx(0.35, aM, H - 0.25, H, vF - 0.1, vF + 0.1, YL, YL2);                                 // viga
    bx(0.35, 0.6, 0.15, H, vF + 0.05, vF + 0.3, YL, YL2); { const p = P(T, U(0.47), 0, vF + 0.17); maskCircle(p[0], p[2], 0.2); }   // pilar da frente da garagem
    bx(0.35, aL, H - 0.25, H, v1 - 0.2, v1, YL, YL2); bx(0.35, 0.6, 0.15, H, v1 - 0.3, v1, YL, YL2);   // fundo da garagem
    // óculo redondo com grade e porta branca, na parede recuada
    { const cA = 4.9, cy = 1.75, R = 0.38; for (let k = 0; k < 10; k++) { const y = cy - R + (k + 0.5) * 2 * R / 10, w = Math.sqrt(Math.max(0, R * R - (y - cy) ** 2)); wf(cA - w, cA + w, y - R / 10, y + R / 10, vR, hex('#2f343a')); }
      for (const d of [-0.2, 0, 0.2]) wf(cA + d - 0.02, cA + d + 0.02, cy - 0.35, cy + 0.35, vR - 0.01, WH); wf(cA - 0.36, cA + 0.36, cy - 0.02, cy + 0.02, vR - 0.01, WH); }
    wf(5.9, 6.7, 0.15, 2.25, vR, WH); for (let y = 0.5; y < 2.2; y += 0.28) wf(6.0, 6.6, y, y + 0.16, vR - 0.01, hex('#c9ccc9'));
    // janelão com grade branca na frente que avança
    wf(8.1, 10.4, 0.9, 2.2, vF, hex('#2f343a')); for (let a = 8.15; a < 10.4; a += 0.18) wf(a, a + 0.05, 0.9, 2.2, vF - 0.01, WH);
    for (const y of [0.92, 1.55, 2.15]) wf(8.1, 10.4, y, y + 0.05, vF - 0.01, WH);
    // lateral da parte que avança (vista do recuo): janelinha
    box(B, T, U(aM) - 0.01, U(aM) + 0.01, 1.2, 2.0, 10.2, 11.4, hex('#2f343a'), hex('#2f343a'));
    // garagem à esquerda: piso de concreto até o fundo
    { const q = [[0.3, MV + 0.15], [aL - 0.1, MV + 0.15], [aL - 0.1, v1], [0.3, v1]].map(([a, v]) => { const p = WP(U(a), v); return [p[0], groundAt(p[0], p[1]) + 0.06, p[1]]; }); B.quad(q[0], q[1], q[2], q[3], UP, hex('#a9a69e'), F_TEX); }
    // muros laterais e do fundo fechando o lote
    const SW = hex('#e3dcc3'), SW2 = hex('#d4cdb4');
    for (const [a0, a1, va, vb] of [[0.0, 0.3, MV, 22.5], [13.6, 14.0, MV, 22.5], [0.0, 14.0, 22.2, 22.5]]) { const n = Math.max(1, Math.ceil((vb - va) / 4)); for (let k = 0; k < n; k++) { const p0 = va + (vb - va) * k / n, p1 = va + (vb - va) * (k + 1) / n; bx(a0, a1, LB, 2.0, p0, p1, SW, SW2); }
      maskRect(T0, U(a1), U(a0), va, vb); mx.beginPath(); mx.lineWidth = 0.5; const q0 = WP(U((a0 + a1) / 2), va), q1 = WP(U((a0 + a1) / 2), vb); if (vb - va > 1) { mx.moveTo(q0[0], q0[1]); mx.lineTo(q1[0], q1[1]); mx.stroke(); } }
    // cadeiras de plástico brancas na varanda
    for (const a of [4.5, 5.4]) { const c = U(a); box(B, T, c - 0.22, c + 0.22, 0.15, 0.6, 10.4, 10.8, WH, WH2); box(B, T, c - 0.22, c + 0.22, 0.6, 1.05, 10.8, 10.86, WH, WH2); }
    wallFeat(B, T, U(13.9), U(13.65), 1.3, 1.7, MV - 0.15, -1, hex('#c9c9c4'));
  }
  for (const lm of (W.landmarks || [])) if (lm.type === 'padoca') {   // Padóca: esquina da Av. Antenor O'Reilly com a R. Wandir de Carvalho (Street View 2024)
    const [ux, uz] = lm.u, [vx, vz] = lm.v, WP = (u, v) => [lm.x + ux * u + vx * v, lm.z + uz * u + vz * v];
    const AX = [ux, 0, uz], AZ = [vx, 0, vz];
    const at = (u, v, y) => { const p = WP(u, v); return { o: [p[0], y === undefined ? groundAt(p[0], p[1]) : y, p[1]], ax: AX, ay: [0, 1, 0], az: AZ }; };
    const B = chunkB(...WP(20, 12)), T0 = at(0, 0, 0), r = rngFor(lm.x, lm.z, 77);
    const gp = (u, v) => { const p = WP(u, v); return groundAt(p[0], p[1]); };
    const gs = [gp(5.3, 5.3), gp(33, 5.3), gp(5.3, 19), gp(33, 19), gp(13, 9), gp(20, 5.3)], g = Math.max(...gs), LB = Math.min(...gs) - g - 0.6, T = at(0, 0, g);
    const CR = hex('#e9dcbf'), CR2 = hex('#dccfb1'), STN = hex('#8e9093'), STN2 = hex('#7d7f82'), BRN = hex('#7a5038'), TILE = hex('#c2643f'), BLK = hex('#232426'), WHT = hex('#eeefec'), WHT2 = hex('#dcdedb');
    const stone = (Tt, u0, u1, y0, y1, v, sg) => { wallFeat(B, Tt, u0, u1, y0, y1, v, sg, STN); for (let y = y0 + 0.2; y < y1; y += 0.2) wallFeat(B, Tt, u0, u1, y, y + 0.02, v + sg * 0.005, sg, STN2); for (let y = y0; y < y1; y += 0.2) for (let u = u0 + ((y - y0) / 0.2 % 2 ? 0.2 : 0); u < u1; u += 0.4) wallFeat(B, Tt, u, u + 0.02, y, Math.min(y1, y + 0.2), v + sg * 0.005, sg, STN2); };
    const awning = (Tt, u0, u1, y, v, sg) => { for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI / 2, b = (k + 1) / 5 * Math.PI / 2; const q = [P(Tt, u0, y + Math.sin(a) * 0.45, v + sg * Math.cos(a) * 0.6), P(Tt, u1, y + Math.sin(a) * 0.45, v + sg * Math.cos(a) * 0.6), P(Tt, u1, y + Math.sin(b) * 0.45, v + sg * Math.cos(b) * 0.6), P(Tt, u0, y + Math.sin(b) * 0.45, v + sg * Math.cos(b) * 0.6)]; B.quad(q[0], q[1], q[2], q[3], faceN(q[0], q[1], q[2], true), k % 2 ? hex('#8c5a44') : hex('#9b6a52'), F_PLAIN); } };
    const winB = (Tt, u0, u1, y0, y1, v, sg) => { stone(Tt, u0 - 0.35, u1 + 0.35, y0 - 0.3, y1 + 0.25, v, sg); wallFeat(B, Tt, u0, u1, y0, y1, v + sg * 0.01, sg, BRN); for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) { const a = u0 + 0.08 + k * (u1 - u0 - 0.16) / 3, b = a + (u1 - u0 - 0.16) / 3 - 0.06, c = y0 + 0.08 + j * (y1 - y0 - 0.16) / 2, d = c + (y1 - y0 - 0.16) / 2 - 0.06; wallFeat(B, Tt, a, b, c, d, v + sg * 0.02, sg, hex('#2f3a44')); } awning(Tt, u0 - 0.25, u1 + 0.25, y1 + 0.1, v, sg); };
    // texto em blocos de pixel num quadro: Tt.ax = direção da leitura, -Tt.az = lado de quem lê
    const signText = (Tt, u0, u1, y0, y1, v, lines, cols) => {
      const Wc = 96, Hc = 22, c2 = document.createElement('canvas'); c2.width = Wc; c2.height = Hc; const gx = c2.getContext('2d'); gx.textAlign = 'center'; gx.textBaseline = 'middle';
      lines.forEach((l, k) => { gx.font = "bold " + (lines.length > 1 ? 11 : 19) + "px 'VT323', monospace"; gx.fillStyle = cols[k]; gx.fillText(l, Wc / 2, lines.length > 1 ? 6 + k * 11 : 12); });
      const d = gx.getImageData(0, 0, Wc, Hc).data, px = (u1 - u0) / Wc, py = (y1 - y0) / Hc, nn = [-Tt.az[0], 0, -Tt.az[2]];
      for (let y = 0; y < Hc; y++) { let x0 = -1, col = null; for (let x = 0; x <= Wc; x++) { const i = (y * Wc + x) * 4, on = x < Wc && d[i + 3] > 120, c = on ? [d[i], d[i + 1], d[i + 2]] : null, same = on && col && Math.abs(c[0] - col[0]) + Math.abs(c[1] - col[1]) < 60;
        if (x0 >= 0 && !same) { const a = u1 - x * px, b = u1 - x0 * px, yy = y1 - y * py; const q = [P(Tt, a, yy, v), P(Tt, b, yy, v), P(Tt, b, yy - py, v), P(Tt, a, yy - py, v)]; B.quad(q[0], q[1], q[2], q[3], nn, col, F_GLOW); x0 = -1; col = null; }
        if (on && x0 < 0) { x0 = x; col = c; } } } };
    // sobrado creme: 20 m ao longo da R. Wandir, 2 andares, telhado de 4 águas
    const u0 = 13, u1 = 33, v0 = 9, v1 = 19, H1 = 3.1, H2 = 6.1;
    box(B, T, u0, u1, LB, H2, v0, v1, CR, CR2); maskRect(T0, u0, u1, v0, v1);
    hipRoof(B, at((u0 + u1) / 2, (v0 + v1) / 2, g), u1 - u0, v1 - v0, H2, 2.0, 0.6, TILE);
    stone(T, u0, u1, H1 - 0.35, H1 + 0.3, v0, -1);                                               // faixa de pedra entre os andares
    for (const [a, b] of [[14.2, 16.6], [17.8, 20.2], [26.0, 28.0], [29.4, 31.4]]) winB(T, a, b, H1 + 0.8, H1 + 2.1, v0, -1);
    stone(T, 21.6, 24.2, H1 + 0.3, H2, v0, -1);                                                  // coluna de pedra com duas janelinhas em arco
    for (const a of [22.15, 23.15]) { wallFeat(B, T, a, a + 0.35, H1 + 0.9, H1 + 2.2, v0 - 0.02, -1, BRN); wallFeat(B, T, a + 0.06, a + 0.29, H1 + 0.95, H1 + 2.15, v0 - 0.03, -1, hex('#2f3a44')); wallFeat(B, T, a + 0.08, a + 0.27, H1 + 2.2, H1 + 2.32, v0 - 0.02, -1, BRN); }
    stone(T, 21.6, 24.2, 0, H1 - 0.35, v0, -1);
    for (const [a, b] of [[14.0, 16.4], [17.2, 19.8], [25.0, 27.4], [28.2, 30.4]]) { wallFeat(B, T, a, b, 0, 2.5, v0, -1, hex('#2b2b2d')); for (let u = a + 0.12; u < b; u += 0.18) wallFeat(B, T, u, u + 0.05, 0.1, 2.4, v0 - 0.01, -1, hex('#7d7f82')); }   // portas de grade de enrolar
    wallFeat(B, T, 30.8, 32.8, 0, 2.4, v0, -1, hex('#3a3633'));                                    // garagem
    // fim do sobrado virado para a avenida e o terraço: janelas com toldo
    { const Ts = { o: P(T, u0, 0, 0), ax: [-AZ[0], 0, -AZ[2]], ay: [0, 1, 0], az: AX };   // ax = -v, normal = -u (para a avenida)
      for (const c of [-11.5, -15.8]) winB(Ts, c, c + 1.8, H1 + 0.8, H1 + 2.0, 0, -1);
      wallFeat(B, Ts, -12.0, -10.4, 0, 2.4, 0, -1, hex('#4a2f22')); wallFeat(B, Ts, -16.8, -15.3, 0, 2.4, 0, -1, hex('#4a2f22'));
      wallFeat(B, Ts, -18.9, -9.1, 0, 0.9, 0, -1, hex('#5a3a2c')); wallFeat(B, Ts, -14.6, -13.0, 1.0, 2.2, 0, -1, hex('#2f3a44')); }
    // terraço coberto na esquina: piso de cerâmica, toldo metálico em pilares pretos
    { const tu0 = 5.4, tu1 = 20.5, tv0 = 5.3, tv1 = 19;
      box(B, T, tu0, tu1, LB, 0.1, tv0, tv1, hex('#9aa3ad'), hex('#8c949d'));
      for (let u = tu0; u < tu1; u += 0.6) for (let v = tv0; v < tv1; v += 0.6) if ((((u - tu0) / 0.6 | 0) + ((v - tv0) / 0.6 | 0)) % 2 && (u < u0 || v < v0)) { const q = [[u, v], [Math.min(tu1, u + 0.6), v], [Math.min(tu1, u + 0.6), Math.min(tv1, v + 0.6)], [u, Math.min(tv1, v + 0.6)]].map(([a, b]) => P(T, a, 0.105, b)); B.quad(q[0], q[1], q[2], q[3], UP, hex('#adb5be'), F_PLAIN); }
      const roofY = u => 3.35 - (u - tu0) * 0.0;   // telhado quase reto, caindo para as ruas
      const sheet = (a0, a1, b0, b1) => { const q = [P(T, a0, 3.1, b0), P(T, a1, 3.1, b0), P(T, a1, 3.4, b1), P(T, a0, 3.4, b1)]; B.quad(q[0], q[1], q[2], q[3], UP, hex('#d6d9dc'), F_PLAIN); box(B, T, a0, a1, 2.95, 3.1, b0 - 0.05, b0 + 0.1, BLK, BLK); for (let a = a0; a < a1; a += 0.35) box(B, T, a, a + 0.06, 3.1, 3.18, b0 - 0.05, b0 + 0.05, hex('#f2f3f4'), hex('#f2f3f4')); };
      sheet(tu0, u0, tv0, tv1); sheet(u0, tu1, tv0, v0);
      box(B, T, tu0, tu0 + 0.12, 2.95, 3.12, tv0, tv1, BLK, BLK);
      for (const [pu, pv] of [[tu0 + 0.1, tv0 + 0.1], [tu0 + 0.1, 12], [tu0 + 0.1, tv1 - 0.2], [9.5, tv0 + 0.1], [tu1 - 0.1, tv0 + 0.1], [15.5, tv0 + 0.1]]) { box(B, T, pu - 0.06, pu + 0.06, 0.1, 3.05, pv - 0.06, pv + 0.06, BLK, BLK); const p = P(T, pu, 0, pv); maskCircle(p[0], p[2], 0.12); }
      for (let u = tu0 + 0.8; u < u0; u += 1.6) box(B, T, u - 0.04, u + 0.04, 2.9, 3.05, tv0, tv1, BLK, BLK);   // vigas
      // mesas de madeira com cadeiras pretas dobráveis
      const mesa = (mu, mv) => { const Tm = at(0, 0, g + 0.1); box(B, Tm, mu - 0.45, mu + 0.45, 0.72, 0.77, mv - 0.45, mv + 0.45, hex('#6b4a33'), hex('#5a3d29')); for (const [a, b] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) box(B, Tm, mu + a - 0.03, mu + a + 0.03, 0, 0.72, mv + b - 0.03, mv + b + 0.03, BLK, BLK);
        for (const [du, dv, k] of [[0, -0.75, 0], [0, 0.75, 1], [-0.75, 0, 2], [0.75, 0, 3]]) { if (r() < 0.2) continue; const cu = mu + du, cv = mv + dv; box(B, Tm, cu - 0.2, cu + 0.2, 0.44, 0.48, cv - 0.2, cv + 0.2, BLK, BLK); for (const [a, b] of [[-0.17, -0.17], [0.17, 0.17], [-0.17, 0.17], [0.17, -0.17]]) box(B, Tm, cu + a - 0.02, cu + a + 0.02, 0, 0.44, cv + b - 0.02, cv + b + 0.02, BLK, BLK);
          if (k < 2) box(B, Tm, cu - 0.2, cu + 0.2, 0.48, 0.9, cv + (k ? 0.2 : -0.2) - 0.02, cv + (k ? 0.2 : -0.2) + 0.02, BLK, BLK); else box(B, Tm, cu + (k === 3 ? 0.2 : -0.2) - 0.02, cu + (k === 3 ? 0.2 : -0.2) + 0.02, 0.48, 0.9, cv - 0.2, cv + 0.2, BLK, BLK); }
        if (r() < 0.5) box(B, Tm, mu - 0.08, mu + 0.08, 0.77, 0.86, mv - 0.08, mv + 0.08, hex('#c23a2a'), hex('#a92f22'));   // porta-guardanapo vermelho
        const p = P(Tm, mu, 0, mv); maskCircle(p[0], p[2], 0.55); };
      for (const [mu, mv] of [[7.3, 7.6], [10.3, 7.6], [7.3, 11.2], [10.6, 11.0], [7.6, 15.0], [10.8, 15.4], [14.6, 7.2], [17.8, 7.2]]) mesa(mu, mv);
      { const Tl = at(0, 0, g + 0.1), p = P(Tl, 12.2, 0, 6.2); box(B, Tl, 12.0, 12.4, 0, 0.7, 6.0, 6.4, hex('#f2f2ee'), hex('#e6e6e2')); box(B, Tl, 11.98, 12.42, 0.25, 0.42, 5.98, 6.42, hex('#e7b928'), hex('#e7b928')); maskCircle(p[0], p[2], 0.25); }   // lixeira
      { const Tl = at(0, 0, g + 0.1); for (let k = 0; k < 4; k++) { const vv = 6.0 + k * 0.45; box(B, Tl, 5.6, 5.64, 0, 0.5, vv - 0.18, vv + 0.18, hex('#b7bbbf'), hex('#b7bbbf')); } }   // paraciclo
      // faixa da Padóca: virada para a avenida e para a R. Wandir
      { const Ts = { o: P(T, tu0 - 0.05, 0, 0), ax: [-AZ[0], 0, -AZ[2]], ay: [0, 1, 0], az: AX };
        box(B, Ts, -16.5, -7.5, 3.15, 4.35, -0.06, 0, hex('#1d1712'), hex('#1d1712')); for (const vv of [-16.3, -7.7]) box(B, Ts, vv - 0.04, vv + 0.04, 3.0, 3.2, -0.04, 0.02, BLK, BLK);
        signText(Ts, -16.3, -7.7, 3.25, 4.25, -0.08, ['Padóca'], ['#f0a64a']); }
      { box(B, T, 13.4, 20.2, 3.35, 4.45, tv0 - 0.06, tv0, hex('#1d1712'), hex('#1d1712'));
        signText(T, 13.6, 20.0, 3.45, 4.35, tv0 - 0.08, ['Padóca'], ['#f0a64a']); } }
    // frente na R. Wandir depois do terraço: toldo com treliça branca, grade branca alta e portão de garagem
    { const fu0 = 20.5, fu1 = 29, Tf = at(0, 0, g);
      box(B, Tf, fu0, 32.8, LB, 0.1, 5.3, v0, hex('#b9b6ad'), hex('#aaa79f'));
      for (let u = fu0; u < fu1; u += 0.14) box(B, Tf, u, u + 0.04, 0.1, 2.3, 5.3, 5.36, WHT, WHT2);
      for (const y of [0.25, 1.0, 2.2]) box(B, Tf, fu0, fu1, y, y + 0.05, 5.28, 5.38, WHT, WHT2);
      for (let u = fu0; u <= fu1 + 0.01; u += 1.42) box(B, Tf, u - 0.05, u + 0.05, 0.1, 2.4, 5.26, 5.4, WHT, WHT2);
      maskRect(T0, fu0, fu1, 5.25, 5.45);
      box(B, Tf, fu0, 31.5, 3.0, 3.06, 5.6, v0, hex('#e5e7e9'), hex('#d4d6d8'));                 // telha de fibrocimento
      box(B, Tf, fu0, 31.5, 2.65, 2.7, 5.6, 5.66, WHT, WHT); box(B, Tf, fu0, 31.5, 2.95, 3.0, 5.6, 5.66, WHT, WHT);
      for (let u = fu0; u < 31.4; u += 0.6) { const p0 = P(Tf, u, 2.68, 5.63), p1 = P(Tf, u + 0.3, 2.97, 5.63), p2 = P(Tf, u + 0.6, 2.68, 5.63); beam(B, p0, p1, 0.04, WHT); beam(B, p1, p2, 0.04, WHT); }   // treliça
      for (const u of [fu0 + 0.05, 25, 31.4]) box(B, Tf, u - 0.05, u + 0.05, 0.1, 2.7, 5.6, 5.7, WHT, WHT2);
      box(B, Tf, 29.0, 29.35, LB, 2.3, 5.2, 5.5, hex('#d8d2c4'), hex('#ccc6b8')); box(B, Tf, 32.8, 33.15, LB, 2.3, 5.2, 5.5, hex('#d8d2c4'), hex('#ccc6b8'));
      box(B, Tf, 29.35, 32.8, 0.05, 2.1, 5.3, 5.36, hex('#e3e4e2'), hex('#d3d4d2')); maskRect(T0, 29, 33.15, 5.2, 5.5);   // portão branco
      for (const [a, b] of [[29.4, 31.05], [31.1, 32.75]]) { const q = P(Tf, a, 0.1, 5.29), q2 = P(Tf, b, 2.0, 5.29); beam(B, q, q2, 0.03, hex('#c4c6c4')); beam(B, P(Tf, a, 2.0, 5.29), P(Tf, b, 0.1, 5.29), 0.03, hex('#c4c6c4')); }
      box(B, Tf, 31.6, 32.0, 1.2, 1.55, 5.26, 5.29, hex('#e8e8e8'), hex('#e8e8e8')); box(B, Tf, 31.65, 31.95, 1.3, 1.45, 5.25, 5.26, hex('#c8322a'), hex('#c8322a'));   // placa "garagem"
      { const p0 = P(Tf, 31.5, 0.1, 6.3), p1 = P(Tf, 30.4, 3.0, 8.6); for (let k = 0; k < 6; k++) beam(B, [p0[0] + AZ[0] * k * 0.12, p0[1], p0[2] + AZ[2] * k * 0.12].map((x, i) => i === 1 ? x : x + AX[i] * k * 0.12), [p1[0] + AX[0] * k * 0.12, p1[1], p1[2] + AX[2] * k * 0.12], 0.06, hex('#cfd3d6')); } }   // telha de alumínio encostada
    LATE_NOTES.push({ name: '', style: 'note', x: WP(9, 11)[0], z: WP(9, 11)[1], y: g + 1.4, base: 0, look: 0, t: 0, r: 3, says: ['Padóca'] });
  }
  for (const lm of (W.landmarks || [])) if (lm.type === 'padaria') {   // Padaria do Jorge (no lugar da Padaria Colina da R. Agenor Lopes Siqueira)
    const [ux, uz] = lm.u, [vx, vz] = lm.v, WP = (u, v) => [lm.x + ux * u + vx * v, lm.z + uz * u + vz * v];
    const AX = [ux, 0, uz], AZ = [vx, 0, vz], VF = lm.vf;
    const at = (u, v, y) => { const p = WP(u, v); return { o: [p[0], y === undefined ? groundAt(p[0], p[1]) : y, p[1]], ax: AX, ay: [0, 1, 0], az: AZ }; };
    const B = chunkB(...WP(0, 10)), T0 = at(0, 0, 0);
    const gp = (u, v) => { const p = WP(u, v); return groundAt(p[0], p[1]); };
    const g = Math.min(gp(-5.5, VF), gp(5.5, VF), gp(-5.5, VF + 11), gp(5.5, VF + 11)), T = at(0, 0, g);
    const WOOD = hex('#5a3b26'), WOOD2 = hex('#4a3020'), TILE = hex('#c0603e'), WALL = hex('#e7ded0'), WALL2 = hex('#d8cfc0'), PINK = hex('#e2a596');
    const v0 = VF + 0.1, vB = VF + 4.2, v1 = VF + 11;           // frente aberta, parede da loja, fundo
    // piso da varanda (cerâmica) e calçada rebaixada
    box(B, T, -5.5, 5.5, -0.6, 0.12, v0, vB, hex('#a59e94'), hex('#99928a'));
    for (let u = -5.5; u < 5.5; u += 0.5) for (let v = v0; v < vB; v += 0.5) if (((u + v) * 2 | 0) % 2) { const q = [[u, v], [u + 0.5, v], [u + 0.5, v + 0.5], [u, v + 0.5]].map(([a, b]) => P(T, a, 0.125, b)); B.quad(q[0], q[1], q[2], q[3], UP, hex('#b2aba1'), F_PLAIN); }
    // loja: paredes laterais e fundo, porta e vitrine
    box(B, T, -5.5, 5.5, -0.6, 2.7, vB, v1, WALL, WALL2); maskRect(T0, -5.5, 5.5, vB, v1);
    box(B, T, -5.5, -5.3, -0.6, 2.6, v0, vB, PINK, PINK); maskRect(T0, -5.5, -5.3, v0, vB);   // parede da casa rosa ao lado
    wallFeat(B, T, -5.3, 5.5, 0, 0.9, vB, -1, hex('#cfc7b8'));                                    // barrado
    wallFeat(B, T, -4.6, -2.6, 0.9, 2.3, vB, -1, hex('#3d3a36'));                                // grade da janela da cozinha
    for (let u = -4.5; u < -2.6; u += 0.16) wallFeat(B, T, u, u + 0.04, 0.9, 2.3, vB - 0.01, -1, hex('#d9d6cf'));
    wallFeat(B, T, -1.9, -0.6, 0, 2.3, vB, -1, hex('#2f2a26'));                                   // porta da loja
    wallFeat(B, T, 0.2, 4.8, 0.9, 2.3, vB, -1, hex('#3a3633'));                                   // interior escuro com prateleiras
    for (const y of [1.25, 1.65, 2.05]) wallFeat(B, T, 0.3, 4.7, y, y + 0.05, vB - 0.01, -1, hex('#8a6a48'));
    for (let k = 0; k < 18; k++) { const u = 0.4 + (k % 9) * 0.48, y = k < 9 ? 1.3 : 1.7; wallFeat(B, T, u, u + 0.28, y, y + 0.22, vB - 0.02, -1, [hex('#d9a35a'), hex('#c47a3a'), hex('#e8d2a0')][k % 3]); }   // pães
    box(B, T, 0.4, 4.6, 0, 1.0, vB - 0.7, vB, hex('#d4ccbd'), hex('#c5bdae')); box(B, T, 0.4, 4.6, 1.0, 1.08, vB - 0.7, vB, hex('#bfe0ea'), hex('#bfe0ea'));   // balcão com tampo de vidro
    maskRect(T0, 0.4, 4.6, vB - 0.7, vB);
    box(B, T, 4.9, 5.3, 1.2, 1.7, vB - 0.12, vB, hex('#f1f1ee'), hex('#e0e0dc'));                     // quadro de luz
    // pilares de madeira e viga
    const pil = [-5.15, -2.0, 1.4, 5.15];
    for (const u of pil) { box(B, T, u - 0.11, u + 0.11, 0.1, 2.5, v0 + 0.15, v0 + 0.37, WOOD, WOOD2); const p = P(T, u, 0, v0 + 0.26); maskCircle(p[0], p[2], 0.15); }
    box(B, T, -5.5, 5.5, 2.45, 2.62, v0 + 0.12, v0 + 0.4, WOOD, WOOD2);
    for (let u = -5.2; u < 5.4; u += 0.9) box(B, T, u - 0.05, u + 0.05, 2.55, 2.68, v0 + 0.3, vB, WOOD2, WOOD2);   // caibros
    // telhado de barro: água comprida caindo para a rua + platibanda verde atrás
    { const yE = 2.62, yR = 4.3, vR = VF + 6.5, o = 0.5;
      const qa = [P(T, -5.5 - o, yE, v0 - o), P(T, 5.5 + o, yE, v0 - o), P(T, 5.5 + o, yR, vR), P(T, -5.5 - o, yR, vR)];
      B.quad(qa[0], qa[1], qa[2], qa[3], faceN(qa[0], qa[1], qa[2], true), TILE, F_TEX);
      const qb = [P(T, -5.5 - o, yR, vR), P(T, 5.5 + o, yR, vR), P(T, 5.5 + o, 3.0, v1 + o), P(T, -5.5 - o, 3.0, v1 + o)];
      B.quad(qb[0], qb[1], qb[2], qb[3], faceN(qb[0], qb[1], qb[2], true), TILE, F_TEX);
      for (const e of [-1, 1]) { const uE = e * 5.5; B.tri(P(T, uE, 2.62, v0), P(T, uE, yR, vR), P(T, uE, 2.7, v1), N(T, e, 0, 0), WALL, F_PLAIN); }
      for (let k = 0; k < 9; k++) { const t = k / 9, y = yE + (yR - yE) * t, v = v0 - o + (vR - v0 + o) * t; box(B, T, -5.5 - o, 5.5 + o, y - 0.02, y + 0.05, v - 0.04, v + 0.04, hex('#a9502f'), hex('#a9502f')); }   // fiadas de telha
      box(B, T, -1.8, 3.4, 2.7, 5.3, vR + 0.2, vR + 0.5, hex('#aac07a'), hex('#9bb06c')); box(B, T, -1.85, 3.45, 5.3, 5.42, vR + 0.15, vR + 0.55, TILE, TILE); }
    // faixa "Padaria do Jorge" presa na beirada do telhado
    { const bu0 = -0.8, bu1 = 5.6, by0 = 2.75, by1 = 4.1, bv = v0 - 0.35, Tb = T;
      box(B, Tb, bu0, bu1, by0, by1, bv - 0.04, bv, hex('#1f1a17'), hex('#1f1a17'));
      for (const u of [bu0 + 0.15, bu1 - 0.15]) box(B, Tb, u - 0.04, u + 0.04, 2.55, by0, bv - 0.02, bv + 0.05, hex('#3a3a3a'), hex('#3a3a3a'));
      const Wc = 128, Hc = 27, c2 = document.createElement('canvas'); c2.width = Wc; c2.height = Hc; const gx = c2.getContext('2d');
      gx.textAlign = 'center'; gx.textBaseline = 'middle';
      gx.font = "bold 13px 'VT323', monospace"; gx.fillStyle = '#e8892e'; gx.fillText('Padaria', Wc / 2, 7);
      gx.font = "bold 13px 'VT323', monospace"; gx.fillStyle = '#f4f1e8'; gx.fillText('do Jorge', Wc / 2, 19);
      gx.fillStyle = '#e8c35a'; for (const x of [10, 118]) for (let k = 0; k < 5; k++) { gx.fillRect(x - 1, 6 + k * 3, 2, 2); gx.fillRect(x - 4 + (k % 2) * 6, 7 + k * 3, 2, 2); }   // espiguinhas de trigo
      const d = gx.getImageData(0, 0, Wc, Hc).data, px = (bu1 - bu0) / Wc, py = (by1 - by0) / Hc;
      for (let y = 0; y < Hc; y++) { let x0 = -1, col = null; for (let x = 0; x <= Wc; x++) { const i = (y * Wc + x) * 4, on = x < Wc && d[i + 3] > 120, c = on ? [d[i], d[i + 1], d[i + 2]] : null;
        const same = on && col && Math.abs(c[0] - col[0]) + Math.abs(c[1] - col[1]) < 60;
        if (x0 >= 0 && !same) { const a = bu0 + x0 * px, b = bu0 + x * px, yy = by1 - y * py; const q = [P(Tb, a, yy, bv - 0.05), P(Tb, b, yy, bv - 0.05), P(Tb, b, yy - py, bv - 0.05), P(Tb, a, yy - py, bv - 0.05)]; B.quad(q[0], q[1], q[2], q[3], N(Tb, 0, 0, -1), col, F_GLOW); x0 = -1; col = null; }
        if (on && x0 < 0) { x0 = x; col = c; } } } }
    // mesinhas e cadeiras na varanda
    const mesa = (u, v, n) => { const Tm = at(0, 0, g + 0.12), MT = hex('#2b2b2d'), CH = hex('#1d1d1f');
      box(B, Tm, u - 0.35, u + 0.35, 0.72, 0.76, v - 0.35, v + 0.35, hex('#3a3a3c'), MT); box(B, Tm, u - 0.04, u + 0.04, 0, 0.72, v - 0.04, v + 0.04, MT, MT); box(B, Tm, u - 0.25, u + 0.25, 0, 0.03, v - 0.25, v + 0.25, MT, MT);
      const p = P(Tm, u, 0, v); maskCircle(p[0], p[2], 0.4);
      [[0, -0.6, 0], [0, 0.6, 1], [-0.6, 0, 2], [0.6, 0, 3]].slice(0, n).forEach(([du, dv, k]) => { const cu = u + du, cv = v + dv;
        box(B, Tm, cu - 0.2, cu + 0.2, 0.43, 0.47, cv - 0.2, cv + 0.2, CH, CH);
        for (const [lu, lv] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) box(B, Tm, cu + lu - 0.02, cu + lu + 0.02, 0, 0.43, cv + lv - 0.02, cv + lv + 0.02, CH, CH);
        const bu = k === 2 ? -0.2 : k === 3 ? 0.2 : 0, bv = k === 0 ? -0.2 : k === 1 ? 0.2 : 0;
        if (k < 2) box(B, Tm, cu - 0.2, cu + 0.2, 0.47, 0.92, cv + bv - 0.02, cv + bv + 0.02, CH, CH); else box(B, Tm, cu + bu - 0.02, cu + bu + 0.02, 0.47, 0.92, cv - 0.2, cv + 0.2, CH, CH); }); };
    mesa(-3.6, VF + 1.6, 3); mesa(-0.4, VF + 2.3, 4); mesa(3.1, VF + 1.5, 2);
    // banner em pé de promoção e lixeira de cesto com sacolas na calçada
    { const Tm = at(0, 0, g + 0.12); box(B, Tm, 4.55, 4.6, 0, 1.9, v0 + 0.5, v0 + 0.55, hex('#333'), hex('#333')); box(B, Tm, 4.2, 4.9, 0.9, 1.85, v0 + 0.46, v0 + 0.5, hex('#d8b23a'), hex('#c49f2c')); box(B, Tm, 4.3, 4.8, 1.0, 1.3, v0 + 0.44, v0 + 0.46, hex('#b5321f'), hex('#b5321f')); }
    { const p = WP(2.2, VF - 1.4), Tl = at(2.2, VF - 1.4), LX = hex('#3a3d40'); box(B, Tl, -0.03, 0.03, 0, 0.95, -0.03, 0.03, LX, LX); box(B, Tl, -0.32, 0.32, 0.95, 1.25, -0.22, 0.22, LX, LX);
      for (const [a, b, c] of [[-0.25, 0, 0], [0.05, 0.3, 0.05], [-0.1, 0.15, -0.1]]) box(B, Tl, a, b, 1.2 + c * 0.5, 1.5 + c, -0.15, 0.15, hex('#9fd6b0'), hex('#86c49b'));
      maskCircle(p[0], p[1], 0.2); PROPS.push({ k: 'lixeira', x: p[0], z: p[1], a: Math.atan2(uz, ux) }); }
    LATE_NOTES.push({ name: '', style: 'note', x: WP(0, VF + 2)[0], z: WP(0, VF + 2)[1], y: g + 1.4, base: 0, look: 0, t: 0, r: 2.6, says: ['Padaria do Jorge: um bom dia começa com um pão quentinho.'] });
  }
  for (const lm of (W.landmarks || [])) if (lm.type === 'casa127') { // casa 127 da R. Albert Sabin (Street View 10/2024)
    const [ux, uz] = lm.u, [vx, vz] = lm.v;
    const WP = (u, v) => [lm.x + ux * u + vx * v, lm.z + uz * u + vz * v];
    const AX = [ux, 0, uz], AZ = [vx, 0, vz];
    const at = (u, v, y) => { const p = WP(u, v); return { o: [p[0], y === undefined ? groundAt(p[0], p[1]) : y, p[1]], ax: AX, ay: [0, 1, 0], az: AZ }; };
    const B = chunkB(...WP(10, 14)), r = rngFor(lm.x, lm.z, 127);
    const PL = hex('#c9c8c1'), PL2 = hex('#b3b2ab'), GRIME = hex('#9d9b93');
    const ST = [hex('#a99d89'), hex('#958b7a'), hex('#b8ae9b'), hex('#8a8172')], MORT = hex('#6f6a61');
    const MV = 4.9, HW = 2.0;
    // pedras irregulares numa face (pilares e faixa do topo)
    const stones = (T, u0, u1, y0, y1, v) => {
      for (let y = y0; y < y1 - 0.05; y += 0.17) for (let u = u0 + (Math.floor(y / 0.17) % 2) * 0.09; u < u1 - 0.05; u += 0.2) {
        const a = Math.min(u1, u + 0.12 + r() * 0.08), b = Math.min(y1, y + 0.1 + r() * 0.06), c = ST[Math.floor(r() * 4)];
        box(B, T, u, a, y, b, v - 0.012, v + 0.012, c, c);
      }
    };
    const g0 = (u, v) => { const p = WP(u, v); return groundAt(p[0], p[1]); };
    // muro de frente: painéis rebocados entre pilares de pedra + faixa de pedra no topo
    const wallRun = (u0, u1, plain, smooth) => {
      const n = Math.max(1, Math.round((u1 - u0) / 3.6));
      for (let k = 0; k < n; k++) {
        const a = u0 + (u1 - u0) * k / n, b = u0 + (u1 - u0) * (k + 1) / n, gy = Math.min(g0(a, MV), g0(b, MV)), T = at(0, 0, gy);
        box(B, T, a, b, -0.6, HW, MV - 0.1, MV + 0.1, PL, PL);
        box(B, T, a, b, -0.6, 0.35, MV - 0.115, MV + 0.115, GRIME, GRIME);          // barra suja embaixo
        if (r() < 0.6) box(B, T, a + 0.4 + r() * (b - a - 1.2), a + 0.9 + r() * (b - a - 1.2), 0.6, HW - 0.3, MV - 0.112, MV - 0.105, PL2, PL2);  // mancha
        if (smooth) { box(B, T, a - 0.15, a + 0.15, -0.6, HW + 0.1, MV - 0.15, MV + 0.15, PL2, PL2); box(B, T, a, b, HW, HW + 0.08, MV - 0.13, MV + 0.13, hex('#bcbab2'), hex('#bcbab2')); }   // muro liso do vizinho
        else {
          if (!plain || k === 0) { box(B, T, a - 0.2, a + 0.2, -0.6, HW + 0.45, MV - 0.18, MV + 0.18, ST[0], ST[1]); stones(T, a - 0.2, a + 0.2, 0, HW, MV - 0.19); }
          box(B, T, a, b, HW, HW + 0.45, MV - 0.16, MV + 0.16, ST[1], ST[0]); stones(T, a, b, HW, HW + 0.45, MV - 0.17);
        }
        mx.beginPath(); mx.lineWidth = 0.5; const p0 = WP(a, MV), p1 = WP(b, MV); mx.moveTo(p0[0], p0[1]); mx.lineTo(p1[0], p1[1]); mx.stroke();
      }
      if (!smooth) { const gy = g0(u1, MV), T = at(0, 0, gy); box(B, T, u1 - 0.2, u1 + 0.2, -0.6, HW + 0.45, MV - 0.18, MV + 0.18, ST[0], ST[1]); stones(T, u1 - 0.2, u1 + 0.2, 0, HW, MV - 0.19); }
    };
    // Street View 10/2024: muro de pedra do quadro de luz até 3 painéis ao norte; ao sul vai até ~2 m depois da portinha, depois muro liso
    wallRun(-6, 3.5); wallRun(11.6, 14.2); wallRun(14.2, 24, true, true);
    // hera cobrindo todo o muro por dentro do terreno: camada verde + tufos de folhas saltados + cachos caindo por cima
    const IVY = [hex('#2f6b2a'), hex('#3d7f31'), hex('#4f9139'), hex('#28592a'), hex('#5c9e3f')];
    const ivy = (Tw, u0, u1, y0, y1, v, sg) => {   // face em v, lado de dentro em sg
      box(B, Tw, u0, u1, y0, y1, v, v + sg * 0.03, IVY[0], IVY[3]);
      for (let y = y0; y < y1 - 0.1; y += 0.26) for (let u = u0 + r() * 0.2; u < u1 - 0.12; u += 0.3 + r() * 0.15) {
        const w = 0.18 + r() * 0.22, h = 0.16 + r() * 0.2, d = 0.04 + r() * 0.07, c = IVY[Math.floor(r() * 5)];
        const a = Math.min(u1, u + w), b = Math.min(y1 + 0.08, y + h), vv = v + sg * 0.03;
        box(B, Tw, u, a, y, b, Math.min(vv, vv + sg * d), Math.max(vv, vv + sg * d), c, c);
      }
      for (let u = u0; u < u1 - 0.2; u += 0.35 + r() * 0.3) { const c = IVY[Math.floor(r() * 5)], a = Math.min(u1, u + 0.25 + r() * 0.25);   // cachos passando por cima do topo
        box(B, Tw, u, a, y1 - 0.05, y1 + 0.07 + r() * 0.08, Math.min(v - sg * 0.12, v + sg * 0.06), Math.max(v - sg * 0.12, v + sg * 0.06), c, c); }
    };
    for (const [u0, u1, top] of [[-6, 3.5, HW + 0.45], [11.6, 14.2, HW + 0.45], [14.2, 24, HW + 0.08]]) {
      const n = Math.max(1, Math.round((u1 - u0) / 3.6));
      for (let k = 0; k < n; k++) { const a = u0 + (u1 - u0) * k / n, b = u0 + (u1 - u0) * (k + 1) / n, gy = Math.min(g0(a, MV), g0(b, MV));
        ivy(at(0, 0, gy), a + (a === -6 ? 0.1 : 0), b, Math.max(g0(a, MV), g0(b, MV)) - gy - 0.05, top, MV + 0.19, 1); }
    }
    // entrada recuada e coberta em trapézio (Street View 10/2024): abertura larga na rua, fundo estreito = só o portão de correr;
    // à esquerda (sul) a parede branca com o 116 em diagonal, à direita (norte) a parede de pedra em diagonal
    { const gy = g0(7.5, MV), T = at(0, 0, gy), D = 2.6, BV = MV + D, HC = 2.6, TOP = 3.2;
      const uN = 3.5, uS = 11.6, fN = uN + 0.65, fS = uS - 0.65;      // jambas externas e cantos internos da abertura
      const gA = 5.2, gB = gA + 3.4;                                   // portão no fundo
      const jamb = (a, b) => { box(B, T, a, b, -0.6, TOP, MV - 0.22, MV + 0.22, ST[0], ST[1]); stones(T, a, b, 0, TOP, MV - 0.23); };
      jamb(uN, fN); jamb(fS, uS);
      const C = P(T, (gA + gB) / 2, 0, MV + 1.2);                       // um ponto dentro do recuo
      const diag = (u0, v0, u1, v1) => {                                // parede diagonal: frame ao longo dela, com o lado de dentro em sg
        const p0 = P(T, u0, 0, v0), p1 = P(T, u1, 0, v1), dx = p1[0] - p0[0], dz = p1[2] - p0[2], L = Math.hypot(dx, dz);
        const Tw = { o: [p0[0], gy, p0[2]], ax: [dx / L, 0, dz / L], ay: [0, 1, 0], az: [-dz / L, 0, dx / L] };
        const sg = Math.sign((C[0] - p0[0]) * Tw.az[0] + (C[2] - p0[2]) * Tw.az[2]) || 1;
        maskRect(Tw, 0, L, -0.15, 0.15); return { Tw, L, sg };
      };
      // parede da esquerda (branca, com 116, caixa de cartas e interfone)
      { const { Tw, L, sg } = diag(fS, MV + 0.05, gB + 0.35, BV);
        box(B, Tw, -0.05, L, -0.6, HC, -0.12, 0.12, hex('#dedbd1'), hex('#d3d0c6'));
        const fv = sg * 0.12;
        for (let k = 0; k < 9; k++) { const u0 = 0.2 + r() * (L - 0.6), y0 = 0.2 + r() * 2.0; wallFeat(B, Tw, u0, u0 + 0.12 + r() * 0.2, y0, y0 + 0.1 + r() * 0.25, fv, sg, hex('#bdbab1')); }
        wallFeat(B, Tw, 0, L, 0.0, 0.5, fv, sg, hex('#a9a69d'));
        // "116": o eixo da parede vai da rua para o portão; quem está na rua lê da esquerda (rua) para a direita
        const D6 = hex('#2a2a2a'), flip = sg > 0 ? 1 : -1, L0 = 0.5, y0 = 1.85;
        const seg = (x0, x1, a, b) => { const A = flip > 0 ? L0 + x0 : L0 + x0, Bq = L0 + x1; wallFeat(B, Tw, sg < 0 ? L - Bq : A, sg < 0 ? L - A : Bq, y0 + a, y0 + b, fv + sg * 0.01, sg, D6); };
        seg(0, 0.04, 0, 0.28); seg(0.12, 0.16, 0, 0.28);
        seg(0.24, 0.28, 0, 0.27); seg(0.24, 0.38, 0, 0.04); seg(0.34, 0.38, 0, 0.14); seg(0.24, 0.38, 0.12, 0.16); seg(0.26, 0.37, 0.25, 0.29);
        const at2 = x => sg > 0 ? L - x : x;
        box(B, Tw, Math.min(at2(1.45), at2(1.8)), Math.max(at2(1.45), at2(1.8)), 1.15, 1.75, fv - 0.03, fv + 0.03 + sg * 0.03, hex('#9b9a94'), hex('#8a8983'));   // caixa de cartas
        box(B, Tw, Math.min(at2(1.05), at2(1.25)), Math.max(at2(1.05), at2(1.25)), 1.5, 1.72, fv - 0.02, fv + 0.02 + sg * 0.03, hex('#e9e7e1'), hex('#d5d3cc'));  // interfone
      }
      // parede da direita (pedra), com o quadro de luz
      { const { Tw, L, sg } = diag(fN, MV + 0.05, gA - 0.2, BV);
        box(B, Tw, -0.05, L, -0.6, HC, -0.14, 0.14, ST[1], ST[0]); stones(Tw, 0, L, 0, HC, sg * 0.15);
        box(B, Tw, L * 0.35, L * 0.35 + 0.35, 1.0, 1.6, sg * 0.15, sg * 0.2, hex('#4a2c22'), hex('#3b231b')); }
      // pilar de pedra entre o portão e a parede branca
      box(B, T, gB, gB + 0.4, -0.6, HC, BV - 0.2, BV + 0.2, ST[0], ST[1]); stones(T, gB, gB + 0.4, 0, HC, BV - 0.21);
      // portão de correr no fundo (lado menor do trapézio)
      // o portão é desenhado a cada quadro (abre rolando para a direita de quem olha da rua); aqui só o trilho e o pilar
      box(B, T, gA - 3.9, gB, HC - 0.12, HC - 0.04, BV - 0.1, BV + 0.1, hex('#7d7b75'), hex('#7d7b75'));
      maskRect(T, gB, gB + 0.4, BV - 0.2, BV + 0.25);
      GATE116 = { T, gA: gA - 0.2, gB, BV, MV, HC, open: 0, target: 0, farT: 0, fired: false, WP, wall: [fN, fS] };
      // bocal de lâmpada vazio pendurado na laje (o Kiko levou a lâmpada)
      { const bu = (gA + gB) / 2 + 0.6, bv = MV + 1.2, Tb = at(bu, bv, gy);
        beam(B, P(Tb, 0, HC, 0), P(Tb, 0, HC - 0.28, 0), 0.012, hex('#1d1d1d'));                                   // fio
        box(B, Tb, -0.045, 0.045, HC - 0.42, HC - 0.28, -0.045, 0.045, hex('#2b2722'), hex('#3a342d'));             // bocal
        box(B, Tb, -0.03, 0.03, HC - 0.45, HC - 0.42, -0.03, 0.03, hex('#8f8a80'), hex('#8f8a80'));                  // rosca vazia
        box(B, Tb, -0.06, 0.06, HC - 0.02, HC, -0.06, 0.06, hex('#d9d6cd'), hex('#d9d6cd'));                         // canopla
        const p = P(Tb, 0, 0, 0);
        LATE_NOTES.push({ name: '', style: 'note', x: p[0], z: p[2], y: gy + 1.25, base: 0, look: 0, t: 0, r: 2.2, says: ['O Kiko roubou a lâmpada de novo.'] }); }
      // laje de cobertura + verga de pedra na frente (mais alta que o muro)
      box(B, T, uN, uS, HC, HC + 0.18, MV - 0.25, BV + 0.15, hex('#c4c1b8'), hex('#a9a69e'));
      box(B, T, uN, uS, HC + 0.18, TOP, MV - 0.24, MV + 0.24, ST[1], ST[0]); stones(T, uN, uS, HC, TOP, MV - 0.25);
      box(B, T, fN, fS, HC + 0.18, TOP - 0.1, MV + 0.24, BV + 0.15, hex('#bcb9b0'), hex('#bcb9b0'));
      // piso de concreto em trapézio
      { const q = [[fN, MV - 0.1], [fS, MV - 0.1], [gB + 0.35, BV], [gA - 0.2, BV]].map(([u, v]) => { const p = WP(u, v); return [p[0], groundAt(p[0], p[1]) + 0.07, p[1]]; }); B.quad(q[0], q[1], q[2], q[3], UP, hex('#aaa79e'), F_TEX); }
      // entrada da garagem em concreto com grama no meio
      for (const [a, b] of [[gA + 0.2, gA + 1.2], [gB - 1.2, gB - 0.2]]) { const q = [[a, 2.6], [b, 2.6], [b, MV - 0.1], [a, MV - 0.1]].map(([u, v]) => { const p = WP(u, v); return [p[0], groundAt(p[0], p[1]) + 0.09, p[1]]; }); B.quad(q[0], q[1], q[2], q[3], UP, hex('#b5b2a8'), F_TEX); }
    }
    // caixa de correio no poste + touceira de capim
    { const T = at(12.3, 4.15); box(B, T, -0.035, 0.035, 0, 1.25, -0.035, 0.035, hex('#2e2e2e'), hex('#2e2e2e'));
      box(B, T, -0.32, 0.32, 1.25, 1.27, -0.2, 0.2, hex('#3b3b3b'), hex('#3b3b3b'));
      for (const uu of [-0.3, -0.15, 0, 0.15, 0.3]) box(B, T, uu - 0.015, uu + 0.015, 1.27, 1.55, -0.2, 0.2, hex('#3b3b3b'), hex('#3b3b3b'));
      box(B, T, -0.32, 0.32, 1.53, 1.56, -0.2, 0.2, hex('#d8d6cf'), hex('#3b3b3b')); maskCircle(...WP(12.3, 4.15), 0.15); }
    for (const [cu, cv, s] of [[13.3, 4.4, 1], [2.0, 4.5, 0.7], [18.5, 4.4, 0.6]]) { const T = at(cu, cv);
      for (let k = 0; k < 7; k++) { const a = r() * 6.28, d = r() * 0.25 * s, h = (0.5 + r() * 0.6) * s; box(B, frame(T.o[0] + Math.cos(a) * d, T.o[1], T.o[2] + Math.sin(a) * d, r() * 3), -0.05, 0.05, 0, h, -0.22 * s, 0.22 * s, hex('#5f9443'), hex('#4e7f37')); } }
    // muros laterais do lote
    for (const [u0, v0, u1, v1] of [[-6, MV, -6, 29], [24, MV, 24, 29], [-6, 29, 24, 29]]) {
      const n = Math.max(1, Math.round(Math.hypot(u1 - u0, v1 - v0) / 4));
      for (let k = 0; k < n; k++) { const a = [u0 + (u1 - u0) * k / n, v0 + (v1 - v0) * k / n], b = [u0 + (u1 - u0) * (k + 1) / n, v0 + (v1 - v0) * (k + 1) / n];
        const pa = WP(...a), pb = WP(...b), ya = groundAt(pa[0], pa[1]), yb = groundAt(pb[0], pb[1]), Tw = frame(pa[0], 0, pa[1], Math.atan2(pb[1] - pa[1], pb[0] - pa[0])), l = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        box(B, Tw, 0, l, Math.min(ya, yb) - 0.5, Math.max(ya, yb) + 2.0, -0.1, 0.1, PL2, PL2);
        { const cc = WP(9, 17), sg = Math.sign((cc[0] - pa[0]) * Tw.az[0] + (cc[1] - pa[1]) * Tw.az[2]) || 1;   // hera do lado de dentro
          ivy(Tw, 0.1, l - 0.1, Math.max(ya, yb) - 0.05, Math.max(ya, yb) + 2.0, sg * 0.1, sg); }
        mx.beginPath(); mx.lineWidth = 0.4; mx.moveTo(pa[0], pa[1]); mx.lineTo(pb[0], pb[1]); mx.stroke(); }
    }
    // ---- sobrado: branco encardido, telhado de barro com beiral largo, varanda no andar de cima ----
    const hu = 0.6, hv = 14.2, hw = 11, hd = 9, HC = at(hu, hv, 0), [hmin, hmax] = cornersH(HC, hw, hd);
    const T = at(hu, hv, hmax + 0.1), WALL = hex('#e0ded6'), WALL2 = hex('#d2d0c8'), DARK = hex('#3a2c25');
    const fv = -hd / 2;
    box(B, T, -hw / 2, hw / 2, hmin - hmax - 0.5, 0.3, -hd / 2, hd / 2, hex('#bdb9ae'), hex('#bdb9ae'));
    box(B, T, -hw / 2, hw / 2, 0.3, 3.0, -hd / 2, hd / 2, WALL2, WALL2);                 // térreo
    box(B, T, -hw / 2, 1.0, 3.0, 5.8, -hd / 2, hd / 2, WALL, WALL);                     // andar de cima (lado norte)
    box(B, T, 1.0, hw / 2, 3.0, 5.8, fv + 1.7, hd / 2, WALL, WALL);                      // parte recuada da varanda
    box(B, T, 1.0, hw / 2, 2.95, 3.15, fv - 0.1, fv + 1.7, hex('#cfcdc4'), hex('#b9b7ae')); // piso da varanda
    box(B, T, 1.0, hw / 2, 3.15, 4.0, fv - 0.05, fv + 0.12, hex('#d6d4cc'), hex('#c8c6be')); // parapeito
    box(B, T, 1.0, hw / 2, 4.0, 4.08, fv - 0.1, fv + 0.17, hex('#8f8d86'), hex('#8f8d86'));
    for (const cu of [1.15, hw / 2 - 0.15]) box(B, T, cu - 0.1, cu + 0.1, 4.0, 5.8, fv - 0.05, fv + 0.15, hex('#ecebe5'), hex('#dcdbd4'));   // colunas finas
    wallFeat(B, T, 2.6, 3.5, 3.15, 5.2, fv + 1.7, -1, DARK);                              // porta escura da varanda
    wallFeat(B, T, 3.6, 3.8, 3.4, 5.2, fv + 1.7, -1, hex('#6a5546'));
    wallFeat(B, T, -3.6, -2.4, 4.0, 4.9, fv, -1, DARK);                                   // janelinha do lado norte
    wallFeat(B, T, 1.4, 4.6, 0.9, 2.3, fv, -1, hex('#5d6a72'));                           // janela do térreo com grade azulada
    for (let gu = 1.5; gu < 4.6; gu += 0.22) wallFeat(B, T, gu, gu + 0.05, 0.9, 2.3, fv - 0.02, -1, hex('#7fa0b6'));
    wallFeat(B, T, -2.8, -1.6, 0.4, 2.5, fv, -1, DARK);                                   // porta do térreo
    // encardido: faixa embaixo do beiral e escorridos
    wallFeat(B, T, -hw / 2, 1.0, 5.35, 5.8, fv, -1, GRIME);
    for (const su of [-4.7, -3.0, -0.6, 0.6]) wallFeat(B, T, su, su + 0.25, 3.3 + r() * 0.8, 5.4, fv, -1, hex('#b8b6ad'));
    wallFeat(B, T, -hw / 2, hw / 2, 2.7, 3.0, fv, -1, GRIME);
    for (const sv of [-3, 0, 3]) { sideFeat(B, T, sv - 0.5, sv + 0.5, 4.0, 4.9, -hw / 2, -1, DARK); sideFeat(B, T, sv - 0.5, sv + 0.5, 1.1, 2.1, -hw / 2, -1, DARK); }
    hipRoof(B, T, hw, hd, 5.8, 1.7, 0.95, hex('#b8653f'));
    // ala baixa ao sul com telhado próprio
    { const Tw = at(hu + hw / 2 + 2.2, hv + 1.5, hmax + 0.1); box(B, Tw, -2.2, 2.2, hmin - hmax - 0.5, 2.9, -3.2, 3.2, WALL2, WALL2); wallFeat(B, Tw, -1.0, 0.4, 1.0, 2.1, -3.2, -1, DARK); hipRoof(B, Tw, 4.4, 6.4, 2.9, 1.0, 0.7, hex('#ad5c39')); }
    // antena parabólica no telhado
    { const p = P(T, -3.6, 6.4, -1.2); const Td = frame(p[0], p[1], p[2], Math.atan2(uz, ux) + 2.4); box(B, Td, -0.03, 0.03, -0.4, 0.2, -0.03, 0.03, hex('#777'), hex('#777')); box(B, Td, -0.06, 0.06, 0.05, 0.75, -0.36, 0.36, hex('#d7d7d2'), hex('#bdbdb7')); }
    maskRect(at(0, 0, 0), hu - hw / 2, hu + hw / 2, hv - hd / 2, hv + hd / 2); maskRect(at(0, 0, 0), hu + hw / 2, hu + hw / 2 + 4.4, hv + 1.5 - 3.2, hv + 1.5 + 3.2);   // casa + ala sul (antes a máscara cobria também a frente da ala, bloqueando a entrada)
    // os 4 cachorros do quintal: pitbull, bull terrier e dois yorkshires (um de roupinha com brinquedo)
    { const yard = { x: lm.x, z: lm.z, u: lm.u, v: lm.v, u0: -5.2, u1: 23.2, v0: 5.6, v1: 28.2, nu0: 3.3, nu1: 11.8, nv: 8.0 };
      for (const [kind, du, dv] of [['pitbull', 14, 10], ['bull', 18, 14], ['yorkie', -2, 7], ['yorkieRoupa', 13, 18]]) {
        const p = WP(du, dv); DOGS.push({ kind, x: p[0], z: p[1], a: Math.random() * 6.28, yard, tx: p[0], tz: p[1], wait: Math.random() * 3, ph: Math.random() * 6, wag: 0, spd: 0 }); } }
    // árvores: mangueiras grandes ao sul, coqueiro atrás do muro, arbusto que passa por cima do muro
    for (const [tu, tv, s] of [[17.5, 9.5, 2.1]]) { const p = WP(tu, tv); tree(chunkB(p[0], p[1]), p[0], p[1], 0, s, true); }   // só a mangueira perto do muro da frente
    { const p = WP(21.6, 26.2); tree(chunkB(p[0], p[1]), p[0], p[1], 3, 1.45, true); }   // coqueiro no canto do fundo, perto da fita
    for (const [bu, bv, h] of [[14.4, 7.3, 2.9], [17.4, 7.0, 2.6], [-3.0, 6.6, 2.2]]) box(B, at(bu, bv), -1.1, 1.1, 0, h, -0.9, 0.9, hex('#4f8a3a'), hex('#41772f'), F_TEX);
  }
  for (const lm of (W.landmarks || [])) if (lm.type === 'weedlot') { // terreno baldio: mato alto
    const r = rngFor(lm.x, lm.z, 5), B = chunkB(lm.x, lm.z);
    for (let k = 0; k < 160; k++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 13, x = lm.x + Math.cos(a) * d, z = lm.z + Math.sin(a) * d;
      if (roadSurf(x, z) && roadSurf(x, z).e < 0.5) continue;
      const s = 0.25 + r() * 0.35, hgt = 0.5 + r() * 0.9, g = jit(hex(r() < 0.3 ? '#a3a85a' : '#6e9a3e'), r, 0.12);
      box(B, frame(x, groundAt(x, z) - 0.05, z, r() * 3), -s, s, 0, hgt, -s, s, g, g, F_TEX); }
  }
}

// ---------------- trees ----------------
function tree(B, x, z, kind, s, castMask) {
  const r = rngFor(x, z, 7);
  const T = frame(x, groundAt(x, z) - 0.2, z, r() * Math.PI);
  const leaf = jit(pick(LEAF, r), r, 0.1), leaf2 = jit(leaf, r, 0.12), trunk = jit(C.trunk, r, 0.1);
  if (kind === 3) {
    const h = 6.5 * s, lean = (r() - 0.5) * 0.8;
    box(B, T, -0.2, 0.2, 0, h * 0.5, -0.2, 0.2, trunk, trunk);
    box(B, T, -0.18 + lean * 0.5, 0.18 + lean * 0.5, h * 0.5, h, -0.18, 0.18, trunk, trunk);
    const top = P(T, lean * 0.5, h, 0);
    const pc = jit(hex('#4f9a3a'), r, 0.1);
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2 + r(), L = 3.2 * s, cx = Math.cos(a), cz = Math.sin(a);
      const mid = [top[0] + cx * L * 0.55, top[1] + 0.5, top[2] + cz * L * 0.55], tip = [top[0] + cx * L, top[1] - 1.4 * s, top[2] + cz * L];
      const wx = -cz * 0.45, wz = cx * 0.45;
      B.quad([top[0] - wx * 0.4, top[1], top[2] - wz * 0.4], [mid[0] - wx, mid[1], mid[2] - wz], [mid[0] + wx, mid[1], mid[2] + wz], [top[0] + wx * 0.4, top[1], top[2] + wz * 0.4], UP, pc, F_TEX);
      B.quad([mid[0] - wx, mid[1], mid[2] - wz], [tip[0], tip[1], tip[2]], [tip[0], tip[1], tip[2]], [mid[0] + wx, mid[1], mid[2] + wz], faceN([mid[0] - wx, mid[1], mid[2] - wz], tip, [mid[0] + wx, mid[1], mid[2] + wz], true), pc, F_TEX);
    }
    box(B, T, -0.35 + lean * 0.5, 0.35 + lean * 0.5, h - 0.4, h + 0.2, -0.35, 0.35, hex('#6b5a2a'), hex('#6b5a2a'));
    if (castMask) maskCircle(x, z, 0.3);
    return;
  }
  if (kind === 1) {
    const h = 2.4 * s;
    box(B, T, -0.2 * s, 0.2 * s, 0, h, -0.2 * s, 0.2 * s, trunk, trunk);
    box(B, T, -1.3 * s, 1.3 * s, h * 0.8, h * 0.8 + 1.6 * s, -1.3 * s, 1.3 * s, leaf, leaf);
    box(B, T, -0.95 * s, 0.95 * s, h * 0.8 + 1.6 * s, h * 0.8 + 3.0 * s, -0.95 * s, 0.95 * s, leaf2, leaf2);
    box(B, T, -0.5 * s, 0.5 * s, h * 0.8 + 3.0 * s, h * 0.8 + 3.9 * s, -0.5 * s, 0.5 * s, leaf, leaf);
  } else if (kind === 2) {
    const h = 2.2 * s;
    box(B, T, -0.35 * s, 0.35 * s, 0, h + 0.5, -0.35 * s, 0.35 * s, trunk, trunk);
    box(B, T, -2.6 * s, 2.6 * s, h, h + 1.7 * s, -2.2 * s, 2.2 * s, leaf, leaf);
    const ou = (r() - 0.5) * 1.6 * s, ov = (r() - 0.5) * 1.6 * s;
    box(B, T, ou - 1.6 * s, ou + 1.6 * s, h + 1.7 * s, h + 2.6 * s, ov - 1.4 * s, ov + 1.4 * s, leaf2, leaf2);
  } else {
    const h = 2.0 * s;
    const c1 = kind === 4 ? jit(pick(IPE, r), r, 0.08) : leaf, c2 = kind === 4 ? jit(c1, r, 0.1) : leaf2;
    box(B, T, -0.25 * s, 0.25 * s, 0, h + 0.4, -0.25 * s, 0.25 * s, trunk, trunk);
    box(B, T, -1.7 * s, 1.7 * s, h, h + 2.2 * s, -1.7 * s, 1.7 * s, c1, c1);
    box(B, T, -1.1 * s, 1.1 * s, h + 2.2 * s, h + 3.1 * s, -1.1 * s, 1.1 * s, c2, c2);
    if (r() < 0.5) { const su = (r() < 0.5 ? -1 : 1) * 1.5 * s; box(B, T, su - 0.8 * s, su + 0.8 * s, h + 0.6 * s, h + 1.8 * s, -0.8 * s, 0.8 * s, c2, c2); }
  }
  if (castMask) maskCircle(x, z, 0.35 * s);
}
for (const t of W.trees) tree(chunkB(t[0], t[1]), t[0], t[1], t[2], t[3], true);
// praça do alto do bairro (ilha da rotatória): no lugar da árvore, um banco de madeira de dois lados com encosto no meio
let BENCH = null;
for (const a of W.areas) if (a.t === 'island') {
  const [cx, cz] = centroid(a.pts), ba = 0.35, gy = groundAt(cx, cz), T = frame(cx, gy, cz, ba), B = chunkB(cx, cz);
  const WD = hex('#9a6a3e'), WD2 = hex('#86592f'), WD3 = hex('#7a4f2a'), IR = hex('#3a3a3c'), L = 1.15, SY = 0.46;
  for (const u of [-L + 0.15, 0, L - 0.15]) {   // pés de ferro (em A, um de cada lado) + travessa
    box(B, T, u - 0.05, u + 0.05, -0.2, SY - 0.06, -0.5, -0.42, IR, IR); box(B, T, u - 0.05, u + 0.05, -0.2, SY - 0.06, 0.42, 0.5, IR, IR);
    box(B, T, u - 0.05, u + 0.05, SY - 0.1, SY - 0.05, -0.55, 0.55, IR, IR);
    box(B, T, u - 0.04, u + 0.04, SY - 0.05, 0.98, -0.04, 0.04, IR, IR);   // poste do encosto
  }
  for (const sg of [-1, 1]) for (let k = 0; k < 3; k++) { const v0 = 0.1 + k * 0.155, c = k % 2 ? WD2 : WD;   // assento: 3 ripas de cada lado
    box(B, T, -L, L, SY - 0.05, SY, Math.min(sg * v0, sg * (v0 + 0.13)), Math.max(sg * v0, sg * (v0 + 0.13)), c, WD3); }
  for (const [y0, c] of [[0.56, WD], [0.72, WD2], [0.88, WD]]) box(B, T, -L, L, y0, y0 + 0.11, -0.045, 0.045, c, WD3);   // encosto no meio, serve dos dois lados
  maskRect(T, -L, L, -0.55, 0.55);
  const spot = (u, v) => P(T, u, 0, v);
  BENCH = { T, a: ba, seatY: gy + SY, spots: [], tape: null };
  for (const u of [-0.55, 0.55]) for (const sg of [-1, 1]) { const p = spot(u, sg * 0.2), st = spot(u, sg * 1.05); BENCH.spots.push({ x: p[0], z: p[2], a: ba + sg * Math.PI / 2, sx: st[0], sz: st[2] }); }
  const tp = spot(L + 1.4, 0); BENCH.tape = [tp[0], tp[2], ba];   // fita ao lado do banco
}

// ---------------- lamps ----------------
for (const [x, z, a] of W.lamps) {
  const B = chunkB(x, z), T = frame(x, surfAt(x, z), z, a), g = hex('#7d838c');
  box(B, T, -0.12, 0.12, -0.3, 7, -0.12, 0.12, g, g);
  box(B, T, 0, 1.8, 6.8, 7.0, -0.08, 0.08, g, g);
  box(B, T, 1.4, 2.1, 6.6, 6.9, -0.25, 0.25, hex('#5c6168'), hex('#fff3c4'));
  maskCircle(x, z, 0.2); PROPS.push({ k: 'luminaria', x, z, a });
}

// ---------------- carrinhos de rolimã + marcas de drift (rua que desce para o norte em frente à rotatória) ----------------
function rolima(B, T) {   // T: ax = comprimento da prancha (traseira -> bico), ay = espessura, az = largura
  const WOOD = hex('#9a4b33'), WOOD2 = hex('#86402b'), AXLE = hex('#b97d48'), MET = hex('#a7adb3'), DARK = hex('#2f2f31');
  box(B, T, 0, 0.62, 0, 0.025, -0.18, 0.18, WOOD, WOOD2);                         // prancha (parte larga)
  for (let k = 0; k < 4; k++) { const u0 = 0.62 + k * 0.08, w = 0.18 - (k + 1) * 0.035; box(B, T, u0, u0 + 0.08, 0, 0.025, -w, w, WOOD, WOOD2); }   // bico afinando
  box(B, T, 0.86, 0.94, -0.065, -0.005, -0.32, 0.32, AXLE, AXLE);                  // eixo dianteiro de madeira
  for (const v of [-0.34, 0.34]) box(B, T, 0.86, 0.94, -0.075, 0.005, v - 0.03, v + 0.03, MET, DARK);   // rolamentos da frente
  for (const v of [-0.15, 0.15]) box(B, T, 0.03, 0.11, -0.07, 0.0, v - 0.025, v + 0.025, MET, DARK);    // rolamentos de trás
  for (const v of [-1, 1]) { box(B, T, 0.12, 0.17, 0.025, 0.06, v * 0.12 - 0.02, v * 0.12 + 0.02, WOOD2, WOOD2); box(B, T, 0.12, 0.17, 0.045, 0.065, v * 0.12, v * 0.27, WOOD2, WOOD2); }   // apoios dos pés
  box(B, T, 0.9, 0.92, 0.025, 0.035, -0.012, 0.012, DARK, DARK);                   // parafuso do eixo
}
{
  const st = W.roads.find(r => !r.n && r.t === 'residential' && r.pts.length === 2 && Math.abs(r.pts[0][0] + 6.8) < 1 && Math.abs(r.pts[0][1] - 107.1) < 1);
  if (st) {
    const [A, Bp] = st.pts, L = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]), d = [(Bp[0] - A[0]) / L, (Bp[1] - A[1]) / L], n = [-d[1], d[0]];
    const at = (u, v) => [A[0] + d[0] * u + n[0] * v, A[1] + d[1] * u + n[1] * v];
    // dois carrinhos em pé, encostados do lado de fora do muro lateral direito da casa da esquina (voltado para a rua)
    const wallA = [-13.63, 98.13], wallB = [-13.96, 94.14];
    const wL = Math.hypot(wallB[0] - wallA[0], wallB[1] - wallA[1]);
    const wd = [(wallB[0] - wallA[0]) / wL, (wallB[1] - wallA[1]) / wL]; // direção ao longo do muro lateral direito
    const wn = [-wd[1], wd[0]]; // normal apontando para fora do muro lateral direito (lado da rua)
    for (const [s, tilt] of [[1.3, 0.30], [2.3, 0.25]]) {
      const px = wallA[0] + wd[0] * s + wn[0] * 0.16;
      const pz = wallA[1] + wd[1] * s + wn[1] * 0.16;
      const g = groundAt(px, pz);
      // prancha quase em pé, inclinada para trás (-wn) encostando na face externa do muro lateral
      const up = [-wn[0] * Math.sin(tilt), Math.cos(tilt), -wn[1] * Math.sin(tilt)];
      const out = [wn[0] * Math.cos(tilt), Math.sin(tilt), wn[1] * Math.cos(tilt)];
      const T = { o: [px + wn[0] * 0.22, g + 0.02, pz + wn[1] * 0.22], ax: up, ay: out, az: [wd[0], 0, wd[1]] };
      rolima(chunkB(px, pz), T);
      maskCircle(px + wn[0] * 0.15, pz + wn[1] * 0.15, 0.25);
    }
    {
      const midS = 1.8;
      const mx = wallA[0] + wd[0] * midS + wn[0] * 0.35;
      const mz = wallA[1] + wd[1] * midS + wn[1] * 0.35;
      LATE_NOTES.push({ name: '', style: 'note', x: mx, z: mz, y: groundAt(mx, mz) + 0.35, base: 0, look: 0, t: 0, r: 3.0, says: ['Lucas e Bruno estiveram aqui.'] });
    }
    // marcas pretas dos rolamentos: descem a rua e no fim fazem a curva do "drift"
    const MARK = [30, 30, 33];
    const track = (vOff, spread, side, seed) => {
      let rs = seed; const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
      const pts = [], u0 = 12 + rnd() * 6, uT = L - 6.5 - rnd() * 1.5;
      for (let u = u0; u <= uT; u += 0.8) pts.push(at(u, vOff + Math.sin(u * 0.17 + seed) * 0.12));
      // arco do drift: vira para o lado e escorrega
      const R = 4.2 + rnd() * 1.2, end = pts[pts.length - 1], TH = 1.0 + rnd() * 0.25;
      for (let k = 1; k <= 14; k++) {
        const th = k / 14 * TH, du = Math.sin(th) * R, dv = (1 - Math.cos(th)) * R * side + side * spread * k / 14;
        pts.push([end[0] + d[0] * du + n[0] * dv, end[1] + d[1] * du + n[1] * dv]);
      }
      return pts;
    };
    let sd = 11;
    for (const [base, side] of [[-0.9, 1], [0.8, -1]]) {   // dois carrinhos, cada um com a trilha das rodas da frente e de trás
      for (const [off, spread] of [[-0.34, 0], [0.34, 0], [-0.15, 0.9], [0.15, 0.9]]) {
        const pts = track(base + off, spread, side, sd++);
        const [cx, cz] = centroid(pts);
        const Bm = chunkB(cx, cz);
        for (let i = 0; i < pts.length - 1; i++) {   // faixa contínua seguindo o asfalto
          const p = pts[i], q = pts[i + 1], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * 0.045, nz = dx / l * 0.045;
          const V = (x, z) => [x, roadY(x, z) + 0.23, z];
          Bm.quad(V(p[0] + nx, p[1] + nz), V(q[0] + nx, q[1] + nz), V(q[0] - nx, q[1] - nz), V(p[0] - nx, p[1] - nz), UP, MARK, F_PLAIN);
        }
      }
    }
  }
}
// ---------------- landmark: guarita "SEGURANÇA" + Portela ----------------
function beam(B, a, b, t, col, fl) { // box between two 3D points
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1;
  const ax = [dx / L, dy / L, dz / L];
  let up = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let az = [ax[1] * up[2] - ax[2] * up[1], ax[2] * up[0] - ax[0] * up[2], ax[0] * up[1] - ax[1] * up[0]];
  const l2 = Math.hypot(...az); az = az.map(v => v / l2);
  const ay = [az[1] * ax[2] - az[2] * ax[1], az[2] * ax[0] - az[0] * ax[2], az[0] * ax[1] - az[1] * ax[0]];
  box(B, { o: a, ax, ay, az }, 0, L, -t / 2, t / 2, -t / 2, t / 2, col, col, fl);
}
function yawChild(T, pu, py, pv, a) { const c = Math.cos(a), s = Math.sin(a); return { o: P(T, pu, py, pv), ax: N(T, c, 0, s), ay: T.ay, az: N(T, -s, 0, c) }; }
const GLYPH = {
  S: ['111', '100', '111', '001', '111'], E: ['111', '100', '111', '100', '111'], G: ['111', '100', '101', '101', '111'],
  U: ['101', '101', '101', '101', '111'], R: ['110', '101', '110', '101', '101'], A: ['010', '101', '111', '101', '101'],
  N: ['101', '111', '111', '101', '101'], 'Ç': ['111', '100', '100', '100', '111', '010'],
};
function pixelText(B, T, text, u0, y0, vf, px, col) { // text on the wall plane v = vf, facing +v
  let u = u0;
  for (const ch of text) {
    const g = GLYPH[ch]; if (!g) { u += px * 4; continue; }
    g.forEach((row, ri) => { for (let k = 0; k < 3; k++) if (row[k] === '1') {
      const a = u + k * px, y = y0 - ri * px;
      B.quad(P(T, a, y - px, vf), P(T, a + px, y - px, vf), P(T, a + px, y, vf), P(T, a, y, vf), N(T, 0, 0, 1), col, F_PLAIN);
    } });
    u += px * 4;
  }
}
const NPCS = [];
NPCS.push(...LATE_NOTES);
const FLY_SPOTS = [];
for (const lm of (W.landmarks || [])) {
  if (lm.type !== 'guarita') continue;
  const ang = lm.front - Math.PI / 2;
  const T0 = frame(lm.x, 0, lm.z, ang);
  const w = 3.6, d = 3.0, H = 2.7;
  const [hmin, hmax] = cornersH(T0, w + 1, d + 6);
  const y0 = hmax + 0.12;
  const T = frame(lm.x, y0, lm.z, ang);
  const B = chunkB(lm.x, lm.z);
  const YEL = hex('#e9b93c'), YEL2 = hex('#d9a92f'), ROOF = hex('#b7532f'), BASE = hex('#7c776c');
  // concrete pad (wider towards the street, like the photo) + base
  box(B, T, -2.1, 2.1, hmin - y0 - 0.3, 0, -d / 2 - 0.3, d / 2 + 0.3, hex('#c9c4b8'), BASE);
  const padY = 0.02, pa = P(T, -1.9, padY, d / 2), pb = P(T, 1.9, padY, d / 2), pc = P(T, 2.5, padY, d / 2 + 3.0), pd = P(T, -2.5, padY, d / 2 + 3.0);
  for (const p of [pc, pd]) p[1] = Math.max(groundAt(p[0], p[2]) + 0.1, p[1] - 0.25);
  B.quad(pa, pb, pc, pd, UP, hex('#cfcac0'), F_TEX);
  box(B, T, -2.5, 2.5, Math.min(pc[1], pd[1]) - y0 - 0.4, Math.min(pc[1], pd[1]) - y0 - 0.02, d / 2, d / 2 + 3.0, hex('#cfcac0'), BASE);
  // walls
  box(B, T, -w / 2, w / 2, 0, 0.25, -d / 2 - 0.03, d / 2 + 0.03, hex('#8f7a3a'), hex('#8f7a3a'));
  box(B, T, -w / 2, w / 2, 0.25, H, -d / 2, d / 2, YEL, YEL);
  // gable roof with the triangle facing the street
  const T2 = { o: T.o, ax: T.az, ay: T.ay, az: [-T.ax[0], 0, -T.ax[2]] };
  gableRoof(B, T2, d, w, H, 0.85, 0.35, ROOF, YEL2);
  box(B, T, -w / 2 - 0.35, w / 2 + 0.35, H - 0.12, H, d / 2 + 0.3, d / 2 + 0.38, hex('#8e3f24'), hex('#8e3f24')); // fascia
  const vf = d / 2;
  // window with frame & bars
  wallFeat(B, T, -1.45, -0.15, 0.9, 2.05, vf, 1, hex('#e6e0d2'));
  const wf = vf + 0.05;   // à frente da moldura (wallFeat fica em vf + 0.04), para não piscar
  B.quad(P(T, -1.38, 0.97, wf + 0.01), P(T, -0.22, 0.97, wf + 0.01), P(T, -0.22, 1.98, wf + 0.01), P(T, -1.38, 1.98, wf + 0.01), N(T, 0, 0, 1), hex('#2b3644'), F_PLAIN);
  for (const u of [-1.0, -0.6]) B.quad(P(T, u - 0.025, 0.97, wf + 0.02), P(T, u + 0.025, 0.97, wf + 0.02), P(T, u + 0.025, 1.98, wf + 0.02), P(T, u - 0.025, 1.98, wf + 0.02), N(T, 0, 0, 1), hex('#e6e0d2'), F_PLAIN);
  B.quad(P(T, -1.38, 1.45, wf + 0.02), P(T, -0.22, 1.45, wf + 0.02), P(T, -0.22, 1.5, wf + 0.02), P(T, -1.38, 1.5, wf + 0.02), N(T, 0, 0, 1), hex('#e6e0d2'), F_PLAIN);
  // roll-up steel door with ribs
  wallFeat(B, T, 0.3, 1.3, 0.25, 2.3, vf, 1, hex('#6c7d95'));
  for (let y = 0.35; y < 2.25; y += 0.14) B.quad(P(T, 0.3, y, wf + 0.01), P(T, 1.3, y, wf + 0.01), P(T, 1.3, y + 0.04, wf + 0.01), P(T, 0.3, y + 0.04, wf + 0.01), N(T, 0, 0, 1), hex('#58687f'), F_PLAIN);
  // "SEGURANÇA" sign and the little plaque
  pixelText(B, T, 'SEGURANÇA', -1.55, 2.5, wf + 0.02, 0.045, hex('#1d2740'));
  wallFeat(B, T, 0.45, 1.05, 2.33, 2.55, vf + 0.01, 1, hex('#2a3446'));
  maskRect(T, -w / 2, w / 2, -d / 2, d / 2);
  // doghouse on a pallet, with corrugated roof
  {
    const D = yawChild(T, -1.55, 0, d / 2 + 1.1, 0.15), wood = hex('#b07a43'), wood2 = hex('#9a6a39');
    box(B, D, -0.65, 0.65, 0, 0.12, -0.5, 0.5, hex('#8a6a45'), hex('#7a5b3a'));
    box(B, D, -0.55, 0.55, 0.12, 0.85, -0.42, 0.42, wood, wood);
    for (let y = 0.25; y < 0.85; y += 0.16) box(B, D, -0.56, 0.56, y, y + 0.03, -0.43, 0.43, wood2, wood2);
    box(B, D, 0.555, 0.565, 0.14, 0.6, -0.18, 0.18, hex('#2a2016'), hex('#2a2016'));
    box(B, D, -0.68, 0.68, 0.85, 0.9, -0.55, 0.55, hex('#a9bccb'), hex('#94a8b8'));
    for (let v = -0.5; v < 0.55; v += 0.12) box(B, D, -0.68, 0.68, 0.9, 0.92, v, v + 0.05, hex('#c4d3de'), hex('#c4d3de'));
    const p = P(D, 0, 0, 0); maskRect(D, -0.65, 0.65, -0.5, 0.5); PROPS.push({ k: 'casinha', x: p[0], z: p[2], a: angOf(D) });
  }
  // blue water bowl
  { const Bw = yawChild(T, 0.05, 0, d / 2 + 0.55, 0); box(B, Bw, -0.13, 0.13, 0, 0.1, -0.13, 0.13, hex('#2f6fd6'), hex('#2559b0')); box(B, Bw, -0.09, 0.09, 0.1, 0.105, -0.09, 0.09, hex('#5aa8e6'), hex('#5aa8e6'), F_WATER); }
  // bicicleta do Portela: desenhada a cada quadro (some quando ele sai para a volta no bairro)
  { const K = yawChild(T, 0.85, 0, d / 2 + 1.05, Math.PI / 2 + 0.12), p = P(K, 0, 0, 0);
    PORTELA_PARK = { x: p[0], z: p[2], y: p[1], a: angOf(K) };   // y = piso da guarita (não o chão em volta)
    maskRect(K, -0.9, 0.9, -0.2, 0.2); PROPS.push({ k: 'bike', x: p[0], z: p[2], a: angOf(K) }); }
  // the two trees framing the booth (tall one on the left, mangueira on the right)
  { const a = P(T, -4.6, 0, 0.6); tree(chunkB(a[0], a[2]), a[0], a[2], 0, 1.55, true); const b = P(T, 4.7, 0, 0.9); tree(chunkB(b[0], b[2]), b[0], b[2], 2, 1.35, true); }
  // Portela, standing by the door
  const np = P(T, 1.55, 0, d / 2 + 0.95);
  NPCS.push({ name: 'Portela', x: np[0], z: np[2], y: y0 + 0.02, base: lm.front + 0.9, look: 0, t: 0, home: { x: np[0], z: np[2], y: y0 + 0.02, base: lm.front + 0.9 } });
  maskCircle(np[0], np[2], 0.35);
  POIS.push({ n: 'Portela', x: np[0], z: np[2], y: 2.5, npc: true });
}

// ---------------- landmark: Parque Colina + igreja ----------------
Object.assign(GLYPH, {
  P: ['110', '101', '110', '100', '100'], Q: ['010', '101', '101', '111', '011'], C: ['111', '100', '100', '100', '111'],
  O: ['111', '101', '101', '101', '111'], F: ['111', '100', '110', '100', '100'], M: ['101', '111', '101', '101', '101'], L: ['100', '100', '100', '100', '111'], I: ['111', '010', '010', '010', '111'],
});
for (const lm of (W.landmarks || [])) {
  if (lm.type !== 'parque') continue;
  const FE = lm.W - 6.8; // fence line on the Agenor Lopes Siqueira side
  const T0 = frame(lm.x, 0, lm.z, lm.ang);
  const WP = (u, v) => P(T0, u, 0, v);
  const gA = (u, v) => { const p = WP(u, v); return groundAt(p[0], p[2]); };
  const B = chunkB(...(() => { const p = WP(30, 25); return [p[0], p[2]]; })());
  // draped rectangle in park coordinates
  function drape(u0, u1, v0, v1, off, col, fl, step) {
    step = step || 2.5;
    const nu = Math.max(1, Math.ceil((u1 - u0) / step)), nv = Math.max(1, Math.ceil((v1 - v0) / step));
    const V = (u, v) => { const p = WP(u, v); return [p[0], groundAt(p[0], p[2]) + off, p[2]]; };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a0 = u0 + (u1 - u0) * i / nu, a1 = u0 + (u1 - u0) * (i + 1) / nu, b0 = v0 + (v1 - v0) * j / nv, b1 = v0 + (v1 - v0) * (j + 1) / nv;
      B.quad(V(a0, b0), V(a1, b0), V(a1, b1), V(a0, b1), UP, typeof col === 'function' ? col(a0, b0) : col, fl);
    }
  }
  const lineU = (u0, u1, v, w, off, col) => drape(u0, u1, v - w, v + w, off, col, F_PLAIN, 2);
  const lineV = (v0, v1, u, w, off, col) => drape(u - w, u + w, v0, v1, off, col, F_PLAIN, 2);
  // local frame standing on the ground at (u, v)
  const at = (u, v, a, lift) => { const p = WP(u, v); return { o: [p[0], groundAt(p[0], p[2]) + (lift || 0), p[2]], ax: N(T0, Math.cos(a || 0), 0, Math.sin(a || 0)), ay: [0, 1, 0], az: N(T0, -Math.sin(a || 0), 0, Math.cos(a || 0)) }; };
  const lab = (n, u, v, y) => { const p = WP(u, v); POIS.push({ n, x: p[0], z: p[2], y }); };
  const POST = hex('#2f63a8'), RED = hex('#c0392b'), WIRE = hex('#8d979f'), SANDC = hex('#d8c39a'), SAND2 = hex('#cdb48a');

  // ---- ground surfaces ----
  const hsh = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
  drape(52, lm.L - 5.2, 5.6, lm.W - 5.6, 0.05, hex('#c4bfb4'), F_TEX);                       // church yard (concrete)
  drape(8.5, 49.5, 27.4, FE - 0.6, 0.06, (u, v) => { const r = hsh(Math.floor(u / 4), Math.floor(v / 4)); return r < 0.18 ? hex('#a59a63') : r < 0.5 ? hex('#6da047') : hex('#78a84d'); }, F_TEX); // worn football pitch
  drape(7, 30.5, 7, 26, 0.06, SANDC, F_TEX);                                         // beach volleyball sand
  drape(30.5, 50.5, 7, 26, 0.06, (u, v) => hsh(Math.floor(u / 3), Math.floor(v / 3)) < 0.3 ? SAND2 : SANDC, F_TEX); // playground sand
  drape(44.5, 50.5, 5.6, 14, 0.09, hex('#b3aea5'), F_TEX, 1.5);                      // paver path from the entrance
  // pitch lines
  const LC = hex('#e9ecdf');
  lineU(9.5, 48.5, 28.5, 0.08, 0.1, LC); lineU(9.5, 48.5, FE - 1.8, 0.08, 0.1, LC);
  const VC = (28.5 + FE - 1.8) / 2;
  lineV(28.5, FE - 1.8, 9.5, 0.08, 0.1, LC); lineV(28.5, FE - 1.8, 48.5, 0.08, 0.1, LC); lineV(28.5, FE - 1.8, 29, 0.08, 0.1, LC);
  for (let k = 0; k < 20; k++) { const a0 = k / 20 * Math.PI * 2, a1 = (k + 1) / 20 * Math.PI * 2; const c = (a) => [29 + Math.cos(a) * 4, VC + Math.sin(a) * 4]; const p0 = c(a0), p1 = c(a1); beamFlat(WP(...p0), WP(...p1), gA(...p0) + 0.1, gA(...p1) + 0.1); }
  function beamFlat(q0, q1, y0, y1) { const dx = q1[0] - q0[0], dz = q1[2] - q0[2], l = Math.hypot(dx, dz) || 1, nx = -dz / l * 0.08, nz = dx / l * 0.08; B.quad([q0[0] - nx, y0, q0[2] - nz], [q1[0] - nx, y1, q1[2] - nz], [q1[0] + nx, y1, q1[2] + nz], [q0[0] + nx, y0, q0[2] + nz], UP, LC, F_PLAIN); }
  for (const [uL, uB] of [[9.5, 15], [48.5, 43]]) { lineU(Math.min(uL, uB), Math.max(uL, uB), VC - 5.5, 0.08, 0.1, LC); lineU(Math.min(uL, uB), Math.max(uL, uB), VC + 5.5, 0.08, 0.1, LC); lineV(VC - 5.5, VC + 5.5, uB, 0.08, 0.1, LC); }
  // goals (futebol society)
  for (const [u, dir] of [[9.5, -1], [48.5, 1]]) {
    const G = at(u, VC, 0, 0), W2 = hex('#f2f2f2');
    box(B, G, -0.08, 0.08, 0, 2.2, -2.6, -2.44, W2, W2); box(B, G, -0.08, 0.08, 0, 2.2, 2.44, 2.6, W2, W2); box(B, G, -0.08, 0.08, 2.1, 2.26, -2.6, 2.6, W2, W2);
    box(B, G, dir * 1.2 - 0.04, dir * 1.2 + 0.04, 0, 1.2, -2.6, 2.6, WIRE, WIRE);
    beam(B, P(G, 0, 2.2, -2.5), P(G, dir * 1.2, 1.2, -2.5), 0.05, W2); beam(B, P(G, 0, 2.2, 2.5), P(G, dir * 1.2, 1.2, 2.5), 0.05, W2);
  }
  // volleyball court: rope lines + net
  const RC = hex('#2a5fb0');
  lineV(9, 25, 14.75, 0.05, 0.1, RC); lineV(9, 25, 22.75, 0.05, 0.1, RC); lineU(14.75, 22.75, 9, 0.05, 0.1, RC); lineU(14.75, 22.75, 25, 0.05, 0.1, RC);
  {
    const Nt = at(18.75, 17, Math.PI / 2, 0), dark = hex('#1d2028');
    box(B, Nt, -0.07, 0.07, 0, 2.6, -4.95, -4.8, RED, RED); box(B, Nt, -0.07, 0.07, 0, 2.6, 4.8, 4.95, RED, RED);
    box(B, Nt, -0.02, 0.02, 2.36, 2.43, -4.8, 4.8, hex('#f4f4f4'), hex('#f4f4f4'));
    for (let y = 1.62; y < 2.36; y += 0.12) box(B, Nt, -0.01, 0.01, y, y + 0.02, -4.8, 4.8, dark, dark);
    for (let v = -4.8; v <= 4.8; v += 0.3) box(B, Nt, -0.01, 0.01, 1.62, 2.36, v, v + 0.02, dark, dark);
  }
  // ---- fences (posts + rails + wires): perimeter, divider, playground ----
  function fence(u0, v0, u1, v1, h, postCol, gaps) {
    const L = Math.hypot(u1 - u0, v1 - v0), du = (u1 - u0) / L, dv = (v1 - v0) / L;
    const n = Math.max(1, Math.ceil(L / 2.8));
    for (let k = 0; k < n; k++) {
      const t0 = L * k / n, t1 = L * (k + 1) / n, tm = (t0 + t1) / 2;
      if ((gaps || []).some(([g0, g1]) => tm > g0 && tm < g1)) continue;
      const a = [u0 + du * t0, v0 + dv * t0], b = [u0 + du * t1, v0 + dv * t1];
      const pa = WP(...a), pb = WP(...b), ya = gA(...a), yb = gA(...b);
      beam(B, [pa[0], ya - 0.3, pa[2]], [pa[0], ya + h, pa[2]], 0.09, postCol);
      if (k === n - 1 || (gaps || []).some(([g0]) => Math.abs(t1 - g0) < 0.01)) beam(B, [pb[0], yb - 0.3, pb[2]], [pb[0], yb + h, pb[2]], 0.09, postCol);
      for (const hh of [0.12, h * 0.5, h - 0.04]) beam(B, [pa[0], ya + hh, pa[2]], [pb[0], yb + hh, pb[2]], hh === h - 0.04 ? 0.06 : 0.025, hh === h - 0.04 ? postCol : WIRE);
      for (let y = 0.3; y < h - 0.1; y += 0.3) beam(B, [pa[0], ya + y, pa[2]], [pb[0], yb + y, pb[2]], 0.012, WIRE);
      const c = frame(0, 0, 0, 0); // collision
      mx.beginPath(); mx.lineWidth = 0.35; mx.strokeStyle = '#000'; mx.moveTo(pa[0], pa[2]); mx.lineTo(pb[0], pb[2]); mx.stroke();
    }
  }
  const FU0 = 6.9, FU1 = 51, FV0 = 6.9, FV1 = FE;
  fence(FU0, FV0, FU1, FV0, 2.4, POST, [[38.6, 42.6]]);          // Anália Franco side, with the main entrance
  fence(FU0, FV0, FU0, FV1, 2.4, POST, [[FV1 - FV0 - 3.6, FV1 - FV0 - 0.2]]);          // Rua Quatro-A side, opening at the pitch corner
  fence(FU0, FV1, FU1, FV1, 2.4, POST);                          // Agenor Lopes Siqueira side
  fence(FU1, FV0, FU1, FV1, 2.4, POST);                          // church side
  fence(FU0, 26.6, FU1, 26.6, 3.0, RED, [[32.6, 35.2]]);         // divider pitch | playground + volley, with an opening to the playground
  fence(30.7, FV0, 30.7, 26.6, 2.2, RED, [[8.2, 10.0]]);          // volley | playground, with a passage
  // ---- entrance arch "PARQUE COLINA" ----
  {
    const uc = 47.5, vS = FV0;
    for (const du of [-2.1, 2.1]) { // lattice towers
      const Tw = at(uc + du, vS, 0, 0);
      for (const [a, b] of [[-0.25, -0.25], [0.25, -0.25], [0.25, 0.25], [-0.25, 0.25]]) box(B, Tw, a - 0.04, a + 0.04, 0, 4.2, b - 0.04, b + 0.04, POST, POST);
      for (let y = 0.4; y < 4.2; y += 0.6) { box(B, Tw, -0.25, 0.25, y, y + 0.05, -0.27, -0.23, POST, POST); box(B, Tw, -0.25, 0.25, y, y + 0.05, 0.23, 0.27, POST, POST); box(B, Tw, -0.27, -0.23, y, y + 0.05, -0.25, 0.25, POST, POST); box(B, Tw, 0.23, 0.27, y, y + 0.05, -0.25, 0.25, POST, POST); }
      box(B, Tw, -0.1, 0.1, 4.2, 4.6, -0.1, 0.1, hex('#e9eef2'), hex('#e9eef2'), F_UNLIT);
    }
    const Ts = at(uc, vS, 0, 0), sy = 3.0, sh = 1.2;
    box(B, Ts, -1.95, 1.95, sy, sy + sh, -0.08, 0.08, hex('#f4f6f8'), hex('#f4f6f8'));
    box(B, Ts, -1.95, 1.95, sy, sy + 0.16, -0.09, 0.09, hex('#2f63a8'), hex('#2f63a8'));
    box(B, Ts, 1.3, 1.95, sy + 0.16, sy + sh, -0.09, 0.09, hex('#1f4d8f'), hex('#1f4d8f'));
    box(B, Ts, 1.45, 1.8, sy + 0.5, sy + 0.85, -0.1, 0.1, hex('#e9eef2'), hex('#e9eef2')); // little emblem
    // 5x7 pixel font for the sign
    const F57 = {
      P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'], A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
      R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'], Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
      U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
      C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'], O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
      L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'], I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
      N: ['10001', '11001', '10101', '10101', '10011', '10001', '10001'],
    };
    const text57 = (T, s, uc, yTop, vf, px, col) => {
      const w = s.length * 6 * px - px; let u = uc - w / 2;
      for (const ch of s) { F57[ch].forEach((row, ri) => { for (let k = 0; k < 5; k++) if (row[k] === '1') { const a = u + k * px, y = yTop - ri * px; B.quad(P(T, a, y - px, vf), P(T, a + px, y - px, vf), P(T, a + px, y, vf), P(T, a, y, vf), N(T, 0, 0, 1), col, F_PLAIN); } }); u += 6 * px; }
    };
    // both faces; the text block is centred on the white part (left of the blue logo panel)
    const faceOut = { o: Ts.o, ax: [-Ts.ax[0], 0, -Ts.ax[2]], ay: [0, 1, 0], az: [-Ts.az[0], 0, -Ts.az[2]] };
    for (const [F, c] of [[faceOut, 0.325], [Ts, -0.325]]) {
      text57(F, 'PARQUE', c, sy + sh - 0.07, 0.1, 0.042, hex('#2f63a8'));
      text57(F, 'COLINA', c, sy + 0.78, 0.1, 0.078, hex('#1f4d8f'));
    }
  }
  // ---- playground ----
  {
    // covered shelter with blue roof
    const K = at(46.5, 17.2, 0, 0);
    for (const [a, b] of [[-1.6, -1.5], [1.6, -1.5], [1.6, 1.5], [-1.6, 1.5]]) box(B, K, a - 0.06, a + 0.06, 0, 2.5, b - 0.06, b + 0.06, POST, POST);
    box(B, K, -1.9, 1.9, 2.5, 2.62, -1.8, 1.8, hex('#4c78b8'), hex('#3b64a0'));
    // mesa de cimento quadrada com tabuleiro de xadrez/dama + 4 bancos de cimento
    const CON = hex('#bdb8ad'), CON2 = hex('#a9a498');
    box(B, K, -0.18, 0.18, 0, 0.7, -0.18, 0.18, CON2, CON2);                       // pé central
    box(B, K, -0.55, 0.55, 0.7, 0.8, -0.55, 0.55, CON, CON2);                       // tampo
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const u0 = -0.4 + i * 0.1, v0 = -0.4 + j * 0.1, c = (i + j) % 2 ? hex('#1f1f22') : hex('#efece4');
      B.quad(P(K, u0, 0.805, v0), P(K, u0 + 0.1, 0.805, v0), P(K, u0 + 0.1, 0.805, v0 + 0.1), P(K, u0, 0.805, v0 + 0.1), UP, c, F_PLAIN);
    }
    box(B, K, -0.44, 0.44, 0.8, 0.803, -0.44, 0.44, hex('#6b6458'), hex('#6b6458'));    // borda do tabuleiro
    for (const [su, sv] of [[1.0, 0], [-1.0, 0], [0, 1.0], [0, -1.0]]) {         // bancos
      box(B, K, su - 0.12, su + 0.12, 0, 0.38, sv - 0.12, sv + 0.12, CON2, CON2);
      box(B, K, su - 0.22, su + 0.22, 0.38, 0.46, sv - 0.22, sv + 0.22, CON, CON2);
    }
    maskRect(K, -1.25, 1.25, -1.25, 1.25);
    { const p = P(K, 0, 0, 0); PROPS.push({ k: 'mesa', x: p[0], z: p[2], a: angOf(K) }); for (const [su, sv] of [[1.0, 0], [-1.0, 0], [0, 1.0], [0, -1.0]]) { const q = P(K, su, 0, sv); PROPS.push({ k: 'banco', x: q[0], z: q[2], a: angOf(K) }); } }
    // swings (balanço)
    const S = at(35.5, 13.5, 0, 0), sc = hex('#d9493a');
    for (const vv of [-2.2, 2.2]) { beam(B, P(S, -1.1, 0, vv), P(S, 0, 2.6, vv), 0.1, POST); beam(B, P(S, 1.1, 0, vv), P(S, 0, 2.6, vv), 0.1, POST); }
    beam(B, P(S, 0, 2.6, -2.3), P(S, 0, 2.6, 2.3), 0.12, POST);
    for (const vv of [-1.0, 1.0]) { for (const dv of [-0.25, 0.25]) beam(B, P(S, 0, 2.55, vv + dv), P(S, 0.05, 0.55, vv + dv), 0.025, WIRE); box(B, yawChild(S, 0.05, 0, vv, 0), -0.22, 0.22, 0.48, 0.56, -0.3, 0.3, sc, sc); }
    maskRect(S, -1.2, 1.2, -2.4, 2.4);
    // slide (escorregador): red ladder, platform, blue chute
    const Sl = at(33.4, 22.2, -Math.PI / 2, 0), blue = hex('#2f7fd6');
    for (const [a, b] of [[-0.5, -0.45], [0.5, -0.45], [0.5, 0.45], [-0.5, 0.45]]) box(B, Sl, a - 0.05, a + 0.05, 0, 2.6, b - 0.05, b + 0.05, RED, RED);
    box(B, Sl, -0.55, 0.55, 1.6, 1.7, -0.5, 0.5, hex('#e2b13c'), hex('#e2b13c'));
    for (let y = 0.3; y < 1.6; y += 0.32) box(B, Sl, -0.85, -0.55, y, y + 0.05, -0.4, 0.4, RED, RED);
    beam(B, P(Sl, -0.9, 0, -0.42), P(Sl, -0.55, 1.6, -0.42), 0.07, RED); beam(B, P(Sl, -0.9, 0, 0.42), P(Sl, -0.55, 1.6, 0.42), 0.07, RED);
    const s0 = P(Sl, 0.55, 1.6, 0), s1 = P(Sl, 3.1, 0.25, 0);
    for (const dv of [-0.36, -0.12, 0.12, 0.36]) beam(B, P(Sl, 0.55, 1.6, dv), P(Sl, 3.1, 0.25, dv), 0.2, blue);
    beam(B, P(Sl, 0.55, 1.85, -0.45), P(Sl, 3.1, 0.5, -0.45), 0.06, blue); beam(B, P(Sl, 0.55, 1.85, 0.45), P(Sl, 3.1, 0.5, 0.45), 0.06, blue);
    box(B, Sl, -0.55, 0.55, 2.55, 2.65, -0.5, 0.5, blue, blue);
    maskRect(Sl, -0.9, 3.1, -0.5, 0.5);
    // exercise bars (barras): three heights
    const Bx = at(28.6, 19.0, Math.PI / 2, 0), steel = hex('#9aa0a6');
    [[0, 1.4], [1.3, 1.9], [2.6, 2.4]].forEach(([du, h]) => { box(B, Bx, du - 0.06, du + 0.06, 0, h, -0.9, -0.78, POST, POST); box(B, Bx, du - 0.06, du + 0.06, 0, h, 0.78, 0.9, POST, POST); beam(B, P(Bx, du, h - 0.05, -0.85), P(Bx, du, h - 0.05, 0.85), 0.05, steel); });
    // parallel bars
    const Pb = at(28.6, 23.6, Math.PI / 2, 0);
    for (const vv of [-0.3, 0.3]) { for (const uu of [-0.9, 0.9]) box(B, Pb, uu - 0.05, uu + 0.05, 0, 1.15, vv - 0.05, vv + 0.05, POST, POST); beam(B, P(Pb, -1.1, 1.15, vv), P(Pb, 1.1, 1.15, vv), 0.06, steel); }
    // seesaw
    const Gg = at(36, 18.3, 0, 0);
    box(B, Gg, -0.15, 0.15, 0, 0.5, -0.15, 0.15, POST, POST); beam(B, P(Gg, -1.6, 0.25, 0), P(Gg, 1.6, 0.75, 0), 0.2, hex('#e2b13c'));
    // red benches
    for (const [u, v, a] of [[33, 8.2, 0], [49.3, 15, Math.PI / 2], [10.2, 17, Math.PI / 2], [27.3, 17, Math.PI / 2], [38, 25.2, 0]]) {
      const Bn = at(u, v, a, 0); box(B, Bn, -0.9, 0.9, 0.42, 0.5, -0.22, 0.22, RED, RED); box(B, Bn, -0.8, -0.7, 0, 0.42, -0.15, 0.15, hex('#6b6b6b'), hex('#6b6b6b')); box(B, Bn, 0.7, 0.8, 0, 0.42, -0.15, 0.15, hex('#6b6b6b'), hex('#6b6b6b'));
    }
  }
  // floodlight poles + electrical cabinet
  for (const [u, v] of [[8, 27.4], [50, 27.4], [8, FE - 0.8], [50, FE - 0.8], [29, 27.4], [29, FE - 0.8], [19, 7.6]]) {
    const Lp = at(u, v, 0, 0);
    box(B, Lp, -0.11, 0.11, -0.3, 8.5, -0.11, 0.11, POST, POST);
    box(B, Lp, -0.6, 0.6, 8.3, 8.42, -0.06, 0.06, steel_(), steel_());
    for (const du of [-0.45, 0.45]) box(B, Lp, du - 0.22, du + 0.22, 8.42, 8.75, -0.2, 0.2, hex('#5d636b'), hex('#fff7d6'), F_UNLIT);
    maskCircle(...(() => { const p = WP(u, v); return [p[0], p[2], 0.2]; })());
  }
  function steel_() { return hex('#9aa0a6'); }
  { const Cb = at(45, 26.6 - 0.45, 0, 0); box(B, Cb, -0.45, 0.45, 0, 1.5, -0.3, 0.3, hex('#c5ccd3'), hex('#aeb6bf')); box(B, Cb, -0.3, 0.3, 0.9, 1.2, 0.3, 0.31, hex('#56606b'), hex('#56606b')); }
  // big trees (sombra no parquinho e na areia)
  for (const [u, v, k, s] of [[32.5, 24.6, 2, 1.55], [8.4, 8.3, 2, 1.6], [29.5, 8.0, 0, 1.45], [9.0, 25.0, 0, 1.3], [24.5, 7.8, 1, 1.2]]) {
    const p = WP(u, v); tree(chunkB(p[0], p[2]), p[0], p[2], k, s, true);
  }
  // Caudinho in the shade of the big tree by the divider fence (tree at u 32.5, v 24.6), on the pitch side
  {
    const tu = 32.5, tv = 24.6;
    const sl = Math.hypot(SUN[0], SUN[2]), sx = -SUN[0] / sl, sz = -SUN[2] / sl;
    const du = sx * T0.ax[0] + sz * T0.ax[2], dv = sx * T0.az[0] + sz * T0.az[2];
    // walk along the shadow until we're on the pitch, clear of the fence and the floodlight pole
    let cu = tu, cv = tv;
    for (let k = 0; k < 40; k++) { cu += du * 0.25; cv += dv * 0.25; if (cv > 28.6) break; }
    cu += 2.0; cv += 0.6; // centre of the canopy's shadow
    if (Math.hypot(cu - 29, cv - 27.4) < 1.2) cu += 1.2;
    const cp = WP(cu, cv), yC = groundAt(cp[0], cp[2]) + 0.02;
    const cen = WP(29, VC);
    NPCS.push({ name: 'Caudinho', style: 'caudinho', x: cp[0], z: cp[2], y: yC, base: Math.atan2(cen[2] - cp[2], cen[0] - cp[0]), look: 0, t: 0, says: ['Sabe onde está o Kiko? Quero quebrar ele na porrada!'] });
    maskCircle(cp[0], cp[2], 0.35);
    POIS.push({ n: 'Caudinho', x: cp[0], z: cp[2], y: 2.4, npc: true });
    window.__caud = [cu, cv];
  }
  // ---- quadro de luz (medidor) ao lado do poste do meio, lado da Rua Agenor Lopes Siqueira ----
  {
    const Q = at(30.35, FE - 0.5, 0, 0), wall = hex('#d6e2ea'), wall2 = hex('#c4d2dc'), blue = hex('#2f5fb0'), slab = hex('#a39f95');
    box(B, Q, -0.65, 0.65, -0.2, 1.55, -0.3, 0.3, wall, wall2);
    box(B, Q, -0.75, 0.75, 1.55, 1.66, -0.4, 0.42, slab, hex('#8f8b82'));
    const fv = 0.305, fq = (u0, u1, y0, y1, col, e) => B.quad(P(Q, u0, y0, fv + (e || 0)), P(Q, u1, y0, fv + (e || 0)), P(Q, u1, y1, fv + (e || 0)), P(Q, u0, y1, fv + (e || 0)), N(Q, 0, 0, 1), col, F_PLAIN);
    // left: blue meter door with a round window
    fq(-0.52, -0.12, 0.92, 1.42, blue); fq(-0.47, -0.17, 0.97, 1.37, hex('#3a6fc4'), 0.005);
    for (let k = 0; k < 10; k++) { const a0 = k / 10 * Math.PI * 2, a1 = (k + 1) / 10 * Math.PI * 2, cx = -0.32, cy = 1.25, r = 0.06; B.tri(P(Q, cx, cy, fv + 0.01), P(Q, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, fv + 0.01), P(Q, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, fv + 0.01), N(Q, 0, 0, 1), hex('#e8e4d6'), F_PLAIN); }
    // right: blue frame with rusty panel and grid
    fq(0.0, 0.52, 0.95, 1.42, blue); fq(0.05, 0.47, 1.0, 1.37, hex('#8a5a3a'), 0.005);
    for (const u of [0.15, 0.26, 0.37]) fq(u - 0.012, u + 0.012, 1.0, 1.37, blue, 0.01);
    for (const y of [1.12, 1.25]) fq(0.05, 0.47, y - 0.012, y + 0.012, blue, 0.01);
    // weathered stains
    fq(-0.55, 0.2, 0.42, 0.62, hex('#a9b8b0'), 0.004); fq(-0.2, 0.45, 0.25, 0.38, hex('#b7c3bc'), 0.004);
    // conduit from the floodlight pole into the box
    const pole = WP(29, FE - 0.8), py = gA(29, FE - 0.8);
    beam(B, [pole[0], py + 2.6, pole[2]], [pole[0], py + 1.45, pole[2]], 0.06, hex('#2a2a2a'));
    beam(B, [pole[0], py + 1.45, pole[2]], P(Q, -0.66, 1.3, 0), 0.06, hex('#2a2a2a'));
    maskRect(Q, -0.75, 0.75, -0.4, 0.42); { const p = P(Q, 0, 0, 0); PROPS.push({ k: 'quadro', x: p[0], z: p[2], a: angOf(Q) }); }
  }
  // ---- banheiro do parquinho (canto igreja / cerca do campo) ----
  {
    const U0 = 48.0, U1 = 50.7, V0 = 20.4, V1 = 25.6, VM = 23.0, US = 46.3; // body, divider, screen-wall line
    const hs = [[US - 0.3, V0], [U1, V0], [U1, V1], [US - 0.3, V1]].map(([u, v]) => gA(u, v));
    const base = Math.max(...hs) + 0.12, low = Math.min(...hs) - 0.4;
    const Tb = { o: [WP(0, 0)[0], base, WP(0, 0)[2]], ax: T0.ax, ay: T0.ay, az: T0.az };
    const BLUE = hex('#3f72b8'), BLUE2 = hex('#355f9c'), WHT = hex('#e9ebe6'), WHT2 = hex('#d9dcd6'), FIB = hex('#c9c8c0'), FIB2 = hex('#b5b4ac'), FLOOR = hex('#b9b5ab');
    // floor slab (vestibules included)
    box(B, Tb, US - 0.35, U1 + 0.1, low - base, 0, V0 - 0.1, V1 + 0.1, FLOOR, hex('#a29d92'));
    // main body: blue lower half, white upper half
    box(B, Tb, U0, U1, 0, 1.3, V0, V1, BLUE, BLUE);
    box(B, Tb, U0, U1, 1.3, 2.75, V0, V1, WHT, WHT);
    box(B, Tb, U0 - 0.02, U1 + 0.02, 1.27, 1.33, V0 - 0.02, V1 + 0.02, BLUE2, BLUE2);
    // corrugated fibre-cement roof sloping to the back, with overhang
    const ry0 = 3.15, ry1 = 2.7, ou0 = US - 0.5, ou1 = U1 + 0.45;
    for (let k = 0, n = 18; k < n; k++) {
      const v0 = V0 - 0.4 + (V1 - V0 + 0.8) * k / n, v1 = V0 - 0.4 + (V1 - V0 + 0.8) * (k + 1) / n, lift = k % 2 ? 0.05 : 0;
      const a = P(Tb, ou0, ry0 + lift, v0), b = P(Tb, ou1, ry1 + lift, v0), c = P(Tb, ou1, ry1 + lift, v1), d = P(Tb, ou0, ry0 + lift, v1);
      B.quad(a, b, c, d, faceN(a, b, c, true), k % 2 ? FIB : FIB2, F_TEX);
    }
    // gable fill between walls and roof
    for (const [vv, sg] of [[V0, -1], [V1, 1]]) {
      const a = P(Tb, U0, 2.75, vv), b = P(Tb, U1, 2.75, vv), c = P(Tb, U1, ry1, vv), d = P(Tb, U0, ry0 - (ry0 - ry1) * (U0 - ou0) / (ou1 - ou0), vv);
      B.quad(a, b, c, d, N(T0, 0, 0, sg), WHT, F_PLAIN);
    }
    { const yF = ry0 - (ry0 - ry1) * (U0 - ou0) / (ou1 - ou0); B.quad(P(Tb, U0 - 0.01, 2.75, V0), P(Tb, U0 - 0.01, 2.75, V1), P(Tb, U0 - 0.01, yF, V1), P(Tb, U0 - 0.01, yF, V0), N(T0, -1, 0, 0), WHT, F_PLAIN); }
    // roof posts at the front of the vestibules
    for (const vv of [V0 - 0.25, V1 + 0.25]) box(B, Tb, US - 0.3, US - 0.15, 0, ry0, vv - 0.08, vv + 0.08, POST, POST);
    // small high windows (back and sides)
    for (const vv of [V0 + 1.1, VM, V1 - 1.1]) B.quad(P(Tb, U1 + 0.02, 1.9, vv - 0.35), P(Tb, U1 + 0.02, 1.9, vv + 0.35), P(Tb, U1 + 0.02, 2.4, vv + 0.35), P(Tb, U1 + 0.02, 2.4, vv - 0.35), N(T0, 1, 0, 0), hex('#3a4656'), F_PLAIN);
    for (const [vv, sg] of [[V0 - 0.02, -1], [V1 + 0.02, 1]]) B.quad(P(Tb, U0 + 0.8, 1.9, vv), P(Tb, U0 + 1.9, 1.9, vv), P(Tb, U0 + 1.9, 2.4, vv), P(Tb, U0 + 0.8, 2.4, vv), N(T0, 0, 0, sg), hex('#3a4656'), F_PLAIN);
    // façade: doors (left = feminino, right = masculino for someone facing the building)
    const fq = (v0, v1, y0, y1, col, e) => B.quad(P(Tb, U0 - (e || 0.03), y0, v0), P(Tb, U0 - (e || 0.03), y0, v1), P(Tb, U0 - (e || 0.03), y1, v1), P(Tb, U0 - (e || 0.03), y1, v0), N(T0, -1, 0, 0), col, F_PLAIN);
    const DF = [21.25, 22.25], DM = [23.75, 24.75];
    for (const [d0, d1] of [DF, DM]) { fq(d0 - 0.08, d1 + 0.08, 0, 2.18, WHT2); fq(d0, d1, 0.02, 2.1, hex('#5a6f8f'), 0.04); fq(d1 - 0.22, d1 - 0.12, 1.0, 1.08, hex('#d8d8d8'), 0.05); }
    // door signs
    const Fr = (v) => ({ o: P(Tb, U0 - 0.06, 0, v), ax: T0.az, ay: [0, 1, 0], az: [-T0.ax[0], 0, -T0.ax[2]] });
    const plaque = (vc, col) => fq(vc - 0.3, vc + 0.3, 2.22, 2.62, col, 0.05);
    plaque((DF[0] + DF[1]) / 2, hex('#e06aa8')); plaque((DM[0] + DM[1]) / 2, hex('#3a86e0'));
    pixelText(B, Fr((DF[0] + DF[1]) / 2), 'F', -0.08, 2.54, 0.0, 0.055, hex('#ffffff'));
    pixelText(B, Fr((DM[0] + DM[1]) / 2), 'M', -0.08, 2.54, 0.0, 0.055, hex('#ffffff'));
    // privacy walls in front of the doors: centre divider + screen wall, entrances from the outer sides
    const wallSeg = (u0, u1, v0, v1) => { box(B, Tb, u0, u1, 0, 0.9, v0, v1, BLUE, BLUE); box(B, Tb, u0, u1, 0.9, 2.2, v0, v1, WHT, WHT); box(B, Tb, u0 - 0.02, u1 + 0.02, 2.2, 2.28, v0 - 0.02, v1 + 0.02, WHT2, WHT2); maskRect(Tb, u0 - 0.05, u1 + 0.05, v0 - 0.05, v1 + 0.05); };
    wallSeg(US, U0, VM - 0.08, VM + 0.08);              // divider between the two vestibules
    wallSeg(US - 0.16, US, 21.5, 24.5);                 // screen wall (openings at both ends)
    maskRect(Tb, U0, U1 + 0.05, V0, V1);
    // poop pile with flies in the men's vestibule
    { const pu = 47.25, pv = 24.15, Tp = { o: P(Tb, pu, 0, pv), ax: T0.ax, ay: [0, 1, 0], az: T0.az }, br = hex('#5b3a1a'), br2 = hex('#6e4722');
      box(B, Tp, -0.32, 0.32, 0, 0.13, -0.3, 0.3, br, br); box(B, Tp, -0.24, 0.22, 0.13, 0.25, -0.22, 0.2, br2, br2); box(B, Tp, -0.15, 0.13, 0.25, 0.35, -0.13, 0.12, br, br); box(B, Tp, -0.06, 0.04, 0.35, 0.43, -0.05, 0.06, br2, br2);
      box(B, Tp, 0.28, 0.42, 0, 0.08, 0.2, 0.34, br, br);
      const pp = P(Tb, pu, 0, pv); FLY_SPOTS.push({ x: pp[0], y: base + 0.35, z: pp[2] });
      maskCircle(pp[0], pp[2], 0.3); PROPS.push({ k: 'coco', x: pp[0], z: pp[2], a: angOf(Tp) });
      NPCS.push({ name: '', style: 'note', x: pp[0], z: pp[2], y: base, base: 0, look: 0, t: 0, r: 2.6, says: ['Você não acreditaria que essa obra saiu de uma criança que pesava 20 quilos.'] }); }
    lab('Banheiro', (U0 + U1) / 2, (V0 + V1) / 2, 4);
  }
  // ---- church (igreja) ----
  {
    const u0 = 55.5, u1 = 77.5, v0 = 12, v1 = 41;
    const corner = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => gA(u, v));
    const base = Math.max(...corner) + 0.15, low = Math.min(...corner) - 0.5;
    const Tc = { o: [WP(0, 0)[0], base, WP(0, 0)[2]], ax: T0.ax, ay: T0.ay, az: T0.az };
    const WALLC = hex('#d8c59c'), TRIM = hex('#efe6d2'), ROOFC = hex('#cfd3d6'), RW = hex('#7a3fa8');
    box(B, Tc, u0 - 0.3, u1 + 0.3, low - base, 0.3, v0 - 0.3, v1 + 0.3, hex('#a59f92'), hex('#a59f92'));
    box(B, Tc, u0, u1, 0.3, 7.5, v0, v1, WALLC, WALLC);
    box(B, Tc, u0 - 0.1, u1 + 0.1, 7.3, 7.6, v0 - 0.1, v1 + 0.1, TRIM, TRIM);
    // fan-shaped roof: wide at the back, narrowing to the front (towards the pitch)
    const R = (u, y, v) => P(Tc, u, y, v);
    const rf0 = R(u0 - 0.6, 7.6, v0 + 4), rf1 = R(u0 - 0.6, 7.6, v1 - 4), rb0 = R(u1 + 0.6, 7.6, v0 - 0.6), rb1 = R(u1 + 0.6, 7.6, v1 + 0.6), ridgeF = R(u0 + 1, 10.4, (v0 + v1) / 2), ridgeB = R(u1 - 2, 11.2, (v0 + v1) / 2);
    B.tri(rf0, rb0, ridgeB, faceN(rf0, rb0, ridgeB, true), ROOFC, F_TEX); B.tri(rf0, ridgeB, ridgeF, faceN(rf0, ridgeB, ridgeF, true), ROOFC, F_TEX);
    B.tri(rf1, ridgeF, ridgeB, faceN(rf1, ridgeF, ridgeB, true), jit(ROOFC, () => 0.3, 0.05), F_TEX); B.tri(rf1, ridgeB, rb1, faceN(rf1, ridgeB, rb1, true), jit(ROOFC, () => 0.3, 0.05), F_TEX);
    B.tri(rf0, ridgeF, rf1, faceN(rf0, ridgeF, rf1, true), hex('#bfc4c8'), F_TEX); B.tri(rb0, rb1, ridgeB, faceN(rb0, rb1, ridgeB, true), hex('#bfc4c8'), F_TEX);
    B.quad(rf0, rb0, R(u1 + 0.6, 7.6, v0 + 4), R(u0 - 0.6, 7.6, v0 + 4), UP, ROOFC, F_TEX);
    // facade towards the pitch: round purple rose window, doors, cross
    const fu = u0 - 0.04;
    const Tf = { o: P(Tc, fu, 0, (v0 + v1) / 2), ax: [-T0.ax[0], 0, -T0.ax[2]], ay: [0, 1, 0], az: [T0.az[0], 0, T0.az[2]] };
    const Fq = (a0, a1, y0, y1, col) => B.quad(P(Tc, fu, y0, a0), P(Tc, fu, y0, a1), P(Tc, fu, y1, a1), P(Tc, fu, y1, a0), N(T0, -1, 0, 0), col, F_PLAIN);
    const vc = (v0 + v1) / 2;
    for (let k = 0; k < 16; k++) { const a0 = k / 16 * Math.PI * 2, a1 = (k + 1) / 16 * Math.PI * 2, r = 1.7, cy = 5.2; B.tri(P(Tc, fu - 0.02, cy, vc), P(Tc, fu - 0.02, cy + Math.sin(a0) * r, vc + Math.cos(a0) * r), P(Tc, fu - 0.02, cy + Math.sin(a1) * r, vc + Math.cos(a1) * r), N(T0, -1, 0, 0), k % 2 ? RW : hex('#9a5cc8'), F_PLAIN); }
    for (let k = 0; k < 16; k++) { const a0 = k / 16 * Math.PI * 2, a1 = (k + 1) / 16 * Math.PI * 2, r = 1.9, r2 = 1.7, cy = 5.2; B.quad(P(Tc, fu - 0.01, cy + Math.sin(a0) * r2, vc + Math.cos(a0) * r2), P(Tc, fu - 0.01, cy + Math.sin(a0) * r, vc + Math.cos(a0) * r), P(Tc, fu - 0.01, cy + Math.sin(a1) * r, vc + Math.cos(a1) * r), P(Tc, fu - 0.01, cy + Math.sin(a1) * r2, vc + Math.cos(a1) * r2), N(T0, -1, 0, 0), TRIM, F_PLAIN); }
    Fq(vc - 1.4, vc + 1.4, 0.3, 3.2, hex('#6b4128')); Fq(vc - 0.04, vc + 0.04, 0.3, 3.2, hex('#3e2516'));
    Fq(vc - 1.7, vc + 1.7, 3.2, 3.45, TRIM);
    for (const vv of [v0 + 2.5, v1 - 2.5]) Fq(vv - 0.5, vv + 0.5, 1.4, 4.2, hex('#7f5aa6'));
    box(B, Tc, u0 + 0.6, u0 + 0.8, 10.3, 12.4, vc - 0.1, vc + 0.1, TRIM, TRIM); box(B, Tc, u0 + 0.6, u0 + 0.8, 11.4, 11.6, vc - 0.7, vc + 0.7, TRIM, TRIM); // cross
    // side windows (stained glass) on both long walls
    for (let u = u0 + 3; u < u1 - 1; u += 3.2) for (const [vv, sg] of [[v0, -1], [v1, 1]]) B.quad(P(Tc, u - 0.45, 2.2, vv + sg * 0.04), P(Tc, u + 0.45, 2.2, vv + sg * 0.04), P(Tc, u + 0.45, 5.6, vv + sg * 0.04), P(Tc, u - 0.45, 5.6, vv + sg * 0.04), N(T0, 0, 0, sg), u % 2 < 1 ? hex('#5a7fb0') : hex('#8a68b0'), F_PLAIN);
    // cylindrical tower (as in the street photo)
    { const tu = u0 + 2.2, tv = v1 + 1.2, r = 2.0, n = 14, h = 9.5; for (let k = 0; k < n; k++) { const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2; const p0 = P(Tc, tu + Math.cos(a0) * r, 0.3, tv + Math.sin(a0) * r), p1 = P(Tc, tu + Math.cos(a1) * r, 0.3, tv + Math.sin(a1) * r); const q0 = [p0[0], base + h, p0[2]], q1 = [p1[0], base + h, p1[2]]; B.quad([p0[0], low, p0[2]], [p1[0], low, p1[2]], q1, q0, N(T0, Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)), WALLC, F_PLAIN); const c = P(Tc, tu, h + 1.3, tv); B.tri(q0, q1, c, faceN(q0, q1, c, true), ROOFC, F_TEX); }
      maskCircle(...(() => { const p = P(Tc, tu, 0, tv); return [p[0], p[2], r]; })()); }
    // low annex with AC units (back, towards the houses)
    box(B, Tc, u0 + 5, u1, low - base, 4.2, v1, v1 + 5, WALLC, WALLC); box(B, Tc, u0 + 5, u1, 4.2, 4.45, v1, v1 + 5, TRIM, TRIM);
    for (let u = u0 + 6.5; u < u1 - 1; u += 3) { B.quad(P(Tc, u - 0.8, 1.4, v1 + 5.04), P(Tc, u + 0.8, 1.4, v1 + 5.04), P(Tc, u + 0.8, 2.5, v1 + 5.04), P(Tc, u - 0.8, 2.5, v1 + 5.04), N(T0, 0, 0, 1), hex('#3f7a5c'), F_PLAIN); }
    for (const u of [u0 + 8, u0 + 14]) box(B, Tc, u - 0.45, u + 0.45, 2.8, 3.4, v1 + 5, v1 + 5.35, hex('#e8e8e8'), hex('#d0d0d0'));
    maskRect(Tc, u0 - 0.3, u1 + 0.3, v0 - 0.3, v1 + 5.2);
  }
  lab('Parque Colina', 47.5, 6.9, 6); lab('Igreja', 66, 24.5, 14); lab('Campo', 29, (28.5 + lm.W - 8.6) / 2, 3); lab('Vôlei de areia', 18.75, 17, 3.5);
}

// ---------------- cars ----------------
function carMesh(B, T, col) {
  const dark = hex('#1b1d22'), glass = hex('#3a4f68'), tire = hex('#16171a');
  const L = 2.1, Wd = 0.9;
  box(B, T, -L, L, 0.35, 1.05, -Wd, Wd, col, col);
  box(B, T, -1.2, 0.9, 1.05, 1.65, -Wd + 0.08, Wd - 0.08, col, glass);
  box(B, T, -1.15, 0.85, 1.6, 1.68, -Wd + 0.1, Wd - 0.1, col, col);
  for (const [u, v] of [[-1.35, -Wd], [1.35, -Wd], [-1.35, Wd], [1.35, Wd]]) box(B, T, u - 0.38, u + 0.38, 0.0, 0.7, v - 0.14, v + 0.14, tire, tire);
  box(B, T, L - 0.02, L + 0.04, 0.7, 0.9, -Wd + 0.1, -Wd + 0.45, hex('#fff6d0'), hex('#fff6d0'), F_UNLIT);
  box(B, T, L - 0.02, L + 0.04, 0.7, 0.9, Wd - 0.45, Wd - 0.1, hex('#fff6d0'), hex('#fff6d0'), F_UNLIT);
  box(B, T, -L - 0.04, -L + 0.02, 0.75, 0.9, -Wd + 0.1, -Wd + 0.4, hex('#d02020'), hex('#d02020'), F_UNLIT);
  box(B, T, -L - 0.04, -L + 0.02, 0.75, 0.9, Wd - 0.4, Wd - 0.1, hex('#d02020'), hex('#d02020'), F_UNLIT);
  box(B, T, -L - 0.05, L + 0.05, 0.35, 0.5, -Wd - 0.03, Wd + 0.03, dark, dark);
}

// ---------------- objetos "viráveis" (esconde-esconde): mesmo modelo do cenário ----------------
const PROPDEF = {
  lixeira:   { nome: 'lixeira', r: 0.35, h: 1.5 },
  poste:     { nome: 'poste', r: 0.45, h: 9.0 },
  luminaria: { nome: 'poste de luz', r: 0.35, h: 7.0 },
  carro:     { nome: 'carro', r: 1.5, h: 1.7 },
  casinha:   { nome: 'casinha de cachorro', r: 0.7, h: 0.95 },
  bike:      { nome: 'bicicleta', r: 0.7, h: 1.15 },
  mesa:      { nome: 'mesa de xadrez', r: 0.6, h: 0.85 },
  banco:     { nome: 'banquinho', r: 0.3, h: 0.5 },
  quadro:    { nome: 'quadro de luz', r: 0.7, h: 1.7 },
  coco:      { nome: 'pilha de cocô', r: 0.4, h: 0.45 },
  arbusto:   { nome: 'arbusto', r: 0.75, h: 0.9 },
};
function buildProp(B, k, x, z, a, o) {
  o = o || {};
  const y = o.y !== undefined ? o.y : surfAt(x, z), T = frame(x, y, z, a);
  if (k === 'carro') { carMesh(B, groundFrame(x, z, a, 0.0), o.col || hex('#d63b2f')); return; }
  if (k === 'lixeira') {
    box(B, T, -0.03, 0.03, 0, 1.1, -0.03, 0.03, hex('#55595f'), hex('#55595f'));
    box(B, T, -0.28, 0.28, 1.1, 1.45, -0.2, 0.2, hex('#7a7f86'), hex('#8f949a'));
    box(B, T, -0.24, 0.24, 1.44, 1.46, -0.16, 0.16, hex('#2b2d30'), hex('#2b2d30')); return;
  }
  if (k === 'poste') {
    box(B, T, -0.14, 0.14, -0.3, 9, -0.14, 0.14, hex('#b9b6ad'), hex('#a7a49b'));
    box(B, T, -0.07, 0.07, 8.4, 8.55, -0.9, 0.9, hex('#8a8780'), hex('#8a8780'));
    box(B, T, -0.2, 0.2, 6.4, 6.9, -0.2, 0.2, hex('#7e848c'), hex('#6c7279'));
    const arm = [[0.12, 6.0], [0.6, 6.25], [1.1, 6.6], [1.5, 7.05], [1.85, 7.45], [2.2, 7.65], [2.55, 7.7]];
    for (let q = 0; q < arm.length - 1; q++) beam(B, P(T, arm[q][0], arm[q][1], 0), P(T, arm[q + 1][0], arm[q + 1][1], 0), 0.08, hex('#9a9890'));
    box(B, T, 2.35, 3.05, 7.58, 7.74, -0.22, 0.22, hex('#c9cbc6'), hex('#aeb1ad')); box(B, T, 2.42, 2.98, 7.52, 7.58, -0.18, 0.18, hex('#e9e4d0'), hex('#e9e4d0')); return;
  }
  if (k === 'luminaria') {
    const g = hex('#7d838c');
    box(B, T, -0.12, 0.12, -0.3, 7, -0.12, 0.12, g, g);
    box(B, T, 0, 1.8, 6.8, 7.0, -0.08, 0.08, g, g);
    box(B, T, 1.4, 2.1, 6.6, 6.9, -0.25, 0.25, hex('#5c6168'), hex('#fff3c4')); return;
  }
  if (k === 'casinha') {
    const wood = hex('#b07a43'), wood2 = hex('#9a6a39');
    box(B, T, -0.65, 0.65, 0, 0.12, -0.5, 0.5, hex('#8a6a45'), hex('#7a5b3a'));
    box(B, T, -0.55, 0.55, 0.12, 0.85, -0.42, 0.42, wood, wood);
    for (let yy = 0.25; yy < 0.85; yy += 0.16) box(B, T, -0.56, 0.56, yy, yy + 0.03, -0.43, 0.43, wood2, wood2);
    box(B, T, 0.555, 0.565, 0.14, 0.6, -0.18, 0.18, hex('#2a2016'), hex('#2a2016'));
    box(B, T, -0.68, 0.68, 0.85, 0.9, -0.55, 0.55, hex('#a9bccb'), hex('#94a8b8'));
    for (let v = -0.5; v < 0.55; v += 0.12) box(B, T, -0.68, 0.68, 0.9, 0.92, v, v + 0.05, hex('#c4d3de'), hex('#c4d3de')); return;
  }
  if (k === 'bike') {
    const K = T, tire = hex('#17181b'), fr = hex('#2f6a42'), steel = hex('#9aa0a6');
    const wheel = (cu) => { const n = 10, r = 0.33; for (let q = 0; q < n; q++) { const a0 = q / n * Math.PI * 2, a1 = (q + 1) / n * Math.PI * 2; beam(B, P(K, cu + Math.cos(a0) * r, r + Math.sin(a0) * r, 0), P(K, cu + Math.cos(a1) * r, r + Math.sin(a1) * r, 0), 0.06, tire); } };
    wheel(-0.52); wheel(0.52);
    const rear = P(K, -0.52, 0.33, 0), crank = P(K, -0.05, 0.33, 0), seatP = P(K, -0.18, 0.92, 0), head = P(K, 0.42, 0.95, 0), front = P(K, 0.52, 0.33, 0);
    beam(B, rear, crank, 0.04, fr); beam(B, rear, seatP, 0.04, fr); beam(B, crank, seatP, 0.045, fr); beam(B, crank, head, 0.05, fr); beam(B, seatP, head, 0.045, fr); beam(B, head, front, 0.04, fr);
    box(B, K, -0.32, -0.08, 1.0, 1.06, -0.07, 0.07, tire, tire);
    beam(B, P(K, 0.42, 0.95, 0), P(K, 0.38, 1.12, 0), 0.03, steel);
    beam(B, P(K, 0.38, 1.12, -0.28), P(K, 0.38, 1.12, 0.28), 0.03, steel); return;
  }
  if (k === 'mesa') {
    const CON = hex('#bdb8ad'), CON2 = hex('#a9a498');
    box(B, T, -0.18, 0.18, 0, 0.7, -0.18, 0.18, CON2, CON2);
    box(B, T, -0.55, 0.55, 0.7, 0.8, -0.55, 0.55, CON, CON2);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const u0 = -0.4 + i * 0.1, v0 = -0.4 + j * 0.1, c = (i + j) % 2 ? hex('#1f1f22') : hex('#efece4'); B.quad(P(T, u0, 0.805, v0), P(T, u0 + 0.1, 0.805, v0), P(T, u0 + 0.1, 0.805, v0 + 0.1), P(T, u0, 0.805, v0 + 0.1), UP, c, F_PLAIN); }
    return;
  }
  if (k === 'banco') {
    const CON = hex('#bdb8ad'), CON2 = hex('#a9a498');
    box(B, T, -0.12, 0.12, 0, 0.38, -0.12, 0.12, CON2, CON2); box(B, T, -0.22, 0.22, 0.38, 0.46, -0.22, 0.22, CON, CON2); return;
  }
  if (k === 'quadro') {
    box(B, T, -0.65, 0.65, -0.2, 1.55, -0.3, 0.3, hex('#d6e2ea'), hex('#c4d2dc'));
    box(B, T, -0.75, 0.75, 1.55, 1.66, -0.4, 0.42, hex('#a39f95'), hex('#8f8b82'));
    box(B, T, -0.52, -0.12, 0.92, 1.42, 0.3, 0.32, hex('#2f5fb0'), hex('#2f5fb0'));
    box(B, T, 0.0, 0.52, 0.95, 1.42, 0.3, 0.32, hex('#2f5fb0'), hex('#8a5a3a')); return;
  }
  if (k === 'coco') {
    const br = hex('#5b3a1a'), br2 = hex('#6e4722');
    box(B, T, -0.32, 0.32, 0, 0.13, -0.3, 0.3, br, br); box(B, T, -0.24, 0.22, 0.13, 0.25, -0.22, 0.2, br2, br2); box(B, T, -0.15, 0.13, 0.25, 0.35, -0.13, 0.12, br, br); box(B, T, -0.06, 0.04, 0.35, 0.43, -0.05, 0.06, br2, br2); return;
  }
  if (k === 'arbusto') { const h = (o.s || 1) * 0.5; box(B, T, -h, h, 0, 0.8 + (o.s > 1.2 ? 0.1 : 0), -h, h, hex('#4c8f3d'), hex('#3f7c33'), F_TEX); return; }
}
{
  const r = rngFor(5, 5, 5);
  for (const rd of W.roads) {
    if (rd.t !== 'residential' || rd.ring) continue;
    const pts = rd.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 20) continue;
      const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l;
      let t = 9 + r() * 20;
      while (t < l - 9) {
        if (r() < 0.3) {
          const side = r() < 0.5 ? -1 : 1, off = (rd.h - 0.95) * side;
          const x = a[0] + ux * t - uz * off, z = a[1] + uz * t + ux * off;
          if (x > BX0 && x < BX1 && z > BZ0 && z < BZ1 && !SEGS.some(sg => sg.n !== rd.n && segDist(x, z, sg) < sg.h + 4)) {
            const ang = Math.atan2(uz, ux) + (side < 0 ? Math.PI : 0);
            const pcol = jit(pick(CARS, r), r, 0.05); carMesh(chunkB(x, z), groundFrame(x, z, ang, 0.0), pcol); PROPS.push({ k: 'carro', x, z, a: ang, col: pcol.map(Math.round) });
            maskRect(frame(x, 0, z, ang), -2.1, 2.1, -0.95, 0.95);
          }
        }
        t += 8 + r() * 28;
      }
    }
  }
}

// ---------------- mountains & clouds (far scenery) ----------------
{
  const FOGC = [0.72, 0.82, 0.90];
  const r = rngFor(9, 9, 9), cx = (BX0 + BX1) / 2, cz = (BZ0 + BZ1) / 2;
  // anel de morros baixos e arredondados no horizonte (sem picos)
  const n = 96, R0 = 1250;
  const raw = [];
  for (let i = 0; i < n; i++) raw.push(r());
  const hs = [];
  for (let i = 0; i <= n; i++) {          // ruído suavizado: média de vizinhos para não ter bicos
    let acc = 0, w = 0; for (let k = -4; k <= 4; k++) { const ww = 5 - Math.abs(k); acc += raw[(i + k + n * 2) % n] * ww; w += ww; }
    const a = i / n * Math.PI * 2, nz = acc / w;
    let dn = Math.abs(a - Math.PI * 1.5); dn = Math.min(dn, Math.PI * 2 - dn);            // distância angular do norte
    const k = Math.max(0, Math.min(1, (dn - 0.75) / 0.35)), ks = k * k * (3 - 2 * k);
    hs.push((30 + nz * 20) * (1 - ks) + (45 + nz * 60) * ks);                            // ao norte ficam bem baixos, na frente da serra
  }
  hs[n] = hs[0];
  // faixa contínua: base -> crista -> encosta de trás (sem bicos entre os pedaços)
  const ringP = (k, rr, y) => { const a = k / n * Math.PI * 2; return [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr]; };
  for (let i = 0; i < n; i++) {
    const col = jit(hex('#4f7a54'), r, 0.06), col2 = jit(hex('#5c7d6a'), r, 0.06);
    const b0 = ringP(i, R0, 0), b1 = ringP(i + 1, R0, 0);
    const c0 = ringP(i, R0 + 170, hs[i]), c1 = ringP(i + 1, R0 + 170, hs[i + 1]);
    const k0 = ringP(i, R0 + 420, hs[i] * 0.55), k1 = ringP(i + 1, R0 + 420, hs[i + 1] * 0.55);
    farB.quad(b0, b1, c1, c0, faceN(b0, b1, c1, true), col, F_FAR);
    farB.quad(c0, c1, k1, k0, faceN(c0, c1, k1, true), col2, F_FAR);
  }
  // ---- Serra da Mantiqueira ao norte: silhueta e cores tiradas da foto (malha única, sem luz nem sombra) ----
  {
    const S = {"h":[0.0,0.0,0.001,0.002,0.003,0.005,0.006,0.008,0.01,0.012,0.014,0.015,0.017,0.018,0.019,0.02,0.02,0.041,0.045,0.026,0.047,0.044,0.094,0.103,0.144,0.151,0.142,0.156,0.191,0.201,0.208,0.227,0.22,0.192,0.187,0.185,0.172,0.176,0.205,0.25,0.247,0.272,0.307,0.309,0.335,0.352,0.357,0.372,0.386,0.403,0.413,0.414,0.427,0.436,0.44,0.43,0.432,0.432,0.435,0.458,0.468,0.478,0.499,0.515,0.508,0.521,0.538,0.556,0.599,0.616,0.638,0.652,0.672,0.667,0.694,0.703,0.698,0.684,0.697,0.711,0.732,0.751,0.776,0.813,0.881,0.916,0.945,0.994,0.976,0.963,0.871,0.861,0.889,0.855,0.911,0.9,0.889,0.867,0.848,0.873,0.866,0.876,0.884,0.867,0.862,0.842,0.807,0.814,0.845,0.861,0.863,0.848,0.854,0.829,0.817,0.806,0.778,0.754,0.765,0.728,0.664,0.623,0.608,0.56,0.521,0.503,0.492,0.47,0.468,0.468,0.468,0.469,0.469,0.473,0.483,0.493,0.495,0.478,0.47,0.449,0.438,0.42,0.423,0.395,0.398,0.4,0.386,0.386,0.383,0.385,0.403,0.414,0.431,0.429,0.413,0.402,0.407,0.417,0.42,0.427,0.428,0.434,0.454,0.499,0.534,0.53,0.508,0.508,0.489,0.475,0.454,0.414,0.392,0.379,0.379,0.378,0.382,0.391,0.386,0.4,0.374,0.379,0.373,0.38,0.393,0.407,0.436,0.467,0.487,0.497,0.517,0.533,0.554,0.573,0.576,0.588,0.59,0.601,0.61,0.6,0.577],"c":["405b633357603a59602d535c044e591a505b33555e","405b633357603a59602d535c044e591a505b33555e","385a6134575f39585f3f5960495c614a5d62505f63","385a6134575f39585f3f5960495c614a5d62505f63","014e5d31575f044f5c24515c475c62606667656969","014f5e18505d024f5c044f5c445c61576266666b6b","014f5e18505d024f5c044f5c445c61576266666b6b","014e5e014e5d014f5d034f5d10515c566265606869","014e5e014e5d014f5d034f5d10515c566265606869","014f5e024e5e014f5d034f5c0d4f5c515e63495c63","024f5e054e5d014e5e024f5d094f5c25535e596668","024f5e054e5d014e5e024f5d094f5c25535e596668","014e5e024e5d014e5d024f5c084f5c24535e6b6c6a","014e5e024e5d014e5d024f5c084f5c24535e6b6c6a","014e5e014e5d014e5c034e5c094f5c23535e5d6568","014e5e014d5d024e5c024e5c0a4f5d1f535e3e5b63","014e5e014d5d024e5c024e5c0a4f5d1f535e3e5b63","024e5d0a4e5d024e5d014e5c0d4f5c21535e405b64","024e5d0a4e5d024e5d014e5c0d4f5c21535e405b64","054e5d27535e024e5c014e5d0c4f5c34576259666a","0a4f5d0d4f5d014d5d014e5d0f505d3c5b63465d64","0a4f5d0d4f5d014d5d014e5d0f505d3c5b63465d64","20535f054f5d014d5d014e5c485e642654604e6167","20535f054f5d014d5d014e5c485e642654604e6167","1e535f0e505d004d5c19505c20545f465e6459666b","044d5e104d5d014c5c22525d2e58604d6167566469","044d5e104d5d014c5c22525d2e58604d6167566469","1d535e024b5b1d4f5b26555f3a596154646a526268","1d535e024b5b1d4f5b26555f3a596154646a526268","19525e024b5a28545e24525e13505d4a5e66516069","2452601b525d25545d1b515c3e5b62506268526268","2452601b525d25545d1b515c3e5b62506268526268","024f6010505c20535d27555f4e61674f62685c676c","024f6010505c20535d27555f4e61674f62685c676c","0150610e505c20525c2e575f5163675f696c556569","014f6210515f34585f3a5a605564695a676b5d696c","014f6210515f34585f3a5a605564695a676b5d696c","0150620b506023545e30565e586769606a6c5f6a6d","0150620b506023545e30565e586769606a6c5f6a6d","01506103506116515c2f565e2c5761616a6c636a6e","01506202506112505c395a624761675e696d646c6e","01506202506112505c395a624761675e696d646c6e","0150610350610f4f5c1d545e446066606a6d636c6e","0150610350610f4f5c1d545e446066606a6d636c6e","024f61035061124e5c0c4f5d496167506369616c6e","014e60024f5f2d565f024e5b4c6167536569656d6f","014e60024f5f2d565f024e5b4c6167536569656d6f","365a65034f5f23545f335a625062685a686c5f6b6d","365a65034f5f23545f335a625062685a686c5f6b6d","2d5761024f6019525f435e654e636a54666a5b686b","2b5963024f5f08505f2c57614861684f63685d696d","2b5963024f5f08505f2c57614861684f63685d696d","2b5b64014e5f024f5f15525d47616752656a59696b","2b5b64014e5f024f5f15525d47616752656a59696b","2a5b66014f5f015060355b6344606854666b5e6b6d","205a6504506001506006515f3a5d654f656a53666a","205a6504506001506006515f3a5d654f656a53666a","0f556210526002505e03515e3a5c6351666b5f6b6e","0f556210526002505e03515e3a5c6351666b5f6b6e","235a64325b640d51600f535f0e536059686c4e6469","3e61692d5c66024f5e365c643b5d6557686c55676b","3e61692d5c66024f5e365c643b5d6557686c55676b","4160680953600b505f1f5560355d6551656b57676b","4160680953600b505f1f5560355d6551656b57676b","47636b1155611c5261085360345b644c6469626d6f","356169185761305e660d5460315c64355b63676f70","356169185761305e660d5460315c64355b63676f70","45636b0e53600a55614a646b2f5b64405f66656d70","45636b0e53600a55614a646b2f5b64405f66656d70","40626a0d535f0e55604362694161684462685f6b6f","1c57641d586316576123586347636a52676c4d656c","1c57641d586316576123586347636a52676c4d656c","0c55621f5863145861025461456268596b6e616e70","0c55621f5863145861025461456268596b6e616e70","1e5963275c641558620653614562694863685b6b6f","1b55620953600c54610353613a5d6650676c52686d","1b55620953600c54610353613a5d6650676c52686d","4a636c1958630d55601857623d5f674e656b626e71","4a636c1958630d55601857623d5f674e656b626e71","2f5f671d5863205863095662305b654b656b616e70","265a6402515f2e5b650254621859644c656b596b6e","265a6402515f2e5b650254621859644c656b596b6e","0954610252601054610b54611b59644f676b576b6e","0954610252601054610b54611b59644f676b576b6e","225764025160045361355f681858644a656a5b6c70","08506102505f0855621f586319596449636a54696d","08506102505f0855621f586319596449636a54696d","0f50600b535f15586128596318586448656b51676c","0f50600b535f15586128596318586448656b51676c","2d58651354602c5d652f5f671658643d626b50686d","3a5e6b1e57621157621d5864195763325f684b656c","3a5e6b1e57621157621d5864195763325f684b656c","55686f1f58620253610254611357633d616943636a","55686f1f58620253610254611357633d616943636a","44626a1c58620153600355621d5a6447666d4f686c","2757660a5360035461015462396069516a6f576b6e","2757660a5360035461015462396069516a6f576b6e","41616b1154600854610454623d636a4d696f44656b","41616b1154600854610454623d636a4d696f44656b","52676e0453600353600c576242656b4b686d406169","4b666e04515f04536136616947666c5d707247646a","4b666e04515f04536136616947666c5d707247646a","4c656d1155621e5a642d5e6647666c546c704f676c","4c656d1155621e5a642d5e6647666c546c704f676c","40636b0955612b5d650556613e636a5b6e71416369","3c60680b56620453602e5f6747676d586e71436369","3c60680b56620453602e5f6747676d586e71436369","065262025261095561305e663260695c6f73406167","065262025261095561305e663260695c6f73406167","0250610253620654611759633f646b5e6f723b6167","0e52620454611259642b5d663c626a596d6f3b5f66","0e52620454611259642b5d663c626a596d6f3b5f66","1557620c5661055462325f663b636a50696e4b6569","1557620c5661055462325f663b636a50696e4b6569","0b54611959630153611859623862684e686d54696c","17576203536102536135606643666c4e686c3d5e66","17576203536102536135606643666c4e686c3d5e66","01526001536101546247676a4d696d51696d375c64","01526001536101546247676a4d696d51696d375c64","025160005260015460375e65506a6d43656a385c63","03515f02515f366267165963536c6f4f696b395d64","03515f02515f366267165963536c6f4f696b395d64","3d6167435f663f636743656a536b6e4d6669375c63","3d6167435f663f636743656a536b6e4d6669375c63","355f63396165315e6449676c546d6f4d666b365a62","1c59601357600155601058624d686c4f686b3d5d62","1c59601357600155601058624d686c4f686b3d5d62","22585f08555f0155600e5762235d664d666a3a5a60","22585f08555f0155600e5762235d664d666a3a5a60","15586101535f015560095661235b644262673f5b60","0a545e01535f0254600656601d5a633159603b595e","0a545e01535f0254600656601d5a633159603b595e","02515e01535f0154600856601f5a632b555d37575d","02515e01535f0154600856601f5a632b555d37575d","02525e01535f02546008566120596327535b3c5b60","01525e01535f0254600755601d596235585e4a6062","01525e01535f0254600755601d596235585e4a6062","01525d01535f01535f09555f1d59612a545b3f595f","01525d01535f01535f09555f1d59612a545b3f595f","02515e00525e01535f07555f19586131595e3e595e","02515e02515e01535e08555e1b586033595f445c5f","02515e02515e01535e08555e1b586033595f445c5f","01505d02515e01525e06545e1d5861415e6134545b","01505d02515e01525e06545e1d5861415e6134545b","01505d02515e02525e06545e335c63405d632f525b","01505d01505d02525e08545d3e606448626532545b","01505d01505d02525e08545d3e606448626532545b","01505c02505d02515e2c575e365d63385d6436545b","01505c02505d02515e2c575e365d63385d6436545b","04515c11545c24585e355c62375e63325b6239565e","07515c14545c1a555c2a595f2c5a60325b623a585e","07515c14545c1a555c2a595f2c5a60325b623a585e","07515a0a525b24565e28585e2c595f305a613a5b60","07515a0a525b24565e28585e2c595f305a613a5b60","1c555c08515910545a3a5d633b5d612f5a603b5b61","16535b064f5a1d555d385c6221565e2e5960405b61","16535b064f5a1d555d385c6221565e2e5960405b61","2d5a5f0b515921565c21565d18555c2c59603e5c61","2d5a5f0b515921565c21565d18555c2c59603e5c61","17545a22555b1f555c28585d15545c2a585e3c5c61","155359125259325a5e22555c15545c2b575e3b5a61","155359125259325a5e22555c15545c2b575e3b5a61","07515909515a19565c27565d17535c28565e3a5a62","07515909515a19565c27565d17535c28565e3a5a62","045059054f5813525b1b545c18545c2a565d385960","024f59014f5a0c515906525a19535c2d565e3b5960","024f59014f5a0c515906525a19535c2d565e3b5960","034f5903505905505a03505a1b525b2d555d39585f","034f5903505905505a03505a1b525b2d555d39585f","18535911515a09515a08505a1d525c29555c37565d","26555a13525a034f590550591d515b29545c35545b","26555a13525a034f590550591d515b29545c35545b","0b5158085059024f59044f5919515a2b545c38555b","0b5158085059024f59044f5919515a2b545c38555b","024f59024f58014e58064f5918515a2d545b39565b","014e59014e58024e580b4e5923535b445c5f4e5f61","014e59014e58024e580b4e5923535b445c5f4e5f61","014e58014d58024d57084f5829545a36555d4a5c5f","014e58014d58024d57084f5829545a36555d4a5c5f","034e56014e58004d572050582f545a3f585e4f6061","034e57014d57024c572352582c555a30535b3a585c","034e57014d57024c572352582c555a30535b3a585c","034e57014d57184e5729535838585c3e595d3d595c","034e57014d57184e5729535838585c3e595d3d595c","034d56044d55194e552251572d545938555a475a5d","185357104d54134e551d4e562451582a515933535b","185357104d54134e551d4e562451582a515933535b","184e56064c55184d541c4f571d4f572a515931535b","184e56064c55184d541c4f571d4f572a515931535b","024b55064b56154e561c4f56194f572a51592e5259","024b55134d55114d550f4c56174e562a51592d5259","024b55134d55114d550f4c56174e562a51592d5259","064b540e4d55044b55084c55194e56285058305159","064b540e4d55044b55084c55194e56285058305159","024b54024a55024b55084c551a4e552850572e5158","014a55014a54024a55054b55124e56264f572d5158","014a55014a54024a55054b55124e56264f572d5158","024953024a54024a54044b54154d56244f562c5157","024953024a54024a54044b54154d56244f562c5157","0b4d54054a52034954034a54114c552a50562e5057"]};
    const N_ = S.c.length, ROWS = 7, R = 1850, SPAN = 1.5, HM = 300, BASE = -40;   // silhueta da foto do pôr do sol, pico com o formato da foto aproximada
    const hAt = i => { const e = Math.min(i / 14, (N_ - i) / 14), t = Math.max(0, Math.min(1, e)), f = t * t * (3 - 2 * t); return BASE + (0.06 + (Math.max(0.06, S.h[i]) - 0.06) * f) * (HM - BASE); };   // pontas descem suaves dos dois lados
    { let bi = 0; for (let i = 0; i <= N_; i++) if (S.h[i] > S.h[bi]) bi = i; PEAK_A = -Math.PI / 2 - SPAN / 2 + SPAN * bi / N_; window.__peak = { a: PEAK_A, cx, cz, R }; }
    const vtx = (i, j) => { const a = -Math.PI / 2 - SPAN / 2 + SPAN * i / N_, rr = R - j * 45, t = j / ROWS; return [cx + Math.cos(a) * rr, hAt(i) * (1 - t) + BASE * t, cz + Math.sin(a) * rr]; };
    for (let i = 0; i < N_; i++) for (let j = 0; j < ROWS; j++) {
      const hz = 0.2 + 0.3 * Math.pow(j / (ROWS - 1), 2);   // névoa cresce perto da base
      const c = [0, 2, 4].map((o, q) => Math.round(parseInt(S.c[i].substr(j * 6 + o, 2), 16) * (1 - hz) + FOGC[q] * 255 * hz));
      farB.quad(vtx(i, j), vtx(i + 1, j), vtx(i + 1, j + 1), vtx(i, j + 1), [0, 0, 1], c, F_SKY);
    }
  }
  for (let i = 0; i < 46; i++) {
    const x = cx + (r() - 0.5) * 2400, z = cz + (r() - 0.5) * 2400, y = 160 + r() * 80;
    const T = frame(x, y, z, r() * 0.5), wc = hex('#ffffff'), sc = hex('#e8eef5');
    const k = 2 + Math.floor(r() * 4);
    for (let j = 0; j < k; j++) { const u = (r() - 0.5) * 40, v = (r() - 0.5) * 20, s = 10 + r() * 16; box(farB, T, u - s, u + s, 0, 5 + r() * 6, v - s * 0.6, v + s * 0.6, wc, sc, F_SKY, true); }   // nuvens acompanham a cor do céu
  }
}

// collision bitmap
const MASK = new Uint8Array(MW * MH);
{
  const id = mx.getImageData(0, 0, MW, MH).data;
  for (let i = 0; i < MW * MH; i++) MASK[i] = id[i * 4 + 3] > 100 ? 1 : 0;
}
function gateBlocks(x, z) {
  { const G = GATE489; if (G && G.open < 0.4) { const dx = x - G.T.o[0], dz = z - G.T.o[2], u = dx * G.T.ax[0] + dz * G.T.ax[2], v = dx * G.T.az[0] + dz * G.T.az[2]; if (Math.abs(v) < 0.12 && u > -0.05 && u < G.L + 0.05) return true; } }
  const G = GATE116; if (!G) return false;
  const dx = x - G.T.o[0], dz = z - G.T.o[2], u = dx * G.T.ax[0] + dz * G.T.ax[2], v = dx * G.T.az[0] + dz * G.T.az[2];
  const s = G.open * (G.gB - G.gA - 0.15);
  return Math.abs(v - G.BV) < 0.16 && u > G.gA - s - 0.05 && u < G.gB - s + 0.05;
}
function blocked(x, z) {
  if (x < EX0 + 2 || x > EX1 - 2 || z < EZ0 + 2 || z > EZ1 - 2) return true;
  if (gateBlocks(x, z)) return true;
  return MASK[Math.floor((z - EZ0) * MR) * MW + Math.floor((x - EX0) * MR)] === 1;
}
function freeAt(x, z, rad) {
  if (blocked(x, z)) return false;
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; if (blocked(x + Math.cos(a) * rad, z + Math.sin(a) * rad)) return false; }
  return true;
}

// ---------------- WebGL ----------------
const cv = document.getElementById('c');
const gl = cv.getContext('webgl', { antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
if (!gl) { document.getElementById('load').textContent = 'Seu navegador não suporta WebGL.'; return; }
function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
function prog(vs, fs) { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
const VS = `attribute vec3 aP;attribute vec3 aN;attribute vec4 aC;uniform mat4 uVP;uniform mat4 uSVP;
varying vec3 vN;varying vec4 vC;varying vec3 vW;varying vec4 vS;
void main(){vN=aN;vC=aC;vW=aP;vS=uSVP*vec4(aP,1.0);gl_Position=uVP*vec4(aP,1.0);}`;
const FS = `precision highp float;varying vec3 vN;varying vec4 vC;varying vec3 vW;varying vec4 vS;
uniform sampler2D uSM;uniform vec3 uL;uniform vec3 uEye;uniform vec3 uFog;uniform vec2 uFogR;uniform float uT;uniform float uLv;uniform float uShadowOn;
uniform vec3 uSunC;uniform vec3 uAmbC;uniform vec3 uTint;uniform float uNight;uniform vec4 uLamp[8];uniform float uFade;
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float unpack(vec4 c){return dot(c,vec4(1.0,1.0/255.0,1.0/65025.0,1.0/16581375.0));}
float b2(vec2 q){return mod(q.x*2.0+q.y*3.0,4.0);}
float bayer(vec2 p){p=floor(mod(p,4.0));return (4.0*b2(mod(p,2.0))+b2(floor(p/2.0)))/16.0;}
void main(){
 vec3 N=normalize(vN);vec3 base=vC.rgb;float fl=vC.a;
 if(fl<0.012&&bayer(gl_FragCoord.xy)>=uFade)discard;
 if(fl>0.7&&fl<0.9){vec2 cell=floor(vW.xz*2.0+vec2(vW.y*1.7));base*=0.93+0.14*h21(cell);}
 else if(fl>0.33&&fl<0.47){vec2 q=vW.xz*vec2(4.0,2.0);q.x+=0.5*mod(floor(q.y),2.0);vec2 f=fract(q);base*=0.9+0.16*h21(floor(q));if(f.x<0.12||f.y<0.2)base*=0.72;}
 else if(fl>0.4&&fl<0.7){vec2 cell=floor(vW.xz*1.5);float w=sin(cell.x*0.9+uT*1.7)+sin(cell.y*1.3-uT*1.2)+sin((cell.x+cell.y)*0.5+uT*0.8);
  base=mix(base,vec3(0.5,0.78,0.95),smoothstep(1.0,2.4,w)*0.5);if(w>2.6)base=vec3(0.95,0.98,1.0);}
 float sh=1.0;
 if(uShadowOn>0.5){vec3 s=vS.xyz/vS.w*0.5+0.5;
  if(s.x>0.0&&s.x<1.0&&s.y>0.0&&s.y<1.0&&s.z<1.0){float d=unpack(texture2D(uSM,s.xy));if(s.z-0.0012>d)sh=0.0;}}
 float dif=max(dot(N,uL),0.0)*sh;dif=floor(dif*3.0+0.6)/3.0;
 vec3 amb=mix(vec3(0.40,0.38,0.40),vec3(0.56,0.63,0.78),N.y*0.5+0.5);
 vec3 col=base*(amb*0.9*uAmbC+uSunC*dif);
 if(uNight>0.01){vec3 lc=vec3(0.0);for(int k=0;k<8;k++){vec4 Lp=uLamp[k];float d=distance(vW,Lp.xyz);lc+=vec3(1.0,0.83,0.52)*Lp.w*(1.0-smoothstep(4.0,13.5,d));}
  col+=base*lc*uNight*(0.75+0.25*max(N.y,0.0));}
 float dist=length(vW-uEye);
 float fog=smoothstep(uFogR.x,uFogR.y,dist);
 if(fl<0.03){col=base*uTint;fog=0.0;}
 else if(fl<0.06){col=base;fog=0.0;}
 else if(fl<0.1){col=base;fog*=0.5;}
 else if(fl<0.3){fog=0.45+0.1*N.y;}
 col=mix(col,uFog,fog);
 col=floor(col*uLv+bayer(gl_FragCoord.xy))/uLv;
 gl_FragColor=vec4(col,1.0);}`;
const SVS = `attribute vec3 aP;uniform mat4 uSVP;varying float vD;void main(){vec4 p=uSVP*vec4(aP,1.0);vD=p.z/p.w*0.5+0.5;gl_Position=p;}`;
const SFS = `precision highp float;varying float vD;vec4 pk(float d){vec4 e=fract(d*vec4(1.0,255.0,65025.0,16581375.0));e-=e.yzww*vec4(1.0/255.0,1.0/255.0,1.0/255.0,0.0);return e;}void main(){gl_FragColor=pk(vD);}`;
const PM = prog(VS, FS), PS = prog(SVS, SFS);
const LOC = { aP: gl.getAttribLocation(PM, 'aP'), aN: gl.getAttribLocation(PM, 'aN'), aC: gl.getAttribLocation(PM, 'aC') };
const SLOC = { aP: gl.getAttribLocation(PS, 'aP') };
const U = {}; ['uVP', 'uSVP', 'uSM', 'uL', 'uEye', 'uFog', 'uFogR', 'uT', 'uLv', 'uShadowOn', 'uSunC', 'uAmbC', 'uTint', 'uNight', 'uLamp', 'uFade'].forEach(k => U[k] = gl.getUniformLocation(PM, k));
const SU = { uSVP: gl.getUniformLocation(PS, 'uSVP') };

function upload(B, dyn) {
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(B.buf, 0, B.n * 20), dyn ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  return { vbo, n: B.n };
}
const meshes = [];
let totalV = 0;
for (const c of chunks.values()) {
  const f = c.B.f, bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (let i = 0; i < c.B.n; i++) { const o = i * 5; for (let k = 0; k < 3; k++) { const v = f[o + k]; if (v < bb[k]) bb[k] = v; if (v > bb[3 + k]) bb[3 + k] = v; } }
  meshes.push({ m: upload(c.B), cx: c.cx, cz: c.cz, bb }); totalV += c.B.n; c.B = null;
}
// frustum test: a box is hidden only if all 8 corners are outside the same clip plane
function boxVisible(M, bb) {
  let out = [0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) {
    const x = bb[i & 1 ? 3 : 0], y = bb[i & 2 ? 4 : 1], z = bb[i & 4 ? 5 : 2];
    const cx = M[0] * x + M[4] * y + M[8] * z + M[12], cy = M[1] * x + M[5] * y + M[9] * z + M[13], cw = M[3] * x + M[7] * y + M[11] * z + M[15];
    if (cx < -cw) out[0]++; if (cx > cw) out[1]++; if (cy < -cw) out[2]++; if (cy > cw) out[3]++; if (cw < 0.1) out[4]++;
  }
  return !out.some(n => n === 8);
}
const groundM = upload(ground), farM = upload(farB);
totalV += ground.n + farB.n;
const dynB = new Builder(1 << 14); const dynVBO = gl.createBuffer();
const skyMB = new Builder(1 << 12); const skyMVBO = gl.createBuffer();   // mensagem do criador (sem sombra)

function bindMain(m) {
  gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
  gl.vertexAttribPointer(LOC.aP, 3, gl.FLOAT, false, 20, 0);
  gl.vertexAttribPointer(LOC.aN, 3, gl.BYTE, true, 20, 12);
  gl.vertexAttribPointer(LOC.aC, 4, gl.UNSIGNED_BYTE, true, 20, 16);
}
function bindShadow(m) { gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo); gl.vertexAttribPointer(SLOC.aP, 3, gl.FLOAT, false, 20, 0); }

// shadow map
const SMS = 2048;
const smTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, smTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SMS, SMS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
const smFB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, smFB);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, smTex, 0);
const smRB = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, smRB); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SMS, SMS);
gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, smRB);
const shadowOK = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

// ---------------- matrices ----------------
function mul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
function persp(fy, asp, n, f) { const t = 1 / Math.tan(fy / 2), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; }
function ortho(l, r, b, t, n, f) { const o = new Float32Array(16); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o; }
function lookAt(e, c, up) {
  let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2]; let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const o = new Float32Array(16);
  o[0] = xx; o[1] = yx; o[2] = zx; o[4] = xy; o[5] = yy; o[6] = zy; o[8] = xz; o[9] = yz; o[10] = zz;
  o[12] = -(xx * e[0] + xy * e[1] + xz * e[2]); o[13] = -(yx * e[0] + yy * e[1] + yz * e[2]); o[14] = -(zx * e[0] + zy * e[1] + zz * e[2]); o[15] = 1;
  return o;
}
function xform(m, p) { const x = p[0], y = p[1], z = p[2]; const w = m[3] * x + m[7] * y + m[11] * z + m[15]; return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w, w]; }

// ---------------- game state ----------------

const FOG = [0.72, 0.82, 0.90];
// ---------------- dia e noite ----------------
const mixv = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t), sstepC = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function skyState() {
  const c = gameClock(), h = c.h;
  const f = (h - 6) / 12;                                 // 0 = nascer (06:00), 1 = pôr (18:00)
  const e = -0.14 + Math.sin(Math.PI * f) * 1.38;          // altura do sol: sai de trás do pico e volta para trás dele
  const az = PEAK_A + 0.45 * Math.sin(2 * Math.PI * f);
  const sunDir = [Math.cos(e) * Math.cos(az), Math.sin(e), Math.cos(e) * Math.sin(az)];
  const g = ((h - 18 + 24) % 24) / 12, me = -0.1 + Math.sin(Math.PI * Math.min(1, g)) * 0.95, maz = PEAK_A + Math.PI + 0.3 * Math.sin(2 * Math.PI * g);
  const moonDir = [Math.cos(me) * Math.cos(maz), Math.sin(me), Math.cos(me) * Math.sin(maz)];
  const day = sstepC(-0.12, 0.22, e), gold = (1 - sstepC(0.05, 0.4, e)) * sstepC(-0.16, 0.02, e);   // dia e "hora dourada"
  const night = 1 - day;
  const lightDir = day > 0.35 || me < 0.05 ? (e > 0.04 ? sunDir : [sunDir[0], 0.05, sunDir[2]]) : moonDir;
  const sunC = mixv(mixv([0.72, 0.68, 0.58], [0.72, 0.5, 0.32], gold), [0.17, 0.2, 0.3], night);
  const ambC = mixv(mixv([1, 1, 1], [1.02, 0.86, 0.8], gold), [0.6, 0.66, 0.92], night);
  const fog = mixv(mixv(FOG, [0.94, 0.72, 0.56], gold * 0.9), [0.19, 0.23, 0.36], night);
  const tint = mixv(mixv([1, 1, 1], [0.95, 0.72, 0.62], gold), [0.38, 0.44, 0.62], night);
  return { h, e, sunDir, moonDir, lightDir, sunC, ambC, fog, tint, night, gold, shadowK: day > 0.35 ? 1 : (me > 0.1 ? 0.6 : 0) };
}
function drawSky(B, eye, S) {   // sol, lua, estrelas e luz dos postes
  const disc = (dir, dist, r, col, segs) => {
    const c = [eye[0] + dir[0] * dist, eye[1] + dir[1] * dist, eye[2] + dir[2] * dist];
    let rt = [-dir[2], 0, dir[0]]; const rl = Math.hypot(rt[0], rt[2]) || 1; rt = [rt[0] / rl, 0, rt[2] / rl];
    const up = [rt[1] * dir[2] - rt[2] * dir[1], rt[2] * dir[0] - rt[0] * dir[2], rt[0] * dir[1] - rt[1] * dir[0]];
    for (let k = 0; k < segs; k++) {
      const a0 = k / segs * Math.PI * 2, a1 = (k + 1) / segs * Math.PI * 2;
      const p = a => [c[0] + (rt[0] * Math.cos(a) + up[0] * Math.sin(a)) * r, c[1] + (rt[1] * Math.cos(a) + up[1] * Math.sin(a)) * r, c[2] + (rt[2] * Math.cos(a) + up[2] * Math.sin(a)) * r];
      B.tri(c, p(a0), p(a1), [-dir[0], -dir[1], -dir[2]], col, F_GLOW);
    }
  };
  if (S.e > -0.25) disc(S.sunDir, 2250, 62, mixv([255, 246, 205], [255, 170, 80], S.gold).map(Math.round), 12);
  if (S.night > 0.05) {
    const mf = S.night;
    disc(S.moonDir, 2200, 44, [Math.round(150 + 90 * mf), Math.round(155 + 90 * mf), Math.round(170 + 85 * mf)], 10);
    if (mf > 0.3) { let rs = 7; const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 90; k++) { const a = rnd() * Math.PI * 2, el = 0.12 + rnd() * 1.3, d = [Math.cos(el) * Math.cos(a), Math.sin(el), Math.cos(el) * Math.sin(a)], b = Math.round(120 + 135 * mf * (0.5 + 0.5 * rnd())); disc(d, 2150, 4 + rnd() * 3, [b, b, Math.min(255, b + 10)], 4); } }
  }
}
function lampState(S, cx, cz) {   // os 8 postes de luz mais próximos acendem a rua em volta
  const out = new Float32Array(32); if (S.night < 0.01) return out;
  const L = []; for (const p of PROPS) if (p.k === 'luminaria' || p.k === 'poste') L.push(p);
  L.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
  for (let i = 0; i < Math.min(8, L.length); i++) { const p = L[i], T = frame(p.x, surfAt(p.x, p.z), p.z, p.a), q = p.k === 'poste' ? P(T, 2.7, 7.2, 0) : P(T, 1.75, 6.3, 0); out.set([q[0], q[1], q[2], 1.0], i * 4); }
  return out;
}
const player = { x: W.spawn[0], z: W.spawn[1], a: 0, va: 0, walk: 0, speed: 0, car: false, cv: 0 };
// face along the road at spawn
{
  let best = 1e9, ang = 0;
  for (const s of SEGS) { const d = segDist(player.x, player.z, s); if (d < best) { best = d; ang = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]); } }
  player.a = ang;
}
let camY = groundAt(player.x, player.z);
const cam = { yaw: 0, pitch: 0.62, dist: 24, tyaw: 0, follow: 0, fp: false };
// primeira pessoa (V / botão 👁) — vale para todos os modos
function setFP(on) {
  cam.fp = !!on;
  document.body.classList.toggle('fp', cam.fp);
  if (cam.fp) { cam.pitch = 0.05; } else { cam.pitch = Math.max(0.12, cam.pitch); if (document.pointerLockElement) document.exitPointerLock(); }
  const b = document.getElementById('btnView'); if (b) { b.classList.toggle('on', cam.fp); b.innerHTML = cam.fp ? '👁<span>1ª PESSOA</span>' : '👁<span>3ª PESSOA</span>'; }
  try { localStorage.setItem('mdc_fp', cam.fp ? '1' : '0'); } catch (e) {}
}
cam.yaw = Math.atan2(-Math.cos(player.a), -Math.sin(player.a));
let pixel = (() => { try { const v = parseFloat(localStorage.getItem('mdc_px')); if (v) return v; } catch (e) {} return matchMedia('(pointer:coarse)').matches ? 2 : 3; })(), shadowsOn = shadowOK;   // celular começa mais nítido
const keys = {};
function segDist(x, z, s) {
  const ax = s.a[0], az = s.a[1], dx = s.b[0] - ax, dz = s.b[1] - az, L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

// moving cars: andam pela malha de ruas fazendo circuitos (só em ruas que não são sem saída)
const traffic = [];
const RNET = (() => {
  const nodes = new Map(), key = p => Math.round(p[0]) + ',' + Math.round(p[1]);
  const node = p => { const k = key(p); let n = nodes.get(k); if (!n) { n = { x: p[0], z: p[1], e: [] }; nodes.set(k, n); } return n; };
  for (const r of W.roads) {
    if (!(r.t === 'residential' || r.t === 'secondary' || r.t === 'living_street' || r.t === 'tertiary' || r.t === 'unclassified') || r.dirt) continue;
    for (let i = 0; i < r.pts.length - 1; i++) { const a = node(r.pts[i]), b = node(r.pts[i + 1]); if (a === b || a.e.some(e => e.n === b)) continue; const L = Math.hypot(a.x - b.x, a.z - b.z), h = r.h, t = r.t; a.e.push({ n: b, L, h, t }); b.e.push({ n: a, L, h, t }); }
  }
  // tira as ruas sem saída (núcleo de grau 2): os carros só circulam onde dá para fazer a volta completa
  let changed = true; const live = new Set(nodes.values());
  while (changed) { changed = false; for (const n of live) { const deg = n.e.filter(e => live.has(e.n)).length; if (deg < 2) { live.delete(n); changed = true; } } }
  for (const n of live) n.e = n.e.filter(e => live.has(e.n));
  return [...live];
})();
function carNext(c) {   // escolhe a próxima rua no cruzamento (sem voltar pela mesma)
  const n = c.b, opts = n.e.filter(e => e.n !== c.a);
  const ain = Math.atan2(c.b.z - c.a.z, c.b.x - c.a.x);
  const w = opts.map(e => { let tr = Math.atan2(e.n.z - n.z, e.n.x - n.x) - ain; while (tr > Math.PI) tr -= 2 * Math.PI; while (tr < -Math.PI) tr += 2 * Math.PI; return Math.abs(tr) < 0.35 ? 3 : Math.abs(tr) < 2.4 ? 1 : 0.05; });
  let sum = w.reduce((p, q) => p + q, 0), k = Math.random() * sum, e = opts[0];
  for (let i = 0; i < opts.length; i++) { k -= w[i]; if (k <= 0) { e = opts[i]; break; } }
  if (!e) e = n.e[0];
  c.a = n; c.b = e.n; c.L = e.L; c.h = e.h; c.t = e.t; c.s = 0;
}
{
  const r = rngFor(3, 1, 4);
  if (RNET.length) for (let i = 0; i < 34; i++) {
    const a = RNET[Math.floor(r() * RNET.length)], e = a.e[Math.floor(r() * a.e.length)];
    traffic.push({ a, b: e.n, L: e.L, h: e.h, t: e.t, s: r() * e.L, vmax0: e.t === 'secondary' ? 11 + r() * 5 : 6 + r() * 4, v: 0, col: jit(pick(CARS, r), r, 0.05), x: 0, z: 0, a_: 0, ad: null });
  }
}
function placeCar(c) {
  const ax = c.a.x, az = c.a.z, bx = c.b.x, bz = c.b.z, t = Math.min(1, c.s / (c.L || 1));
  const fx = (bx - ax) / (c.L || 1), fz = (bz - az) / (c.L || 1), off = Math.min(1.7, Math.max(1.1, c.h * 0.42));
  c.x = ax + (bx - ax) * t - fz * off; c.z = az + (bz - az) * t + fx * off;
  const ta = Math.atan2(fz, fx); if (c.ad === null) c.ad = ta;
  let d = ta - c.ad; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; c.ad += d * 0.25;
  c.a_ = c.ad;
}

// ---------------- input ----------------
addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (document.getElementById('lobby').style.display !== 'none') return;
  if (typeof VHS !== 'undefined' && VHS.open) return;
  if (e.code === 'KeyF' && typeof VHS !== 'undefined' && VHS.near) { vhsOpen(VHS.cur); return; }
  if (e.code === 'KeyC' && typeof BEAGLE !== 'undefined' && BEAGLE.near) { beaglePet(); return; }
  if (e.code === 'KeyX' && BENCH && BENCH.near) { benchSit(); return; }
  if (e.code === 'Enter' && window.__net && window.__net.online) { e.preventDefault(); window.__net.openChat(); return; }
  if (!e.repeat && window.__hunt && window.__hunt.key(e.code)) { e.preventDefault(); return; }
  keys[e.code] = true;
  if (e.code === 'KeyC') toggleCar();
  if (e.code === 'KeyV') setFP(!cam.fp);
  if (e.code === 'KeyP') { pixel = pixel === 2 ? 3 : pixel === 3 ? 4 : 2; try { localStorage.setItem('mdc_px', String(pixel)); } catch (er) {} resize(); }
  if (e.code === 'KeyM') document.getElementById('mini').classList.toggle('big');
  if (e.code === 'KeyH') document.getElementById('help').classList.toggle('hide');
  if (e.code === 'KeyL') shadowsOn = !shadowsOn && shadowOK;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
let drag = null;
cv.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch') return; hideHelpSoon();
  if (cam.fp) {
    if (document.pointerLockElement !== cv) { try { cv.requestPointerLock(); } catch (er) {} }
    else if (e.button === 0 && window.__hunt && window.__hunt.active()) window.__hunt.key('Space');
    return;
  }
  drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId);
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== cv) return;
  cam.yaw -= e.movementX * 0.0035; cam.pitch = Math.max(-1.35, Math.min(1.45, cam.pitch + e.movementY * 0.0035)); cam.follow = 1.5;
});
cv.addEventListener('pointermove', e => { if (!drag) return; cam.yaw -= (e.clientX - drag.x) * 0.006; cam.pitch = Math.max(cam.fp ? -1.35 : -1.1, Math.min(1.45, cam.pitch + (e.clientY - drag.y) * 0.005)); drag = { x: e.clientX, y: e.clientY }; cam.follow = 1.5; });
cv.addEventListener('pointerup', () => { drag = null; });
cv.addEventListener('wheel', e => { e.preventDefault(); if (cam.fp) { if (e.deltaY > 0) { setFP(false); cam.dist = 7.5; } return; } if (e.deltaY < 0 && cam.dist <= 7.05) { cam.zin = (cam.zin || 0) - e.deltaY; if (cam.zin > 120) { cam.zin = 0; setFP(true); } return; } cam.zin = 0; cam.dist = Math.max(7, Math.min(260, cam.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });   // zoom: aproximar ao máximo entra em 1ª pessoa
function toggleCar() {
  if (window.__hunt && window.__hunt.active() && !player.car) return;   // sem carro no esconde-esconde
  if (player.car) { // step out to the side
    const sx = player.x - Math.sin(player.a) * 2.2, sz = player.z + Math.cos(player.a) * 2.2;
    if (freeAt(sx, sz, 0.35)) { player.x = sx; player.z = sz; }
    player.car = false; player.cv = 0;
  } else { player.car = true; player.cv = 0; }
  document.getElementById('btnCar').classList.toggle('on', player.car);
}
// touch controls
const joy = { id: null, x: 0, y: 0, dx: 0, dy: 0 }, look = { id: null, x: 0, y: 0 };
const pinch = {}; window.__touch = { joy, look, pinch }; window.__houses = W.houses;
const jEl = document.getElementById('joy'), jKnob = document.getElementById('knob');
cv.addEventListener('touchstart', e => {
  hideHelpSoon();
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id || t.identifier === look.id || t.identifier === pinch.id2) continue;
    // pinça (zoom) só na metade direita da tela: o dedo que gira a câmera + um segundo dedo, ambos à direita
    if (look.id !== null && t.clientX >= innerWidth * 0.5 && look.x >= innerWidth * 0.5 && pinch.id2 == null) { pinch.d = null; pinch.id2 = t.identifier; pinch.zin = 1; continue; }
    if (t.clientX < innerWidth * 0.45 && joy.id === null) { joy.t0 = performance.now(); joy.id = t.identifier; joy.x = t.clientX; joy.y = t.clientY; joy.dx = joy.dy = 0; jEl.style.left = (t.clientX - 70) + 'px'; jEl.style.top = (t.clientY - 70) + 'px'; jEl.classList.remove('run'); jEl.style.display = 'block'; jKnob.style.transform = 'translate(0px,0px)'; }
    else if (look.id === null) { look.id = t.identifier; look.x = t.clientX; look.y = t.clientY; }

  }
  e.preventDefault();
}, { passive: false });
cv.addEventListener('touchmove', e => {
  for (const t of e.touches) {
    if (t.identifier === joy.id) { let dx = t.clientX - joy.x, dy = t.clientY - joy.y; const l = Math.hypot(dx, dy); const R = 60; if (l > R) { dx *= R / l; dy *= R / l; } joy.dx = dx / R; joy.dy = dy / R; jKnob.style.transform = `translate(${dx}px,${dy}px)`; jEl.classList.toggle('run', Math.hypot(joy.dx, joy.dy) > 0.82); }
    else if (t.identifier === look.id) {
      const t2 = [...e.touches].find(q => q.identifier === pinch.id2);
      if (t2) { const d = Math.hypot(t.clientX - t2.clientX, t.clientY - t2.clientY); if (pinch.d) { if (cam.fp) { if (d < pinch.d * 0.75) { setFP(false); cam.dist = 7.5; pinch.d = d; } } else { const nd = cam.dist * pinch.d / d; if (nd < 7 && cam.dist <= 7.05) { pinch.zin = (pinch.zin || 1) * d / pinch.d; if (pinch.zin > 1.35) { pinch.zin = 1; setFP(true); } } else pinch.zin = 1; cam.dist = Math.max(7, Math.min(260, nd)); } } if (!cam.fp || !pinch.d) pinch.d = d; }
      else { cam.yaw -= (t.clientX - look.x) * 0.008; cam.pitch = Math.max(cam.fp ? -1.35 : -1.1, Math.min(1.45, cam.pitch + (t.clientY - look.y) * 0.006)); cam.follow = 1.5; }
      look.x = t.clientX; look.y = t.clientY;
    }
  }
  e.preventDefault();
}, { passive: false });
cv.addEventListener('touchend', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.id = null; joy.dx = joy.dy = 0; jEl.style.display = 'none'; }
    if (t.identifier === look.id) look.id = null;
    if (t.identifier === pinch.id2) pinch.id2 = null;
  }
});
document.getElementById('btnCar').addEventListener('click', toggleCar);

try { if (localStorage.getItem('mdc_fp') === '1') setTimeout(() => setFP(true), 0); } catch (e) {}
{ const m = document.getElementById('mini'); m.addEventListener('click', e => { e.stopPropagation(); m.classList.toggle('big'); }); m.addEventListener('touchstart', e => e.stopPropagation(), { passive: true }); }
// engrenagem: configurações (gráfico)
{ const G = document.getElementById('gearPanel'), btn = document.getElementById('btnGear');
  const mark = () => G.querySelectorAll('[data-px]').forEach(b => b.classList.toggle('sel', +b.dataset.px === pixel));
  btn.addEventListener('click', e => { e.stopPropagation(); G.classList.toggle('on'); mark(); });
  document.getElementById('gearClose').addEventListener('click', () => G.classList.remove('on'));
  G.querySelectorAll('[data-px]').forEach(b => b.addEventListener('click', () => { pixel = +b.dataset.px; try { localStorage.setItem('mdc_px', String(pixel)); } catch (e) {} resize(); mark(); }));
  for (const el of [btn, G]) el.addEventListener('touchstart', e => e.stopPropagation(), { passive: true }); }
{ if (matchMedia('(pointer:coarse)').matches) document.getElementById('online').appendChild(document.getElementById('btnGear')); }   // celular: engrenagem ao lado do botão ENTRAR
let helpTimer = null;
function hideHelpSoon() { if (helpTimer) return; helpTimer = setTimeout(() => document.getElementById('help').classList.add('hide'), 6000); }

// ---------------- minimap ----------------
const mini = document.getElementById('mini'), mctx = mini.getContext('2d');
const MMW = 1000, MMH = Math.round(1000 * (EZ1 - EZ0) / (EX1 - EX0));
mini.width = MMW; mini.height = MMH;
const mapImg = document.createElement('canvas'); mapImg.width = MMW; mapImg.height = MMH;
{
  const g = mapImg.getContext('2d'), s = MMW / (EX1 - EX0);
  g.fillStyle = '#6fa64a'; g.fillRect(0, 0, MMW, MMH);
  g.setTransform(s, 0, 0, s, -EX0 * s, -EZ0 * s);
  const fillA = (a, c) => { g.fillStyle = c; g.beginPath(); a.pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill(); };
  for (const a of W.areas) fillA(a, { water: '#2f78b8', wood: '#3f7a37', park: '#86bd60', pitch: '#4ea64b', uni: '#c9c3b6', building: '#d9d2c3', grass: '#7db556', island: '#7db556', strip: '#4f8f3e' }[a.t]);
  for (const C of [W.creek, W.creek2]) if (C) { g.strokeStyle = '#3a7fb0'; g.lineWidth = 3; g.beginPath(); C.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); }
  { // hillshade from the real elevation
    const hc = document.createElement('canvas'); hc.width = LW; hc.height = LH;
    const hx = hc.getContext('2d'), im = hx.createImageData(LW, LH);
    for (let j = 0; j < LH; j++) for (let i = 0; i < LW; i++) {
      const dx = (LAT[j * LW + Math.min(LW - 1, i + 1)] - LAT[j * LW + Math.max(0, i - 1)]) / (2 * TS) * 3;
      const dz = (LAT[Math.min(LH - 1, j + 1) * LW + i] - LAT[Math.max(0, j - 1) * LW + i]) / (2 * TS) * 3;
      const l = Math.hypot(dx, 1, dz), sh = Math.max(0, (dx * 0.6 + 1 * 0.7 + dz * 0.4) / l);
      const hh = (LAT[j * LW + i] - 0) / 46, v = Math.round(255 * Math.min(1, 0.55 + sh * 0.55)) - Math.round((1 - hh) * 20);
      const o = (j * LW + i) * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = v; im.data[o + 3] = 255;
    }
    hx.putImageData(im, 0, 0);
    g.save(); g.globalCompositeOperation = 'multiply'; g.imageSmoothingEnabled = true;
    g.drawImage(hc, EX0, EZ0, (LW - 1) * TS, (LH - 1) * TS); g.restore();
  }
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const r of W.roads) { g.strokeStyle = r.t === 'footway' ? '#c79e72' : '#e8e4da'; g.lineWidth = (r.h + r.sw) * 2; g.beginPath(); r.pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); }
  for (const r of W.roads) { if (r.t === 'footway') continue; g.strokeStyle = r.dirt ? '#a77b52' : (r.t === 'secondary' ? '#f2c94c' : '#4a4b55'); g.lineWidth = r.h * 2; g.beginPath(); r.pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); }
  g.fillStyle = '#c4573a';
  for (const h of W.houses) { const T = frame(h[0], 0, h[1], h[4]); const a = P(T, -h[2] / 2, 0, -h[3] / 2), b = P(T, h[2] / 2, 0, -h[3] / 2), c = P(T, h[2] / 2, 0, h[3] / 2), d = P(T, -h[2] / 2, 0, h[3] / 2); g.beginPath(); g.moveTo(a[0], a[2]); g.lineTo(b[0], b[2]); g.lineTo(c[0], c[2]); g.lineTo(d[0], d[2]); g.fill(); }
  g.fillStyle = '#56a8d8';
  for (const h of W.houses) if (h[8]) { g.fillRect(h[9] - 2, h[10] - 2, 4, 4); }
  g.fillStyle = '#2a5a2a';
  for (const t of W.trees) if ((t[0] * 7 + t[1] * 3) % 3 < 1) g.fillRect(t[0] - 1.2, t[1] - 1.2, 2.4, 2.4);
}
function drawMini() {
  mctx.drawImage(mapImg, 0, 0);
  const s = MMW / (EX1 - EX0), x = (player.x - EX0) * s, z = (player.z - EZ0) * s;
  // view cone
  mctx.save(); mctx.translate(x, z);
  mctx.fillStyle = 'rgba(255,255,255,0.25)';
  const fa = Math.atan2(-Math.cos(cam.yaw), -Math.sin(cam.yaw));
  mctx.beginPath(); mctx.moveTo(0, 0); mctx.arc(0, 0, 90, fa - 0.45, fa + 0.45); mctx.closePath(); mctx.fill();
  mctx.rotate(player.a);
  mctx.fillStyle = '#ffffff'; mctx.strokeStyle = '#000'; mctx.lineWidth = 6;
  mctx.beginPath(); mctx.moveTo(26, 0); mctx.lineTo(-16, 15); mctx.lineTo(-8, 0); mctx.lineTo(-16, -15); mctx.closePath(); mctx.stroke(); mctx.fill();
  mctx.restore();
}

// ---------------- labels ----------------
const SAYS = ['Opa! Boa tarde! Tudo tranquilo por aqui.', 'Bem-vindo ao Morada da Colina!', 'Cuidado ao atravessar a avenida, hein!', 'Essa bicicleta aí é minha, viu?', 'O cachorro tá dormindo na casinha, não acorda ele não.', 'Vai dar uma volta no bairro? Bom passeio!'];
const bubble = document.createElement('div'); bubble.className = 'bubble'; document.getElementById('labels').appendChild(bubble);
const lblLayer = document.getElementById('labels');
for (const p of POIS) { p.el = document.createElement('div'); p.el.className = 'lbl' + (p.big ? ' big' : ''); p.el.textContent = p.n; lblLayer.appendChild(p.el); }

// ---------------- player mesh ----------------
const SKIN = hex('#c98d62'), HAIR = hex('#2a1d14'), SHIRT = hex('#f2c230'), SHIRT2 = hex('#1f8a4c'), SHORTS = hex('#2a4d8f'), SHOE = hex('#f4f4f4'), PCAR = hex('#e04a2b');
// skins especiais pelo nome do jogador (primeiro nome, sem diferenciar maiúscula/acento)
function skinOf(name) {
  const f = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().split(/\s+/)[0];
  if (f === 'bruno' || f === 'mendes') return 'biblia';
  return ['carlos', 'kiko', 'miguel', 'manoel'].includes(f) ? f : null;
}
const PSC = 0.84;   // escala das pessoas (~1,70 m), proporcional às casas e portas
function scaleT(T, k) { T.ax = T.ax.map(x => x * k); T.ay = T.ay.map(x => x * k); T.az = T.az.map(x => x * k); return T; }
// ================= personagem em voxels articulado (cubinhos de ~6 cm; partes com quadril, joelho, tornozelo, ombro, cotovelo e pescoço) =================
const VX = 1.95 / 31;                                   // tamanho do cubinho antes da escala das pessoas
const VXCACHE = new Map();
function vxPart(key, fill) {   // constrói a parte e junta cubinhos iguais em blocos maiores (poucas caixas por parte)
  let r = VXCACHE.get(key); if (r) return r;
  const V = new Map(), put = (x, y, z, c) => V.set(x + ',' + y + ',' + z, c);
  const b = (x0, x1, y0, y1, z0, z1, c) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) put(x, y, z, typeof c === 'function' ? c(x, y, z) : c); };
  fill(b, put);
  const ck = c => c.join(','), rows = new Map();
  for (const [k, c] of V) { const [x, y, z] = k.split(',').map(Number), rk = y + ',' + z; if (!rows.has(rk)) rows.set(rk, []); rows.get(rk).push([x, c]); }
  let runs = [];
  for (const [rk, list] of rows) { const [y, z] = rk.split(',').map(Number); list.sort((p, q) => p[0] - q[0]); let s0 = null;
    for (const [x, c] of list) { if (s0 && s0.x1 === x - 1 && ck(s0.c) === ck(c)) s0.x1 = x; else { if (s0) runs.push(s0); s0 = { x0: x, x1: x, y0: y, y1: y, z0: z, z1: z, c }; } } if (s0) runs.push(s0); }
  const mergeAxis = (A0, A1, keyf) => { const g = new Map(); for (const q of runs) { const k = keyf(q); if (!g.has(k)) g.set(k, []); g.get(k).push(q); } const out = [];
    for (const list of g.values()) { list.sort((p, q) => p[A0] - q[A0]); let cur = null; for (const q of list) { if (cur && cur[A1] === q[A0] - 1) cur[A1] = q[A1]; else { if (cur) out.push(cur); cur = { ...q }; } } if (cur) out.push(cur); } runs = out; };
  mergeAxis('y0', 'y1', q => [q.x0, q.x1, q.z0, q.z1, ck(q.c)].join('|'));
  mergeAxis('z0', 'z1', q => [q.x0, q.x1, q.y0, q.y1, ck(q.c)].join('|'));
  VXCACHE.set(key, runs); return runs;
}
const shade = (c, k) => c.map(v => Math.max(0, Math.min(255, Math.round(v * k))));
const vRx = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; };   // + leva o que está abaixo do eixo para a frente (z+)
const vRy = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const vRz = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const vMM = (A, B) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]));
const vMV = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
const vX = (P_, t, R) => ({ R: vMM(P_.R, R), t: vMV(P_.R, t).map((x, i) => x + P_.t[i]) });
function vxDraw(B, Tb, parts) {   // espaço do modelo: x = esquerda do personagem, y = cima, z = frente  →  frame do jogo: u = z, y, v = -x
  const W = (x, y, z) => [Tb.ax[0] * z + Tb.ay[0] * y - Tb.az[0] * x, Tb.ax[1] * z + Tb.ay[1] * y - Tb.az[1] * x, Tb.ax[2] * z + Tb.ay[2] * y - Tb.az[2] * x];
  for (const [runs, M] of parts) {
    const cx = [M.R[0], M.R[3], M.R[6]], cy = [M.R[1], M.R[4], M.R[7]], cz = [M.R[2], M.R[5], M.R[8]], o = W(...M.t.map(v => v * VX));
    const T = { o: [Tb.o[0] + o[0], Tb.o[1] + o[1], Tb.o[2] + o[2]], ax: W(...cz).map(v => v * VX), ay: W(...cy).map(v => v * VX), az: W(...cx).map(v => -v * VX) };
    for (const q of runs) box(B, T, q.z0 - 0.5, q.z1 + 0.5, q.y0, q.y1 + 1, -q.x1 - 0.5, -q.x0 + 0.5, q.c, q.c);
  }
}
function vxHash(s) { let h = 7; for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
function buildPlayerVox(B, p, look, sk, SKN) {
  const SH = look.shirt, SH2 = shade(SH, 0.8), JE = SHORTS, JE2 = shade(SHORTS, 0.82), SK2 = shade(SKN, 0.85), HR = HAIR, WH = hex('#ffffff'), PU = hex('#1a1a1a'), BR = shade(HAIR, 0.8), MO = hex('#6a3424');
  const style = sk === 'carlos' || sk === 'kiko' ? 0 : vxHash(p === player ? player.n : p.n) % 3, F = sk === 'kiko' ? 4 : 0, kS = SKN.join('.') + '|' + SH.join('.');
  const pelvis = vxPart('pel' + (sk === 'manoel' ? 'M' : ''), (b, put) => { b(-3, 3, 0, 1, -1, 1, JE); b(-3, 3, 2, 2, -1, 1, x => x === 0 ? hex('#c9b46a') : hex('#3b2a1e'));
    if (sk === 'manoel') { b(0, 0, 0, 0, 2, 3, hex('#efe6d2')); b(-1, 1, -1, 1, 4, 4, hex('#d23a2e')); b(-1, 1, 0, 0, 5, 5, hex('#d23a2e')); put(-1, 1, 5, WH); put(1, -1, 5, WH); put(0, 0, 5, WH); } });
  const torso = sk === 'manoel' ? vxPart('torManoel' + SKN.join('.'), (b, put) => { const BK = hex('#1c1c1f'), BK2 = hex('#141416'), LF = hex('#3fae3a'), LF2 = hex('#2f8a2c');
    b(-3, 3, 0, 6, -1, 1, (x, y) => y === 0 ? BK2 : BK); b(-1, 1, 6, 6, 1, 1, SKN); put(0, 5, 1, SKN); b(-1, 1, 7, 7, -1, 1, SKN);
    const leaf = ['...X...', 'X.XXX.X', '.XXXXX.', '..XXX..', '...X...'];   // folha estampada no peito
    leaf.forEach((row, i) => [...row].forEach((ch, j) => { if (ch === 'X') put(j - 3, 5 - i, 1, i === 4 ? LF2 : LF); }));
  }) : vxPart('tor' + kS, (b, put) => { b(-3, 3, 0, 6, -1, 1, (x, y) => y === 0 ? SH2 : SH); b(-1, 1, 6, 6, 1, 1, SKN); put(0, 5, 1, SKN); b(-1, 1, 7, 7, -1, 1, SKN); });
  const head = sk === 'manoel' ? vxPart('hdManoel', (b, put) => {   // Manoel: rosto largo, olhos apertados de sorriso, sorrisão com dentes, barba rala, cabelo curto penteado para trás
    const MS = hex('#d8ab92'), MS2 = hex('#c39479'), BEARD = hex('#8a6e5e'), HB = hex('#2b211b'), HB2 = hex('#3d3027');
    b(-3, 3, 0, 7, -3, 3, MS); b(-4, -4, 0, 5, -2, 2, MS); b(4, 4, 0, 5, -2, 2, MS);    // rosto largo
    b(-3, 3, -1, -1, -2, 2, MS); b(-5, -5, 2, 4, -1, 0, MS2); b(5, 5, 2, 4, -1, 0, MS2);
    b(-3, 3, -1, -1, 1, 3, BEARD); b(-4, -4, -1, 1, 0, 2, BEARD); b(4, 4, -1, 1, 0, 2, BEARD); b(-2, 2, 0, 0, 3, 3, BEARD); put(-1, 2, 3, BEARD); put(1, 2, 3, BEARD);   // barba rala
    for (const ex of [-2, 1]) { b(ex, ex + 1, 4, 4, 3, 3, hex('#3a2a22')); b(ex, ex + 1, 3, 3, 3, 3, MS2); b(ex - (ex < 0 ? 1 : 0), ex + 1 + (ex > 0 ? 1 : 0), 5, 5, 3, 3, HB); }   // olhos apertados + sobrancelhas grossas
    b(-1, 1, 3, 3, 4, 4, MS); put(0, 4, 4, MS); b(-1, 1, 2, 2, 4, 4, MS2);               // nariz largo
    b(-2, 2, 1, 1, 3, 3, hex('#f0ebe0')); put(-3, 1, 3, hex('#b77a6d')); put(3, 2, 3, hex('#b77a6d')); b(-2, 2, 2, 2, 3, 3, hex('#b77a6d'));   // sorrisão com dentes (um canto mais alto)
    // cabelo curto penteado para trás, entradas nas têmporas
    b(-3, 3, 8, 8, -3, 3, HB); b(-2, 2, 9, 9, -3, 2, HB2); b(-1, 3, 7, 7, 3, 3, HB); b(-2, 3, 8, 8, 4, 4, HB);
    b(-4, -4, 5, 8, -3, 0, HB); b(4, 4, 5, 8, -3, 0, HB); b(-3, 3, 3, 8, -4, -4, HB);
  }) : sk === 'miguel' ? vxPart('hdMiguel', (b, put) => {   // Miguel: rosto largo, barba rala, sobrancelhas grossas, olhos claros com o esquerdo (da foto) caído, cabelo curto degradê
    const MS = hex('#c99878'), MS2 = hex('#b48467'), BEARD = hex('#8f6d58'), HB = hex('#2a201a'), HB2 = hex('#4a3a30'), EY = hex('#2a1a12');
    b(-3, 3, 0, 7, -3, 3, MS); b(-4, -4, 1, 4, -2, 2, MS); b(4, 4, 1, 4, -2, 2, MS);    // rosto largo, bochechas cheias
    b(-3, 3, -1, -1, -2, 2, MS); b(-5, -5, 2, 4, -1, 0, MS2); b(5, 5, 2, 4, -1, 0, MS2);   // queixo largo + orelhas
    b(-3, 3, -1, 0, 3, 3, BEARD); b(-4, -4, 0, 2, 1, 2, BEARD); b(4, 4, 0, 2, 1, 2, BEARD); b(-3, 3, -1, -1, 1, 2, BEARD);   // barba rala no queixo e mandíbula
    b(-1, 1, 2, 2, 3, 3, BEARD);                                                          // bigode ralo
    // olhos: o da direita de quem olha (lado esquerdo dele) mais caído e meio fechado
    put(-2, 4, 3, hex('#efe6dc')); put(-1, 4, 3, EY); b(-2, -1, 5, 5, 3, 3, MS2);
    put(1, 3, 3, EY); put(2, 3, 3, hex('#efe6dc')); b(1, 2, 4, 5, 3, 3, MS2);
    b(-3, -1, 6, 6, 3, 3, HB); b(1, 3, 6, 6, 3, 3, HB);                                   // sobrancelhas grossas
    b(-1, 1, 3, 3, 4, 4, MS); put(0, 4, 4, MS); b(-1, 1, 2, 2, 4, 4, MS2);               // nariz largo
    b(-1, 1, 1, 1, 3, 3, hex('#a8706a'));                                                 // lábios cheios fechados
    // cabelo curto: um pouco mais alto em cima, degradê nas laterais
    // cabelo crespo curtinho em cima (bolinhas de cacho), degradê baixo nas laterais e nuca, contorno reto na testa
    const FADE = hex('#7a6252'), FADE2 = hex('#5a463a');
    b(-3, 3, 8, 8, -3, 3, HB); b(-3, 3, 7, 7, 3, 3, HB);
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if ((x * 5 + z * 3 + 7) % 3) put(x, 9, z, (x + z) % 2 ? HB : hex('#1d1612'));   // textura de cachos
    for (const [x, z] of [[-2, -2], [0, 1], [2, -1], [-1, 3], [1, -3], [3, 2]]) put(x, 10, z, HB);
    b(-4, -4, 7, 8, -3, 2, HB); b(4, 4, 7, 8, -3, 2, HB); b(-3, 3, 7, 8, -4, -4, HB);
    b(-4, -4, 5, 6, -3, 1, FADE2); b(4, 4, 5, 6, -3, 1, FADE2); b(-3, 3, 5, 6, -4, -4, FADE2);   // degradê
    b(-4, -4, 3, 4, -3, 0, FADE); b(4, 4, 3, 4, -3, 0, FADE); b(-3, 3, 2, 4, -4, -4, FADE);
  }) : sk === 'carlos' ? vxPart('hdCarlos', (b, put) => {   // Carlos: rosto redondo e cheio, orelhas de abano, olhos meio fechados, sobrancelhas grossas, franja bagunçada caída na testa
    const CS = hex('#d9a684'), CS2 = hex('#c48f6d'), EAR = hex('#d98a72'), HB = hex('#3b2a20'), HB2 = hex('#4e3828');
    b(-3, 3, 0, 7, -3, 3, CS); b(-4, -4, 1, 4, -2, 2, CS); b(4, 4, 1, 4, -2, 2, CS);   // bochechas cheias
    b(-2, 2, -1, -1, -2, 2, CS);                                                        // queixo redondo
    b(-5, -5, 2, 5, -1, 0, EAR); b(5, 5, 2, 5, -1, 0, EAR); put(-5, 3, 1, EAR); put(5, 3, 1, EAR);   // orelhas de abano
    for (const ex of [-2, 1]) { b(ex, ex + 1, 4, 4, 3, 3, CS2); put(ex + (ex < 0 ? 0 : 1), 3, 3, PU); put(ex + (ex < 0 ? 1 : 0), 3, 3, hex('#f1e7dc'));   // olhos meio fechados (pálpebra pesada)
      b(ex - (ex < 0 ? 1 : 0), ex + 1 + (ex > 0 ? 1 : 0), 5, 5, 3, 3, HB); }              // sobrancelhas grossas e retas
    b(-1, 1, 2, 2, 4, 4, CS2); put(0, 3, 4, CS); put(-1, 2, 3, CS2); put(1, 2, 3, CS2); // nariz largo
    b(-1, 1, 1, 1, 3, 3, hex('#b97568')); put(2, 1, 3, CS2);                           // lábios fechados, sorrisinho de lado
    // cabelo castanho-escuro bagunçado com franja caindo de lado na testa
    b(-4, 4, 7, 9, -4, 3, (x, y, z) => (x * 3 + y + z * 2) % 4 ? HB : HB2);
    b(-4, -4, 3, 6, -4, 1, HB); b(4, 4, 4, 6, -4, 1, HB); b(-3, 3, 2, 6, -4, -4, HB);
    for (const [x0, x1, y] of [[-3, 2, 6], [-1, 3, 5.5], [0, 2, 5]]) b(x0, x1, Math.floor(y), Math.floor(y), 3, 4, HB);   // franja
    for (const [x, y, z] of [[-3, 10, 0], [-1, 10, 1], [2, 10, -1], [3, 9, 3], [-4, 9, 2], [1, 10, -3]]) put(x, y, z, HB2);   // fios soltos
  }) : sk === 'kiko' ? vxPart('hdKiko', (b, put) => {   // Kiko: testa alta enrugada, olhos arregalados, nariz marcado, boca aberta mostrando os dentes, cabelo escuro volumoso
    const KS = hex('#d6a17c'), KS2 = hex('#c08a66'), KS3 = hex('#b07a58');
    b(-3, 3, 0, 9, -3, 3, KS); b(-2, 2, -1, -1, -2, 2, KS);                    // cabeça alongada + queixo fino
    b(-4, -4, 2, 4, -1, 0, KS2); b(4, 4, 2, 4, -1, 0, KS2);                     // orelhas
    for (const y of [7, 8]) b(-2, 2, y, y, 3, 3, (x) => (x + y) % 2 ? KS3 : KS2);   // rugas da testa
    for (const ex of [-3, 1]) { b(ex, ex + 1, 3, 4, 3, 3, WH); put(ex + (ex < 0 ? 1 : 0), 3, 4, hex('#5d6a74')); put(ex + (ex < 0 ? 1 : 0), 4, 4, PU);   // olhos arregalados (branco em volta da íris)
      b(ex, ex + 1, 6, 6, 3, 3, BR); }                                           // sobrancelhas levantadas
    b(0, 0, 2, 3, 4, 4, KS2); put(0, 1, 5, KS3);                                // nariz
    b(-1, 1, 0, 0, 3, 3, hex('#7a3a2e')); b(-1, 1, 1, 1, 3, 3, hex('#f2efe6')); put(-2, 1, 3, hex('#7a3a2e')); put(2, 1, 3, hex('#7a3a2e'));   // boca aberta com os dentes
    b(-1, 1, -1, -1, 3, 3, hex('#b8786a'));                                     // lábio de baixo
    // cabelo: volume bagunçado em cima, laterais curtas
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 3; z++) for (let y = 9; y <= 12; y++) { const d = x * x / 18 + (z + 0.5) * (z + 0.5) / 15 + (y - 9.5) * (y - 9.5) / 6; if (d < 1.1 && !(z === 3 && y < 10) && ((x * 5 + y * 7 + z * 3) % 5 !== 0 || d < 0.7)) put(x, y, z, (x + y * 2 + z) % 3 ? HR : shade(HR, 1.3)); }
    b(-4, -4, 5, 9, -3, 1, HR); b(4, 4, 5, 9, -3, 1, HR); b(-3, 3, 3, 9, -4, -4, HR);
  }) : vxPart('hd' + style + sk + SKN.join('.'), (b, put) => {
    b(-3, 3, 0, 6 + F, -3, 3, SKN); b(-4, -4, 2, 3, -1, 0, SK2); b(4, 4, 2, 3, -1, 0, SK2);
    for (const ex of [-2, 1]) { const droop = sk === 'miguel' && ex < 0 ? 1 : 0; put(ex, 3 - droop, 3, WH); put(ex + 1, 3 - droop, 3, PU); b(ex, ex + 1, 4, 4, 3, 3, droop ? SK2 : BR); }
    put(0, 2, 4, SK2); b(-1, 1, 1, 1, 3, 3, MO);
    if (F) b(-2, 2, 6, 6, 3, 3, shade(SKN, 0.9));
    const y = F;
    if (style === 0) { b(-3, 3, 6 + y, 7 + y, -3, 3, HR); b(-3, 3, 4 + y, 5 + y, -3, -3, HR); b(-4, -4, 4 + y, 6 + y, -3, 2, HR); b(4, 4, 4 + y, 6 + y, -3, 2, HR); b(-3, 3, 5 + y, 5 + y, 3, 3, HR); }
    if (style === 1) { const CP = hex('#c23a2a'); b(-4, 4, 6, 8, -4, 3, CP); b(-3, 3, 6, 6, 4, 6, CP); b(-4, -4, 3, 5, -3, 1, HR); b(4, 4, 3, 5, -3, 1, HR); put(0, 8, -1, WH); }
    if (style === 2) for (let x = -4; x <= 4; x++) for (let z = -4; z <= 3; z++) for (let yy = 5; yy <= 9; yy++) { const d = x * x / 20 + (z + 0.5) * (z + 0.5) / 16 + (yy - 6) * (yy - 6) / 10; if (d < 1.15 && !(z === 3 && yy < 6) && ((x * 7 + yy * 3 + z * 5) % 4 !== 0 || d < 0.8)) put(x, yy, z, (x + yy + z) % 3 ? HR : shade(HR, 1.25)); }
  });
  const uArm = vxPart('ua' + (sk === 'manoel' ? 'M' : '') + kS, b => { b(-1, 0, -2, 0, -1, 1, sk === 'manoel' ? hex('#141416') : SH2); b(-1, 0, -4, -3, -1, 1, SKN); });
  const fArm = vxPart('fa' + SKN.join('.'), b => { b(-1, 0, -4, -1, -1, 0, SKN); b(-1, 0, -5, -5, -1, 0, SK2); });
  const fArmGun = vxPart('fg' + SKN.join('.'), b => { b(-1, 0, -4, -1, -1, 0, SKN); b(-1, 0, -5, -5, -1, 0, SK2); b(-1, 0, -11, -6, 0, 0, hex('#26282c')); b(-1, 0, -7, -6, 1, 2, hex('#3a3d42')); b(-1, 0, -11, -11, -1, -1, hex('#e8e4d6')); });
  const fArmBib = vxPart('fb' + SKN.join('.'), (b, put) => { b(-1, 0, -4, -1, -1, 0, SKN); b(-1, 0, -5, -5, -1, 0, SK2);
    b(-3, 1, -9, -4, 1, 1, hex('#1c1714')); b(-3, 1, -9, -4, 2, 2, hex('#f1ead6')); b(-3, 1, -9, -4, 3, 3, hex('#1c1714')); b(-1, -1, -8, -5, 4, 4, hex('#d8b24a')); b(-2, 0, -7, -7, 4, 4, hex('#d8b24a')); put(-2, -3, 2, hex('#a3262a')); });
  const thigh = vxPart('th', b => b(-1, 1, -6, -1, -1, 1, (x, y, z) => x === 0 && z === 1 ? JE2 : JE));
  const shin = vxPart('sh', b => b(-1, 1, -3, -1, -1, 1, (x, y) => y === -3 ? JE2 : JE));
  const foot = vxPart('ft', b => { b(-1, 1, -3, -3, -2, 3, hex('#3a3a3a')); b(-1, 1, -2, -1, -1, 3, (x, y, z) => z === 3 && y === -1 ? hex('#c8c8c8') : SHOE); });
  // animação
  const t = performance.now() / 1000, w = p.sit ? 0 : Math.min(1, (p.speed || 0) / 3), ph = p.walk || 0, s_ = Math.sin(ph), c_ = Math.cos(ph), br = Math.sin(t * 1.8 + (p.x || 0)) * (1 - w);
  const bob = w * (-0.55 + 0.55 * Math.abs(c_)) + br * 0.08;
  const root = { R: vMM(vRy(w * s_ * 0.12), vRz(w * c_ * 0.035)), t: [0, 12 + bob, 0] };
  const out = [[pelvis, root]];
  const tor = vX(root, [0, 3, 0], vMM(vRy(-w * s_ * 0.22), vRx(-0.06 * w + br * 0.015)));
  out.push([torso, tor]);
  const hd = vX(tor, [0, 8, 0], vMM(vRy(w * s_ * 0.12), vRx(0.04 * w * Math.abs(c_) - br * 0.02)));
  if (sk === 'carlos') hd.R = hd.R.map(v => v * 2);
  out.push([head, hd]);
  for (const sd of [-1, 1]) {   // sd = +1: lado esquerdo do personagem (x+)
    const q = sd < 0 ? ph : ph + Math.PI, ls = Math.sin(q);
    let hip, knee, ank;
    if (p.sit) { hip = Math.PI / 2; knee = Math.PI / 2; ank = 0; }
    else { hip = w * ls * 0.48; knee = w * (0.08 + 0.75 * Math.max(0, -Math.sin(q - 0.5)) ** 1.4) + (1 - w) * 0.03; ank = knee - hip + w * 0.18 * Math.max(0, Math.cos(q)); }
    const th = vX(root, [sd * 2, 0, 0], vRx(hip)), shn = vX(th, [0, -6, 0], vRx(-knee)), ft = vX(shn, [0, -3, 0], vRx(p.sit ? 0 : ank));
    out.push([thigh, th], [shin, shn], [foot, ft]);
    const armed = p.gun !== undefined && sd < 0, bib = sk === 'biblia' && sd > 0;
    let sw = -w * ls * 0.5 + br * 0.03 * sd, el = 0.18 + w * (0.25 + 0.3 * Math.max(0, -ls));
    if (p.sit) { sw = 0.35; el = 0.6; }
    if (armed) { sw = Math.PI / 2 + p.gun; el = 0; }
    if (bib) { sw = 0.45 + br * 0.02; el = 1.25; }
    const ua = vX(tor, [sd * 4.5, 6, 0], vMM(vRx(sw), vRz(sd * (armed ? 0 : 0.06 + 0.02 * br))));
    const fa = vX(ua, [0, -4.5, 0], vRx(el));
    const off = M => ({ R: M.R, t: vMV(M.R, [0.5, 0, 0]).map((x, i) => x + M.t[i]) });
    out.push([uArm, off(ua)], [armed ? fArmGun : bib ? fArmBib : fArm, off(fa)]);
  }
  const T = scaleT(frame(p.x, p.sit ? p.sit.y - 0.755 * PSC : surfAt(p.x, p.z) + 0.02, p.z, p.a), PSC);
  vxDraw(B, T, out);
}
function buildPlayer(B, p, look) {
  p = p || player; look = look || { shirt: SHIRT, car: PCAR };
  const SHIRT_ = look.shirt, CAR_ = look.car;
  if (p.car) { carMesh(B, groundFrame(p.x, p.z, p.a, 0.0), CAR_); return; }
  const sk = skinOf(p === player ? player.n : p.n), SKN = sk === 'miguel' ? hex('#c99878') : sk === 'kiko' ? hex('#d6a17c') : sk === 'carlos' ? hex('#d9a684') : sk === 'manoel' ? hex('#d8ab92') : SKIN;
  if (p === player || Math.hypot(p.x - player.x, p.z - player.z) < 45) { buildPlayerVox(B, p, look, sk, SKN); return; }   // perto: modelo detalhado; longe: o simples
  const T = scaleT(frame(p.x, p.sit ? p.sit.y - 0.75 * PSC : surfAt(p.x, p.z) + 0.02, p.z, p.a), PSC);
  const sw = p.sit ? 0 : Math.sin(p.walk) * 0.7 * Math.min(1, p.speed / 3);
  const bob = Math.abs(Math.cos(p.walk)) * 0.06 * Math.min(1, p.speed / 3);
  const Tb = { o: [T.o[0], T.o[1] + bob, T.o[2]], ax: T.ax, ay: T.ay, az: T.az };
  // legs
  if (p.sit) for (const v of [-0.17, 0.17]) {   // sentado: coxa para a frente, canela para baixo
    box(B, Tb, -0.12, 0.42, 0.75, 0.97, v - 0.11, v + 0.11, SHORTS, SHORTS);
    box(B, Tb, 0.26, 0.48, 0.38, 0.86, v - 0.11, v + 0.11, SHORTS, SHORTS);
    box(B, Tb, 0.255, 0.485, 0.38, 0.46, v - 0.115, v + 0.115, hex('#1f3a6e'), hex('#1f3a6e'));
    box(B, Tb, 0.25, 0.6, 0.28, 0.4, v - 0.12, v + 0.12, SHOE, SHOE);
  } else
  for (const [v, ph] of [[-0.17, sw], [0.17, -sw]]) {
    const L = swing(Tb, 0, 0.85, v, ph);
    box(B, L, -0.12, 0.12, -0.78, 0.02, -0.11, 0.11, SHORTS, SHORTS);      // calça até o tornozelo
    box(B, L, -0.125, 0.125, -0.78, -0.7, -0.115, 0.115, hex('#1f3a6e'), hex('#1f3a6e')); // barra da calça
    box(B, L, -0.13, 0.22, -0.88, -0.76, -0.12, 0.12, SHOE, SHOE);
  }
  box(B, Tb, -0.18, 0.18, 0.8, 1.45, -0.3, 0.3, SHIRT_, SHIRT_);
  box(B, Tb, 0.181, 0.19, 1.05, 1.3, -0.12, 0.12, SHIRT2, SHIRT2);
  for (const [v, ph] of [[-0.39, -sw], [0.39, sw]]) {
    const armed = p.gun !== undefined && v > 0;   // pegador: braço direito aponta para a mira com a arma
    const bib = sk === 'biblia' && v < 0;   // Bruno / Mendes: bíblia na mão esquerda, junto ao peito
    const A = swing(Tb, 0, 1.42, v, armed ? Math.PI / 2 + p.gun : bib ? 0.85 + ph * 0.1 : ph * 0.9);
    box(B, A, -0.09, 0.09, -0.3, 0.03, -0.09, 0.09, SHIRT_, SHIRT_);
    box(B, A, -0.08, 0.08, -0.62, -0.3, -0.08, 0.08, SKN, SKN);
    if (bib) {
      const BK = hex('#1c1714'), BK2 = hex('#2a211c'), PG = hex('#f1ead6'), GD = hex('#d8b24a');
      box(B, A, -0.04, 0.26, -0.78, -0.42, 0.06, 0.15, BK, BK2);                 // capa
      box(B, A, -0.03, 0.25, -0.77, -0.43, 0.075, 0.135, PG, PG);                 // folhas
      box(B, A, 0.255, 0.265, -0.75, -0.45, 0.065, 0.145, BK, BK);
      box(B, A, 0.08, 0.14, -0.7, -0.5, 0.151, 0.156, GD, GD); box(B, A, 0.03, 0.19, -0.58, -0.55, 0.151, 0.156, GD, GD);   // cruz dourada
      box(B, A, 0.1, 0.12, -0.42, -0.36, 0.1, 0.11, hex('#a3262a'), hex('#a3262a'));   // marcador de fita
    }
    if (armed) {
      const G = hex('#26282c'), G2 = hex('#3a3d42');
      box(B, A, -0.06, 0.06, -0.98, -0.58, -0.045, 0.045, G, G2);      // cano/ferrolho
      box(B, A, -0.24, -0.04, -0.72, -0.6, -0.04, 0.04, G2, G);        // cabo
      box(B, A, -0.1, -0.05, -0.8, -0.74, -0.015, 0.015, G, G);        // gatilho
      box(B, A, 0.06, 0.08, -0.95, -0.9, -0.012, 0.012, hex('#e8e4d6'), hex('#e8e4d6')); // mira
    }
  }
  // cabeça (medidas a partir do pescoço, y = 1.47)
  const hs = sk === 'carlos' ? 2 : 1, Th = { o: P(Tb, 0, 1.47, 0), ax: Tb.ax.map(v => v * hs), ay: Tb.ay.map(v => v * hs), az: Tb.az.map(v => v * hs) };
  const fh = sk === 'kiko' ? 0.26 : 0;   // Kiko: testa grande
  box(B, Th, -0.2, 0.2, 0, 0.4 + fh, -0.2, 0.2, SKN, SKN);
  box(B, Th, -0.23, 0.17 - fh * 0.6, 0.33 + fh, 0.48 + fh, -0.22, 0.22, HAIR, HAIR);
  box(B, Th, -0.23, -0.1, 0.08, 0.38 + fh, -0.22, 0.22, HAIR, HAIR);
  box(B, Th, 0.2, 0.21, 0.19, 0.25, -0.12, -0.05, HAIR, HAIR); // olhos
  if (sk === 'miguel') { box(B, Th, 0.2, 0.21, 0.135, 0.18, 0.05, 0.12, HAIR, HAIR); box(B, Th, 0.2, 0.212, 0.18, 0.205, 0.04, 0.13, SKN, hex('#5a3622')); }   // olho direito caído, com pálpebra pesada
  else box(B, Th, 0.2, 0.21, 0.19, 0.25, 0.05, 0.12, HAIR, HAIR);
  if (sk === 'kiko') box(B, Th, 0.2, 0.205, 0.33, 0.36, -0.14, 0.14, hex('#c99a74'), hex('#c99a74'));   // ruguinha da testa
  if (sk === 'manoel') {   // cogumelo saindo da calça
    box(B, Tb, 0.11, 0.25, 0.79, 0.85, -0.035, 0.035, hex('#efe6d2'), hex('#ded3bb'));            // talo
    box(B, Tb, 0.23, 0.33, 0.73, 0.91, -0.1, 0.1, hex('#d23a2e'), hex('#b52f25'));                 // chapéu vermelho
    box(B, Tb, 0.25, 0.31, 0.76, 0.88, -0.11, 0.11, hex('#d23a2e'), hex('#b52f25'));
    for (const [y, v] of [[0.86, -0.05], [0.78, 0.04], [0.83, 0.07], [0.76, -0.07]]) box(B, Tb, 0.332, 0.336, y - 0.02, y + 0.02, v - 0.02, v + 0.02, hex('#ffffff'), hex('#ffffff'));   // bolinhas brancas
  }
}

const P_SKIN = hex('#a8754f'), P_SHIRT = hex('#5f6d80'), P_PANTS = hex('#30343c'), P_CAP = hex('#24365e'), P_HAIR = hex('#b9b4ac'), P_SHOE = hex('#2a2420');
const C_SKIN = hex('#b07a50'), C_SHORTS = hex('#1d4f9c'), C_HAIR = hex('#17110c'), C_SLIP = hex('#f2f2f2'), C_DARK = hex('#120d0a');
function buildCaudinho(B, n, t) {
  const T = scaleT(frame(n.x, n.y, n.z, n.base), PSC);
  const br = Math.sin(t * 2.2) * 0.015; // breathing hard, irritated
  const Tb = { o: [T.o[0], T.o[1] + br, T.o[2]], ax: T.ax, ay: T.ay, az: T.az };
  for (const v of [-0.16, 0.16]) {
    box(B, Tb, -0.11, 0.11, 0.05, 0.55, v - 0.1, v + 0.1, C_SKIN, C_SKIN);          // shins
    box(B, Tb, -0.13, 0.13, 0.5, 0.95, v - 0.13, v + 0.13, C_SHORTS, C_SHORTS);    // shorts
    box(B, Tb, -0.13, 0.24, 0.0, 0.05, v - 0.12, v + 0.12, C_SLIP, C_SLIP);        // chinelo
  }
  box(B, Tb, -0.14, 0.14, 0.9, 0.98, -0.3, 0.3, hex('#f2f2f2'), hex('#f2f2f2'));   // elastic of the shorts
  box(B, Tb, -0.19, 0.19, 0.95, 1.5, -0.32, 0.32, C_SKIN, C_SKIN);                // bare torso
  box(B, Tb, 0.19, 0.2, 1.22, 1.3, -0.2, -0.05, hex('#9a6a44'), hex('#9a6a44'));   // chest shading
  box(B, Tb, 0.19, 0.2, 1.22, 1.3, 0.05, 0.2, hex('#9a6a44'), hex('#9a6a44'));
  box(B, Tb, 0.19, 0.2, 1.02, 1.14, -0.03, 0.03, hex('#9a6a44'), hex('#9a6a44'));
  // arms crossed over the chest
  for (const sg of [-1, 1]) {
    box(B, Tb, -0.08, 0.1, 1.05, 1.47, sg * 0.32 - 0.09, sg * 0.32 + 0.09, C_SKIN, C_SKIN);
    box(B, Tb, 0.2, 0.36, 1.18 + (sg > 0 ? 0.09 : 0), 1.32 + (sg > 0 ? 0.09 : 0), -0.3, 0.3, C_SKIN, C_SKIN);
  }
  const H = yawChild(Tb, 0, 0, 0, n.look);
  box(B, H, -0.08, 0.08, 1.48, 1.56, -0.08, 0.08, C_SKIN, C_SKIN);                // neck
  box(B, H, -0.2, 0.2, 1.55, 1.95, -0.2, 0.2, C_SKIN, C_SKIN);
  box(B, H, -0.22, 0.17, 1.86, 2.0, -0.22, 0.22, C_HAIR, C_HAIR);                 // short hair
  box(B, H, -0.22, -0.12, 1.62, 1.95, -0.22, 0.22, C_HAIR, C_HAIR);
  // angry face: slanted brows, narrow eyes, frown
  const f = 0.2;
  B.quad(P(H, f + 0.01, 1.83, -0.15), P(H, f + 0.01, 1.83, -0.04), P(H, f + 0.01, 1.78, -0.03), P(H, f + 0.01, 1.86, -0.15), N(H, 1, 0, 0), C_DARK, F_PLAIN);
  B.quad(P(H, f + 0.01, 1.83, 0.15), P(H, f + 0.01, 1.86, 0.15), P(H, f + 0.01, 1.78, 0.03), P(H, f + 0.01, 1.83, 0.04), N(H, 1, 0, 0), C_DARK, F_PLAIN);
  box(B, H, f, f + 0.01, 1.72, 1.755, -0.13, -0.05, C_DARK, C_DARK);
  box(B, H, f, f + 0.01, 1.72, 1.755, 0.05, 0.13, C_DARK, C_DARK);
  box(B, H, f, f + 0.01, 1.62, 1.645, -0.07, 0.07, hex('#5a2a1e'), hex('#5a2a1e')); // mouth
  box(B, H, f, f + 0.01, 1.6, 1.625, -0.1, -0.07, hex('#5a2a1e'), hex('#5a2a1e'));
  box(B, H, f, f + 0.01, 1.6, 1.625, 0.07, 0.1, hex('#5a2a1e'), hex('#5a2a1e'));
}
// ---------------- cachorros ----------------
const DOGDEF = {
  pitbull:     { L: 0.78, W: 0.34, lh: 0.32, bh: 0.3, s: 1.0, body: '#c08a52', dark: '#a8743f', spd: 1.5 },
  bull:        { L: 0.74, W: 0.3, lh: 0.33, bh: 0.28, s: 1.0, body: '#f1ece4', dark: '#e2dbd0', spd: 1.4 },
  yorkie:      { L: 0.44, W: 0.2, lh: 0.14, bh: 0.19, s: 1.0, body: '#1f1c1e', dark: '#141214', spd: 1.9 },
  yorkieRoupa: { L: 0.44, W: 0.21, lh: 0.14, bh: 0.2, s: 1.0, body: '#cfe6f0', dark: '#b9d6e2', spd: 1.7 },
  beagle:      { L: 0.62, W: 0.27, lh: 0.24, bh: 0.26, s: 1.0, body: '#f3eee6', dark: '#e4ddd1', spd: 1.1 },
  golden:      { L: 0.82, W: 0.34, lh: 0.33, bh: 0.31, s: 1.0, body: '#d9a04e', dark: '#c48a3c', spd: 1.3 },
  labrador:    { L: 0.8, W: 0.33, lh: 0.33, bh: 0.3, s: 1.0, body: '#ecd7a8', dark: '#dcc490', spd: 1.3 },
  pastor:      { L: 0.86, W: 0.32, lh: 0.36, bh: 0.3, s: 1.0, body: '#b9783a', dark: '#a5682f', spd: 1.5 },
};
function buildDog(B, d, t) {
  const D = DOGDEF[d.kind], y0 = surfAt(d.x, d.z) + 0.02, T = frame(d.x, y0, d.z, d.a);
  const { L, W, lh, bh } = D, BODY = hex(D.body), DARK = hex(D.dark);
  const walk = Math.min(1, d.spd / 0.6), sw = Math.sin(d.ph) * 0.55 * walk;
  const TAN = hex('#b5702c'), TAN2 = hex('#a3612a'), WHITE = hex('#f3efe8'), PINK = hex('#e8a2a8'), NOSE = hex('#151313'), EYE = hex('#1a1414');
  // pernas (balançam ao andar)
  const legC = (front) => d.kind === 'pitbull' ? [front ? WHITE : BODY, WHITE] : (d.kind === 'bull' || d.kind === 'beagle' || d.kind === 'labrador' || d.kind === 'golden') ? [BODY, BODY] : [TAN, TAN];
  for (const [lu, lv, ph] of [[L * 0.36, -W * 0.3, sw], [L * 0.36, W * 0.3, -sw], [-L * 0.36, -W * 0.3, -sw], [-L * 0.36, W * 0.3, sw]]) {
    const thump = d.thump && lu < 0 && lv > 0, A = swing(T, lu, lh, lv, thump ? -0.5 + Math.sin(t * 32) * 0.55 : ph), lw = W * 0.17, [c1, c2] = legC(lu > 0);   // beagle: pata de trás batendo no chão
    box(B, A, -lw, lw, -lh, 0, -lw, lw, c1, c1);
    box(B, A, -lw * 1.1, lw * 1.3, -lh, -lh * 0.72, -lw * 1.1, lw * 1.1, c2, c2);   // pata
  }
  // corpo
  const yb = lh + (d.sit ? -lh * 0.4 : 0);
  box(B, T, -L / 2, L / 2, yb, yb + bh, -W / 2, W / 2, BODY, DARK);
  if (d.kind === 'pitbull') { box(B, T, L * 0.1, L / 2 + 0.01, yb - 0.01, yb + bh * 0.75, -W * 0.3, W * 0.3, WHITE, WHITE); box(B, T, -L * 0.2, L * 0.2, yb - 0.012, yb + 0.03, -W * 0.35, W * 0.35, WHITE, WHITE); }
  if (d.kind === 'bull') for (const [pu, pv, py] of [[0.1, W / 2, 0.15], [-0.18, -W / 2, 0.1], [0.22, W / 2, 0.06]]) box(B, T, pu - 0.04, pu + 0.03, yb + py, yb + py + 0.05, pv - 0.005, pv + 0.005, PINK, PINK);
  if (d.kind === 'yorkie') { box(B, T, -L / 2, L / 2, yb - 0.07, yb + 0.02, -W / 2 - 0.02, W / 2 + 0.02, DARK, DARK); box(B, T, L * 0.25, L / 2 + 0.02, yb - 0.04, yb + bh * 0.8, -W / 2 - 0.01, W / 2 + 0.01, TAN, TAN); }   // pelo comprido e peito caramelo
  if (d.kind === 'pastor') {   // capa preta nas costas
    const BK = hex('#1e1b19'), BK2 = hex('#2a2522');
    box(B, T, -L * 0.45, L * 0.32, yb + bh * 0.45, yb + bh + 0.012, -W / 2 - 0.01, W / 2 + 0.01, BK, BK2);
  }
  if (d.kind === 'beagle') {   // manta marrom nas costas e lados, barriga e peito brancos
    const BR = hex('#7a4a2a'), BR2 = hex('#6b3f23');
    box(B, T, -L * 0.42, L * 0.3, yb + bh * 0.35, yb + bh + 0.012, -W / 2 - 0.01, W / 2 + 0.01, BR, BR2);
    box(B, T, -L * 0.5 - 0.005, -L * 0.3, yb + bh * 0.4, yb + bh * 0.9, -W / 2 + 0.03, W / 2 - 0.03, hex('#b9773d'), hex('#a8692f'));   // traseiro caramelo
  }
  if (d.kind === 'yorkieRoupa') { // roupinha azul com estampas rosa e cinza; pernas e rabo marrons
    for (const [pu, pv, c] of [[0.1, W / 2, '#e2a6c4'], [-0.1, W / 2, '#9a9aa4'], [0.05, -W / 2, '#9a9aa4'], [-0.14, -W / 2, '#e2a6c4']]) box(B, T, pu - 0.04, pu + 0.04, yb + 0.07, yb + 0.14, pv - 0.006, pv + 0.006, hex(c), hex(c));
    box(B, T, -L * 0.2, L * 0.1, yb + bh, yb + bh + 0.006, -0.04, 0.04, hex('#e2a6c4'), hex('#e2a6c4'));
    box(B, T, -L / 2 - 0.01, -L * 0.3, yb - 0.04, yb + bh * 0.7, -W / 2 - 0.01, W / 2 + 0.01, TAN2, TAN2); }
  // rabo (abana)
  { const wg = Math.sin(t * 14 + d.ph) * 0.6 * d.wag, up = d.kind === 'pitbull' || d.kind === 'bull' ? 0.5 : 1.1;
    const Tt = { o: P(T, -L / 2, yb + bh * 0.8, 0), ax: N(T, -Math.cos(up) * Math.cos(wg), Math.sin(up), -Math.cos(up) * Math.sin(wg)), ay: T.ay, az: T.az };
    const tl = d.kind.startsWith('yorkie') ? 0.13 : 0.24, tw = d.kind.startsWith('yorkie') ? 0.035 : 0.025, tc = d.kind === 'yorkie' ? BODY : d.kind === 'yorkieRoupa' ? TAN2 : d.kind === 'beagle' ? hex('#7a4a2a') : d.kind === 'pastor' ? hex('#3a2a1e') : BODY;
    beam(B, Tt.o, [Tt.o[0] + Tt.ax[0] * tl, Tt.o[1] + Tt.ax[1] * tl, Tt.o[2] + Tt.ax[2] * tl], tw, tc);
    if (d.kind === 'golden') beam(B, Tt.o, [Tt.o[0] + Tt.ax[0] * tl * 0.9, Tt.o[1] + Tt.ax[1] * tl * 0.9, Tt.o[2] + Tt.ax[2] * tl * 0.9], tw * 2.6, hex('#e6b56a'));   // rabo peludo
    if (d.kind === 'beagle') beam(B, [Tt.o[0] + Tt.ax[0] * tl * 0.75, Tt.o[1] + Tt.ax[1] * tl * 0.75, Tt.o[2] + Tt.ax[2] * tl * 0.75], [Tt.o[0] + Tt.ax[0] * tl * 1.05, Tt.o[1] + Tt.ax[1] * tl * 1.05, Tt.o[2] + Tt.ax[2] * tl * 1.05], tw * 1.2, WHITE); }
  // cabeça (vira um pouco para quem olha)
  const sn = d.sniff ? 0.2 + Math.sin(t * 9) * 0.025 : 0;   // cheirando: cabeça baixa, focinho mexendo
  const H = { o: P(T, L / 2 - 0.02 + sn * 0.3, yb + bh * 0.55 - sn, 0), ax: [0, 0, 0], ay: [0, 1, 0], az: [0, 0, 0] };
  { const ha = d.a + (d.look || 0); H.ax = [Math.cos(ha), 0, Math.sin(ha)]; H.az = [-Math.sin(ha), 0, Math.cos(ha)]; }
  { // auréola dourada flutuando em cima da cabeça
    const small = d.kind.startsWith('yorkie'), up = { beagle: 0.36, pitbull: 0.46, bull: 0.46, labrador: 0.42, pastor: 0.5, golden: 0.43 }[d.kind] || 0.38, R = small ? 0.085 : 0.12, GOLD = [255, 214, 90];
    const c = P(H, small ? 0.06 : 0.1, up + Math.sin(t * 2.4 + d.x) * 0.02, 0); d.hy = c[1]; d.hc = c;
    for (let i = 0; i < 14; i++) { const a0 = i / 14 * Math.PI * 2, a1 = (i + 1) / 14 * Math.PI * 2, p0 = [c[0] + Math.cos(a0) * R, c[1], c[2] + Math.sin(a0) * R], p1 = [c[0] + Math.cos(a1) * R, c[1], c[2] + Math.sin(a1) * R];
      beam(B, p0, p1, 0.016, GOLD, F_GLOW); }
  }
  if (d.kind === 'beagle') {
    const CAR = hex('#c98a4a'), CAR2 = hex('#b47a3e');
    box(B, H, -0.01, 0.17, 0.02, 0.22, -0.1, 0.1, CAR, CAR2);                      // cabeça caramelo
    box(B, H, 0.17, 0.3, 0.02, 0.12, -0.065, 0.065, WHITE, WHITE);                 // focinho branco
    box(B, H, 0.12, 0.172, 0.1, 0.22, -0.022, 0.022, WHITE, WHITE);                // listra branca na testa
    box(B, H, 0.29, 0.315, 0.08, 0.125, -0.03, 0.03, NOSE, NOSE);
    for (const sv of [-1, 1]) {
      box(B, H, 0.165, 0.172, 0.13, 0.16, sv * 0.05 - 0.016, sv * 0.05 + 0.016, EYE, EYE);
      box(B, H, -0.02, 0.09, -0.12, 0.19, sv * 0.1 - 0.008 + sv * 0.012, sv * 0.1 + 0.022 + sv * 0.012, hex('#8a5229'), hex('#7a4824'));   // orelhas compridas caídas
    }
  } else if (d.kind === 'labrador' || d.kind === 'golden') {
    box(B, H, -0.01, 0.2, 0.02, 0.26, -0.12, 0.12, BODY, BODY);                       // cabeça larga
    box(B, H, 0.2, 0.36, 0.02, 0.16, -0.085, 0.085, BODY, DARK);                       // focinho
    box(B, H, 0.355, 0.385, 0.1, 0.16, -0.045, 0.045, hex('#5a3d2b'), hex('#5a3d2b'));   // nariz marrom
    box(B, H, 0.24, 0.34, 0.03, 0.05, -0.06, 0.06, PINK, PINK);
    for (const sv of [-1, 1]) { box(B, H, 0.2, 0.21, 0.17, 0.2, sv * 0.065 - 0.016, sv * 0.065 + 0.016, EYE, EYE);
      box(B, H, 0.0, 0.1, 0.05, 0.24, sv * 0.125 - 0.02, sv * 0.125 + 0.025 * sv, DARK, DARK); }   // orelhas caídas
  } else if (d.kind === 'pastor') {
    const BK = hex('#1e1b19');
    box(B, H, -0.01, 0.18, 0.03, 0.25, -0.1, 0.1, BODY, BODY);
    box(B, H, 0.18, 0.4, 0.03, 0.15, -0.07, 0.07, BK, BK);                            // focinho comprido escuro
    box(B, H, 0.4, 0.425, 0.09, 0.15, -0.035, 0.035, NOSE, NOSE);
    box(B, H, 0.08, 0.18, 0.2, 0.26, -0.06, 0.06, BK, BK);                             // máscara
    for (const sv of [-1, 1]) { box(B, H, 0.17, 0.18, 0.17, 0.2, sv * 0.06 - 0.015, sv * 0.06 + 0.015, EYE, EYE);
      box(B, H, 0.0, 0.09, 0.25, 0.44, sv * 0.07 - 0.03, sv * 0.07 + 0.03, BODY, BODY); box(B, H, 0.088, 0.094, 0.27, 0.42, sv * 0.07 - 0.02, sv * 0.07 + 0.02, BK, BK); }   // orelhas em pé
  } else if (d.kind === 'pitbull') {
    box(B, H, 0, 0.26, 0.02, 0.3, -0.15, 0.15, BODY, BODY);                       // cabeça larga
    box(B, H, 0.24, 0.38, 0.03, 0.17, -0.11, 0.11, WHITE, WHITE);                 // focinho branco
    box(B, H, 0.1, 0.262, 0.17, 0.3, -0.04, 0.04, WHITE, WHITE);                  // faixa branca na testa
    box(B, H, 0.24, 0.36, 0.02, 0.07, -0.12, 0.12, PINK, PINK);                   // beiço rosado
    box(B, H, 0.36, 0.395, 0.12, 0.18, -0.045, 0.045, NOSE, NOSE);
    for (const sv of [-1, 1]) { box(B, H, 0.255, 0.265, 0.19, 0.23, sv * 0.06 - 0.025, sv * 0.06 + 0.025, EYE, EYE); box(B, H, 0.04, 0.14, 0.24, 0.31, sv * 0.15 - 0.02, sv * 0.15 + 0.04 * sv, BODY, hex('#9a6534')); }
  } else if (d.kind === 'bull') {
    box(B, H, 0, 0.2, 0.04, 0.27, -0.11, 0.11, BODY, BODY);                       // cabeça em ovo, longa
    box(B, H, 0.2, 0.34, 0.03, 0.22, -0.085, 0.085, BODY, BODY);
    box(B, H, 0.34, 0.42, 0.03, 0.15, -0.065, 0.065, BODY, BODY);
    box(B, H, 0.42, 0.445, 0.08, 0.14, -0.035, 0.035, NOSE, NOSE);
    box(B, H, 0.3, 0.4, 0.02, 0.05, -0.07, 0.07, PINK, PINK);                     // boca aberta
    for (const sv of [-1, 1]) { box(B, H, 0.2, 0.21, 0.17, 0.2, sv * 0.065 - 0.015, sv * 0.065 + 0.015, EYE, EYE);
      box(B, H, 0.02, 0.09, 0.27, 0.42, sv * 0.07 - 0.03, sv * 0.07 + 0.03, BODY, BODY); box(B, H, 0.088, 0.094, 0.29, 0.4, sv * 0.07 - 0.02, sv * 0.07 + 0.02, PINK, PINK); }   // orelhas em pé, rosadas por dentro
  } else { // yorkshires: cabeça caramelo peluda, orelhinhas, barba
    const HC = d.kind === 'yorkie' ? TAN : TAN2;
    box(B, H, -0.02, 0.16, 0.02, 0.2, -0.09, 0.09, HC, HC);
    box(B, H, 0.0, 0.17, 0.17, 0.25, -0.1, 0.1, hex(d.kind === 'yorkie' ? '#c27d3a' : '#b06c33'), HC);   // topete
    box(B, H, 0.14, 0.24, 0.0, 0.11, -0.055, 0.055, HC, HC);                       // focinho com barba
    box(B, H, 0.235, 0.255, 0.07, 0.11, -0.025, 0.025, NOSE, NOSE);
    for (const sv of [-1, 1]) { box(B, H, 0.16, 0.165, 0.12, 0.15, sv * 0.045 - 0.015, sv * 0.045 + 0.015, EYE, EYE); box(B, H, 0.0, 0.05, 0.22, 0.31, sv * 0.06 - 0.025, sv * 0.06 + 0.025, HC, HC); }
    if (d.kind === 'yorkieRoupa') box(B, H, 0.2, 0.31, -0.02, 0.06, -0.06, 0.06, hex('#3fae5f'), hex('#2f8f4c'));   // brinquedo verde na boca
  }
}
// ---------------- portão da casa 116 + fuga dos yorkshires ----------------
function gateFrame(B, dt) {
  const G = GATE116; if (!G) return;
  const c = G.WP((G.gA + G.gB) / 2, G.BV), pd = Math.hypot(player.x - c[0], player.z - c[1]);
  if (pd < 3.4) { G.target = 1; G.farT = 0; }
  else if (G.target === 1) {
    G.farT += dt;
    const dogInGate = DOGS.some(d => { const dx = d.x - G.T.o[0], dz = d.z - G.T.o[2], v = dx * G.T.az[0] + dz * G.T.az[2]; return Math.abs(v - G.BV) < 1.6 && (d.mode === 'escape' || d.mode === 'enter'); });
    if (G.farT > 5 && pd > 5 && !dogInGate) G.target = 0;
  }
  G.open += Math.max(-dt * 0.55, Math.min(dt * 0.55, G.target - G.open));
  if (!G.fired && G.open > 0.55) { G.fired = true; yorkieEscape(); }
  // painel do portão
  const T = G.T, s = G.open * (G.gB - G.gA - 0.15), a = G.gA - s, b = G.gB - s, BV = G.BV, HC = G.HC;
  box(B, T, a, b, -0.1, HC - 0.13, BV - 0.06, BV + 0.06, hex('#d8d6ce'), hex('#cfcdc5'));
  for (let u = a + 0.08; u < b - 0.04; u += 0.14) box(B, T, u, u + 0.04, 0.05, HC - 0.18, BV - 0.085, BV - 0.06, hex('#bfbdb5'), hex('#bfbdb5'));
  box(B, T, a, b, -0.1, 0.45, BV - 0.09, BV - 0.06, hex('#a3a199'), hex('#a3a199'));
  // puxador do lado esquerdo (de quem olha da rua)
  beam(B, P(T, b - 0.3, 1.0, BV - 0.13), P(T, b - 0.3, 1.45, BV - 0.13), 0.035, hex('#5f5f5f'));
  for (const y of [1.0, 1.45]) beam(B, P(T, b - 0.3, y, BV - 0.13), P(T, b - 0.3, y, BV - 0.06), 0.03, hex('#5f5f5f'));
  box(B, T, a + 0.05, a + 0.2, -0.1, 0.0, BV - 0.04, BV + 0.04, hex('#3a3a3a'), hex('#3a3a3a'));   // rodinha
  box(B, T, b - 0.2, b - 0.05, -0.1, 0.0, BV - 0.04, BV + 0.04, hex('#3a3a3a'), hex('#3a3a3a'));
}
function blockLoop(G) {   // volta no quarteirão pelas calçadas, mantendo o quarteirão da casa sempre do mesmo lado
  const Gr = roadGraph(), out = G.WP((G.gA + G.gB) / 2, G.MV - 2.5), H = G.WP((G.gA + G.gB) / 2, G.BV + 8);
  let A = null, bd = 1e9; for (const n of Gr) { const d = Math.hypot(n.x - out[0], n.z - out[1]); if (d < bd && n.e.length) { bd = d; A = n; } }
  if (!A) return [];
  const crs = (ax, az, bx, bz) => ax * bz - az * bx;
  let first = null, sideSign = 1;
  for (const e of A.e) { const cr = crs(e.n.x - A.x, e.n.z - A.z, H[0] - A.x, H[1] - A.z); if (!first || Math.abs(cr) > Math.abs(first.cr)) first = { e, cr }; }
  sideSign = Math.sign(first.cr) || 1;
  const nodes = [A]; let prev = A, cur = first.e.n, len = first.e.L;
  for (let it = 0; it < 80 && cur !== A && len < 1600; it++) {
    nodes.push(cur);
    const ain = Math.atan2(cur.z - prev.z, cur.x - prev.x);
    let best = null;
    for (const e of cur.e) {
      if (e.n === prev && cur.e.length > 1) continue;
      let tr = Math.atan2(e.n.z - cur.z, e.n.x - cur.x) - ain; while (tr > Math.PI) tr -= 2 * Math.PI; while (tr <= -Math.PI) tr += 2 * Math.PI;
      const sc = tr * sideSign; if (!best || sc > best.sc) best = { e, sc };
    }
    prev = cur; cur = best.e.n; len += best.e.L;
  }
  if (cur !== A) {   // não fechou a volta: vai e volta pela rua
    const half = nodes.slice(0, Math.min(nodes.length, 6)); nodes.length = 0; nodes.push(...half, ...half.slice(0, -1).reverse());
  } else nodes.push(A);
  const pts = [];
  for (let i = 0; i < nodes.length; i++) {   // pela calçada do lado do quarteirão
    const a = nodes[Math.max(0, i - 1)], b = nodes[Math.min(nodes.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * sideSign, nz = dx / l * sideSign;   // normal apontando para o quarteirão
    pts.push([nodes[i].x + nx * 4.2, nodes[i].z + nz * 4.2]);
  }
  return pts;
}
function yorkieEscape() {
  const G = GATE116, loop = blockLoop(G);
  const cu = (G.gA + G.gB) / 2, inside = G.WP(cu, G.BV + 1.6), gate = G.WP(cu, G.BV), mouth = G.WP(cu, G.MV + 0.2), out = G.WP(cu, G.MV - 2.2);
  let k = 0;
  for (const d of DOGS) {
    if (!d.kind.startsWith('yorkie')) continue;
    const lag = k++ * 1.1, front = G.WP(cu + (k === 1 ? -0.6 : 0.6), G.MV - 1.2);
    d.mode = 'escape'; d.pi = 0; d.delay = 0.3 + lag * 0.5; d.sit = false;
    d.path = [[inside[0], inside[1]], [gate[0], gate[1]], [mouth[0], mouth[1]], [out[0], out[1]], ...loop, [out[0], out[1]], [front[0], front[1]]];
    d.front = front;
  }
}
function dogRun(d, dt, spd) {   // segue d.path; devolve true ao terminar
  if (d.delay > 0) { d.delay -= dt; d.spd = 0; d.wag = 1; return false; }
  const tg = d.path[d.pi]; if (!tg) return true;
  const dx = tg[0] - d.x, dz = tg[1] - d.z, dist = Math.hypot(dx, dz);
  if (dist < 0.35) { d.pi++; return d.pi >= d.path.length; }
  let ta = Math.atan2(dz, dx) - d.a; while (ta > Math.PI) ta -= 2 * Math.PI; while (ta < -Math.PI) ta += 2 * Math.PI;
  d.a += Math.max(-dt * 7, Math.min(dt * 7, ta));
  const st = Math.min(dist, spd * dt * (Math.abs(ta) > 1.2 ? 0.4 : 1));
  d.x += Math.cos(d.a) * st; d.z += Math.sin(d.a) * st; d.spd = spd; d.ph += dt * spd * 22; d.wag = 1;
  return false;
}
// ---------------- fita VHS flutuando na calçada do terreno vazio ao lado da casa 116 ----------------
// fitas VHS: posições no sistema (u, v) do lote da casa 116
const VHS = { open: false, near: false, vis: false, cur: null, tapes: [
  { video: 'm_XQgDBdaG8', u: 19, v: 3.3 },     // calçada em frente ao terreno vazio (muro liso com as mangueiras)
  { video: 'IQjjz3oMf1w', u: 22.6, v: 27.6 },  // dentro do quintal, canto do fundo à esquerda (olhando da rua)
  { video: 'HL8Ucpfu4Fg', start: 174, pos: [-212, 515, 0] },   // no meio da colina, entre as árvores (sul do mapa)
  { video: 'GZI6GsWwDmE', pos: [-392.6, -315.8, 0.18] },   // calçada da Av. Darcy Ribeiro (principal), entrada oeste do bairro
  { video: 'IQjjz3oMf1w', start: 47, pos: (() => { const L = (W.landmarks || []).find(l => l.type === 'baldio'); if (!L) return null; const u = -16, v = 14; return [L.x + L.u[0] * u + L.v[0] * v, L.z + L.u[1] * u + L.v[1] * v, Math.atan2(L.u[1], L.u[0])]; })() },   // terreno baldio, lado direito
  { video: 'FfL2Yv2F4mo', start: 60, pos: BENCH && BENCH.tape },   // ao lado do banco da praça da rotatória
  { video: '437DR4XdGjU', more: ['YVNCtyXO51Q', '4gY35lBxOII'], u: 9, v: 28.15 },   // lista: toca um depois do outro    // no muro do fundo, do lado de dentro, junto da hera
].map(o => Object.assign(o, { pos: o.pos || null, sx: -1e4, sy: -1e4, vis: false, near: false })) };
function vhsPos(o = VHS.tapes[0]) {
  if (o.pos) return o.pos;
  const L = (W.landmarks || []).find(l => l.type === 'casa127'); if (!L) return null;
  const u = o.u, v = o.v;
  return o.pos = [L.x + L.u[0] * u + L.v[0] * v, L.z + L.u[1] * u + L.v[1] * v, Math.atan2(L.u[1], L.u[0])];
}
function vhsFrame(B, t) {
  VHS.near = false;
  for (const o of VHS.tapes) vhsTape(B, t, o);
  if (!VHS.near) VHS.cur = null;
  const btn = document.getElementById('btnVhs'); if (btn) btn.style.display = VHS.near && !VHS.open ? '' : 'none';
}
function vhsTape(B, t, o) {
  const p = vhsPos(o); if (!p) return;
  const [x, z] = p, g = surfAt(x, z), y = g + 1.25 + Math.sin(t * 2) * 0.1, a = t * 0.9;
  if (Math.abs(x - player.x) > 200 || Math.abs(z - player.z) > 200) return;
  const T = frame(x, y, z, a), BLK = hex('#1b1b1e'), BLK2 = hex('#2a2a2e'), WIN = hex('#5a5f66'), SC = 1.45;
  // em pé, deitada na horizontal: comprimento na horizontal, a etiqueta virada para os lados, girando em volta do eixo vertical
  T.ay = [Math.sin(a), 0, -Math.cos(a)]; T.az = [0, 1, 0];
  for (const k of ['ax', 'ay', 'az']) T[k] = T[k].map(v => v * SC);
  box(B, T, -0.235, 0.235, -0.032, 0.032, -0.13, 0.13, BLK2, BLK);                     // corpo da fita (2,5x o tamanho real)
  box(B, T, -0.2, 0.2, 0.032, 0.036, -0.1, 0.02, hex('#f1ede2'), hex('#f1ede2'));        // etiqueta branca
  box(B, T, -0.18, 0.18, 0.036, 0.04, -0.085, -0.06, hex('#d6402f'), hex('#d6402f'));   // faixa vermelha da etiqueta
  for (const u of [-0.11, 0.11]) box(B, T, u - 0.045, u + 0.045, 0.032, 0.036, 0.04, 0.115, WIN, WIN);   // janelinhas dos carretéis
  box(B, T, -0.07, 0.07, 0.032, 0.035, 0.06, 0.1, hex('#3a2a22'), hex('#3a2a22'));      // fita marrom aparecendo
  box(B, T, -0.235, 0.235, -0.03, 0.03, 0.125, 0.135, hex('#111113'), hex('#111113')); // tampa da frente
  box(B, T, -0.2, 0.2, -0.036, -0.032, -0.1, 0.02, hex('#f1ede2'), hex('#f1ede2')); box(B, T, -0.18, 0.18, -0.04, -0.036, -0.085, -0.06, hex('#d6402f'), hex('#d6402f'));   // etiqueta do outro lado
  // brilho no chão pulsando, para chamar atenção (aparece de dia e de noite)
  const k = 0.55 + 0.45 * Math.sin(t * 3), c = [Math.round(90 + 80 * k), Math.round(170 + 70 * k), 255];
  const R0 = 0.7 + 0.08 * k, gy = g + 0.04;
  for (let i = 0; i < 16; i++) {
    const a0 = i / 16 * Math.PI * 2, a1 = (i + 1) / 16 * Math.PI * 2;
    const P0 = (r, aa) => [x + Math.cos(aa) * r, gy, z + Math.sin(aa) * r];
    B.quad(P0(R0, a0), P0(R0, a1), P0(R0 - 0.07, a1), P0(R0 - 0.07, a0), UP, c, F_GLOW);
  }
  o.near = Math.hypot(player.x - x, player.z - z) < 2.8;
  if (o.near) { VHS.near = true; VHS.cur = o; }
}
window.__vhsProj = VP => {   // posição da fita na tela, para o clique/toque
  for (const o of VHS.tapes) {
    const p = vhsPos(o); if (!p) continue;
    const q = xform(VP, [p[0], surfAt(p[0], p[1]) + 1.25, p[1]]);
    o.vis = q[3] > 0 && Math.abs(q[0]) < 1.1 && Math.abs(q[1]) < 1.1 && Math.hypot(p[0] - player.x, p[1] - player.z) < 25;
    o.sx = (q[0] * 0.5 + 0.5) * innerWidth; o.sy = (-q[1] * 0.5 + 0.5) * innerHeight;
  }
  VHS.vis = VHS.tapes.some(o => o.vis);
};
// conquista: fitas encontradas (guardadas no navegador)
const TAPE_KEY = 'mdc_fitas', tapeId = o => o.video + '@' + (o.pos ? Math.round(o.pos[0]) + ',' + Math.round(o.pos[1]) : '');
function tapesFound() { try { return new Set(JSON.parse(localStorage.getItem(TAPE_KEY) || '[]')); } catch (e) { return new Set(VHS.found || []); } }
function tapeFound(o) {
  const f = tapesFound(), id = tapeId(o); if (f.has(id)) return;
  f.add(id); VHS.found = [...f]; try { localStorage.setItem(TAPE_KEY, JSON.stringify(VHS.found)); } catch (e) {}
  const ids = new Set(VHS.tapes.map(tapeId)), x = [...f].filter(k => ids.has(k)).length, y = ids.size;
  const el = document.getElementById('achv'); if (!el) return;
  el.querySelector('.t').textContent = x === y ? 'Todas as fitas encontradas!' : 'Fita encontrada!';
  el.querySelector('.n').textContent = x + '/' + y + ' fitas';
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(VHS.achT); VHS.achT = setTimeout(() => el.classList.remove('on'), 5000);
}
function vhsOpen(o) {
  o = o || VHS.cur || VHS.tapes[0];
  if (VHS.open) return;
  tapeFound(o);
  if (document.pointerLockElement) document.exitPointerLock();
  VHS.open = true; for (const k in keys) keys[k] = false;
  const ov = document.getElementById('vhsOv'), box_ = document.getElementById('vhsTv'), noise = document.getElementById('vhsNoise');
  ov.style.display = 'flex'; box_.innerHTML = ''; noise.style.display = 'block';
  // chiado de TV antiga por meio segundo, depois o vídeo
  const nc = noise.getContext('2d'), img = nc.createImageData(160, 90); let n = 0;
  const tick = () => { if (!VHS.open || n++ > 18) { noise.style.display = 'none'; return; } for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; } nc.putImageData(img, 0, 0); requestAnimationFrame(tick); };
  tick();
  setTimeout(() => { if (!VHS.open) return; const f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + o.video + '?autoplay=1&rel=0&playsinline=1' + (o.start ? '&start=' + o.start : '') + (o.more ? '&playlist=' + [o.video, ...o.more].join(',') : '');
    f.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'; f.allowFullscreen = true; f.title = 'Fita VHS';
    box_.appendChild(f); }, 550);
}
function vhsClose() { VHS.open = false; document.getElementById('vhsOv').style.display = 'none'; document.getElementById('vhsTv').innerHTML = ''; }
document.getElementById('vhsClose').addEventListener('click', vhsClose);
document.getElementById('btnVhs').addEventListener('click', e => { e.stopPropagation(); vhsOpen(VHS.cur); });
document.getElementById('btnVhs').addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
addEventListener('keydown', e => { if (e.key === 'Escape' && VHS.open) vhsClose(); });
{ let down = null;   // clique/toque em cima da fita
  cv.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; }, true);
  cv.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return;
    const cx = document.pointerLockElement === cv ? innerWidth / 2 : e.clientX, cy = document.pointerLockElement === cv ? innerHeight / 2 : e.clientY;
    for (const o of VHS.tapes) if (o.vis && Math.hypot(cx - o.sx, cy - o.sy) < 55) { vhsOpen(o); break; }
  }, true);
}
// ---------------- beagle passeando em volta do quarteirão (Albert Sabin / Darci / Carlos F. Pinto / Cel. Bruno) ----------------
const BEAGLE = { d: null, path: null, cum: null, len: 0, s: 0, stop: 0, sniffs: [], nextSniff: 0, hearts: [], scratch: 0, after: 0 };
function beagleRoute() {
  const nodes = new Map(), key = p => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);
  const node = p => { const k = key(p); if (!nodes.has(k)) nodes.set(k, { k, x: p[0], z: p[1], e: [] }); return nodes.get(k); };
  for (const r of W.roads) { if (r.t === 'footway' || r.dirt) continue; for (let i = 0; i < r.pts.length - 1; i++) { const a = node(r.pts[i]), b = node(r.pts[i + 1]); if (a === b) continue; const L = Math.hypot(a.x - b.x, a.z - b.z); a.e.push({ n: b, L, nm: r.n }); b.e.push({ n: a, L, nm: r.n }); } }
  const want = ['Rua Albert Sabin', 'Rua Darci de Carvalho', 'Rua Coronel José Fernando Bruno'];
  for (const A of nodes.values()) for (const e0 of A.e) {
    if (e0.nm !== 'Rua Albert Sabin') continue;
    const path = [A], names = new Set([e0.nm]); let prev = A, cur = e0.n, len = e0.L, ok = false;
    for (let it = 0; it < 200 && len < 2500; it++) {
      path.push(cur);
      const ain = Math.atan2(cur.z - prev.z, cur.x - prev.x); let best = null;
      for (const e of cur.e) { if (e.n === prev && cur.e.length > 1) continue; let tr = Math.atan2(e.n.z - cur.z, e.n.x - cur.x) - ain; while (tr > Math.PI) tr -= 2 * Math.PI; while (tr <= -Math.PI) tr += 2 * Math.PI; if (!best || tr > best.tr) best = { e, tr }; }
      if (!best) break; prev = cur; cur = best.e.n; len += best.e.L; names.add(best.e.nm);
      if (prev === A && cur === e0.n) { ok = true; break; }
    }
    if (!ok || names.size !== 3 || !want.every(w => names.has(w)) || len > 900) continue;
    path.pop();   // A repetido no fim
    let cx = 0, cz = 0; for (const p of path) { cx += p.x; cz += p.z; } cx /= path.length; cz /= path.length;
    let votes = 0; const segs = [];
    for (let i = 0; i < path.length; i++) { const a = path[i], b = path[(i + 1) % path.length], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; votes += Math.sign((-dz / l) * (cx - (a.x + b.x) / 2) + (dx / l) * (cz - (a.z + b.z) / 2)); }
    const sg = votes >= 0 ? 1 : -1, pts = [];
    for (let i = 0; i <= path.length; i++) {   // calçada do lado de dentro do quarteirão
      const a = path[(i - 1 + path.length) % path.length], c = path[i % path.length], b = path[(i + 1) % path.length];
      const d1 = [c.x - a.x, c.z - a.z], d2 = [b.x - c.x, b.z - c.z], l1 = Math.hypot(...d1) || 1, l2 = Math.hypot(...d2) || 1;
      const nx = (-d1[1] / l1 - d2[1] / l2) / 2, nz = (d1[0] / l1 + d2[0] / l2) / 2, nl = Math.hypot(nx, nz) || 1;
      pts.push([c.x + nx / nl * 4.2 * sg, c.z + nz / nl * 4.2 * sg]);
    }
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  return null;
}
function beagleAt(s) { const R = BEAGLE; s = ((s % R.len) + R.len) % R.len; let i = 1; while (i < R.cum.length - 1 && R.cum[i] < s) i++; const a = R.path[i - 1], b = R.path[i], f = (s - R.cum[i - 1]) / Math.max(1e-6, R.cum[i] - R.cum[i - 1]); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0])]; }
function gate489Frame(B, dt) {
  const G = GATE489; if (!G) return;
  G.open += Math.max(-dt * 0.7, Math.min(dt * 0.7, G.want - G.open));
  const a = G.open * 1.45, H = yawChild(G.T, 0, 0, 0, a);   // gira para dentro do lote, dobradiça do lado esquerdo
  box(B, H, 0, G.L, 0.25, 2.15, -0.04, 0.04, G.WD, G.WD2);
  box(B, H, 0.08, G.L - 0.08, 1.2, 2.0, -0.06, -0.04, hex('#6a2a26'), hex('#6a2a26'));   // pano vermelho atrás do vidro
  box(B, H, G.L - 0.15, G.L - 0.1, 1.0, 1.15, -0.08, -0.04, hex('#c9c3b2'), hex('#c9c3b2'));   // maçaneta
}
// rotina da Pantufa: no fim do dia vai para a casa 489; sai de novo às 10 h
function beagleHome(R, d, dt) {
  const G = GATE489; if (!G) return false;
  const h = gameClock().h, night = h >= 18 || h < 10;
  const out = G.WP(5.3, 3.4), ins = G.WP(5.3, 6.3), spot = G.WP(5.6, 7.6);
  if (R.sH === undefined) {   // ponto do passeio mais perto da casa + caminho pela calçada da Albert Sabin até a porta
    let b = 1e9; for (let s = 0; s < R.len; s += 1) { const p = beagleAt(s), dd = Math.hypot(p[0] - out[0], p[1] - out[1]); if (dd < b) { b = dd; R.sH = s; } }
    const st = beagleAt(R.sH), rd = W.roads.find(r => r.n === 'Rua Albert Sabin'), nv = [G.T.az[0], G.T.az[2]], ex = [G.T.ax[0], G.T.ax[2]];
    const proj = p => (p[0] - out[0]) * ex[0] + (p[1] - out[1]) * ex[1], uS = proj(st), side = (p, d) => { const q = [p[0] - out[0], p[1] - out[1]]; return q[0] * nv[0] + q[1] * nv[1]; };
    const mid = [];
    if (rd) for (let i = 0; i < rd.pts.length - 1; i++) { const a = rd.pts[i], c = rd.pts[i + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]); for (let t = 0; t < L; t += 4) { const p = [a[0] + (c[0] - a[0]) * t / L, a[1] + (c[1] - a[1]) * t / L], u = proj(p);
      if ((u > 0.5 && u < uS - 2) || (u < -0.5 && u > uS + 2)) { const nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L, sg = (nx * nv[0] + nz * nv[1]) > 0 ? 1 : -1; mid.push([p[0] + nx * sg * (rd.h + 1.2), p[1] + nz * sg * (rd.h + 1.2), u]); } } }
    mid.sort((p, q) => Math.abs(q[2]) - Math.abs(p[2]));
    R.toHome = [[st[0], st[1]], ...mid.map(p => [p[0], p[1]]), out];
  }
  if (!R.home) { R.home = night ? 'in' : 'out'; if (R.home === 'in') { d.x = spot[0]; d.z = spot[1]; d.a = Math.atan2(out[1] - spot[1], out[0] - spot[0]); } }
  const walk = spd => { d.spd = spd; return dogRun(d, dt, spd); };
  if (R.home === 'out') { if (night) R.home = 'going'; return false; }
  if (R.home === 'going') {   // segue o passeio até o ponto em frente à casa, depois atravessa
    const sm = ((R.s % R.len) + R.len) % R.len; if (Math.abs(sm - R.sH) > 1.2 || R.scratch > 0) return false;
    R.home = 'enter'; d.path = [...R.toHome, ins, spot]; d.pi = 0; d.delay = 0; R.stop = 0; d.sniff = false;
  }
  if (R.home === 'enter') { const atDoor = Math.hypot(d.x - out[0], d.z - out[1]) < 2.5; if (atDoor) G.want = 1; if (G.open < 0.8 && Math.hypot(d.x - out[0], d.z - out[1]) < 0.6) { d.spd = 0; d.wag = 1; return true; }
    if (walk(1.3)) { R.home = 'in'; R.closeT = 1.5; } return true; }
  if (R.home === 'in') {
    if (R.closeT > 0) { R.closeT -= dt; if (R.closeT <= 0) G.want = 0; }
    d.spd = 0; d.sit = true; d.wag = Math.hypot(player.x - d.x, player.z - d.z) < 6 ? 1 : 0.2; d.sniff = false;
    if (!night) { R.home = 'leave'; G.want = 1; d.path = [ins, out, ...R.toHome.slice(0, -1).reverse()]; d.pi = 0; d.sit = false; R.closeAt = 2; }
    return true;
  }
  if (R.home === 'leave') { d.sit = false; if (G.open < 0.8 && d.pi === 0) { d.spd = 0; d.wag = 1; return true; }
    if (d.pi >= 2) G.want = 0;
    if (walk(1.3)) { R.home = 'out'; R.s = R.sH; G.want = 0; } return true; }
  return false;
}
function beagleFrame(B, dt, t) {
  const R = BEAGLE;
  if (!R.path) { const r = beagleRoute(); if (!r) { R.path = []; return; } R.path = r.pts; R.cum = r.cum; R.len = r.len;
    // lixeiras e árvores perto do caminho: lugares para cheirar
    const cand = PROPS.filter(p => p.k === 'lixeira').map(p => [p.x, p.z]).concat(W.trees.map(q => [q[0], q[1]]));
    for (let s = 0; s < R.len; s += 2) { const [x, z] = beagleAt(s); for (const c of cand) if (Math.hypot(c[0] - x, c[1] - z) < 2.6 && !R.sniffs.some(q => Math.abs(q.s - s) < 12)) R.sniffs.push({ s, x: c[0], z: c[1] }); }
    R.s = R.len * 0.3; const [x, z, a] = beagleAt(R.s);
    R.d = { kind: 'beagle', x, z, a, ph: 0, wag: 0.5, spd: 0, look: 0 };
  }
  if (!R.path.length) return;
  const d = R.d, pd = Math.hypot(player.x - d.x, player.z - d.z);
  // coçar o bumbum
  const btn = document.getElementById('btnPet'); R.near = pd < 2.4 && !player.car;
  if (btn) btn.style.display = R.near && R.scratch <= 0 ? '' : 'none';
  if (R.scratch > 0) {
    R.scratch -= dt; d.thump = true; d.sniff = false; d.wag = 1; d.spd = 0; d.sit = false;
    if (Math.random() < dt * 5) R.hearts.push({ x: d.x + (Math.random() - 0.5) * 0.25, z: d.z + (Math.random() - 0.5) * 0.25, y: surfAt(d.x, d.z) + 0.75, life: 0 });
    if (R.scratch <= 0) { d.thump = false; R.after = 2.5; }
  } else if (beagleHome(R, d, dt)) {   // indo para casa / dentro da casa 489 / saindo de manhã
  } else if (R.stop > 0 || R.after > 0 || pd < 2.4) {   // parado cheirando, ou esperando a pessoa
    if (R.stop > 0) R.stop -= dt; else { d.sniff = false; }
    if (R.after > 0) R.after -= dt;
    d.spd = 0; d.wag = pd < 4 ? 1 : 0.4;
    if (R.stop <= 0) d.sniff = false;
  } else {
    R.s += 1.1 * dt; const [x, z, a] = beagleAt(R.s);
    let da = a - d.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    d.x = x; d.z = z; d.a += da * Math.min(1, dt * 6); d.spd = 1.1; d.ph += dt * 13; d.wag = 0.5; d.sniff = false;
    const sm = ((R.s % R.len) + R.len) % R.len;
    for (const q of R.sniffs) if (sm > q.s && sm - q.s < 0.5 && R.nextSniff !== q) { R.nextSniff = q; if (Math.random() < 0.6) { R.stop = 2.5 + Math.random() * 3; d.sniff = true; d.a = Math.atan2(q.z - d.z, q.x - d.x); } }
  }
  d.look = d.look || 0;
  if (Math.abs(d.x - player.x) < 160 && Math.abs(d.z - player.z) < 160) buildDog(B, d, t);
  // coraçõezinhos subindo
  R.hearts = R.hearts.filter(h => (h.life += dt) < 1.6);
  for (const h of R.hearts) {
    const y = h.y + h.life * 0.5, s_ = 0.05 * (1 - h.life / 1.6 * 0.4), c = [235, 60, 90], Th = frame(h.x + Math.sin(h.life * 6) * 0.05, y, h.z, cam.yaw);
    box(B, Th, -s_ * 1.4, -s_ * 0.1, 0, s_ * 1.6, -0.005, 0.005, c, c, F_GLOW); box(B, Th, s_ * 0.1, s_ * 1.4, 0, s_ * 1.6, -0.005, 0.005, c, c, F_GLOW);
    box(B, Th, -s_ * 0.9, s_ * 0.9, -s_ * 1.0, 0.02, -0.005, 0.005, c, c, F_GLOW); box(B, Th, -s_ * 0.4, s_ * 0.4, -s_ * 1.5, -s_ * 0.9, -0.005, 0.005, c, c, F_GLOW);
  }
}
function benchFrame() {
  const btn = document.getElementById('btnSit'); if (!BENCH || !btn) return;
  let best = null, bd = 2.2;
  if (!player.sit && !player.car) for (const s_ of BENCH.spots) { const d = Math.hypot(player.x - s_.x, player.z - s_.z); if (d < bd) { bd = d; best = s_; } }
  BENCH.near = best; btn.style.display = best ? '' : 'none';
}
function benchSit() { const s_ = BENCH && BENCH.near; if (!s_) return; player.sit = { x: s_.x, z: s_.z, a: s_.a, sx: s_.sx, sz: s_.sz, y: BENCH.seatY }; player.speed = 0; BENCH.near = null; }
document.getElementById('btnSit').addEventListener('click', e => { e.stopPropagation(); benchSit(); });
document.getElementById('btnSit').addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
// ---------------- mensagem do criador no céu: duas nuvens 3D se abrem e um pergaminho desenrola ----------------
let SKYMSG = null;
function skyMsgAnchor(S) { const gy = surfAt(player.x, player.z); return [player.x + S.fx * 42, gy + 26, player.z + S.fz * 42]; }
function skyMsgPt(S, u, y, v = 0) { const c = skyMsgAnchor(S), rx = -S.fz, rz = S.fx; return [c[0] + rx * u - S.fx * v, c[1] + y, c[2] + rz * u - S.fz * v]; }   // u = direita de quem olha, v > 0 = mais perto do jogador
// texto em pixels de verdade (3D, atrás das árvores): desenha num canvas pequeno e vira faixas de blocos
function skyMsgRuns(m) {   // texto (com emojis coloridos) desenhado em alta resolução e convertido em faixas de pixels 3D
  const SC = 3, Wc = 184 * SC, Hc = 96 * SC, PX = 0.1 / SC, cv2 = document.createElement('canvas'); cv2.width = Wc; cv2.height = Hc; const g = cv2.getContext('2d');
  const FONT = s_ => "bold " + s_ + "px 'Trebuchet MS', 'Segoe UI', Roboto, Arial, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
  const words = m.split(/\s+/); let lines = [], size = 44 * SC;
  for (; size >= 10 * SC; size -= SC) {
    g.font = FONT(size); lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width <= Wc - 8 * SC || !cur) cur = t; else { lines.push(cur); cur = w; } }
    if (cur) lines.push(cur);
    if (lines.length * size * 1.1 <= Hc - 6 * SC && lines.every(l => g.measureText(l).width <= Wc - 4 * SC)) break;
  }
  g.font = FONT(size); g.fillStyle = '#3a200b'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lh = size * 1.1, y0 = Hc / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((l, k) => g.fillText(l, Wc / 2, y0 + k * lh));
  const d = g.getImageData(0, 0, Wc, Hc).data, runs = [];
  const col = i => { const a = d[i + 3] / 255; return [Math.round(d[i] * a + 244 * (1 - a)), Math.round(d[i + 1] * a + 226 * (1 - a)), Math.round(d[i + 2] * a + 180 * (1 - a))]; };   // mistura com a cor do papel
  for (let y = 0; y < Hc; y++) { let x0 = -1, c0 = null;
    for (let x = 0; x <= Wc; x++) { const i = (y * Wc + x) * 4, on = x < Wc && d[i + 3] > 70, c = on ? col(i) : null, same = on && c0 && Math.abs(c[0] - c0[0]) + Math.abs(c[1] - c0[1]) + Math.abs(c[2] - c0[2]) < 40;
      if (x0 >= 0 && !same) { runs.push([(x0 - Wc / 2) * PX, (x - Wc / 2) * PX, (Hc / 2 - y) * PX, c0]); x0 = -1; c0 = null; }
      if (on && x0 < 0) { x0 = x; c0 = c; } } }
  runs.px = PX;
  return runs;
}
function skyMsgFrame(B, t) {
  const S = SKYMSG; if (!S) return;
  if (!S.runs) S.runs = skyMsgRuns(S.m);
  const now = performance.now(), el = S.seen ? (now - S.seen) / 1000 : 0, L = S.life / 1000;
  const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  let part = ease(el / 2.8), unroll = ease((el - 1.6) / 2.2), fade = 0;
  if (S.seen && el > L) { unroll = 1 - ease((el - L) / 2.2); part = 1 - ease((el - L - 1.4) / 2.6); fade = ease((el - L - 4.0) / 2.8); }   // enrola, nuvens se fecham, somem devagar
  S.fade = fade; S.h = 0.6 + 10.4 * unroll;
  const c = skyMsgAnchor(S), a = Math.atan2(S.fx, -S.fz), T = frame(c[0], c[1], c[2], a);   // ax = (-fz, fx) = direita de quem olha
  T.az = [-S.fx, 0, -S.fz];
  const h = S.h / 2, PAP = [244, 226, 180], PAP2 = [222, 196, 140], ROD = [122, 77, 34], ROD2 = [90, 54, 22], KNOB = [70, 40, 14], INK = [74, 42, 14];
  if (fade < 0.05) {
    if (unroll > 0.02) {
      box(B, T, -9.6, 9.6, -h + 0.3, h - 0.3, -0.08, 0.08, PAP, PAP2, F_GLOW);
      const lim = h - 0.4, n = [-S.fx, 0, -S.fz];
      const px = S.runs.px || 0.1; for (const [u0, u1, y, c] of S.runs) if (Math.abs(y) < lim) { const q = (u, yy) => skyMsgPt(S, u, yy, 0.1); B.quad(q(u0, y), q(u1, y), q(u1, y - px), q(u0, y - px), n, c || INK, F_GLOW); }
    }
    for (const sg of [-1, 1]) {
      box(B, T, -10.2, 10.2, sg * h - 0.38, sg * h + 0.38, -0.38, 0.38, ROD, ROD2, F_GLOW);
      for (const e of [-1, 1]) box(B, T, e * 10.2 - 0.35, e * 10.2 + 0.35, sg * h - 0.55, sg * h + 0.55, -0.55, 0.55, KNOB, KNOB, F_GLOW);
    }
  }
  // nuvens 3D na frente do pergaminho
  const off = 6 + part * 20, WC = hex('#ffffff'), SC = hex('#e8eef5'), r = rngFor(7, 7, 99), lumps = [];
  for (let j = 0; j < 6; j++) lumps.push([(r() - 0.5) * 11, (r() - 0.5) * 4, 3.2 + r() * 4, 2.6 + r() * 3]);
  for (const sg of [-1, 1]) for (const [u, y, sz, hy] of lumps) { const uu = sg * off + u * sg; box(B, T, uu - sz, uu + sz, y - hy, y + hy, 2.5 - sz * 0.6, 2.5 + sz * 0.6, WC, SC, F_SKYF, true); }
  if (S.seen && el > L + 6.9) SKYMSG = null;
}
function beaglePet() { if (BEAGLE.near && BEAGLE.scratch <= 0) { BEAGLE.scratch = 3.5; const d = BEAGLE.d; d.a = Math.atan2(d.z - player.z, d.x - player.x); } }
document.getElementById('btnPet').addEventListener('click', e => { e.stopPropagation(); beaglePet(); });
document.getElementById('btnPet').addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
function dogsFrame(B, dt, t) {
  for (const d of DOGS) {
    const Y = d.yard, D = DOGDEF[d.kind];
    if (Math.hypot(d.x - player.x, d.z - player.z) > 160 && !d.mode) continue;   // fugindo: continua andando mesmo longe
    const loc = (x, z) => { const dx = x - Y.x, dz = z - Y.z; return [dx * Y.u[0] + dz * Y.u[1], dx * Y.v[0] + dz * Y.v[1]]; };
    const inside = (x, z) => { const [u, v] = loc(x, z); return u > Y.u0 && u < Y.u1 && v > Y.v0 && v < Y.v1 && !(u > Y.nu0 && u < Y.nu1 && v < Y.nv) && freeAt(x, z, 0.25); };
    const pd = Math.hypot(player.x - d.x, player.z - d.z);
    let want = 0;
    if (d.mode === 'escape') { if (dogRun(d, dt, 4.2)) { d.mode = 'wait'; d.spd = 0; } d.look = 0; buildDog(B, d, t); continue; }
    if (d.mode === 'wait') {   // esperando na frente do portão
      d.spd = 0; d.sit = !(pd < 7); d.wag = pd < 7 ? 1 : 0.4;
      let rel = Math.atan2(GATE116.WP(0, 9)[1] - d.z, GATE116.WP(0, 9)[0] - d.x);
      if (pd < 7) rel = Math.atan2(player.z - d.z, player.x - d.x);
      let tr = rel - d.a; while (tr > Math.PI) tr -= 2 * Math.PI; while (tr < -Math.PI) tr += 2 * Math.PI; d.a += Math.max(-dt * 3, Math.min(dt * 3, tr));
      if (GATE116.open > 0.9) { const G = GATE116, cu = (G.gA + G.gB) / 2, g = G.WP(cu, G.BV), m = G.WP(cu, G.MV + 0.2), ins = G.WP(cu + (d.kind === 'yorkie' ? -1 : 1), G.BV + 2.4);
        d.mode = 'enter'; d.pi = 0; d.delay = d.kind === 'yorkie' ? 0 : 0.6; d.path = [[m[0], m[1]], [g[0], g[1]], [ins[0], ins[1]]]; d.sit = false; }
      buildDog(B, d, t); continue;
    }
    if (d.mode === 'enter') { if (dogRun(d, dt, 2.6)) { d.mode = null; d.tx = d.x; d.tz = d.z; d.wait = 1.5; } buildDog(B, d, t); continue; }
    if (pd < 7) {            // alguém chegou perto: para, olha e abana o rabo
      d.wait = Math.max(d.wait, 0.5); d.spd = 0;
      let rel = Math.atan2(player.z - d.z, player.x - d.x) - d.a; while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI;
      if (Math.abs(rel) > 0.9) d.a += Math.sign(rel) * Math.min(Math.abs(rel) - 0.9, dt * 3);
      want = Math.max(-0.8, Math.min(0.8, rel)); d.wag = Math.min(1, d.wag + dt * 3); d.sit = false;
    } else if (d.wait > 0) {
      d.wait -= dt; d.spd = 0; d.wag = Math.max(0.15, d.wag - dt * 0.5);
    } else {
      const dx = d.tx - d.x, dz = d.tz - d.z, dist = Math.hypot(dx, dz);
      if (dist < 0.3) { d.wait = 1 + Math.random() * 4; d.sit = Math.random() < 0.3; for (let k = 0; k < 12; k++) { const u = Y.u0 + Math.random() * (Y.u1 - Y.u0), v = Y.v0 + Math.random() * (Y.v1 - Y.v0), x = Y.x + Y.u[0] * u + Y.v[0] * v, z = Y.z + Y.u[1] * u + Y.v[1] * v; if (inside(x, z)) { d.tx = x; d.tz = z; break; } } }
      else {
        let ta = Math.atan2(dz, dx) - d.a; while (ta > Math.PI) ta -= 2 * Math.PI; while (ta < -Math.PI) ta += 2 * Math.PI;
        d.a += Math.max(-dt * 4, Math.min(dt * 4, ta));
        const sp = D.spd * (Math.abs(ta) > 1 ? 0.3 : 1), nx = d.x + Math.cos(d.a) * sp * dt, nz = d.z + Math.sin(d.a) * sp * dt;
        if (inside(nx, nz)) { d.x = nx; d.z = nz; d.spd = sp; d.ph += dt * sp * (d.kind.startsWith('yorkie') ? 22 : 12); d.sit = false; d.wag = 0.35; }
        else { d.tx = d.x; d.tz = d.z; }
      }
    }
    d.look = (d.look || 0) + (want - (d.look || 0)) * Math.min(1, dt * 5);
    buildDog(B, d, t);
  }
}
// ---------------- Portela: volta de bicicleta pelo bairro, 2x por dia (07:30 e 16:30 do jogo) ----------------
const RIDE_TIMES = [7.5, 16.5], RIDE_SPEED = 5.2, RIDE_SAYS = ['Opa! Tô dando minha volta de bicicleta!', 'Bom dia! Já já eu volto pra guarita.', 'Olha a bicicleta passando, hein!', 'Hoje o bairro tá tranquilo, viu?'];
let ROAD_G = null;
function roadGraph() {   // grafo das ruas (sem calçadas/trilhas)
  if (ROAD_G) return ROAD_G;
  const key = p => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2), nodes = new Map();
  const node = p => { const k = key(p); if (!nodes.has(k)) nodes.set(k, { k, x: p[0], z: p[1], e: [] }); return nodes.get(k); };
  for (const r of W.roads) {
    if (r.t === 'footway' || r.dirt) continue;
    for (let i = 0; i < r.pts.length - 1; i++) { const a = node(r.pts[i]), b = node(r.pts[i + 1]); if (a === b) continue; const L = Math.hypot(a.x - b.x, a.z - b.z); a.e.push({ n: b, L }); b.e.push({ n: a, L }); }
  }
  return ROAD_G = [...nodes.values()];
}
function rideRoute(seed) {   // sai da guarita, passeia ~1 km pelas ruas (mesmo trajeto para todo mundo) e volta pelo caminho mais curto
  const G = roadGraph(), park = PORTELA_PARK; if (!park || !G.length) return null;
  let st = G[0], bd = 1e9; for (const n of G) { const d = Math.hypot(n.x - park.x, n.z - park.z); if (d < bd && n.e.length) { bd = d; st = n; } }
  let rs = seed * 9301 + 49297; const rnd = () => (rs = (rs * 9301 + 49297) % 233280) / 233280;
  const path = [st], seen = new Set([st.k]); let cur = st, prev = null, len = 0;
  for (let it = 0; it < 400 && len < 520; it++) {
    let opts = cur.e.filter(e => e.n !== prev); if (!opts.length) opts = cur.e;
    const fresh = opts.filter(e => !seen.has(e.n.k)), pick = (fresh.length ? fresh : opts)[Math.floor(rnd() * (fresh.length ? fresh : opts).length)];
    prev = cur; cur = pick.n; len += pick.L; path.push(cur); seen.add(cur.k);
  }
  // volta: Dijkstra simples até o ponto de partida
  const dist = new Map([[cur.k, 0]]), from = new Map(), todo = new Set([cur]);
  while (todo.size) {
    let u = null, du = 1e18; for (const n of todo) { const d = dist.get(n.k); if (d < du) { du = d; u = n; } }
    todo.delete(u); if (u === st) break;
    for (const e of u.e) { const nd = du + e.L; if (nd < (dist.has(e.n.k) ? dist.get(e.n.k) : 1e18)) { dist.set(e.n.k, nd); from.set(e.n.k, u); todo.add(e.n); } }
  }
  const back = []; for (let n = st; n && n !== cur; n = from.get(n.k)) back.push(n); back.reverse();
  const nodes = [{ x: park.x, z: park.z }, ...path, ...back.slice(1), { x: park.x, z: park.z }];
  // pedala pela direita da rua
  const pts = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[Math.max(0, i - 1)], b = nodes[Math.min(nodes.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const off = i === 0 || i === nodes.length - 1 ? 0 : 1.6;
    pts.push([nodes[i].x - dz / l * off, nodes[i].z + dx / l * off]);
  }
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}
const RIDES = new Map();
function portelaUpdate(n) {
  const c = gameClock(); let ride = null;
  for (let k = 0; k < RIDE_TIMES.length; k++) {
    const t0 = c.dayStart + RIDE_TIMES[k] * 60, id = c.day * 2 + k;
    if (c.sec < t0) continue;
    if (!RIDES.has(id)) { RIDES.set(id, rideRoute(id)); if (RIDES.size > 6) RIDES.delete(RIDES.keys().next().value); }
    const R = RIDES.get(id); if (!R) continue;
    const sd = (c.sec - t0) * RIDE_SPEED; if (sd < R.len) ride = { R, sd };
  }
  if (!ride) { if (n.riding) { Object.assign(n, { x: n.home.x, z: n.home.z, y: n.home.y, base: n.home.base, riding: false, says: undefined, near: false }); } return; }
  const { R, sd } = ride; let i = 1; while (i < R.cum.length - 1 && R.cum[i] < sd) i++;
  const a = R.pts[i - 1], b = R.pts[i], f = (sd - R.cum[i - 1]) / Math.max(1e-6, R.cum[i] - R.cum[i - 1]);
  n.x = a[0] + (b[0] - a[0]) * f; n.z = a[1] + (b[1] - a[1]) * f; n.y = surfAt(n.x, n.z);
  const hd = Math.atan2(b[1] - a[1], b[0] - a[0]); let dh = hd - (n.hd === undefined ? hd : n.hd); while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
  n.hd = (n.hd === undefined ? hd : n.hd) + dh * 0.15; n.ped = sd / 0.9; n.riding = true; n.says = RIDE_SAYS;
}
function buildRider(B, n, t) {   // Portela pedalando, de boné
  buildProp(B, 'bike', n.x, n.z, n.hd, {});
  const T = frame(n.x, n.y, n.z, n.hd), ph = n.ped;
  const hip = P(T, -0.2, 1.02, 0);
  for (const sv of [-1, 1]) {   // pernas nos pedais
    const pa = ph + (sv > 0 ? 0 : Math.PI), ped = P(T, -0.05 + Math.cos(pa) * 0.17, 0.33 - Math.sin(pa) * 0.17, sv * 0.13);   // pedal da frente desce: pedalada para a frente
    const h = P(T, -0.2, 1.02, sv * 0.12), mid = [(h[0] + ped[0]) / 2, (h[1] + ped[1]) / 2, (h[2] + ped[2]) / 2], kn = P({ o: mid, ax: T.ax, ay: T.ay, az: T.az }, 0.22, 0.12, 0);
    beam(B, h, kn, 0.17, P_PANTS); beam(B, kn, ped, 0.15, P_PANTS); box(B, frame(ped[0], ped[1] - 0.05, ped[2], n.hd), -0.08, 0.13, 0, 0.09, -0.06, 0.06, P_SHOE, P_SHOE);
  }
  const Tt = { o: hip, ax: T.ax, ay: T.ay, az: T.az };
  box(B, Tt, -0.14, 0.2, 0.0, 0.6, -0.3, 0.3, P_SHIRT, P_SHIRT);   // tronco inclinado
  box(B, Tt, -0.15, 0.21, 0.0, 0.08, -0.31, 0.31, hex('#2a2a2a'), hex('#2a2a2a'));
  for (const sv of [-1, 1]) { const sh = P(Tt, 0.05, 0.55, sv * 0.36), hand = P(T, 0.38, 1.12, sv * 0.27); beam(B, sh, hand, 0.15, P_SHIRT); box(B, frame(hand[0], hand[1] - 0.06, hand[2], n.hd), -0.06, 0.06, 0, 0.11, -0.06, 0.06, P_SKIN, P_SKIN); }
  const H = { o: P(Tt, 0.04, 0.6, 0), ax: T.ax, ay: T.ay, az: T.az };
  box(B, H, -0.19, 0.19, 0.02, 0.4, -0.19, 0.19, P_SKIN, P_SKIN);
  box(B, H, -0.2, -0.05, 0.09, 0.34, -0.2, 0.2, P_HAIR, P_HAIR);
  box(B, H, 0.19, 0.2, 0.2, 0.25, -0.11, -0.05, hex('#1c1410'), hex('#1c1410')); box(B, H, 0.19, 0.2, 0.2, 0.25, 0.05, 0.11, hex('#1c1410'), hex('#1c1410'));
  box(B, H, 0.19, 0.205, 0.08, 0.12, -0.08, 0.08, hex('#cfc9bf'), hex('#cfc9bf'));
  box(B, H, -0.21, 0.21, 0.34, 0.52, -0.21, 0.21, P_CAP, P_CAP); box(B, H, 0.21, 0.45, 0.34, 0.39, -0.17, 0.17, P_CAP, P_CAP);
}
function buildNPC(B, n, t) {
  if (n.style === 'caudinho') return buildCaudinho(B, n, t);
  if (n.style === 'note') return;
  const T = scaleT(frame(n.x, n.y, n.z, n.base), PSC);
  const br = Math.sin(t * 1.6) * 0.012;
  const Tb = { o: [T.o[0], T.o[1] + br, T.o[2]], ax: T.ax, ay: T.ay, az: T.az };
  for (const v of [-0.15, 0.15]) {
    box(B, Tb, -0.12, 0.12, 0.08, 0.85, v - 0.11, v + 0.11, P_PANTS, P_PANTS);
    box(B, Tb, -0.13, 0.22, 0.0, 0.1, v - 0.12, v + 0.12, P_SHOE, P_SHOE);
  }
  box(B, Tb, -0.2, 0.2, 0.82, 1.47, -0.31, 0.31, P_SHIRT, P_SHIRT);
  box(B, Tb, -0.21, 0.21, 0.82, 0.9, -0.32, 0.32, hex('#2a2a2a'), hex('#2a2a2a')); // belt
  // arms: one hand on the hip, one relaxed with a slow gesture
  const g = Math.sin(t * 0.7) * 0.15;
  const A1 = swing(Tb, 0, 1.42, -0.4, 0.15 + g); box(B, A1, -0.09, 0.09, -0.3, 0.03, -0.09, 0.09, P_SHIRT, P_SHIRT); box(B, A1, -0.08, 0.08, -0.62, -0.3, -0.08, 0.08, P_SKIN, P_SKIN);
  const A2 = swing(Tb, 0, 1.42, 0.4, -0.1); box(B, A2, -0.09, 0.09, -0.3, 0.03, -0.09, 0.09, P_SHIRT, P_SHIRT); box(B, A2, -0.08, 0.08, -0.6, -0.3, -0.08, 0.08, P_SKIN, P_SKIN);
  // head turns to look at the player
  const H = yawChild(Tb, 0, 0, 0, n.look);
  box(B, H, -0.19, 0.19, 1.48, 1.86, -0.19, 0.19, P_SKIN, P_SKIN);
  box(B, H, -0.2, -0.05, 1.55, 1.8, -0.2, 0.2, P_HAIR, P_HAIR);
  box(B, H, 0.19, 0.2, 1.66, 1.71, -0.11, -0.05, hex('#1c1410'), hex('#1c1410'));
  box(B, H, 0.19, 0.2, 1.66, 1.71, 0.05, 0.11, hex('#1c1410'), hex('#1c1410'));
  box(B, H, 0.19, 0.205, 1.54, 1.58, -0.08, 0.08, hex('#cfc9bf'), hex('#cfc9bf')); // grey moustache
  box(B, H, -0.21, 0.21, 1.8, 1.98, -0.21, 0.21, P_CAP, P_CAP);   // boné
  box(B, H, 0.21, 0.45, 1.8, 1.85, -0.17, 0.17, P_CAP, P_CAP);    // aba
  box(B, H, -0.06, 0.06, 1.98, 2.01, -0.06, 0.06, hex('#f2c230'), hex('#f2c230'));
}
// ---------------- resize ----------------
function resize() {
  cv.width = Math.max(160, Math.floor(innerWidth / pixel));
  cv.height = Math.max(120, Math.floor(innerHeight / pixel));
}
addEventListener('resize', resize); resize();

// ---------------- HUD ----------------
const hudStreet = document.getElementById('street'), hudMode = document.getElementById('mode');
let hudT = 0, lastStreet = '';
function updateHUD() {
  let best = 1e9, name = '';
  for (const s of SEGS) { if (!s.n) continue; const d = segDist(player.x, player.z, s) - s.h; if (d < best) { best = d; name = s.n; } }
  const txt = best < 18 ? name : (inPoly(player.x, player.z, (W.areas.find(a => a.t === 'wood') || { pts: [[0, 0]] }).pts) ? 'Mata' : 'Morada da Colina');
  if (txt !== lastStreet) { hudStreet.textContent = txt; lastStreet = txt; }
  const v = player.car ? Math.abs(player.cv) : player.speed;
  const gc = gameClock(), hh = Math.floor(gc.h), mm = Math.floor((gc.h - hh) * 60), isDay = gc.h >= 6 && gc.h < 18;
  hudMode.textContent = (player.car ? 'CARRO ' : (player.running ? 'CORRENDO ' : 'A PÉ ')) + Math.round(v * 3.6) + ' km/h · alt. ' + Math.round((DEM ? DEM.base : 0) + groundAt(player.x, player.z)) + ' m · ' + (isDay ? '☀ ' : '☾ ') + String(hh).padStart(2, '0') + ':' + String(mm - mm % 10).padStart(2, '0');
}

// ---------------- modo online (Firebase Realtime Database) ----------------
const LOOKS = [
  { shirt: hex('#f2c230'), car: hex('#e04a2b') }, { shirt: hex('#2f7fd6'), car: hex('#2f5fb0') }, { shirt: hex('#d9493a'), car: hex('#b33a2d') },
  { shirt: hex('#3fa85a'), car: hex('#2e7d46') }, { shirt: hex('#9b5cc8'), car: hex('#6b3fa0') }, { shirt: hex('#f08a2a'), car: hex('#e9e6df') },
  { shirt: hex('#f2f2f2'), car: hex('#1d1d22') }, { shirt: hex('#1f2a3a'), car: hex('#9aa3ad') },
];
const LOOK_CSS = ['#f2c230', '#2f7fd6', '#d9493a', '#3fa85a', '#9b5cc8', '#f08a2a', '#f2f2f2', '#1f2a3a'];
let MY_LOOK = LOOKS[0];
window.__net = (function () {
  const N = { online: false, others: new Map(), uid: null, name: '', look: 0, db: null, offset: 0 };
  const $ = id => document.getElementById(id);
  const lobby = $('lobby'), nameIn = $('lobbyName'), sw = $('lobbySwatches'), msgEl = $('lobbyMsg');
  const chatBox = $('chatBox'), chatIn = $('chatIn'), chatLog = $('chatLog'), onl = $('online'), onlTxt = $('onlineTxt');
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('mdc_profile') || '{}'); } catch (e) {}
  nameIn.value = saved.n || ''; N.look = saved.c || 0;
  LOOK_CSS.forEach((c, i) => { const b = document.createElement('button'); b.className = 'sw' + (i === N.look ? ' on' : ''); b.style.background = c; b.onclick = () => { N.look = i; [...sw.children].forEach((x, k) => x.classList.toggle('on', k === i)); }; sw.appendChild(b); });
  const CFG = window.FIREBASE_CONFIG;
  if (!CFG) { $('btnOnline').disabled = true; msgEl.textContent = 'O modo online ainda não foi configurado.'; }
  const start = () => { MY_LOOK = LOOKS[N.look]; player.n = nameIn.value.trim(); lobby.style.display = 'none'; try { localStorage.setItem('mdc_profile', JSON.stringify({ n: nameIn.value.trim(), c: N.look })); } catch (e) {} };
  const offPill = () => { onlTxt.textContent = '○ offline'; $('btnLeave').textContent = 'ENTRAR'; $('btnLeave').classList.add('join'); onl.style.display = 'flex'; };
  $('btnSolo').onclick = () => { start(); if (CFG && !N.online) offPill(); };
  $('btnOnline').onclick = async () => {
    const n = nameIn.value.trim().replace(/\s+/g, ' ').slice(0, 16);
    if (!n) { msgEl.textContent = 'Digite um nome para jogar online.'; nameIn.focus(); return; }
    if (N.badName(n)) { msgEl.textContent = 'Esse nome é reservado. Escolha outro.'; nameIn.focus(); return; }
    msgEl.textContent = 'Conectando…'; $('btnOnline').disabled = true;
    try { await connect(n); start(); }
    catch (e) { console.error(e); msgEl.textContent = 'Não consegui conectar (' + (e.code || e.message || e) + '). Tente de novo ou jogue sozinho.'; $('btnOnline').disabled = false; }
  };
  const load = src => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('falha ao carregar ' + src)); document.head.appendChild(s); });
  N.ready = async () => {
    const V = 'https://www.gstatic.com/firebasejs/10.12.2/';
    if (!window.firebase) { await load(V + 'firebase-app-compat.js'); await load(V + 'firebase-auth-compat.js'); await load(V + 'firebase-database-compat.js'); }
    if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(CFG);
    if (!N.uid) { const cred = await firebase.auth().signInAnonymously(); N.uid = cred.user.uid; }
    if (!N.db) { N.db = firebase.database(); N.db.ref('.info/serverTimeOffset').on('value', s => { N.offset = s.val() || 0; }); }
  };
  async function connect(name, base) {
    await N.ready();
    if (N.badName(name)) throw { message: 'Esse nome é reservado. Escolha outro.' };
    N.name = name; N.base = base || '';
    N.tg({ t: 'join', n: name, mode: base ? 'sala' : 'online', r: base ? base.split('/')[1] : '' });
    N.crStart();
    const me = N.db.ref(N.base + 'players/' + N.uid);
    N.full = () => Object.assign({ n: N.name, c: N.look, x: +player.x.toFixed(2), z: +player.z.toFixed(2), a: +player.a.toFixed(3), car: player.car ? 1 : 0, t: firebase.database.ServerValue.TIMESTAMP }, H.fields());
    me.onDisconnect().remove();
    await me.set(N.full());
    // se a conexão cair (celular troca de rede, app vai pro fundo), o servidor apaga players/uid pelo onDisconnect.
    // Ao reconectar: rearma o onDisconnect e grava o registro completo de novo, senão os outros não te veem mais.
    let wasDown = false;
    N.connRef = N.db.ref('.info/connected');
    N.connRef.on('value', s => {
      if (!s.val()) { wasDown = true; return; }
      if (!wasDown || !N.online) return;
      wasDown = false; me.onDisconnect().remove(); me.set(N.full()).catch(e => console.error(e));
    });
    const players = N.db.ref(N.base + 'players');
    const upsert = s => {
      if (s.key === N.uid) return; const v = s.val(); if (!v || typeof v.x !== 'number') return;
      let o = N.others.get(s.key);
      if (!o) { o = { x: v.x, z: v.z, a: v.a || 0, walk: 0, speed: 0, car: false, el: document.createElement('div') }; o.el.className = 'lbl player'; lblLayer.appendChild(o.el); N.others.set(s.key, o); if (N.online) sys((v.n || '?') + (N.base ? ' entrou na sala' : ' entrou no bairro')); }
      if (o.tt !== undefined && v.tt && v.tt !== o.tt) H.onTaunt(s.key, o);
      o.ap = typeof v.ap === 'number' ? v.ap : 0;
      if (o.sh !== undefined && v.sh && v.sh !== o.sh) H.onShot(s.key, o, v.sh);
      o.sh = v.sh || '';
      o.pr = v.pr || ''; o.pa = typeof v.pa === 'number' ? v.pa : 0; o.pc = typeof v.pc === 'string' && v.pc ? v.pc.split(',').map(Number) : null; o.ps = v.ps || 1; o.hp = typeof v.hp === 'number' ? v.hp : undefined; o.tt = v.tt || 0;
      o.tx = v.x; o.tz = v.z; o.ta = v.a || 0; o.car = !!v.car; o.n = String(v.n || '?').slice(0, 16); o.look = LOOKS[(v.c | 0) % LOOKS.length] || LOOKS[0]; o.t = v.t || 0;
      o.el.textContent = o.n; o.el.style.borderColor = LOOK_CSS[(v.c | 0) % LOOK_CSS.length];
    };
    players.on('child_added', upsert); players.on('child_changed', upsert);
    players.on('child_removed', s => { const o = N.others.get(s.key); if (o) { sys(o.n + ' saiu'); o.el.remove(); if (o.bub) o.bub.remove(); N.others.delete(s.key); } });
    const since = Date.now() + N.offset - 2000;
    // mensagens anteriores à sua entrada vão só para o histórico
    try {
      const old = await N.db.ref(N.base + 'chat').orderByChild('t').endAt(since - 1).limitToLast(40).once('value');
      const prev = []; old.forEach(c => { const v = c.val(); if (v && typeof v.m === 'string') prev.push({ who: v.u === N.uid ? N.name : v.n || '?', m: v.m, mine: v.u === N.uid, t: (v.t || 0) - N.offset }); });
      prev.sort((a, b) => a.t - b.t); HIST.unshift(...prev);
    } catch (e) { console.error(e); }
    N.chatQ = N.db.ref(N.base + 'chat').orderByChild('t').startAt(since); N.players = players; N.me = me;
    N.chatQ.on('child_added', s => {
      const v = s.val(); if (!v || typeof v.m !== 'string') return;
      const who = v.u === N.uid ? N.name : (N.others.get(v.u) || {}).n || v.n || '?';
      addLog(who, v.m, v.u === N.uid, typeof v.t === 'number' ? v.t - N.offset : 0);
      const target = v.u === N.uid ? N.meBub : N.others.get(v.u);
      say(v.u === N.uid ? null : target, v.m, v.u);
    });
    N.online = true; onl.style.display = 'flex'; $('btnLeave').textContent = 'SAIR'; $('btnLeave').classList.remove('join'); $('btnChat').style.display = '';
    if (!N.base) sys('Você está online. Aperte Enter (ou CHAT) para falar.');
  }
  // sair do online: volta ao modo sozinho no mesmo lugar
  N.leave = async () => {
    if (!N.online) return;
    N.tg({ t: 'leave', n: N.name, r: N.base ? N.base.split('/')[1] : '' });
    N.online = false;
    try { N.players.off(); N.chatQ.off(); N.connRef.off(); N.me.onDisconnect().cancel(); await N.me.remove(); } catch (e) { console.error(e); }
    for (const o of N.others.values()) { o.el.remove(); if (o.bub) o.bub.remove(); }
    N.others.clear();
    offPill(); $('btnChat').style.display = 'none'; chatBox.style.display = 'none';
    const wasRoom = !!H.code; H.exit();
    sys(wasRoom ? 'Você saiu da sala.' : 'Você saiu do online. Agora está jogando sozinho.');
    $('btnOnline').disabled = false; msgEl.textContent = '';
    if (wasRoom) { lobby.style.display = ''; showPick(true); }
  };
  $('btnLeave').onclick = () => {
    if (!N.online) { lobby.style.display = ''; msgEl.textContent = ''; $('btnOnline').disabled = false; showPick(false); return; }
    if ($('btnLeave').dataset.sure) { delete $('btnLeave').dataset.sure; $('btnLeave').textContent = 'SAIR'; N.leave(); return; }
    $('btnLeave').dataset.sure = '1'; $('btnLeave').textContent = 'CONFIRMAR?';
    setTimeout(() => { if ($('btnLeave').dataset.sure) { delete $('btnLeave').dataset.sure; $('btnLeave').textContent = 'SAIR'; } }, 3000);
  };
  // chat
  const esc = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // histórico de mensagens (toque nas mensagens, ou no ☰ da caixa de chat, para abrir)
  const HIST = [], histEl = $('chatHist'), histList = $('chatHistList');
  const hhmm = t => { const d = new Date(t || Date.now()); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const histRow = h => '<div' + (h.sys ? ' class="sys"' : '') + '><i>' + hhmm(h.t) + '</i> ' + (h.sys ? esc(h.m) : '<b' + (h.cr ? ' class="cr"' : h.mine ? ' class="me"' : '') + '>' + esc(h.who) + ':</b> ' + esc(h.m)) + '</div>';
  const renderHist = () => { histList.innerHTML = HIST.length ? HIST.map(histRow).join('') : '<div class="sys">Nenhuma mensagem ainda.</div>'; histList.scrollTop = histList.scrollHeight; };
  const pushHist = h => { HIST.push(h); if (HIST.length > 300) HIST.shift(); if (histEl.style.display === 'flex') { const atEnd = histList.scrollHeight - histList.scrollTop - histList.clientHeight < 40; histList.insertAdjacentHTML('beforeend', histRow(h)); if (atEnd) histList.scrollTop = histList.scrollHeight; } };
  N.openHist = () => { renderHist(); histEl.style.display = 'flex'; chatLog.style.visibility = 'hidden'; histList.scrollTop = histList.scrollHeight; };
  N.closeHist = () => { histEl.style.display = 'none'; chatLog.style.visibility = ''; };
  $('chatHistClose').onclick = N.closeHist; $('chatHistBtn').onclick = e => { e.preventDefault(); N.openHist(); };
  chatLog.addEventListener('click', e => { if (e.target.closest('#chatLog div:not(.old)')) N.openHist(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && histEl.style.display === 'flex') N.closeHist(); });
  function addLog(who, m, mine, t) { pushHist({ who, m, mine, t: t || Date.now() }); const d = document.createElement('div'); d.innerHTML = '<b' + (mine ? ' class="me"' : '') + '>' + esc(who) + ':</b> ' + esc(m); chatLog.appendChild(d); while (chatLog.children.length > 7) chatLog.firstChild.remove(); setTimeout(() => d.classList.add('old'), 12000); }
  function sys(m) { pushHist({ sys: true, m, t: Date.now() }); const d = document.createElement('div'); d.className = 'sys'; d.textContent = m; chatLog.appendChild(d); while (chatLog.children.length > 7) chatLog.firstChild.remove(); setTimeout(() => d.classList.add('old'), 8000); }
  // ---- Telegram: avisos para o criador (quem entrou + chat) e mensagens do CRIADOR no céu ----
  const TG = 'https://morada-da-colina.pages.dev/mdc-tg/';
  N.tg = o => { try { fetch(TG + 'notify', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(o), keepalive: true }).catch(() => {}); } catch (e) {} };
  // fechou a aba / o app estando online: avisa que saiu (só uma vez)
  addEventListener('pagehide', () => { if (!N.online || N.leftSent) return; N.leftSent = true; const b = JSON.stringify({ t: 'leave', n: N.name, r: N.base ? N.base.split('/')[1] : '', why: 'fechou' });
    try { if (!(navigator.sendBeacon && navigator.sendBeacon(TG + 'notify', new Blob([b], { type: 'text/plain' })))) N.tg(JSON.parse(b)); } catch (e) {} });
  addEventListener('pageshow', e => { if (e.persisted && N.online && N.leftSent) { N.leftSent = false; N.tg({ t: 'join', n: N.name, mode: 'online' }); } });
  N.badName = n => /^\s*criador\s*$/i.test(String(n).normalize('NFD').replace(/[̀-ͯ]/g, ''));
  function creatorChat(m) {
    pushHist({ who: 'CRIADOR', m, cr: true, t: Date.now() });
    const d = document.createElement('div'); d.className = 'cr'; d.innerHTML = '<b class="cr">CRIADOR:</b> ' + esc(m); chatLog.appendChild(d);
    while (chatLog.children.length > 7) chatLog.firstChild.remove(); setTimeout(() => d.classList.add('old'), 20000);
  }
  function creatorMsg(m) {
    // primeiro só o aviso; a mensagem fica no céu (direção para onde a câmera olhava), escondida entre duas nuvens 3D
    if (SKYMSG && !SKYMSG.chat) creatorChat(SKYMSG.m);
    $('skyNote').classList.add('on');
    SKYMSG = { m, fx: -Math.sin(cam.yaw), fz: -Math.cos(cam.yaw), seen: 0, born: performance.now(), chat: false, life: 24000 + m.length * 120 };
  }
  window.__skyProj = VP => {
    const S = SKYMSG; if (!S) return;
    const now = performance.now(), note = $('skyNote');
    if (!S.seen && now - S.born > 60000) { note.classList.remove('on'); if (!S.chat) { S.chat = true; creatorChat(S.m); } SKYMSG = null; return; }   // ninguém olhou: vai para o chat
    const q = xform(VP, skyMsgAnchor(S));
    if (!S.seen && q[3] > 0 && Math.abs(q[0]) < 0.7 && Math.abs(q[1]) < 0.7) { S.seen = now; note.classList.remove('on'); }
    if (S.seen && !S.chat && now - S.seen > 4500) { S.chat = true; creatorChat(S.m); }
  };
  N.creatorMsg = creatorMsg;
  const crSeen = new Set(); let crFirst = true;
  async function crPoll() {
    try {
      const r = await fetch(TG + 'criador', { cache: 'no-store' }); if (!r.ok) return; const j = await r.json();
      for (const x of j.msgs || []) { if (crSeen.has(x.id)) continue; crSeen.add(x.id); if (crFirst && j.now - x.d > 90 || !N.online) continue; creatorMsg(Array.from(String(x.m)).slice(0, 200).join('')); }
      crFirst = false;
    } catch (e) {}
  }
  N.crStart = () => { if (N.crOn) return; N.crOn = true; crPoll(); setInterval(() => { if (!document.hidden && N.online) crPoll(); }, 10000); };
  const myBubble = document.createElement('div'); myBubble.className = 'bubble'; lblLayer.appendChild(myBubble);
  function say(o, m, uid) {
    if (uid === N.uid) { myBubble.textContent = m; myBubble.style.display = 'block'; clearTimeout(N.myT); N.myT = setTimeout(() => myBubble.style.display = 'none', 6000); return; }
    if (!o) return; if (!o.bub) { o.bub = document.createElement('div'); o.bub.className = 'bubble'; lblLayer.appendChild(o.bub); }
    o.bub.textContent = m; o.bubUntil = performance.now() + 6000; o.bubTaunt = false;
  }
  N.openChat = () => { if (!N.online) return; if (document.pointerLockElement) document.exitPointerLock(); chatBox.style.display = 'flex'; chatIn.value = ''; chatIn.focus(); for (const k in keys) keys[k] = false; };
  const send = () => {
    const m = chatIn.value.trim().slice(0, 120); chatBox.style.display = 'none'; chatIn.blur();
    if (m && N.db) { N.db.ref(N.base + 'chat').push({ u: N.uid, n: N.name, m, t: firebase.database.ServerValue.TIMESTAMP }); N.tg({ t: 'chat', n: N.name, m, r: N.base ? N.base.split('/')[1] : '' }); }
  };
  chatIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } if (e.key === 'Escape') { chatBox.style.display = 'none'; chatIn.blur(); } });
  $('chatSend').onclick = send;
  $('btnChat').onclick = () => N.openChat();
  // sync my position ~8x per second
  let lastSend = 0, lastSent = null;
  N.frame = (B, dt) => {
    const now = performance.now();
    if (N.online && now - lastSend > 125) {
      const st = Object.assign({ x: +player.x.toFixed(2), z: +player.z.toFixed(2), a: +player.a.toFixed(3), car: player.car ? 1 : 0 }, H.fields());
      const hk = JSON.stringify(H.fields());
      const moved = N.force || !lastSent || Math.abs(st.x - lastSent.x) > 0.02 || Math.abs(st.z - lastSent.z) > 0.02 || Math.abs(st.a - lastSent.a) > 0.02 || st.car !== lastSent.car || hk !== lastSent.hk;
      if (moved || now - lastSend > 5000) { N.force = false; const path = N.base + 'players/' + N.uid; st.t = firebase.database.ServerValue.TIMESTAMP; N.db.ref(path).update(st).catch(() => N.online && N.db.ref(path).set(N.full())); lastSent = Object.assign({ hk }, st); lastSend = now; }
    }
    const serverNow = Date.now() + N.offset;
    H.tick(dt);
    for (const [uid, o] of N.others) {
      o.stale = o.t && serverNow - o.t > 60000;
      if (o.stale) continue;
      const k = Math.min(1, dt * 10), px = o.x, pz = o.z;
      o.x += (o.tx - o.x) * k; o.z += (o.tz - o.z) * k;
      let da = o.ta - o.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; o.a += da * k;
      const v = Math.hypot(o.x - px, o.z - pz) / Math.max(dt, 1e-3);
      o.speed += (v - o.speed) * Math.min(1, dt * 6); o.walk += dt * o.speed * 2.3;
      const vis = H.vis(uid, o);
      o.gun = H.code && H.role(uid) === 'seeker' && H.phase() === 'seek' ? o.ap : undefined;
      if (vis === 'prop') buildProp(B, o.pr, o.x, o.z, o.pa, { col: o.pc, s: o.ps });
      else if (vis === 'person') buildPlayer(B, o, o.look);
    }
    H.draw(B);
    if (N.online) onlTxt.textContent = '● ' + (1 + [...N.others.values()].filter(o => !o.stale).length) + (N.base ? ' na sala' : ' online');
  };
  N.labels = VP => {
    const now = performance.now();
    const place = (el, x, y, z, up) => { const q = xform(VP, [x, y, z]); if (q[3] > 0 && Math.abs(q[0]) < 1.2 && Math.abs(q[1]) < 1.2) { el.style.display = 'block'; el.style.transform = `translate(${(q[0] * 0.5 + 0.5) * innerWidth}px,${(-q[1] * 0.5 + 0.5) * innerHeight}px) translate(-50%,${up})`; } else el.style.display = 'none'; };
    for (const [uid, o] of N.others) {
      const lb = H.label(uid, o), vis = H.vis(uid, o);
      const y = surfAt(o.x, o.z) + (vis === 'prop' ? (PROPDEF[o.pr] || { h: 1.5 }).h + 0.45 : o.car ? 2.3 : 2.25), far = Math.hypot(o.x - player.x, o.z - player.z) > 220;
      if (o.stale || far || vis === 'none') { o.el.style.display = 'none'; if (o.bub) o.bub.style.display = 'none'; continue; }
      if (lb === null) o.el.style.display = 'none';
      else { if (o.el.textContent !== lb) o.el.textContent = lb; o.el.classList.toggle('seeker', !!H.code && uid === (H.meta || {}).seeker && H.phase() !== 'lobby'); place(o.el, o.x, y, o.z, '-100%'); }
      if (o.bub) { if (now < o.bubUntil && (lb !== null || o.bubTaunt)) place(o.bub, o.x, y + (lb === null ? 0.2 : 0.9), o.z, '-115%'); else o.bub.style.display = 'none'; }
    }
    if (myBubble.style.display === 'block') { const q = xform(VP, [player.x, surfAt(player.x, player.z) + 3.1, player.z]); myBubble.style.transform = `translate(${(q[0] * 0.5 + 0.5) * innerWidth}px,${(-q[1] * 0.5 + 0.5) * innerHeight}px) translate(-50%,-115%)`; }
  };
  // ======================= ESCONDE-ESCONDE (prop hunt) =======================
  const H = { code: null, meta: null, caught: {}, myProp: null, locked: false, hp: 100, tt: 0, round: -1, lastShot: 0, lastTauntAt: 0, tracer: null, ending: -1, refs: [], hostT: 0, uiT: 0 };
  N.hunt = H;
  const TS = () => firebase.database.ServerValue.TIMESTAMP;
  const sNow = () => Date.now() + N.offset;
  const nameOf = uid => uid === N.uid ? N.name : ((N.others.get(uid) || {}).n || '?');
  const toastEl = $('toast');
  let toastT = null;
  function toast(m, ms) { toastEl.textContent = m; toastEl.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => toastEl.style.display = 'none', ms || 2600); }
  H.present = () => [N.uid, ...[...N.others].filter(([, o]) => !o.stale).map(([u]) => u)];
  H.phase = () => {
    const m = H.meta; if (!H.code || !m) return 'lobby';
    if (m.phase === 'play') return sNow() - (m.t0 || 0) < (m.hide || 45) * 1000 ? 'hide' : 'seek';
    return m.phase === 'end' ? 'end' : 'lobby';
  };
  H.role = uid => {
    const m = H.meta, ph = H.phase(); if (ph === 'lobby' || !m) return 'lobby';
    if (!m.parts || !m.parts[uid]) return 'spec';
    if (uid === m.seeker) return 'seeker';
    return H.caught[uid] ? 'out' : 'hider';
  };
  H.fields = () => H.code ? { pr: H.myProp ? H.myProp.k : '', pa: H.myProp ? +(player.a + H.myProp.off).toFixed(3) : 0, pc: H.myProp && H.myProp.col ? H.myProp.col.join(',') : '', ps: H.myProp && H.myProp.s || 1, hp: H.hp, tt: H.tt, ap: +(player.gun || 0).toFixed(2), sh: H.shot || '' } : {};
  H.vis = (uid, o) => {
    if (!H.code) return 'person';
    const ph = H.phase(); if (ph === 'lobby' || ph === 'end') return 'person';
    const r = H.role(uid);
    if (r === 'spec' || r === 'out') return 'none';
    if (r === 'hider' && o.pr && PROPDEF[o.pr]) return 'prop';
    return 'person';
  };
  H.label = (uid, o) => {
    if (!H.code) return o.n;
    const ph = H.phase(); if (ph === 'lobby' || ph === 'end') return (uid === (H.meta || {}).host ? '👑 ' : '') + o.n;
    const r = H.role(uid), me = H.role(N.uid);
    if (r === 'spec' || r === 'out') return null;
    if (r === 'seeker') return '🎯 ' + o.n;
    return me === 'seeker' ? null : o.n;   // pegador não vê o nome de quem está escondido
  };
  // ---- desenha meu disfarce, tiro e área ----
  N.drawMe = B => {
    if (H.code && H.myProp && H.role(N.uid) === 'hider' && (H.phase() === 'hide' || H.phase() === 'seek')) { buildProp(B, H.myProp.k, player.x, player.z, player.a + H.myProp.off, H.myProp); return true; }
    return false;
  };
  H.tracers = [];
  function fpGun() { // referencial da arma na tela em primeira pessoa
    const e = H.eye, d = [H.tgt[0] - e[0], H.tgt[1] - e[1], H.tgt[2] - e[2]], L = Math.hypot(...d); d[0] /= L; d[1] /= L; d[2] /= L;
    let r = [-d[2], 0, d[0]]; const rl = Math.hypot(r[0], r[2]) || 1; r = [r[0] / rl, 0, r[2] / rl];
    const u = [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]];
    const o = [e[0] + d[0] * 0.55 + r[0] * 0.2 - u[0] * 0.2, e[1] + d[1] * 0.55 + r[1] * 0.2 - u[1] * 0.2, e[2] + d[2] * 0.55 + r[2] * 0.2 - u[2] * 0.2];
    return { o, ax: d, ay: u, az: r };
  }
  const muzzle = (p, a, ap) => {
    if (p === player && cam.fp && H.eye) return P(fpGun(), 0.4, 0, 0); const c = Math.cos(a), s_ = Math.sin(a), y = surfAt(p.x, p.z) + 0.02 + 1.42 * PSC, sx = p.x - s_ * 0.39 * PSC, sz = p.z + c * 0.39 * PSCC, f = Math.cos(ap) * 1.0; return [sx + c * f, y + Math.sin(ap) * 1.0, sz + s_ * f]; };
  H.draw = B => {
    const now = performance.now();
    if (cam.fp && player.gun !== undefined && H.eye) { // arma em primeira pessoa
      const T = fpGun(), G = hex('#26282c'), G2 = hex('#3a3d42');
      box(B, T, -0.05, 0.38, -0.035, 0.035, -0.03, 0.03, G2, G);       // ferrolho/cano
      box(B, T, -0.04, 0.05, -0.17, -0.03, -0.028, 0.028, G, G2);      // cabo
      box(B, T, -0.06, 0.06, -0.2, -0.13, -0.045, 0.045, SKIN, SKIN);  // mão
      box(B, T, 0.34, 0.37, 0.035, 0.05, -0.006, 0.006, hex('#e8e4d6'), hex('#e8e4d6'));
    }
    H.tracers = H.tracers.filter(t => now < t.until);
    for (const t of H.tracers) {
      const k = Math.min(1, (t.until - now) / 260);
      beam(B, t.a, t.b, t.small ? 0.012 + 0.012 * k : 0.035 + 0.04 * k, hex('#ffe066'), F_UNLIT);
      const fs = t.small ? 0.035 : 0.12;
      if (k > 0.55) box(B, frame(t.a[0], t.a[1] - fs, t.a[2], 0), -fs, fs, 0, fs * 2, -fs, fs, hex('#fff6c8'), hex('#ffb347'), F_UNLIT);   // clarão no cano
      box(B, frame(t.b[0], t.b[1] - 0.12, t.b[2], now * 0.02), -0.12, 0.12, 0, 0.24, -0.12, 0.12, t.hit ? hex('#ff5a3c') : hex('#d8d2c0'), t.hit ? hex('#ffb347') : hex('#a8a294'), F_UNLIT);   // impacto
    }
  };
  H.onShot = (uid, o, sh) => {
    const q = sh.split(',').map(Number); if (q.length < 5 || q.some(isNaN)) return;
    H.tracers.push({ a: muzzle(o, o.a, o.ap || 0), b: [q[1], q[2], q[3]], hit: !!q[4], until: performance.now() + (window.__trLife || 260) });
    const d = Math.hypot(o.x - player.x, o.z - player.z); const v = Math.max(0, 1 - d / 120);
    tone(220, 60, 0.14, 0.25 * v, 'square'); tone(1600, 400, 0.05, 0.12 * v, 'sawtooth');
  };
  N.setCam = (eye, tgt) => { H.eye = eye; H.tgt = tgt; };
  N.eyeH = () => (H.code && H.myProp && H.role(N.uid) === 'hider' && (H.phase() === 'hide' || H.phase() === 'seek')) ? Math.max(0.45, Math.min(1.7, PROPDEF[H.myProp.k].h * 0.85)) : 0;
  // ---- som (WebAudio) ----
  let AC = null;
  const audio = () => { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (AC && AC.state === 'suspended') AC.resume(); return AC; };
  addEventListener('pointerdown', audio, { passive: true }); addEventListener('keydown', audio);
  function tone(f0, f1, dur, vol, type, delay) {
    const ac = audio(); if (!ac || vol <= 0.002) return;
    const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  const sndTaunt = v => { tone(880, 1320, 0.16, v, 'triangle'); tone(1320, 990, 0.16, v, 'triangle', 0.18); tone(990, 1760, 0.22, v, 'triangle', 0.36); };
  const sndShot = () => { tone(220, 60, 0.14, 0.25, 'square'); tone(1600, 400, 0.05, 0.12, 'sawtooth'); };
  const sndHit = () => { tone(660, 660, 0.1, 0.25, 'square'); tone(990, 990, 0.18, 0.25, 'square', 0.1); };
  // ---- interface ----
  const roomEl = $('room'), hud = $('huntHud'), blind = $('blind'), cross = $('cross'), resEl = $('result');
  const bAct = $('btnAct'), bLock = $('btnLock'), bTaunt = $('btnTaunt'), bCar = $('btnCar');
  const fmt = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function roomUI() {
    if (!H.code) { roomEl.style.display = 'none'; return; }
    const m = H.meta || {}, ph = H.phase(), pres = H.present(), host = m.host === N.uid, sc = m.score || {};
    roomEl.style.display = ph === 'lobby' ? 'block' : 'none';
    $('roomCode').textContent = H.code;
    const rows = pres.map(u => { const o = u === N.uid ? { n: N.name } : N.others.get(u) || {}; return { u, n: o.n || '?', css: u === N.uid ? LOOK_CSS[N.look] : (o.el ? o.el.style.borderColor : '#888'), pts: sc[u] || 0 }; }).sort((a, b) => b.pts - a.pts);
    const html = rows.map(r => `<div><span class="dot" style="background:${r.css}"></span>${r.u === m.host ? '👑 ' : ''}${esc(r.n)}${r.u === N.uid ? ' (você)' : ''}<span class="pts">${r.pts} pts</span></div>`).join('');
    if ($('roomList').innerHTML !== html) $('roomList').innerHTML = html;
    $('cfgHide').disabled = $('cfgSeek').disabled = !host;
    if (!host && m.hide) { $('cfgHide').value = String(m.hide); $('cfgSeek').value = String(m.seek); }
    $('roomStart').style.display = host ? '' : 'none';
    $('roomStart').disabled = pres.length < 2;
    $('roomMsg').textContent = host ? (pres.length < 2 ? 'Mande o código para os amigos. Precisa de 2 jogadores ou mais.' : 'Tudo pronto! O pegador será sorteado.') : 'Aguardando ' + nameOf(m.host) + ' começar a partida…';
  }
  function hudUI() {
    const ph = H.phase(), on = !!H.code && (ph === 'hide' || ph === 'seek'), m = H.meta || {}, me = H.role(N.uid);
    hud.style.display = on ? 'block' : 'none';
    document.body.classList.toggle('hunting', on); document.body.classList.toggle('inroom', !!H.code && ph === 'lobby');
    blind.style.display = on && me === 'seeker' && ph === 'hide' ? 'flex' : 'none';
    cross.style.display = on && me === 'seeker' && ph === 'seek' ? 'block' : 'none';
    document.body.classList.toggle('aim', on && me === 'seeker' && ph === 'seek');
    bCar.style.display = H.code ? 'none' : '';
    const el = (sNow() - (m.t0 || 0)) / 1000;
    if (on) {
      const alive = Object.keys(m.parts || {}).filter(u => u !== m.seeker && !H.caught[u] && H.present().includes(u)).length;
      const left = ph === 'hide' ? m.hide - el : m.hide + m.seek - el;
      $('hhTime').textContent = fmt(left);
      if (me === 'seeker') { $('hhPhase').textContent = ph === 'hide' ? 'ESPERE…' : 'PROCURE!'; $('hhInfo').textContent = `Escondidos: ${alive} · Vida ${H.hp}`; $('blindT').textContent = Math.max(0, Math.ceil(m.hide - el)); }
      else if (me === 'hider') { $('hhPhase').textContent = ph === 'hide' ? 'ESCONDA-SE!' : 'NÃO SE MEXA…'; $('hhInfo').textContent = (H.myProp ? 'Você é: ' + PROPDEF[H.myProp.k].nome : 'Chegue perto de um objeto e toque em VIRAR') + ` · 🎯 ${nameOf(m.seeker)}`; }
      else { $('hhPhase').textContent = me === 'out' ? 'VOCÊ FOI ACHADO' : 'ASSISTINDO'; $('hhInfo').textContent = `Escondidos: ${alive} · 🎯 ${nameOf(m.seeker)}`; }
      $('hhKeys').textContent = me === 'seeker' ? (ph === 'seek' ? 'Espaço: atirar · arraste o mouse para mirar' : '') : me === 'hider' ? 'Espaço: virar objeto · T: travar' + (ph === 'seek' ? ' · G: provocar' : '') : '';
      $('hpBar').style.display = me === 'seeker' ? 'block' : 'none'; $('hpBar').firstChild.style.width = H.hp + '%';
    }
    const hider = on && me === 'hider', seeker = on && me === 'seeker' && ph === 'seek';
    bAct.style.display = hider || seeker ? '' : 'none';
    bAct.classList.toggle('shoot', seeker); bAct.innerHTML = seeker ? '🎯<span>ATIRAR</span>' : '🎭<span>VIRAR</span>';
    bLock.style.display = hider && H.myProp ? '' : 'none'; bLock.classList.toggle('on', H.locked); bLock.innerHTML = H.locked ? '🔒<span>TRAVADO</span>' : '🔓<span>TRAVAR</span>';
    bTaunt.style.display = hider && ph === 'seek' ? '' : 'none';
  }
  // ---- ações ----
  H.virar = () => {
    let best = null, bd = 5;
    for (const p of PROPS) { const d = Math.hypot(p.x - player.x, p.z - player.z); if (d < bd) { bd = d; best = p; } }
    if (!best) { toast('Chegue perto de um objeto: lixeira, poste, carro, arbusto, banquinho…', 3000); return; }
    H.myProp = { k: best.k, off: best.a - player.a, col: best.col, s: best.s }; H.locked = false; N.force = true;
    toast('Você virou: ' + PROPDEF[best.k].nome + '!');
  };
  H.lock = () => { if (!H.myProp) return toast('Vire um objeto primeiro'); H.locked = !H.locked; toast(H.locked ? '🔒 Travado. Não dá para andar.' : '🔓 Destravado', 1500); };
  H.taunt = auto => {
    if (performance.now() - H.lastTauntAt < 4000 && !auto) return;
    H.tt++; H.lastTauntAt = performance.now(); H.lastTauntS = sNow(); N.force = true; sndTaunt(0.18);
    toast(auto ? '📣 Provocação automática! O pegador ouviu.' : '📣 Provocou!', 1800);
  };
  H.onTaunt = (uid, o) => {
    const d = Math.hypot(o.x - player.x, o.z - player.z);
    sndTaunt(Math.max(0, 1 - d / 80) * 0.3);
    if (!o.bub) { o.bub = document.createElement('div'); o.bub.className = 'bubble'; lblLayer.appendChild(o.bub); }
    o.bub.textContent = '♪ ♫ ♪'; o.bubUntil = performance.now() + 2500; o.bubTaunt = true;
  };
  H.shoot = () => {
    const now = performance.now(); if (now - H.lastShot < 700 || !H.eye) return; H.lastShot = now;
    const m = H.meta, ox = H.tgt[0], oy = H.tgt[1], oz = H.tgt[2];
    let dx = H.tgt[0] - H.eye[0], dy = H.tgt[1] - H.eye[1], dz = H.tgt[2] - H.eye[2]; const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
    const hl = Math.hypot(dx, dz) || 1e-6; let hit = null, ht = 45;
    for (const [uid, o] of N.others) {
      if (o.stale || H.role(uid) !== 'hider') continue;
      const def = o.pr && PROPDEF[o.pr] ? PROPDEF[o.pr] : { r: 0.45, h: 1.85 }, base = surfAt(o.x, o.z);
      // raio contra cilindro vertical
      const rx = o.x - ox, rz = o.z - oz, tc = (rx * dx + rz * dz) / (hl * hl);
      const cx = dx * tc - rx, cz = dz * tc - rz, dist = Math.hypot(cx, cz), R = def.r + 0.2;
      if (dist > R) continue;
      const half = Math.sqrt(R * R - dist * dist) / hl;
      for (const t of [tc - half, tc, tc + half]) { if (t < 0 || t > ht) continue; const y = oy + dy * t; if (y >= base - 0.25 && y <= base + def.h + 0.25) { hit = uid; ht = t; break; } }
    }
    const end = hit ? [ox + dx * ht, oy + dy * ht, oz + dz * ht] : (() => { let t = 0.5; while (t < 40) { const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t; if (y < groundAt(x, z) || !freeAt(x, z, 0.05)) break; t += 0.5; } return [ox + dx * t, oy + dy * t, oz + dz * t]; })();
    H.tracers.push({ a: muzzle(player, player.a, player.gun || 0), b: end, hit: !!hit, small: cam.fp, until: now + (window.__trLife || 260) });
    H.nShot = (H.nShot || 0) + 1; H.shot = [H.nShot, ...end.map(v => +v.toFixed(2)), hit ? 1 : 0].join(','); N.force = true;
    sndShot();
    if (hit) { sndHit(); N.db.ref(N.base + 'caught/' + hit).set(TS()); toast('🎯 ACERTOU! Era ' + nameOf(hit) + '!'); }
    else { H.hp = Math.max(0, H.hp - 10); N.force = true; toast(H.hp > 0 ? 'Errou! −10 de vida' : 'Sua vida acabou!', 1400); }
  };
  H.act = () => { const r = H.role(N.uid), ph = H.phase(); if (r === 'hider' && (ph === 'hide' || ph === 'seek')) H.virar(); else if (r === 'seeker' && ph === 'seek') H.shoot(); };
  bAct.onclick = () => H.act(); bLock.onclick = () => H.lock(); bTaunt.onclick = () => H.taunt(false);
  for (const b of [bAct, bLock, bTaunt]) b.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
  window.__hunt = {
    active: () => !!H.code,
    frozen: () => !!H.code && ((H.role(N.uid) === 'seeker' && H.phase() === 'hide') || (H.locked && !!H.myProp && H.role(N.uid) === 'hider')),
    shoulder: () => !!H.code && H.role(N.uid) === 'seeker' && H.phase() === 'seek',
    key: code => {
      if (!H.code) return false;
      if (code === 'Space') { H.act(); return true; }
      if (code === 'KeyT' && H.role(N.uid) === 'hider') { H.lock(); return true; }
      if (code === 'KeyG' && H.role(N.uid) === 'hider' && H.phase() === 'seek') { H.taunt(false); return true; }
      return false;
    },
  };
  // ---- rodadas ----
  function startRound(m) {
    H.myProp = null; H.locked = false; H.hp = 100; H.tt = 0; H.lastTauntS = sNow(); H.ending = -1; resEl.style.display = 'none';
    const me = H.role(N.uid);
    if (m.parts && m.parts[N.uid]) {   // todos começam juntos no ponto de partida
      player.car = false; player.cv = 0;
      let px = m.sx, pz = m.sz;
      if (me !== 'seeker') for (let k = 0; k < 30; k++) { const a = Math.random() * 6.283, r = 2 + Math.random() * 4, x = m.sx + Math.cos(a) * r, z = m.sz + Math.sin(a) * r; if (freeAt(x, z, 0.4)) { px = x; pz = z; break; } }
      player.x = px; player.z = pz;
    }
    sys(`🎯 Rodada ${m.round}: ${nameOf(m.seeker)} é o pegador!`);
    if (me === 'hider') toast(`Esconda-se! ${nameOf(m.seeker)} é o pegador`, 3000);
    else if (me !== 'seeker') toast('Rodada em andamento: você vai assistir', 3000);
    N.force = true;
  }
  function showResult(m) {
    const sc = m.score || {}, surv = m.surv || {};
    const t = { seeker: `🎯 ${nameOf(m.seeker)} achou todo mundo!`, hiders: '🎭 Os escondidos venceram! O tempo acabou.', hiders_hp: '🎭 Os escondidos venceram! O pegador ficou sem vida.', abort: 'Rodada cancelada: o pegador saiu.' }[m.win] || 'Fim da rodada';
    $('resTitle').textContent = t;
    const ids = Object.keys(m.parts || {});
    $('resBody').innerHTML = ids.map(u => `<div>${u === m.seeker ? '🎯' : surv[u] ? '🎭' : '❌'} ${esc(nameOf(u))}<span class="pts">${sc[u] || 0} pts</span></div>`).join('');
    resEl.style.display = 'block';
    H.myProp = null; H.locked = false; N.force = true;
  }
  function onMeta(m) {
    const prev = H.meta; H.meta = m;
    if (!m) return;
    if (prev && prev.host && m.host && prev.host !== m.host) sys('👑 ' + nameOf(m.host) + ' agora é o dono da sala.');
    if (m.phase === 'play' && m.round !== H.round) { H.round = m.round; startRound(m); }
    if (m.phase === 'end' && (!prev || prev.phase !== 'end')) showResult(m);
    if (m.phase === 'lobby') { resEl.style.display = 'none'; H.myProp = null; H.locked = false; H.hp = 100; }
    if (H.round === -1) H.round = m.round;   // entrou com a partida rolando: espera a próxima
    roomUI();
  }
  function onCaught(c) {
    for (const u in c) if (!H.caught[u]) {
      sys(`🎯 ${nameOf((H.meta || {}).seeker)} achou ${nameOf(u)}!`);
      if (u === N.uid) { H.myProp = null; H.locked = false; N.force = true; toast('Você foi achado! Agora está assistindo.', 3000); }
    }
    H.caught = c;
  }
  H.tick = dt => {
    player.gun = undefined;
    if (!H.code) return;
    if (window.__hunt.shoulder() && H.eye) { const dx = H.tgt[0] - H.eye[0], dy = H.tgt[1] - H.eye[1], dz = H.tgt[2] - H.eye[2]; player.gun = Math.max(-1.2, Math.min(1.0, Math.atan2(dy, Math.hypot(dx, dz)))); }
    const now = performance.now();
    if (now - H.uiT > 200) { H.uiT = now; hudUI(); roomUI(); }
    const m = H.meta; if (!m) return;
    const ph = H.phase(), me = H.role(N.uid);
    // área do jogo: 200 m em volta do ponto de partida
    if ((ph === 'hide' || ph === 'seek') && (me === 'hider' || me === 'seeker')) {
      const dx = player.x - m.sx, dz = player.z - m.sz, d = Math.hypot(dx, dz), R = 200;
      if (d > R) { player.x = m.sx + dx / d * R; player.z = m.sz + dz / d * R; if (now - (H.areaT || 0) > 3000) { H.areaT = now; toast('Fique dentro da área do jogo (200 m)'); } }
    }
    // provocação automática a cada 60 s
    if (ph === 'seek' && me === 'hider' && sNow() - (H.lastTauntS || 0) > 60000) H.taunt(true);
    // dono da sala: migração e controle da rodada
    if (now - H.hostT < 500) return; H.hostT = now;
    const pres = H.present(), metaRef = N.db.ref(N.base + 'meta');
    if (m.host && !pres.includes(m.host) && pres.slice().sort()[0] === N.uid) { metaRef.child('host').set(N.uid); return; }
    if (m.host !== N.uid) return;
    if (m.phase === 'play' && H.ending !== m.round) {
      const hiders = Object.keys(m.parts || {}).filter(u => u !== m.seeker);
      const alive = hiders.filter(u => pres.includes(u) && !H.caught[u]);
      const shp = m.seeker === N.uid ? H.hp : (N.others.get(m.seeker) || {}).hp;
      const el = sNow() - m.t0;
      let win = null;
      if (!pres.includes(m.seeker)) win = 'abort';
      else if (el > m.hide * 1000 && alive.length === 0) win = 'seeker';
      else if (typeof shp === 'number' && shp <= 0) win = 'hiders_hp';
      else if (el > (m.hide + m.seek) * 1000) win = 'hiders';
      if (win) {
        H.ending = m.round;
        const sc = Object.assign({}, m.score || {}), nCaught = hiders.filter(u => H.caught[u]).length, surv = {};
        if (win !== 'abort') {
          sc[m.seeker] = (sc[m.seeker] || 0) + nCaught + (win === 'seeker' ? 2 : 0);
          for (const u of alive) { sc[u] = (sc[u] || 0) + 3; surv[u] = 1; }
        }
        metaRef.update({ phase: 'end', win, te: TS(), score: sc, surv });
      }
    } else if (m.phase === 'end' && sNow() - (m.te || 0) > 9000) metaRef.update({ phase: 'lobby' });
  };
  $('roomStart').onclick = () => {
    const m = H.meta || {}, pres = H.present(); if (m.host !== N.uid || pres.length < 2) return;
    let pool = pres.filter(u => u !== m.last); if (pool.length === 0 || pres.length === 2) pool = pres;
    const seeker = pool[Math.floor(Math.random() * pool.length)], parts = {}; pres.forEach(u => parts[u] = true);
    N.db.ref(N.base + 'caught').remove();
    N.db.ref(N.base + 'meta').update({ phase: 'play', seeker, last: seeker, parts, round: (m.round || 0) + 1, t0: TS(), hide: +$('cfgHide').value, seek: +$('cfgSeek').value, sx: +player.x.toFixed(2), sz: +player.z.toFixed(2), win: null, surv: null, te: null });
  };
  $('roomLeave').onclick = () => N.leave();
  $('roomMin').onclick = () => { roomEl.classList.toggle('min'); $('roomMin').textContent = roomEl.classList.contains('min') ? '+' : '–'; };
  $('roomCopy').onclick = () => { const t = H.code; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Código ' + t + ' copiado!'), () => toast('Código: ' + t)); };
  H.enter = code => {
    H.code = code; H.caught = {}; H.round = -1; H.meta = null; H.myProp = null; H.hp = 100;
    const mr = N.db.ref(N.base + 'meta'), cr = N.db.ref(N.base + 'caught');
    mr.on('value', s => onMeta(s.val())); cr.on('value', s => onCaught(s.val() || {}));
    H.refs = [mr, cr];
    sys(`Você entrou na sala ${code}. Mande o código para os amigos!`);
    roomUI(); hudUI();
  };
  H.exit = () => {
    for (const r of H.refs) r.off(); H.refs = [];
    H.code = null; H.meta = null; H.myProp = null; H.locked = false; H.caught = {};
    for (const el of [roomEl, hud, blind, cross, resEl, bAct, bLock, bTaunt]) el.style.display = 'none';
    bCar.style.display = ''; document.body.classList.remove('hunting', 'inroom');
  };
  // ---- tela inicial: criar / entrar ----
  function showPick(v) { $('lobbyMain').style.display = v ? 'none' : ''; $('huntPick').style.display = v ? '' : 'none'; msgEl.textContent = ''; }
  $('btnHunt').onclick = () => showPick(true);
  $('btnBack').onclick = () => showPick(false);
  if (!CFG) $('btnHunt').disabled = true;
  const LET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const getName = () => { const n = nameIn.value.trim().replace(/\s+/g, ' ').slice(0, 16); if (!n) { msgEl.textContent = 'Digite seu nome primeiro.'; nameIn.focus(); } return n; };
  async function enterRoom(code, create) {
    const n = getName(); if (!n) return;
    for (const b of ['btnCreate', 'btnJoin']) $(b).disabled = true;
    msgEl.textContent = create ? 'Criando sala…' : 'Entrando…';
    try {
      await N.ready();
      if (create) {
        for (let k = 0; k < 8; k++) {
          code = Array.from({ length: 6 }, () => LET[Math.floor(Math.random() * LET.length)]).join('');
          const ps = await N.db.ref('rooms/' + code + '/players').once('value');
          if (!ps.exists()) break;
        }
        await N.db.ref('rooms/' + code + '/meta').set({ host: N.uid, phase: 'lobby', round: 0, hide: 45, seek: 300, score: {}, t0: 0 });
        await Promise.all([N.db.ref('rooms/' + code + '/chat').remove(), N.db.ref('rooms/' + code + '/caught').remove()]);
      } else {
        const ms = await N.db.ref('rooms/' + code + '/meta').once('value');
        if (!ms.exists()) throw { message: 'Sala ' + code + ' não encontrada. Confira o código.' };
      }
      await connect(n, 'rooms/' + code + '/');
      H.enter(code); start(); showPick(false);
    } catch (e) { console.error(e); msgEl.textContent = e && e.message && e.message.startsWith('Sala') ? e.message : 'Não consegui ' + (create ? 'criar' : 'entrar') + ' (' + (e.code || e.message || e) + ').'; }
    for (const b of ['btnCreate', 'btnJoin']) $(b).disabled = false;
  }
  $('btnCreate').onclick = () => enterRoom(null, true);
  $('btnJoin').onclick = () => { const c = $('roomIn').value.toUpperCase().replace(/[^A-Z]/g, ''); if (c.length !== 6) { msgEl.textContent = 'O código tem 6 letras.'; return; } enterRoom(c, false); };
  $('roomIn').addEventListener('input', () => { const i = $('roomIn'), v = i.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6); if (i.value !== v) i.value = v; });
  $('roomIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });
  return N;
})();

// ---------------- loop ----------------
let last = performance.now(), T0 = last, frames = 0, fpsT = 0, fps = 0;
function step(dt) {
  // input vector
  let ix = 0, iy = 0;
  if (keys.KeyW || keys.ArrowUp) iy += 1;
  if (keys.KeyS || keys.ArrowDown) iy -= 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (joy.id !== null) { ix += joy.dx; iy -= joy.dy; }
  if (window.__hunt && window.__hunt.frozen()) { ix = 0; iy = 0; }
  if (keys.KeyQ) cam.yaw += dt * 1.8;
  if (keys.KeyE) cam.yaw -= dt * 1.8;
  if (keys.KeyR) cam.pitch = Math.min(1.45, cam.pitch + dt);
  if (keys.KeyF) cam.pitch = Math.max(cam.fp ? -1.35 : -1.1, cam.pitch - dt);
  if (keys.Equal || keys.NumpadAdd) cam.dist = Math.max(7, cam.dist * (1 - dt));
  if (keys.Minus || keys.NumpadSubtract) cam.dist = Math.min(260, cam.dist * (1 + dt));
  const jl = joy.id !== null ? Math.min(1, Math.hypot(joy.dx, joy.dy)) : 0;
  const run = keys.ShiftLeft || keys.ShiftRight || jl > 0.82;
  player.running = run && (jl > 0.05 || ix || iy);
  if (player.sit) {   // sentado no banco: mexer levanta
    if (ix || iy || jl > 0.3 || player.car) { player.x = player.sit.sx; player.z = player.sit.sz; player.sit = null; }
    else { player.x = player.sit.x; player.z = player.sit.z; player.a = player.sit.a; player.speed = 0; ix = iy = 0; }
  }
  if (!player.car) {
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    let mx_ = fx * iy + rx * ix, mz_ = fz * iy + rz * ix;
    const l = Math.hypot(mx_, mz_);
    const target = l <= 0.05 ? 0 : joy.id !== null ? (jl <= 0.82 ? 4.2 * Math.min(1, jl / 0.6) : 4.2 + 8.3 * (jl - 0.82) / 0.18) : (run ? 12.5 : 4.2);
    player.speed += (target - player.speed) * Math.min(1, dt * 10);
    if (l > 0.05) {
      mx_ /= l; mz_ /= l;
      const ta = Math.atan2(mz_, mx_);
      let da = ta - player.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      player.a += da * Math.min(1, dt * 12);
      const dist = player.speed * dt, nsub = Math.max(1, Math.ceil(dist / 0.2));
      for (let k = 0; k < nsub; k++) { // sub-steps so fast running can't pass through thin walls
        const nx = player.x + mx_ * dist / nsub, nz = player.z + mz_ * dist / nsub;
        if (freeAt(nx, nz, 0.35)) { player.x = nx; player.z = nz; }
        else if (freeAt(nx, player.z, 0.35)) player.x = nx;
        else if (freeAt(player.x, nz, 0.35)) player.z = nz;
        else break;
      }
      player.walk += dt * player.speed * 2.3;
    }
    if (cam.fp || (window.__hunt && window.__hunt.shoulder())) player.a = Math.atan2(-Math.cos(cam.yaw), -Math.sin(cam.yaw));   // pegador olha para a mira
  } else {
    const thr = joy.id !== null ? Math.max(-1, Math.min(1, iy)) : Math.sign(iy);
    const acc = thr > 0.05 ? 9 * Math.min(1, thr / 0.6) : thr < -0.05 ? (player.cv > 0.5 ? -16 : -6) * Math.min(1, -thr / 0.6) : -Math.sign(player.cv) * 3;
    player.cv += acc * dt;
    const vmax = run ? 30 : 18;
    player.cv = Math.max(-6, Math.min(vmax, player.cv));
    if (iy === 0 && Math.abs(player.cv) < 0.2) player.cv = 0;
    const steer = ix * Math.min(1, Math.abs(player.cv) / 4) * 1.9 * Math.sign(player.cv);
    player.a += steer * dt;
    const fx = Math.cos(player.a), fz = Math.sin(player.a);
    const nx = player.x + fx * player.cv * dt, nz = player.z + fz * player.cv * dt;
    const ok = freeAt(nx, nz, 0.9) && freeAt(nx + fx * 1.8, nz + fz * 1.8, 0.6) && freeAt(nx - fx * 1.8, nz - fz * 1.8, 0.6);
    if (ok) { player.x = nx; player.z = nz; } else player.cv *= -0.25;
    // camera auto-follow behind the car
    cam.follow = Math.max(0, cam.follow - dt);
    if (cam.follow <= 0 && Math.abs(player.cv) > 1) {
      const ty = Math.atan2(-Math.cos(player.a), -Math.sin(player.a));
      let d = ty - cam.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      cam.yaw += d * Math.min(1, dt * 2.5);
    }
  }
  // traffic
  for (const c of traffic) {
    placeCar(c);
    const dx = player.x - c.x, dz = player.z - c.z, d = Math.hypot(dx, dz);
    const ahead = (dx * Math.cos(c.a_) + dz * Math.sin(c.a_)) > 0;
    const vmax = c.t === 'secondary' ? c.vmax0 : Math.min(c.vmax0, 10);
    const tv = (d < 9 && ahead) ? 0 : vmax;
    c.v += (tv - c.v) * Math.min(1, dt * (tv < c.v ? 4 : 1));
    c.s += c.v * dt;
    let guard = 0; while (c.s >= c.L && guard++ < 8) { const over = c.s - c.L; carNext(c); c.s = over; }
  }
}
function frame_() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  step(dt);
  const t = (now - T0) / 1000;
  // dynamic mesh
  dynB.reset();
  if (!cam.fp && !(window.__net && window.__net.drawMe && window.__net.drawMe(dynB))) buildPlayer(dynB, player, MY_LOOK);
  if (cam.fp && player.car) { // capô e painel do carro em primeira pessoa
    const T = groundFrame(player.x, player.z, player.a, 0.0), cc = MY_LOOK.car || PCAR;
    box(dynB, T, 1.25, 2.1, 0.35, 0.98, -0.9, 0.9, cc, cc);
    box(dynB, T, 0.95, 1.25, 0.94, 1.0, -0.88, 0.88, hex('#1b1d22'), hex('#26282c'));
    for (const v of [-0.9, 0.9]) box(dynB, T, 0.2, 0.95, 1.05, 1.65, v - 0.04, v + 0.04, cc, cc);   // colunas
  }
  if (window.__net) window.__net.frame(dynB, dt);
  for (const f of FLY_SPOTS) for (let k = 0; k < 7; k++) {
    const ph = t * (2.2 + k * 0.37) + k * 1.9, r = 0.25 + 0.18 * Math.sin(t * 1.3 + k);
    const fx = f.x + Math.cos(ph) * r, fz = f.z + Math.sin(ph * 1.1) * r, fy = f.y + 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(t * 3.1 + k * 2.3));
    box(dynB, frame(fx, fy, fz, ph), -0.035, 0.035, 0, 0.04, -0.03, 0.03, hex('#101010'), hex('#101010'), F_UNLIT);
  }
  for (const n of NPCS) {
    if (n.home) {   // Portela
      portelaUpdate(n);
      const poi = POIS.find(p => p.n === 'Portela'); if (poi && (poi.x !== n.x || poi.z !== n.z)) { poi.x = n.x; poi.z = n.z; poi.gy = undefined; }
      if (!n.riding && PORTELA_PARK) buildProp(dynB, 'bike', PORTELA_PARK.x, PORTELA_PARK.z, PORTELA_PARK.a, { y: PORTELA_PARK.y });
    }
    const dx = player.x - n.x, dz = player.z - n.z, dd = Math.hypot(dx, dz);
    let want = 0;
    if (dd < 14) { want = Math.atan2(dz, dx) - n.base; while (want > Math.PI) want -= 2 * Math.PI; while (want < -Math.PI) want += 2 * Math.PI; want = Math.max(-1.3, Math.min(1.3, want)); }
    n.look += (want - n.look) * Math.min(1, dt * 4);
    if (n.riding) buildRider(dynB, n, t); else buildNPC(dynB, n, t);
    // speech bubble
    if (dd < (n.r || 6) && !n.near) { n.near = true; const L = n.says || SAYS; n.line = L[(n.k = ((n.k || 0) + 1)) % L.length]; }
    if (dd > (n.r || 6) + 2) n.near = false;
    n.show = dd < (n.r || 6);
  }
  gateFrame(dynB, dt);
  vhsFrame(dynB, t);
  gate489Frame(dynB, dt);
  beagleFrame(dynB, dt, t);
  benchFrame();
  dogsFrame(dynB, dt, t);
  { const SKY = window.__sky = skyState();
    if (SKY.night > 0.05) for (const p of PROPS) if ((p.k === 'luminaria' || p.k === 'poste') && Math.abs(p.x - player.x) < 300 && Math.abs(p.z - player.z) < 300) {   // lâmpadas acesas
      const T = frame(p.x, surfAt(p.x, p.z), p.z, p.a), g = Math.round(150 + 105 * SKY.night), c = [g, Math.round(g * 0.86), Math.round(g * 0.6)];
      if (p.k === 'luminaria') box(dynB, T, 1.42, 2.08, 6.52, 6.6, -0.22, 0.22, c, c, F_GLOW);
      else { box(dynB, T, 2.4, 3.0, 7.48, 7.57, -0.19, 0.19, c, c, F_GLOW); box(dynB, T, 2.47, 2.93, 7.42, 7.48, -0.14, 0.14, c, c, F_GLOW); }
    }
    drawSky(dynB, [player.x, groundAt(player.x, player.z) + 2, player.z], SKY); }
  for (const c of traffic) carMesh(dynB, groundFrame(c.x, c.z, c.a_, 0.0), c.col);
  skyMB.reset(); skyMsgFrame(skyMB, t);
  if (skyMB.n) { gl.bindBuffer(gl.ARRAY_BUFFER, skyMVBO); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(skyMB.buf, 0, skyMB.n * 20), gl.DYNAMIC_DRAW); }
  gl.bindBuffer(gl.ARRAY_BUFFER, dynVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(dynB.buf, 0, dynB.n * 20), gl.DYNAMIC_DRAW);
  const dynM = { vbo: dynVBO, n: dynB.n };

  // camera
  const gy = surfAt(player.x, player.z);
  camY += (gy - camY) * Math.min(1, dt * 8);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  let eye, tgt;
  if (cam.fp) { // primeira pessoa: olhos na altura da cabeça (ou do objeto, no esconde-esconde)
    const eh = (window.__net && window.__net.eyeH && window.__net.eyeH()) || (player.car ? 1.48 : 1.68 * PSC);
    const fx = Math.cos(player.a), fz = Math.sin(player.a);
    eye = player.car ? [player.x + fx * 0.15 - fz * 0.38, camY + eh, player.z + fz * 0.15 + fx * 0.38] : [player.x + fx * 0.12, camY + eh, player.z + fz * 0.12];
    tgt = [eye[0] - Math.sin(cam.yaw) * cp, eye[1] - sp, eye[2] - Math.cos(cam.yaw) * cp];
  } else {
    tgt = [player.x, camY + (player.car ? 1.2 : 1.3 * PSC), player.z];
    if (window.__hunt && window.__hunt.shoulder()) { tgt[0] += Math.cos(cam.yaw) * 0.9; tgt[2] -= Math.sin(cam.yaw) * 0.9; tgt[1] += 0.35; }   // mira por cima do ombro
    // olhando para cima: a câmera para de descer (fica baixa, atrás do jogador, mais perto) e só o olhar sobe
    const PL = 0.14, up = Math.max(0, PL - cam.pitch), pe = Math.max(cam.pitch, PL), de = cam.dist * (1 - 0.55 * Math.min(1, up / 0.7));
    eye = [tgt[0] + Math.sin(cam.yaw) * Math.cos(pe) * de, tgt[1] + Math.sin(pe) * de, tgt[2] + Math.cos(cam.yaw) * Math.cos(pe) * de];
    eye[1] = Math.max(eye[1], groundAt(eye[0], eye[2]) + 1.5);
    if (up > 0) { const L = Math.hypot(tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]); tgt = [eye[0] - Math.sin(cam.yaw) * cp * L, eye[1] - sp * L, eye[2] - Math.cos(cam.yaw) * cp * L]; }
  }
  if (window.__net && window.__net.setCam) window.__net.setCam(eye, tgt);
  const proj = persp(cam.fp ? 0.95 : cam.dist > 60 ? 0.6 : 0.75, cv.width / cv.height, cam.fp ? 0.3 : 1.0, 2600);
  const VP = mul(proj, lookAt(eye, tgt, [0, 1, 0]));
  if (window.__vhsProj) window.__vhsProj(VP);
  if (window.__skyProj) window.__skyProj(VP);
  const fogR = cam.fp ? [220, 760] : [Math.max(220, cam.dist * 3), Math.max(760, cam.dist * 6)];

  // shadow pass
  const SR = Math.min(170, 70 + cam.dist * 1.2);
  const sc = [player.x - Math.sin(cam.yaw) * SR * 0.35, gy, player.z - Math.cos(cam.yaw) * SR * 0.35];
  const SKY = window.__sky || skyState(), LD = SKY.lightDir;
  const sEye = [sc[0] + LD[0] * 400, gy + LD[1] * 400, sc[2] + LD[2] * 400];
  const sProj = ortho(-SR, SR, -SR, SR, 50, 800);
  let SVP = mul(sProj, lookAt(sEye, sc, [0, 1, 0]));
  { // texel snapping to avoid shimmering
    const o = xform(SVP, [0, 0, 0]); const hs = SMS / 2;
    const ox = (Math.round(o[0] * hs) - o[0] * hs) / hs, oy = (Math.round(o[1] * hs) - o[1] * hs) / hs;
    SVP[12] += ox; SVP[13] += oy;
  }
  if (shadowsOn) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, smFB); gl.viewport(0, 0, SMS, SMS);
    gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(PS); gl.uniformMatrix4fv(SU.uSVP, false, SVP);
    gl.enableVertexAttribArray(SLOC.aP);
    const lim = SR * 1.45 + 75;
    for (const c of meshes) { if (Math.abs(c.cx - sc[0]) > lim || Math.abs(c.cz - sc[2]) > lim) continue; bindShadow(c.m); gl.drawArrays(gl.TRIANGLES, 0, c.m.n); }
    bindShadow(dynM); gl.drawArrays(gl.TRIANGLES, 0, dynM.n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // main pass
  gl.viewport(0, 0, cv.width, cv.height);
  gl.clearColor(SKY.fog[0], SKY.fog[1], SKY.fog[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  gl.useProgram(PM);
  gl.uniformMatrix4fv(U.uVP, false, VP); gl.uniformMatrix4fv(U.uSVP, false, SVP);
  gl.uniform3fv(U.uL, LD); gl.uniform3fv(U.uEye, eye); gl.uniform3fv(U.uFog, SKY.fog); gl.uniform2fv(U.uFogR, fogR);
  gl.uniform1f(U.uT, t); gl.uniform1f(U.uLv, 22); gl.uniform1f(U.uShadowOn, shadowsOn && SKY.shadowK > 0 ? 1 : 0);
  gl.uniform3fv(U.uSunC, SKY.sunC); gl.uniform3fv(U.uAmbC, SKY.ambC); gl.uniform3fv(U.uTint, SKY.tint); gl.uniform1f(U.uNight, SKY.night);
  gl.uniform4fv(U.uLamp, lampState(SKY, tgt[0], tgt[2]));
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, smTex); gl.uniform1i(U.uSM, 0);
  gl.enableVertexAttribArray(LOC.aP); gl.enableVertexAttribArray(LOC.aN); gl.enableVertexAttribArray(LOC.aC);
  bindMain(groundM); gl.drawArrays(gl.TRIANGLES, 0, groundM.n);
  const vis = fogR[1] + 80;
  const fwx = -Math.sin(cam.yaw), fwz = -Math.cos(cam.yaw);
  for (const c of meshes) {
    const b = c.bb, nx = Math.max(b[0], Math.min(eye[0], b[3])), nz = Math.max(b[2], Math.min(eye[2], b[5]));
    if (Math.hypot(nx - eye[0], nz - eye[2]) > vis) continue;
    if (!boxVisible(VP, b)) continue;
    bindMain(c.m); gl.drawArrays(gl.TRIANGLES, 0, c.m.n);
  }
  bindMain(dynM); gl.drawArrays(gl.TRIANGLES, 0, dynM.n);
  if (skyMB.n) { gl.uniform1f(U.uFade, SKYMSG ? 1 - (SKYMSG.fade || 0) : 1); bindMain({ vbo: skyMVBO, n: skyMB.n }); gl.drawArrays(gl.TRIANGLES, 0, skyMB.n); }
  bindMain(farM); gl.drawArrays(gl.TRIANGLES, 0, farM.n);

  // labels
  for (const p of POIS) {
    const d = Math.hypot(p.x - player.x, p.z - player.z);
    if (p.gy === undefined) p.gy = groundAt(p.x, p.z);
    const q = xform(VP, [p.x, p.y + p.gy, p.z]);
    const show = q[3] > 0 && Math.abs(q[0]) < 1.1 && Math.abs(q[1]) < 1.1 && (p.big ? d < 420 : p.npc ? (d < 45 && d > 6) : d < 260) && (p.big ? cam.dist > 30 || d > 60 : true);
    if (show) { p.el.style.display = 'block'; p.el.style.transform = `translate(${(q[0] * 0.5 + 0.5) * innerWidth}px,${(-q[1] * 0.5 + 0.5) * innerHeight}px) translate(-50%,-100%)`; }
    else p.el.style.display = 'none';
  }
  for (const n of NPCS) {
    const q = xform(VP, [n.x, n.y + (n.style === 'note' ? 0.9 : 2.45), n.z]);
    if (!n.el) { n.el = document.createElement('div'); n.el.className = 'bubble' + (n.style === 'caudinho' ? ' mad' : n.style === 'note' ? ' note' : ''); document.getElementById('labels').appendChild(n.el); }
    if (n.show && q[3] > 0) { n.el.style.display = 'block'; n.el.innerHTML = (n.name ? '<b>' + n.name + ':</b> ' : '') + n.line; n.el.style.transform = `translate(${(q[0] * 0.5 + 0.5) * innerWidth}px,${(-q[1] * 0.5 + 0.5) * innerHeight}px) translate(-50%,-115%)`; }
    else n.el.style.display = 'none';
  }
  for (const d of DOGS.concat(BEAGLE.d ? [BEAGLE.d] : [])) {   // nome dos cães quando o jogador chega perto
    const nm = DOG_NAMES[d.kind]; if (!nm) continue;
    if (!d.el) { d.el = document.createElement('div'); d.el.className = 'lbl dog'; d.el.textContent = '🐾 ' + nm; lblLayer.appendChild(d.el); }
    const dd = Math.hypot(d.x - player.x, d.z - player.z), q = xform(VP, d.hc ? [d.hc[0], d.hc[1] + 0.08, d.hc[2]] : [d.x, surfAt(d.x, d.z) + 0.7, d.z]);
    if (dd < 7 && q[3] > 0 && Math.abs(q[0]) < 1.1 && Math.abs(q[1]) < 1.1) { d.el.style.display = 'block'; d.el.style.transform = `translate(${(q[0] * 0.5 + 0.5) * innerWidth}px,${(-q[1] * 0.5 + 0.5) * innerHeight}px) translate(-50%,-100%)`; }
    else d.el.style.display = 'none';
  }
  if (window.__net) window.__net.labels(VP);
  hudT += dt; if (hudT > 0.2) { hudT = 0; updateHUD(); drawMini(); }
  frames++; fpsT += dt; if (fpsT > 1) { fps = frames / fpsT; frames = 0; fpsT = 0; document.getElementById('fps').textContent = Math.round(fps) + ' fps'; }
  requestAnimationFrame(frame_);
}
document.getElementById('load').style.display = 'none';
updateHUD(); drawMini();
requestAnimationFrame(frame_);
window.__game = { player, cam, totalV, NPCS, DOGS, PROPS, gate: () => GATE116, beagle: () => BEAGLE, gate489: () => GATE489, bench: () => BENCH, skymsg: () => SKYMSG, vhs: () => ({ pos: vhsPos(), near: VHS.near, vis: VHS.vis, sx: VHS.tapes[0].sx, sy: VHS.tapes[0].sy, open: VHS.open, tapes: VHS.tapes, cur: VHS.cur && VHS.cur.video }), PROPDEF, freeAt, groundAt, demRaw, SEGS, setPixel: p => { pixel = p; resize(); }, traffic, stats: () => ({ totalV, chunks: meshes.length, houses: W.houses.length, trees: W.trees.length, traffic: traffic.length, shadowOK }) };
})();
