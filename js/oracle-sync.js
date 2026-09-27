/**
 * oracle-sync.js  v1.0
 * ─────────────────────────────────────────────────────────────────
 *  Reemplaza trips-firebase.js
 *
 *  Sincroniza la base de datos (viajes + site settings) con Oracle
 *  Object Storage usando el archivo catalog.json.
 *
 *  Estrategia:
 *   • Al iniciar: lee catalog.json desde Oracle y carga los datos.
 *   • Polling cada 15 seg: detecta cambios de otros usuarios/admins.
 *   • Al guardar desde admin: escribe catalog.json en Oracle vía PUT.
 *
 *  Compatible 100% con el contrato de TripsFirebase (mismo API).
 * ─────────────────────────────────────────────────────────────────
 */
(function (global) {

  var _inited       = false;
  var _pollTimer    = null;
  var _lastHash     = null;   // Para detectar cambios sin descargar todo
  var _lastEtag     = null;   // ETag de Oracle para comparar versiones

  /* ── Config helpers ───────────────────────────────────────────── */

  function cfg() {
    return global.__ORACLE_CONFIG__ || null;
  }

  function configOk() {
    var c = cfg();
    return c && c.PAR_URL && c.PAR_URL.indexOf('objectstorage') !== -1 &&
           c.BUCKET_PUBLIC_URL && c.DB_FILE;
  }

  /* ── URLs de operación ────────────────────────────────────────── */

  function writeUrl() {
    // PUT/GET via PAR (autenticado, lectura + escritura)
    return cfg().PAR_URL + cfg().DB_FILE;
  }

  function readUrl() {
    // GET via URL pública (bucket público, sin autenticación)
    return cfg().BUCKET_PUBLIC_URL + cfg().DB_FILE + '?t=' + Date.now();
  }

  /* ── Refresco de UI ───────────────────────────────────────────── */

  function refreshCatalog() {
    try { if (global.Catalog && global.Catalog.render) global.Catalog.render(); } catch (e) {}
  }

  function refreshBanner() {
    try { if (global.Catalog && global.Catalog.renderBanner) global.Catalog.renderBanner(); } catch (e) {}
  }

  function refreshAdmin() {
    try { if (global.AdminApp && global.AdminApp.renderList) global.AdminApp.renderList(); } catch (e) {}
  }

  /* ── Leer catalog.json desde Oracle ──────────────────────────── */

  function fetchCatalog(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', readUrl(), true);
    xhr.setRequestHeader('Cache-Control', 'no-cache');

    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          var newEtag = xhr.getResponseHeader('ETag') || xhr.responseText.length.toString();

          if (newEtag === _lastEtag) {
            // Sin cambios desde el último fetch
            callback(null, null);
            return;
          }

          _lastEtag = newEtag;
          callback(null, data);
        } catch (e) {
          callback(e, null);
        }
      } else if (xhr.status === 404) {
        // Primera vez: el archivo no existe aún, es normal
        callback(null, { version: 1, trips: [], site: {} });
      } else {
        callback(new Error('HTTP ' + xhr.status), null);
      }
    };

    xhr.onerror = function () {
      callback(new Error('Network error'), null);
    };

    xhr.send();
  }

  /* ── Escribir catalog.json en Oracle ─────────────────────────── */

  function pushCatalog(payload) {
    if (!configOk()) return;

    var body = JSON.stringify(payload, null, 2);

    var xhr = new XMLHttpRequest();
    xhr.open('PUT', writeUrl(), true);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Actualizar ETag local para evitar re-leer lo que acabamos de escribir
        _lastEtag = xhr.getResponseHeader('ETag') || body.length.toString();
        console.log('[OS] catalog.json guardado en Oracle ✓');
      } else {
        console.error('[OS] Error al guardar catalog.json:', xhr.status, xhr.statusText);
      }
    };

    xhr.onerror = function () {
      console.error('[OS] Error de red al guardar catalog.json');
    };

    xhr.send(body);
  }

  /* ── Construir payload completo ───────────────────────────────── */

  function buildPayload() {
    var TS = global.TripsStore;
    var creds = TS.getAdminCredentials ? TS.getAdminCredentials() : {};
    return {
      version:       1,
      updatedAt:     new Date().toISOString(),
      trips:         TS.getTripsSorted ? TS.getTripsSorted() : (TS.getTrips ? TS.getTrips() : []),
      site:          TS.getSiteSettings ? TS.getSiteSettings() : {},
      adminPassword: creds.password || ''
    };
  }

  /* ── Aplicar datos recibidos de Oracle a TripsStore ──────────── */

  function applyRemoteData(data) {
    if (!data || typeof data !== 'object') return;
    var TS = global.TripsStore;
    var changed = false;

    // Aplicar contraseña admin desde Oracle (fuente de verdad centralizada)
    if (typeof data.adminPassword === 'string' && data.adminPassword.length >= 6) {
      var current = TS.getAdminCredentials ? TS.getAdminCredentials() : {};
      if (current.password !== data.adminPassword) {
        if (TS.setAdminCredentials) TS.setAdminCredentials('admin', data.adminPassword);
      }
    }

    // Aplicar viajes
    if (Array.isArray(data.trips)) {
      TS.setTripsFromRemote(data.trips);
      changed = true;
    }

    // Aplicar site settings
    if (data.site && typeof data.site === 'object' && Object.keys(data.site).length > 0) {
      TS.setSiteSettingsFromRemote({
        bannerText:    String(data.site.bannerText    || ''),
        bannerEnabled: !!data.site.bannerEnabled,
        instagramUrl:  String(data.site.instagramUrl  || ''),
        facebookUrl:   String(data.site.facebookUrl   || ''),
        tiktokUrl:     String(data.site.tiktokUrl     || ''),
        youtubeUrl:    String(data.site.youtubeUrl    || ''),
        whatsappPhone: String(data.site.whatsappPhone || '')
      });
    }

    if (changed) {
      refreshCatalog();
      refreshAdmin();
      refreshBanner();
    }
  }

  /* ── Polling periódico ────────────────────────────────────────── */

  function startPolling() {
    if (_pollTimer) return; // Ya está corriendo
    var interval = (cfg() && cfg().POLL_INTERVAL_MS) || 15000;

    _pollTimer = setInterval(function () {
      fetchCatalog(function (err, data) {
        if (err) {
          console.warn('[OS] Polling error:', err.message);
          return;
        }
        if (data !== null) {
          // null significa sin cambios (mismo ETag)
          applyRemoteData(data);
        }
      });
    }, interval);

    console.log('[OS] Polling activo cada ' + (interval / 1000) + 's ✓');
  }

  function stopPolling() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  /* ── API pública (mismo contrato que TripsFirebase) ──────────── */

  global.OracleSync = {

    pushSite: function () {
      if (!configOk()) return;
      pushCatalog(buildPayload());
    },

    init: function () {
      return new Promise(function (resolve) {

        if (_inited) { resolve(true); return; }

        if (!configOk()) {
          console.log('[OS] Oracle no configurado, usando localStorage.');
          resolve(false);
          return;
        }

        console.log('[OS] Iniciando sincronización con Oracle Object Storage…');

        // Carga inicial desde Oracle
        fetchCatalog(function (err, data) {
          if (err) {
            console.warn('[OS] No se pudo leer catalog.json:', err.message, '— usando localStorage.');
          } else if (data !== null) {
            applyRemoteData(data);
          }

          _inited = true;

          // Escuchar cambios locales del admin → push a Oracle
          global.TripsStore.setOnTripsPersistedLocal(function () {
            pushCatalog(buildPayload());
          });

          global.TripsStore.setOnSitePersistedLocal(function () {
            pushCatalog(buildPayload());
          });

          // Iniciar polling para sincronizar cambios entre visitantes
          startPolling();

          resolve(true);
        });

      });
    },

    stop: stopPolling
  };

  // Alias para que el código existente que llama TripsFirebase siga funcionando
  global.TripsFirebase = global.OracleSync;

})(typeof window !== 'undefined' ? window : this);
