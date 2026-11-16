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
const F_PLAIN = 255, F_TEX = 204, F_WATER = 140, F_PAVE = 100, F_FAR = 50, F_UNLIT = 20;

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
const CREEK = W.creek || null;

const TS = 5; // terrain lattice spacing (m)
const LW = Math.ceil((EX1 - EX0) / TS) + 1, LH = Math.ceil((EZ1 - EZ0) / TS) + 1;
const LAT = new Float32Array(LW * LH);
for (let j = 0; j < LH; j++) for (let i = 0; i < LW; i++) {
  const x = EX0 + i * TS, z = EZ0 + j * TS;
  let h = demRaw(x, z);
  // flatten road beds
  const rs = roadSurf(x, z);
  if (rs && rs.e < TS + 8) {
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
  if (rs && rs.e < TS + 0.8) h = Math.min(h, rs.h - (rs.foot ? 0.12 : 0.22));
  LAT[j * LW + i] = h;
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
  const [hmin, hmax] = cornersH(T0, w, d);
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
    const ha = groundAt(pa[0], pa[2]), hb = groundAt(pb[0], pb[2]);
    if (real && (hf & 2)) { // gradil: low wall + iron bars + pillars
      const y0 = Math.min(ha, hb) - 0.6, yb = Math.max(ha, hb) + 0.7, yt = Math.max(ha, hb) + mh;
      box(B, T0, u0, u1, y0, yb, mv - 0.12, mv + 0.12, hex('#e2ddd2'), mcol);
      box(B, T0, u0, u1, yt - 0.06, yt, mv - 0.03, mv + 0.03, gcol, gcol);
      for (let u = u0 + 0.12; u < u1 - 0.05; u += 0.22) box(B, T0, u - 0.025, u + 0.025, yb, yt, mv - 0.025, mv + 0.025, gcol, gcol);
      for (const u of [u0, u1]) box(B, T0, u - 0.18, u + 0.18, y0, yt + 0.12, mv - 0.18, mv + 0.18, mcol, mcol);
    } else box(B, T0, u0, u1, Math.min(ha, hb) - 0.6, Math.max(ha, hb) + mh, mv - 0.12, mv + 0.12, hex('#e2ddd2'), mcol);
    maskRect(T0, u0, u1, mv - 0.15, mv + 0.15);
  };
  const condo = (hf & 32) !== 0;
  if (!condo && (real || r() < 0.85)) { if (gap0 > mu0) muro(mu0, gap0); if (gap1 < mu1) muro(gap1, mu1); }
  if (real && !condo) {
    // gate in the driveway gap (portão)
    const pa = P(T0, gap0, 0, mv), ga = groundAt(pa[0], pa[2]);
    box(B, T0, gap0, gap1, ga, ga + 2.0, mv - 0.05, mv + 0.05, gcol === GRAD[0] ? hex('#c9ccd0') : gcol, gcol);
    for (let u = gap0 + 0.2; u < gap1; u += 0.4) box(B, T0, u - 0.02, u + 0.02, ga + 0.1, ga + 1.9, mv - 0.07, mv + 0.07, hex('#00000000'.slice(0, 7)), hex('#2a2a2a'));
    maskRect(T0, gap0, gap1, mv - 0.1, mv + 0.1);
    // side walls between neighbouring lots, from the property line to the house
    for (const su of [-w / 2 - 0.4, w / 2 + 0.4]) { const pa2 = P(T0, su, 0, mv), g2 = groundAt(pa2[0], pa2[2]); const v0 = Math.min(mv, vf), v1 = Math.max(mv, vf); box(B, T0, su - 0.1, su + 0.1, g2 - 0.6, g2 + 1.9, v0, v1, hex('#e2ddd2'), mcol); }
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
      maskCircle(p[0], p[2], 0.15);
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
  const tops = PL.map(([x, z]) => { const y = surfAt(x, z); const B = chunkB(x, z), T = frame(x, y, z, 0);
    box(B, T, -0.14, 0.14, -0.3, 9, -0.14, 0.14, hex('#b9b6ad'), hex('#a7a49b'));
    box(B, T, -0.9, 0.9, 8.4, 8.55, -0.07, 0.07, hex('#8a8780'), hex('#8a8780'));
    box(B, T, -0.2, 0.2, 6.4, 6.9, -0.2, 0.2, hex('#7e848c'), hex('#6c7279'));
    maskCircle(x, z, 0.2); return [x, y, z]; });
  for (let i = 0; i < tops.length - 1; i++) {
    const a = tops[i], b = tops[i + 1]; if (Math.hypot(b[0] - a[0], b[2] - a[2]) > 45) continue;
    const B = chunkB((a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
    for (const [h, off] of [[8.55, -0.8], [8.55, 0.8], [8.55, 0], [6.7, 0]]) {
      const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz), ox = -dz / l * off * 0.0 + (off ? (dz / l) * 0 : 0);
      const pa = [a[0] + (off ? -dz / l * off : 0), a[1] + h, a[2] + (off ? dx / l * off : 0)], pb = [b[0] + (off ? -dz / l * off : 0), b[1] + h, b[2] + (off ? dx / l * off : 0)];
      const n = 4; let prev = pa;
      for (let k = 1; k <= n; k++) { const t = k / n, sag = Math.sin(t * Math.PI) * 0.55; const p = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t - sag, pa[2] + (pb[2] - pa[2]) * t]; beam(B, prev, p, 0.03, wire, F_UNLIT); prev = p; }
    }
  }
  for (const lm of (W.landmarks || [])) if (lm.type === 'esquina') { // casa de esquina com jardim (Albert Sabin x Cel. Bruno)
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
    for (const [u, v] of [[8, 14], [14, 8], [8, 26]]) { const S = at2(u, v, 0); box(B, S, -0.7, 0.7, 0, 0.9, -0.7, 0.7, hex('#3f8c3a'), hex('#357a31')); }
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
for (const a of W.areas) if (a.t === 'island') { const [cx, cz] = centroid(a.pts); tree(chunkB(cx, cz), cx, cz, 4, 1.2, true); }

// ---------------- lamps ----------------
for (const [x, z, a] of W.lamps) {
  const B = chunkB(x, z), T = frame(x, surfAt(x, z), z, a), g = hex('#7d838c');
  box(B, T, -0.12, 0.12, -0.3, 7, -0.12, 0.12, g, g);
  box(B, T, 0, 1.8, 6.8, 7.0, -0.08, 0.08, g, g);
  box(B, T, 1.4, 2.1, 6.6, 6.9, -0.25, 0.25, hex('#5c6168'), hex('#fff3c4'));
  maskCircle(x, z, 0.2);
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
  const wf = vf + 0.03;
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
    const p = P(D, 0, 0, 0); maskRect(D, -0.65, 0.65, -0.5, 0.5);
  }
  // blue water bowl
  { const Bw = yawChild(T, 0.05, 0, d / 2 + 0.55, 0); box(B, Bw, -0.13, 0.13, 0, 0.1, -0.13, 0.13, hex('#2f6fd6'), hex('#2559b0')); box(B, Bw, -0.09, 0.09, 0.1, 0.105, -0.09, 0.09, hex('#5aa8e6'), hex('#5aa8e6'), F_WATER); }
  // parked bicycle pointing to the street
  {
    const K = yawChild(T, 0.85, 0, d / 2 + 1.05, Math.PI / 2 + 0.12);
    const tire = hex('#17181b'), fr = hex('#2f6a42'), steel = hex('#9aa0a6');
    const wheel = (cu) => { const n = 12, r = 0.33; for (let k = 0; k < n; k++) { const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2; beam(B, P(K, cu + Math.cos(a0) * r, r + Math.sin(a0) * r, 0), P(K, cu + Math.cos(a1) * r, r + Math.sin(a1) * r, 0), 0.06, tire); } beam(B, P(K, cu - r, r, 0), P(K, cu + r, r, 0), 0.015, steel); beam(B, P(K, cu, 0, 0), P(K, cu, 2 * r, 0), 0.015, steel); };
    wheel(-0.52); wheel(0.52);
    const rear = P(K, -0.52, 0.33, 0), crank = P(K, -0.05, 0.33, 0), seatP = P(K, -0.18, 0.92, 0), head = P(K, 0.42, 0.95, 0), front = P(K, 0.52, 0.33, 0);
    beam(B, rear, crank, 0.04, fr); beam(B, rear, seatP, 0.04, fr); beam(B, crank, seatP, 0.045, fr); beam(B, crank, head, 0.05, fr); beam(B, seatP, head, 0.045, fr); beam(B, head, front, 0.04, fr);
    beam(B, P(K, -0.18, 0.92, 0), P(K, -0.2, 1.0, 0), 0.03, steel);
    box(B, K, -0.32, -0.08, 1.0, 1.06, -0.07, 0.07, tire, tire);
    beam(B, P(K, 0.42, 0.95, 0), P(K, 0.38, 1.12, 0), 0.03, steel);
    beam(B, P(K, 0.38, 1.12, -0.28), P(K, 0.38, 1.12, 0.28), 0.03, steel);
    box(B, K, -0.75, -0.4, 0.62, 0.66, -0.1, 0.1, steel, steel); // rack
    maskRect(K, -0.9, 0.9, -0.2, 0.2);
  }
  // the two trees framing the booth (tall one on the left, mangueira on the right)
  { const a = P(T, -4.6, 0, 0.6); tree(chunkB(a[0], a[2]), a[0], a[2], 0, 1.55, true); const b = P(T, 4.7, 0, 0.9); tree(chunkB(b[0], b[2]), b[0], b[2], 2, 1.35, true); }
  // Portela, standing by the door
  const np = P(T, 1.55, 0, d / 2 + 0.95);
  NPCS.push({ name: 'Portela', x: np[0], z: np[2], y: y0 + 0.02, base: lm.front + 0.9, look: 0, t: 0 });
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
    maskRect(Q, -0.75, 0.75, -0.4, 0.42);
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
      maskCircle(pp[0], pp[2], 0.3);
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
            carMesh(chunkB(x, z), groundFrame(x, z, ang, 0.0), jit(pick(CARS, r), r, 0.05));
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
  const r = rngFor(9, 9, 9), cx = (BX0 + BX1) / 2, cz = (BZ0 + BZ1) / 2;
  const n = 72, R0 = 1250;
  const hs = [];
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2;
    const dirNW = Math.max(0, Math.cos(a - Math.atan2(-1, -1.4)));
    hs.push(70 + r() * 70 + dirNW * dirNW * 260);
  }
  hs[n] = hs[0];
  for (let i = 0; i < n; i++) {
    const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
    const Rr = R0 + (r() - 0.5) * 120;
    const p0 = [cx + Math.cos(a0) * Rr, 0, cz + Math.sin(a0) * Rr], p1 = [cx + Math.cos(a1) * Rr, 0, cz + Math.sin(a1) * Rr];
    const pk = [cx + Math.cos(am) * (Rr + 150), (hs[i] + hs[i + 1]) / 2 + r() * 60, cz + Math.sin(am) * (Rr + 150)];
    const q0 = [cx + Math.cos(a0) * (Rr + 400), hs[i] * 0.6, cz + Math.sin(a0) * (Rr + 400)], q1 = [cx + Math.cos(a1) * (Rr + 400), hs[i + 1] * 0.6, cz + Math.sin(a1) * (Rr + 400)];
    const col = jit(hex('#4f7a54'), r, 0.08), col2 = jit(hex('#5c7d6a'), r, 0.08);
    farB.tri(p0, p1, pk, faceN(p0, p1, pk, true), col, F_FAR);
    farB.tri(p0, pk, q0, faceN(p0, pk, q0, true), col2, F_FAR);
    farB.tri(p1, q1, pk, faceN(p1, q1, pk, true), col2, F_FAR);
    farB.tri(pk, q1, q0, faceN(pk, q1, q0, true), col, F_FAR);
  }
  for (let i = 0; i < 46; i++) {
    const x = cx + (r() - 0.5) * 2400, z = cz + (r() - 0.5) * 2400, y = 160 + r() * 80;
    const T = frame(x, y, z, r() * 0.5), wc = hex('#ffffff'), sc = hex('#e8eef5');
    const k = 2 + Math.floor(r() * 4);
    for (let j = 0; j < k; j++) { const u = (r() - 0.5) * 40, v = (r() - 0.5) * 20, s = 10 + r() * 16; box(farB, T, u - s, u + s, 0, 5 + r() * 6, v - s * 0.6, v + s * 0.6, wc, sc, F_UNLIT, true); }
  }
}

// collision bitmap
const MASK = new Uint8Array(MW * MH);
{
  const id = mx.getImageData(0, 0, MW, MH).data;
  for (let i = 0; i < MW * MH; i++) MASK[i] = id[i * 4 + 3] > 100 ? 1 : 0;
}
function blocked(x, z) {
  if (x < EX0 + 2 || x > EX1 - 2 || z < EZ0 + 2 || z > EZ1 - 2) return true;
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
float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float unpack(vec4 c){return dot(c,vec4(1.0,1.0/255.0,1.0/65025.0,1.0/16581375.0));}
float b2(vec2 q){return mod(q.x*2.0+q.y*3.0,4.0);}
float bayer(vec2 p){p=floor(mod(p,4.0));return (4.0*b2(mod(p,2.0))+b2(floor(p/2.0)))/16.0;}
void main(){
 vec3 N=normalize(vN);vec3 base=vC.rgb;float fl=vC.a;
 if(fl>0.7&&fl<0.9){vec2 cell=floor(vW.xz*2.0+vec2(vW.y*1.7));base*=0.93+0.14*h21(cell);}
 else if(fl>0.33&&fl<0.47){vec2 q=vW.xz*vec2(4.0,2.0);q.x+=0.5*mod(floor(q.y),2.0);vec2 f=fract(q);base*=0.9+0.16*h21(floor(q));if(f.x<0.12||f.y<0.2)base*=0.72;}
 else if(fl>0.4&&fl<0.7){vec2 cell=floor(vW.xz*1.5);float w=sin(cell.x*0.9+uT*1.7)+sin(cell.y*1.3-uT*1.2)+sin((cell.x+cell.y)*0.5+uT*0.8);
  base=mix(base,vec3(0.5,0.78,0.95),smoothstep(1.0,2.4,w)*0.5);if(w>2.6)base=vec3(0.95,0.98,1.0);}
 float sh=1.0;
 if(uShadowOn>0.5){vec3 s=vS.xyz/vS.w*0.5+0.5;
  if(s.x>0.0&&s.x<1.0&&s.y>0.0&&s.y<1.0&&s.z<1.0){float d=unpack(texture2D(uSM,s.xy));if(s.z-0.0012>d)sh=0.0;}}
 float dif=max(dot(N,uL),0.0)*sh;dif=floor(dif*3.0+0.6)/3.0;
 vec3 amb=mix(vec3(0.40,0.38,0.40),vec3(0.56,0.63,0.78),N.y*0.5+0.5);
 vec3 col=base*(amb*0.9+vec3(1.0,0.94,0.80)*dif*0.72);
 float dist=length(vW-uEye);
 float fog=smoothstep(uFogR.x,uFogR.y,dist);
 if(fl<0.1){col=base;fog*=0.5;}
 else if(fl<0.3){fog=0.45+0.1*N.y;}
 col=mix(col,uFog,fog);
 col=floor(col*uLv+bayer(gl_FragCoord.xy))/uLv;
 gl_FragColor=vec4(col,1.0);}`;
const SVS = `attribute vec3 aP;uniform mat4 uSVP;varying float vD;void main(){vec4 p=uSVP*vec4(aP,1.0);vD=p.z/p.w*0.5+0.5;gl_Position=p;}`;
const SFS = `precision highp float;varying float vD;vec4 pk(float d){vec4 e=fract(d*vec4(1.0,255.0,65025.0,16581375.0));e-=e.yzww*vec4(1.0/255.0,1.0/255.0,1.0/255.0,0.0);return e;}void main(){gl_FragColor=pk(vD);}`;
const PM = prog(VS, FS), PS = prog(SVS, SFS);
const LOC = { aP: gl.getAttribLocation(PM, 'aP'), aN: gl.getAttribLocation(PM, 'aN'), aC: gl.getAttribLocation(PM, 'aC') };
const SLOC = { aP: gl.getAttribLocation(PS, 'aP') };
const U = {}; ['uVP', 'uSVP', 'uSM', 'uL', 'uEye', 'uFog', 'uFogR', 'uT', 'uLv', 'uShadowOn'].forEach(k => U[k] = gl.getUniformLocation(PM, k));
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
const player = { x: W.spawn[0], z: W.spawn[1], a: 0, va: 0, walk: 0, speed: 0, car: false, cv: 0 };
// face along the road at spawn
{
  let best = 1e9, ang = 0;
  for (const s of SEGS) { const d = segDist(player.x, player.z, s); if (d < best) { best = d; ang = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]); } }
  player.a = ang;
}
let camY = groundAt(player.x, player.z);
const cam = { yaw: 0, pitch: 0.62, dist: 24, tyaw: 0, follow: 0 };
cam.yaw = Math.atan2(-Math.cos(player.a), -Math.sin(player.a));
let pixel = 3, shadowsOn = shadowOK;
const keys = {};
function segDist(x, z, s) {
  const ax = s.a[0], az = s.a[1], dx = s.b[0] - ax, dz = s.b[1] - az, L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

// moving cars
const traffic = [];
{
  const r = rngFor(3, 1, 4);
  const cand = ROUTES.filter(x => x.len > 80);
  for (let i = 0; i < 34; i++) {
    const rt = cand[Math.floor(r() * cand.length)];
    const cum = [0]; for (let k = 1; k < rt.pts.length; k++) cum.push(cum[k - 1] + Math.hypot(rt.pts[k][0] - rt.pts[k - 1][0], rt.pts[k][1] - rt.pts[k - 1][1]));
    traffic.push({ rt, cum, s: r() * rt.len, dir: r() < 0.5 ? 1 : -1, vmax: rt.t === 'secondary' ? 11 + r() * 5 : 6 + r() * 4, v: 0, col: jit(pick(CARS, r), r, 0.05), lane: rt.t === 'secondary' && rt.h < 4 ? (r() < 0.5 ? 1.7 : -1.7) : 1.15, x: 0, z: 0, a: 0 });
  }
}
function placeCar(c) {
  const { pts } = c.rt, cum = c.cum;
  let i = 1; while (i < cum.length - 1 && cum[i] < c.s) i++;
  const t = (c.s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const ax = pts[i - 1][0], az = pts[i - 1][1], bx = pts[i][0], bz = pts[i][1];
  let ux = bx - ax, uz = bz - az; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
  const fx = ux * c.dir, fz = uz * c.dir;
  const off = c.rt.t === 'secondary' && c.rt.h < 4 ? c.lane * c.dir : c.lane;
  c.x = ax + (bx - ax) * t - fz * off; c.z = az + (bz - az) * t + fx * off;
  c.a = Math.atan2(fz, fx);
}

// ---------------- input ----------------
addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (document.getElementById('lobby').style.display !== 'none') return;
  if (e.code === 'Enter' && window.__net && window.__net.online) { e.preventDefault(); window.__net.openChat(); return; }
  keys[e.code] = true;
  if (e.code === 'KeyC') toggleCar();
  if (e.code === 'KeyP') { pixel = pixel === 2 ? 3 : pixel === 3 ? 4 : 2; resize(); }
  if (e.code === 'KeyM') document.getElementById('mini').classList.toggle('big');
  if (e.code === 'KeyH') document.getElementById('help').classList.toggle('hide');
  if (e.code === 'KeyL') shadowsOn = !shadowsOn && shadowOK;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
let drag = null;
cv.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') return; drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); hideHelpSoon(); });
cv.addEventListener('pointermove', e => { if (!drag) return; cam.yaw -= (e.clientX - drag.x) * 0.006; cam.pitch = Math.max(0.12, Math.min(1.45, cam.pitch + (e.clientY - drag.y) * 0.005)); drag = { x: e.clientX, y: e.clientY }; cam.follow = 1.5; });
cv.addEventListener('pointerup', () => { drag = null; });
cv.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.max(7, Math.min(260, cam.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
function toggleCar() {
  if (player.car) { // step out to the side
    const sx = player.x - Math.sin(player.a) * 2.2, sz = player.z + Math.cos(player.a) * 2.2;
    if (freeAt(sx, sz, 0.35)) { player.x = sx; player.z = sz; }
    player.car = false; player.cv = 0;
  } else { player.car = true; player.cv = 0; }
  document.getElementById('btnCar').classList.toggle('on', player.car);
}
// touch controls
const joy = { id: null, x: 0, y: 0, dx: 0, dy: 0 }, look = { id: null, x: 0, y: 0 };
const pinch = {};
const jEl = document.getElementById('joy'), jKnob = document.getElementById('knob');
cv.addEventListener('touchstart', e => {
  hideHelpSoon();
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth * 0.45 && joy.id === null) { joy.id = t.identifier; joy.x = t.clientX; joy.y = t.clientY; joy.dx = joy.dy = 0; jEl.style.left = (t.clientX - 70) + 'px'; jEl.style.top = (t.clientY - 70) + 'px'; jEl.classList.remove('run'); jEl.style.display = 'block'; jKnob.style.transform = 'translate(0px,0px)'; }
    else if (look.id === null) { look.id = t.identifier; look.x = t.clientX; look.y = t.clientY; }
    else { pinch.d = null; pinch.id2 = t.identifier; }
  }
  e.preventDefault();
}, { passive: false });
cv.addEventListener('touchmove', e => {
  for (const t of e.touches) {
    if (t.identifier === joy.id) { let dx = t.clientX - joy.x, dy = t.clientY - joy.y; const l = Math.hypot(dx, dy); const R = 60; if (l > R) { dx *= R / l; dy *= R / l; } joy.dx = dx / R; joy.dy = dy / R; jKnob.style.transform = `translate(${dx}px,${dy}px)`; jEl.classList.toggle('run', Math.hypot(joy.dx, joy.dy) > 0.82); }
    else if (t.identifier === look.id) {
      const t2 = [...e.touches].find(q => q.identifier === pinch.id2);
      if (t2) { const d = Math.hypot(t.clientX - t2.clientX, t.clientY - t2.clientY); if (pinch.d) cam.dist = Math.max(7, Math.min(260, cam.dist * pinch.d / d)); pinch.d = d; }
      else { cam.yaw -= (t.clientX - look.x) * 0.008; cam.pitch = Math.max(0.12, Math.min(1.45, cam.pitch + (t.clientY - look.y) * 0.006)); cam.follow = 1.5; }
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
document.getElementById('btnMap').addEventListener('click', () => document.getElementById('mini').classList.toggle('big'));
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
  if (W.creek) { g.strokeStyle = '#3a7fb0'; g.lineWidth = 3; g.beginPath(); W.creek.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); }
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
function buildPlayer(B, p, look) {
  p = p || player; look = look || { shirt: SHIRT, car: PCAR };
  const SHIRT_ = look.shirt, CAR_ = look.car;
  if (p.car) { carMesh(B, groundFrame(p.x, p.z, p.a, 0.0), CAR_); return; }
  const T = frame(p.x, surfAt(p.x, p.z) + 0.02, p.z, p.a);
  const sw = Math.sin(p.walk) * 0.7 * Math.min(1, p.speed / 3);
  const bob = Math.abs(Math.cos(p.walk)) * 0.06 * Math.min(1, p.speed / 3);
  const Tb = { o: [T.o[0], T.o[1] + bob, T.o[2]], ax: T.ax, ay: T.ay, az: T.az };
  // legs
  for (const [v, ph] of [[-0.17, sw], [0.17, -sw]]) {
    const L = swing(Tb, 0, 0.85, v, ph);
    box(B, L, -0.12, 0.12, -0.78, 0.02, -0.11, 0.11, SHORTS, SHORTS);      // calça até o tornozelo
    box(B, L, -0.125, 0.125, -0.78, -0.7, -0.115, 0.115, hex('#1f3a6e'), hex('#1f3a6e')); // barra da calça
    box(B, L, -0.13, 0.22, -0.88, -0.76, -0.12, 0.12, SHOE, SHOE);
  }
  box(B, Tb, -0.18, 0.18, 0.8, 1.45, -0.3, 0.3, SHIRT_, SHIRT_);
  box(B, Tb, 0.181, 0.19, 1.05, 1.3, -0.12, 0.12, SHIRT2, SHIRT2);
  for (const [v, ph] of [[-0.39, -sw], [0.39, sw]]) {
    const A = swing(Tb, 0, 1.42, v, ph * 0.9);
    box(B, A, -0.09, 0.09, -0.3, 0.03, -0.09, 0.09, SHIRT_, SHIRT_);
    box(B, A, -0.08, 0.08, -0.62, -0.3, -0.08, 0.08, SKIN, SKIN);
  }
  box(B, Tb, -0.2, 0.2, 1.47, 1.87, -0.2, 0.2, SKIN, SKIN);
  box(B, Tb, -0.23, 0.17, 1.8, 1.95, -0.22, 0.22, HAIR, HAIR);
  box(B, Tb, -0.23, -0.1, 1.55, 1.85, -0.22, 0.22, HAIR, HAIR);
  box(B, Tb, 0.2, 0.21, 1.66, 1.72, -0.12, -0.05, HAIR, HAIR); // eyes
  box(B, Tb, 0.2, 0.21, 1.66, 1.72, 0.05, 0.12, HAIR, HAIR);
}

const P_SKIN = hex('#a8754f'), P_SHIRT = hex('#5f6d80'), P_PANTS = hex('#30343c'), P_CAP = hex('#24365e'), P_HAIR = hex('#b9b4ac'), P_SHOE = hex('#2a2420');
const C_SKIN = hex('#b07a50'), C_SHORTS = hex('#1d4f9c'), C_HAIR = hex('#17110c'), C_SLIP = hex('#f2f2f2'), C_DARK = hex('#120d0a');
function buildCaudinho(B, n, t) {
  const T = frame(n.x, n.y, n.z, n.base);
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
function buildNPC(B, n, t) {
  if (n.style === 'caudinho') return buildCaudinho(B, n, t);
  if (n.style === 'note') return;
  const T = frame(n.x, n.y, n.z, n.base);
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
  hudMode.textContent = (player.car ? 'CARRO ' : (player.running ? 'CORRENDO ' : 'A PÉ ')) + Math.round(v * 3.6) + ' km/h · alt. ' + Math.round((DEM ? DEM.base : 0) + groundAt(player.x, player.z)) + ' m';
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
  const start = () => { MY_LOOK = LOOKS[N.look]; lobby.style.display = 'none'; try { localStorage.setItem('mdc_profile', JSON.stringify({ n: nameIn.value.trim(), c: N.look })); } catch (e) {} };
  const offPill = () => { onlTxt.textContent = '○ offline'; $('btnLeave').textContent = 'ENTRAR'; $('btnLeave').classList.add('join'); onl.style.display = 'flex'; };
  $('btnSolo').onclick = () => { start(); if (CFG && !N.online) offPill(); };
  $('btnOnline').onclick = async () => {
    const n = nameIn.value.trim().replace(/\s+/g, ' ').slice(0, 16);
    if (!n) { msgEl.textContent = 'Digite um nome para jogar online.'; nameIn.focus(); return; }
    msgEl.textContent = 'Conectando…'; $('btnOnline').disabled = true;
    try { await connect(n); start(); }
    catch (e) { console.error(e); msgEl.textContent = 'Não consegui conectar (' + (e.code || e.message || e) + '). Tente de novo ou jogue sozinho.'; $('btnOnline').disabled = false; }
  };
  const load = src => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('falha ao carregar ' + src)); document.head.appendChild(s); });
  async function connect(name) {
    const V = 'https://www.gstatic.com/firebasejs/10.12.2/';
    if (!window.firebase) { await load(V + 'firebase-app-compat.js'); await load(V + 'firebase-auth-compat.js'); await load(V + 'firebase-database-compat.js'); }
    if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(CFG);
    const cred = await firebase.auth().signInAnonymously();
    N.uid = cred.user.uid; N.name = name; N.db = firebase.database();
    N.db.ref('.info/serverTimeOffset').on('value', s => { N.offset = s.val() || 0; });
    const me = N.db.ref('players/' + N.uid);
    me.onDisconnect().remove();
    await me.set({ n: name, c: N.look, x: +player.x.toFixed(2), z: +player.z.toFixed(2), a: +player.a.toFixed(3), car: player.car ? 1 : 0, t: firebase.database.ServerValue.TIMESTAMP });
    const players = N.db.ref('players');
    const upsert = s => {
      if (s.key === N.uid) return; const v = s.val(); if (!v || typeof v.x !== 'number') return;
      let o = N.others.get(s.key);
      if (!o) { o = { x: v.x, z: v.z, a: v.a || 0, walk: 0, speed: 0, car: false, el: document.createElement('div') }; o.el.className = 'lbl player'; lblLayer.appendChild(o.el); N.others.set(s.key, o); if (N.online) sys((v.n || '?') + ' entrou no bairro'); }
      o.tx = v.x; o.tz = v.z; o.ta = v.a || 0; o.car = !!v.car; o.n = String(v.n || '?').slice(0, 16); o.look = LOOKS[(v.c | 0) % LOOKS.length] || LOOKS[0]; o.t = v.t || 0;
      o.el.textContent = o.n; o.el.style.borderColor = LOOK_CSS[(v.c | 0) % LOOK_CSS.length];
    };
    players.on('child_added', upsert); players.on('child_changed', upsert);
    players.on('child_removed', s => { const o = N.others.get(s.key); if (o) { sys(o.n + ' saiu'); o.el.remove(); if (o.bub) o.bub.remove(); N.others.delete(s.key); } });
    const since = Date.now() + N.offset - 2000;
    N.chatQ = N.db.ref('chat').orderByChild('t').startAt(since); N.players = players; N.me = me;
    N.chatQ.on('child_added', s => {
      const v = s.val(); if (!v || typeof v.m !== 'string') return;
      const who = v.u === N.uid ? N.name : (N.others.get(v.u) || {}).n || v.n || '?';
      addLog(who, v.m, v.u === N.uid);
      const target = v.u === N.uid ? N.meBub : N.others.get(v.u);
      say(v.u === N.uid ? null : target, v.m, v.u);
    });
    N.online = true; onl.style.display = 'flex'; $('btnLeave').textContent = 'SAIR'; $('btnLeave').classList.remove('join'); $('btnChat').style.display = '';
    sys('Você está online. Aperte Enter (ou CHAT) para falar.');
  }
  // sair do online: volta ao modo sozinho no mesmo lugar
  N.leave = async () => {
    if (!N.online) return;
    N.online = false;
    try { N.players.off(); N.chatQ.off(); N.me.onDisconnect().cancel(); await N.me.remove(); } catch (e) { console.error(e); }
    for (const o of N.others.values()) { o.el.remove(); if (o.bub) o.bub.remove(); }
    N.others.clear();
    offPill(); $('btnChat').style.display = 'none'; chatBox.style.display = 'none';
    sys('Você saiu do online. Agora está jogando sozinho.');
    $('btnOnline').disabled = false; msgEl.textContent = '';
  };
  $('btnLeave').onclick = () => {
    if (!N.online) { lobby.style.display = ''; msgEl.textContent = ''; $('btnOnline').disabled = false; return; }
    if ($('btnLeave').dataset.sure) { delete $('btnLeave').dataset.sure; $('btnLeave').textContent = 'SAIR'; N.leave(); return; }
    $('btnLeave').dataset.sure = '1'; $('btnLeave').textContent = 'CONFIRMAR?';
    setTimeout(() => { if ($('btnLeave').dataset.sure) { delete $('btnLeave').dataset.sure; $('btnLeave').textContent = 'SAIR'; } }, 3000);
  };
  // chat
  const esc = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function addLog(who, m, mine) { const d = document.createElement('div'); d.innerHTML = '<b' + (mine ? ' class="me"' : '') + '>' + esc(who) + ':</b> ' + esc(m); chatLog.appendChild(d); while (chatLog.children.length > 7) chatLog.firstChild.remove(); setTimeout(() => d.classList.add('old'), 12000); }
  function sys(m) { const d = document.createElement('div'); d.className = 'sys'; d.textContent = m; chatLog.appendChild(d); while (chatLog.children.length > 7) chatLog.firstChild.remove(); setTimeout(() => d.classList.add('old'), 8000); }
  const myBubble = document.createElement('div'); myBubble.className = 'bubble'; lblLayer.appendChild(myBubble);
  function say(o, m, uid) {
    if (uid === N.uid) { myBubble.textContent = m; myBubble.style.display = 'block'; clearTimeout(N.myT); N.myT = setTimeout(() => myBubble.style.display = 'none', 6000); return; }
    if (!o) return; if (!o.bub) { o.bub = document.createElement('div'); o.bub.className = 'bubble'; lblLayer.appendChild(o.bub); }
    o.bub.textContent = m; o.bubUntil = performance.now() + 6000;
  }
  N.openChat = () => { if (!N.online) return; chatBox.style.display = 'flex'; chatIn.value = ''; chatIn.focus(); for (const k in keys) keys[k] = false; };
  const send = () => {
    const m = chatIn.value.trim().slice(0, 120); chatBox.style.display = 'none'; chatIn.blur();
    if (m && N.db) N.db.ref('chat').push({ u: N.uid, n: N.name, m, t: firebase.database.ServerValue.TIMESTAMP });
  };
  chatIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } if (e.key === 'Escape') { chatBox.style.display = 'none'; chatIn.blur(); } });
  $('chatSend').onclick = send;
  $('btnChat').onclick = () => N.openChat();
  // sync my position ~8x per second
  let lastSend = 0, lastSent = null;
  N.frame = (B, dt) => {
    const now = performance.now();
    if (N.online && now - lastSend > 125) {
      const st = { x: +player.x.toFixed(2), z: +player.z.toFixed(2), a: +player.a.toFixed(3), car: player.car ? 1 : 0 };
      const moved = !lastSent || Math.abs(st.x - lastSent.x) > 0.02 || Math.abs(st.z - lastSent.z) > 0.02 || Math.abs(st.a - lastSent.a) > 0.02 || st.car !== lastSent.car;
      if (moved || now - lastSend > 5000) { st.t = firebase.database.ServerValue.TIMESTAMP; N.db.ref('players/' + N.uid).update(st); lastSent = st; lastSend = now; }
    }
    const serverNow = Date.now() + N.offset;
    for (const o of N.others.values()) {
      o.stale = o.t && serverNow - o.t > 60000;
      if (o.stale) continue;
      const k = Math.min(1, dt * 10), px = o.x, pz = o.z;
      o.x += (o.tx - o.x) * k; o.z += (o.tz - o.z) * k;
      let da = o.ta - o.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; o.a += da * k;
      const v = Math.hypot(o.x - px, o.z - pz) / Math.max(dt, 1e-3);
      o.speed += (v - o.speed) * Math.min(1, dt * 6); o.walk += dt * o.speed * 2.3;
      buildPlayer(B, o, o.look);
    }
    if (N.online) onlTxt.textContent = '● ' + (1 + [...N.others.values()].filter(o => !o.stale).length) + ' online';
  };
  N.labels = VP => {
    const now = performance.now();
    const place = (el, x, y, z, up) => { const q = xform(VP, [x, y, z]); if (q[3] > 0 && Math.abs(q[0]) < 1.2 && Math.abs(q[1]) < 1.2) { el.style.display = 'block'; el.style.transform = `translate(${(q[0] * 0.5 + 0.5) * innerWidth}px,${(-q[1] * 0.5 + 0.5) * innerHeight}px) translate(-50%,${up})`; } else el.style.display = 'none'; };
    for (const o of N.others.values()) {
      const y = surfAt(o.x, o.z) + (o.car ? 2.3 : 2.25), far = Math.hypot(o.x - player.x, o.z - player.z) > 220;
      if (o.stale || far) { o.el.style.display = 'none'; if (o.bub) o.bub.style.display = 'none'; continue; }
      place(o.el, o.x, y, o.z, '-100%');
      if (o.bub) { if (now < o.bubUntil) place(o.bub, o.x, y + 0.9, o.z, '-115%'); else o.bub.style.display = 'none'; }
    }
    if (myBubble.style.display === 'block') { const q = xform(VP, [player.x, surfAt(player.x, player.z) + 3.1, player.z]); myBubble.style.transform = `translate(${(q[0] * 0.5 + 0.5) * innerWidth}px,${(-q[1] * 0.5 + 0.5) * innerHeight}px) translate(-50%,-115%)`; }
  };
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
  if (keys.KeyQ) cam.yaw += dt * 1.8;
  if (keys.KeyE) cam.yaw -= dt * 1.8;
  if (keys.KeyR) cam.pitch = Math.min(1.45, cam.pitch + dt);
  if (keys.KeyF) cam.pitch = Math.max(0.12, cam.pitch - dt);
  if (keys.Equal || keys.NumpadAdd) cam.dist = Math.max(7, cam.dist * (1 - dt));
  if (keys.Minus || keys.NumpadSubtract) cam.dist = Math.min(260, cam.dist * (1 + dt));
  const jl = joy.id !== null ? Math.min(1, Math.hypot(joy.dx, joy.dy)) : 0;
  const run = keys.ShiftLeft || keys.ShiftRight || jl > 0.82;
  player.running = run && (jl > 0.05 || ix || iy);
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
    const ahead = (dx * Math.cos(c.a) + dz * Math.sin(c.a)) > 0;
    const tv = (d < 9 && ahead) ? 0 : c.vmax;
    c.v += (tv - c.v) * Math.min(1, dt * (tv < c.v ? 4 : 1));
    c.s += c.v * c.dir * dt;
    if (c.s > c.rt.len - 3) { c.s = c.rt.len - 3; c.dir = -1; c.v = 0; }
    if (c.s < 3) { c.s = 3; c.dir = 1; c.v = 0; }
  }
}
function frame_() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  step(dt);
  const t = (now - T0) / 1000;
  // dynamic mesh
  dynB.reset();
  buildPlayer(dynB, player, MY_LOOK);
  if (window.__net) window.__net.frame(dynB, dt);
  for (const f of FLY_SPOTS) for (let k = 0; k < 7; k++) {
    const ph = t * (2.2 + k * 0.37) + k * 1.9, r = 0.25 + 0.18 * Math.sin(t * 1.3 + k);
    const fx = f.x + Math.cos(ph) * r, fz = f.z + Math.sin(ph * 1.1) * r, fy = f.y + 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(t * 3.1 + k * 2.3));
    box(dynB, frame(fx, fy, fz, ph), -0.035, 0.035, 0, 0.04, -0.03, 0.03, hex('#101010'), hex('#101010'), F_UNLIT);
  }
  for (const n of NPCS) {
    const dx = player.x - n.x, dz = player.z - n.z, dd = Math.hypot(dx, dz);
    let want = 0;
    if (dd < 14) { want = Math.atan2(dz, dx) - n.base; while (want > Math.PI) want -= 2 * Math.PI; while (want < -Math.PI) want += 2 * Math.PI; want = Math.max(-1.3, Math.min(1.3, want)); }
    n.look += (want - n.look) * Math.min(1, dt * 4);
    buildNPC(dynB, n, t);
    // speech bubble
    if (dd < (n.r || 6) && !n.near) { n.near = true; const L = n.says || SAYS; n.line = L[(n.k = ((n.k || 0) + 1)) % L.length]; }
    if (dd > (n.r || 6) + 2) n.near = false;
    n.show = dd < (n.r || 6);
  }
  for (const c of traffic) carMesh(dynB, groundFrame(c.x, c.z, c.a, 0.0), c.col);
  gl.bindBuffer(gl.ARRAY_BUFFER, dynVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(dynB.buf, 0, dynB.n * 20), gl.DYNAMIC_DRAW);
  const dynM = { vbo: dynVBO, n: dynB.n };

  // camera
  const gy = surfAt(player.x, player.z);
  camY += (gy - camY) * Math.min(1, dt * 8);
  const tgt = [player.x, camY + (player.car ? 1.2 : 1.3), player.z];
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const eye = [tgt[0] + Math.sin(cam.yaw) * cp * cam.dist, tgt[1] + sp * cam.dist, tgt[2] + Math.cos(cam.yaw) * cp * cam.dist];
  eye[1] = Math.max(eye[1], groundAt(eye[0], eye[2]) + 1.5);
  const proj = persp(cam.dist > 60 ? 0.6 : 0.75, cv.width / cv.height, 1.0, 2600);
  const VP = mul(proj, lookAt(eye, tgt, [0, 1, 0]));
  const fogR = [Math.max(220, cam.dist * 3), Math.max(760, cam.dist * 6)];

  // shadow pass
  const SR = Math.min(170, 70 + cam.dist * 1.2);
  const sc = [player.x - Math.sin(cam.yaw) * SR * 0.35, gy, player.z - Math.cos(cam.yaw) * SR * 0.35];
  const sEye = [sc[0] + SUN[0] * 400, gy + SUN[1] * 400, sc[2] + SUN[2] * 400];
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
  gl.clearColor(FOG[0], FOG[1], FOG[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  gl.useProgram(PM);
  gl.uniformMatrix4fv(U.uVP, false, VP); gl.uniformMatrix4fv(U.uSVP, false, SVP);
  gl.uniform3fv(U.uL, SUN); gl.uniform3fv(U.uEye, eye); gl.uniform3fv(U.uFog, FOG); gl.uniform2fv(U.uFogR, fogR);
  gl.uniform1f(U.uT, t); gl.uniform1f(U.uLv, 22); gl.uniform1f(U.uShadowOn, shadowsOn ? 1 : 0);
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
  if (window.__net) window.__net.labels(VP);
  hudT += dt; if (hudT > 0.2) { hudT = 0; updateHUD(); drawMini(); }
  frames++; fpsT += dt; if (fpsT > 1) { fps = frames / fpsT; frames = 0; fpsT = 0; document.getElementById('fps').textContent = Math.round(fps) + ' fps'; }
  requestAnimationFrame(frame_);
}
document.getElementById('load').style.display = 'none';
updateHUD(); drawMini();
requestAnimationFrame(frame_);
window.__game = { player, cam, totalV, NPCS, groundAt, demRaw, SEGS, setPixel: p => { pixel = p; resize(); }, stats: () => ({ totalV, chunks: meshes.length, houses: W.houses.length, trees: W.trees.length, traffic: traffic.length, shadowOK }) };
})();
