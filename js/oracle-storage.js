/**
 * oracle-storage.js  v1.0
 * ─────────────────────────────────────────────────────────────────
 *  Reemplaza firebase-storage.js
 *
 *  Sube imágenes a Oracle Object Storage usando el PAR (Pre-Authenticated
 *  Request) y devuelve URLs públicas permanentes.
 *
 *  Si Oracle no está disponible, devuelve el base64 como fallback
 *  (igual que antes con Firebase).
 * ─────────────────────────────────────────────────────────────────
 */
(function (global) {

  /* ── Helpers ──────────────────────────────────────────────────── */

  function cfg() {
    return global.__ORACLE_CONFIG__ || null;
  }

  function ready() {
    var c = cfg();
    return c && c.PAR_URL && c.PAR_URL.indexOf('objectstorage') !== -1;
  }

  /**
   * Convierte un dataURL base64 a Blob
   */
  function dataUrlToBlob(dataUrl) {
    var parts  = dataUrl.split(',');
    var mime   = parts[0].match(/:(.*?);/)[1];
    var binary = atob(parts[1]);
    var arr    = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function mimeToExt(mime) {
    var map = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
                'image/gif': 'gif', 'image/webp': 'webp' };
    return map[mime] || 'jpg';
  }

  /* ── Upload de una imagen ─────────────────────────────────────── */

  /**
   * Sube una imagen (dataURL o File) a Oracle Object Storage.
   * Retorna Promise<string> con la URL pública permanente.
   * Si falla o no está configurado, retorna el dataUrl original (fallback).
   *
   * @param {string|File} dataUrlOrFile
   * @param {function}    onProgress  — callback(pct: 0-100)
   * @returns {Promise<string>}
   */
  function uploadImage(dataUrlOrFile, onProgress) {
    return new Promise(function (resolve) {

      if (!ready()) {
        // Sin Oracle configurado: devuelve base64 tal como estaba
        resolve(typeof dataUrlOrFile === 'string' ? dataUrlOrFile : null);
        return;
      }

      try {
        var blob, mime, ext, fileName;
        var c = cfg();

        if (typeof dataUrlOrFile === 'string') {
          // Es un dataURL base64
          blob  = dataUrlToBlob(dataUrlOrFile);
          mime  = blob.type;
          ext   = mimeToExt(mime);
        } else {
          // Es un File directo
          blob  = dataUrlOrFile;
          mime  = dataUrlOrFile.type || 'image/jpeg';
          ext   = (dataUrlOrFile.name || 'img').split('.').pop() || 'jpg';
        }

        // Nombre único dentro de la carpeta fotos/
        fileName = c.PHOTOS_FOLDER + Date.now() + '_' +
                   Math.random().toString(36).slice(2, 8) + '.' + ext;

        var uploadUrl = c.PAR_URL + encodeURIComponent(fileName);

        // Oracle Object Storage acepta PUT para subir objetos
        var xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', mime);

        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable && typeof onProgress === 'function') {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            // URL pública permanente (sin autenticación)
            var publicUrl = c.BUCKET_PUBLIC_URL + encodeURIComponent(fileName);
            resolve(publicUrl);
          } else {
            console.error('[OS] upload HTTP error:', xhr.status, xhr.statusText);
            // Fallback a base64
            resolve(typeof dataUrlOrFile === 'string' ? dataUrlOrFile : null);
          }
        };

        xhr.onerror = function () {
          console.error('[OS] upload network error');
          resolve(typeof dataUrlOrFile === 'string' ? dataUrlOrFile : null);
        };

        if (typeof onProgress === 'function') onProgress(5);
        xhr.send(blob);

      } catch (e) {
        console.error('[OS] uploadImage exception:', e);
        resolve(typeof dataUrlOrFile === 'string' ? dataUrlOrFile : null);
      }
    });
  }

  /* ── Eliminar imagen ──────────────────────────────────────────── */

  /**
   * Elimina una imagen de Oracle Object Storage dado su URL público.
   * Silencioso si falla (puede ser una URL externa o base64).
   *
   * @param {string} url
   */
  function deleteImage(url) {
    if (!ready() || !url) return;
    var c = cfg();
    // Solo intentar borrar si es una URL de nuestro bucket
    if (url.indexOf(c.BUCKET_PUBLIC_URL) === -1 &&
        url.indexOf('objectstorage.us-ashburn-1.oraclecloud.com') === -1) return;

    try {
      // Extraer el nombre del archivo de la URL pública
      var fileName = decodeURIComponent(url.replace(c.BUCKET_PUBLIC_URL, ''));
      var deleteUrl = c.PAR_URL + encodeURIComponent(fileName);

      var xhr = new XMLHttpRequest();
      xhr.open('DELETE', deleteUrl, true);
      xhr.send();
    } catch (e) {
      // Silencioso
    }
  }

  /* ── Upload múltiple ──────────────────────────────────────────── */

  /**
   * Sube múltiples imágenes en paralelo.
   * onProgress(index, pct) — progreso individual por imagen.
   * Retorna Promise<string[]> con las URLs finales.
   *
   * @param {Array<string|File>} dataUrls
   * @param {function}           onProgress
   * @returns {Promise<string[]>}
   */
  function uploadImages(dataUrls, onProgress) {
    if (!dataUrls || !dataUrls.length) return Promise.resolve([]);
    var promises = dataUrls.map(function (d, i) {
      return uploadImage(d, function (pct) {
        if (typeof onProgress === 'function') onProgress(i, pct);
      });
    });
    return Promise.all(promises).then(function (urls) {
      return urls.filter(Boolean);
    });
  }

  /* ── API pública (mismo contrato que FirebaseStorage) ─────────── */

  global.OracleStorage = {
    upload:      uploadImage,
    uploadMany:  uploadImages,
    deleteImage: deleteImage,
    isReady:     ready
  };

  // Alias para que el código existente que llama FirebaseStorage siga funcionando
  global.FirebaseStorage = global.OracleStorage;

})(typeof window !== 'undefined' ? window : this);
