'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { diasEntre, correoInstitucional, validarFechas, validarSolicitud } = require('../src/lib/prestamos');

// Mediodía en Chile para que "hoy" no dependa de la hora de la prueba
const ahora = new Date('2026-11-02T15:00:00Z');

test('los días cuentan ambos extremos', () => {
  assert.equal(diasEntre('2026-11-02', '2026-11-02'), 1);
  assert.equal(diasEntre('2026-11-02', '2026-11-04'), 3);
  assert.equal(diasEntre('2026-10-31', '2026-11-01'), 2);
});

test('solo correos institucionales (dominio exacto)', () => {
  assert.ok(correoInstitucional('ana@alu.uct.cl'));
  assert.ok(correoInstitucional('Prof@UCT.cl'));
  assert.ok(!correoInstitucional('ana@gmail.com'));
  assert.ok(!correoInstitucional('ana@uct.cl.falso.com'));
  assert.ok(!correoInstitucional('ana@xuct.cl'));
});

test('fechas: desde hoy, en orden, dentro del plazo y de la anticipación', () => {
  assert.deepEqual(validarFechas('2026-11-02', '2026-11-04', 3, ahora), { dias: 3 });
  assert.match(validarFechas('2026-11-01', '2026-11-02', 3, ahora).error, /anterior a hoy/);
  assert.match(validarFechas('2026-11-04', '2026-11-03', 3, ahora).error, /después/);
  assert.match(validarFechas('2026-11-02', '2026-11-05', 3, ahora).error, /máximo de 3/);
  assert.match(validarFechas('2027-03-01', '2027-03-01', 3, ahora).error, /anticipación/);
  assert.match(validarFechas('', '2026-11-02', 3, ahora).error, /fechas/);
});

test('solicitud: exige datos, correo UCT y aceptar condiciones', () => {
  const base = {
    equipo_id: '1', nombre: 'Ana Pérez', rut: '12345678-5', email: 'ana@alu.uct.cl', telefono: '+56 9 1234 5678',
    tipo: 'estudiante', unidad: 'Geografía', motivo: 'Trabajo de campo', desde: '2026-11-02', hasta: '2026-11-03', acepta: true,
  };
  const d = validarSolicitud(base);
  assert.equal(d.rut, '12.345.678-5');
  assert.equal(d.equipo_id, 1);
  assert.throws(() => validarSolicitud({ ...base, email: 'ana@gmail.com' }), /institucional/);
  assert.throws(() => validarSolicitud({ ...base, acepta: false }), /condiciones/);
  assert.throws(() => validarSolicitud({ ...base, tipo: 'otro' }), /estudiante/);
});

test('entrega: desde el día de retiro hasta la devolución; atraso después', () => {
  const { entregableHoy, atrasado } = require('../src/lib/prestamos');
  const p = { estado: 'aprobado', retiro_en: null, fecha_desde: '2026-11-05', fecha_hasta: '2026-11-06' };
  assert.equal(entregableHoy(p, '2026-11-04'), false);
  assert.equal(entregableHoy(p, '2026-11-05'), true);
  assert.equal(entregableHoy(p, '2026-11-07'), false);
  assert.equal(entregableHoy({ ...p, estado: 'solicitado' }, '2026-11-05'), false);
  const fuera = { estado: 'entregado', fecha_hasta: '2026-11-06' };
  assert.equal(atrasado(fuera, '2026-11-06'), false);
  assert.equal(atrasado(fuera, '2026-11-07'), true);
});
