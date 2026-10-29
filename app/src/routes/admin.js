'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const pedidos = require('../lib/pedidos');
const usuarios = require('../lib/usuarios');
const mailer = require('../lib/mailer');
const { limpiar } = require('../lib/validacion');

const router = express.Router();

const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espere 15 minutos.' },
});

function requiereSesion(req, res, next) {
  if (req.session && req.session.usuario) return next();
  res.status(401).json({ error: 'Sesión no iniciada.' });
}

function requiereAdmin(req, res, next) {
  if (req.session.usuario.rol === 'admin') return next();
  res.status(403).json({ error: 'Solo un administrador puede hacer esto.' });
}

// Las acciones que modifican datos solo aceptan JSON: junto con la cookie
// SameSite=Strict evita que otro sitio las dispare con un formulario (CSRF).
function soloJson(req, res, next) {
  if (['GET', 'HEAD'].includes(req.method) || req.is('application/json')) return next();
  res.status(415).json({ error: 'Se esperaba JSON.' });
}

router.use(soloJson);

router.post('/login', limiteLogin, async (req, res, next) => {
  try {
    const u = await usuarios.autenticar(req.body?.email, req.body?.password);
    if (!u) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    req.session.usuario = u;
    res.json(u);
  } catch (e) {
    next(e);
  }
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.use(requiereSesion);

router.get('/me', (req, res) => res.json(req.session.usuario));

router.get('/resumen', async (req, res, next) => {
  try {
    res.json({ estados: await pedidos.resumenEstados() });
  } catch (e) {
    next(e);
  }
});

router.get('/estados', async (req, res, next) => {
  try {
    res.json(await pedidos.listarEstados());
  } catch (e) {
    next(e);
  }
});

router.get('/pedidos', async (req, res, next) => {
  try {
    res.json(
      await pedidos.listarPedidos({
        estado: limpiar(req.query.estado, 30) || null,
        q: limpiar(req.query.q, 80) || null,
        pagina: req.query.pagina,
        limite: req.query.limite,
      })
    );
  } catch (e) {
    next(e);
  }
});

async function cargarPedido(req, res, next) {
  try {
    const p = await pedidos.obtenerPedido(Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'Pedido no encontrado.' });
    req.pedido = p;
    next();
  } catch (e) {
    next(e);
  }
}

router.get('/pedidos/:id', cargarPedido, async (req, res, next) => {
  try {
    const { archivo_ruta, ...p } = req.pedido;
    res.json({ ...p, historial: await pedidos.historial(p.id) });
  } catch (e) {
    next(e);
  }
});

router.get('/pedidos/:id/archivo', cargarPedido, (req, res, next) => {
  const p = req.pedido;
  const nombre = `${p.codigo}_${p.archivo_nombre}`.replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '_');
  res.download(pedidos.rutaArchivo(p), nombre, { headers: { 'Content-Type': 'application/pdf' } }, (err) => {
    if (err && !res.headersSent) next(Object.assign(new Error('El archivo ya no está disponible.'), { status: 404, publico: true }));
  });
});

router.patch('/pedidos/:id/estado', cargarPedido, async (req, res, next) => {
  try {
    const estadoId = Number(req.body?.estado_id);
    const comentario = limpiar(req.body?.comentario, 500) || null;
    const notificar = req.body?.notificar_cliente !== false;
    const { pedido, estado } = await pedidos.cambiarEstado(req.pedido.id, estadoId, req.session.usuario.id, comentario);
    mailer.cambioEstado(pedido, estado, comentario, notificar && estado.notifica_cliente).catch((e) => console.error(e));
    res.json({ ok: true, estado: estado.nombre });
  } catch (e) {
    next(e);
  }
});

router.patch('/pedidos/:id/notas', cargarPedido, async (req, res, next) => {
  try {
    await pedidos.guardarNotas(req.pedido.id, String(req.body?.notas ?? '').slice(0, 5000));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/papeles', async (req, res, next) => {
  try {
    res.json(await pedidos.listarPapeles({ soloActivos: false }));
  } catch (e) {
    next(e);
  }
});

router.put('/papeles/:id', requiereAdmin, async (req, res, next) => {
  try {
    await pedidos.actualizarPapel(Number(req.params.id), req.body || {});
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/usuarios', requiereAdmin, async (req, res, next) => {
  try {
    const { nombre, email, password, rol } = req.body || {};
    await usuarios.crearUsuario({ nombre, email, password, rol: rol === 'admin' ? 'admin' : 'operador' });
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') e = Object.assign(new Error('Ya existe un usuario con ese correo.'), { status: 409, publico: true });
    else if (!e.code) Object.assign(e, { status: 400, publico: true });
    next(e);
  }
});

module.exports = router;
