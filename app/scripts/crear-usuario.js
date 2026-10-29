'use strict';

// Uso: docker compose exec app npm run crear-usuario -- "Nombre" correo@uct.cl "clave-segura" [admin|operador]
const { crearUsuario } = require('../src/lib/usuarios');
const { pool } = require('../src/lib/db');

const [nombre, email, password, rol = 'operador'] = process.argv.slice(2);

crearUsuario({ nombre, email, password, rol: rol === 'admin' ? 'admin' : 'operador' })
  .then(() => console.log(`Usuario ${email} creado (${rol}).`))
  .catch((e) => {
    console.error('Error:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
