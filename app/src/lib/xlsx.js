'use strict';

// Lector mínimo de planillas Excel (.xlsx): devuelve las celdas de una hoja
// como texto. Un .xlsx es un ZIP con XML adentro; se descomprime con fflate
// (sin dependencias) y se leen solo los archivos necesarios, con límites de
// tamaño para que un archivo malicioso (bomba ZIP) no agote la memoria.
const { unzipSync } = require('fflate');

const MAX_DESCOMPRIMIDO = 20 * 1024 * 1024; // por archivo interno
const MAX_FILAS = 2000;
const MAX_COLUMNAS = 30;

class ErrorPlanilla extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.status = 400;
    this.publico = true;
  }
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodificar(s) {
  return s
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&(#x[0-9A-Fa-f]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e]
    );
}

/** Texto de un nodo <si> o <is>: une todos sus <t> (el texto con formato viene en varios trozos). */
function textoDe(xml) {
  // Se descartan las guías fonéticas (<rPh>) que Excel agrega en algunos idiomas
  const sinFonetica = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let texto = '';
  for (const m of sinFonetica.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) texto += m[1];
  return decodificar(texto);
}

function atributo(etiqueta, nombre) {
  const m = new RegExp(`\\s${nombre}="([^"]*)"`).exec(etiqueta);
  return m ? decodificar(m[1]) : null;
}

/** "AB12" -> índice de columna 27 (desde 0). */
function columna(ref) {
  const letras = /^([A-Z]+)/.exec(ref || '')?.[1];
  if (!letras) return null;
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function descomprimir(buffer) {
  if (!buffer || buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new ErrorPlanilla('El archivo no es una planilla Excel (.xlsx). Si está en .xls o .csv, ábralo en Excel y guárdelo como «Libro de Excel (.xlsx)».');
  }
  let demasiadoGrande = false;
  let archivos;
  try {
    archivos = unzipSync(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length), {
      filter: (f) => {
        if (!/^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(f.name)) return false;
        if (f.originalSize > MAX_DESCOMPRIMIDO) demasiadoGrande = true;
        return !demasiadoGrande;
      },
    });
  } catch {
    throw new ErrorPlanilla('No se pudo abrir la planilla. Verifique que no esté dañada.');
  }
  if (demasiadoGrande) throw new ErrorPlanilla('La planilla es demasiado grande.');
  const leer = (n) => (archivos[n] ? Buffer.from(archivos[n]).toString('utf8') : null);
  return leer;
}

/**
 * Lee una hoja de un .xlsx y devuelve sus filas como arreglos de texto
 * ({ numero, celdas }), con el número de fila tal como se ve en Excel.
 * Elige la hoja cuyo nombre coincide con `preferida` o, si no hay, la primera.
 */
function leerHoja(buffer, { preferida } = {}) {
  const leer = descomprimir(buffer);
  const libro = leer('xl/workbook.xml');
  const rels = leer('xl/_rels/workbook.xml.rels');
  if (!libro || !rels) throw new ErrorPlanilla('El archivo no es una planilla Excel (.xlsx) válida.');

  const hojas = [...libro.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    nombre: atributo(m[0], 'name') || '',
    rid: atributo(m[0], 'r:id'),
  }));
  if (!hojas.length) throw new ErrorPlanilla('La planilla no tiene hojas.');
  const normal = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const hoja = (preferida && hojas.find((h) => normal(h.nombre) === normal(preferida))) || hojas[0];

  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => atributo(r, 'Id') === hoja.rid);
  let destino = rel && atributo(rel, 'Target');
  if (!destino) throw new ErrorPlanilla('No se encontró la hoja en la planilla.');
  destino = destino.startsWith('/') ? destino.slice(1) : `xl/${destino}`;
  const xml = leer(destino.replace(/\/\.\//g, '/'));
  if (!xml) throw new ErrorPlanilla('No se encontró la hoja en la planilla.');

  const compartidos = [];
  const sst = leer('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) compartidos.push(m[1] ? textoDe(m[1]) : '');

  const filas = [];
  let numeroAnterior = 0;
  for (const fila of xml.matchAll(/<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const numero = Number(atributo(fila[1], 'r')) || numeroAnterior + 1;
    numeroAnterior = numero;
    if (!fila[2]) continue;
    if (filas.length >= MAX_FILAS) throw new ErrorPlanilla(`La planilla tiene demasiadas filas (máximo ${MAX_FILAS}).`);
    const celdas = [];
    let siguiente = 0;
    for (const c of fila[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = columna(atributo(c[1], 'r')) ?? siguiente;
      siguiente = col + 1;
      if (col >= MAX_COLUMNAS || !c[2]) continue;
      const tipo = atributo(c[1], 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2])?.[1];
      let valor;
      if (tipo === 's') valor = compartidos[Number(v)] ?? '';
      else if (tipo === 'inlineStr') valor = textoDe(/<is>([\s\S]*?)<\/is>/.exec(c[2])?.[1] || '');
      else if (tipo === 'b') valor = v === '1' ? 'VERDADERO' : 'FALSO';
      else valor = v === undefined ? '' : decodificar(v);
      celdas[col] = valor;
    }
    filas.push({ numero, celdas: Array.from(celdas, (x) => x ?? '') });
  }
  return { hoja: hoja.nombre, filas };
}

module.exports = { leerHoja, ErrorPlanilla };
