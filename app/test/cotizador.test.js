'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { cotizar, sumarDiasHabiles, PUNTOS_POR_METRO } = require('../src/lib/cotizador');
const { analizarPdf } = require('../src/lib/pdf');
const { rutValido, formatearRut } = require('../src/lib/validacion');

const pt = (m) => m * PUNTOS_POR_METRO;

test('A0 (84,1 × 118,9 cm) en Bond', () => {
  const r = cotizar([{ ancho_m: 0.841, alto_m: 1.189 }], 6000);
  assert.equal(r.area_m2, 0.9999);
  assert.equal(r.total_clp, 6000);
});

test('1 m × 1 m satinado, 3 copias', () => {
  const r = cotizar([{ ancho_m: 1, alto_m: 1 }], 17000, 3);
  assert.equal(r.area_m2, 3);
  assert.equal(r.total_clp, 51000);
});

test('se acepta una hoja apaisada si su lado menor cabe en el rollo', () => {
  const r = cotizar([{ ancho_m: 1.5, alto_m: 0.9 }], 9000);
  assert.equal(r.ancho_m, 0.9);
  assert.equal(r.alto_m, 1.5);
  assert.equal(r.total_clp, 12150);
});

test('rechaza si ambos lados superan 1 m', () => {
  assert.throws(() => cotizar([{ ancho_m: 1.2, alto_m: 1.1 }], 6000), /ancho máximo/);
});

test('tolera 1 mm por redondeo de conversión', () => {
  assert.doesNotThrow(() => cotizar([{ ancho_m: 1.0008, alto_m: 2 }], 6000));
});

test('suma todas las páginas y valida copias', () => {
  const r = cotizar([{ ancho_m: 0.5, alto_m: 0.5 }, { ancho_m: 0.6, alto_m: 0.9 }], 6000, 2);
  assert.equal(r.area_m2, 1.58);
  assert.equal(r.total_clp, 9480);
  assert.equal(r.paginas, 2);
  assert.throws(() => cotizar([{ ancho_m: 0.5, alto_m: 0.5 }], 6000, 0), /copias/);
  assert.throws(() => cotizar([{ ancho_m: 0.5, alto_m: 0.5 }], 6000, 1.5), /copias/);
});

test('días hábiles saltan el fin de semana', () => {
  const viernes = new Date(2026, 9, 30); // viernes 30-oct-2026
  const r = sumarDiasHabiles(viernes, 2);
  assert.equal(r.getDay(), 2); // martes 3-nov
  assert.equal(r.getDate(), 3);
});

test('lee las medidas reales de un PDF', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([pt(0.6), pt(0.9)]);
  doc.addPage([pt(1.2), pt(0.8)]);
  const paginas = await analizarPdf(Buffer.from(await doc.save()));
  assert.equal(paginas.length, 2);
  assert.ok(Math.abs(paginas[0].ancho_m - 0.6) < 1e-6);
  assert.ok(Math.abs(paginas[1].alto_m - 0.8) < 1e-6);
  const r = cotizar(paginas, 6000);
  assert.equal(r.total_clp, Math.round((0.54 + 0.96) * 6000));
});

test('rechaza archivos que no son PDF', async () => {
  await assert.rejects(analizarPdf(Buffer.from('hola mundo')), /no es un PDF/);
  await assert.rejects(analizarPdf(Buffer.from('%PDF-1.4 basura')), /No se pudo leer/);
});

test('valida RUT chileno', () => {
  assert.ok(rutValido('12.345.678-5'));
  assert.ok(rutValido('11111111-1'));
  assert.ok(!rutValido('12.345.678-9'));
  assert.ok(!rutValido('abc'));
  assert.equal(formatearRut('12345678-5'), '12.345.678-5');
  assert.equal(formatearRut('9.876.543-k'), '9.876.543-K');
});
