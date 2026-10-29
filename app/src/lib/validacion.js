'use strict';

const { reglas } = require('../config');

class ErrorValidacion extends Error {
  constructor(errores) {
    super(Object.values(errores)[0]);
    this.status = 400;
    this.publico = true;
    this.errores = errores;
  }
}

function limpiar(v, max) {
  return String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

/** Valida un RUT chileno (con o sin puntos, con guion). */
function rutValido(rut) {
  const limpio = String(rut).replace(/[.\s]/g, '').toUpperCase();
  const m = /^(\d{7,8})-?([\dK])$/.exec(limpio);
  if (!m) return false;
  let suma = 0;
  let mult = 2;
  for (let i = m[1].length - 1; i >= 0; i--) {
    suma += Number(m[1][i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === m[2];
}

function formatearRut(rut) {
  const limpio = String(rut).replace(/[.\s-]/g, '').toUpperCase();
  const cuerpo = limpio.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${limpio.slice(-1)}`;
}

/**
 * Valida los datos del cliente. Se acepta RUT chileno (verificando el dígito)
 * o, si se marca extranjero, un pasaporte / documento alfanumérico.
 */
function validarCliente(body) {
  const errores = {};
  const datos = {
    nombre: limpiar(body.nombre, 120),
    rut: limpiar(body.rut, 20),
    email: limpiar(body.email, 160).toLowerCase(),
    telefono: limpiar(body.telefono, 30),
    unidad: limpiar(body.unidad, 160) || null,
    metodo_pago: limpiar(body.metodo_pago, 40),
    observaciones: String(body.observaciones ?? '').trim().slice(0, 1000) || null,
  };
  const extranjero = body.extranjero === 'true' || body.extranjero === 'on' || body.extranjero === true;

  if (datos.nombre.length < 3) errores.nombre = 'Ingrese su nombre completo.';
  if (extranjero) {
    if (!/^[A-Za-z0-9-]{5,20}$/.test(datos.rut)) errores.rut = 'Ingrese un documento de identidad válido.';
  } else if (!rutValido(datos.rut)) {
    errores.rut = 'El RUT no es válido (ej. 12.345.678-5).';
  } else {
    datos.rut = formatearRut(datos.rut);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(datos.email)) errores.email = 'Ingrese un correo válido.';
  if (!/^\+?[\d\s()-]{8,20}$/.test(datos.telefono)) errores.telefono = 'Ingrese un teléfono válido.';
  if (!reglas.metodosPago[datos.metodo_pago]) errores.metodo_pago = 'Seleccione una forma de pago.';
  if (body.acepta !== 'true' && body.acepta !== 'on') {
    errores.acepta = 'Debe confirmar que el PDF tiene las medidas finales de impresión.';
  }

  if (Object.keys(errores).length) throw new ErrorValidacion(errores);
  return datos;
}

module.exports = { ErrorValidacion, rutValido, formatearRut, validarCliente, limpiar };
