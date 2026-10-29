'use strict';

// Lógica pura de cotización: sin base de datos para poder probarla aislada.

const { reglas } = require('../config');

const PUNTOS_POR_METRO = 72 / 0.0254; // 1 pt PDF = 1/72 pulgada

function puntosAMetros(pt) {
  return pt / PUNTOS_POR_METRO;
}

function redondear(valor, decimales) {
  const f = 10 ** decimales;
  return Math.round(valor * f) / f;
}

/**
 * El plóter trabaja con un rollo de 1 m, por lo que el lado que va contra el
 * rollo (el "ancho") es el lado menor de la hoja; el largo no tiene límite.
 * Devuelve { ancho, alto } con ancho <= alto.
 */
function orientar(a, b) {
  return a <= b ? { ancho: a, alto: b } : { ancho: b, alto: a };
}

function anchoPermitido(anchoM) {
  return anchoM > 0 && anchoM <= reglas.anchoMaxM + reglas.toleranciaM;
}

/**
 * Calcula el costo de un trabajo.
 * @param {Array<{ancho_m:number, alto_m:number}>} paginas medidas de cada página en metros
 * @param {number} precioM2 tarifa CLP por m²
 * @param {number} copias  número de copias del juego completo
 */
function cotizar(paginas, precioM2, copias = 1) {
  if (!Array.isArray(paginas) || paginas.length === 0) {
    throw new ErrorCotizacion('Debe indicar al menos una página.');
  }
  copias = Number(copias);
  if (!Number.isInteger(copias) || copias < 1 || copias > reglas.maxCopias) {
    throw new ErrorCotizacion(`Las copias deben ser un número entero entre 1 y ${reglas.maxCopias}.`);
  }
  if (!Number.isInteger(precioM2) || precioM2 <= 0) {
    throw new ErrorCotizacion('Tarifa de papel inválida.');
  }

  let areaPorCopia = 0;
  let mayor = { ancho: 0, alto: 0 };
  paginas.forEach((p, i) => {
    const ancho = Number(p.ancho_m);
    const alto = Number(p.alto_m);
    if (!(ancho > 0) || !(alto > 0)) {
      throw new ErrorCotizacion(`Medidas inválidas en la página ${i + 1}.`);
    }
    const o = orientar(ancho, alto);
    if (!anchoPermitido(o.ancho)) {
      throw new ErrorCotizacion(
        `La página ${i + 1} mide ${aCm(o.ancho)} × ${aCm(o.alto)} cm: ningún lado cabe en el ancho máximo de ${aCm(reglas.anchoMaxM)} cm.`
      );
    }
    areaPorCopia += o.ancho * o.alto;
    if (o.ancho * o.alto > mayor.ancho * mayor.alto) mayor = o;
  });

  const area = areaPorCopia * copias;
  return {
    paginas: paginas.length,
    copias,
    ancho_m: redondear(mayor.ancho, 3),
    alto_m: redondear(mayor.alto, 3),
    area_m2: redondear(area, 4),
    precio_m2: precioM2,
    total_clp: Math.round(area * precioM2),
  };
}

function aCm(m) {
  return redondear(m * 100, 1).toLocaleString('es-CL');
}

/** Suma días hábiles (lunes a viernes) a una fecha. No considera feriados. */
function sumarDiasHabiles(desde, dias) {
  const d = new Date(desde.getTime());
  let restantes = dias;
  while (restantes > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) restantes--;
  }
  return d;
}

class ErrorCotizacion extends Error {
  constructor(msg) {
    super(msg);
    this.status = 400;
    this.publico = true;
  }
}

module.exports = {
  PUNTOS_POR_METRO,
  puntosAMetros,
  orientar,
  anchoPermitido,
  cotizar,
  sumarDiasHabiles,
  ErrorCotizacion,
};
