/**
 * trips-store.js  v3.0
 * FIXES:
 *  1. Emoji-safe storage: encodeURIComponent/decodeURIComponent wrapper.
 *  2. Fallback robusto cuando localStorage falla (private browsing, etc.).
 *  3. Seed carga desde window.__SA_SEED_DB__ directamente.
 */
(function (global) {
  var STORAGE_KEY     = 'sa_trips_v3';
  var SITE_KEY        = 'sa_site_v3';
  var ADMIN_CRED_KEY  = 'sa_admin_creds_v3';

  // In-memory fallback cuando localStorage no esta disponible
  var _memStore = {};

  /* -- Safe localStorage helpers (emoji-proof) ---------------------- */
  function lsSet(key, value) {
    try {
      localStorage.setItem(key, encodeURIComponent(value));
      return true;
    } catch (e) {
      _memStore[key] = value;
      // Detectar error de cuota y avisar al resto de la app
      if (e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22)) {
        try { global.dispatchEvent(new CustomEvent('sa-storage-full')); } catch (_) {}
      }
      return false;
    }
  }

  function lsGet(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null) return _memStore[key] || null;
      try { return decodeURIComponent(raw); } catch (e2) { return raw; }
    } catch (e) {
      return _memStore[key] || null;
    }
  }

  function lsRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
    delete _memStore[key];
  }

  /* -- Migracion de claves antiguas --------------------------------- */
  (function migrate() {
    var oldKeys = ['sa_trips_v1', 'sa_trips_v2', 'sa_site_v1', 'sa_site_v2',
                   'sa_admin_creds_v1', 'sa_admin_creds_v2'];
    oldKeys.forEach(function (k) {
      try {
        var v = localStorage.getItem(k);
        if (v) {
          if (k === 'sa_trips_v2' && !localStorage.getItem(STORAGE_KEY)) {
            try {
              var arr = JSON.parse(v);
              if (arr && arr.length > 0) lsSet(STORAGE_KEY, JSON.stringify(arr));
            } catch (e) {}
          }
          localStorage.removeItem(k);
        }
      } catch (e) {}
    });
  })();

  var _remoteWrite = false;
  var _remoteSiteWrite = false;
  var onTripsPersistedLocal = null;
  var onSitePersistedLocal  = null;

  function tripsArrayFromJson(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.trips)) return data.trips;
    return [];
  }

  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function normalizeTrip(t) {
    if (!t || typeof t !== 'object') return null;
    var price = Number(t.price);
    if (!isFinite(price) || price < 0) price = 0;
    var disc = Number(t.discountPercent);
    if (!isFinite(disc)) disc = 0;
    disc = clamp(disc, 0, 100);
    var images = [];
    if (Array.isArray(t.images) && t.images.length) {
      images = t.images.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
    }
    if (!images.length && t.imageUrl) images = [String(t.imageUrl).trim()].filter(Boolean);
    return {
      id:               String(t.id || uuid()),
      title:            String(t.title || '').trim() || 'Sin titulo',
      description:      String(t.description || '').trim(),
      location:         String(t.location || '').trim(),
      dateStart:        t.dateStart ? String(t.dateStart) : '',
      dateEnd:          t.dateEnd   ? String(t.dateEnd)   : '',
      dateLabelOverride:String(t.dateLabelOverride || '').trim(),
      price:            Math.round(price * 100) / 100,
      discountPercent:  Math.round(disc  * 10)  / 10,
      hidePrice:        Boolean(t.hidePrice),
      images:           images,
      imageUrl:         images[0] || '',
      formUrl:          String(t.formUrl      || 'https://forms.gle/ejemplo').trim(),
      whatsappPhone:    String(t.whatsappPhone || '18290000000').replace(/\D/g, '') || '18290000000',
      facebookUrl:      String(t.facebookUrl  || '').trim(),
      tiktokUrl:        String(t.tiktokUrl    || '').trim(),
      order:            typeof t.order === 'number' && isFinite(t.order) ? t.order : 0,
      busSeats:         normalizeBusSeatMap(t.busSeats)
    };
  }

  function parseTrips(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeTrip).filter(Boolean);
  }

  function getTrips() {
    try {
      var s = lsGet(STORAGE_KEY);
      if (!s) return [];
      var j = JSON.parse(s);
      return parseTrips(Array.isArray(j) ? j : (j && j.trips ? j.trips : []));
    } catch (e) {
      console.error('[getTrips] parse error:', e.message);
      lsRemove(STORAGE_KEY);
      return [];
    }
  }

  function persistTripsList(list) {
    list.sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      return String(a.title).localeCompare(String(b.title));
    });
    try { lsSet(STORAGE_KEY, JSON.stringify(list)); } catch (e) {
      console.error('[persistTripsList] error:', e.message);
    }
    return list;
  }

  function setTrips(trips) {
    var list = persistTripsList(parseTrips(trips));
    if (!_remoteWrite && typeof onTripsPersistedLocal === 'function') onTripsPersistedLocal(list);
    notifyTripsChanged();
    return list;
  }

  function setTripsFromRemote(trips) {
    _remoteWrite = true;
    try {
      var list = persistTripsList(parseTrips(trips));
      notifyTripsChanged();
      return list;
    } finally { _remoteWrite = false; }
  }

  function notifyTripsChanged() {
    try { if (global.dispatchEvent) global.dispatchEvent(new CustomEvent('sa-trips-updated')); } catch (e) {}
  }

  function getTripsSorted() {
    return getTrips().slice().sort(function (a, b) {
      if (a.order !== b.order) return a.order - b.order;
      return String(a.title).localeCompare(String(b.title));
    });
  }

  function saveTrip(trip) {
    var t = normalizeTrip(trip); if (!t) return null;
    var all = getTrips();
    var idx = all.findIndex(function (x) { return x.id === t.id; });
    if (idx === -1) {
      t.order = all.reduce(function (m, x) { return Math.max(m, x.order); }, -1) + 1;
      all.push(t);
    } else { t.order = all[idx].order; all[idx] = t; }
    setTrips(all);
    return t;
  }

  function deleteTrip(id) { setTrips(getTrips().filter(function (x) { return x.id !== id; })); }

  function moveTrip(id, delta) {
    var list = getTripsSorted();
    var i = list.findIndex(function (x) { return x.id === id; });
    if (i < 0) return;
    var j = i + delta; if (j < 0 || j >= list.length) return;
    var tmp = list[i].order; list[i].order = list[j].order; list[j].order = tmp;
    setTrips(list);
  }

  function importFromJSON(text) {
    var j = JSON.parse(text);
    var arr = tripsArrayFromJson(j);
    if (!Array.isArray(arr)) throw new Error('JSON invalido');
    setTrips(arr);
  }

  function exportToJSON() {
    return JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), trips: getTripsSorted() }, null, 2);
  }

  function finalPrice(t) {
    return Math.round(Number(t.price) * (1 - (Number(t.discountPercent)||0) / 100) * 100) / 100;
  }

  function formatMoney(n) {
    var x = Number(n); if (!isFinite(x)) x = 0;
    return x.toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function formatDateBadge(t) {
    if (t.dateLabelOverride) return t.dateLabelOverride;
    var opts = { day: 'numeric', month: 'short' };
    var optsLong = { day: 'numeric', month: 'short', year: 'numeric' };
    try {
      if (t.dateStart && t.dateEnd && t.dateEnd !== t.dateStart) {
        var a = new Date(t.dateStart + 'T12:00:00'), b = new Date(t.dateEnd + 'T12:00:00');
        if (!isNaN(a) && !isNaN(b)) return a.toLocaleDateString('es-DO', opts) + ' \u2013 ' + b.toLocaleDateString('es-DO', opts);
      }
      if (t.dateStart) {
        var d = new Date(t.dateStart + 'T12:00:00');
        if (!isNaN(d)) return d.toLocaleDateString('es-DO', optsLong);
      }
    } catch (e) {}
    return 'Fecha por confirmar';
  }

  function waUrl(phone, message) {
    var p = String(phone || '').replace(/\D/g, '');
    return 'https://wa.me/' + p + (message ? '?text=' + encodeURIComponent(message) : '');
  }

  /* -- Seed / init -------------------------------------------------- */
  function seedTripsArray() {
    // Sin datos predeterminados — el catálogo arranca vacío
    return [];
  }

  function initIfEmpty() {
    // Devuelve los viajes guardados; si no hay, devuelve array vacío
    var local = getTrips();
    return Promise.resolve(local.length > 0 ? getTripsSorted() : []);
  }

  function resetToSeed() {
    // Limpia todos los viajes (ya no hay "seed" de demo)
    setTrips([]);
    return Promise.resolve([]);
  }

  function setEmbeddedSeed() {}
  function setSeedUrl() {}
  function loadSeed() { return Promise.resolve(seedTripsArray()); }

  /* -- Site settings ------------------------------------------------ */
  function defaultSiteSettings() {
    return { bannerText:'', bannerEnabled:false, instagramUrl:'', facebookUrl:'',
             tiktokUrl:'', youtubeUrl:'', whatsappPhone:'' };
  }

  function getSiteSettings() {
    try {
      var s = lsGet(SITE_KEY); if (!s) return defaultSiteSettings();
      var j = JSON.parse(s);
      return { bannerText:    String(j.bannerText    || ''),
               bannerEnabled: !!j.bannerEnabled,
               instagramUrl:  String(j.instagramUrl  || ''),
               facebookUrl:   String(j.facebookUrl   || ''),
               tiktokUrl:     String(j.tiktokUrl     || ''),
               youtubeUrl:    String(j.youtubeUrl    || ''),
               whatsappPhone: String(j.whatsappPhone || '') };
    } catch (e) { return defaultSiteSettings(); }
  }

  function setSiteSettings(obj) {
    var cur = getSiteSettings();
    var next = {
      bannerText:    obj && obj.bannerText    != null ? String(obj.bannerText)    : cur.bannerText,
      bannerEnabled: obj && obj.bannerEnabled != null ? !!obj.bannerEnabled       : cur.bannerEnabled,
      instagramUrl:  obj && obj.instagramUrl  != null ? String(obj.instagramUrl)  : cur.instagramUrl,
      facebookUrl:   obj && obj.facebookUrl   != null ? String(obj.facebookUrl)   : cur.facebookUrl,
      tiktokUrl:     obj && obj.tiktokUrl     != null ? String(obj.tiktokUrl)     : cur.tiktokUrl,
      youtubeUrl:    obj && obj.youtubeUrl    != null ? String(obj.youtubeUrl)    : cur.youtubeUrl,
      whatsappPhone: obj && obj.whatsappPhone != null ? String(obj.whatsappPhone) : cur.whatsappPhone
    };
    lsSet(SITE_KEY, JSON.stringify(next));
    if (typeof onSitePersistedLocal === 'function') onSitePersistedLocal(next);
    notifySiteChanged();
    return next;
  }

  function setSiteSettingsFromRemote(obj) {
    if (!obj || typeof obj !== 'object') return;
    _remoteSiteWrite = true;
    try {
      lsSet(SITE_KEY, JSON.stringify({
        bannerText:    String(obj.bannerText    || ''),
        bannerEnabled: !!obj.bannerEnabled,
        instagramUrl:  String(obj.instagramUrl  || ''),
        facebookUrl:   String(obj.facebookUrl   || ''),
        tiktokUrl:     String(obj.tiktokUrl     || ''),
        youtubeUrl:    String(obj.youtubeUrl    || ''),
        whatsappPhone: String(obj.whatsappPhone || '')
      }));
      notifySiteChanged();
    } finally { _remoteSiteWrite = false; }
  }

  function notifySiteChanged() {
    try { if (global.dispatchEvent) global.dispatchEvent(new CustomEvent('sa-site-updated')); } catch (e) {}
  }

  /* -- Admin creds -------------------------------------------------- */
  function getAdminCredentials() {
    var d = global.__ADMIN_DEFAULTS__ || { user: 'admin', password: 'super2026' };
    try {
      var s = lsGet(ADMIN_CRED_KEY);
      if (s) { var j = JSON.parse(s); return { user: String(j.user || d.user || 'admin'), password: String(j.password != null ? j.password : d.password) }; }
    } catch (e) {}
    return { user: String(d.user || 'admin'), password: String(d.password || '') };
  }

  function setAdminCredentials(user, password) {
    lsSet(ADMIN_CRED_KEY, JSON.stringify({ user: String(user||'').trim()||'admin', password: String(password!=null?password:'') }));
  }

  /** Retorna true si ya existe una contraseña configurada en localStorage */
  function hasAdminPassword() {
    try {
      var s = lsGet(ADMIN_CRED_KEY);
      if (!s) return false;
      var j = JSON.parse(s);
      return typeof j.password === 'string' && j.password.length > 0;
    } catch (e) { return false; }
  }

  function tripImagesList(t) {
    if (!t) return [];
    if (Array.isArray(t.images) && t.images.length) return t.images.slice();
    if (t.imageUrl) return [t.imageUrl];
    return [];
  }

  /* -- Mapa de asientos del bus (por salida) ------------------------- */
  var BUS_TOTAL_SEATS = 49;
  // Filas de arriba (parte trasera del bus) hacia abajo (parte delantera)
  var BUS_ROWS = [
    { back: true, groups: [[45,46],[49],[47,48]] },
    { groups: [[41,42],[43,44]] },
    { groups: [[37,38],[39,40]] },
    { groups: [[33,34],[35,36]] },
    { groups: [[29,30],[31,32]] },
    { groups: [[25,26],[27,28]] },
    { groups: [[21,22],[23,24]] },
    { groups: [[17,18],[19,20]] },
    { groups: [[13,14],[15,16]] },
    { groups: [[9,10],[11,12]] },
    { groups: [[5,6],[7,8]] },
    { groups: [[1,2],[3,4]] }
  ];

  function normalizeBusSeatMap(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    var src = (raw.seats && typeof raw.seats === 'object') ? raw.seats : raw;
    Object.keys(src).forEach(function (k) {
      var n = parseInt(k, 10);
      if (!isFinite(n) || n < 1 || n > BUS_TOTAL_SEATS) return;
      var v = String(src[k] || '').toLowerCase().trim();
      if (v === 'reservado' || v === 'ocupado') out[String(n)] = v;
    });
    return out;
  }

  function getBusSeatMap(trip) { return normalizeBusSeatMap(trip && trip.busSeats); }

  function busSeatStatusLabel(s) {
    return s === 'reservado' ? 'Reservado' : (s === 'ocupado' ? 'Ocupado' : 'Disponible');
  }

  function busSeatColors(status) {
    if (status === 'reservado') return { bg: '#22c55e', border: '#16a34a', fg: '#ffffff' };
    if (status === 'ocupado')   return { bg: '#ef4444', border: '#b91c1c', fg: '#ffffff' };
    return { bg: 'rgba(255,255,255,0.92)', border: '#9ca3af', fg: '#111827' };
  }

  function renderBusSeatLegendHtml() {
    return '<div style="display:flex;gap:1.25rem;align-items:center;flex-wrap:wrap;">'
      +   '<div style="display:flex;align-items:center;gap:.5rem;"><span style="width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,0.92);border:2px solid #9ca3af;display:inline-block;"></span><span style="font-size:.78rem;">Disponible</span></div>'
      +   '<div style="display:flex;align-items:center;gap:.5rem;"><span style="width:16px;height:16px;border-radius:50%;background:#22c55e;display:inline-block;"></span><span style="font-size:.78rem;">Reservado</span></div>'
      +   '<div style="display:flex;align-items:center;gap:.5rem;"><span style="width:16px;height:16px;border-radius:50%;background:#ef4444;display:inline-block;"></span><span style="font-size:.78rem;">Ocupado</span></div>'
      + '</div>';
  }

  /**
   * Genera el HTML del bus con sus asientos.
   * seatMap: { "3": "reservado", "12": "ocupado", ... }
   * interactive: si es true, genera <button> clicables con data-seat (admin);
   *              si es false, genera una vista de solo lectura (catálogo).
   */
  function renderBusSeatMapHtml(seatMap, interactive) {
    seatMap = seatMap || {};
    function seatEl(n) {
      var st = seatMap[String(n)] || 'disponible';
      var c = busSeatColors(st);
      var tag = interactive ? 'button' : 'div';
      var attrs = interactive
        ? ' type="button" class="sa-bus-seat" data-seat="' + n + '" data-status="' + st + '"'
        : ' class="sa-bus-seat"';
      var cursor = interactive ? 'pointer' : 'default';
      return '<' + tag + attrs + ' title="Asiento ' + n + ' \u2013 ' + busSeatStatusLabel(st) + '"'
        + ' style="width:30px;height:30px;border-radius:50%;border:2px solid ' + c.border + ';background:' + c.bg + ';color:' + c.fg + ';font-size:.62rem;font-weight:800;display:flex;align-items:center;justify-content:center;cursor:' + cursor + ';user-select:none;flex-shrink:0;line-height:1;padding:0;">'
        + n + '</' + tag + '>';
    }
    function group(g) {
      return '<div style="display:flex;flex-direction:column;gap:6px;">' + g.map(seatEl).join('') + '</div>';
    }
    var rowsHtml = BUS_ROWS.map(function (row) {
      var groupsHtml = row.groups.map(group).join('<div style="width:16px;"></div>');
      return '<div style="display:flex;justify-content:center;gap:12px;margin-bottom:' + (row.back ? '12px' : '6px') + ';">' + groupsHtml + '</div>';
    }).join('');
    return '<div style="background:#0b0b0b;border-radius:32px 32px 12px 12px;padding:16px 12px 10px;border:3px solid #000;max-width:220px;margin:0 auto;">'
      +   rowsHtml
      +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:2px dashed rgba(255,255,255,.15);">'
      +     '<span style="font-size:.9rem;">\uD83D\uDEA6</span>'
      +     '<span style="font-size:.6rem;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;">Frente</span>'
      +     '<span style="font-size:.9rem;">\uD83D\uDEAA</span>'
      +   '</div>'
      + '</div>';
  }

  function setOnTripsPersistedLocal(fn) { onTripsPersistedLocal = typeof fn === 'function' ? fn : null; }
  function setOnSitePersistedLocal(fn)  { onSitePersistedLocal  = typeof fn === 'function' ? fn : null; }

  global.TripsStore = {
    STORAGE_KEY,
    SITE_KEY,
    setSeedUrl, setEmbeddedSeed, loadSeed,
    setTripsFromRemote, setOnTripsPersistedLocal,
    uuid, normalizeTrip,
    getTrips, getTripsSorted, setTrips, saveTrip, deleteTrip, moveTrip,
    importFromJSON, exportToJSON,
    finalPrice, formatMoney, formatDateBadge, waUrl,
    initIfEmpty, resetToSeed,
    getSiteSettings, setSiteSettings, setSiteSettingsFromRemote,
    getAdminCredentials, setAdminCredentials, hasAdminPassword,
    tripImagesList,
    setOnSitePersistedLocal,
    BUS_TOTAL_SEATS, BUS_ROWS,
    normalizeBusSeatMap, getBusSeatMap, busSeatStatusLabel,
    renderBusSeatMapHtml, renderBusSeatLegendHtml
  };
})(typeof window !== 'undefined' ? window : this);
