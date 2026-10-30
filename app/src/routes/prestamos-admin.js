'use strict';

// Solicitudes de préstamo en el panel: cualquier usuario del LPT las acepta o rechaza.
const express = require('express');
const config = require('../config');
const prestamos = require('../lib/prestamos');
const mailer = require('../lib/mailer');
const { limpiar } = require('../lib/validacion');

const router = express.Router();

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.get('/prestamos/resumen', h(async (req, res) => res.json(await prestamos.resumen())));

router.get('/prestamos', h(async (req, res) => {
  res.json(await prestamos.listar({ estado: limpiar(req.query.estado, 20) || null, q: limpiar(req.query.q, 80) || null }));
}));

async function cargar(req, res, next) {
  try {
    req.prestamo = await prestamos.obtener(Number(req.params.id));
    if (!req.prestamo) return res.status(404).json({ error: 'Préstamo no encontrado.' });
    next();
  } catch (e) {
    next(e);
  }
}

router.get('/prestamos/:id', cargar, h(async (req, res) => {
  const p = req.prestamo;
  const [movimientos, libres] = await Promise.all([
    prestamos.movimientos(p.id),
    p.estado === 'solicitado' ? prestamos.unidadesLibres(p) : [],
  ]);
  res.json({ ...p, movimientos, unidades_libres: libres, lugar_retiro: config.prestamos.lugarRetiro });
}));

router.post('/prestamos/:id/aprobar', cargar, h(async (req, res) => {
  const p = await prestamos.aprobar(req.prestamo.id, req.body || {}, req.session.usuario.id);
  mailer.prestamoAprobado(p).catch((e) => console.error(e));
  res.json({ ok: true });
}));

router.post('/prestamos/:id/rechazar', cargar, h(async (req, res) => {
  const p = await prestamos.rechazar(req.prestamo, req.body?.comentario, req.session.usuario.id);
  mailer.prestamoRechazado(p).catch((e) => console.error(e));
  res.json({ ok: true, estado: p.estado });
}));

module.exports = router;
