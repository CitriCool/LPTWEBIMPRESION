'use strict';

const bcrypt = require('bcryptjs');
const { query } = require('./db');
const { correoValido } = require('./validacion');

const CLAVE_MIN = 10;

function errorPublico(mensaje, status = 400) {
  return Object.assign(new Error(mensaje), { status, publico: true });
}

function validarClave(password) {
  if (typeof password !== 'string' || password.length < CLAVE_MIN || password.length > 200) {
    throw errorPublico(`La contraseña debe tener entre ${CLAVE_MIN} y 200 caracteres.`);
  }
}

async function crearUsuario({ nombre, email, password, rol = 'operador' }) {
  email = String(email ?? '').trim().toLowerCase();
  if (!correoValido(email)) throw errorPublico('Ingrese un correo válido.');
  validarClave(password);
  const hash = await bcrypt.hash(password, 12);
  await query('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)', [
    String(nombre ?? '').trim().slice(0, 120) || email,
    email,
    hash,
    rol,
  ]);
}

/**
 * Cambia la contraseña y cierra todas las sesiones abiertas de ese usuario (por si
 * la clave anterior se filtró). Devuelve el instante desde el que valen las sesiones,
 * para que quien la cambió desde el panel siga conectado.
 */
async function cambiarClave(id, nueva) {
  validarClave(nueva);
  const hash = await bcrypt.hash(nueva, 12);
  const desde = new Date();
  const r = await query('UPDATE usuarios SET password_hash = ?, sesion_desde = ? WHERE id = ?', [hash, desde, id]);
  if (!r.affectedRows) throw errorPublico('Usuario no encontrado.', 404);
  return desde.getTime();
}

/** El usuario conectado cambia su propia contraseña: debe confirmar la actual. */
async function cambiarClavePropia(id, actual, nueva) {
  const [u] = await query('SELECT password_hash FROM usuarios WHERE id = ? AND activo = 1', [id]);
  if (!u || !(await bcrypt.compare(String(actual ?? ''), u.password_hash))) {
    throw errorPublico('La contraseña actual no es correcta.');
  }
  if (actual === nueva) throw errorPublico('La contraseña nueva debe ser distinta de la actual.');
  return cambiarClave(id, nueva);
}

async function porEmail(email) {
  const [u] = await query('SELECT id, nombre, email, rol, activo FROM usuarios WHERE email = ?', [
    String(email ?? '').trim().toLowerCase(),
  ]);
  return u || null;
}

async function listarUsuarios() {
  return query('SELECT id, nombre, email, rol, activo, ultimo_acceso, creado_en FROM usuarios ORDER BY activo DESC, nombre');
}

/**
 * Activa o desactiva una cuenta. Desactivarla corta sus sesiones al instante
 * (sesionVigente exige activo = 1). Nadie se desactiva a sí mismo y siempre
 * queda al menos un administrador activo.
 */
async function cambiarActivo(id, activo, quien) {
  if (id === quien && !activo) throw errorPublico('No puede desactivar su propia cuenta.');
  const [u] = await query('SELECT id, rol, activo FROM usuarios WHERE id = ?', [id]);
  if (!u) throw errorPublico('Usuario no encontrado.', 404);
  if (!activo && u.rol === 'admin') {
    const [{ n }] = await query("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?", [id]);
    if (n === 0) throw errorPublico('Debe quedar al menos un administrador activo.');
  }
  await query('UPDATE usuarios SET activo = ? WHERE id = ?', [activo ? 1 : 0, id]);
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

/**
 * La sesión vive en una cookie firmada; en cada petición del panel se confirma
 * contra la base que el usuario siga activo, se toma su rol actual y se rechaza
 * si cerró sesión después de iniciar esta (sesion_desde). Devuelve el usuario o null.
 */
async function sesionVigente(usuario, inicio) {
  if (!usuario || !Number.isInteger(usuario.id)) return null;
  const [u] = await query('SELECT id, nombre, email, rol, sesion_desde FROM usuarios WHERE id = ? AND activo = 1', [usuario.id]);
  if (!u) return null;
  if (u.sesion_desde && !(Number(inicio) >= new Date(u.sesion_desde).getTime())) return null;
  return { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol };
}

/** Cerrar sesión invalida todas las sesiones abiertas de ese usuario, en cualquier equipo. */
async function cerrarSesiones(id) {
  await query('UPDATE usuarios SET sesion_desde = NOW(3) WHERE id = ?', [id]);
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

module.exports = {
  crearUsuario,
  autenticar,
  asegurarAdmin,
  sesionVigente,
  cerrarSesiones,
  cambiarClave,
  cambiarClavePropia,
  porEmail,
  listarUsuarios,
  cambiarActivo,
};
