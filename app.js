'use strict';
/*
  Pinstripe Creator
  Plain JavaScript, no build step. The fabric list lives in fabrics.js.
  Every size in a design is in millimetres.
*/

const KEYS = {
  current: 'pinstripe.current.v1',
  library: 'pinstripe.library.v1',
  calibration: 'pinstripe.calibration.v1',
  view: 'pinstripe.view.v1',
};
const STANDARD_PX_PER_MM = 96 / 25.4; // the browser's own idea of a millimetre
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8, 10];
const LAYOUT_NAMES = {
  'vertical': 'Vertical',
  'horizontal': 'Horizontal',
  'check': 'Check',
  'diagonal-left': 'Diagonal left',
  'diagonal-right': 'Diagonal right',
};
const ANGLES = [30, 45, 60];
const MAX_WIDTH_MM = 1000;
const MAX_COLORWAYS = 8;
const GARMENT_CHOICES = {
  top: ['tee', 'shirt'],
  sleeve: ['short', 'long'],
  bottom: ['shorts', 'pants'],
  striped: ['top', 'bottom', 'both'],
};
const DETAIL_FIELDS = [
  ['article', 'Article no.'],
  ['customer', 'Customer'],
  ['season', 'Season'],
  ['designer', 'Designer'],
];

const ICON = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  dup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.01"/></svg>',
};

/* ---------- Small helpers ---------- */

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function newId() {
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
function readJSON(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
}
function normalizeHex(v) {
  if (typeof v !== 'string') return null;
  let h = v.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? '#' + h.toLowerCase() : null;
}
// Accepts "0.5" and "0,5"; returns millimetres rounded to 0.01, or null if not usable.
function parseWidth(v) {
  const n = Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n * 100) / 100;
  return r > 0 && r <= MAX_WIDTH_MM ? r : null;
}
function fmtWidth(n) { return String(Math.round(n * 100) / 100); }
function fmtMM(n) { return n.toFixed(2) + ' mm'; }
function totalMM(stripes) {
  return Math.round(stripes.reduce((a, s) => a + s.width, 0) * 1e6) / 1e6;
}
function fabricFor(code) {
  return FABRICS.find(f => f.code === code) || FABRICS.find(f => f.code === DEFAULT_FABRIC) || FABRICS[0];
}
function isDiagonal(d) { return d.layout === 'diagonal-left' || d.layout === 'diagonal-right'; }
function layoutLabel(d) { return LAYOUT_NAMES[d.layout] + (isDiagonal(d) ? ' ' + d.angle + '°' : ''); }
function fmtDate(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return '';
  return t.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ---------- Designs ---------- */

/*
  A design:
    stripes   [{ width, colors: [{ color, pantone }, ...] }]  one color per colorway, in colorway order
    colorways [{ name, solid }]   solid = color of the plain garment piece (null = the main stripe color)
    details   order details shown on the PDF (all optional)
    garment   how the pajama preview is put together
  Each stripe carries its own colors for every colorway, so moving, copying or deleting stripes
  keeps all colorways in step by itself.
*/

function colorwayName(k) { return String.fromCharCode(65 + k); } // A, B, C ...

function cleanColor(c) {
  return {
    color: normalizeHex(c && c.color) || '#000000',
    pantone: c && typeof c.pantone === 'string' ? c.pantone.slice(0, 60) : '',
  };
}
function cleanText(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }

// Cleans up a design from storage or from an imported file. Returns null if it isn't one.
// Also reads designs saved before colorways existed (one color per stripe).
function sanitizeDesign(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.stripes)) return null;
  const rawCw = Array.isArray(d.colorways) && d.colorways.length ? d.colorways.slice(0, MAX_COLORWAYS) : [{}];
  const colorways = rawCw.map((c, k) => ({
    name: (c && typeof c.name === 'string' && c.name.trim() ? c.name.trim() : colorwayName(k)).slice(0, 30),
    solid: normalizeHex(c && c.solid) || null,
  }));
  const n = colorways.length;
  const stripes = d.stripes
    .filter(s => s && typeof s === 'object')
    .map(s => {
      const colors = (Array.isArray(s.colors) && s.colors.length ? s.colors : [s]).slice(0, n).map(cleanColor);
      while (colors.length < n) colors.push({ ...colors[colors.length - 1] });
      return { width: parseWidth(s.width) || 0, colors };
    })
    .filter(s => s.width > 0);
  const det = d.details && typeof d.details === 'object' ? d.details : {};
  const g = d.garment && typeof d.garment === 'object' ? d.garment : {};
  const choose = (key, v) => (GARMENT_CHOICES[key].includes(v) ? v : GARMENT_CHOICES[key][0]);
  return {
    version: 2,
    id: typeof d.id === 'string' && d.id ? d.id.slice(0, 40) : newId(),
    name: typeof d.name === 'string' ? d.name.slice(0, 80) : 'Untitled design',
    fabric: FABRICS.some(f => f.code === d.fabric) ? d.fabric : fabricFor(DEFAULT_FABRIC).code,
    layout: LAYOUT_NAMES[d.layout] ? d.layout : 'vertical',
    angle: ANGLES.includes(Number(d.angle)) ? Number(d.angle) : 45,
    crossing: d.crossing === 'multiply' ? 'multiply' : 'mix',
    stripes,
    colorways,
    details: {
      article: cleanText(det.article, 60),
      customer: cleanText(det.customer, 60),
      season: cleanText(det.season, 60),
      designer: cleanText(det.designer, 60),
      notes: cleanText(det.notes, 400),
    },
    garment: {
      top: choose('top', g.top),
      sleeve: choose('sleeve', g.sleeve),
      bottom: choose('bottom', g.bottom),
      striped: choose('striped', g.striped),
    },
  };
}

function defaultDesign() {
  return sanitizeDesign({
    name: 'Navy chalk stripe',
    fabric: DEFAULT_FABRIC,
    layout: 'vertical',
    angle: 45,
    crossing: 'mix',
    stripes: [
      { color: '#1f2a44', pantone: '', width: 9.4 },
      { color: '#f2efe8', pantone: '', width: 0.6 },
    ],
  });
}

// The stripes of one colorway, as plain { width, color, pantone } — what all drawing code uses.
function cwStripes(d, k) {
  return d.stripes.map(s => ({ width: s.width, color: s.colors[k].color, pantone: s.colors[k].pantone }));
}
function cwView(d, k) {
  return { ...d, stripes: cwStripes(d, k) };
}

function isDefaultContent(d) {
  return JSON.stringify({ ...d, id: '' }) === JSON.stringify({ ...defaultDesign(), id: '' });
}

/* ---------- State ---------- */

let design = sanitizeDesign(readJSON(KEYS.current)) || defaultDesign();

let library = (readJSON(KEYS.library) || [])
  .map(e => {
    const d = e && sanitizeDesign(e.design);
    return d ? { savedAt: typeof e.savedAt === 'string' ? e.savedAt : '', design: d } : null;
  })
  .filter(Boolean);

// The colorway being shown and edited. Not part of the design, so switching is not an undo step.
let activeCw = 0;
function cw() {
  if (activeCw >= design.colorways.length) activeCw = design.colorways.length - 1;
  if (activeCw < 0) activeCw = 0;
  return activeCw;
}

const view = { mode: 'fabric', zoom: 1, repeatLines: false, ruler: true, gShow: 'set', pickSeason: '', pickInactive: false };
(function loadView() {
  const v = readJSON(KEYS.view);
  if (!v) return;
  if (v.mode === 'single' || v.mode === 'fabric' || v.mode === 'garment') view.mode = v.mode;
  if (v.gShow === 'set' || v.gShow === 'top' || v.gShow === 'bottom') view.gShow = v.gShow;
  if (typeof v.pickSeason === 'string') view.pickSeason = v.pickSeason;
  if (typeof v.pickInactive === 'boolean') view.pickInactive = v.pickInactive;
  if (ZOOM_STEPS.includes(v.zoom)) view.zoom = v.zoom;
  if (typeof v.repeatLines === 'boolean') view.repeatLines = v.repeatLines;
  if (typeof v.ruler === 'boolean') view.ruler = v.ruler;
})();

// Real-size calibration: CSS pixels per millimetre, measured at a given browser zoom (dpr).
let calibration = (function () {
  const c = readJSON(KEYS.calibration);
  return c && c.pxPerMm > 0 && c.dpr > 0 ? c : null;
})();

function pxPerMm() {
  if (!calibration) return STANDARD_PX_PER_MM;
  return calibration.pxPerMm * calibration.dpr / (window.devicePixelRatio || 1);
}

/* ---------- Undo / redo ---------- */

let undoStack = [JSON.stringify(design)];
let undoIndex = 0;

// Records the current design as one undo step (if it changed).
function commit() {
  const snap = JSON.stringify(design);
  if (snap === undoStack[undoIndex]) return;
  undoStack = undoStack.slice(0, undoIndex + 1);
  undoStack.push(snap);
  if (undoStack.length > 200) undoStack.shift();
  undoIndex = undoStack.length - 1;
  hideUndoToast(); // its Undo button belonged to the change before this one
  updateUndoButtons();
  updateSaveState();
  saveCurrentSoon();
}
function undo() {
  commit();
  hideUndoToast();
  if (undoIndex === 0) return;
  undoIndex--;
  design = JSON.parse(undoStack[undoIndex]);
  renderAll();
}
function redo() {
  hideUndoToast();
  if (undoIndex >= undoStack.length - 1) return;
  undoIndex++;
  design = JSON.parse(undoStack[undoIndex]);
  renderAll();
}
function updateUndoButtons() {
  $('undoBtn').disabled = undoIndex === 0 && JSON.stringify(design) === undoStack[0];
  $('redoBtn').disabled = undoIndex >= undoStack.length - 1;
}

/* ---------- Saving ---------- */

let saveTimer = null;
function saveCurrentSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrentNow, 250);
}
function saveCurrentNow() {
  clearTimeout(saveTimer);
  writeJSON(KEYS.current, design);
}
function saveView() { writeJSON(KEYS.view, view); }

function persistLibrary() {
  if (writeJSON(KEYS.library, library)) return true;
  toast('Could not save: this browser is blocking storage. Use Save as PDF to keep a copy.', { kind: 'warn' });
  return false;
}
function isSavedInLibrary() {
  const e = library.find(x => x.design.id === design.id);
  return !!e && JSON.stringify(e.design) === JSON.stringify(design);
}
function hasUnsavedChanges() {
  return !isSavedInLibrary() && !isDefaultContent(design);
}
function updateSaveState() {
  $('saveDot').hidden = isSavedInLibrary();
}
function saveToLibrary() {
  commit();
  const entry = { savedAt: new Date().toISOString(), design: clone(design) };
  const i = library.findIndex(e => e.design.id === design.id);
  if (i >= 0) library[i] = entry; else library.unshift(entry);
  if (persistLibrary()) {
    toast(`Saved "${design.name || 'Untitled design'}" in My designs`);
    track('save');
  }
  updateSaveState();
  if ($('libDialog').open) renderLibrary();
}

/* ---------- Anonymous counts ---------- */

// Counts an action in GoatCounter: only fixed names starting with "pc-" (Pinstripe Creator), never
// anything from a design. Does nothing if the counter isn't loaded.
function track(name) {
  try {
    if (window.goatcounter && window.goatcounter.count) {
      window.goatcounter.count({ path: 'pc-' + name, title: 'Pinstripe Creator: ' + name, event: true });
    }
  } catch (e) { /* counting must never break the site */ }
}

/* ---------- Toast ---------- */

// A short message at the bottom of the page.
// kind 'warn' shows it in red for longer; withUndo adds an Undo button for the change just made.
let toastTimer = null;
function toast(msg, { kind = 'info', withUndo = false } = {}) {
  const t = $('toast');
  $('toastMsg').textContent = msg;
  $('toastUndo').hidden = !withUndo;
  t.classList.toggle('warn', kind === 'warn');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, kind === 'warn' || withUndo ? 7000 : 2800);
}
function hideToast() {
  clearTimeout(toastTimer);
  $('toast').classList.remove('show');
  $('toastUndo').hidden = true;
}
function hideUndoToast() {
  if (!$('toastUndo').hidden) hideToast();
}

/* ---------- Drawing ---------- */

// Paints vertical bands of the stripe sequence across x0..x1 (and y0..y1).
// "origin" is where a repeat starts. "ov" is a hairline overlap that hides seams between stripes.
function paintBands(ctx, stripes, ppm, x0, x1, y0, y1, origin, ov) {
  const R = totalMM(stripes) * ppm;
  if (!(R > 0)) return;
  let base = origin + Math.floor((x0 - origin) / R) * R;
  for (let guard = 0; base < x1 && guard < 200000; base += R, guard++) {
    let x = base;
    for (const s of stripes) {
      const w = s.width * ppm;
      if (x + w >= x0 && x <= x1) {
        ctx.fillStyle = s.color;
        ctx.fillRect(x, y0, w + ov, y1 - y0);
      }
      x += w;
    }
  }
}

// Runs fn with x and y swapped, so vertical bands come out horizontal.
function swapped(ctx, fn) {
  ctx.save();
  ctx.transform(0, 1, 1, 0, 0, 0);
  fn();
  ctx.restore();
}

// Draws the crossing (horizontal) layer of a check on its own layer, then lays it over the
// vertical stripes, either darkening (multiply) or blending half and half.
const weftLayer = document.createElement('canvas');
function overlayWeft(ctx, d, paint) {
  weftLayer.width = ctx.canvas.width;   // also clears it
  weftLayer.height = ctx.canvas.height;
  const l = weftLayer.getContext('2d');
  l.setTransform(ctx.getTransform());
  paint(l);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (d.crossing === 'mix') ctx.globalAlpha = 0.5;
  else ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(weftLayer, 0, 0);
  ctx.restore();
}

function diagonalAngle(d) {
  return (d.layout === 'diagonal-left' ? -1 : 1) * d.angle * Math.PI / 180;
}

// Fills a W x H area with the repeated fabric.
function paintFabric(ctx, d, W, H, ppm, ov) {
  const st = d.stripes;
  if (d.layout === 'vertical') {
    paintBands(ctx, st, ppm, 0, W, 0, H, 0, ov);
  } else if (d.layout === 'horizontal') {
    swapped(ctx, () => paintBands(ctx, st, ppm, 0, H, 0, W, 0, ov));
  } else if (d.layout === 'check') {
    paintBands(ctx, st, ppm, 0, W, 0, H, 0, ov);
    overlayWeft(ctx, d, l => swapped(l, () => paintBands(l, st, ppm, 0, H, 0, W, 0, ov)));
  } else {
    const r = Math.hypot(W, H) / 2 + 2;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(diagonalAngle(d));
    paintBands(ctx, st, ppm, -r, r, -r, r, 0, ov);
    ctx.restore();
  }
}

// Dashed lines where each repeat starts, in alternating light and dark so they show on any color.
function repeatLines(ctx, R, x0, x1, y0, y1, origin) {
  if (!(R >= 8)) return;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  for (let x = origin + Math.ceil((x0 - origin) / R) * R; x <= x1; x += R) {
    for (const [color, offset] of [['rgba(255,255,255,.9)', 0], ['rgba(0,0,0,.75)', 5]]) {
      ctx.strokeStyle = color;
      ctx.lineDashOffset = offset;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawRepeatLines(ctx, d, W, H, ppm) {
  const R = totalMM(d.stripes) * ppm;
  if (d.layout === 'vertical' || d.layout === 'check') repeatLines(ctx, R, 0, W, 0, H, 0);
  if (d.layout === 'horizontal' || d.layout === 'check') swapped(ctx, () => repeatLines(ctx, R, 0, H, 0, W, 0));
  if (isDiagonal(d)) {
    const r = Math.hypot(W, H) / 2 + 2;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(diagonalAngle(d));
    repeatLines(ctx, R, -r, r, -r, r, 0);
    ctx.restore();
  }
}

function isMultiple(a, b) {
  const q = a / b;
  return Math.abs(q - Math.round(q)) < 1e-6;
}

// A millimetre ruler along the top or left edge.
function drawRuler(ctx, length, ppm, side, th) {
  const T = 20;
  ctx.save();
  if (side === 'left') { ctx.translate(T, 0); ctx.rotate(Math.PI / 2); }
  // Local coordinates: x runs along the ruler, the band is y = 0..T.
  // The edge next to the fabric is y = T for the top ruler and y = 0 for the left one.
  const inner = side === 'top' ? T : 0;
  ctx.fillStyle = th.rulerBg;
  ctx.fillRect(0, 0, length, T);
  ctx.fillStyle = th.rulerInk;
  ctx.fillRect(0, side === 'top' ? T - 1 : 0, length, 1);
  const labelStep = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(s => s * ppm >= 46) || 1000;
  const minor = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]
    .find(m => m * ppm >= 5 && isMultiple(labelStep, m)) || labelStep;
  ctx.font = '600 10px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const n = Math.floor(length / (minor * ppm) + 1e-9);
  for (let k = 0; k <= n; k++) {
    const mm = Math.round(k * minor * 1000) / 1000;
    const x = mm * ppm;
    const isLabel = isMultiple(mm, labelStep);
    const isHalf = !isLabel && isMultiple(mm, labelStep / 2);
    const h = isLabel ? 9 : isHalf ? 6 : 3;
    ctx.fillRect(x, side === 'top' ? inner - h : inner, 1, h);
    if (isLabel && k > 0) ctx.fillText(String(mm), x + 3, side === 'top' ? 7 : T - 7);
  }
  ctx.fillText('mm', 3, side === 'top' ? 7 : T - 7);
  ctx.restore();
}

// Positions where one stripe ends and the next begins, inside one repeat.
function boundaries(stripes, ppm, origin) {
  const out = [];
  let x = origin;
  for (let i = 0; i < stripes.length - 1; i++) { x += stripes[i].width * ppm; out.push(x); }
  return out;
}

// A dimension line with end caps, small ticks at stripe edges, and a label.
function dimension(ctx, x1, y1, x2, y2, text, ticks, th) {
  const horiz = y1 === y2;
  ctx.save();
  ctx.strokeStyle = th.ink;
  ctx.fillStyle = th.ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  if (horiz) { ctx.moveTo(x1, y1 - 6); ctx.lineTo(x1, y1 + 6); ctx.moveTo(x2, y2 - 6); ctx.lineTo(x2, y2 + 6); }
  else { ctx.moveTo(x1 - 6, y1); ctx.lineTo(x1 + 6, y1); ctx.moveTo(x2 - 6, y2); ctx.lineTo(x2 + 6, y2); }
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  for (const t of ticks) {
    if (horiz) { ctx.moveTo(t, y1 - 3); ctx.lineTo(t, y1 + 3); }
    else { ctx.moveTo(x1 - 3, t); ctx.lineTo(x1 + 3, t); }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (text) {
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    if (horiz) { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(text, (x1 + x2) / 2, y1 + 9); }
    else { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, x1 + 10, (y1 + y2) / 2); }
  }
  ctx.restore();
}

function cardShadow(ctx, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.2)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// One repeat on its own, with its size marked.
function drawSingle(ctx, d, W, H, ppm, th, ov) {
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = th.dot;
  for (let y = 10; y < H; y += 20) for (let x = 10; x < W; x += 20) ctx.fillRect(x, y, 1.5, 1.5);

  const st = d.stripes, Rmm = totalMM(st), R = Rmm * ppm, L = d.layout;
  const label = fmtMM(Rmm);

  if (!isDiagonal(d)) {
    let rw, rh;
    if (L === 'vertical') { rw = R; rh = Math.max(60, H - 112); }
    else if (L === 'horizontal') { rw = Math.max(60, W - 200); rh = R; }
    else { rw = R; rh = R; }
    const rx = Math.round((W - rw) / 2) - (L === 'vertical' ? 0 : 40);
    const ry = Math.round((H - rh) / 2) - (L === 'horizontal' ? 0 : 14);
    cardShadow(ctx, rx, ry, rw, rh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.clip();
    if (L === 'horizontal') {
      swapped(ctx, () => paintBands(ctx, st, ppm, ry, ry + rh, rx, rx + rw, ry, ov));
    } else {
      paintBands(ctx, st, ppm, rx, rx + rw, ry, ry + rh, rx, ov);
      if (L === 'check') overlayWeft(ctx, d, l => swapped(l, () => paintBands(l, st, ppm, ry, ry + rh, rx, rx + rw, ry, ov)));
    }
    ctx.restore();
    if (L !== 'horizontal') dimension(ctx, rx, ry + rh + 18, rx + rw, ry + rh + 18, label, boundaries(st, ppm, rx), th);
    if (L !== 'vertical') dimension(ctx, rx + rw + 18, ry, rx + rw + 18, ry + rh, label, boundaries(st, ppm, ry), th);
    return;
  }

  // Diagonal: one band, tilted, as long as fits the area.
  const a = diagonalAngle(d), s = Math.abs(Math.sin(a)), c = Math.cos(a), M = 56;
  const half = Math.max(30, Math.min((H / 2 - M - (R / 2) * s) / c, (W / 2 - M - (R / 2) * c) / s));
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(a);
  cardShadow(ctx, -R / 2, -half, R, 2 * half);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-R / 2, -half, R, 2 * half);
  ctx.clip();
  paintBands(ctx, st, ppm, -R / 2, R / 2, -half, half, -R / 2, ov);
  ctx.restore();
  // The label follows the tilt of the dimension line, so it never sits on top of the stripes.
  dimension(ctx, -R / 2, half + 16, R / 2, half + 16, label, boundaries(st, ppm, -R / 2), th);
  ctx.restore();
}

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = name => cs.getPropertyValue(name).trim();
  return { bg: v('--canvas-bg'), dot: v('--canvas-dot'), ink: v('--text'), muted: v('--muted'), rulerBg: v('--ruler-bg'), rulerInk: v('--ruler-ink') };
}

const canvas = $('preview');
const stage = $('stage');
let cssW = 0, cssH = 0, dpr = 1;

function sizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  cssW = stage.clientWidth;
  cssH = stage.clientHeight;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  renderPreview();
}

function renderPreview() {
  if (!cssW || !cssH) return;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const hasStripes = design.stripes.length > 0;
  $('emptyMsg').hidden = hasStripes;
  if (!hasStripes) return;
  const th = themeColors(), ov = 1 / dpr, ppm = pxPerMm() * view.zoom;
  const d = cwView(design, cw());
  if (view.mode === 'single') {
    drawSingle(ctx, d, cssW, cssH, ppm, th, ov);
    return;
  }
  if (view.mode === 'garment') {
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, cssW, cssH);
    drawGarmentSet(ctx, design, cw(), { x: 0, y: 0, w: cssW, h: cssH },
      { px: 1, devPerUnit: dpr, ink: th.ink, muted: th.muted, labels: true, show: view.gShow });
    return;
  }
  paintFabric(ctx, d, cssW, cssH, ppm, ov);
  if (view.repeatLines) drawRepeatLines(ctx, d, cssW, cssH, ppm);
  if (view.ruler) {
    if (d.layout === 'horizontal' || d.layout === 'check') drawRuler(ctx, cssH, ppm, 'left', th);
    if (d.layout !== 'horizontal') drawRuler(ctx, cssW, ppm, 'top', th);
  }
}

// Small picture of a design for the My designs list.
function drawThumb(cnv, d) {
  const size = 56, k = 2;
  cnv.width = size * k;
  cnv.height = size * k;
  const ctx = cnv.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const R = totalMM(d.stripes);
  if (!R) { ctx.fillStyle = '#ccc'; ctx.fillRect(0, 0, size, size); return; }
  const ppm = Math.min(12, Math.max(0.4, size / (2.2 * R)));
  paintFabric(ctx, cwView(d, 0), size, size, ppm, 1 / k);
}

/* ---------- Pajama preview (flat sketch, no AI) ---------- */
// Garments are drawn in centimetres for an adult size M, so the stripes keep their real scale.
// Every piece has a grain: the direction its stripes run (down the body, along each sleeve).

// The main color of a colorway: the one covering the largest share of the repeat.
function mainColor(d, k) {
  const groups = colorGroups(cwStripes(d, k)).sort((a, b) => b.width - a.width);
  return groups.length ? groups[0].color : '#cccccc';
}
function solidColor(d, k) {
  return d.colorways[k].solid || mainColor(d, k);
}

const GARMENT_OUTLINE = '#2b2f36';
const pt = (x, y) => ({ x, y });
const lerpPt = (a, b, t) => pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
function polyPath(points) {
  const p = new Path2D();
  points.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
  p.closePath();
  return p;
}
function rectPath(x, y, w, h) {
  const p = new Path2D();
  p.rect(x, y, w, h);
  return p;
}

// The pajama top: body, sleeves, and either a crew neckband or a collar with placket and pocket.
function topShape(g) {
  const shirt = g.top === 'shirt', long = g.sleeve === 'long';
  const hps = shirt ? 8 : 9, L = shirt ? 72 : 70;
  const sh = shirt ? pt(23.5, 4.5) : pt(22.5, 4);   // shoulder point
  const ua = shirt ? pt(27.5, 24) : pt(26, 23);     // underarm
  const pieces = [], lines = [], extras = [], bounds = [pt(-ua.x, 0), pt(ua.x, L)];

  const body = new Path2D();
  body.moveTo(-hps, 0);
  body.quadraticCurveTo(0, 2.2, hps, 0);
  [pt(sh.x, sh.y), pt(ua.x, ua.y), pt(ua.x, L), pt(-ua.x, L), pt(-ua.x, ua.y), pt(-sh.x, sh.y)].forEach(q => body.lineTo(q.x, q.y));
  body.closePath();
  pieces.push({ path: body, grain: 0, anchor: pt(0, 0), shade: [pt(-ua.x, 0), pt(ua.x, 0)] });
  lines.push({ dash: true, pts: [pt(-ua.x, L - 2.5), pt(ua.x, L - 2.5)] });

  const theta = (long ? 66 : 32) * Math.PI / 180;   // how far the sleeve hangs below horizontal
  const len = long ? 60 : 21, halfEnd = long ? 5.2 : 9;
  for (const side of [-1, 1]) {
    const S = pt(side * sh.x, sh.y), U = pt(side * ua.x, ua.y), M = lerpPt(S, U, 0.5);
    const dir = pt(side * Math.cos(theta), Math.sin(theta));       // along the sleeve
    const perp = pt(side * Math.sin(theta), -Math.cos(theta));     // across it, toward the shoulder
    const C = pt(M.x + dir.x * len, M.y + dir.y * len);
    const T = pt(C.x + perp.x * halfEnd, C.y + perp.y * halfEnd);
    const B = pt(C.x - perp.x * halfEnd, C.y - perp.y * halfEnd);
    const grain = side * (theta - Math.PI / 2);
    const mid = pt(M.x + dir.x * len / 2, M.y + dir.y * len / 2);
    pieces.push({ path: polyPath([S, T, B, U]), grain, anchor: M,
      shade: [pt(mid.x - perp.x * 9, mid.y - perp.y * 9), pt(mid.x + perp.x * 9, mid.y + perp.y * 9)] });
    bounds.push(T, B);
    if (long) {
      const f = 1 - (shirt ? 7 : 6) / len;   // cuff
      pieces.push({ path: polyPath([lerpPt(S, T, f), T, B, lerpPt(U, B, f)]), grain, anchor: M });
    } else {
      lines.push({ dash: true, pts: [pt(T.x - dir.x * 2.5, T.y - dir.y * 2.5), pt(B.x - dir.x * 2.5, B.y - dir.y * 2.5)] });
    }
  }

  if (!shirt) {
    // The inside of the back neck, seen through the neck opening, then the neckband on top.
    const inside = new Path2D();
    inside.moveTo(-hps, 0);
    inside.quadraticCurveTo(0, 2.2, hps, 0);
    inside.bezierCurveTo(8.6, 6.5, 4.8, 9, 0, 9);
    inside.bezierCurveTo(-4.8, 9, -8.6, 6.5, -hps, 0);
    inside.closePath();
    pieces.push({ path: inside, inside: true });
    const band = new Path2D();
    band.moveTo(-10.9, 0.6);
    band.bezierCurveTo(-10.5, 8.6, -5.6, 11, 0, 11);
    band.bezierCurveTo(5.6, 11, 10.5, 8.6, 10.9, 0.6);
    band.lineTo(hps, 0);
    band.bezierCurveTo(8.6, 6.5, 4.8, 9, 0, 9);
    band.bezierCurveTo(-4.8, 9, -8.6, 6.5, -hps, 0);
    band.closePath();
    pieces.push({ path: band, grain: 0, anchor: pt(0, 0) });
  } else {
    // Notch collar: collar and lapel on each side, the inside of the back seen in the V,
    // a button placket and a chest pocket.
    const A = pt(-hps, 0), Bc = pt(-13.2, 5.8), C = pt(-10.4, 8.6), D = pt(-12.2, 10.6), E = pt(0, 27), G = pt(-5, 4);
    const inside = new Path2D();
    inside.moveTo(A.x, A.y);
    inside.quadraticCurveTo(0, 2.2, -A.x, A.y);
    inside.lineTo(-G.x, G.y);
    inside.lineTo(E.x, E.y);
    inside.lineTo(G.x, G.y);
    inside.closePath();
    pieces.push({ path: inside, inside: true });
    pieces.push({ path: rectPath(-1.75, 27, 3.5, L - 27), grain: 0, anchor: pt(0, 0) });
    pieces.push({ path: rectPath(8, 24, 11.5, 13), grain: 0, anchor: pt(0, 0) });
    lines.push({ dash: true, pts: [pt(8, 26.2), pt(19.5, 26.2)] });
    for (const side of [-1, 1]) {
      const f = q => pt(side * -q.x, q.y);   // the left side as drawn above, or its mirror image
      pieces.push({ path: polyPath([A, Bc, C, D, E, G].map(f)), grain: 0, anchor: pt(0, 0) });
      lines.push({ pts: [f(C), f(pt(-6.4, 6.2))] });
    }
    for (const y of [32, 42, 52, 62]) extras.push({ button: pt(0, y) });
  }
  return { pieces, lines, extras, bbox: bboxOf(bounds) };
}

// Pull-on pajama bottoms: elastic waistband with drawstring, shorts or long pants.
function bottomShape(g) {
  const long = g.bottom === 'pants';
  const hip = 27, wb = 4, crotch = 30, hem = long ? 104 : 44;
  const oh = long ? 24 : 28.5, ih = long ? 3 : 1.5;   // outer and inner corner of each leg at the hem
  const pieces = [], lines = [], extras = [];
  pieces.push({
    path: polyPath([pt(-25.5, wb), pt(25.5, wb), pt(hip, 20), pt(oh, hem), pt(ih, hem), pt(0, crotch),
      pt(-ih, hem), pt(-oh, hem), pt(-hip, 20)]),
    grain: 0, anchor: pt(0, 0), shade: [pt(-hip, 0), pt(hip, 0)],
  });
  pieces.push({ path: rectPath(-25.5, 0, 51, wb), grain: 0, anchor: pt(0, 0) });
  const yS = hem - 2.5;
  const outerX = hip + (oh - hip) * (yS - 20) / (hem - 20), innerX = ih * (yS - crotch) / (hem - crotch);
  for (const side of [-1, 1]) lines.push({ dash: true, pts: [pt(side * outerX, yS), pt(side * innerX, yS)] });
  lines.push({ pts: [pt(0, wb), pt(0, crotch - 0.3)] });                     // centre front seam
  for (let x = -23.5; x <= 23.6; x += 2.5) lines.push({ alpha: 0.45, pts: [pt(x, wb + 0.4), pt(x + 0.3, wb + 2.4)] });
  extras.push({ cord: [pt(-1.3, 2), pt(-1.9, 9), pt(-3, 15)] }, { cord: [pt(1.3, 2), pt(2.3, 8.5), pt(2.4, 14.5)] });
  return { pieces, lines, extras, bbox: bboxOf([pt(-Math.max(hip, oh), 0), pt(Math.max(hip, oh), hem)]) };
}

function bboxOf(points) {
  const xs = points.map(q => q.x), ys = points.map(q => q.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// Fills one piece with the stripes, turned to the piece's grain. ctx is in centimetres.
function paintPiece(ctx, v, piece, ov) {
  const R = totalMM(v.stripes) / 10;   // the repeat, in cm
  if (!(R > 0)) return;
  const half = Math.ceil(150 / R) * R;  // a whole number of repeats, so the pattern starts at the anchor
  ctx.save();
  ctx.translate(piece.anchor.x, piece.anchor.y);
  ctx.rotate(piece.grain);
  ctx.translate(-half, -half);
  paintFabric(ctx, v, 2 * half, 2 * half, 0.1, ov);   // 0.1 cm per mm
  ctx.restore();
}

// Draws one garment. ctx is in centimetres; solid = a color, or null for stripes.
function drawShape(ctx, shape, v, solid, s, opt) {
  const lw = opt.px / s;                       // one screen pixel, in cm
  const ov = 1 / (opt.devPerUnit * s);          // one device pixel, in cm
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.22)';
  ctx.shadowBlur = 10 * opt.px * opt.devPerUnit;
  ctx.shadowOffsetY = 3 * opt.px * opt.devPerUnit;
  ctx.fillStyle = '#ffffff';
  for (const p of shape.pieces) if (!p.inside) ctx.fill(p.path);
  ctx.restore();

  for (const p of shape.pieces) {
    ctx.save();
    ctx.clip(p.path);
    if (p.inside) {
      ctx.fillStyle = 'rgba(0,0,0,.32)';
      ctx.fill(p.path);
    } else if (solid) {
      ctx.fillStyle = solid;
      ctx.fill(p.path);
    } else {
      paintPiece(ctx, v, p, ov);
    }
    if (p.shade) {
      const [a, b] = p.shade;
      const gr = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      gr.addColorStop(0, 'rgba(0,0,0,.14)');
      gr.addColorStop(0.2, 'rgba(0,0,0,0)');
      gr.addColorStop(0.8, 'rgba(0,0,0,0)');
      gr.addColorStop(1, 'rgba(0,0,0,.14)');
      ctx.fillStyle = gr;
      ctx.fill(p.path);
    }
    ctx.restore();
  }

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = GARMENT_OUTLINE;
  ctx.lineWidth = 1.3 * lw;
  for (const p of shape.pieces) ctx.stroke(p.path);
  for (const ln of shape.lines) {
    ctx.save();
    ctx.globalAlpha = ln.alpha || 1;
    ctx.lineWidth = (ln.dash ? 0.9 : 1.1) * lw;
    ctx.strokeStyle = ln.dash ? 'rgba(125,125,125,.95)' : GARMENT_OUTLINE;
    if (ln.dash) ctx.setLineDash([3.5 * lw, 2.5 * lw]);
    ctx.beginPath();
    ln.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
    ctx.restore();
  }
  for (const ex of shape.extras) {
    if (ex.button) {
      ctx.beginPath();
      ctx.arc(ex.button.x, ex.button.y, 0.75, 0, Math.PI * 2);
      ctx.fillStyle = '#f4f1ea';
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.stroke();
    } else if (ex.cord) {
      const [p0, p1, p2] = ex.cord;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
      ctx.lineWidth = 2.8 * lw;
      ctx.strokeStyle = GARMENT_OUTLINE;
      ctx.stroke();
      ctx.lineWidth = 1.5 * lw;
      ctx.strokeStyle = '#f4f1ea';
      ctx.stroke();
      for (const q of [p0, p2]) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 0.45, 0, Math.PI * 2);
        ctx.fillStyle = '#f4f1ea';
        ctx.fill();
        ctx.lineWidth = lw;
        ctx.strokeStyle = GARMENT_OUTLINE;
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// The pajama set (top and bottom side by side) for colorway k, fitted into box.
// opt.px = one screen pixel in the box's units; opt.devPerUnit = device pixels per unit;
// opt.show = 'set' | 'top' | 'bottom'; opt.labels = write what each piece is underneath.
function drawGarmentSet(ctx, d, k, box, opt) {
  const g = d.garment, show = opt.show || 'set';
  const v = cwView(d, k), solid = solidColor(d, k);
  const items = [];
  if (show !== 'bottom') items.push({ shape: topShape(g), solid: g.striped === 'bottom' ? solid : null,
    name: `${g.top === 'shirt' ? 'Button-front top' : 'T-shirt top'}, ${g.sleeve === 'long' ? 'long' : 'short'} sleeves` });
  if (show !== 'top') items.push({ shape: bottomShape(g), solid: g.striped === 'top' ? solid : null,
    name: g.bottom === 'pants' ? 'Long pants' : 'Shorts' });
  const gap = 14;   // cm between top and bottom
  const widths = items.map(it => it.shape.bbox.x1 - it.shape.bbox.x0);
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
  const totalH = Math.max(...items.map(it => it.shape.bbox.y1 - it.shape.bbox.y0));
  const pad = (opt.pad != null ? opt.pad : 24) * opt.px;
  const labelH = opt.labels ? 34 * opt.px : 0;
  const s = Math.max(0.01, Math.min((box.w - 2 * pad) / totalW, (box.h - 2 * pad - labelH) / totalH));   // units per cm
  let x = box.x + (box.w - totalW * s) / 2;
  const y = box.y + pad + (box.h - 2 * pad - labelH - totalH * s) / 2;
  items.forEach((it, i) => {
    const bb = it.shape.bbox;
    ctx.save();
    ctx.translate(x - bb.x0 * s, y - bb.y0 * s);
    ctx.scale(s, s);
    drawShape(ctx, it.shape, v, it.solid, s, opt);
    ctx.restore();
    if (opt.labels) {
      const cx = x + widths[i] * s / 2, ty = y + totalH * s + 12 * opt.px;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = opt.ink;
      ctx.font = `600 ${12 * opt.px}px Inter, system-ui, sans-serif`;
      ctx.fillText(it.name, cx, ty);
      ctx.fillStyle = opt.muted;
      ctx.font = `400 ${11 * opt.px}px Inter, system-ui, sans-serif`;
      ctx.fillText(it.solid ? `Solid ${it.solid.toUpperCase()}` : 'Stripes', cx, ty + 16 * opt.px);
      ctx.restore();
    }
    x += (widths[i] + gap) * s;
  });
}

/* ---------- Rendering the controls ---------- */

const listEl = $('stripeList');

function stripeRow(s, i, n) {
  const k = i + 1;
  return `<li class="stripe" data-i="${i}">
    <span class="num">${k}</span>
    <button class="swatch" data-a="pick" style="background:${s.color}" title="Choose a company color" aria-label="Stripe ${k} color: choose a company color"></button>
    <div class="fields">
      <input type="text" value="${esc(s.pantone)}" data-f="pantone" placeholder="Color ref." maxlength="60" autocomplete="off" aria-label="Stripe ${k} color reference">
      <input type="text" class="hex mono" value="${s.color.toUpperCase()}" data-f="hex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Stripe ${k} hex color">
    </div>
    <div class="width">
      <input type="text" class="mono" inputmode="decimal" value="${fmtWidth(s.width)}" data-f="width" autocomplete="off" aria-label="Stripe ${k} width in millimetres">
      <span>mm</span>
    </div>
    <div class="row-actions">
      <button data-a="up" title="Move up" aria-label="Move stripe ${k} up"${i === 0 ? ' disabled' : ''}>${ICON.up}</button>
      <button data-a="dup" title="Duplicate" aria-label="Duplicate stripe ${k}">${ICON.dup}</button>
      <button data-a="down" title="Move down" aria-label="Move stripe ${k} down"${i === n - 1 ? ' disabled' : ''}>${ICON.down}</button>
      <button data-a="del" title="Delete" aria-label="Delete stripe ${k}">${ICON.del}</button>
    </div>
  </li>`;
}

function renderStripeList() {
  const st = cwStripes(design, cw());   // colors of the colorway being edited
  listEl.innerHTML = st.length
    ? st.map((s, i) => stripeRow(s, i, st.length)).join('')
    : '<li class="list-empty">No stripes yet. Use <b>Add stripe</b> to begin.</li>';
  $('stripeCount').textContent = st.length === 1 ? '1 stripe' : st.length + ' stripes';
  $('mirrorBtn').disabled = st.length < 3;
  $('reverseBtn').disabled = st.length < 2;
}

function renderDesignControls() {
  const name = $('nameInput');
  if (name.value !== design.name) name.value = design.name;
  $('fabricSelect').value = design.fabric;
  for (const b of document.querySelectorAll('#layoutSeg button')) b.setAttribute('aria-pressed', String(b.dataset.layout === design.layout));
  for (const b of document.querySelectorAll('#angleSeg button')) b.setAttribute('aria-pressed', String(Number(b.dataset.angle) === design.angle));
  for (const b of document.querySelectorAll('#crossSeg button')) b.setAttribute('aria-pressed', String(b.dataset.cross === design.crossing));
  $('angleRow').hidden = !isDiagonal(design);
  $('crossRow').hidden = design.layout !== 'check';
  for (const el of document.querySelectorAll('[data-detail]')) {
    const v = design.details[el.dataset.detail];
    if (el.value !== v) el.value = v;
  }
}

// The colorway tabs above the stripe list, and the name/delete row for the one being edited.
function renderColorways() {
  const k = cw(), n = design.colorways.length;
  $('cwBar').innerHTML = design.colorways.map((c, i) => {
    const chips = colorGroups(cwStripes(design, i)).slice(0, 4).map(g => `<i style="background:${g.color}"></i>`).join('');
    return `<button class="cw-tab" data-cw="${i}" aria-pressed="${i === k}" title="Show and edit colorway ${esc(c.name)}">` +
      `<span class="chips">${chips}</span><span class="nm">${esc(c.name)}</span></button>`;
  }).join('') +
    `<button class="cw-add" id="cwAdd"${n >= MAX_COLORWAYS ? ' disabled' : ''} title="Add a colorway: the same stripes in other colors. It starts as a copy of this one.">+ Colorway</button>`;
  $('cwEdit').hidden = n < 2;
  const name = $('cwName');
  if (name.value !== design.colorways[k].name && document.activeElement !== name) name.value = design.colorways[k].name;
  $('colorsTitle').textContent = n > 1 ? `colorway ${design.colorways[k].name}` : 'this design';
}

function renderViewControls() {
  for (const b of document.querySelectorAll('#modeSeg button')) b.setAttribute('aria-pressed', String(b.dataset.mode === view.mode));
  $('zoomVal').textContent = Math.round(view.zoom * 100) + '%';
  $('zoomOut').disabled = view.zoom <= ZOOM_STEPS[0];
  $('zoomIn').disabled = view.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1];
  $('linesToggle').checked = view.repeatLines;
  $('rulerToggle').checked = view.ruler;
  const garment = view.mode === 'garment';
  $('linesLabel').hidden = view.mode !== 'fabric';
  $('rulerLabel').hidden = view.mode !== 'fabric';
  document.querySelector('.zoom').hidden = garment;
  $('calBtn').hidden = garment;
  $('garmentBar').hidden = !garment;
  $('gShow').hidden = !garment;
  document.querySelector('.view').classList.toggle('garment', garment);
  $('calBtn').textContent = calibration
    ? '100% = real size (calibrated) · Recalibrate'
    : '100% = real size (approx.) · Calibrate';
  for (const b of document.querySelectorAll('#gShow button')) b.setAttribute('aria-pressed', String(b.dataset.v === view.gShow));
}

// The pajama options: which top, sleeves, bottom, which part is striped, and the solid color.
function renderGarmentBar() {
  const g = design.garment, k = cw();
  for (const seg of document.querySelectorAll('#garmentBar [data-g]')) {
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === g[seg.dataset.g]));
  }
  const solid = solidColor(design, k), chosen = design.colorways[k].solid;
  const colors = colorGroups(cwStripes(design, k)).map(gr => gr.color);
  if (!colors.includes(solid)) colors.push(solid);
  const box = $('solidChips');
  if (g.striped === 'both') {
    box.innerHTML = '<span class="solid-note">Not needed: both parts are striped.</span>';
    return;
  }
  box.innerHTML = colors.map(c => {
    const auto = !chosen && c === solid;
    return `<button data-solid="${c}" style="background:${c}" aria-pressed="${c === solid}" ` +
      `title="${c.toUpperCase()}${auto ? ' (automatic: the main color of the stripes)' : ''}"></button>`;
  }).join('') +
    `<label title="Another color"><input type="color" id="solidOther" value="${solid}" aria-label="Another solid color"></label>`;
}

function renderStats() {
  const st = cwStripes(design, cw()), R = totalMM(st), fab = fabricFor(design.fabric);
  $('rapportVal').textContent = fmtMM(R);
  $('statStripes').textContent = st.length;
  $('statLayout').textContent = layoutLabel(design);

  const chip = $('rapportChip');
  chip.hidden = !st.length;
  if (R > fab.maxRapport) {
    chip.className = 'chip over';
    chip.innerHTML = `${ICON.warn}Over the ${esc(fab.code)} maximum (${fab.maxRapport} mm) by ${(R - fab.maxRapport).toFixed(2)} mm`;
  } else {
    chip.className = 'chip ok';
    chip.innerHTML = `${ICON.ok}Fits ${esc(fab.code)} (max ${fab.maxRapport} mm)`;
  }
  renderLimit();

  $('statNote').textContent = layoutNote(design);

  renderColorSummary();
}

// Colors of the colorway being edited. Stripes with the same color and Pantone label are added
// together; changing a color or Pantone here changes all of those stripes at once.
function renderColorSummary() {
  const st = cwStripes(design, cw()), R = totalMM(st);
  const groups = colorGroups(st);
  $('colorRows').innerHTML = groups.length
    ? groups.map(g => `<tr data-idx="${g.indices.join(',')}">
        <td class="sw"><button class="swatch-sm" data-gpick style="background:${g.color}" title="Choose a company color for every stripe that has this color" aria-label="Change color ${g.color.toUpperCase()} in every stripe that has it"></button></td>
        <td><input type="text" class="pan" value="${esc(g.pantone)}" data-gf="pantone" placeholder="Color ref." maxlength="60" autocomplete="off" aria-label="Color reference for ${g.color.toUpperCase()}"></td>
        <td class="mono">${g.color.toUpperCase()}</td>
        <td class="r">${g.count}</td>
        <td class="r mono">${g.width.toFixed(2)} mm</td>
        <td class="r">${(g.width / R * 100).toFixed(1)}%</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="muted">No stripes yet.</td></tr>';
}

/* ---------- The fabric's maximum rapport ---------- */

// Millimetres the fabric still allows (negative when the design is already too long).
function roomLeft() {
  return Math.round((fabricFor(design.fabric).maxRapport - totalMM(design.stripes)) * 100) / 100;
}

// The meter above the stripe list, and the red banner over the preview when the design is too long.
function renderLimit() {
  const fab = fabricFor(design.fabric), max = fab.maxRapport;
  const R = totalMM(design.stripes), left = roomLeft(), over = left < 0;
  const pct = Math.min(100, R / max * 100);
  $('meterFill').style.width = pct + '%';
  $('meter').classList.toggle('over', over);
  $('meter').classList.toggle('near', !over && pct >= 90);
  $('meterText').textContent = over
    ? `${R.toFixed(2)} mm: ${(-left).toFixed(2)} mm over the ${fab.code} maximum of ${max} mm`
    : left < 0.1
      ? `${R.toFixed(2)} of ${max} mm used: the design is full`
      : `${R.toFixed(2)} of ${max} mm used · ${left.toFixed(2)} mm left`;
  $('rapportVal').classList.toggle('over', over);
  const banner = $('limitBanner');
  banner.hidden = !over;
  if (over) {
    banner.innerHTML = `${ICON.warn}<div><b>Too long for ${esc(fab.code)}.</b> The rapport is ${R.toFixed(2)} mm, ` +
      `but ${esc(fab.code)} allows at most ${max} mm. Make the stripes ${(-left).toFixed(2)} mm narrower in total, ` +
      `or choose a fabric with a larger maximum. Until then, nothing can be added.</div>`;
  }
}

// Explains, in red, why a change was refused, and shakes the meter so the eye goes there.
function refuse(msg) {
  toast(msg, { kind: 'warn' });
  const m = $('meter');
  m.classList.remove('shake');
  void m.offsetWidth;
  m.classList.add('shake');
}

// True when the repeating sequence reads the same in both directions around some centre
// (the middle of a stripe, or the edge between two stripes), in every colorway.
// Mirroring it again would only repeat it.
function isSymmetric(st) {
  const n = st.length;
  const same = (a, b) => a.width === b.width && a.colors.every((c, k) =>
    c.color === b.colors[k].color && c.pantone.trim() === b.colors[k].pantone.trim());
  for (let p = 0; p < n; p++) {
    let onStripe = true, onEdge = true;
    for (let i = 1; i < n && onStripe; i++) onStripe = same(st[(p + i) % n], st[(p - i + n) % n]);
    for (let i = 0; i < n && onEdge; i++) onEdge = same(st[(p + i) % n], st[(p - 1 - i + 2 * n) % n]);
    if (onStripe || onEdge) return true;
  }
  return false;
}

function renderAll() {
  renderDesignControls();
  renderColorways();
  renderStripeList();
  renderStats();
  renderGarmentBar();
  renderPreview();
  updateUndoButtons();
  updateSaveState();
  saveCurrentSoon();
}

// After any change to the design that should be one undo step.
function changed({ list = false, controls = false } = {}) {
  commit();
  if (controls) renderDesignControls();
  if (list) renderStripeList();
  renderColorways();
  renderStats();
  renderGarmentBar();
  renderPreview();
}

/* ---------- Design settings events ---------- */

$('fabricSelect').innerHTML = FABRICS
  .map(f => `<option value="${esc(f.code)}">${esc(f.code)} (max ${f.maxRapport} mm)</option>`)
  .join('');

$('nameInput').addEventListener('input', e => {
  design.name = e.target.value;
  updateSaveState();
  saveCurrentSoon();
});
$('nameInput').addEventListener('change', () => commit());

$('fabricSelect').addEventListener('change', e => {
  design.fabric = e.target.value;
  changed();
  const fab = fabricFor(design.fabric), left = roomLeft();
  if (left < 0) {
    toast(`This design is ${fmtMM(totalMM(design.stripes))}, longer than ${fab.code} allows (${fab.maxRapport} mm).`, { kind: 'warn' });
  }
});

$('layoutSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-layout]');
  if (!b || b.dataset.layout === design.layout) return;
  design.layout = b.dataset.layout;
  changed({ controls: true });
});
$('angleSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-angle]');
  if (!b) return;
  design.angle = Number(b.dataset.angle);
  changed({ controls: true });
});
$('crossSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-cross]');
  if (!b) return;
  design.crossing = b.dataset.cross;
  changed({ controls: true });
});

/* ---------- Stripe list events ---------- */

listEl.addEventListener('input', e => {
  const t = e.target, row = t.closest('.stripe');
  if (!row) return;
  const s = design.stripes[Number(row.dataset.i)];
  const c = s.colors[cw()];   // colors belong to the colorway being edited; the width is shared
  const f = t.dataset.f;
  if (f === 'hex') {
    const h = normalizeHex(t.value);
    t.classList.toggle('bad', !h);
    if (h) {
      c.color = h;
      row.querySelector('.swatch').style.background = h;
    }
  } else if (f === 'pantone') {
    c.pantone = t.value;
  } else if (f === 'width') {
    // Remember the width from before this edit, so a refused value can be put back.
    if (!('before' in t.dataset)) t.dataset.before = s.width;
    const w = parseWidth(t.value);
    if (w === null) {
      t.classList.add('bad');
    } else {
      // A stripe may always get narrower; it may only get wider while the fabric's maximum allows it.
      const fab = fabricFor(design.fabric);
      const allowed = Math.round((fab.maxRapport - (totalMM(design.stripes) - s.width)) * 100) / 100;
      if (w > s.width && w > allowed + 1e-9) {
        t.classList.add('bad');
        refuse(allowed > 0
          ? `Too wide: ${fab.code} allows at most ${fab.maxRapport} mm in total, so this stripe can be at most ${fmtWidth(allowed)} mm.`
          : `This stripe can't be made wider: the design is already over the ${fab.code} maximum of ${fab.maxRapport} mm.`);
      } else {
        t.classList.remove('bad');
        s.width = w;
      }
    }
  }
  renderColorways();
  renderStats();
  renderGarmentBar();
  renderPreview();
  updateUndoButtons();
  updateSaveState();
  saveCurrentSoon();
});

// When a field is finished (Enter, or leaving it): tidy what is shown and record an undo step.
listEl.addEventListener('change', e => {
  const t = e.target, row = t.closest('.stripe');
  if (!row) return;
  const s = design.stripes[Number(row.dataset.i)];
  const c = s.colors[cw()];
  const f = t.dataset.f;
  if (f === 'hex') { t.value = c.color.toUpperCase(); t.classList.remove('bad'); }
  if (f === 'width') {
    // If what was typed could not be used, go back to the width from before this edit.
    if (t.classList.contains('bad')) {
      const before = Number(t.dataset.before);
      if (before > 0) s.width = before;
    }
    delete t.dataset.before;
    t.value = fmtWidth(s.width);
    t.classList.remove('bad');
  }
  if (f === 'pantone') { c.pantone = t.value.trim(); t.value = c.pantone; }
  changed();
});

listEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('input[type="text"]')) e.target.blur();
});

listEl.addEventListener('click', e => {
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  const i = Number(b.closest('.stripe').dataset.i);
  if (b.dataset.a === 'pick') { openPicker({ type: 'stripe', idx: [i] }); return; }
  const st = design.stripes;
  let focusIndex = i;
  switch (b.dataset.a) {
    case 'up':
      if (i === 0) return;
      [st[i - 1], st[i]] = [st[i], st[i - 1]];
      focusIndex = i - 1;
      break;
    case 'down':
      if (i === st.length - 1) return;
      [st[i + 1], st[i]] = [st[i], st[i + 1]];
      focusIndex = i + 1;
      break;
    case 'dup': {
      const fab = fabricFor(design.fabric);
      if (st[i].width > roomLeft() + 1e-9) {
        refuse(`Can't duplicate: the rapport would become ${fmtMM(totalMM(st) + st[i].width)}, but ${fab.code} allows at most ${fab.maxRapport} mm.`);
        return;
      }
      st.splice(i + 1, 0, clone(st[i]));   // a real copy, so editing one never changes the other
      focusIndex = i + 1;
      break;
    }
    case 'del':
      st.splice(i, 1);
      focusIndex = Math.min(i, st.length - 1);
      break;
  }
  changed({ list: true });
  if (b.dataset.a === 'del') toast(`Stripe ${i + 1} deleted.`, { withUndo: true });
  const row = listEl.querySelector(`.stripe[data-i="${focusIndex}"]`);
  if (!row) return;
  if (b.dataset.a === 'dup') flash(row);
  const same = row.querySelector(`button[data-a="${b.dataset.a}"]`);
  (same && !same.disabled ? same : row.querySelector('[data-f="width"]')).focus({ preventScroll: true });
});

function flash(row) {
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

$('addBtn').addEventListener('click', () => {
  const fab = fabricFor(design.fabric), room = roomLeft();
  if (room < 0.1) {
    refuse(room < 0
      ? `Can't add a stripe: this design is already ${(-room).toFixed(2)} mm longer than ${fab.code} allows (${fab.maxRapport} mm).`
      : `Can't add a stripe: the design is full. ${fab.code} allows at most ${fab.maxRapport} mm. Make another stripe narrower first.`);
    return;
  }
  const width = Math.min(1, room);
  design.stripes.push({ width, colors: design.colorways.map(() => ({ color: '#9aa0a6', pantone: '' })) });
  changed({ list: true });
  const row = listEl.lastElementChild;
  flash(row);
  row.querySelector('[data-f="width"]').focus({ preventScroll: true });
  if (width < 1) toast(`Only ${fmtMM(room)} was left, so the new stripe is ${fmtWidth(width)} mm wide.`, { kind: 'warn' });
});

$('mirrorBtn').addEventListener('click', () => {
  const st = design.stripes;
  if (st.length < 3) return;
  if (isSymmetric(st)) {
    toast('The repeat is already symmetric, so Mirror has nothing to add.');
    return;
  }
  const next = st.concat(st.slice(1, -1).reverse().map(s => clone(s)));
  const fab = fabricFor(design.fabric);
  if (totalMM(next) > fab.maxRapport + 1e-9) {
    refuse(`Can't mirror: the rapport would become ${fmtMM(totalMM(next))}, but ${fab.code} allows at most ${fab.maxRapport} mm.`);
    return;
  }
  design.stripes = next;
  changed({ list: true });
  toast(`Mirrored: ${st.length} stripes became ${next.length}.`, { withUndo: true });
});

$('reverseBtn').addEventListener('click', () => {
  design.stripes = design.stripes.slice().reverse();
  changed({ list: true });
  toast('Stripe order reversed.', { withUndo: true });
});

$('toastUndo').addEventListener('click', () => {
  hideToast();
  undo();
});

/* ---------- Colorways ---------- */

$('cwBar').addEventListener('click', e => {
  if (e.target.closest('#cwAdd')) { addColorway(); return; }
  const b = e.target.closest('button[data-cw]');
  if (!b || Number(b.dataset.cw) === cw()) return;
  commit();   // finish any edit in progress first
  activeCw = Number(b.dataset.cw);
  renderAll();
});

// A new colorway starts as a copy of the one being shown; then its colors can be changed.
function addColorway() {
  if (design.colorways.length >= MAX_COLORWAYS) return;
  const k = cw(), from = design.colorways[k].name;
  const used = new Set(design.colorways.map(c => c.name));
  let name = '';
  for (let i = 0; i < 26 && !name; i++) if (!used.has(colorwayName(i))) name = colorwayName(i);
  design.colorways.push({ name: name || String(design.colorways.length + 1), solid: design.colorways[k].solid });
  for (const s of design.stripes) s.colors.push({ ...s.colors[k] });
  activeCw = design.colorways.length - 1;
  changed({ list: true });
  toast(`Colorway ${design.colorways[activeCw].name} added as a copy of ${from}. Now change its colors in the list, ` +
    `or all stripes of one color at once under "Colors in colorway ${design.colorways[activeCw].name}".`, { withUndo: true });
}

$('cwDelete').addEventListener('click', () => {
  if (design.colorways.length < 2) return;
  const k = cw(), name = design.colorways[k].name;
  design.colorways.splice(k, 1);
  for (const s of design.stripes) s.colors.splice(k, 1);
  activeCw = Math.max(0, k - 1);
  changed({ list: true });
  toast(`Colorway ${name} deleted.`, { withUndo: true });
});

$('cwName').addEventListener('input', e => {
  design.colorways[cw()].name = e.target.value;
  renderColorways();
  updateSaveState();
  saveCurrentSoon();
});
$('cwName').addEventListener('change', e => {
  const k = cw();
  design.colorways[k].name = e.target.value.trim() || colorwayName(k);
  e.target.value = design.colorways[k].name;
  changed();
});
$('cwName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

/* ---------- Color summary: change one color everywhere ---------- */

$('colorRows').addEventListener('input', e => {
  const t = e.target, row = t.closest('tr[data-idx]');
  if (!row) return;
  const idx = row.dataset.idx.split(',').map(Number), k = cw();
  if (t.dataset.gf === 'pantone') {
    for (const i of idx) design.stripes[i].colors[k].pantone = t.value;
  }
  // Not redrawing this table while typing, so the cursor stays where it is.
  renderStripeList();
  renderColorways();
  renderGarmentBar();
  renderPreview();
  updateUndoButtons();
  updateSaveState();
  saveCurrentSoon();
});
$('colorRows').addEventListener('change', e => {
  const t = e.target, row = t.closest('tr[data-idx]');
  if (!row) return;
  if (t.dataset.gf === 'pantone') {
    const idx = row.dataset.idx.split(',').map(Number), k = cw();
    for (const i of idx) design.stripes[i].colors[k].pantone = t.value.trim();
  }
  changed({ list: true });
});
$('colorRows').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('input[type="text"]')) e.target.blur();
});
$('colorRows').addEventListener('click', e => {
  const b = e.target.closest('[data-gpick]');
  if (!b) return;
  openPicker({ idx: b.closest('tr[data-idx]').dataset.idx.split(',').map(Number) });
});

/* ---------- Company colors (the list in colors.js) ---------- */

// Text for searching: no accents, no capitals, hyphens and slashes read as spaces.
function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[-_/·.,()]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const COMPANY = (typeof COMPANY_COLORS !== 'undefined' ? COMPANY_COLORS : []).map(([code, name, pantone, hex, seasons, active], n) => ({
  n, code, name, pantone, hex: normalizeHex(hex) || '', seasons: Array.isArray(seasons) ? seasons : [], active: !!active,
  key: fold(`${code} ${name} ${pantone}`),
}));
// What is written in a stripe's color reference when a company color is chosen.
function companyLabel(c) {
  return `${c.code} ${c.name}` + (c.pantone ? ` · ${c.pantone}` : '');
}
function seasonRank(s) {
  const m = /^(\d{4}) (\w+)/.exec(s);
  return m ? [0, -Number(m[1]), ({ Summer: 0, Winter: 1, Special: 2 })[m[2]] ?? 3] : [1, 0, 0];
}
const COMPANY_SEASONS = [...new Set(COMPANY.flatMap(c => c.seasons))].sort((a, b) => {
  const x = seasonRank(a), y = seasonRank(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
});

let pickTarget = null;   // { idx: [stripe numbers] } in the colorway being edited

function openPicker(target) {
  if (!COMPANY.length) { toast('The company color list is not loaded.', { kind: 'warn' }); return; }
  commit();
  pickTarget = target;
  const n = target.idx.length, k = cw();
  const where = design.colorways.length > 1 ? ` in colorway ${design.colorways[k].name}` : '';
  $('pickFor').textContent = n === 1 ? `For stripe ${target.idx[0] + 1}${where}` : `For all ${n} stripes of this color${where}`;
  $('pickOther').value = design.stripes[target.idx[0]].colors[k].color;
  $('pickInactive').checked = view.pickInactive;
  $('pickSearch').value = '';
  $('pickSource').textContent = `${COMPANY.length} solid colors · ${typeof COMPANY_COLORS_SOURCE === 'string' ? COMPANY_COLORS_SOURCE : ''}`;
  renderSeasonOptions();
  renderPicker();
  $('pickDialog').showModal();
  $('pickSearch').focus();
}

function renderSeasonOptions() {
  const pool = COMPANY.filter(c => view.pickInactive || c.active);
  if (view.pickSeason && !COMPANY_SEASONS.includes(view.pickSeason)) view.pickSeason = '';
  $('pickSeason').innerHTML = `<option value="">All seasons (${pool.length})</option>` +
    COMPANY_SEASONS.map(s => {
      const count = pool.filter(c => c.seasons.includes(s)).length;
      return `<option value="${esc(s)}">${esc(s === 'NOS' ? 'NOS (never out of stock)' : s)} (${count})</option>`;
    }).join('');
  $('pickSeason').value = view.pickSeason;
}

function renderPicker() {
  const words = fold($('pickSearch').value).split(' ').filter(Boolean);
  const current = pickTarget ? design.stripes[pickTarget.idx[0]].colors[cw()].pantone : '';
  const list = COMPANY.filter(c => (view.pickInactive || c.active) &&
    (!view.pickSeason || c.seasons.includes(view.pickSeason)) && words.every(w => c.key.includes(w)));
  const filtered = words.length || view.pickSeason;
  $('pickInfo').textContent = filtered ? `${list.length} found` : `${list.length} colors`;
  $('pickGrid').innerHTML = list.length
    ? list.map(c => `<button class="pick-card" data-n="${c.n}"${companyLabel(c) === current ? ' aria-current="true"' : ''}
        title="${esc(`Seasons: ${c.seasons.join(', ') || 'none'}${c.hex ? '' : ' · Centric has no screen color for this one'}`)}">
        <span class="pick-sw${c.hex ? '' : ' none'}"${c.hex ? ` style="background:${c.hex}"` : ''}></span>
        <span class="pick-txt"><span class="nm"><b>${esc(c.code)}</b>${esc(c.name)}${c.active ? '' : '<span class="pick-tag">inactive</span>'}</span>
        <small>${esc(c.pantone || 'no Pantone')}${c.hex ? ' · ' + c.hex.toUpperCase() : ''}</small></span>
      </button>`).join('')
    : emptyPickerMessage(words);
}

// When nothing matches in the chosen season, say how many match in other seasons, with a way there.
function emptyPickerMessage(words) {
  if (view.pickSeason) {
    const elsewhere = COMPANY.filter(c => (view.pickInactive || c.active) && words.every(w => c.key.includes(w))).length;
    if (elsewhere) {
      return `<div class="pick-empty">No match in ${esc(view.pickSeason)}, but ${elsewhere} in other seasons.<br>` +
        `<button class="btn" id="pickAllSeasons" style="margin-top:10px">Show all seasons</button></div>`;
    }
  }
  return '<div class="pick-empty">No color matches. Try fewer letters.</div>';
}

$('pickSearch').addEventListener('input', renderPicker);
$('pickSeason').addEventListener('change', e => { view.pickSeason = e.target.value; saveView(); renderPicker(); });
$('pickInactive').addEventListener('change', e => {
  view.pickInactive = e.target.checked;
  saveView(); renderSeasonOptions(); renderPicker();
});

$('pickGrid').addEventListener('click', e => {
  if (e.target.closest('#pickAllSeasons')) {
    view.pickSeason = '';
    saveView(); $('pickSeason').value = ''; renderPicker(); $('pickSearch').focus();
    return;
  }
  const b = e.target.closest('[data-n]');
  if (!b || !pickTarget) return;
  const c = COMPANY[Number(b.dataset.n)], k = cw();
  for (const i of pickTarget.idx) {
    const col = design.stripes[i].colors[k];
    if (c.hex) col.color = c.hex;
    col.pantone = companyLabel(c);
  }
  $('pickDialog').close();
  changed({ list: true });
  if (c.hex) toast(`${companyLabel(c)} chosen.`, { withUndo: true });
  else toast(`Centric has no screen color for ${c.code} ${c.name}. The name and Pantone are set; ` +
    'choose the color itself with "Another color…" or the hex field.', { kind: 'warn' });
});

// A color that is not in the company list: its old color reference no longer fits, so it is cleared.
$('pickOther').addEventListener('change', e => {
  if (!pickTarget) return;
  const hex = normalizeHex(e.target.value), k = cw();
  if (!hex) return;
  for (const i of pickTarget.idx) design.stripes[i].colors[k] = { color: hex, pantone: '' };
  $('pickDialog').close();
  changed({ list: true });
  toast('Color set. Its color reference was cleared, because it is not a company color.', { withUndo: true });
});

/* ---------- Order details ---------- */

for (const el of document.querySelectorAll('[data-detail]')) {
  el.addEventListener('input', () => {
    design.details[el.dataset.detail] = el.value;
    updateUndoButtons();
    updateSaveState();
    saveCurrentSoon();
  });
  el.addEventListener('change', () => {
    design.details[el.dataset.detail] = el.value.trim();
    el.value = design.details[el.dataset.detail];
    commit();
  });
}
// Opens the order details when the design has some, so they are not overlooked.
function openDetailsIfFilled() {
  const det = design.details;
  $('orderDetails').open = Object.keys(det).some(key => det[key]);
}

/* ---------- Pajama options ---------- */

$('garmentBar').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const seg = b.closest('[data-g]');
  if (seg) {
    if (design.garment[seg.dataset.g] === b.dataset.v) return;
    design.garment[seg.dataset.g] = b.dataset.v;
    changed();
  } else if (b.dataset.solid) {
    design.colorways[cw()].solid = b.dataset.solid;
    changed();
  }
});
$('gShow').addEventListener('click', e => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  view.gShow = b.dataset.v;
  saveView(); renderViewControls(); renderPreview();
});
$('solidChips').addEventListener('input', e => {
  if (e.target.id !== 'solidOther') return;
  design.colorways[cw()].solid = e.target.value.toLowerCase();
  renderPreview();
  updateSaveState();
  saveCurrentSoon();
});
$('solidChips').addEventListener('change', e => {
  if (e.target.id === 'solidOther') changed();
});

/* ---------- View events ---------- */

$('modeSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]');
  if (!b || b.dataset.mode === view.mode) return;
  view.mode = b.dataset.mode;
  saveView(); renderViewControls(); renderPreview();
  if (view.mode === 'garment') track('pajama-view');
});
function stepZoom(dir) {
  const i = ZOOM_STEPS.indexOf(view.zoom);
  const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))];
  if (next === view.zoom) return;
  view.zoom = next;
  saveView(); renderViewControls(); renderPreview();
}
$('zoomOut').addEventListener('click', () => stepZoom(-1));
$('zoomIn').addEventListener('click', () => stepZoom(1));
$('zoomVal').addEventListener('click', () => {
  view.zoom = 1;
  saveView(); renderViewControls(); renderPreview();
});
$('linesToggle').addEventListener('change', e => { view.repeatLines = e.target.checked; saveView(); renderPreview(); });
$('rulerToggle').addEventListener('change', e => { view.ruler = e.target.checked; saveView(); renderPreview(); });

/* ---------- Calibration ---------- */

function updateCalCard() {
  const v = Number($('calRange').value);
  const card = $('calCard');
  card.style.width = (85.6 * v) + 'px';
  card.style.height = (53.98 * v) + 'px';
  $('calInfo').textContent = (calibration ? 'Calibrated' : 'Standard setting') +
    ` (${v.toFixed(2)} screen pixels per mm). Keep your browser zoom at 100% (Ctrl + 0) when calibrating.`;
}
$('calBtn').addEventListener('click', () => {
  $('calRange').value = pxPerMm().toFixed(2);
  updateCalCard();
  $('calDialog').showModal();
});
$('calRange').addEventListener('input', e => {
  calibration = { pxPerMm: Number(e.target.value), dpr: window.devicePixelRatio || 1 };
  writeJSON(KEYS.calibration, calibration);
  updateCalCard(); renderViewControls(); renderPreview();
});
$('calReset').addEventListener('click', () => {
  calibration = null;
  try { localStorage.removeItem(KEYS.calibration); } catch (e) { /* storage blocked */ }
  $('calRange').value = STANDARD_PX_PER_MM.toFixed(2);
  updateCalCard(); renderViewControls(); renderPreview();
});

/* ---------- Header: new, save, my designs ---------- */

$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('saveBtn').addEventListener('click', saveToLibrary);

$('newBtn').addEventListener('click', () => {
  commit();
  if (hasUnsavedChanges() &&
      !confirm('The current design has changes that are not saved in My designs. Start a new design anyway?')) return;
  design = defaultDesign();
  activeCw = 0;
  commit();
  renderAll();
  openDetailsIfFilled();
  toast('New design started.', { withUndo: true });
});

$('libBtn').addEventListener('click', () => {
  commit();
  renderLibrary();
  $('libDialog').showModal();
});

function renderLibrary() {
  const ul = $('libList');
  if (!library.length) {
    ul.innerHTML = '<li class="lib-empty">Nothing saved yet. Use <b>Save design</b> to keep the current design here.</li>';
    return;
  }
  ul.innerHTML = library.map((e, i) => {
    const d = e.design;
    return `<li class="lib-item${d.id === design.id ? ' current' : ''}" data-i="${i}">
      <canvas aria-hidden="true"></canvas>
      <div style="min-width:0">
        <div class="lib-name">${esc(d.name || 'Untitled design')}</div>
        <div class="lib-meta">${esc(d.fabric)} · ${esc(layoutLabel(d))} · ${fmtMM(totalMM(d.stripes))} · ${d.stripes.length} stripes${d.colorways.length > 1 ? ` · ${d.colorways.length} colorways` : ''}${e.savedAt ? ' · saved ' + esc(fmtDate(e.savedAt)) : ''}</div>
      </div>
      <div class="lib-btns">
        <button class="btn" data-a="open">Open</button>
        <button class="btn icon" data-a="del" title="Delete" aria-label="Delete ${esc(d.name || 'Untitled design')}">${ICON.del}</button>
      </div>
    </li>`;
  }).join('');
  for (const li of ul.querySelectorAll('.lib-item')) drawThumb(li.querySelector('canvas'), library[Number(li.dataset.i)].design);
}

$('libList').addEventListener('click', e => {
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  const i = Number(b.closest('.lib-item').dataset.i);
  const entry = library[i];
  if (!entry) return;
  const name = entry.design.name || 'Untitled design';
  if (b.dataset.a === 'open') {
    if (entry.design.id !== design.id && hasUnsavedChanges() &&
        !confirm('The current design has changes that are not saved in My designs. Open the other design anyway?')) return;
    design = clone(entry.design);
    activeCw = 0;
    commit();
    renderAll();
    openDetailsIfFilled();
    $('libDialog').close();
    toast(`Opened "${name}".`, { withUndo: true });
  } else if (b.dataset.a === 'del') {
    if (!confirm(`Delete "${name}" from My designs? This cannot be undone.`)) return;
    library.splice(i, 1);
    persistLibrary();
    renderLibrary();
    updateSaveState();
  }
});

$('libSaveCopy').addEventListener('click', () => {
  commit();
  design = { ...clone(design), id: newId(), name: (design.name || 'Untitled design') + ' (copy)' };
  commit();
  renderAll();
  saveToLibrary();
});

// A file name without characters Windows does not allow.
function fileName(name) {
  return (name || 'Untitled design').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled design';
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

$('backupBtn').addEventListener('click', () => {
  if (!library.length) { toast('Nothing saved yet. Use Save design first.'); return; }
  const day = new Date().toISOString().slice(0, 10);
  const backup = { app: 'Pinstripe Creator', version: 1, savedAt: new Date().toISOString(), designs: library.map(e => e.design) };
  downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/octet-stream' }),
    `Pinstripe designs backup ${day}.pinstripe`);
});

$('restoreLabel').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('restoreInput').click(); }
});
$('restoreInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 2000000) { toast('That file is too large to be a Pinstripe Creator backup.', { kind: 'warn' }); return; }
  let data;
  try { data = JSON.parse(await file.text()); } catch (err) { toast('This file is not a Pinstripe Creator backup.', { kind: 'warn' }); return; }
  const raw = Array.isArray(data) ? data : Array.isArray(data && data.designs) ? data.designs : [data];
  const items = raw.map(sanitizeDesign).filter(d => d && d.stripes.length);
  if (!items.length) { toast('No designs found in this file.', { kind: 'warn' }); return; }
  const now = new Date().toISOString();
  let added = 0, skipped = 0;
  for (const d of items) {
    const existing = library.find(x => x.design.id === d.id);
    if (existing && JSON.stringify(existing.design) === JSON.stringify(d)) { skipped++; continue; }
    if (existing || d.id === design.id) d.id = newId();
    library.unshift({ savedAt: now, design: d });
    added++;
  }
  persistLibrary();
  renderLibrary();
  updateSaveState();
  toast(added
    ? `Restored ${added} design${added === 1 ? '' : 's'}` + (skipped ? ` (${skipped} were already here)` : '') + '.'
    : 'All designs in this backup are already in My designs.');
});

for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', e => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
}

/* ---------- Save as PDF (spec sheet) ---------- */
// Each A4 page is drawn on a canvas at 300 dpi with every measurement in millimetres, then packed
// into a PDF page of exactly 210 x 297 mm. Printed at "Actual size", the fabric comes out 1:1.

const PDF_DPI = 300;
const A4_W = 210, A4_H = 297, PDF_MARGIN = 15, PDF_BOTTOM = A4_H - PDF_MARGIN - 7;
const PT = 25.4 / 72; // one typographic point, in mm
const PDF_INK = '#1b2230', PDF_MUTED = '#687080', PDF_LINE = '#d9d6ce', PDF_SOFT = '#f3f1ec';
const PDF_OK = '#1d7a4f', PDF_OK_SOFT = '#e2f3ea', PDF_BAD = '#b42318', PDF_BAD_SOFT = '#fdecea';

function pdfFont(ctx, sizePt, weight, mono) {
  ctx.font = `${weight} ${(sizePt * PT).toFixed(3)}px ` +
    (mono ? '"JetBrains Mono", Consolas, monospace' : 'Inter, "Segoe UI", system-ui, sans-serif');
}
function fitText(ctx, text, maxW) {
  if (!maxW || ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function pdfText(ctx, text, x, y, { size = 9, weight = 400, color = PDF_INK, align = 'left', mono = false, maxW = 0 } = {}) {
  pdfFont(ctx, size, weight, mono);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(fitText(ctx, String(text), maxW), x, y);
}
// Splits text into lines no wider than maxW (keeping the line breaks that were typed).
function pdfLines(ctx, text, maxW, size, weight) {
  pdfFont(ctx, size, weight, false);
  const lines = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (line && ctx.measureText(t).width > maxW) { lines.push(line); line = word; } else line = t;
    }
    lines.push(line);
  }
  return lines;
}
// Text that wraps onto as many lines as needed. Returns the y after the last line.
function pdfPara(ctx, text, x, y, maxW, { size = 8.5, weight = 400, color = PDF_INK } = {}) {
  pdfFont(ctx, size, weight, false);
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? line + ' ' + word : word;
    if (line && ctx.measureText(t).width > maxW) { lines.push(line); line = word; } else line = t;
  }
  if (line) lines.push(line);
  const lh = size * PT * 1.4;
  lines.forEach((l, i) => pdfText(ctx, l, x, y + i * lh, { size, weight, color }));
  return y + lines.length * lh;
}

// The repeated fabric inside a rectangle, exactly 1 unit = 1 mm.
function pdfFabric(ctx, d, x, y, w, h, ov) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  paintFabric(ctx, d, w, h, 1, ov);
  ctx.restore();
  ctx.strokeStyle = '#8f8c84';
  ctx.lineWidth = 0.2;
  ctx.strokeRect(x, y, w, h);
}

// A millimetre ruler above (side 'top') or to the left of (side 'left') an area starting at x, y.
function pdfRuler(ctx, x, y, length, side) {
  ctx.save();
  ctx.strokeStyle = PDF_INK;
  ctx.fillStyle = PDF_INK;
  ctx.lineWidth = 0.15;
  pdfFont(ctx, 5.5, 600, false);
  for (let mm = 0; mm <= length + 1e-6; mm++) {
    const t = mm % 10 === 0 ? 2.6 : mm % 5 === 0 ? 1.8 : 1;
    ctx.beginPath();
    if (side === 'top') { ctx.moveTo(x + mm, y); ctx.lineTo(x + mm, y - t); }
    else { ctx.moveTo(x, y + mm); ctx.lineTo(x - t, y + mm); }
    ctx.stroke();
    if (mm % 10 === 0 && mm > 0) {
      if (side === 'top') { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(String(mm), x + mm, y - 2.9); }
      else { ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(String(mm), x - 3, y + mm); }
    }
  }
  ctx.restore();
}

// A 100 mm bar to check that the page was printed at actual size.
function pdfScaleBar(ctx, x, y) {
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? '#fff' : PDF_INK;
    ctx.fillRect(x + i * 10, y, 10, 2);
  }
  ctx.strokeStyle = PDF_INK;
  ctx.lineWidth = 0.2;
  ctx.strokeRect(x, y, 100, 2);
  pdfText(ctx, '0', x, y + 5.3, { size: 6.5, color: PDF_MUTED, align: 'center' });
  pdfText(ctx, '50', x + 50, y + 5.3, { size: 6.5, color: PDF_MUTED, align: 'center' });
  pdfText(ctx, '100 mm', x + 100, y + 5.3, { size: 6.5, color: PDF_MUTED, align: 'center' });
  pdfPara(ctx, 'Print check: this bar must measure exactly 100 mm. If it does not, print again with ' +
    '"Actual size" or 100% selected, not "Fit to page".', x + 108, y + 1.2, 72, { size: 7, color: PDF_MUTED });
}

function pdfRow(ctx, cols, cells, y, h, { header = false, shade = false } = {}) {
  const x0 = PDF_MARGIN, w = A4_W - 2 * PDF_MARGIN;
  if (header || shade) {
    ctx.fillStyle = header ? PDF_SOFT : '#faf9f6';
    ctx.fillRect(x0, y, w, h);
  }
  ctx.fillStyle = PDF_LINE;
  ctx.fillRect(x0, y + h - 0.15, w, 0.15);
  cols.forEach((col, k) => {
    const c = cells[k] || {};
    let tx = col.x;
    if (c.swatch) {
      const sw = c.swW || 10;
      ctx.fillStyle = c.swatch;
      ctx.fillRect(col.x, y + 1.1, sw, h - 2.2);
      ctx.strokeStyle = 'rgba(0,0,0,.3)';
      ctx.lineWidth = 0.15;
      ctx.strokeRect(col.x, y + 1.1, sw, h - 2.2);
      if (!c.text) return;
      tx = col.x + sw + 2;   // a swatch with its label next to it
    }
    const text = header ? col.label.toUpperCase() : c.text;
    if (text === undefined || text === '') return;
    pdfText(ctx, text, tx, y + h / 2 + 1.1, {
      size: header ? 6.5 : c.size || 8.5,
      weight: header || c.bold ? 700 : 400,
      color: header ? PDF_MUTED : c.color || PDF_INK,
      align: col.align || 'left',
      mono: !header && !!c.mono,
      maxW: col.w || 0,
    });
  });
}

// Stripes with the same color and Pantone label, added together.
function colorGroups(stripes) {
  const groups = [], byKey = new Map();
  stripes.forEach((s, i) => {
    const key = s.color + '|' + s.pantone.trim().toLowerCase();
    let g = byKey.get(key);
    if (!g) { g = { color: s.color, pantone: s.pantone.trim(), width: 0, count: 0, indices: [] }; byKey.set(key, g); groups.push(g); }
    g.width += s.width;
    g.count++;
    g.indices.push(i);
  });
  return groups;
}

function layoutNote(d) {
  const R = totalMM(d.stripes);
  if (!d.stripes.length) return '';
  if (isDiagonal(d)) {
    const t = d.angle * Math.PI / 180;
    return `The rapport is measured square to the stripes. At ${d.angle}° from vertical the repeat measures ` +
      `${fmtMM(R / Math.cos(t))} across the fabric width and ${fmtMM(R / Math.sin(t))} along its length.`;
  }
  if (d.layout === 'check') {
    return `The same sequence runs in both directions, so each repeat is a ${R.toFixed(2)} × ${R.toFixed(2)} mm square.`;
  }
  return '';
}

// Works out what goes on which page. Returns a list of pages; each page is a list of drawing steps.
function planSpecSheet(d) {
  const fab = fabricFor(d.fabric), R = totalMM(d.stripes), max = fab.maxRapport;
  const over = R > max + 1e-9;
  const name = d.name || 'Untitled design';
  const nCw = d.colorways.length, multi = nCw > 1;
  const cwLabel = k => `Colorway ${d.colorways[k].name}`;
  const today = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const pages = [];
  let cur = null, y = 0;
  const newPage = () => { cur = []; pages.push(cur); y = PDF_MARGIN; };
  const draw = fn => cur.push(fn);
  const continued = () => {
    const ty = y;
    draw(ctx => pdfText(ctx, `${name} (continued)`, PDF_MARGIN, ty + 5, { size: 11, weight: 700, maxW: 180 }));
    y += 10;
  };
  const sectionTitle = (text) => {
    const ty = y;
    draw(ctx => pdfText(ctx, text, PDF_MARGIN, ty + 4.5, { size: 10, weight: 700, maxW: 180 }));
    y += 7.5;
  };
  // Starts a new page when the next block (h mm high) does not fit.
  const ensure = h => { if (y + h > PDF_BOTTOM) { newPage(); continued(); } };
  // A table that continues on the next page when it does not fit.
  const table = (title, cols, rows) => {
    let k = 0, first = true;
    while (k < rows.length) {
      if (y + (first && title ? 7.5 : 0) + 6.5 + 6 * Math.min(2, rows.length - k) > PDF_BOTTOM) { newPage(); continued(); }
      if (first && title) sectionTitle(title);
      const hy = y;
      draw(ctx => pdfRow(ctx, cols, [], hy, 6.5, { header: true }));
      y += 6.5;
      const fit = Math.max(1, Math.floor((PDF_BOTTOM - y) / 6));
      rows.slice(k, k + fit).forEach((cells, j) => {
        const ry = y + j * 6, shade = (k + j) % 2 === 1;
        draw(ctx => pdfRow(ctx, cols, cells, ry, 6, { shade }));
      });
      const n = Math.min(fit, rows.length - k);
      y += n * 6;
      k += n;
      first = false;
    }
    y += 6;
  };
  const groupTable = (title, k) => {
    const st = cwStripes(d, k);
    table(title, [
      { label: 'Color', x: PDF_MARGIN + 2 },
      { label: 'Color ref.', x: PDF_MARGIN + 16, w: 58 },
      { label: 'Hex', x: PDF_MARGIN + 77 },
      { label: 'Stripes', x: PDF_MARGIN + 110, align: 'right' },
      { label: 'Total width', x: PDF_MARGIN + 145, align: 'right' },
      { label: 'Share', x: PDF_MARGIN + 178, align: 'right' },
    ], colorGroups(st).map(g => [
      { swatch: g.color },
      { text: g.pantone || '—' },
      { text: g.color.toUpperCase(), mono: true },
      { text: String(g.count) },
      { text: g.width.toFixed(2) + ' mm', mono: true },
      { text: (g.width / R * 100).toFixed(1) + '%' },
    ]));
  };

  /* Page 1: title and order details */
  newPage();
  draw(ctx => {
    pdfText(ctx, name, PDF_MARGIN, 22, { size: 20, weight: 700, maxW: 180 });
    pdfText(ctx, `Spec sheet · ${today}`, PDF_MARGIN, 28, { size: 9, color: PDF_MUTED });
  });
  y = 33;
  // Filled-in details are printed; empty ones stay blank, with a line to write on by hand.
  const dy = y, det = d.details;
  draw(ctx => {
    const label = (text, x, yy) => pdfText(ctx, text.toUpperCase(), x, yy, { size: 6.5, weight: 700, color: PDF_MUTED });
    const line = (x, yy, w) => { ctx.fillStyle = PDF_LINE; ctx.fillRect(x, yy, w, 0.25); };
    const cw4 = (180 - 3 * 4) / 4;
    DETAIL_FIELDS.forEach(([key, text], i) => {
      const x = PDF_MARGIN + i * (cw4 + 4);
      label(text, x, dy + 3);
      if (det[key]) pdfText(ctx, det[key], x, dy + 8.4, { size: 9.5, weight: 600, maxW: cw4 });
      line(x, dy + 9.8, cw4);
    });
    const ny = dy + 14, notesW = 120, ax = PDF_MARGIN + notesW + 6, aw = 180 - notesW - 6;
    label('Notes', PDF_MARGIN, ny + 3);
    const lines = det.notes ? pdfLines(ctx, det.notes, notesW, 8.5, 400) : [];
    for (let i = 0; i < 3; i++) {
      let text = lines[i];
      if (i === 2 && lines.length > 3) text = fitText(ctx, lines[2] + '…', notesW);
      if (text) pdfText(ctx, text, PDF_MARGIN, ny + 8.4 + i * 5, { size: 8.5 });
      line(PDF_MARGIN, ny + 9.8 + i * 5, notesW);
    }
    label('Approved by', ax, ny + 3);
    line(ax, ny + 9.8, aw);
    label('Date', ax, ny + 15.2);
    line(ax, ny + 19.8, aw);
  });
  y += 39;

  /* Key figures */
  const boxes = [
    ['Fabric', fab.code, `max rapport ${max} mm`, PDF_SOFT, PDF_INK],
    ['Layout', LAYOUT_NAMES[d.layout],
      isDiagonal(d) ? `${d.angle}° from vertical` : d.layout === 'check' ? (d.crossing === 'mix' ? 'crossings: blend' : 'crossings: darken') : '',
      PDF_SOFT, PDF_INK],
    ['Rapport', fmtMM(R), `${d.stripes.length} stripe${d.stripes.length === 1 ? '' : 's'}` + (multi ? ` · ${nCw} colorways` : ''),
      PDF_SOFT, over ? PDF_BAD : PDF_INK],
    over
      ? ['Status', 'Too long', `${(R - max).toFixed(2)} mm over the maximum`, PDF_BAD_SOFT, PDF_BAD]
      : ['Status', 'Fits', `${(max - R).toFixed(2)} mm to spare`, PDF_OK_SOFT, PDF_OK],
  ];
  const by = y;
  draw(ctx => {
    const bw = (180 - 3 * 3) / 4;
    boxes.forEach(([label, value, sub, bg, color], i) => {
      const bx = PDF_MARGIN + i * (bw + 3);
      ctx.fillStyle = bg;
      ctx.fillRect(bx, by, bw, 16);
      pdfText(ctx, label.toUpperCase(), bx + 3, by + 4.6, { size: 6.5, weight: 700, color: PDF_MUTED });
      pdfText(ctx, value, bx + 3, by + 10.2, { size: 12, weight: 700, color, maxW: bw - 6 });
      if (sub) pdfText(ctx, sub, bx + 3, by + 14, { size: 7, color: PDF_MUTED, maxW: bw - 6 });
    });
  });
  y += 19;
  const note = layoutNote(d);
  if (note) {
    const ny = y;
    draw(ctx => pdfPara(ctx, note, PDF_MARGIN, ny + 3, 180, { size: 8, color: PDF_MUTED }));
    y += 9;
  }
  if (over) {
    const oy = y;
    draw(ctx => {
      ctx.fillStyle = PDF_BAD_SOFT;
      ctx.fillRect(PDF_MARGIN, oy, 180, 11);
      ctx.fillStyle = PDF_BAD;
      ctx.fillRect(PDF_MARGIN, oy, 1.2, 11);
      pdfPara(ctx, `Too long for ${fab.code}: the rapport is ${R.toFixed(2)} mm, but ${fab.code} allows at most ${max} mm. ` +
        `The stripes must be ${(R - max).toFixed(2)} mm narrower in total before production.`,
        PDF_MARGIN + 4, oy + 4.4, 172, { size: 8.5, weight: 600, color: PDF_BAD });
    });
    y += 14;
  }

  /* Swatch at actual size (first colorway) */
  sectionTitle('Fabric at actual size (1:1)' + (multi ? `, ${cwLabel(0)}` : ''));
  y += 4; // room for the ruler
  const sy = y, sh = 45;
  draw((ctx, info) => {
    pdfRuler(ctx, PDF_MARGIN, sy, 180, 'top');
    pdfRuler(ctx, PDF_MARGIN, sy, sh, 'left');
    pdfFabric(ctx, cwView(d, 0), PDF_MARGIN, sy, 180, sh, info.ov);
  });
  y += sh + 4;
  const scy = y;
  draw(ctx => pdfScaleBar(ctx, PDF_MARGIN, scy));
  y += 12;

  /* The stripe table: one color column per colorway (4 per table), continuing on more pages when needed */
  const positions = [];
  let pos = 0;
  for (const s of d.stripes) { positions.push([pos, pos + s.width]); pos += s.width; }
  const totalCell = { text: R.toFixed(2) + ' mm', bold: true, mono: true, color: over ? PDF_BAD : PDF_INK };
  if (!multi) {
    const rows = d.stripes.map((s, i) => [
      { text: String(i + 1) },
      { swatch: s.colors[0].color },
      { text: s.colors[0].pantone.trim() || '—' },
      { text: s.colors[0].color.toUpperCase(), mono: true },
      { text: s.width.toFixed(2) + ' mm', mono: true },
      { text: `${positions[i][0].toFixed(2)} – ${positions[i][1].toFixed(2)} mm`, mono: true, color: PDF_MUTED },
    ]);
    rows.push([{}, {}, { text: 'Total (rapport)', bold: true }, {}, totalCell, {}]);
    table('Stripe sequence (one repeat, in order)', [
      { label: '#', x: PDF_MARGIN + 2 },
      { label: 'Color', x: PDF_MARGIN + 9 },
      { label: 'Color ref.', x: PDF_MARGIN + 23, w: 50 },
      { label: 'Hex', x: PDF_MARGIN + 77 },
      { label: 'Width', x: PDF_MARGIN + 125, align: 'right' },
      { label: 'Position in repeat', x: PDF_MARGIN + 178, align: 'right' },
    ], rows);
    groupTable('Colors per repeat', 0);
  } else {
    for (let g0 = 0; g0 < nCw; g0 += 4) {
      const ks = [];
      for (let k = g0; k < Math.min(nCw, g0 + 4); k++) ks.push(k);
      const colW = 110 / 4;
      const cols = [
        { label: '#', x: PDF_MARGIN + 2 },
        { label: 'Width', x: PDF_MARGIN + 27, align: 'right' },
        { label: 'Position', x: PDF_MARGIN + 66, align: 'right' },
        ...ks.map((k, j) => ({ label: cwLabel(k), x: PDF_MARGIN + 70 + j * colW, w: colW - 11 })),
      ];
      const rows = d.stripes.map((s, i) => [
        { text: String(i + 1) },
        { text: s.width.toFixed(2) + ' mm', mono: true },
        { text: `${positions[i][0].toFixed(2)} – ${positions[i][1].toFixed(2)}`, mono: true, color: PDF_MUTED, size: 7.5 },
        ...ks.map(k => ({ swatch: s.colors[k].color, swW: 7, text: s.colors[k].pantone.trim() || s.colors[k].color.toUpperCase(),
          mono: !s.colors[k].pantone.trim() })),
      ]);
      rows.push([{ text: 'Total', bold: true }, totalCell, {}, ...ks.map(() => ({}))]);
      table(g0 === 0 ? 'Stripe sequence (one repeat, in order) and the colors of each colorway'
        : `Stripe sequence, colorways ${d.colorways[ks[0]].name} to ${d.colorways[ks[ks.length - 1]].name}`, cols, rows);
    }
    // Each colorway: a strip at actual size and its colors.
    for (let k = 0; k < nCw; k++) {
      ensure(7.5 + 4 + 16 + 4 + 6.5 + 12);
      sectionTitle(`${cwLabel(k)}: strip at actual size and colors`);
      y += 4;
      const ty = y;
      draw((ctx, info) => {
        pdfRuler(ctx, PDF_MARGIN, ty, 180, 'top');
        pdfFabric(ctx, cwView(d, k), PDF_MARGIN, ty, 180, 16, info.ov);
      });
      y += 20;
      groupTable('', k);
    }
  }

  /* The pajama set in every colorway */
  const g = d.garment;
  const setText = `${g.top === 'shirt' ? 'Button-front top' : 'T-shirt top'} with ${g.sleeve === 'long' ? 'long' : 'short'} sleeves, ` +
    `${g.bottom === 'pants' ? 'long pants' : 'shorts'}. Stripes on ${g.striped === 'both' ? 'both parts' : `the ${g.striped}`}` +
    `${g.striped === 'both' ? '' : `; the other part is solid`}. Drawn for size M with the stripes to scale.`;
  const perPage = multi ? 2 : 1;   // two colorways per page, one above the other, so each set stays large
  for (let p0 = 0; p0 < nCw; p0 += perPage) {
    newPage();
    draw(ctx => {
      pdfText(ctx, `${name}: pajama set`, PDF_MARGIN, 22, { size: 14, weight: 700, maxW: 180 });
      pdfPara(ctx, setText, PDF_MARGIN, 28, 180, { size: 8.5, color: PDF_MUTED });
    });
    const top = 36, areaH = PDF_BOTTOM - top;
    for (let j = 0; j < perPage && p0 + j < nCw; j++) {
      const k = p0 + j;
      const box = multi
        ? { x: PDF_MARGIN, y: top + j * (areaH / 2), w: 180, h: areaH / 2 - 4 }
        : { x: PDF_MARGIN, y: top, w: 180, h: areaH };
      draw((ctx, info) => {
        if (multi) {
          ctx.fillStyle = PDF_SOFT;
          ctx.fillRect(box.x, box.y, box.w, box.h);
          pdfText(ctx, cwLabel(k), box.x + 4, box.y + 6.5, { size: 10, weight: 700, maxW: box.w - 8 });
        }
        drawGarmentSet(ctx, d, k, multi ? { x: box.x, y: box.y + 8, w: box.w, h: box.h - 8 } : box,
          { px: 0.28, devPerUnit: info.dev, ink: PDF_INK, muted: PDF_MUTED, labels: true, show: 'set', pad: 12 });
      });
    }
  }

  /* Last page: the whole page of fabric at actual size */
  newPage();
  draw(ctx => {
    pdfText(ctx, `${name}: fabric at actual size (1:1)`, PDF_MARGIN, 22, { size: 14, weight: 700, maxW: 180 });
    pdfText(ctx, `${fab.code} · ${layoutLabel(d)} · rapport ${fmtMM(R)}` + (multi ? ` · ${cwLabel(0)}` : ''),
      PDF_MARGIN, 28, { size: 8.5, color: PDF_MUTED, maxW: 180 });
  });
  const fy = 36, fh = PDF_BOTTOM - fy - 1;
  draw((ctx, info) => {
    pdfRuler(ctx, PDF_MARGIN, fy, 180, 'top');
    pdfRuler(ctx, PDF_MARGIN, fy, fh, 'left');
    pdfFabric(ctx, cwView(d, 0), PDF_MARGIN, fy, 180, fh, info.ov);
  });

  return { pages, name, footer: `Pinstripe Creator · ${name}` + (det.article ? ` · ${det.article}` : '') };
}

// Turns a page canvas into image data for the PDF: lossless when the browser can compress, else JPEG.
async function encodePage(canvas) {
  const w = canvas.width, h = canvas.height;
  if (typeof CompressionStream === 'function') {
    const rgba = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2];
    }
    const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'));
    return { w, h, filter: 'FlateDecode', data: new Uint8Array(await new Response(stream).arrayBuffer()) };
  }
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
  return { w, h, filter: 'DCTDecode', data: new Uint8Array(await blob.arrayBuffer()) };
}

// A PDF string that keeps any language's letters (UTF-16 with a byte-order mark).
function pdfString(s) {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

// Writes the PDF file itself: one full-page image per A4 page.
function buildPdf(images, title) {
  const enc = new TextEncoder();
  const parts = [], offsets = [];
  let length = 0;
  const add = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); length += b.length; };
  const obj = (num, ...body) => { offsets[num] = length; add(`${num} 0 obj\n`); body.forEach(add); add('\nendobj\n'); };
  const W = (A4_W / 25.4 * 72).toFixed(2), H = (A4_H / 25.4 * 72).toFixed(2);
  const t = new Date(), p2 = n => String(n).padStart(2, '0');
  const stamp = `D:${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}`;

  add('%PDF-1.4\n%âãÏÓ\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${images.map((_, i) => `${4 + i * 3} 0 R`).join(' ')}] /Count ${images.length} >>`);
  obj(3, `<< /Title ${pdfString(title)} /Producer (Pinstripe Creator) /CreationDate (${stamp}) >>`);
  images.forEach((im, i) => {
    const page = 4 + i * 3, content = page + 1, image = page + 2;
    const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`);
    obj(content, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    obj(image, `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Filter /${im.filter} /Length ${im.data.length} >>\nstream\n`, im.data, '\nendstream');
  });
  const xrefAt = length, size = 4 + images.length * 3;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let k = 1; k < size; k++) xref += String(offsets[k]).padStart(10, '0') + ' 00000 n \n';
  add(xref);
  add(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

async function makeSpecPdf(d) {
  if (document.fonts && document.fonts.load) {
    await Promise.all(['400', '600', '700'].map(w => document.fonts.load(`${w} 12px Inter`))
      .concat(['400', '600'].map(w => document.fonts.load(`${w} 12px "JetBrains Mono"`)))).catch(() => {});
  }
  const plan = planSpecSheet(d);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(A4_W / 25.4 * PDF_DPI);
  canvas.height = Math.round(A4_H / 25.4 * PDF_DPI);
  const ctx = canvas.getContext('2d');
  const sx = canvas.width / A4_W, sy = canvas.height / A4_H;
  const info = { ov: 1 / sx, dev: sx };
  const images = [];
  for (let p = 0; p < plan.pages.length; p++) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    for (const step of plan.pages[p]) { ctx.save(); step(ctx, info); ctx.restore(); }
    // Footer
    ctx.fillStyle = PDF_LINE;
    ctx.fillRect(PDF_MARGIN, A4_H - PDF_MARGIN - 3.5, 180, 0.2);
    pdfText(ctx, plan.footer, PDF_MARGIN, A4_H - PDF_MARGIN, { size: 7, color: PDF_MUTED, maxW: 140 });
    pdfText(ctx, `Page ${p + 1} of ${plan.pages.length}`, A4_W - PDF_MARGIN, A4_H - PDF_MARGIN, { size: 7, color: PDF_MUTED, align: 'right' });
    images.push(await encodePage(canvas));
  }
  return buildPdf(images, `${plan.name} spec sheet`);
}

let pdfBusy = false;
$('pdfBtn').addEventListener('click', async () => {
  if (pdfBusy) return;
  commit();
  if (!design.stripes.length) { toast('Add at least one stripe first.', { kind: 'warn' }); return; }
  pdfBusy = true;
  $('pdfBtn').disabled = true;
  $('pdfLabel').textContent = 'Making PDF…';
  try {
    const blob = await makeSpecPdf(clone(design));
    const article = design.details.article.trim();
    downloadBlob(blob, `${fileName((article ? article + ' ' : '') + (design.name || 'Untitled design'))} - spec sheet.pdf`);
    toast('PDF downloaded. You will find it in your browser\'s downloads.');
    track('pdf');
  } catch (err) {
    console.error(err);
    toast('The PDF could not be made. Please try again.', { kind: 'warn' });
  } finally {
    pdfBusy = false;
    $('pdfBtn').disabled = false;
    $('pdfLabel').textContent = 'Save as PDF';
  }
});

/* ---------- Keyboard shortcuts ---------- */

document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); saveToLibrary(); return; }
  if (document.querySelector('dialog[open]')) return;
  const typing = e.target.matches('input[type="text"], textarea');
  if (typing) return; // let the text box undo its own typing
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});

/* ---------- Start ---------- */

renderAll();
renderViewControls();
openDetailsIfFilled();
sizeCanvas();
new ResizeObserver(sizeCanvas).observe(stage);
window.addEventListener('resize', sizeCanvas);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderPreview);
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderPreview);
window.addEventListener('pagehide', saveCurrentNow);
