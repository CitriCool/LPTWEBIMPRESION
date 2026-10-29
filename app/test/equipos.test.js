'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { nuevoToken, qrSvg, urlQr, validarEquipo, validarUnidad } = require('../src/lib/equipos');

test('el token del QR tiene 12 caracteres seguros para URL y no se repite', () => {
  const tokens = new Set(Array.from({ length: 1000 }, nuevoToken));
  assert.equal(tokens.size, 1000);
  for (const t of tokens) assert.match(t, /^[A-Za-z0-9_-]{12}$/);
});

test('el QR es un SVG que apunta a /q/<token>', async () => {
  assert.match(urlQr('abcdefghijkl'), /\/q\/abcdefghijkl$/);
  assert.match(await qrSvg('abcdefghijkl'), /^<svg[\s\S]*<\/svg>\s*$/);
});

test('equipo: tarifa 0 es préstamo sin costo y el plazo es obligatorio', () => {
  const d = validarEquipo({ categoria_id: '1', nombre: 'Dron DJI', tarifa_dia_clp: '0', dias_max: '2' });
  assert.equal(d.tarifa_dia_clp, 0);
  assert.equal(d.dias_max, 2);
  assert.equal(d.activo, true);
  assert.throws(() => validarEquipo({ categoria_id: 1, nombre: 'Dron', tarifa_dia_clp: 0 }), /plazo/);
  assert.throws(() => validarEquipo({ categoria_id: 1, nombre: 'Dron', tarifa_dia_clp: 1.5, dias_max: 2 }), /nombre|tarifa/i);
});

test('unidad: n° de inventario válido y estados manuales', () => {
  assert.equal(validarUnidad({ inventario: '  UCT-000123 ' }).inventario, 'UCT-000123');
  assert.equal(validarUnidad({ inventario: 'INV 2024/15' }).estado, 'disponible');
  assert.throws(() => validarUnidad({ inventario: '' }), /inventario/);
  assert.throws(() => validarUnidad({ inventario: '<script>' }), /inventario/);
  // "Prestado" no se marca a mano, pero una unidad prestada sí se puede editar
  assert.throws(() => validarUnidad({ inventario: 'A1', estado: 'prestado' }), /Estado/);
  assert.equal(validarUnidad({ inventario: 'A1', estado: 'prestado' }, 'prestado').estado, 'prestado');
});
