'use strict';

const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const pedidos = require('../lib/pedidos');
const mailer = require('../lib/mailer');
const { cotizar, ErrorCotizacion } = require('../lib/cotizador');
const { validarCliente } = require('../lib/validacion');

const router = express.Router();
const { reglas } = config;

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: reglas.maxBytes, files: 1, fields: 20 },
  fileFilter(req, file, cb) {
    const esPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    cb(esPdf ? null : new ErrorCotizacion('Solo se aceptan archivos en formato PDF.'), esPdf);
  },
});

const TIPOS_COMPROBANTE = /\.(pdf|jpe?g|png)$/i;
const subidaComprobante = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: reglas.comprobanteMaxBytes, files: 1, fields: 5 },
  fileFilter(req, file, cb) {
    const valido = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype) || TIPOS_COMPROBANTE.test(file.originalname);
    cb(valido ? null : new ErrorCotizacion('El comprobante debe ser un PDF, JPG o PNG.'), valido);
  },
});

const limitePedidos = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos desde esta conexión. Intente nuevamente en una hora.' },
});

const limiteConsultas = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });

/** Datos públicos para armar la página: papeles, tarifas y reglas. */
router.get('/config', async (req, res, next) => {
  try {
    res.json({
      entidad: reglas.entidad,
      papeles: (await pedidos.listarPapeles()).map(({ codigo, nombre, descripcion, precio_m2 }) => ({
        codigo, nombre, descripcion, precio_m2,
      })),
      reglas: {
        maxMb: reglas.maxBytes / 1024 / 1024,
        anchoMaxCm: reglas.anchoMaxM * 100,
        maxPaginas: reglas.maxPaginas,
        maxCopias: reglas.maxCopias,
        diasHabiles: `${reglas.diasHabilesMin} a ${reglas.diasHabilesMax}`,
        scc: reglas.scc,
        metodosPago: reglas.metodosPago,
        correos: config.mail.lpt,
        comprobanteMaxMb: reglas.comprobanteMaxBytes / 1024 / 1024,
      },
    });
  } catch (e) {
    next(e);
  }
});

/** Cotización por medidas ingresadas a mano (ancho y alto en cm). */
router.post('/cotizar', limiteConsultas, async (req, res, next) => {
  try {
    const { papel, ancho_cm, alto_cm, copias } = req.body || {};
    const sp = await pedidos.obtenerPapel(papel);
    const cot = cotizar([{ ancho_m: Number(ancho_cm) / 100, alto_m: Number(alto_cm) / 100 }], sp.precio_m2, Number(copias || 1));
    res.json({ ...cot, papel: sp.nombre });
  } catch (e) {
    next(e);
  }
});

/** Recepción del pedido con su PDF. */
router.post('/pedidos', limitePedidos, (req, res, next) => {
  subida.single('archivo')(req, res, async (err) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') throw new ErrorCotizacion(`El archivo supera el máximo de ${reglas.maxBytes / 1024 / 1024} MB.`);
        throw err;
      }
      if (!req.file) throw new ErrorCotizacion('Adjunte el archivo PDF a imprimir.');

      const cliente = validarCliente(req.body);
      const pedido = await pedidos.crearPedido({
        cliente,
        papelCodigo: req.body.papel,
        copias: req.body.copias,
        archivo: req.file,
      });

      // Los correos se envían en segundo plano para no hacer esperar al cliente
      mailer.pedidoRecibido(pedido, req.file.buffer).catch((e) => console.error(e));

      res.status(201).json({
        codigo: pedido.codigo,
        papel: pedido.papel_nombre,
        paginas: pedido.paginas,
        copias: pedido.copias,
        ancho_m: pedido.ancho_m,
        alto_m: pedido.alto_m,
        area_m2: pedido.area_m2,
        total_clp: pedido.total_clp,
        metodo_pago: pedido.metodo_pago,
        metodo_pago_nombre: reglas.metodosPago[pedido.metodo_pago],
        fecha_entrega_estimada: pedido.fecha_entrega_estimada,
        instrucciones_pago: mailer.instruccionesPago(pedido.metodo_pago, pedido.codigo),
        email: pedido.cliente_email,
      });
    } catch (e) {
      next(e);
    }
  });
});

/** Seguimiento público: requiere código + correo del cliente. */
router.post('/seguimiento', limiteConsultas, async (req, res, next) => {
  try {
    const { codigo, email } = req.body || {};
    const p = codigo && email ? await pedidos.buscarPorCodigoYEmail(codigo, email) : null;
    if (!p) return res.status(404).json({ error: 'No encontramos un pedido con ese código y correo.' });
    const hist = await pedidos.historial(p.id);
    res.json({
      codigo: p.codigo,
      estado: p.estado_nombre,
      estado_codigo: p.estado_codigo,
      papel: p.papel_nombre,
      total_clp: p.total_clp,
      creado_en: p.creado_en,
      fecha_entrega_estimada: p.fecha_entrega_estimada,
      metodo_pago_nombre: reglas.metodosPago[p.metodo_pago],
      instrucciones_pago: mailer.instruccionesPago(p.metodo_pago, p.codigo),
      pago_estado: p.pago_estado,
      pago_comentario: p.pago_estado === 'rechazado' ? p.pago_comentario : null,
      comprobante_nombre: p.comprobante_nombre,
      acepta_comprobante: pedidos.aceptaComprobante(p),
      historial: hist.map((h) => ({ fecha: h.creado_en, estado: h.estado })),
    });
  } catch (e) {
    next(e);
  }
});

/** El cliente sube la boleta o comprobante de traspaso, identificándose con código + correo. */
router.post('/pedidos/comprobante', limitePedidos, (req, res, next) => {
  subidaComprobante.single('archivo')(req, res, async (err) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') throw new ErrorCotizacion(`El comprobante supera el máximo de ${reglas.comprobanteMaxBytes / 1024 / 1024} MB.`);
        throw err;
      }
      const { codigo, email } = req.body || {};
      const p = codigo && email ? await pedidos.buscarPorCodigoYEmail(codigo, email) : null;
      if (!p) return res.status(404).json({ error: 'No encontramos un pedido con ese código y correo.' });
      if (!req.file) throw new ErrorCotizacion('Adjunte la boleta o el comprobante de pago.');

      const actualizado = await pedidos.guardarComprobante(p, req.file);
      mailer.comprobanteRecibido(actualizado, req.file.buffer).catch((e) => console.error(e));
      res.status(201).json({ ok: true, pago_estado: actualizado.pago_estado });
    } catch (e) {
      next(e);
    }
  });
});

module.exports = router;
