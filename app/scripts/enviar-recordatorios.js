'use strict';

// Uso: docker compose exec app npm run recordatorios
// Envía ahora los recordatorios de devolución que tocan hoy (la app también lo
// hace sola cada 15 minutos desde PRESTAMO_RECORDATORIO_HORA). Nunca repite uno.
const recordatorios = require('../src/lib/recordatorios');
const db = require('../src/lib/db');

recordatorios
  .enviarPendientes()
  .then((n) => console.log(n ? `Recordatorios enviados: ${n}.` : 'No hay recordatorios pendientes para hoy.'))
  .catch((e) => {
    console.error('Error:', e.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
