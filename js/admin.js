(function () {
  var TS = window.TripsStore;
  var editingId = null;
  var currentImages = [];
  var currentSeatMap = {}; // mapa de asientos de la salida en edición: {"3":"reservado", ...}
  var SESSION_KEY = 'sa_admin_session';
  var SESSION_START = 'sa_admin_session_start';
  var SESSION_MS = 30 * 60 * 1000;
  var MAX_W = 1200;         // ancho max — calidad buena para Storage
  var JPEG_Q = 0.82;        // calidad alta — Oracle Object Storage tiene 20 GB gratis
  var MAX_BYTES = 2 * 1024 * 1024; // 2 MB por imagen (Storage lo soporta)
  var sessionTimer = null;

  function $(id) { return document.getElementById(id); }

  function toast(msg, err) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    el.style.background = err ? '#dc2626' : '#16a34a';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.style.display = 'none'; }, 3200);
  }

  function switchTab(name) {
    ['trips','banner','config'].forEach(function (t) {
      var panel = $('tab-' + t);
      if (panel) panel.style.display = t === name ? 'block' : 'none';
    });
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === name);
    });
  }

  function isLoggedIn() { return sessionStorage.getItem(SESSION_KEY) === '1'; }

  function setLoggedIn() {
    sessionStorage.setItem(SESSION_KEY, '1');
    sessionStorage.setItem(SESSION_START, String(Date.now()));
    startTimer();
  }

  function clearTimer() { if (sessionTimer) { clearInterval(sessionTimer); sessionTimer = null; } }

  function startTimer() {
    clearTimer();
    sessionTimer = setInterval(function () {
      var start = parseInt(sessionStorage.getItem(SESSION_START) || '0', 10);
      if (start && Date.now() - start > SESSION_MS) { clearTimer(); toast('Sesión expirada', true); logout(); }
    }, 30000);
  }

  function logout() {
    clearTimer();
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_START);
    location.reload();
  }

  function compressFile(file, cb) {
    if (!file || file.type.indexOf('image/') !== 0) { cb(new Error('no image')); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      var w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
      try {
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        // Si Storage disponible: calidad alta, sin loop agresivo
        if (window.FirebaseStorage && window.FirebaseStorage.isReady()) {
          cb(null, c.toDataURL('image/jpeg', JPEG_Q));
          return;
        }
        // Fallback localStorage: compresion agresiva
        var q = JPEG_Q;
        var dataUrl = c.toDataURL('image/jpeg', q);
        while (dataUrl.length * 0.75 > MAX_BYTES && q > 0.20) {
          q = Math.round((q - 0.05) * 100) / 100;
          dataUrl = c.toDataURL('image/jpeg', q);
        }
        var scale = 1.0;
        while (dataUrl.length * 0.75 > MAX_BYTES && scale > 0.15) {
          scale = Math.round((scale - 0.10) * 100) / 100;
          var cS = document.createElement('canvas');
          cS.width  = Math.max(1, Math.round(w * scale));
          cS.height = Math.max(1, Math.round(h * scale));
          cS.getContext('2d').drawImage(img, 0, 0, cS.width, cS.height);
          dataUrl = cS.toDataURL('image/jpeg', Math.max(q, 0.30));
        }
        cb(null, dataUrl);
      } catch (e) { cb(e); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(new Error('read error')); };
    img.src = url;
  }

  function addImage(src) {
    if (!src) return;
    currentImages.push(src);
    if ($('f-img-url')) $('f-img-url').value = '';
    renderStrip(); updatePreview(); toast('Imagen agregada');
  }

  function renderSeatEditor() {
    var wrap = $('seat-editor-wrap');
    var legend = $('seat-editor-legend');
    if (!wrap) return;
    wrap.innerHTML = TS.renderBusSeatMapHtml(currentSeatMap, true);
    if (legend) legend.innerHTML = TS.renderBusSeatLegendHtml();
    wrap.querySelectorAll('[data-seat]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var seat = btn.getAttribute('data-seat');
        var cur = currentSeatMap[seat] || 'disponible';
        var next = cur === 'disponible' ? 'reservado' : (cur === 'reservado' ? 'ocupado' : 'disponible');
        if (next === 'disponible') delete currentSeatMap[seat]; else currentSeatMap[seat] = next;
        renderSeatEditor();
      });
    });
  }

  function renderStrip() {
    var strip = $('img-strip');
    if (!strip) return;
    if (!currentImages.length) { strip.style.display = 'none'; strip.innerHTML = ''; return; }
    strip.style.display = 'flex';
    strip.innerHTML = currentImages.map(function (src, i) {
      return '<div style="position:relative;width:72px;height:72px;border-radius:.6rem;overflow:hidden;border:1px solid rgba(255,255,255,.12);">'
           + '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover;">'
           + '<button type="button" data-ri="' + i + '" style="position:absolute;inset:0;background:rgba(0,0,0,.55);color:#fff;font-size:.7rem;font-weight:700;border:none;cursor:pointer;opacity:0;transition:opacity .15s;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0">✕</button>'
           + '</div>';
    }).join('');
    strip.querySelectorAll('[data-ri]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-ri'), 10);
        var removedUrl = currentImages[idx];
        currentImages.splice(idx, 1);
        // Si la imagen eliminada vive en Firebase Storage, borrarla también allí
        if (removedUrl && window.FirebaseStorage) {
          window.FirebaseStorage.deleteImage(removedUrl);
        }
        renderStrip(); updatePreview();
      });
    });
  }

  function updatePreview() {
    var img = $('img-preview'), ph = $('img-placeholder');
    var src = currentImages[0] || '';

    // Sincronizar el campo de URL con la imagen actual:
    // - si queda una sola imagen de tipo URL (http) → mostrarla
    // - en cualquier otro caso (vacío, base64, múltiples) → limpiar el campo
    if ($('f-img-url')) {
      var solo = currentImages.length === 1 && src.indexOf('http') === 0;
      $('f-img-url').value = solo ? src : '';
    }

    if (!src) { if (img) { img.style.display = 'none'; img.removeAttribute('src'); } if (ph) ph.style.display = 'block'; return; }
    if (img) { img.src = src; img.style.display = 'block'; }
    if (ph)  ph.style.display = 'none';
  }

  function bindImageUI() {
    var dz = $('dz'), fileIn = $('file-img'), urlIn = $('f-img-url'), addBtn = $('btn-add-url'), pickBtn = $('btn-pick');
    function processFiles(files) {
      if (!files || !files.length) return;
      if (window.StorageBar && !window.StorageBar.canUpload()) {
        toast('🚫 Almacenamiento lleno. No se pueden subir más fotos.', true);
        return;
      }
      for (var i = 0; i < files.length; i++) {
        (function (f) { compressFile(f, function (err, d) { if (!err && d) addImage(d); }); })(files[i]);
      }
    }
    if (pickBtn) pickBtn.addEventListener('click', function () { fileIn.click(); });
    if (dz) {
      dz.addEventListener('click', function (e) {
        if (e.target.closest('#btn-pick') || e.target.closest('#img-strip') || e.target.closest('#btn-add-url') || e.target.closest('#f-img-url')) return;
        fileIn.click();
      });
      dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag-over'); });
      dz.addEventListener('dragleave', function () { dz.classList.remove('drag-over'); });
      dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('drag-over'); processFiles(e.dataTransfer && e.dataTransfer.files); });
    }
    if (fileIn) { fileIn.addEventListener('change', function () { processFiles(fileIn.files); fileIn.value = ''; }); }
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        var v = urlIn ? urlIn.value.trim() : '';
        if (v) { addImage(v); }
        else toast('Ingresa una URL o ruta válida', true);
      });
    }
    if (urlIn) {
      urlIn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); if (addBtn) addBtn.click(); }
      });
    }
    document.addEventListener('paste', function (e) {
      if (!isLoggedIn()) return;
      if (window.StorageBar && !window.StorageBar.canUpload()) {
        toast('🚫 Almacenamiento lleno. No se pueden subir más fotos.', true);
        return;
      }
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          var f = items[i].getAsFile();
          if (f) compressFile(f, function (err, d) { if (!err && d) addImage(d); });
          return;
        }
      }
    });
  }

  function getForm() {
    var urlVal = $('f-img-url') ? $('f-img-url').value.trim() : '';
    var images = currentImages.slice();
    if (!images.length && urlVal) {
      images = [urlVal];
    }
    
    var t = {
      id: editingId || TS.uuid(),
      title: String($('f-title').value || '').trim(),
      description: String($('f-desc').value || '').trim(),
      location: String($('f-loc').value || '').trim(),
      dateStart: $('f-date-s').value,
      dateEnd: $('f-date-e').value,
      dateLabelOverride: String($('f-date-lbl').value || '').trim(),
      price: parseFloat($('f-price').value) || 0,
      discountPercent: parseFloat($('f-disc').value) || 0,
      hidePrice: !!($('f-hide-price') && $('f-hide-price').checked),
      images: images,
      formUrl: String($('f-form').value || 'https://forms.gle/ejemplo').trim(),
      busSeats: { seats: currentSeatMap }
    };
    if (editingId) {
      var ex = TS.getTrips().find(function (x) { return x.id === editingId; });
      if (ex) t.order = ex.order;
    }
    return TS.normalizeTrip(t);
  }

  function clearForm() {
    editingId = null; currentImages = []; currentSeatMap = {};
    ['f-title','f-desc','f-loc','f-date-s','f-date-e','f-date-lbl','f-img-url'].forEach(function (id) { if ($(id)) $(id).value = ''; });
    if ($('f-price'))  $('f-price').value  = '';
    if ($('f-disc'))   $('f-disc').value   = '0';
    if ($('f-hide-price')) $('f-hide-price').checked = false;
    if ($('f-form'))   $('f-form').value   = 'https://forms.gle/ejemplo';
    if ($('form-title')) $('form-title').textContent = 'Nueva salida';
    if ($('btn-save'))   $('btn-save').textContent   = 'Crear salida';
    if ($('btn-cancel')) $('btn-cancel').style.display = 'none';
    renderStrip(); updatePreview(); renderSeatEditor();
  }

  function fillForm(t) {
    if (!t) { clearForm(); return; }
    editingId = t.id; currentImages = TS.tripImagesList(t).slice();
    currentSeatMap = TS.normalizeBusSeatMap(t.busSeats);
    $('f-title').value    = t.title || '';
    $('f-desc').value     = t.description || '';
    $('f-loc').value      = t.location || '';
    $('f-date-s').value   = t.dateStart || '';
    $('f-date-e').value   = t.dateEnd || '';
    $('f-date-lbl').value = t.dateLabelOverride || '';
    $('f-price').value    = t.price != null ? String(t.price) : '';
    $('f-disc').value     = t.discountPercent != null ? String(t.discountPercent) : '0';
    if ($('f-hide-price')) $('f-hide-price').checked = !!t.hidePrice;
    $('f-img-url').value  = (currentImages.length === 1 && currentImages[0].indexOf('http') === 0) ? currentImages[0] : '';
    $('f-form').value     = t.formUrl || '';
    if ($('form-title')) $('form-title').textContent = 'Editar salida';
    if ($('btn-save'))   $('btn-save').textContent   = 'Guardar cambios';
    if ($('btn-cancel')) $('btn-cancel').style.display = 'inline-flex';
    renderStrip(); updatePreview(); renderSeatEditor();
    setTimeout(function () { $('editor-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
  }

  function renderList() {
    var trips = TS.getTripsSorted();
    var wrap  = $('trip-list'), title = $('list-title');
    if (title) title.textContent = 'Salidas (' + trips.length + ')';
    if (!wrap) return;
    if (!trips.length) { wrap.innerHTML = '<p style="color:rgba(255,255,255,.35);font-size:.88rem;padding:1.5rem 0;text-align:center;">No hay salidas. Crea una nueva.</p>'; return; }
    wrap.innerHTML = trips.map(function (t) {
      var thumb = t.imageUrl
        ? '<img src="' + t.imageUrl + '" style="width:44px;height:44px;border-radius:.55rem;object-fit:cover;flex-shrink:0;" loading="lazy">'
        : '<div style="width:44px;height:44px;border-radius:.55rem;background:#1b2620;flex-shrink:0;"></div>';
      var disc = t.discountPercent > 0 ? ' <span style="color:#4ade80;">(-' + t.discountPercent + '%)</span>' : '';
      var priceTxt = t.hidePrice
        ? '<span style="color:#facc15;">Precio oculto</span>'
        : 'RD$ ' + TS.formatMoney(TS.finalPrice(t)) + disc;
      return '<div class="trip-item" style="display:flex;align-items:center;gap:.75rem;padding:.65rem .75rem;border-radius:.9rem;border:1px solid var(--border);transition:background .15s;">'
           + '<div style="display:flex;gap:.6rem;align-items:center;flex:1;min-width:0;">' + thumb
           + '<div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + t.title + '</div>'
           + '<div style="font-size:.73rem;color:rgba(255,255,255,.4);margin-top:.1rem;">' + (t.location||'') + ' · ' + priceTxt + '</div>'
           + '</div></div>'
           + '<div style="display:flex;gap:.3rem;flex-shrink:0;">'
           + '<button type="button" data-move="' + t.id + '" data-d="-1" class="btn-icon" title="Subir">↑</button>'
           + '<button type="button" data-move="' + t.id + '" data-d="1"  class="btn-icon" title="Bajar">↓</button>'
           + '<button type="button" data-edit="' + t.id + '" style="background:var(--gold);color:#000;border:none;border-radius:.55rem;padding:.35rem .75rem;font-size:.78rem;font-weight:700;cursor:pointer;">Editar</button>'
           + '<button type="button" data-del="'  + t.id + '" style="background:rgba(220,38,38,.15);color:#f87171;border:1px solid rgba(220,38,38,.3);border-radius:.55rem;padding:.35rem .65rem;font-size:.78rem;cursor:pointer;">✕</button>'
           + '</div></div>';
    }).join('');
    wrap.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () { var tr = TS.getTrips().find(function (x) { return x.id === btn.getAttribute('data-edit'); }); fillForm(tr || null); });
    });
    wrap.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('¿Eliminar esta salida?')) return;
        var id = btn.getAttribute('data-del');
        // Borrar imágenes de Storage antes de eliminar el registro
        var trip = TS.getTrips().find(function (x) { return x.id === id; });
        if (trip && window.FirebaseStorage) {
          var imgs = TS.tripImagesList(trip);
          imgs.forEach(function (url) { window.FirebaseStorage.deleteImage(url); });
        }
        TS.deleteTrip(id); renderList();
        if (editingId === id) clearForm(); toast('Salida eliminada');
      });
    });
    wrap.querySelectorAll('[data-move]').forEach(function (btn) {
      btn.addEventListener('click', function () { TS.moveTrip(btn.getAttribute('data-move'), parseInt(btn.getAttribute('data-d'), 10)); renderList(); });
    });
  }

  function loadBanner() {
    var s = TS.getSiteSettings();
    if ($('banner-text'))    $('banner-text').value      = s.bannerText   || '';
    if ($('banner-enabled')) $('banner-enabled').checked = !!s.bannerEnabled;
  }

  function loadConfig() {
    var s = TS.getSiteSettings();
    if ($('soc-ig')) $('soc-ig').value = s.instagramUrl  || '';
    if ($('soc-tt')) $('soc-tt').value = s.tiktokUrl     || '';
    if ($('soc-fb')) $('soc-fb').value = s.facebookUrl   || '';
    if ($('soc-yt')) $('soc-yt').value = s.youtubeUrl    || '';
    if ($('soc-wa')) $('soc-wa').value = s.whatsappPhone || '';
    if ($('sec-pass')) $('sec-pass').value = '';
  }

  function pushSite() { if (window.TripsFirebase && TripsFirebase.pushSite) TripsFirebase.pushSite(); }

  function bind() {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
    });
    if ($('btn-new'))    $('btn-new').addEventListener('click', clearForm);
    if ($('btn-cancel')) $('btn-cancel').addEventListener('click', clearForm);
    if ($('btn-save')) {
      $('btn-save').addEventListener('click', function () {
        var t = getForm();
        if (!t.title) { toast('Agrega un título', true); return; }

        // Imágenes que tenía esta salida ANTES de editar (solo las de Storage)
        var prevStorageUrls = [];
        if (editingId) {
          var prevTrip = TS.getTrips().find(function (x) { return x.id === editingId; });
          if (prevTrip) {
            prevStorageUrls = TS.tripImagesList(prevTrip).filter(function (u) {
              return u && (u.indexOf('firebasestorage') !== -1 || u.indexOf('objectstorage') !== -1);
            });
          }
        }

        // Separar imágenes base64 (nuevas) de URLs ya en Storage
        var base64Images = (t.images || []).filter(function (src) {
          return src && src.indexOf('data:image/') === 0;
        });
        var urlImages = (t.images || []).filter(function (src) {
          return src && src.indexOf('data:image/') !== 0;
        });

        /**
         * Borra de Oracle Storage las imágenes que estaban en la salida
         * antes de editar pero que ya no aparecen en el nuevo set.
         */
        function purgeOrphanedImages(finalUrls) {
          if (!window.FirebaseStorage || !prevStorageUrls.length) return;
          var finalSet = (finalUrls || []).reduce(function (acc, u) { acc[u] = true; return acc; }, {});
          prevStorageUrls.forEach(function (u) {
            if (!finalSet[u]) window.FirebaseStorage.deleteImage(u);
          });
        }

        // Bloquear si hay fotos nuevas y el storage está lleno
        if (base64Images.length > 0 && window.StorageBar && !window.StorageBar.canUpload()) {
          toast('🚫 Almacenamiento lleno. Elimina fotos antiguas antes de subir nuevas.', true);
          return;
        }

        // Si hay imágenes base64 Y Firebase Storage está listo → subir a la nube
        if (base64Images.length > 0 && window.FirebaseStorage && window.FirebaseStorage.isReady()) {
          var btn = $('btn-save');
          btn.disabled = true;
          btn.textContent = 'Subiendo fotos…';

          var progMap = {};
          window.FirebaseStorage.uploadMany(base64Images, function (idx, pct) {
            progMap[idx] = pct;
            var total = Object.values(progMap).reduce(function (a, b) { return a + b; }, 0);
            var avg   = Math.round(total / base64Images.length);
            btn.textContent = 'Subiendo fotos… ' + avg + '%';
          }).then(function (uploadedUrls) {
            t.images = urlImages.concat(uploadedUrls);
            if (t.images.length === 1) {
              t.imageUrl = t.images[0];
            } else if (t.images.length > 1) {
              t.imageUrl = t.images[0];
            }
            purgeOrphanedImages(t.images);
            TS.saveTrip(t);
            editingId = t.id;
            renderList();
            toast('✅ Salida guardada con fotos en la nube');
            btn.disabled = false;
            btn.textContent = 'Guardar cambios';
            if ($('btn-save'))   $('btn-save').textContent   = 'Guardar cambios';
            if ($('btn-cancel')) $('btn-cancel').style.display = 'inline-flex';
            if ($('form-title')) $('form-title').textContent = 'Editar salida';
            if (window.StorageBar) StorageBar.update();
          }).catch(function (err) {
            console.error('[save] upload error:', err);
            toast('Error subiendo fotos. Intenta de nuevo.', true);
            btn.disabled = false;
            btn.textContent = 'Guardar cambios';
          });

        } else {
          // Sin Storage o sin imágenes base64 nuevas → guardar directo
          purgeOrphanedImages(urlImages);
          TS.saveTrip(t); editingId = t.id; renderList(); toast('Salida guardada');
          if ($('btn-save'))   $('btn-save').textContent   = 'Guardar cambios';
          if ($('btn-cancel')) $('btn-cancel').style.display = 'inline-flex';
          if ($('form-title')) $('form-title').textContent = 'Editar salida';
          if (window.StorageBar) StorageBar.update();
        }
      });
    }
    if ($('btn-export')) {
      $('btn-export').addEventListener('click', function () {
        var blob = new Blob([TS.exportToJSON()], { type: 'application/json' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'trips.json'; a.click(); URL.revokeObjectURL(a.href); toast('JSON descargado');
      });
    }
    if ($('btn-import')) $('btn-import').addEventListener('click', function () { $('file-import').click(); });
    if ($('file-import')) {
      $('file-import').addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function () { try { TS.importFromJSON(String(r.result)); renderList(); clearForm(); toast('Importado'); } catch (err) { toast('JSON inválido', true); } };
        r.readAsText(f); e.target.value = '';
      });
    }
    if ($('btn-save-banner')) {
      $('btn-save-banner').addEventListener('click', function () {
        TS.setSiteSettings({ bannerText: $('banner-text').value, bannerEnabled: $('banner-enabled').checked });
        pushSite(); toast('Banner actualizado');
      });
    }
    if ($('btn-save-config')) {
      $('btn-save-config').addEventListener('click', function () {
        TS.setSiteSettings({
          instagramUrl:  ($('soc-ig') && $('soc-ig').value.trim()) || '',
          tiktokUrl:     ($('soc-tt') && $('soc-tt').value.trim()) || '',
          facebookUrl:   ($('soc-fb') && $('soc-fb').value.trim()) || '',
          youtubeUrl:    ($('soc-yt') && $('soc-yt').value.trim()) || '',
          whatsappPhone: ($('soc-wa') && $('soc-wa').value.replace(/\D/g,'')) || ''
        });
        pushSite();
        var newPass = $('sec-pass') && $('sec-pass').value;
        if (newPass && newPass.length >= 4) {
          var creds = TS.getAdminCredentials(); TS.setAdminCredentials(creds.user, newPass);
          if ($('sec-pass')) $('sec-pass').value = '';
          toast('Configuración y contraseña guardadas');
        } else { toast('Configuración guardada'); }
      });
    }
    if ($('btn-logout')) $('btn-logout').addEventListener('click', function () { if (confirm('¿Cerrar sesión?')) logout(); });
    bindImageUI();
    window.addEventListener('sa-trips-updated', renderList);
    window.addEventListener('sa-site-updated', function () { loadBanner(); loadConfig(); });
    window.addEventListener('sa-storage-full', function () {
      toast('⚠️ Almacenamiento lleno: la imagen no se guardará al recargar. Usa URLs externas o elimina salidas antiguas.', true);
    });
  }

  function startApp() {
    $('login-screen').style.display = 'none';
    $('app').style.display = 'block';
    function boot() { renderList(); clearForm(); loadBanner(); loadConfig(); }
    boot();
    bind(); switchTab('trips'); startTimer();
    // Actualizar barra ahora que Firebase ya está inicializado
    setTimeout(function () { if (window.StorageBar) StorageBar.update(); }, 600);
  }

  function tryLogin() {
    var pass = ($('l-pass') && $('l-pass').value) || '';
    var creds = TS.getAdminCredentials();
    if (pass === creds.password) {
      setLoggedIn();
      TripsFirebase.init().then(function (ok) { window.__SA_FIREBASE_ACTIVE__ = !!ok; startApp(); });
    } else {
      var err = $('l-err'); if (err) { err.textContent = 'Contraseña incorrecta.'; err.style.display = 'block'; }
      if ($('l-pass')) { $('l-pass').value = ''; $('l-pass').focus(); }
    }
  }

  /**
   * Primer acceso: Oracle no tiene contraseña.
   * Solo el PRIMER dispositivo que llegue podrá crearla.
   * Se guarda en catalog.json (Oracle) → válida para TODOS los dispositivos.
   */
  function showSetup() {
    var screen = $('login-screen');
    if (!screen) return;
    screen.innerHTML = [
      '<div style="max-width:340px;width:90%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);',
      'border-radius:1.2rem;padding:2rem 2rem 1.8rem;display:flex;flex-direction:column;gap:1rem;">',
      '<h2 style="margin:0;font-size:1.2rem;font-weight:700;color:#F5B800;">⚙️ Primer acceso</h2>',
      '<p style="margin:0;font-size:.85rem;color:rgba(255,255,255,.65);line-height:1.5;">',
      'Crea la contraseña de administrador. Se guardará en la nube y funcionará en todos los dispositivos.</p>',
      '<input id="su-pass"  type="password" placeholder="Nueva contraseña (mín. 6 caracteres)"',
      ' style="padding:.65rem .9rem;border-radius:.6rem;border:1px solid rgba(255,255,255,.2);',
      'background:rgba(255,255,255,.07);color:#fff;font-size:.95rem;outline:none;">',
      '<input id="su-pass2" type="password" placeholder="Confirmar contraseña"',
      ' style="padding:.65rem .9rem;border-radius:.6rem;border:1px solid rgba(255,255,255,.2);',
      'background:rgba(255,255,255,.07);color:#fff;font-size:.95rem;outline:none;">',
      '<p id="su-err" style="display:none;margin:0;font-size:.82rem;color:#f87171;"></p>',
      '<button id="su-btn" style="padding:.7rem;border-radius:.65rem;background:#F5B800;color:#000;',
      'font-weight:700;font-size:.95rem;border:none;cursor:pointer;">Guardar y entrar</button>',
      '</div>'
    ].join('');

    function doSetup() {
      var p1 = $('su-pass')  ? $('su-pass').value  : '';
      var p2 = $('su-pass2') ? $('su-pass2').value : '';
      var errEl = $('su-err');
      if (p1.length < 6) { if (errEl) { errEl.textContent = 'Mínimo 6 caracteres.'; errEl.style.display = 'block'; } return; }
      if (p1 !== p2)     { if (errEl) { errEl.textContent = 'Las contraseñas no coinciden.'; errEl.style.display = 'block'; } return; }
      // 1. Guardar localmente
      TS.setAdminCredentials('admin', p1);
      setLoggedIn();
      // 2. Iniciar Oracle y forzar push inmediato con la nueva contraseña
      TripsFirebase.init().then(function (ok) {
        window.__SA_FIREBASE_ACTIVE__ = !!ok;
        if (window.OracleSync) OracleSync.pushSite();
        startApp();
      });
    }
    if ($('su-btn'))  $('su-btn').addEventListener('click', doSetup);
    if ($('su-pass2')) $('su-pass2').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSetup(); });
  }

  function bootstrap() {
    // Sesión activa: entrar directo
    if (isLoggedIn()) {
      $('login-screen').style.display = 'none';
      TripsFirebase.init().then(function (ok) { window.__SA_FIREBASE_ACTIVE__ = !!ok; startApp(); });
      return;
    }

    // Mostrar "verificando…" mientras cargamos Oracle
    var screen = $('login-screen');
    if (screen) {
      var chk = document.createElement('p');
      chk.id = 'checking-msg';
      chk.style.cssText = 'color:rgba(255,255,255,.4);font-size:.8rem;text-align:center;margin-top:1.2rem;';
      chk.textContent = '🔄 Verificando credenciales en la nube…';
      screen.appendChild(chk);
    }

    // Cargar catalog.json desde Oracle para obtener la contraseña centralizada
    OracleSync.init().then(function () {
      var el = document.getElementById('checking-msg');
      if (el) el.remove();

      var pass = TS.getAdminCredentials().password;
      var hasCloudPass = typeof pass === 'string' && pass.length >= 6;

      if (!hasCloudPass) {
        // Nadie ha configurado contraseña → primer dispositivo ever
        showSetup();
        return;
      }

      // Ya hay contraseña en Oracle → mostrar login normal
      if ($('btn-login')) $('btn-login').addEventListener('click', tryLogin);
      if ($('l-pass'))    $('l-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); });
    });
  }

  window.AdminApp = { renderList: renderList, bootstrap: bootstrap };
})();

/* ── Barra de almacenamiento + límites Firebase gratuito ─────────────────── */
(function () {

  // ── Límites plan Spark (gratuito) de Firebase ──────────────────────────
  var STORAGE_QUOTA_BYTES  = 20  * 1024 * 1024 * 1024; // 20 GB Oracle Object Storage
  var STORAGE_WARN_PCT     = 80;   // advertencia en amarillo
  var STORAGE_BLOCK_PCT    = 95;   // bloqueo total — no más subidas
  var AVG_PHOTO_BYTES      = 400  * 1024; // ~400 KB promedio por foto real

  // Fallback localStorage (sin Firebase)
  var LS_QUOTA_BYTES       = 5   * 1024 * 1024; // 5 MB
  var LS_WARN_PCT          = 70;
  var LS_BLOCK_PCT         = 90;
  var LS_AVG_PHOTO_BYTES   = 60  * 1024; // 60 KB por foto comprimida

  var _open    = false;
  var _blocked = false; // true = subidas desactivadas

  /* ── helpers ──────────────────────────────────────────────────────────── */
  function fmt(b) {
    if (b < 1024)             return b + ' B';
    if (b < 1024*1024)        return (b/1024).toFixed(1) + ' KB';
    if (b < 1024*1024*1024)   return (b/(1024*1024)).toFixed(1) + ' MB';
    return (b/(1024*1024*1024)).toFixed(2) + ' GB';
  }

  function colorFor(pct, warnAt, blockAt) {
    if (pct >= blockAt) return 'linear-gradient(90deg,#dc2626,#ef4444)';
    if (pct >= warnAt)  return 'linear-gradient(90deg,#d97706,#F5B800)';
    return 'linear-gradient(90deg,#16a34a,#22c55e)';
  }

  function labelColor(pct, warnAt, blockAt) {
    if (pct >= blockAt) return '#f87171';
    if (pct >= warnAt)  return '#F5B800';
    return '#4ade80';
  }

  function countCloudPhotos() {
    var n = 0;
    try {
      var trips = window.TripsStore && window.TripsStore.getTrips ? window.TripsStore.getTrips() : [];
      trips.forEach(function (t) {
        var imgs = (t.images && t.images.length) ? t.images : (t.imageUrl ? [t.imageUrl] : []);
        imgs.forEach(function (u) { if (u && (u.indexOf('firebasestorage') !== -1 || u.indexOf('objectstorage') !== -1)) n++; });
      });
    } catch(e) {}
    return n;
  }

  function getLocalBytes() {
    var n = 0;
    try {
      for (var k in localStorage) {
        if (!localStorage.hasOwnProperty(k)) continue;
        var v = localStorage.getItem(k);
        if (v) n += (k.length + v.length) * 2;
      }
    } catch(e) {}
    return n;
  }

  function getLocalPhotoBytes() {
    var n = 0;
    try {
      for (var k in localStorage) {
        if (!localStorage.hasOwnProperty(k)) continue;
        var v = localStorage.getItem(k) || '';
        var m = v.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g);
        if (m) m.forEach(function(s){ n += Math.round(s.length * 0.75); });
      }
    } catch(e) {}
    return n;
  }

  /* ── bloqueo de UI ────────────────────────────────────────────────────── */
  function applyBlock(blocked, msg) {
    _blocked = blocked;
    var dz      = document.getElementById('dz');
    var pickBtn = document.getElementById('btn-pick');
    var fileIn  = document.getElementById('file-img');
    var addUrl  = document.getElementById('btn-add-url');
    var notice  = document.getElementById('storage-block-notice');

    if (blocked) {
      if (dz)      { dz.style.opacity = '0.4'; dz.style.pointerEvents = 'none'; dz.title = msg; }
      if (pickBtn) { pickBtn.disabled = true; pickBtn.title = msg; }
      if (fileIn)  { fileIn.disabled  = true; }
      if (addUrl)  { addUrl.disabled  = true; addUrl.title = msg; }
      if (notice)  { notice.textContent = msg; notice.style.display = 'block'; }
    } else {
      if (dz)      { dz.style.opacity = '1';   dz.style.pointerEvents = ''; dz.title = ''; }
      if (pickBtn) { pickBtn.disabled = false; pickBtn.title = ''; }
      if (fileIn)  { fileIn.disabled  = false; }
      if (addUrl)  { addUrl.disabled  = false; addUrl.title = ''; }
      if (notice)  { notice.style.display = 'none'; }
    }
  }

  /* ── actualizar barra ─────────────────────────────────────────────────── */
  function update() {
    var fill   = document.getElementById('storage-fill');
    var label  = document.getElementById('storage-label');
    var detail = document.getElementById('storage-detail');
    if (!fill || !label) return;

    var usingCloud = window.FirebaseStorage && window.FirebaseStorage.isReady();

    if (usingCloud) {
      var photoCount = countCloudPhotos();
      var usedBytes  = photoCount * AVG_PHOTO_BYTES;
      var quota      = STORAGE_QUOTA_BYTES;
      var pct        = Math.min(100, parseFloat(((usedBytes / quota) * 100).toFixed(2)));
      var pctDisplay = pct < 0.01 ? '< 0.01' : pct;
      var free       = Math.max(0, quota - usedBytes);
      var morePhotos = Math.floor(free / AVG_PHOTO_BYTES);

      fill.style.width      = Math.max(pct, 0.3) + '%';
      fill.style.background = colorFor(pct, STORAGE_WARN_PCT, STORAGE_BLOCK_PCT);
      label.style.color     = labelColor(pct, STORAGE_WARN_PCT, STORAGE_BLOCK_PCT);
      label.textContent     = '☁️ ' + pctDisplay + '% de 20 GB — ' + photoCount + ' foto' + (photoCount !== 1 ? 's' : '') + ' en la nube';

      if (detail) {
        detail.innerHTML =
          '☁️ <b>Oracle Object Storage</b> Free Tier &nbsp;|&nbsp; ' +
          '🖼 Fotos: <b>' + photoCount + '</b> (~' + fmt(usedBytes) + ' / 20 GB) &nbsp;|&nbsp; ' +
          '✅ Disponible: <b>' + fmt(free) + '</b> (~' + morePhotos.toLocaleString() + ' fotos más)';
      }

      // Bloquear si ≥ 95%
      if (pct >= STORAGE_BLOCK_PCT) {
        applyBlock(true, '🚫 Almacenamiento al ' + Math.round(pct) + '% — no se pueden subir más fotos. Elimina salidas antiguas o activa el plan de pago en Firebase.');
      } else if (pct >= STORAGE_WARN_PCT) {
        applyBlock(false);
        // Solo aviso visual, no bloqueo
        if (detail) detail.innerHTML += ' &nbsp;|&nbsp; <span style="color:#F5B800;font-weight:700;">⚠️ Almacenamiento al ' + Math.round(pct) + '% — considera limpiar fotos antiguas</span>';
      } else {
        applyBlock(false);
      }

    } else {
      // localStorage fallback
      var used     = getLocalBytes();
      var photos   = getLocalPhotoBytes();
      var lsPct    = Math.min(100, Math.round((used / LS_QUOTA_BYTES) * 100));
      var lsFree   = Math.max(0, LS_QUOTA_BYTES - used);
      var lsMore   = Math.floor(lsFree / LS_AVG_PHOTO_BYTES);

      fill.style.width      = Math.max(lsPct, 1) + '%';
      fill.style.background = colorFor(lsPct, LS_WARN_PCT, LS_BLOCK_PCT);
      label.style.color     = labelColor(lsPct, LS_WARN_PCT, LS_BLOCK_PCT);
      label.textContent     = '💾 ' + lsPct + '% local (' + fmt(used) + ' / 5 MB) — ~' + lsMore + ' fotos más';

      if (detail) {
        detail.innerHTML =
          '⚠️ <b>Sin almacenamiento en la nube</b> — datos en este navegador &nbsp;|&nbsp; ' +
          '🖼 Fotos locales: <b>' + fmt(photos) + '</b> &nbsp;|&nbsp; ' +
          '✅ Libre: <b>' + fmt(lsFree) + '</b>';
      }

      if (lsPct >= LS_BLOCK_PCT) {
        applyBlock(true, '🚫 Almacenamiento local al ' + lsPct + '% — no se pueden subir más fotos. Configura Oracle Object Storage para tener 20 GB gratis.');
      } else if (lsPct >= LS_WARN_PCT) {
        applyBlock(false);
        if (detail) detail.innerHTML += ' &nbsp;|&nbsp; <span style="color:#F5B800;font-weight:700;">⚠️ Espacio local casi lleno</span>';
      } else {
        applyBlock(false);
      }
    }
  }

  function toggle() {
    _open = !_open;
    var d = document.getElementById('storage-detail');
    if (d) d.style.display = _open ? 'block' : 'none';
  }

  /* ── función pública para verificar antes de subir ───────────────────── */
  function canUpload() { return !_blocked; }

  window.addEventListener('sa-trips-updated', update);
  window.addEventListener('sa-site-updated',  update);

  // Esperar a que Firebase esté listo antes de actualizar
  window.addEventListener('load', function () {
    var attempts = 0;
    var max = 20; // hasta 10 segundos
    function tryUpdate() {
      attempts++;
      var ready = window.FirebaseStorage && window.FirebaseStorage.isReady();
      if (ready || attempts >= max) {
        update();
      } else {
        setTimeout(tryUpdate, 500);
      }
    }
    setTimeout(tryUpdate, 800);
  });

  // También se puede llamar manualmente desde startApp
  window.StorageBar = { update: update, toggle: toggle, canUpload: canUpload };
})();

