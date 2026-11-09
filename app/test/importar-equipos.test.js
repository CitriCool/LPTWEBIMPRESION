'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { zipSync, strToU8 } = require('fflate');
const { leerHoja } = require('../src/lib/xlsx');
const { extraerRegistros, validar } = require('../src/lib/importar-equipos');
const { generarPdf } = require('../src/lib/etiquetas-pdf');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Arma un .xlsx mínimo con textos en línea (como lo guardan otras planillas además de Excel). */
function xlsx(filas) {
  const col = (i) => String.fromCharCode(65 + i);
  const hoja = filas
    .map((f, r) => `<row r="${r + 1}">${f
      .map((v, i) => (v === null ? '' : `<c r="${col(i)}${r + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`))
      .join('')}</row>`)
    .join('');
  return Buffer.from(zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Dispositivos" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${hoja}</sheetData></worksheet>`),
  }));
}

const ENCABEZADOS = ['ID del dispositivo', 'Nombre del dispositivo', 'Tipo de dispositivo', 'QR del dispositivo', 'Marca / modelo', 'N° de serie', 'Ubicación', 'Estado', 'Accesorios'];
const CONTEXTO = {
  categorias: [{ id: 1, nombre: 'Notebooks' }, { id: 2, nombre: 'Drones' }],
  equipos: [{ id: 7, nombre: 'Dron DJI Mini 3', categoria_id: 2 }],
  inventarios: ['UCT-001'],
};

function revisar(filas) {
  const { filas: leidas } = leerHoja(xlsx([['Registro de dispositivos para préstamo – LPT'], ENCABEZADOS, ...filas]));
  return validar(extraerRegistros(leidas), CONTEXTO);
}

test('lee la planilla en blanco del panel y encuentra los encabezados en la fila 2', () => {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'public', 'plantillas', 'registro-dispositivos-prestamo.xlsx'));
  const { hoja, filas } = leerHoja(buf, { preferida: 'Dispositivos' });
  assert.equal(hoja, 'Dispositivos');
  assert.deepEqual(filas[1].celdas.slice(0, 3), ENCABEZADOS.slice(0, 3));
  assert.equal(extraerRegistros(filas).length, 0);
});

test('agrupa por nombre y tipo, reconoce equipos y tipos existentes y crea los nuevos', () => {
  const r = revisar([
    ['UCT-100', 'Notebook Lenovo ThinkPad', 'notebooks', '(lo genera la web)', 'Lenovo E14', 'PF1', 'Estante 2', 'Disponible', 'cargador'],
    ['UCT-101', 'Notebook Lenovo ThinkPad', 'Notebooks', '', 'Lenovo E14', 'PF2', 'Estante 2', '', ''],
    ['UCT-102', 'dron dji mini 3', 'Drones', '', '', '', '', 'En mantencion', ''],
    ['UCT-103', 'Cámara Sony', 'Cámaras', '', '', '', '', 'De baja', ''],
    [null, null, null, null, null, null, null, null, null],
  ]);
  assert.equal(r.total, 4);
  assert.equal(r.con_error, 0);
  assert.deepEqual(r.categorias_nuevas, ['Cámaras']);
  assert.deepEqual(r.equipos_nuevos.map((e) => [e.nombre, e.tipo, e.unidades]), [
    ['Notebook Lenovo ThinkPad', 'Notebooks', 2],
    ['Cámara Sony', 'Cámaras', 1],
  ]);
  assert.deepEqual(r.equipos_existentes, [{ id: 7, nombre: 'Dron DJI Mini 3', tipo: 'Drones', unidades: 1 }]);
  assert.deepEqual(r.filas.map((f) => f.estado), ['disponible', 'disponible', 'mantencion', 'baja']);
  assert.equal(r.filas[0].fila, 3); // número de fila como se ve en Excel
});

test('marca las filas con errores: obligatorios, ID repetido o ya registrado, estado inválido', () => {
  const r = revisar([
    ['UCT-200', 'Notebook HP', 'Notebooks', '', '', '', '', '', ''],
    ['uct-200', 'Notebook HP', 'Notebooks', '', '', '', '', '', ''],
    ['UCT-001', 'Notebook HP', 'Notebooks', '', '', '', '', '', ''],
    ['', 'Notebook HP', '', '', '', '', '', 'Prestado', ''],
    ['UCT#9', 'X', 'Notebooks', '', '', '', '', '', ''],
  ]);
  assert.equal(r.con_error, 4);
  assert.deepEqual(r.filas[0].errores, []);
  assert.match(r.filas[1].errores[0], /repetido.*fila 3/);
  assert.match(r.filas[2].errores[0], /Ya hay un dispositivo/);
  assert.deepEqual(r.filas[3].errores.length, 3); // sin ID, sin tipo, estado inválido
  assert.equal(r.filas[4].errores.length, 2); // ID con # y nombre muy corto
  assert.equal(r.equipos_nuevos[0].unidades, 1); // solo cuentan las filas válidas
});

test('avisa (sin bloquear) cuando un mismo equipo trae marca distinta', () => {
  const r = revisar([
    ['A-1', 'Tablet', 'Notebooks', '', 'Samsung A8', '', '', '', ''],
    ['A-2', 'Tablet', 'Notebooks', '', 'Samsung A9', '', '', '', ''],
  ]);
  assert.equal(r.con_error, 0);
  assert.match(r.filas[1].avisos[0], /Samsung A8/);
});

test('rechaza archivos que no son .xlsx o sin los encabezados', () => {
  assert.throws(() => leerHoja(Buffer.from('ID;Nombre\n1;2')), /no es una planilla Excel/);
  assert.throws(() => extraerRegistros(leerHoja(xlsx([['a', 'b']])).filas), /encabezados/);
  assert.throws(() => extraerRegistros(leerHoja(xlsx([['ID del dispositivo', 'Nombre']])).filas), /Tipo de dispositivo/);
});

test('el PDF de etiquetas trae una hoja cada 24 QR', async () => {
  const { PDFDocument } = require('pdf-lib');
  const etiquetas = Array.from({ length: 25 }, (_, i) => ({
    inventario: `UCT-INV-${String(i).padStart(6, '0')}`,
    equipo_nombre: 'Notebook Lenovo ThinkPad E14 con nombre bastante largo 🙂',
    url: `https://ejemplo.cl/q/abcdefghij${String(i).padStart(2, '0')}`,
  }));
  const pdf = await PDFDocument.load(await generarPdf(etiquetas));
  assert.equal(pdf.getPageCount(), 2);
});
