/**
 * seat-map.js  v1.0
 * ─────────────────────────────────────────────────────────────────
 *  Módulo ÚNICO para dibujar el mapa de asientos de una guagua.
 *  Lo usan tanto el panel admin (modo editable) como el catálogo
 *  público (modo solo lectura), así ambos siempre se ven igual.
 *
 *  Datos que guarda cada salida (retrocompatibles):
 *    totalSeats : number
 *    seatMap    : { "1": "reserved" | "occupied" | "blocked" }   (lo demás = disponible)
 *    seatLayout : { left: 1-3, right: 1-3, backRow: boolean }
 *                 por defecto 2+2 sin fila trasera (= comportamiento anterior)
 * ─────────────────────────────────────────────────────────────────
 */
(function (global) {

  var STATES = ['available', 'reserved', 'occupied', 'blocked'];

  var LABELS = {
    available: 'Disponible',
    reserved:  'Reservado',
    occupied:  'Ocupado',
    blocked:   'Bloqueado'
  };

  var COLORS = {
    available: { bg: 'rgba(255,255,255,.07)', border: 'rgba(255,255,255,.28)', text: 'rgba(255,255,255,.65)' },
    reserved:  { bg: 'rgba(34,197,94,.20)',   border: '#22c55e',               text: '#22c55e' },
    occupied:  { bg: 'rgba(239,68,68,.20)',   border: '#ef4444',               text: '#ef4444' },
    blocked:   { bg: 'repeating-linear-gradient(45deg,rgba(148,163,184,.22) 0 3px,rgba(15,23,42,.6) 3px 6px)',
                 border: '#64748b', text: '#94a3b8' }
  };

  var LAYOUT_PRESETS = [
    { key: '2+2', left: 2, right: 2, label: '2 + 2  (estándar)' },
    { key: '2+1', left: 2, right: 1, label: '2 + 1  (minibús)' },
    { key: '1+2', left: 1, right: 2, label: '1 + 2' },
    { key: '3+2', left: 3, right: 2, label: '3 + 2' },
    { key: '2+3', left: 2, right: 3, label: '2 + 3' },
    { key: '1+1', left: 1, right: 1, label: '1 + 1  (van)' }
  ];

  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }

  /* ── Normalización ────────────────────────────────────────────── */

  function normalizeLayout(l) {
    var left  = parseInt(l && l.left, 10);
    var right = parseInt(l && l.right, 10);
    return {
      left:    clamp(isFinite(left)  ? left  : 2, 1, 3),
      right:   clamp(isFinite(right) ? right : 2, 1, 3),
      backRow: !!(l && l.backRow)
    };
  }

  function layoutKey(l) {
    var n = normalizeLayout(l);
    return n.left + '+' + n.right;
  }

  /** Quita estados inválidos / asientos fuera de rango / "available" (es el default). */
  function sanitizeMap(map, total) {
    var out = {};
    if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
    Object.keys(map).forEach(function (k) {
      var n = parseInt(k, 10);
      var st = map[k];
      if (String(n) === k && n >= 1 && n <= total && (st === 'reserved' || st === 'occupied' || st === 'blocked')) {
        out[k] = st;
      }
    });
    return out;
  }

  function stateOf(map, n) {
    var st = map && map[String(n)];
    return STATES.indexOf(st) > 0 ? st : 'available';
  }

  function countStates(total, map) {
    var c = { available: 0, reserved: 0, occupied: 0, blocked: 0 };
    for (var i = 1; i <= total; i++) c[stateOf(map, i)]++;
    return c;
  }

  /* ── Geometría ────────────────────────────────────────────────── */

  /**
   * Devuelve las filas del bus. Cada fila: { index, back, cells:[{t:'seat',n}|{t:'aisle'}|{t:'empty'}] }
   * La fila trasera corrida usa el hueco del pasillo como un asiento más (left+right+1 asientos).
   */
  function buildRows(total, layout) {
    var L = normalizeLayout(layout);
    total = Math.max(0, parseInt(total, 10) || 0);
    var per = L.left + L.right;
    var backCount = (L.backRow && total > per + 1) ? per + 1 : 0;
    var front = total - backCount;
    var rows = [];
    var n = 1;
    var nFront = Math.ceil(front / per);

    function seat() { return n <= total ? { t: 'seat', n: n++ } : { t: 'empty' }; }

    for (var r = 0; r < nFront; r++) {
      var cells = [], i;
      for (i = 0; i < L.left; i++)  cells.push(n <= front ? seat() : { t: 'empty' });
      cells.push({ t: 'aisle' });
      for (i = 0; i < L.right; i++) cells.push(n <= front ? seat() : { t: 'empty' });
      rows.push({ index: r + 1, back: false, cells: cells });
    }
    if (backCount) {
      var bc = [];
      for (var j = 0; j < backCount; j++) bc.push(seat());
      rows.push({ index: nFront + 1, back: true, cells: bc });
    }
    return rows;
  }

  /** "1-10, 15, 20-22" → { list:[...], invalid:[...] } */
  function parseRange(str, total) {
    var seen = {}, list = [], invalid = [];
    String(str || '').split(/[,;\s]+/).forEach(function (tok) {
      if (!tok) return;
      var m = /^(\d+)(?:-(\d+))?$/.exec(tok);
      if (!m) { invalid.push(tok); return; }
      var a = parseInt(m[1], 10);
      var b = m[2] != null ? parseInt(m[2], 10) : a;
      if (a > b) { var t = a; a = b; b = t; }
      if (a < 1 || b > total) { invalid.push(tok); return; }
      for (var k = a; k <= b; k++) if (!seen[k]) { seen[k] = 1; list.push(k); }
    });
    list.sort(function (x, y) { return x - y; });
    return { list: list, invalid: invalid };
  }

  /* ── Render ───────────────────────────────────────────────────── */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function seatStyle(st, size) {
    var c = COLORS[st];
    return 'width:' + size.w + 'px;height:' + size.h + 'px;border-radius:6px;'
      + 'border:1.5px solid ' + c.border + ';background:' + c.bg + ';color:' + c.text + ';'
      + 'font-size:' + size.fs + ';font-weight:800;display:flex;align-items:center;justify-content:center;'
      + 'padding:0;line-height:1;box-sizing:border-box;'
      + (st === 'blocked' ? 'text-decoration:line-through;' : '');
  }

  var SIZES = {
    edit: { w: 34, h: 30, fs: '.7rem',  gap: '7px 7px', aisle: '22px' },
    view: { w: 24, h: 21, fs: '.58rem', gap: '5px 5px', aisle: '16px' }
  };

  /**
   * opts: { total, layout, map, interactive }
   * Modo interactive → <button data-seat> + botones de fila <button data-row>.
   */
  function render(opts) {
    var total = Math.max(0, parseInt(opts.total, 10) || 0);
    var L = normalizeLayout(opts.layout);
    var map = opts.map || {};
    var edit = !!opts.interactive;
    var size = edit ? SIZES.edit : SIZES.view;

    if (total <= 0) {
      return '<p style="text-align:center;color:rgba(255,255,255,.4);padding:1.5rem;font-size:.88rem;">'
           + 'Esta salida no tiene asientos configurados.</p>';
    }

    var rows = buildRows(total, L);
    var cols = (edit ? '30px ' : '')
      + 'repeat(' + L.left + ',' + size.w + 'px) ' + size.aisle + ' repeat(' + L.right + ',' + size.w + 'px)';

    var h = '<div class="sa-bus" style="background:#0a0f1a;border:2px solid rgba(255,255,255,.12);'
      + 'border-radius:2rem 2rem .9rem .9rem;padding:.9rem .8rem 1rem;max-width:100%;overflow-x:auto;">';

    h += '<div style="text-align:center;margin-bottom:.75rem;padding-bottom:.65rem;border-bottom:1px dashed rgba(255,255,255,.12);">'
       + '<span style="font-size:.68rem;color:rgba(255,255,255,.4);background:rgba(255,255,255,.06);border-radius:2rem;padding:.25rem .8rem;">'
       + '🚍 Frente del bus</span></div>';

    h += '<div style="display:grid;grid-template-columns:' + cols + ';gap:' + size.gap
       + ';align-items:center;justify-content:center;' + (edit ? 'touch-action:pan-y;user-select:none;-webkit-user-select:none;' : '') + '">';

    rows.forEach(function (row) {
      if (edit) {
        h += '<button type="button" data-row="' + row.index + '" title="Seleccionar toda la fila"'
           + ' style="font-size:.6rem;font-weight:800;color:rgba(255,255,255,.45);background:transparent;'
           + 'border:1px dashed rgba(255,255,255,.18);border-radius:5px;height:' + size.h + 'px;cursor:pointer;padding:0;">'
           + (row.back ? 'F' : row.index) + '</button>';
      }
      if (row.back) {
        // La fila trasera ocupa left+1+right columnas (pasillo incluido)
        row.cells.forEach(function (c) { h += cellHtml(c, map, edit, size); });
      } else {
        row.cells.forEach(function (c) { h += cellHtml(c, map, edit, size); });
      }
    });

    h += '</div>';
    h += '<div style="text-align:center;margin-top:.8rem;padding-top:.65rem;border-top:1px dashed rgba(255,255,255,.12);">'
       + '<span style="font-size:.66rem;color:rgba(255,255,255,.3);">Parte trasera</span></div>';
    h += '</div>';
    return h;
  }

  function cellHtml(c, map, edit, size) {
    if (c.t === 'aisle') return '<div aria-hidden="true" style="text-align:center;font-size:.55rem;color:rgba(255,255,255,.1);">│</div>';
    if (c.t === 'empty') return '<div></div>';
    var st = stateOf(map, c.n);
    var title = 'Asiento ' + c.n + ' — ' + LABELS[st];
    if (edit) {
      return '<button type="button" data-seat="' + c.n + '" data-state="' + st + '" title="' + esc(title) + '" aria-label="' + esc(title) + '"'
        + ' style="' + seatStyle(st, size) + 'cursor:pointer;transition:transform .08s;">' + c.n + '</button>';
    }
    return '<div title="' + esc(title) + '" style="' + seatStyle(st, size) + '">' + c.n + '</div>';
  }

  /** Repinta un solo asiento sin re-renderizar todo (arrastre fluido). */
  function paintSeat(btn, st) {
    var c = COLORS[st];
    btn.setAttribute('data-state', st);
    btn.style.background  = c.bg;
    btn.style.borderColor = c.border;
    btn.style.color       = c.text;
    btn.style.textDecoration = st === 'blocked' ? 'line-through' : 'none';
    var title = 'Asiento ' + btn.getAttribute('data-seat') + ' — ' + LABELS[st];
    btn.title = title;
    btn.setAttribute('aria-label', title);
  }

  /** Leyenda + contadores para la vista pública */
  function legendHtml(counts) {
    function chip(color, bg, label, n) {
      return '<span style="font-size:.72rem;background:' + bg + ';border:1px solid ' + color + ';border-radius:2rem;padding:.2rem .65rem;color:' + color + ';">'
           + label + ': <b>' + n + '</b></span>';
    }
    var h = chip('#9ca3af', 'rgba(107,114,128,.15)', 'Disp', counts.available)
          + chip('#22c55e', 'rgba(34,197,94,.12)', 'Res', counts.reserved)
          + chip('#ef4444', 'rgba(239,68,68,.12)', 'Ocup', counts.occupied);
    if (counts.blocked > 0) h += chip('#94a3b8', 'rgba(148,163,184,.12)', 'Bloq', counts.blocked);
    return h;
  }

  global.SeatMap = {
    STATES: STATES,
    LABELS: LABELS,
    COLORS: COLORS,
    LAYOUT_PRESETS: LAYOUT_PRESETS,
    normalizeLayout: normalizeLayout,
    layoutKey: layoutKey,
    sanitizeMap: sanitizeMap,
    stateOf: stateOf,
    countStates: countStates,
    buildRows: buildRows,
    parseRange: parseRange,
    render: render,
    paintSeat: paintSeat,
    legendHtml: legendHtml
  };

})(typeof window !== 'undefined' ? window : this);
