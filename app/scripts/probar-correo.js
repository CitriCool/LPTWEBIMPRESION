'use strict';

// Uso: docker compose exec app npm run probar-correo -- [destino@uct.cl]
// Sin destino, envía la prueba a los correos de MAIL_LPT.
const config = require('../src/config');
const mailer = require('../src/lib/mailer');

async function main() {
  const destino = process.argv[2] || config.mail.lpt.join(',');
  const error = await mailer.verificar();
  if (error) throw new Error(error);

  const info = await mailer.enviar({
    to: destino,
    subject: 'Prueba de correo - Servicio de Impresión LPT',
    html: mailer.plantilla('Prueba de correo', '<p>Si lees esto, los avisos de pedidos nuevos y de cambios de estado están funcionando.</p>'),
    text: 'Si lees esto, los avisos del Servicio de Impresión LPT están funcionando.',
  });
  if (!info) throw new Error('El servidor SMTP rechazó el envío (revise el log de arriba).');
  console.log(`Correo de prueba enviado a ${destino}.`);
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exitCode = 1;
});
