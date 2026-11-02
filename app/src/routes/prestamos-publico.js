'use strict';

// Préstamo de equipos en el sitio público: catálogo, disponibilidad,
// solicitud y "Mi préstamo" (identificándose con código + correo).
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const prestamos = require('../lib/prestamos');
const mailer = require('../lib/mailer');

const router = express.Router();

const limiteConsultas = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
const limiteSolicitudes = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes desde esta conexión. Intente nuevamente en una hora.' },
});

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.get('/catalogo', h(async (req, res) => {
  res.json({
    equipos: await prestamos.catalogo(),
    reglas: {
      dominios: config.prestamos.dominios,
      anticipacionMaxDias: config.prestamos.anticipacionMaxDias,
      hoy: prestamos.hoy(),
      correos: config.mail.lpt,
    },
  });
}));

router.get('/disponibilidad', limiteConsultas, h(async (req, res) => {
  const equipo = await prestamos.equipoPrestable(Number(req.query.equipo));
  if (!equipo) return res.status(404).json({ error: 'Ese equipo no está disponible para préstamo.' });
  const desde = String(req.query.desde || '');
  const hasta = String(req.query.hasta || '');
  const f = prestamos.validarFechas(desde, hasta, equipo.dias_max);
  if (f.error) return res.json({ error: f.error });
  res.json({ dias: f.dias, total_clp: f.dias * equipo.tarifa_dia_clp, disponibles: await prestamos.disponibles(equipo.id, desde, hasta) });
}));

router.post('/', limiteSolicitudes, h(async (req, res) => {
  const p = await prestamos.crearSolicitud(req.body || {});
  mailer.prestamoRecibido(p).catch((e) => console.error(e));
  res.status(201).json({ codigo: p.codigo, email: p.solicitante_email });
}));

function vistaPublica(p) {
  return {
    codigo: p.codigo,
    estado: p.estado,
    estado_nombre: prestamos.ESTADOS[p.estado],
    equipo: p.equipo_nombre,
    marca_modelo: p.marca_modelo,
    inventario: p.unidad_inventario,
    fecha_desde: p.fecha_desde,
    fecha_hasta: p.fecha_hasta,
    total_clp: p.total_clp,
    garantia: p.garantia,
    accesorios: p.accesorios,
    retiro_en: p.estado === 'aprobado' ? p.retiro_en : null,
    retiro_lugar: p.estado === 'aprobado' ? p.retiro_lugar : null,
    comentario_lpt: p.comentario_lpt,
    cancelable: ['solicitado', 'aprobado'].includes(p.estado),
  };
}

async function cargar(req, res, next) {
  try {
    const { codigo, email } = req.body || {};
    req.prestamo = codigo && email ? await prestamos.buscarPorCodigoYEmail(codigo, email) : null;
    if (!req.prestamo) return res.status(404).json({ error: 'No encontramos un préstamo con ese código y correo.' });
    next();
  } catch (e) {
    next(e);
  }
}

router.post('/consulta', limiteConsultas, cargar, (req, res) => res.json(vistaPublica(req.prestamo)));

router.post('/cancelar', limiteConsultas, cargar, h(async (req, res) => {
  const p = await prestamos.cancelarPorSolicitante(req.prestamo);
  mailer.prestamoCancelado(p).catch((e) => console.error(e));
  res.json(vistaPublica(p));
}));

module.exports = router;
