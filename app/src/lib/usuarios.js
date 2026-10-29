'use strict';

const bcrypt = require('bcryptjs');
const { query } = require('./db');

async function crearUsuario({ nombre, email, password, rol = 'operador' }) {
  if (!email || !password || password.length < 10) {
    throw new Error('Se requiere email y una contraseña de al menos 10 caracteres.');
  }
  const hash = await bcrypt.hash(password, 12);
  await query('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)', [
    nombre || email,
    email.trim().toLowerCase(),
    hash,
    rol,
  ]);
}

// Hash fijo para comparar aunque el usuario no exista (evita revelar emails por tiempo de respuesta)
const HASH_FALSO = bcrypt.hashSync('usuario-inexistente', 12);

async function autenticar(email, password) {
  const [u] = await query('SELECT * FROM usuarios WHERE email = ? AND activo = 1', [
    String(email || '').trim().toLowerCase(),
  ]);
  const ok = await bcrypt.compare(String(password || ''), u ? u.password_hash : HASH_FALSO);
  if (!u || !ok) return null;
  await query('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [u.id]);
  return { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol };
}

/** Crea el administrador inicial desde variables de entorno si no hay usuarios. */
async function asegurarAdmin({ nombre, email, password }) {
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM usuarios');
  if (n > 0) return false;
  if (!email || !password) {
    console.warn('No hay usuarios y ADMIN_EMAIL / ADMIN_PASSWORD no están definidos: el panel no tendrá acceso.');
    return false;
  }
  await crearUsuario({ nombre, email, password, rol: 'admin' });
  console.log(`Usuario administrador inicial creado: ${email}`);
  return true;
}

module.exports = { crearUsuario, autenticar, asegurarAdmin };
