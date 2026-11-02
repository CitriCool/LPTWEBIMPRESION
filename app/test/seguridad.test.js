'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { nuevoTokenAcceso, tokenValido } = require('../src/lib/acceso');
const { correoValido } = require('../src/lib/validacion');
const config = require('../src/config');

test('el token de acceso es aleatorio y de 22 caracteres', () => {
  const a = nuevoTokenAcceso();
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(a, nuevoTokenAcceso());
});

test('solo el token exacto da acceso', () => {
  const t = nuevoTokenAcceso();
  assert.ok(tokenValido(t, t));
  assert.ok(!tokenValido(t, nuevoTokenAcceso()));
  assert.ok(!tokenValido(t, ''));
  assert.ok(!tokenValido(t, undefined));
  assert.ok(!tokenValido(t, { $ne: '' }));
  assert.ok(!tokenValido(t, [t]));
  assert.ok(!tokenValido(null, t), 'un pedido sin token no se puede modificar');
});

test('el correo no acepta caracteres que agreguen destinatarios', () => {
  assert.ok(correoValido('ana.perez@alu.uct.cl'));
  assert.ok(correoValido('vmilic+prueba@gmail.com'));
  for (const malo of ['a,b@uct.cl', 'a;b@uct.cl', '"a"@uct.cl', 'a<b>@uct.cl', 'a@uct', 'a b@uct.cl', 'a@@uct.cl', 'ana@uct.cl,otro@x.com']) {
    assert.ok(!correoValido(malo), malo);
  }
});

test('la configuración de ejemplo se rechaza y una clave larga se acepta', () => {
  const base = { session: { secret: 'cambiar-por-una-cadena-larga-y-aleatoria' }, admin: { password: 'cambiar-esta-clave-admin' } };
  assert.equal(config.problemasDeConfiguracion(base).length, 2);
  assert.equal(config.problemasDeConfiguracion({ ...base, session: { secret: 'corta' } }).length, 2);
  const buena = { session: { secret: 'a'.repeat(64) }, admin: { password: 'Una-Clave-Propia-123' } };
  assert.deepEqual(config.problemasDeConfiguracion(buena), []);
});

test('trust proxy por defecto solo confía en la red interna', () => {
  assert.equal(config.trustProxy, 'loopback, linklocal, uniquelocal');
});
