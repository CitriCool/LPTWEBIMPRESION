'use strict';

// Inventario de equipos para préstamo. Se monta dentro del router del panel,
// después de exigir sesión: cualquier operador consulta, solo un admin modifica.
const express = require('express');
const equipos = require('../lib/equipos');

const router = express.Router();

function requiereAdmin(req, res, next) {
  if (req.session.usuario.rol === 'admin') return next();
  res.status(403).json({ error: 'Solo un administrador puede modificar el inventario.' });
}

// Envuelve un handler async para que sus errores lleguen al manejador central
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.get('/equipos/categorias', h(async (req, res) => res.json(await equipos.listarCategorias())));

router.post('/equipos/categorias', requiereAdmin, h(async (req, res) => {
  res.status(201).json({ id: await equipos.crearCategoria(req.body || {}) });
}));

router.put('/equipos/categorias/:id', requiereAdmin, h(async (req, res) => {
  await equipos.actualizarCategoria(Number(req.params.id), req.body || {});
  res.json({ ok: true });
}));

router.get('/equipos', h(async (req, res) => res.json(await equipos.listarEquipos())));

router.post('/equipos', requiereAdmin, h(async (req, res) => {
  res.status(201).json({ id: await equipos.crearEquipo(req.body || {}) });
}));

router.get('/equipos/:id', h(async (req, res) => {
  const e = await equipos.obtenerEquipo(Number(req.params.id));
  if (!e) return res.status(404).json({ error: 'Equipo no encontrado.' });
  res.json(e);
}));

router.put('/equipos/:id', requiereAdmin, h(async (req, res) => {
  await equipos.actualizarEquipo(Number(req.params.id), req.body || {});
  res.json({ ok: true });
}));

router.post('/equipos/:id/unidades', requiereAdmin, h(async (req, res) => {
  res.status(201).json({ id: await equipos.crearUnidad(Number(req.params.id), req.body || {}) });
}));

router.get('/equipos/:id/etiquetas', h(async (req, res) => {
  res.json(await equipos.etiquetas({ equipoId: Number(req.params.id) }));
}));

// Buscar por n° de inventario (escrito a mano) o por el token leído de un QR
router.get('/unidades/buscar', h(async (req, res) => {
  const u = req.query.qr
    ? await equipos.unidadPorToken(req.query.qr)
    : await equipos.unidadPorInventario(req.query.inventario);
  if (!u) return res.status(404).json({ error: 'No hay ninguna unidad con ese código.' });
  res.json({ id: u.id });
}));

async function cargarUnidad(req, res, next) {
  try {
    req.unidad = await equipos.obtenerUnidad(Number(req.params.id));
    if (!req.unidad) return res.status(404).json({ error: 'Unidad no encontrada.' });
    next();
  } catch (e) {
    next(e);
  }
}

router.get('/unidades/:id', cargarUnidad, h(async (req, res) => {
  const { qr_token, ...u } = req.unidad;
  res.json({ ...u, qr_url: equipos.urlQr(qr_token), qr_svg: await equipos.qrSvg(qr_token) });
}));

router.put('/unidades/:id', requiereAdmin, cargarUnidad, h(async (req, res) => {
  await equipos.actualizarUnidad(req.unidad, req.body || {});
  res.json({ ok: true });
}));

router.post('/unidades/:id/renovar-qr', requiereAdmin, cargarUnidad, h(async (req, res) => {
  await equipos.renovarQr(req.unidad.id);
  res.json({ ok: true });
}));

router.get('/unidades/:id/etiqueta', cargarUnidad, h(async (req, res) => {
  res.json(await equipos.etiquetas({ unidadId: req.unidad.id }));
}));

module.exports = router;
