'use strict';

// Token de acceso de "Mi pedido" y "Mi préstamo". El código (LPT-2026-00042) es
// correlativo y el correo se puede adivinar, así que para modificar algo (subir el
// comprobante, cancelar) se exige además este token, que solo viaja en el enlace
// del correo y en la respuesta al crear el pedido.
const crypto = require('crypto');

/** 16 bytes al azar (128 bits) en base64url: 22 caracteres. */
function nuevoTokenAcceso() {
  return crypto.randomBytes(16).toString('base64url');
}

/** Compara en tiempo constante el token recibido con el guardado. */
function tokenValido(guardado, recibido) {
  if (typeof guardado !== 'string' || typeof recibido !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(recibido)) return false;
  const a = Buffer.from(guardado);
  const b = Buffer.from(recibido);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { nuevoTokenAcceso, tokenValido };
