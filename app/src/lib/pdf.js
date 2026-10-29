'use strict';

const { PDFDocument } = require('pdf-lib');
const { puntosAMetros, ErrorCotizacion } = require('./cotizador');
const { reglas } = require('../config');

/**
 * Valida que el buffer sea un PDF legible y devuelve las medidas de cada
 * página en metros. Se usa la CropBox (área visible / de impresión), que por
 * defecto es igual a la MediaBox.
 */
async function analizarPdf(buffer) {
  if (!buffer || buffer.length < 5 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new ErrorCotizacion('El archivo no es un PDF válido.');
  }

  let paginas;
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    paginas = doc.getPages();
  } catch (e) {
    throw new ErrorCotizacion('No se pudo leer el PDF. Verifique que no esté dañado.');
  }

  if (paginas.length === 0) throw new ErrorCotizacion('El PDF no tiene páginas.');
  if (paginas.length > reglas.maxPaginas) {
    throw new ErrorCotizacion(`El PDF tiene ${paginas.length} páginas; el máximo por pedido es ${reglas.maxPaginas}.`);
  }

  return paginas.map((p) => {
    const caja = p.getCropBox();
    return {
      ancho_m: puntosAMetros(Math.abs(caja.width)),
      alto_m: puntosAMetros(Math.abs(caja.height)),
    };
  });
}

module.exports = { analizarPdf };
