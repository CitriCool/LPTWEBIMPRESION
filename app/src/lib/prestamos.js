'use strict';

const crypto = require('crypto');
const { query, transaccion } = require('./db');
const { ErrorValidacion, limpiar, rutValido, formatearRut, correoValido } = require('./validacion');
const { nuevoTokenAcceso } = require('./acceso');
const config = require('../config');
const { fecha } = require('./formato');

const ESTADOS = {
  solicitado: 'Solicitado',
  aprobado: 'Aceptado',
  rechazado: 'Rechazado',
  cancelado: 'Cancelado',
  entregado: 'Entregado',
  devuelto: 'Devuelto',
};
// Préstamos que ocupan una unidad en sus fechas
const OCUPAN = "('aprobado', 'entregado')";
// Hasta qué día ocupa su unidad un préstamo: un equipo entregado y atrasado la
// sigue ocupando hasta hoy (no está en el LPT). Recibe la fecha de hoy como parámetro.
const finOcupa = (a) => `IF(${a}.estado = 'entregado' AND ${a}.fecha_hasta < ?, ?, ${a}.fecha_hasta)`;
/** Lo mismo en JS (p trae estado y fecha_hasta). */
const finEfectivo = (p, h = hoy()) => (p.estado === 'entregado' && p.fecha_hasta < h ? h : p.fecha_hasta);
const TIPOS = { estudiante: 'Estudiante', academico: 'Académico/a' };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function errorPublico(mensaje, status = 400) {
  return Object.assign(new Error(mensaje), { status, publico: true });
}

/** Fecha de hoy en la zona horaria del servidor (TZ=America/Santiago en Docker). */
function hoy(ahora = new Date()) {
  return ahora.toLocaleDateString('sv-SE');
}

function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Días de préstamo contando ambos extremos: del lunes al miércoles son 3. */
function diasEntre(desde, hasta) {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / 864e5) + 1;
}

function correoInstitucional(email) {
  const dominio = String(email).split('@')[1] || '';
  return config.prestamos.dominios.includes(dominio.toLowerCase());
}

/**
 * Valida las fechas pedidas contra el plazo máximo del equipo. Devuelve los
 * días o un mensaje de error.
 */
function validarFechas(desde, hasta, diasMax, ahora = new Date()) {
  if (!FECHA.test(desde) || !FECHA.test(hasta) || Number.isNaN(Date.parse(desde)) || Number.isNaN(Date.parse(hasta))) {
    return { error: 'Indique las fechas de retiro y devolución.' };
  }
  const h = hoy(ahora);
  if (desde < h) return { error: 'La fecha de retiro no puede ser anterior a hoy.' };
  if (desde > sumarDias(h, config.prestamos.anticipacionMaxDias)) {
    return { error: `Se puede pedir con hasta ${config.prestamos.anticipacionMaxDias} días de anticipación.` };
  }
  if (hasta < desde) return { error: 'La devolución debe ser el mismo día del retiro o después.' };
  const dias = diasEntre(desde, hasta);
  if (dias > diasMax) return { error: `Este equipo se presta por un máximo de ${diasMax} día(s).` };
  return { dias };
}

function validarSolicitud(body) {
  const errores = {};
  const d = {
    equipo_id: Number(body.equipo_id),
    nombre: limpiar(body.nombre, 120),
    rut: limpiar(body.rut, 20),
    email: limpiar(body.email, 160).toLowerCase(),
    telefono: limpiar(body.telefono, 30),
    tipo: String(body.tipo || ''),
    unidad: limpiar(body.unidad, 160),
    motivo: String(body.motivo ?? '').trim().slice(0, 1000),
    desde: String(body.desde || ''),
    hasta: String(body.hasta || ''),
  };
  if (!Number.isInteger(d.equipo_id) || d.equipo_id < 1) errores.equipo_id = 'Seleccione un equipo.';
  if (d.nombre.length < 3) errores.nombre = 'Ingrese su nombre completo.';
  if (!rutValido(d.rut)) errores.rut = 'El RUT no es válido (ej. 12.345.678-5).';
  else d.rut = formatearRut(d.rut);
  if (!correoValido(d.email)) errores.email = 'Ingrese un correo válido.';
  else if (!correoInstitucional(d.email)) {
    errores.email = `Use su correo institucional (${config.prestamos.dominios.map((x) => '@' + x).join(' o ')}).`;
  }
  if (!/^\+?[\d\s()-]{8,20}$/.test(d.telefono)) errores.telefono = 'Ingrese un teléfono válido.';
  if (!TIPOS[d.tipo]) errores.tipo = 'Indique si es estudiante o académico/a.';
  if (d.unidad.length < 2) errores.unidad = 'Ingrese su carrera o unidad académica.';
  if (d.motivo.length < 5) errores.motivo = 'Cuéntenos para qué necesita el equipo.';
  if (body.acepta !== true && body.acepta !== 'true' && body.acepta !== 'on') {
    errores.acepta = 'Debe aceptar las condiciones del préstamo.';
  }
  if (Object.keys(errores).length) throw new ErrorValidacion(errores);
  return d;
}

// ---------- Disponibilidad ----------
/** Unidades del equipo que se pueden prestar (excluye mantención y baja). */
async function unidadesOperativas(equipoId) {
  const [r] = await query(
    "SELECT COUNT(*) AS n FROM equipos_unidades WHERE equipo_id = ? AND estado IN ('disponible', 'prestado')",
    [equipoId]
  );
  return r.n;
}

/** Cuántas unidades quedan libres en todo el rango de fechas. */
async function disponibles(equipoId, desde, hasta) {
  const h = hoy();
  const [operativas, [ocupadas]] = await Promise.all([
    unidadesOperativas(equipoId),
    query(
      `SELECT COUNT(DISTINCT p.unidad_id) AS n FROM prestamos p
       JOIN equipos_unidades u ON u.id = p.unidad_id AND u.estado IN ('disponible', 'prestado')
       WHERE p.equipo_id = ? AND p.estado IN ${OCUPAN} AND p.fecha_desde <= ? AND ${finOcupa('p')} >= ?`,
      [equipoId, hasta, h, h, desde]
    ),
  ]);
  return Math.max(0, operativas - ocupadas.n);
}

/** Unidades que se pueden asignar a un préstamo (libres en sus fechas). */
async function unidadesLibres(p) {
  return query(
    `SELECT u.id, u.inventario, u.estado, u.ubicacion FROM equipos_unidades u
     WHERE u.equipo_id = ? AND u.estado IN ('disponible', 'prestado')
       AND NOT EXISTS (SELECT 1 FROM prestamos o WHERE o.unidad_id = u.id AND o.id <> ?
                       AND o.estado IN ${OCUPAN} AND o.fecha_desde <= ? AND ${finOcupa('o')} >= ?)
     ORDER BY u.inventario`,
    [p.equipo_id, p.id, p.fecha_hasta, hoy(), hoy(), p.fecha_desde]
  );
}

// ---------- Catálogo público ----------
async function catalogo() {
  const equipos = await query(
    `SELECT e.id, e.nombre, e.marca_modelo, e.descripcion, e.accesorios, e.garantia, e.tarifa_dia_clp, e.dias_max,
            c.id AS categoria_id, c.nombre AS categoria_nombre,
            COUNT(u.id) AS unidades
     FROM equipos e
     JOIN equipos_categorias c ON c.id = e.categoria_id AND c.activo = 1
     JOIN equipos_unidades u ON u.equipo_id = e.id AND u.estado IN ('disponible', 'prestado')
     WHERE e.activo = 1
     GROUP BY e.id
     ORDER BY c.orden, c.nombre, e.nombre`
  );
  return equipos;
}

async function equipoPrestable(id) {
  const [e] = await query(
    `SELECT e.* FROM equipos e JOIN equipos_categorias c ON c.id = e.categoria_id
     WHERE e.id = ? AND e.activo = 1 AND c.activo = 1`,
    [id]
  );
  return e || null;
}

// ---------- Solicitudes ----------
const SELECT_PRESTAMO = `
  SELECT p.*, e.nombre AS equipo_nombre, e.marca_modelo, e.accesorios,
         c.nombre AS categoria_nombre, u.inventario AS unidad_inventario
  FROM prestamos p
  JOIN equipos e ON e.id = p.equipo_id
  JOIN equipos_categorias c ON c.id = e.categoria_id
  LEFT JOIN equipos_unidades u ON u.id = p.unidad_id`;

async function obtener(id) {
  const [p] = await query(`${SELECT_PRESTAMO} WHERE p.id = ?`, [id]);
  return p || null;
}

async function buscarPorCodigoYEmail(codigo, email) {
  const [p] = await query(`${SELECT_PRESTAMO} WHERE p.codigo = ? AND p.solicitante_email = ?`, [
    String(codigo).trim().toUpperCase(),
    String(email).trim().toLowerCase(),
  ]);
  return p || null;
}

async function crearSolicitud(body) {
  const d = validarSolicitud(body);
  const equipo = await equipoPrestable(d.equipo_id);
  if (!equipo) throw new ErrorValidacion({ equipo_id: 'Ese equipo no está disponible para préstamo.' });
  const f = validarFechas(d.desde, d.hasta, equipo.dias_max);
  if (f.error) throw new ErrorValidacion({ desde: f.error });
  if ((await disponibles(equipo.id, d.desde, d.hasta)) < 1) {
    throw new ErrorValidacion({ desde: 'No quedan unidades libres en esas fechas. Pruebe con otras.' });
  }

  const ahora = new Date();
  const id = await transaccion(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO prestamos
        (codigo, acceso_token, equipo_id, solicitante_nombre, solicitante_rut, solicitante_email, solicitante_telefono,
         solicitante_tipo, solicitante_unidad, motivo, fecha_desde, fecha_hasta, dias, tarifa_dia_clp, total_clp, garantia)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `TMP-${crypto.randomBytes(6).toString('hex')}`,
        nuevoTokenAcceso(),
        equipo.id, d.nombre, d.rut, d.email, d.telefono, d.tipo, d.unidad, d.motivo,
        d.desde, d.hasta, f.dias, equipo.tarifa_dia_clp, equipo.tarifa_dia_clp * f.dias, equipo.garantia,
      ]
    );
    const codigo = `PRE-${ahora.getFullYear()}-${String(r.insertId).padStart(5, '0')}`;
    await conn.query('UPDATE prestamos SET codigo = ? WHERE id = ?', [codigo, r.insertId]);
    await conn.query("INSERT INTO prestamos_movimientos (prestamo_id, tipo, comentario) VALUES (?, 'solicitado', ?)", [
      r.insertId,
      'Solicitud recibida desde el sitio web',
    ]);
    return r.insertId;
  });
  return obtener(id);
}

/** El solicitante cancela mientras no haya retirado el equipo. */
async function cancelarPorSolicitante(p) {
  if (!['solicitado', 'aprobado'].includes(p.estado)) {
    throw errorPublico('Este préstamo ya no se puede cancelar desde aquí. Escríbanos si necesita cambiarlo.', 409);
  }
  await registrar(p.id, 'cancelado', null, 'Cancelado por el solicitante', "estado = 'cancelado'", [], p.estado);
  return obtener(p.id);
}

/**
 * Cambia el estado de un préstamo y deja el movimiento. Solo actúa si el préstamo
 * sigue en `estadoEsperado` (el que tenía al revisarlo): si entretanto otro lo
 * entregó o anuló, no se pisa ese cambio.
 */
async function registrar(id, tipo, usuarioId, comentario, set, params, estadoEsperado) {
  await transaccion(async (conn) => {
    const [r] = await conn.query(`UPDATE prestamos SET ${set} WHERE id = ? AND estado = ?`, [...params, id, estadoEsperado]);
    if (r.affectedRows === 0) throw errorPublico('El préstamo cambió mientras tanto. Recargue para ver su estado actual.', 409);
    await conn.query('INSERT INTO prestamos_movimientos (prestamo_id, tipo, usuario_id, comentario) VALUES (?, ?, ?, ?)', [
      id, tipo, usuarioId, comentario,
    ]);
  });
}

// ---------- Panel ----------
async function listar({ estado, q, limite = 100 }) {
  const where = [];
  const params = [];
  if (estado === 'atrasado') {
    where.push("p.estado = 'entregado' AND p.fecha_hasta < ?");
    params.push(hoy());
  } else if (estado && ESTADOS[estado]) {
    where.push('p.estado = ?');
    params.push(estado);
  }
  if (q) {
    where.push('(p.codigo LIKE ? OR p.solicitante_nombre LIKE ? OR p.solicitante_email LIKE ? OR p.solicitante_rut LIKE ? OR u.inventario LIKE ?)');
    params.push(...Array(5).fill(`%${q}%`));
  }
  return query(
    `${SELECT_PRESTAMO} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.estado = 'solicitado' DESC, p.fecha_desde, p.id DESC LIMIT ?`,
    [...params, Math.min(Number(limite) || 100, 500)]
  );
}

async function resumen() {
  const [filas, [atrasados]] = await Promise.all([
    query('SELECT estado, COUNT(*) AS cantidad FROM prestamos GROUP BY estado'),
    query("SELECT COUNT(*) AS cantidad FROM prestamos WHERE estado = 'entregado' AND fecha_hasta < ?", [hoy()]),
  ]);
  const lista = Object.keys(ESTADOS).map((e) => ({ codigo: e, nombre: ESTADOS[e], cantidad: filas.find((f) => f.estado === e)?.cantidad || 0 }));
  // Los atrasados son entregados cuya fecha de devolución ya pasó
  lista.splice(lista.findIndex((e) => e.codigo === 'entregado') + 1, 0, { codigo: 'atrasado', nombre: 'Atrasado', cantidad: atrasados.cantidad });
  return lista;
}

const atrasado = (p, h = hoy()) => p.estado === 'entregado' && p.fecha_hasta < h;
// Día en que se puede retirar: el fijado al aceptar o, si falta, el primer día del préstamo
const diaRetiro = (p) => (p.retiro_en ? hoy(new Date(p.retiro_en)) : p.fecha_desde);
const entregableHoy = (p, h = hoy()) => p.estado === 'aprobado' && diaRetiro(p) <= h && h <= p.fecha_hasta;

async function movimientos(id) {
  return query(
    `SELECT m.tipo, m.comentario, m.creado_en, us.nombre AS usuario FROM prestamos_movimientos m
     LEFT JOIN usuarios us ON us.id = m.usuario_id WHERE m.prestamo_id = ? ORDER BY m.creado_en, m.id`,
    [id]
  );
}

const RETIRO = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/**
 * Acepta la solicitud: asigna una unidad libre en esas fechas y fija cuándo y
 * dónde se retira. La unidad se bloquea en la transacción para que dos
 * aprobaciones simultáneas no la entreguen dos veces.
 */
async function aprobar(id, { unidad_id, retiro_en, retiro_lugar, comentario }, usuarioId) {
  const m = RETIRO.exec(String(retiro_en || ''));
  if (!m) throw new ErrorValidacion({ retiro_en: 'Indique el día y la hora de retiro.' });
  const lugar = limpiar(retiro_lugar, 160) || config.prestamos.lugarRetiro;
  const nota = limpiar(comentario, 500) || null;

  await transaccion(async (conn) => {
    const [[p]] = await conn.query('SELECT * FROM prestamos WHERE id = ? FOR UPDATE', [id]);
    if (!p) throw errorPublico('Préstamo no encontrado.', 404);
    if (p.estado !== 'solicitado') throw errorPublico('Esta solicitud ya fue revisada.', 409);
    if (m[1] > p.fecha_desde) throw new ErrorValidacion({ retiro_en: 'El retiro no puede ser después de la fecha pedida.' });
    const [[u]] = await conn.query(
      "SELECT id FROM equipos_unidades WHERE id = ? AND equipo_id = ? AND estado IN ('disponible', 'prestado') FOR UPDATE",
      [Number(unidad_id), p.equipo_id]
    );
    if (!u) throw new ErrorValidacion({ unidad_id: 'Seleccione una unidad de este equipo.' });
    const [[choque]] = await conn.query(
      `SELECT codigo, estado FROM prestamos o WHERE unidad_id = ? AND id <> ? AND estado IN ${OCUPAN}
       AND fecha_desde <= ? AND ${finOcupa('o')} >= ? LIMIT 1`,
      [u.id, p.id, p.fecha_hasta, hoy(), hoy(), p.fecha_desde]
    );
    if (choque) {
      const motivo = choque.estado === 'entregado' ? 'todavía no se devuelve' : 'ya está comprometida en esas fechas';
      throw errorPublico(`Esa unidad ${motivo} (${choque.codigo}).`, 409);
    }
    await conn.query(
      `UPDATE prestamos SET estado = 'aprobado', unidad_id = ?, retiro_en = ?, retiro_lugar = ?, comentario_lpt = ?,
       revisado_por = ?, revisado_en = NOW() WHERE id = ?`,
      [u.id, `${m[1]} ${m[2]}:${m[3]}:00`, lugar, nota, usuarioId, p.id]
    );
    await conn.query("INSERT INTO prestamos_movimientos (prestamo_id, tipo, usuario_id, comentario) VALUES (?, 'aprobado', ?, ?)", [
      p.id, usuarioId, nota,
    ]);
  });
  return obtener(id);
}

/** Rechaza una solicitud pendiente o anula una ya aceptada; el motivo lo recibe el solicitante. */
async function rechazar(p, comentario, usuarioId) {
  const motivo = limpiar(comentario, 500);
  if (motivo.length < 3) throw new ErrorValidacion({ comentario: 'Escriba el motivo para el solicitante.' });
  const nuevo = { solicitado: 'rechazado', aprobado: 'cancelado' }[p.estado];
  if (!nuevo) throw errorPublico('Este préstamo ya no se puede rechazar ni anular.', 409);
  await registrar(p.id, nuevo, usuarioId, motivo, 'estado = ?, comentario_lpt = ?, revisado_por = ?, revisado_en = NOW()', [
    nuevo, motivo, usuarioId,
  ], p.estado);
  return obtener(p.id);
}


const CONDICIONES = { ok: 'Sin observaciones', observaciones: 'Con observaciones', danado: 'Dañado' };

/**
 * Entrega al solicitante la unidad asignada (se registra escaneando su QR).
 * La unidad pasa a "prestado" hasta la devolución.
 */
async function entregar(id, { garantia_recibida, observacion }, usuarioId) {
  const nota = limpiar(observacion, 500) || null;
  await transaccion(async (conn) => {
    const [[p]] = await conn.query('SELECT * FROM prestamos WHERE id = ? FOR UPDATE', [id]);
    if (!p) throw errorPublico('Préstamo no encontrado.', 404);
    if (p.estado !== 'aprobado') throw errorPublico('Solo se entrega un préstamo aceptado que aún no se retira.', 409);
    if (p.fecha_hasta < hoy()) throw errorPublico('La fecha de devolución de este préstamo ya pasó: anúlelo y pida una solicitud nueva.', 409);
    if (!entregableHoy(p)) throw errorPublico(`El retiro está fijado para el ${fecha(diaRetiro(p))}; no se entrega antes.`, 409);
    if (p.garantia && !garantia_recibida) throw new ErrorValidacion({ garantia_recibida: `Confirme que recibió la garantía (${p.garantia}).` });
    const [[u]] = await conn.query('SELECT id, inventario, estado FROM equipos_unidades WHERE id = ? FOR UPDATE', [p.unidad_id]);
    if (u.estado === 'prestado') {
      const [[otro]] = await conn.query("SELECT codigo FROM prestamos WHERE unidad_id = ? AND estado = 'entregado' LIMIT 1", [u.id]);
      throw errorPublico(`La unidad ${u.inventario} aún no se devuelve${otro ? ` (préstamo ${otro.codigo})` : ''}.`, 409);
    }
    if (u.estado !== 'disponible') throw errorPublico(`La unidad ${u.inventario} está en mantención o de baja.`, 409);
    await conn.query(
      `UPDATE prestamos SET estado = 'entregado', entregado_en = NOW(), entregado_por = ?, garantia_recibida = ?,
       observacion_entrega = ? WHERE id = ?`,
      [usuarioId, Boolean(garantia_recibida), nota, p.id]
    );
    await conn.query("UPDATE equipos_unidades SET estado = 'prestado' WHERE id = ?", [u.id]);
    await conn.query("INSERT INTO prestamos_movimientos (prestamo_id, tipo, usuario_id, comentario) VALUES (?, 'entregado', ?, ?)", [
      p.id, usuarioId, nota,
    ]);
  });
  return obtener(id);
}

/**
 * Recibe el equipo de vuelta. Si vuelve dañado (o se marca), la unidad queda
 * en mantención y no se puede volver a prestar hasta que el admin la libere.
 */
async function recibir(id, { condicion, observacion, mantencion }, usuarioId) {
  if (!CONDICIONES[condicion]) throw new ErrorValidacion({ condicion: 'Indique en qué estado vuelve el equipo.' });
  const nota = limpiar(observacion, 500) || null;
  if (condicion !== 'ok' && !nota) throw new ErrorValidacion({ observacion: 'Describa las observaciones o el daño.' });
  const aMantencion = condicion === 'danado' || Boolean(mantencion);
  await transaccion(async (conn) => {
    const [[p]] = await conn.query('SELECT * FROM prestamos WHERE id = ? FOR UPDATE', [id]);
    if (!p) throw errorPublico('Préstamo no encontrado.', 404);
    if (p.estado !== 'entregado') throw errorPublico('Este préstamo no tiene un equipo por devolver.', 409);
    await conn.query(
      `UPDATE prestamos SET estado = 'devuelto', devuelto_en = NOW(), devuelto_por = ?, condicion_devolucion = ?,
       observacion_devolucion = ? WHERE id = ?`,
      [usuarioId, condicion, nota, p.id]
    );
    await conn.query('UPDATE equipos_unidades SET estado = ? WHERE id = ?', [aMantencion ? 'mantencion' : 'disponible', p.unidad_id]);
    const detalle = [CONDICIONES[condicion], nota, aMantencion ? 'Unidad enviada a mantención' : null].filter(Boolean).join('. ');
    await conn.query("INSERT INTO prestamos_movimientos (prestamo_id, tipo, usuario_id, comentario) VALUES (?, 'devuelto', ?, ?)", [
      p.id, usuarioId, detalle,
    ]);
  });
  return obtener(id);
}

/** Préstamos de una unidad para su ficha: el que está afuera, los próximos y los últimos cerrados. */
async function deUnidad(unidadId) {
  const filas = await query(
    `SELECT id, codigo, estado, solicitante_nombre, fecha_desde, fecha_hasta, retiro_en, garantia,
            entregado_en, devuelto_en, condicion_devolucion
     FROM prestamos WHERE unidad_id = ? AND estado IN ('aprobado', 'entregado', 'devuelto')
     ORDER BY fecha_desde DESC, id DESC LIMIT 50`,
    [unidadId]
  );
  const actual = filas.find((p) => p.estado === 'entregado');
  return {
    actual: actual ? { ...actual, atrasado: atrasado(actual) } : null,
    proximos: filas.filter((p) => p.estado === 'aprobado').reverse().map((p) => ({ ...p, entregable: entregableHoy(p) })),
    historial: filas.filter((p) => p.estado === 'devuelto').slice(0, 10),
  };
}

// ---------- Recordatorios ----------
/** Equipos afuera que vencen hasta `hastaFecha` (incluye los atrasados). */
async function paraRecordar(hastaFecha) {
  return query(`${SELECT_PRESTAMO} WHERE p.estado = 'entregado' AND p.fecha_hasta <= ? ORDER BY p.fecha_hasta, p.id`, [hastaFecha]);
}

// ---------- Calendario de ocupación ----------
const MAX_DIAS_CALENDARIO = 62;

/** Normaliza el rango pedido: desde una fecha válida (o hoy) y entre 1 y 62 días. */
function rangoCalendario(desde, dias, h = hoy()) {
  const ok = FECHA.test(String(desde || '')) && !Number.isNaN(Date.parse(desde)) && desde >= '2000-01-01' && desde <= '2999-12-31';
  const d = ok ? String(desde) : h;
  const n = Math.min(Math.max(Number.parseInt(dias, 10) || 28, 1), MAX_DIAS_CALENDARIO);
  return { desde: d, hasta: sumarDias(d, n - 1), dias: n };
}

function fechasDelRango(desde, dias) {
  return Array.from({ length: dias }, (_, i) => sumarDias(desde, i));
}

/**
 * Unidades libres de un equipo para cada día del rango, con la misma regla que
 * disponibles(): cuentan los préstamos aceptados o entregados de unidades operativas.
 */
function ocupacionPorDia(prestamosEquipo, operativas, desde, dias, h = hoy()) {
  return fechasDelRango(desde, dias).map((fecha) => {
    const ocupadas = new Set(
      prestamosEquipo.filter((p) => p.fecha_desde <= fecha && finEfectivo(p, h) >= fecha).map((p) => p.unidad_id)
    ).size;
    return { fecha, libres: Math.max(0, operativas - ocupadas) };
  });
}

/** Ocupación pública de un equipo: solo cuántas unidades quedan libres por día. */
async function ocupacion(equipoId, desde, dias) {
  const h = hoy();
  // El sitio público solo ve desde la semana pasada hasta el plazo de anticipación
  const valida = FECHA.test(String(desde || '')) && desde >= sumarDias(h, -7) && desde <= sumarDias(h, config.prestamos.anticipacionMaxDias);
  const r = rangoCalendario(valida ? desde : h, dias, h);
  const [operativas, filas] = await Promise.all([
    unidadesOperativas(equipoId),
    query(
      `SELECT p.unidad_id, p.estado, p.fecha_desde, p.fecha_hasta FROM prestamos p
       JOIN equipos_unidades u ON u.id = p.unidad_id AND u.estado IN ('disponible', 'prestado')
       WHERE p.equipo_id = ? AND p.estado IN ${OCUPAN} AND p.fecha_desde <= ? AND ${finOcupa('p')} >= ?`,
      [equipoId, r.hasta, h, h, r.desde]
    ),
  ]);
  return { ...r, unidades: operativas, ocupacion: ocupacionPorDia(filas, operativas, r.desde, r.dias, h) };
}

/**
 * Calendario del panel: unidades por equipo y los préstamos que tocan el rango.
 * Los equipos entregados y atrasados ocupan su unidad hasta que se devuelven,
 * aunque su fecha de devolución haya quedado antes del rango.
 */
async function calendario(desde, dias) {
  const r = rangoCalendario(desde, dias);
  const [unidades, lista] = await Promise.all([
    query(
      `SELECT u.id, u.inventario, u.estado, e.id AS equipo_id, e.nombre AS equipo_nombre, e.marca_modelo
       FROM equipos_unidades u JOIN equipos e ON e.id = u.equipo_id
       WHERE e.activo = 1 AND u.estado <> 'baja'
       ORDER BY e.nombre, e.id, u.inventario`
    ),
    query(
      `SELECT p.id, p.codigo, p.estado, p.equipo_id, p.unidad_id, p.solicitante_nombre, p.fecha_desde, p.fecha_hasta
       FROM prestamos p
       WHERE (p.estado IN ('solicitado', 'aprobado', 'entregado') AND p.fecha_desde <= ? AND p.fecha_hasta >= ?)
          OR (p.estado = 'entregado' AND p.fecha_hasta < ?)
       ORDER BY p.fecha_desde, p.id`,
      [r.hasta, r.desde, r.desde]
    ),
  ]);
  const h = hoy();
  const equipos = [];
  for (const u of unidades) {
    let e = equipos[equipos.length - 1];
    if (!e || e.id !== u.equipo_id) {
      e = { id: u.equipo_id, nombre: u.equipo_nombre, marca_modelo: u.marca_modelo, unidades: [] };
      equipos.push(e);
    }
    e.unidades.push({ id: u.id, inventario: u.inventario, estado: u.estado });
  }
  return { ...r, hoy: h, equipos, prestamos: lista.map((p) => ({ ...p, atrasado: atrasado(p, h) })) };
}

module.exports = {
  sumarDias,
  paraRecordar,
  rangoCalendario,
  ocupacionPorDia,
  finEfectivo,
  ocupacion,
  calendario,
  CONDICIONES,
  atrasado,
  entregableHoy,
  entregar,
  recibir,
  deUnidad,
  ESTADOS,
  TIPOS,
  hoy,
  diasEntre,
  correoInstitucional,
  validarFechas,
  validarSolicitud,
  disponibles,
  unidadesLibres,
  catalogo,
  equipoPrestable,
  obtener,
  buscarPorCodigoYEmail,
  crearSolicitud,
  cancelarPorSolicitante,
  listar,
  resumen,
  movimientos,
  aprobar,
  rechazar,
};
