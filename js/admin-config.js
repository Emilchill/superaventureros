/**
 * admin-config.js
 * NO almacena credenciales. La contraseña se configura en el primer acceso
 * y se guarda únicamente en localStorage (sa_admin_creds_v3).
 * Para resetear: borrar la clave "sa_admin_creds_v3" desde DevTools > Application > Storage.
 */
window.__ADMIN_DEFAULTS__ = {
  user: 'admin',
  password: ''   // vacío a propósito — se pide en el primer acceso
};
