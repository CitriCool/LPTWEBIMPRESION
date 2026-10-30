'use strict';

const crypto = require('crypto');
const QRCode = require('qrcode');
const { query } = require('./db');
const { ErrorValidacion, limpiar } = require('./validacion');
const config = require('../config');

const ESTADOS_UNIDAD = {
  disponible: 'Disponible',
  prestado: 'Prestado',
  mantencion: 'En mantención',
  baja: 'De baja',
};
// "Prestado" lo marcan la entrega y la devolución, no la edición manual
const ESTADOS_MANUALES = ['disponible', 'mantencion', 'baja'];
const INVENTARIO = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/;

function errorPublico(mensaje, status) {
  return Object.assign(new Error(mensaje), { status, publico: true });
}

function entero(v, min, max) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Token del QR: 12 caracteres al azar (72 bits), imposible de adivinar. */
function nuevoToken() {
  return crypto.randomBytes(9).toString('base64url');
}

function urlQr(token) {
  return `${config.publicUrl}/q/${token}`;
}

/** SVG del QR de una unidad; corrección de errores media para resistir roces en la etiqueta. */
function qrSvg(token) {
  return QRCode.toString(urlQr(token), { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
}

function validarCategoria(body) {
  const datos = {
    nombre: limpiar(body.nombre, 80),
    orden: entero(body.orden ?? 0, 0, 999) ?? 0,
    activo: body.activo === undefined ? true : Boolean(body.activo),
  };
  if (datos.nombre.length < 2) throw new ErrorValidacion({ nombre: 'Ingrese el nombre de la categoría.' });
  return datos;
}

function validarEquipo(body) {
  const errores = {};
  const datos = {
    categoria_id: entero(body.categoria_id, 1, 2 ** 31),
    nombre: limpiar(body.nombre, 120),
    marca_modelo: limpiar(body.marca_modelo, 120) || null,
    descripcion: String(body.descripcion ?? '').trim().slice(0, 1000) || null,
    accesorios: limpiar(body.accesorios, 500) || null,
    garantia: limpiar(body.garantia, 255) || null,
    tarifa_dia_clp: entero(body.tarifa_dia_clp ?? 0, 0, 10_000_000),
    dias_max: entero(body.dias_max, 1, 365),
    activo: body.activo === undefined ? true : Boolean(body.activo),
  };
  if (!datos.categoria_id) errores.categoria_id = 'Seleccione una categoría.';
  if (datos.nombre.length < 2) errores.nombre = 'Ingrese el nombre del equipo.';
  if (datos.tarifa_dia_clp === null) errores.tarifa_dia_clp = 'La tarifa por día debe ser un monto entero (0 = sin costo).';
  if (datos.dias_max === null) errores.dias_max = 'El plazo máximo debe estar entre 1 y 365 días.';
  if (Object.keys(errores).length) throw new ErrorValidacion(errores);
  return datos;
}

function validarUnidad(body, estadoActual) {
  const errores = {};
  const datos = {
    inventario: limpiar(body.inventario, 40),
    serie: limpiar(body.serie, 80) || null,
    estado: body.estado === undefined ? 'disponible' : String(body.estado),
    ubicacion: limpiar(body.ubicacion, 120) || null,
    notas: String(body.notas ?? '').trim().slice(0, 1000) || null,
  };
  if (!INVENTARIO.test(datos.inventario)) errores.inventario = 'Ingrese el n° de inventario (letras, números, puntos, guiones o /).';
  // Una unidad prestada conserva su estado al editar sus otros datos
  if (!ESTADOS_MANUALES.includes(datos.estado) && !(datos.estado === 'prestado' && estadoActual === 'prestado')) {
    errores.estado = 'Estado inválido.';
  }
  if (Object.keys(errores).length) throw new ErrorValidacion(errores);
  return datos;
}

// ---------- Categorías ----------
async function listarCategorias() {
  return query('SELECT id, nombre, orden, activo FROM equipos_categorias ORDER BY orden, nombre');
}

function duplicado(e, mensaje) {
  return e.code === 'ER_DUP_ENTRY' ? errorPublico(mensaje, 409) : e;
}

async function crearCategoria(body) {
  const d = validarCategoria(body);
  try {
    const r = await query('INSERT INTO equipos_categorias (nombre, orden, activo) VALUES (?, ?, ?)', [d.nombre, d.orden, d.activo]);
    return r.insertId;
  } catch (e) {
    throw duplicado(e, 'Ya existe una categoría con ese nombre.');
  }
}

async function actualizarCategoria(id, body) {
  const d = validarCategoria(body);
  try {
    const r = await query('UPDATE equipos_categorias SET nombre = ?, orden = ?, activo = ? WHERE id = ?', [d.nombre, d.orden, d.activo, id]);
    if (!r.affectedRows) throw errorPublico('Categoría no encontrada.', 404);
  } catch (e) {
    throw duplicado(e, 'Ya existe una categoría con ese nombre.');
  }
}

// ---------- Equipos ----------
async function listarEquipos() {
  return query(
    `SELECT e.id, e.nombre, e.marca_modelo, e.tarifa_dia_clp, e.dias_max, e.activo,
            c.id AS categoria_id, c.nombre AS categoria_nombre,
            COUNT(u.id) AS unidades,
            COALESCE(SUM(u.estado = 'disponible'), 0) AS disponibles,
            COALESCE(SUM(u.estado = 'prestado'), 0) AS prestadas
     FROM equipos e
     JOIN equipos_categorias c ON c.id = e.categoria_id
     LEFT JOIN equipos_unidades u ON u.equipo_id = e.id AND u.estado <> 'baja'
     GROUP BY e.id
     ORDER BY c.orden, c.nombre, e.nombre`
  );
}

async function obtenerEquipo(id) {
  const [equipo] = await query(
    `SELECT e.*, c.nombre AS categoria_nombre FROM equipos e
     JOIN equipos_categorias c ON c.id = e.categoria_id WHERE e.id = ?`,
    [id]
  );
  if (!equipo) return null;
  equipo.unidades = await query(
    `SELECT id, inventario, serie, estado, ubicacion FROM equipos_unidades
     WHERE equipo_id = ? ORDER BY estado = 'baja', inventario`,
    [id]
  );
  return equipo;
}

async function verificarCategoria(id) {
  const [c] = await query('SELECT id FROM equipos_categorias WHERE id = ?', [id]);
  if (!c) throw new ErrorValidacion({ categoria_id: 'Seleccione una categoría.' });
}

const CAMPOS_EQUIPO = ['categoria_id', 'nombre', 'marca_modelo', 'descripcion', 'accesorios', 'garantia', 'tarifa_dia_clp', 'dias_max', 'activo'];

async function crearEquipo(body) {
  const d = validarEquipo(body);
  await verificarCategoria(d.categoria_id);
  const r = await query(
    `INSERT INTO equipos (${CAMPOS_EQUIPO.join(', ')}) VALUES (${CAMPOS_EQUIPO.map(() => '?').join(', ')})`,
    CAMPOS_EQUIPO.map((c) => d[c])
  );
  return r.insertId;
}

async function actualizarEquipo(id, body) {
  const d = validarEquipo(body);
  await verificarCategoria(d.categoria_id);
  const r = await query(
    `UPDATE equipos SET ${CAMPOS_EQUIPO.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...CAMPOS_EQUIPO.map((c) => d[c]), id]
  );
  if (!r.affectedRows) throw errorPublico('Equipo no encontrado.', 404);
}

// ---------- Unidades ----------
const SELECT_UNIDAD = `
  SELECT u.*, e.nombre AS equipo_nombre, e.marca_modelo, c.nombre AS categoria_nombre
  FROM equipos_unidades u
  JOIN equipos e ON e.id = u.equipo_id
  JOIN equipos_categorias c ON c.id = e.categoria_id`;

async function obtenerUnidad(id) {
  const [u] = await query(`${SELECT_UNIDAD} WHERE u.id = ?`, [id]);
  return u || null;
}

async function unidadPorToken(token) {
  if (!/^[A-Za-z0-9_-]{12}$/.test(String(token))) return null;
  const [u] = await query(`${SELECT_UNIDAD} WHERE u.qr_token = ?`, [token]);
  return u || null;
}

async function unidadPorInventario(inventario) {
  const [u] = await query('SELECT id FROM equipos_unidades WHERE inventario = ?', [limpiar(inventario, 40)]);
  return u || null;
}

async function crearUnidad(equipoId, body) {
  const d = validarUnidad(body);
  const [equipo] = await query('SELECT id FROM equipos WHERE id = ?', [equipoId]);
  if (!equipo) throw errorPublico('Equipo no encontrado.', 404);
  try {
    const r = await query(
      `INSERT INTO equipos_unidades (equipo_id, inventario, serie, qr_token, estado, ubicacion, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [equipoId, d.inventario, d.serie, nuevoToken(), d.estado, d.ubicacion, d.notas]
    );
    return r.insertId;
  } catch (e) {
    throw duplicado(e, 'Ya existe una unidad con ese n° de inventario.');
  }
}

async function actualizarUnidad(unidad, body) {
  const d = validarUnidad({ ...body, estado: body.estado ?? unidad.estado }, unidad.estado);
  if (unidad.estado === 'prestado' && d.estado !== 'prestado') {
    throw errorPublico('La unidad está prestada: su estado cambia al registrar la devolución.', 409);
  }
  try {
    await query(
      'UPDATE equipos_unidades SET inventario = ?, serie = ?, estado = ?, ubicacion = ?, notas = ? WHERE id = ?',
      [d.inventario, d.serie, d.estado, d.ubicacion, d.notas, unidad.id]
    );
  } catch (e) {
    throw duplicado(e, 'Ya existe una unidad con ese n° de inventario.');
  }
}

/** Anula la etiqueta actual (p. ej. si se perdió) y genera un QR nuevo. */
async function renovarQr(id) {
  await query('UPDATE equipos_unidades SET qr_token = ? WHERE id = ?', [nuevoToken(), id]);
}

/** Datos para imprimir etiquetas: de un equipo completo o de unidades sueltas. */
async function etiquetas({ equipoId, unidadId }) {
  const filas = await query(
    `${SELECT_UNIDAD} WHERE ${equipoId ? 'u.equipo_id = ? AND u.estado <> \'baja\'' : 'u.id = ?'} ORDER BY u.inventario`,
    [equipoId || unidadId]
  );
  return Promise.all(
    filas.map(async (u) => ({
      id: u.id,
      inventario: u.inventario,
      equipo_nombre: u.equipo_nombre,
      marca_modelo: u.marca_modelo,
      url: urlQr(u.qr_token),
      svg: await qrSvg(u.qr_token),
    }))
  );
}

module.exports = {
  ESTADOS_UNIDAD,
  nuevoToken,
  urlQr,
  qrSvg,
  validarCategoria,
  validarEquipo,
  validarUnidad,
  listarCategorias,
  crearCategoria,
  actualizarCategoria,
  listarEquipos,
  obtenerEquipo,
  crearEquipo,
  actualizarEquipo,
  obtenerUnidad,
  unidadPorToken,
  unidadPorInventario,
  crearUnidad,
  actualizarUnidad,
  renovarQr,
  etiquetas,
};
