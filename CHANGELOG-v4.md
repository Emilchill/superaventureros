# v4.0 — Editor de asientos + Reseñas

## Asientos (admin)
- Se puede diseñar el mapa **sin guardar la salida primero** (antes era obligatorio).
- Capacidad y distribución editables dentro del propio editor: 2+2, 2+1, 1+2, 3+2, 2+3, 1+1 y "última fila corrida".
- Nuevo estado **Bloqueado** (además de disponible / reservado / ocupado).
- Herramientas: arrastrar para pintar, tocar el número de fila, rangos ("1-10, 15, 20-22"), aplicar a todos, **deshacer/rehacer** (Ctrl+Z / Ctrl+Y).
- Indicador de cambios sin guardar, confirmación al cerrar, barra de ocupación y resumen en el formulario.
- Accesible por teclado; soporte táctil/mouse con Pointer Events.
- Admin y catálogo comparten `js/seat-map.js` → siempre se ven idénticos.
- Retrocompatible: salidas viejas se ven igual (2+2). Se podan automáticamente asientos fuera de capacidad.

## Reseñas (catálogo)
- Cada salida: promedio, distribución por estrellas, lista ("ver más") y formulario (nombre, correo, 1-5 ★, comentario).
- Puntuación promedio visible en la tarjeta de cada salida.
- Admin: botón ⭐ por salida para ver y eliminar reseñas (moderación). Al borrar una salida se borran sus reseñas.
- Guardado en `reviews/<idSalida>.json` (archivo aparte → no pisa `catalog.json`). Sin Oracle: localStorage.
- Anti-spam: honeypot, tiempo mínimo, 1 reseña por navegador y por correo/salida, límites de longitud.
- Todo el texto se escapa (sin XSS).
- **Privacidad:** el correo NO se guarda completo (solo enmascarado `an***@mail.com` + hash).

## Archivos
Nuevos: `js/seat-map.js`, `js/reviews-store.js`
Modificados: `js/admin.js`, `js/catalog.js`, `js/trips-store.js`, `admin/index.html`, `index.html`
