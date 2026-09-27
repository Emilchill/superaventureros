/**
 * seed-fallback.js  v3.1
 * Sin datos predeterminados. El catálogo arranca vacío.
 * Cuando Firebase está configurado, los viajes vienen de la nube.
 * Sin Firebase, el admin crea los viajes que se guardan en localStorage.
 */
window.__SA_SEED_DB__ = {
  version: 1,
  trips: []
};
