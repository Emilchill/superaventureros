/**
 * ─────────────────────────────────────────────────────────────────
 *  CONFIGURACIÓN DE ORACLE CLOUD OBJECT STORAGE — Super Aventureros RD
 * ─────────────────────────────────────────────────────────────────
 *
 *  Reemplaza firebase-config.js completamente.
 *  Usa Oracle Object Storage (Free Tier — 20 GB gratis permanente).
 *
 *  PAR_URL: Pre-Authenticated Request con permisos de lectura/escritura.
 *  BUCKET_PUBLIC_URL: URL pública del bucket (visibilidad Public).
 * ─────────────────────────────────────────────────────────────────
 */
window.__ORACLE_CONFIG__ = {
  // URL del Pre-Authenticated Request (PAR) — permite leer Y escribir
  PAR_URL: 'https://objectstorage.us-ashburn-1.oraclecloud.com/p/J2qLpMglja-Zdgc_b4S_muTcggp9zMW8bNA0JbW5xwYQg_MZ9pmQ1ZBVOlAZzq8D/n/idmibqnm89k8/b/superaventureros-rd/o/',

  // URL pública base del bucket (para leer imágenes sin autenticación)
  BUCKET_PUBLIC_URL: 'https://objectstorage.us-ashburn-1.oraclecloud.com/n/idmibqnm89k8/b/superaventureros-rd/o/',

  // Nombre del archivo JSON que actúa como base de datos
  DB_FILE: 'catalog.json',

  // Carpeta donde se guardan las fotos
  PHOTOS_FOLDER: 'fotos/',

  // Intervalo de polling en milisegundos (cada 15 seg sincroniza con el servidor)
  // Equivale al "tiempo real" de Firebase pero sin costo
  POLL_INTERVAL_MS: 15000
};
