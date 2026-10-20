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

  /* Layout del bus: left+right asientos por lado, backRow = última fila corrida */
  function normalizeSeatLayout(l) {
    var left = parseInt(l && l.left, 10), right = parseInt(l && l.right, 10);
    return {
      left:    clamp(isFinite(left)  ? left  : 2, 1, 3),
      right:   clamp(isFinite(right) ? right : 2, 1, 3),
      backRow: !!(l && l.backRow)
    };
  }

  /* Solo guarda estados no-default y asientos dentro de la capacidad */
  function normalizeSeatMap(m, total) {
    var out = {};
    if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
    Object.keys(m).forEach(function (k) {
      var n = parseInt(k, 10), st = m[k];
      if (String(n) === k && n >= 1 && n <= total && (st === 'reserved' || st === 'occupied' || st === 'blocked')) out[k] = st;
    });
    return out;
  }

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
      totalSeats:       (typeof t.totalSeats === 'number' && isFinite(t.totalSeats) && t.totalSeats >= 0) ? Math.round(t.totalSeats) : 0,
      seatLayout:       normalizeSeatLayout(t.seatLayout),
      seatMap:          normalizeSeatMap(t.seatMap, (typeof t.totalSeats === 'number' && isFinite(t.totalSeats) && t.totalSeats >= 0) ? Math.round(t.totalSeats) : 0)
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
    setOnSitePersistedLocal
  };
})(typeof window !== 'undefined' ? window : this);
