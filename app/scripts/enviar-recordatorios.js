'use strict';

// Uso: docker compose exec app npm run recordatorios
// Envía ahora los recordatorios de devolución que tocan hoy (la app también lo
// hace sola cada 15 minutos desde PRESTAMO_RECORDATORIO_HORA). Nunca repite uno.
const config = require('../src/config');
const recordatorios = require('../src/lib/recordatorios');
const db = require('../src/lib/db');

async function main() {
  if (!config.mail.host) {
    console.error('SMTP_HOST no está configurado: no se puede enviar ningún recordatorio.');
    process.exitCode = 1;
    return;
  }
  const n = await recordatorios.enviarPendientes();
  console.log(n ? `Recordatorios enviados: ${n}.` : 'No hay recordatorios pendientes (o falló el envío: revise el log).');
}

main()
  .catch((e) => {
    console.error('Error:', e.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
