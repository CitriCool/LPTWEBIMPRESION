'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieSession = require('cookie-session');
const config = require('./config');
const db = require('./lib/db');
const usuarios = require('./lib/usuarios');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // detrás de Caddy / Nginx

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        // pdf-lib en el navegador usa Web Workers/Blob para leer el PDF
        workerSrc: ["'self'", 'blob:'],
        upgradeInsecureRequests: config.session.secure ? [] : null,
      },
    },
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(
  cookieSession({
    name: 'lpt_sesion',
    keys: [config.session.secret],
    httpOnly: true,
    sameSite: 'strict',
    secure: config.session.secure,
    maxAge: 8 * 60 * 60 * 1000,
  })
);

app.get('/salud', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api', require('./routes/publico'));
app.use('/admin/api', require('./routes/admin'));

// pdf-lib en el navegador: lee las medidas del PDF antes de enviarlo
app.get('/vendor/pdf-lib.min.js', (req, res) =>
  res.sendFile(require.resolve('pdf-lib/dist/pdf-lib.min.js'), { maxAge: '7d' })
);
// no-cache: el navegador revalida con ETag (respuesta 304 si no cambió), así una
// actualización del sitio o del panel se ve de inmediato sin Ctrl+F5
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    extensions: ['html'],
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  })
);

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use('/admin/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// Manejo central de errores: solo los errores marcados como públicos muestran su mensaje
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: err.publico ? err.message : status === 400 ? 'Solicitud inválida.' : 'Error interno. Intente nuevamente.',
    ...(err.errores ? { errores: err.errores } : {}),
  });
});

async function iniciar() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  await db.esperarConexion();
  await require('./lib/migraciones').migrar();
  await usuarios.asegurarAdmin(config.admin);
  const errorCorreo = await require('./lib/mailer').verificar();
  console.log(errorCorreo ? `Aviso de correo: ${errorCorreo}` : `Correo SMTP listo; avisos de pedidos nuevos a ${config.mail.lpt.join(', ')}`);
  app.listen(config.port, () => console.log(`Servicio de impresión LPT escuchando en el puerto ${config.port}`));
}

if (require.main === module) {
  iniciar().catch((e) => {
    console.error('No se pudo iniciar:', e);
    process.exit(1);
  });
}

module.exports = app;
