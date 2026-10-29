'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { query, transaccion } = require('./db');
const { cotizar, sumarDiasHabiles, ErrorCotizacion } = require('./cotizador');
const { analizarPdf } = require('./pdf');
const config = require('../config');

const SELECT_PEDIDO = `
  SELECT p.*, sp.nombre AS papel_nombre, sp.codigo AS papel_codigo,
         e.codigo AS estado_codigo, e.nombre AS estado_nombre
  FROM cotizaciones_pedidos p
  JOIN servicios_papel sp ON sp.id = p.papel_id
  JOIN estados_pedido e ON e.id = p.estado_id`;

async function listarPapeles({ soloActivos = true } = {}) {
  return query(
    `SELECT id, codigo, nombre, descripcion, precio_m2, activo FROM servicios_papel
     ${soloActivos ? 'WHERE activo = 1' : ''} ORDER BY orden, id`
  );
}

async function obtenerPapel(codigo) {
  const [papel] = await query('SELECT * FROM servicios_papel WHERE codigo = ? AND activo = 1', [codigo]);
  if (!papel) throw new ErrorCotizacion('Seleccione un tipo de papel válido.');
  return papel;
}

async function listarEstados() {
  return query('SELECT * FROM estados_pedido ORDER BY orden');
}

/**
 * Crea un pedido a partir del PDF subido. Las medidas y el precio se
 * calculan en el servidor leyendo el propio PDF: lo que el cliente ve en el
 * cotizador es solo referencial.
 */
async function crearPedido({ cliente, papelCodigo, copias, archivo }) {
  const papel = await obtenerPapel(papelCodigo);
  const paginas = await analizarPdf(archivo.buffer);
  const cot = cotizar(paginas, papel.precio_m2, Number(copias || 1));

  const sha256 = crypto.createHash('sha256').update(archivo.buffer).digest('hex');
  const ahora = new Date();
  const subdir = String(ahora.getFullYear());
  const nombreInterno = `${subdir}/${crypto.randomUUID()}.pdf`;
  await fs.mkdir(path.join(config.uploadDir, subdir), { recursive: true });
  await fs.writeFile(path.join(config.uploadDir, nombreInterno), archivo.buffer, { flag: 'wx' });

  const entrega = sumarDiasHabiles(ahora, config.reglas.diasHabilesMax);
  const nombreOriginal = path.basename(archivo.originalname || 'archivo.pdf').slice(0, 255);

  try {
    const id = await transaccion(async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO cotizaciones_pedidos
          (codigo, cliente_nombre, cliente_rut, cliente_email, cliente_telefono, cliente_unidad, metodo_pago,
           papel_id, copias, paginas, ancho_m, alto_m, area_m2, precio_m2, total_clp, observaciones,
           archivo_nombre, archivo_ruta, archivo_bytes, archivo_sha256, estado_id, fecha_entrega_estimada)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          `TMP-${crypto.randomBytes(6).toString('hex')}`,
          cliente.nombre, cliente.rut, cliente.email, cliente.telefono, cliente.unidad, cliente.metodo_pago,
          papel.id, cot.copias, cot.paginas, cot.ancho_m, cot.alto_m, cot.area_m2, cot.precio_m2, cot.total_clp,
          cliente.observaciones, nombreOriginal, nombreInterno, archivo.buffer.length, sha256, entrega,
        ]
      );
      const codigo = `LPT-${ahora.getFullYear()}-${String(r.insertId).padStart(5, '0')}`;
      await conn.query('UPDATE cotizaciones_pedidos SET codigo = ? WHERE id = ?', [codigo, r.insertId]);
      await conn.query(
        'INSERT INTO historial_estados (pedido_id, estado_id, comentario) VALUES (?, 1, ?)',
        [r.insertId, 'Pedido recibido desde el formulario web']
      );
      return r.insertId;
    });
    return obtenerPedido(id);
  } catch (e) {
    await fs.unlink(path.join(config.uploadDir, nombreInterno)).catch(() => {});
    throw e;
  }
}

async function obtenerPedido(id) {
  const [p] = await query(`${SELECT_PEDIDO} WHERE p.id = ?`, [id]);
  return p || null;
}

async function buscarPorCodigoYEmail(codigo, email) {
  const [p] = await query(`${SELECT_PEDIDO} WHERE p.codigo = ? AND p.cliente_email = ?`, [
    String(codigo).trim().toUpperCase(),
    String(email).trim().toLowerCase(),
  ]);
  return p || null;
}

async function listarPedidos({ estado, pago, q, limite = 50, pagina = 1 }) {
  const where = [];
  const params = [];
  if (estado) {
    where.push('e.codigo = ?');
    params.push(estado);
  }
  if (pago) {
    where.push('p.pago_estado = ?');
    params.push(pago);
  }
  if (q) {
    where.push('(p.codigo LIKE ? OR p.cliente_nombre LIKE ? OR p.cliente_email LIKE ? OR p.cliente_rut LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : '';
  limite = Math.min(Math.max(Number(limite) || 50, 1), 200);
  const offset = (Math.max(Number(pagina) || 1, 1) - 1) * limite;

  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM cotizaciones_pedidos p JOIN estados_pedido e ON e.id = p.estado_id ${filtro}`,
    params
  );
  const filas = await query(`${SELECT_PEDIDO} ${filtro} ORDER BY p.creado_en DESC LIMIT ? OFFSET ?`, [
    ...params,
    limite,
    offset,
  ]);
  return { total, pagina: Math.floor(offset / limite) + 1, limite, pedidos: filas };
}

async function resumenEstados() {
  return query(
    `SELECT e.codigo, e.nombre, COUNT(p.id) AS cantidad, COALESCE(SUM(p.total_clp), 0) AS monto
     FROM estados_pedido e LEFT JOIN cotizaciones_pedidos p ON p.estado_id = e.id
     GROUP BY e.id ORDER BY e.orden`
  );
}

async function pagosPorRevisar() {
  const [{ cantidad }] = await query(
    `SELECT COUNT(*) AS cantidad FROM cotizaciones_pedidos p JOIN estados_pedido e ON e.id = p.estado_id
     WHERE p.pago_estado = 'por_revisar' AND e.es_final = 0`
  );
  return cantidad;
}

async function historial(pedidoId) {
  return query(
    `SELECT h.creado_en, h.comentario, e.nombre AS estado, u.nombre AS usuario
     FROM historial_estados h
     JOIN estados_pedido e ON e.id = h.estado_id
     LEFT JOIN usuarios u ON u.id = h.usuario_id
     WHERE h.pedido_id = ? ORDER BY h.creado_en, h.id`,
    [pedidoId]
  );
}

async function cambiarEstado(pedidoId, estadoId, usuarioId, comentario) {
  const [estado] = await query('SELECT * FROM estados_pedido WHERE id = ?', [estadoId]);
  if (!estado) throw new ErrorCotizacion('Estado inválido.');
  const [actual] = await query('SELECT pago_estado FROM cotizaciones_pedidos WHERE id = ?', [pedidoId]);
  if (actual && actual.pago_estado !== 'verificado' && config.reglas.estadosConPago.includes(estado.codigo)) {
    throw new ErrorCotizacion(`Verifique el pago antes de pasar el pedido a "${estado.nombre}".`);
  }
  await transaccion(async (conn) => {
    const [r] = await conn.query('UPDATE cotizaciones_pedidos SET estado_id = ? WHERE id = ?', [estadoId, pedidoId]);
    if (r.affectedRows === 0) throw Object.assign(new Error('Pedido no encontrado'), { status: 404, publico: true });
    await conn.query(
      'INSERT INTO historial_estados (pedido_id, estado_id, usuario_id, comentario) VALUES (?, ?, ?, ?)',
      [pedidoId, estadoId, usuarioId, comentario || null]
    );
  });
  return { pedido: await obtenerPedido(pedidoId), estado };
}

async function guardarNotas(pedidoId, notas) {
  await query('UPDATE cotizaciones_pedidos SET notas_internas = ? WHERE id = ?', [notas || null, pedidoId]);
}

function rutaSegura(relativa) {
  const ruta = path.resolve(config.uploadDir, relativa);
  if (!ruta.startsWith(path.resolve(config.uploadDir) + path.sep)) throw new Error('Ruta de archivo inválida');
  return ruta;
}

function rutaArchivo(pedido) {
  return rutaSegura(pedido.archivo_ruta);
}

function rutaComprobante(pedido) {
  return pedido.comprobante_ruta ? rutaSegura(pedido.comprobante_ruta) : null;
}

// Se reconoce el tipo por los primeros bytes, no por el nombre que envía el navegador
const TIPOS_COMPROBANTE = [
  { firma: Buffer.from('%PDF'), ext: 'pdf', mime: 'application/pdf' },
  { firma: Buffer.from([0xff, 0xd8, 0xff]), ext: 'jpg', mime: 'image/jpeg' },
  { firma: Buffer.from([0x89, 0x50, 0x4e, 0x47]), ext: 'png', mime: 'image/png' },
];

/** Puede subir comprobante mientras el pago no esté verificado y el pedido siga abierto. */
function aceptaComprobante(p) {
  return p.pago_estado !== 'verificado' && !['entregado', 'cancelado'].includes(p.estado_codigo);
}

async function guardarComprobante(pedido, archivo) {
  if (!aceptaComprobante(pedido)) {
    throw new ErrorCotizacion(
      pedido.pago_estado === 'verificado' ? 'El pago de este pedido ya fue verificado.' : 'Este pedido ya está cerrado.'
    );
  }
  const tipo = TIPOS_COMPROBANTE.find((t) => archivo.buffer.subarray(0, t.firma.length).equals(t.firma));
  if (!tipo) throw new ErrorCotizacion('El comprobante debe ser un PDF, JPG o PNG.');

  const subdir = `comprobantes/${new Date().getFullYear()}`;
  const nombreInterno = `${subdir}/${crypto.randomUUID()}.${tipo.ext}`;
  await fs.mkdir(path.join(config.uploadDir, subdir), { recursive: true });
  await fs.writeFile(path.join(config.uploadDir, nombreInterno), archivo.buffer, { flag: 'wx' });
  const nombreOriginal = path.basename(archivo.originalname || `comprobante.${tipo.ext}`).slice(0, 255);

  try {
    await transaccion(async (conn) => {
      await conn.query(
        `UPDATE cotizaciones_pedidos SET pago_estado = 'por_revisar', comprobante_nombre = ?, comprobante_ruta = ?,
           comprobante_mime = ?, comprobante_bytes = ?, comprobante_subido_en = NOW(),
           pago_revisado_por = NULL, pago_revisado_en = NULL, pago_comentario = NULL
         WHERE id = ?`,
        [nombreOriginal, nombreInterno, tipo.mime, archivo.buffer.length, pedido.id]
      );
      await conn.query(
        'INSERT INTO historial_estados (pedido_id, estado_id, comentario) VALUES (?, ?, ?)',
        [pedido.id, pedido.estado_id, 'El cliente subió el comprobante de pago']
      );
    });
  } catch (e) {
    await fs.unlink(path.join(config.uploadDir, nombreInterno)).catch(() => {});
    throw e;
  }
  // El comprobante anterior (si lo rechazaron o se reemplazó) ya no se necesita
  if (pedido.comprobante_ruta) await fs.unlink(rutaComprobante(pedido)).catch(() => {});
  return obtenerPedido(pedido.id);
}

async function revisarPago(pedido, verificado, usuarioId, comentario) {
  if (!verificado && !comentario) throw new ErrorCotizacion('Indique al cliente el motivo del rechazo.');
  if (!verificado && pedido.pago_estado !== 'por_revisar') throw new ErrorCotizacion('No hay un comprobante por revisar.');
  await transaccion(async (conn) => {
    await conn.query(
      `UPDATE cotizaciones_pedidos SET pago_estado = ?, pago_revisado_por = ?, pago_revisado_en = NOW(), pago_comentario = ?
       WHERE id = ?`,
      [verificado ? 'verificado' : 'rechazado', usuarioId, comentario || null, pedido.id]
    );
    await conn.query(
      'INSERT INTO historial_estados (pedido_id, estado_id, usuario_id, comentario) VALUES (?, ?, ?, ?)',
      [
        pedido.id,
        pedido.estado_id,
        usuarioId,
        verificado ? `Pago verificado${comentario ? `: ${comentario}` : ''}` : `Comprobante rechazado: ${comentario}`,
      ]
    );
  });
  return obtenerPedido(pedido.id);
}

async function actualizarPapel(id, { precio_m2, activo, descripcion }) {
  const precio = Number(precio_m2);
  if (!Number.isInteger(precio) || precio <= 0 || precio > 1_000_000) {
    throw new ErrorCotizacion('El precio debe ser un entero positivo en CLP.');
  }
  await query('UPDATE servicios_papel SET precio_m2 = ?, activo = ?, descripcion = ? WHERE id = ?', [
    precio,
    activo ? 1 : 0,
    String(descripcion ?? '').slice(0, 255) || null,
    id,
  ]);
}

module.exports = {
  listarPapeles,
  obtenerPapel,
  listarEstados,
  crearPedido,
  obtenerPedido,
  buscarPorCodigoYEmail,
  listarPedidos,
  resumenEstados,
  pagosPorRevisar,
  historial,
  cambiarEstado,
  guardarNotas,
  rutaArchivo,
  rutaComprobante,
  aceptaComprobante,
  guardarComprobante,
  revisarPago,
  actualizarPapel,
};
