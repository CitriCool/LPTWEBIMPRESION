'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { idEnRuta } = require('../src/lib/validacion');
const usuarios = require('../src/lib/usuarios');
const { pool } = require('../src/lib/db');

test.after(() => pool.end());

function probarId(id) {
  let siguio = false;
  let estado = 200;
  const res = { status: (s) => ((estado = s), res), json: () => res };
  idEnRuta({}, res, () => (siguio = true), id);
  return siguio ? 'sigue' : estado;
}

test('ids de la URL: solo enteros positivos pasan, el resto es 404 (antes era 500)', () => {
  assert.strictEqual(probarId('1'), 'sigue');
  assert.strictEqual(probarId('42'), 'sigue');
  for (const malo of ['abc', '0', '-1', '1.5', '1e3', '', '12345678901']) assert.strictEqual(probarId(malo), 404, malo);
});

test('crear usuario valida correo y largo de la contraseña antes de tocar la base', async () => {
  await assert.rejects(usuarios.crearUsuario({ email: 'no-es-correo', password: 'clave-larga-ok' }), /correo válido/);
  await assert.rejects(usuarios.crearUsuario({ email: 'a@uct.cl', password: 'corta' }), /entre 10 y 200/);
  await assert.rejects(usuarios.cambiarClave(1, 'corta'), /entre 10 y 200/);
});
