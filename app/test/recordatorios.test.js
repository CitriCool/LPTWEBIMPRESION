'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recordatorioQueToca } = require('../src/lib/recordatorios');
const { ocupacionPorDia, rangoCalendario } = require('../src/lib/prestamos');

const HOY = '2026-11-04';
// Entregado hace dos días, a mediodía
const base = { estado: 'entregado', entregado_en: new Date('2026-11-02T12:00:00'), recordatorio_previo_en: null, recordatorio_vence_en: null, recordatorio_atraso_en: null };

test('recordatorio: el día antes, el mismo día y al atrasarse', () => {
  assert.equal(recordatorioQueToca({ ...base, fecha_hasta: '2026-11-05' }, HOY), 'previo');
  assert.equal(recordatorioQueToca({ ...base, fecha_hasta: '2026-11-04' }, HOY), 'vence');
  assert.equal(recordatorioQueToca({ ...base, fecha_hasta: '2026-11-03' }, HOY), 'atraso');
  assert.equal(recordatorioQueToca({ ...base, fecha_hasta: '2026-11-07' }, HOY), null);
});

test('recordatorio: cada uno se envía una sola vez', () => {
  const enviado = new Date();
  assert.equal(recordatorioQueToca({ ...base, fecha_hasta: '2026-11-05', recordatorio_previo_en: enviado }, HOY), null);
  assert.equal(recordatorioQueToca({ ...base, fecha_hasta: '2026-11-04', recordatorio_vence_en: enviado }, HOY), null);
  assert.equal(recordatorioQueToca({ ...base, fecha_hasta: '2026-11-01', recordatorio_atraso_en: enviado }, HOY), null);
  // Haber enviado el del día antes no impide el del día del vencimiento
  assert.equal(recordatorioQueToca({ ...base, fecha_hasta: '2026-11-04', recordatorio_previo_en: enviado }, HOY), 'vence');
});

test('recordatorio: solo equipos afuera, y no el mismo día de la entrega', () => {
  for (const estado of ['solicitado', 'aprobado', 'devuelto', 'cancelado']) {
    assert.equal(recordatorioQueToca({ ...base, estado, fecha_hasta: '2026-11-03' }, HOY), null);
  }
  const hoyMismo = { ...base, entregado_en: new Date('2026-11-04T10:00:00') };
  assert.equal(recordatorioQueToca({ ...hoyMismo, fecha_hasta: '2026-11-04' }, HOY), null);
  assert.equal(recordatorioQueToca({ ...hoyMismo, fecha_hasta: '2026-11-05' }, HOY), null);
});

test('calendario: rango desde la fecha pedida, de 1 a 62 días', () => {
  assert.deepEqual(rangoCalendario('2026-11-02', '28', HOY), { desde: '2026-11-02', hasta: '2026-11-29', dias: 28 });
  assert.deepEqual(rangoCalendario('', undefined, HOY), { desde: HOY, hasta: '2026-12-01', dias: 28 });
  assert.equal(rangoCalendario('no-es-fecha', 500, HOY).dias, 62);
  assert.equal(rangoCalendario('2026-11-02', -3, HOY).dias, 1);
  assert.equal(rangoCalendario("2026-11-02' OR 1", 7, HOY).desde, HOY);
});

test('ocupación: unidades libres por día con préstamos solapados', () => {
  const prestamos = [
    { unidad_id: 1, fecha_desde: '2026-11-02', fecha_hasta: '2026-11-03' },
    { unidad_id: 2, fecha_desde: '2026-11-03', fecha_hasta: '2026-11-05' },
  ];
  assert.deepEqual(ocupacionPorDia(prestamos, 2, '2026-11-01', 6), [
    { fecha: '2026-11-01', libres: 2 },
    { fecha: '2026-11-02', libres: 1 },
    { fecha: '2026-11-03', libres: 0 },
    { fecha: '2026-11-04', libres: 1 },
    { fecha: '2026-11-05', libres: 1 },
    { fecha: '2026-11-06', libres: 2 },
  ]);
  // Nunca negativo si hay menos unidades operativas que préstamos (una pasó a mantención)
  assert.equal(ocupacionPorDia(prestamos, 1, '2026-11-03', 1)[0].libres, 0);
});

test('ocupación: un equipo atrasado sigue ocupando su unidad hasta hoy', () => {
  const { finEfectivo } = require('../src/lib/prestamos');
  const atrasado = { estado: 'entregado', unidad_id: 1, fecha_desde: '2026-10-30', fecha_hasta: '2026-11-02' };
  assert.equal(finEfectivo(atrasado, HOY), HOY);
  assert.equal(finEfectivo({ ...atrasado, estado: 'aprobado' }, HOY), '2026-11-02');
  const dias = ocupacionPorDia([atrasado], 2, HOY, 2, HOY);
  assert.deepEqual(dias.map((d) => d.libres), [1, 2]);
});

test('calendario: fechas fuera de rango vuelven a hoy', () => {
  assert.equal(rangoCalendario('9999-12-30', 5, HOY).desde, HOY);
  assert.equal(rangoCalendario('1900-01-01', 5, HOY).desde, HOY);
});
