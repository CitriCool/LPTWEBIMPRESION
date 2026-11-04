'use strict';

// Cambia la contraseña de un usuario del panel y cierra todas sus sesiones abiertas.
// Sirve también si se olvidó la clave del administrador: cambiar ADMIN_PASSWORD en .env
// no la cambia, porque ese valor solo se usa al crear el primer usuario.
// Uso: docker compose exec app npm run cambiar-clave -- correo@uct.cl "clave-nueva-segura"
const usuarios = require('../src/lib/usuarios');
const { pool } = require('../src/lib/db');

const [email, nueva] = process.argv.slice(2);

(async () => {
  const u = await usuarios.porEmail(email);
  if (!u) throw new Error(`No existe un usuario con el correo ${email}.`);
  await usuarios.cambiarClave(u.id, nueva);
  console.log(`Contraseña de ${u.email} cambiada; sus sesiones abiertas se cerraron.${u.activo ? '' : ' Ojo: la cuenta está desactivada.'}`);
})()
  .catch((e) => {
    console.error('Error:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
