/**
 * reviews-store.js  v1.0
 * ─────────────────────────────────────────────────────────────────
 *  Reseñas (1-5 estrellas + nombre + correo + comentario) por salida.
 *
 *  • Cada salida tiene su PROPIO archivo:  reviews/<tripId>.json
 *    → un visitante nunca puede pisar catalog.json (viajes/config del admin).
 *  • Sin Oracle configurado → fallback a localStorage (solo ese navegador).
 *  • PRIVACIDAD: el bucket es público, así que NO se guarda el correo
 *    completo. Se guarda enmascarado (ju***@gmail.com) + hash SHA-256
 *    (para impedir 2 reseñas del mismo correo en la misma salida).
 *  • Anti-spam básico: honeypot, tiempo mínimo de llenado, 1 reseña por
 *    navegador/salida, límites de longitud y tope de reseñas por salida.
 * ─────────────────────────────────────────────────────────────────
 */
(function (global) {

  var LS_KEY   = 'sa_reviews_v1';
  var MINE_KEY = 'sa_reviews_mine_v1';
  var MAX_PER_TRIP = 500;
  var CACHE_MS = 20000;
  var MAX_WRITE_TRIES = 3;

  var cache = {};   // tripId -> { t:number, list:[] }

  /* ── helpers ──────────────────────────────────────────────────── */

  function cfg() { return global.__ORACLE_CONFIG__ || null; }

  function oracleOk() {
    var c = cfg();
    return !!(c && c.PAR_URL && c.PAR_URL.indexOf('objectstorage') !== -1 && c.BUCKET_PUBLIC_URL);
  }

  function safeId(id) { return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80); }
  function objName(tripId) { return 'reviews/' + safeId(tripId) + '.json'; }

  function lsGet(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } }

  function cleanText(s, max) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, max);
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function maskEmail(email) {
    var p = String(email).split('@');
    var local = p[0] || '', dom = p[1] || '';
    return local.slice(0, Math.min(2, local.length)) + '***@' + dom;
  }

  function sha256(str) {
    var enc = new TextEncoder().encode(str);
    if (global.crypto && crypto.subtle) {
      return crypto.subtle.digest('SHA-256', enc).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
      });
    }
    // Fallback (http sin crypto.subtle): hash FNV-1a, suficiente para detectar duplicados
    var h = 2166136261;
    for (var i = 0; i < enc.length; i++) { h ^= enc[i]; h = Math.imul(h, 16777619) >>> 0; }
    return Promise.resolve('f' + h.toString(16));
  }

  function newId() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  /** Valida lo que llega del servidor (nunca confiar en el JSON remoto). */
  function normalizeReview(r) {
    if (!r || typeof r !== 'object') return null;
    var rating = Math.round(Number(r.rating));
    if (!(rating >= 1 && rating <= 5)) return null;
    return {
      id:         String(r.id || ''),
      name:       cleanText(r.name, 60) || 'Anónimo',
      emailMask:  cleanText(r.emailMask, 120),
      emailHash:  cleanText(r.emailHash, 80),
      rating:     rating,
      comment:    cleanText(r.comment, 600),
      createdAt:  String(r.createdAt || '')
    };
  }

  function normalizeList(raw) {
    var arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.reviews) ? raw.reviews : []);
    return arr.map(normalizeReview).filter(function (r) { return r && r.id; });
  }

  function sortNewest(list) {
    return list.slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  }

  /* ── I/O Oracle ───────────────────────────────────────────────── */

  function remoteRead(tripId) {
    var c = cfg();
    var url = c.BUCKET_PUBLIC_URL + encodeURIComponent(objName(tripId)) + '?t=' + Date.now();
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (res.status === 404) return [];
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json().then(normalizeList);
    });
  }

  function remoteWrite(tripId, list) {
    var c = cfg();
    var url = c.PAR_URL + encodeURIComponent(objName(tripId));
    var body = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), reviews: list });
    return fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); });
  }

  /**
   * Lee-modifica-escribe y VERIFICA que el cambio quedó (si dos personas
   * escriben a la vez, la que perdió reintenta). Sin cabeceras especiales
   * para no depender de la configuración CORS del bucket.
   */
  function mutateRemote(tripId, mutator, check, attempt) {
    attempt = attempt || 1;
    return remoteRead(tripId).then(function (cur) {
      var res = mutator(cur);
      if (res.error) return { error: res.error };
      return remoteWrite(tripId, res.list).then(function () {
        return remoteRead(tripId).then(function (after) {
          if (check(after)) { cache[tripId] = { t: Date.now(), list: after }; return { ok: true, list: after, value: res.value }; }
          if (attempt >= MAX_WRITE_TRIES) return { error: 'No se pudo confirmar el guardado. Intenta de nuevo.' };
          return mutateRemote(tripId, mutator, check, attempt + 1);
        });
      });
    });
  }

  /* ── API ──────────────────────────────────────────────────────── */

  function list(tripId, force) {
    var c = cache[tripId];
    if (!force && c && Date.now() - c.t < CACHE_MS) return Promise.resolve(c.list);
    var p;
    if (oracleOk()) {
      p = remoteRead(tripId);
    } else {
      var all = lsGet(LS_KEY) || {};
      p = Promise.resolve(normalizeList(all[tripId]));
    }
    return p.then(function (l) {
      l = sortNewest(l);
      cache[tripId] = { t: Date.now(), list: l };
      return l;
    }).catch(function (e) {
      console.warn('[Reviews] lectura falló:', e && e.message);
      return (c && c.list) || [];
    });
  }

  function summarize(l) {
    var count = l.length, sum = 0, dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    l.forEach(function (r) { sum += r.rating; dist[r.rating]++; });
    return { count: count, avg: count ? Math.round((sum / count) * 10) / 10 : 0, dist: dist };
  }

  function summary(tripId) { return list(tripId).then(summarize); }

  function hasReviewed(tripId) {
    var mine = lsGet(MINE_KEY) || {};
    return !!mine[tripId];
  }
  function markReviewed(tripId) {
    var mine = lsGet(MINE_KEY) || {};
    mine[tripId] = Date.now();
    lsSet(MINE_KEY, mine);
  }

  /**
   * input: { name, email, rating, comment, website(honeypot), openedAt(ms) }
   * → Promise<{ ok:true, review, list } | { error:string }>
   */
  function add(tripId, input) {
    input = input || {};
    if (input.website) return Promise.resolve({ error: 'No se pudo enviar.' });             // honeypot
    if (hasReviewed(tripId)) return Promise.resolve({ error: 'Ya dejaste una reseña para esta salida. ¡Gracias!' });

    var name = cleanText(input.name, 60);
    var email = cleanText(input.email, 120).toLowerCase();
    var comment = cleanText(input.comment, 600);
    var rating = Math.round(Number(input.rating));

    if (name.length < 2)           return Promise.resolve({ error: 'Escribe tu nombre (mínimo 2 letras).' });
    if (!EMAIL_RE.test(email))     return Promise.resolve({ error: 'Escribe un correo válido.' });
    if (!(rating >= 1 && rating <= 5)) return Promise.resolve({ error: 'Elige de 1 a 5 estrellas.' });
    if (comment.length < 3)        return Promise.resolve({ error: 'Escribe un comentario.' });
    // Anti-bot: un humano tarda más de 2.5 s en llenar el formulario (se evalúa tras validar)
    if (input.openedAt && Date.now() - input.openedAt < 2500) return Promise.resolve({ error: 'Espera un momento antes de enviar.' });

    return sha256(tripId + '|' + email).then(function (hash) {
      var review = {
        id: newId(), name: name, emailMask: maskEmail(email), emailHash: hash,
        rating: rating, comment: comment, createdAt: new Date().toISOString()
      };

      function mutator(cur) {
        if (cur.length >= MAX_PER_TRIP) return { error: 'Esta salida alcanzó el máximo de reseñas.' };
        if (cur.some(function (r) { return r.emailHash === hash; })) return { error: 'Ese correo ya dejó una reseña en esta salida.' };
        return { list: cur.concat([review]), value: review };
      }
      function check(after) { return after.some(function (r) { return r.id === review.id; }); }

      var p;
      if (oracleOk()) {
        p = mutateRemote(tripId, mutator, check);
      } else {
        var all = lsGet(LS_KEY) || {};
        var res = mutator(normalizeList(all[tripId]));
        if (res.error) { p = Promise.resolve({ error: res.error }); }
        else { all[tripId] = res.list; lsSet(LS_KEY, all); cache[tripId] = { t: Date.now(), list: res.list }; p = Promise.resolve({ ok: true, list: res.list, value: review }); }
      }
      return p.then(function (r) {
        if (r.ok) { markReviewed(tripId); r.list = sortNewest(r.list); return { ok: true, review: review, list: r.list }; }
        return r;
      });
    }).catch(function (e) {
      console.error('[Reviews] add falló:', e);
      return { error: 'Error de conexión. Intenta de nuevo.' };
    });
  }

  /** Moderación (admin) */
  function remove(tripId, reviewId) {
    function mutator(cur) { return { list: cur.filter(function (r) { return r.id !== reviewId; }) }; }
    function check(after) { return !after.some(function (r) { return r.id === reviewId; }); }
    if (oracleOk()) return mutateRemote(tripId, mutator, check);
    var all = lsGet(LS_KEY) || {};
    var res = mutator(normalizeList(all[tripId]));
    all[tripId] = res.list; lsSet(LS_KEY, all);
    cache[tripId] = { t: Date.now(), list: res.list };
    return Promise.resolve({ ok: true, list: res.list });
  }

  /** Al borrar una salida se borran sus reseñas. */
  function purge(tripId) {
    delete cache[tripId];
    if (oracleOk()) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('DELETE', cfg().PAR_URL + encodeURIComponent(objName(tripId)), true);
        xhr.send();
      } catch (e) {}
    }
    var all = lsGet(LS_KEY) || {};
    if (all[tripId]) { delete all[tripId]; lsSet(LS_KEY, all); }
  }

  global.ReviewsStore = {
    list: list, summary: summary, summarize: summarize,
    add: add, remove: remove, purge: purge,
    hasReviewed: hasReviewed
  };

})(typeof window !== 'undefined' ? window : this);
