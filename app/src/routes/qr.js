'use strict';

// Página a la que lleva el QR de cada equipo. Un operador con sesión iniciada
// salta directo a la ficha de la unidad en el panel; cualquier otra persona ve
// solo de qué equipo se trata y a quién devolverlo, nunca quién lo tiene.
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const equipos = require('../lib/equipos');
const { escapar: esc } = require('../lib/formato');

const router = express.Router();

const limite = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });

function pagina(titulo, cuerpo) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(titulo)} · LPT</title>
  <link rel="stylesheet" href="/css/estilos.css">
</head>
<body>
  <main class="contenedor qr-publico">
    <div class="tarjeta pila">${cuerpo}</div>
  </main>
</body>
</html>`;
}

router.get('/:token', limite, async (req, res, next) => {
  try {
    const u = await equipos.unidadPorToken(req.params.token);
    res.set('Cache-Control', 'no-store');
    if (!u) {
      return res.status(404).send(pagina('Etiqueta no válida', `
        <h1 class="h3">Etiqueta no válida</h1>
        <p>Este código QR no corresponde a ningún equipo registrado o fue reemplazado por una etiqueta nueva.</p>
        <p class="tenue">${esc(config.reglas.entidad)}</p>`));
    }
    if (req.session?.usuario) return res.redirect(`/admin/#unidad/${u.id}`);
    const contacto = config.mail.lpt[0];
    res.send(pagina(u.equipo_nombre, `
      <p class="sobretitulo">Equipo del LPT</p>
      <h1 class="h3">${esc(u.equipo_nombre)}</h1>
      <dl class="detalle">
        <dt>N° de inventario</dt><dd><b>${esc(u.inventario)}</b></dd>
        <dt>Categoría</dt><dd>${esc(u.categoria_nombre)}</dd>
      </dl>
      <p>Este equipo pertenece a la ${esc(config.reglas.entidad)}. Si lo encontraste, por favor llévalo al LPT${contacto ? ` o escribe a <a href="mailto:${esc(contacto)}">${esc(contacto)}</a>` : ''}.</p>
      <p><a class="boton boton-claro boton-sm" href="/admin/#qr/${esc(u.qr_token)}">Soy del LPT: abrir en el panel</a></p>`));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
