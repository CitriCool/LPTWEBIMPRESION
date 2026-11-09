'use strict';

// Importación de dispositivos desde la planilla Excel «Registro de dispositivos
// para préstamo» (una fila por aparato). Primero se revisa todo el archivo y se
// muestran los errores fila por fila; solo si no hay ninguno se guarda, en una
// única transacción: o entran todas las filas o ninguna.
const { query, transaccion } = require('./db');
const { leerHoja, ErrorPlanilla } = require('./xlsx');
const { limpiar } = require('./validacion');
const { nuevoToken } = require('./equipos');

const MAX_DISPOSITIVOS = 500;
// Valores fijos para los equipos nuevos (la planilla no los trae); se cambian luego en el panel
const TARIFA_POR_DEFECTO = 0;
const DIAS_MAX_POR_DEFECTO = 3;
const INVENTARIO = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/;

const normal = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Encabezados aceptados para cada campo (ya normalizados: sin tildes, ° ni signos)
const COLUMNAS = {
  inventario: ['id del dispositivo', 'id dispositivo', 'id', 'n de inventario', 'numero de inventario', 'inventario'],
  nombre: ['nombre del dispositivo', 'nombre dispositivo', 'nombre', 'equipo'],
  tipo: ['tipo de dispositivo', 'tipo dispositivo', 'tipo', 'categoria'],
  marca_modelo: ['marca modelo', 'marca y modelo', 'marca', 'modelo'],
  serie: ['n de serie', 'numero de serie', 'serie'],
  ubicacion: ['ubicacion'],
  estado: ['estado'],
  accesorios: ['accesorios'],
  notas: ['notas', 'notas internas', 'observaciones'],
};
const OBLIGATORIAS = { inventario: 'ID del dispositivo', nombre: 'Nombre del dispositivo', tipo: 'Tipo de dispositivo' };

const ESTADOS = {
  disponible: 'disponible',
  'en mantencion': 'mantencion',
  mantencion: 'mantencion',
  'de baja': 'baja',
  baja: 'baja',
};

/** Ubica la fila de encabezados y a qué columna corresponde cada campo. */
function mapearColumnas(filas) {
  for (const fila of filas.slice(0, 20)) {
    const mapa = {};
    fila.celdas.forEach((c, i) => {
      const n = normal(c);
      for (const [campo, nombres] of Object.entries(COLUMNAS)) {
        if (mapa[campo] === undefined && nombres.includes(n)) mapa[campo] = i;
      }
    });
    if (mapa.inventario !== undefined && mapa.nombre !== undefined) return { fila: fila.numero, mapa };
  }
  return null;
}

/** Convierte las filas de la planilla en registros (sin validar), saltando las vacías. */
function extraerRegistros(filas) {
  const cabecera = mapearColumnas(filas);
  if (!cabecera) {
    throw new ErrorPlanilla('No se encontraron los encabezados «ID del dispositivo» y «Nombre del dispositivo». Use la planilla de registro de dispositivos.');
  }
  const faltan = Object.keys(OBLIGATORIAS).filter((c) => cabecera.mapa[c] === undefined);
  if (faltan.length) throw new ErrorPlanilla(`Falta la columna «${OBLIGATORIAS[faltan[0]]}» en la planilla.`);

  const registros = [];
  for (const fila of filas) {
    if (fila.numero <= cabecera.fila) continue;
    const r = { fila: fila.numero };
    for (const [campo, i] of Object.entries(cabecera.mapa)) r[campo] = String(fila.celdas[i] ?? '').trim();
    if (Object.keys(cabecera.mapa).some((c) => r[c])) registros.push(r);
  }
  return registros;
}

/**
 * Valida los registros. `contexto` trae lo que ya hay en la base:
 * categorias [{id, nombre}], equipos [{id, nombre, categoria_id}] e
 * inventarios (n° de inventario ya usados, en minúsculas).
 * No toca la base: se puede probar sin MariaDB.
 */
function validar(registros, contexto) {
  const categoriaPorNombre = new Map(contexto.categorias.map((c) => [normal(c.nombre), c]));
  const equipoPorClave = new Map();
  for (const e of contexto.equipos) {
    const clave = `${e.categoria_id}|${normal(e.nombre)}`;
    if (!equipoPorClave.has(clave)) equipoPorClave.set(clave, e);
  }
  const usados = new Set(contexto.inventarios.map((i) => String(i).toLowerCase()));
  const vistos = new Map(); // inventario -> fila donde apareció primero

  const categoriasNuevas = new Map(); // normal -> nombre
  const grupos = new Map(); // clave tipo|nombre -> datos del equipo
  const filas = [];

  if (registros.length > MAX_DISPOSITIVOS) {
    throw new ErrorPlanilla(`La planilla tiene ${registros.length} dispositivos; el máximo por importación es ${MAX_DISPOSITIVOS}. Divídala en varios archivos.`);
  }

  for (const r of registros) {
    const errores = [];
    const avisos = [];
    const d = {
      fila: r.fila,
      inventario: limpiar(r.inventario, 60),
      nombre: limpiar(r.nombre, 200),
      tipo: limpiar(r.tipo, 120),
      marca_modelo: limpiar(r.marca_modelo, 200) || null,
      serie: limpiar(r.serie, 120) || null,
      ubicacion: limpiar(r.ubicacion, 200) || null,
      estado: 'disponible',
      accesorios: limpiar(r.accesorios, 600) || null,
      notas: String(r.notas ?? '').trim() || null,
    };

    if (!d.inventario) errores.push('Falta el ID del dispositivo.');
    else if (!INVENTARIO.test(d.inventario)) errores.push('El ID solo admite letras, números, espacio, punto, guion o / (máx. 40).');
    else {
      const clave = d.inventario.toLowerCase();
      if (vistos.has(clave)) errores.push(`El ID ${d.inventario} está repetido (ya aparece en la fila ${vistos.get(clave)}).`);
      else vistos.set(clave, r.fila);
      if (usados.has(clave)) errores.push(`Ya hay un dispositivo registrado con el ID ${d.inventario}.`);
    }

    if (d.nombre.length < 2) errores.push('Falta el nombre del dispositivo.');
    else if (d.nombre.length > 120) errores.push('El nombre tiene más de 120 caracteres.');

    let categoria = null;
    if (d.tipo.length < 2) errores.push('Falta el tipo de dispositivo.');
    else if (d.tipo.length > 80) errores.push('El tipo tiene más de 80 caracteres.');
    else {
      categoria = categoriaPorNombre.get(normal(d.tipo)) || null;
      if (categoria) d.tipo = categoria.nombre; // usa el nombre tal como está en la web
      else if (!categoriasNuevas.has(normal(d.tipo))) categoriasNuevas.set(normal(d.tipo), d.tipo);
      else d.tipo = categoriasNuevas.get(normal(d.tipo));
    }

    if (r.estado) {
      const e = ESTADOS[normal(r.estado)];
      if (e) d.estado = e;
      else errores.push(`Estado «${r.estado}» no válido: use Disponible, En mantención o De baja.`);
    }

    if (d.marca_modelo && d.marca_modelo.length > 120) errores.push('Marca / modelo tiene más de 120 caracteres.');
    if (d.serie && d.serie.length > 80) errores.push('El n° de serie tiene más de 80 caracteres.');
    if (d.ubicacion && d.ubicacion.length > 120) errores.push('La ubicación tiene más de 120 caracteres.');
    if (d.accesorios && d.accesorios.length > 500) errores.push('Accesorios tiene más de 500 caracteres.');
    if (d.notas && d.notas.length > 1000) errores.push('Las notas tienen más de 1000 caracteres.');

    // Equipo (modelo) al que pertenece: uno existente con el mismo nombre y tipo, o uno nuevo
    if (!errores.length) {
      const existente = categoria && equipoPorClave.get(`${categoria.id}|${normal(d.nombre)}`);
      const clave = `${normal(d.tipo)}|${normal(d.nombre)}`;
      let g = grupos.get(clave);
      if (!g) {
        g = existente
          ? { existente: true, id: existente.id, nombre: existente.nombre, tipo: d.tipo, unidades: 0 }
          : { existente: false, nombre: d.nombre, tipo: d.tipo, marca_modelo: d.marca_modelo, accesorios: d.accesorios, fila: r.fila, unidades: 0 };
        grupos.set(clave, g);
      } else if (!g.existente) {
        if (d.marca_modelo && g.marca_modelo && normal(d.marca_modelo) !== normal(g.marca_modelo)) {
          avisos.push(`Marca / modelo distinta a la fila ${g.fila}; el equipo usará «${g.marca_modelo}».`);
        }
        if (d.accesorios && g.accesorios && normal(d.accesorios) !== normal(g.accesorios)) {
          avisos.push(`Accesorios distintos a la fila ${g.fila}; el equipo usará «${g.accesorios}».`);
        }
        g.marca_modelo = g.marca_modelo || d.marca_modelo;
        g.accesorios = g.accesorios || d.accesorios;
      }
      if (g.existente && (d.marca_modelo || d.accesorios)) {
        avisos.push('El equipo ya existe en la web: se agrega la unidad sin cambiar su marca/modelo ni accesorios.');
      }
      g.unidades++;
      d.equipo = g.existente ? 'existente' : 'nuevo';
      d.grupo = clave;
    }
    filas.push({ ...d, errores, avisos });
  }

  const conError = filas.filter((f) => f.errores.length).length;
  const equipos = [...grupos.values()];
  // Las categorías nuevas solo cuentan si alguna fila válida las usa
  const tiposUsados = new Set(equipos.map((g) => normal(g.tipo)));
  return {
    total: filas.length,
    validas: filas.length - conError,
    con_error: conError,
    categorias_nuevas: [...categoriasNuevas.entries()].filter(([k]) => tiposUsados.has(k)).map(([, v]) => v),
    equipos_nuevos: equipos.filter((g) => !g.existente).map(({ nombre, tipo, marca_modelo, unidades }) => ({ nombre, tipo, marca_modelo, unidades })),
    equipos_existentes: equipos.filter((g) => g.existente).map(({ id, nombre, tipo, unidades }) => ({ id, nombre, tipo, unidades })),
    defectos: { tarifa_dia_clp: TARIFA_POR_DEFECTO, dias_max: DIAS_MAX_POR_DEFECTO },
    filas,
    grupos,
  };
}

async function cargarContexto(registros, conn) {
  const q = conn ? async (sql, p) => (await conn.query(sql, p))[0] : query;
  const ids = [...new Set(registros.map((r) => limpiar(r.inventario, 60)).filter(Boolean))];
  const [categorias, equipos, inventarios] = await Promise.all([
    q('SELECT id, nombre FROM equipos_categorias'),
    q('SELECT id, nombre, categoria_id FROM equipos ORDER BY id'),
    ids.length ? q('SELECT inventario FROM equipos_unidades WHERE inventario IN (?)', [ids]) : [],
  ]);
  return { categorias, equipos, inventarios: inventarios.map((u) => u.inventario) };
}

function leerRegistros(buffer) {
  const { filas } = leerHoja(buffer, { preferida: 'Dispositivos' });
  const registros = extraerRegistros(filas);
  if (!registros.length) throw new ErrorPlanilla('La planilla no tiene dispositivos: complete al menos una fila bajo los encabezados.');
  return registros;
}

function publico(r) {
  const { grupos, ...resto } = r;
  return { ...resto, filas: r.filas.map(({ grupo, ...f }) => f) };
}

/** Revisa la planilla sin guardar nada. */
async function revisar(buffer) {
  const registros = leerRegistros(buffer);
  return publico(validar(registros, await cargarContexto(registros)));
}

/** Revisa de nuevo y, si no hay errores, crea categorías, equipos y unidades (con su QR). */
async function importar(buffer) {
  const registros = leerRegistros(buffer);
  return transaccion(async (conn) => {
    // Bloquea el inventario mientras se importa para que dos importaciones no choquen
    await conn.query('SELECT id FROM equipos_categorias FOR UPDATE');
    const r = validar(registros, await cargarContexto(registros, conn));
    if (r.con_error) {
      const err = new ErrorPlanilla(`La planilla tiene ${r.con_error} fila(s) con errores; no se guardó nada.`);
      err.status = 409;
      err.revision = publico(r);
      throw err;
    }

    const categorias = new Map();
    const [[{ orden }]] = await conn.query('SELECT COALESCE(MAX(orden), 0) AS orden FROM equipos_categorias');
    let siguienteOrden = Math.min(orden, 998);
    for (const nombre of r.categorias_nuevas) {
      const [res] = await conn.query('INSERT INTO equipos_categorias (nombre, orden, activo) VALUES (?, ?, 1)', [nombre, ++siguienteOrden]);
      categorias.set(normal(nombre), res.insertId);
    }
    const [todas] = await conn.query('SELECT id, nombre FROM equipos_categorias');
    for (const c of todas) if (!categorias.has(normal(c.nombre))) categorias.set(normal(c.nombre), c.id);

    for (const g of r.grupos.values()) {
      if (g.existente) continue;
      const [res] = await conn.query(
        `INSERT INTO equipos (categoria_id, nombre, marca_modelo, accesorios, tarifa_dia_clp, dias_max, activo)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [categorias.get(normal(g.tipo)), g.nombre, g.marca_modelo, g.accesorios, TARIFA_POR_DEFECTO, DIAS_MAX_POR_DEFECTO]
      );
      g.id = res.insertId;
    }

    const unidades = [];
    for (const f of r.filas) {
      const g = r.grupos.get(f.grupo);
      const [res] = await conn.query(
        `INSERT INTO equipos_unidades (equipo_id, inventario, serie, qr_token, estado, ubicacion, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [g.id, f.inventario, f.serie, nuevoToken(), f.estado, f.ubicacion, f.notas]
      );
      unidades.push(res.insertId);
    }
    return {
      unidades,
      categorias_nuevas: r.categorias_nuevas.length,
      equipos_nuevos: r.equipos_nuevos.length,
      equipos_existentes: r.equipos_existentes.length,
    };
  }).catch((e) => {
    if (e.code === 'ER_DUP_ENTRY') {
      throw Object.assign(new ErrorPlanilla('Otro usuario registró uno de estos ID mientras se importaba. Revise el archivo de nuevo.'), { status: 409 });
    }
    throw e;
  });
}

module.exports = { extraerRegistros, validar, revisar, importar, MAX_DISPOSITIVOS, TARIFA_POR_DEFECTO, DIAS_MAX_POR_DEFECTO };
