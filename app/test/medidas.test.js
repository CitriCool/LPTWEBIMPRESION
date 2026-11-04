'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tamanoHoja, revisarPaginas } = require('../public/js/medidas');

const PT = 72 / 0.0254; // puntos por metro
const pagina = (anchoPt, altoPt) => ({ ancho_m: anchoPt / PT, alto_m: altoPt / PT });

test('reconoce tamaños de hoja en cualquier orientación', () => {
  assert.equal(tamanoHoja(0.21, 0.297).nombre, 'A4');
  assert.equal(tamanoHoja(0.297, 0.21).nombre, 'A4');
  assert.equal(tamanoHoja(0.841, 1.189).nombre, 'A0');
  // Carta en puntos (612 × 792)
  assert.equal(tamanoHoja(612 / PT, 792 / PT).nombre, 'Carta');
  assert.equal(tamanoHoja(0.9, 1.5), null);
});

test('marca las páginas que superan el ancho máximo (lado menor)', () => {
  const r = revisarPaginas([pagina(2384, 3370), { ancho_m: 1.2, alto_m: 1.05 }, { ancho_m: 1.0005, alto_m: 3 }], 1);
  assert.deepEqual(r.excedidas, [2]);
  assert.equal(r.filas[0].tamano, 'A0');
  assert.equal(r.filas[1].ancho_m, 1.05);
  assert.equal(r.filas[1].alto_m, 1.2);
  assert.ok(Math.abs(r.filas[1].area_m2 - 1.26) < 1e-9);
  assert.equal(r.todasOficina, false);
});

test('avisa cuando todas las páginas son de oficina', () => {
  assert.equal(revisarPaginas([pagina(595, 842), pagina(612, 792)], 1).todasOficina, true);
  assert.equal(revisarPaginas([pagina(595, 842), pagina(1684, 2384)], 1).todasOficina, false);
  assert.equal(revisarPaginas([], 1).todasOficina, false);
});
