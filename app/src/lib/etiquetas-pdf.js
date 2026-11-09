'use strict';

// PDF con las etiquetas QR de varias unidades, listo para imprimir en hoja A4
// (3 columnas × 8 filas por hoja), recortar y pegar en cada aparato.
const QRCode = require('qrcode');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const MM = 72 / 25.4;
const PAGINA = { ancho: 210 * MM, alto: 297 * MM };
const MARGEN = 10 * MM;
const COLUMNAS = 3;
const FILAS = 8;
const SEPARACION = 2 * MM;
const ANCHO = (PAGINA.ancho - 2 * MARGEN - (COLUMNAS - 1) * SEPARACION) / COLUMNAS;
const ALTO = (PAGINA.alto - 2 * MARGEN - (FILAS - 1) * SEPARACION) / FILAS;
const LADO_QR = ALTO - 4 * MM;

/** Quita los caracteres que la fuente estándar del PDF no puede dibujar (emojis, etc.). */
function aptoParaFuente(fuente, texto) {
  const soportados = new Set(fuente.getCharacterSet());
  return [...String(texto ?? '')].filter((c) => soportados.has(c.codePointAt(0))).join('');
}

/** Corta un texto en líneas que caben en `ancho`; la última termina en «…» si sobra texto. */
function lineas(fuente, texto, tamano, ancho, maximo) {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const salida = [];
  let actual = '';
  const cabe = (t) => fuente.widthOfTextAtSize(t, tamano) <= ancho;
  while (palabras.length) {
    let p = palabras.shift();
    // Palabra más larga que la línea: se parte
    while (!cabe(p) && p.length > 1) {
      let i = p.length - 1;
      while (i > 1 && !cabe(p.slice(0, i))) i--;
      palabras.unshift(p.slice(i));
      p = p.slice(0, i);
    }
    const prueba = actual ? `${actual} ${p}` : p;
    if (cabe(prueba)) actual = prueba;
    else {
      salida.push(actual);
      actual = p;
    }
  }
  if (actual) salida.push(actual);
  if (salida.length > maximo) {
    const ultimas = salida.slice(0, maximo);
    let u = ultimas[maximo - 1];
    while (u && !cabe(`${u}…`)) u = u.slice(0, -1);
    ultimas[maximo - 1] = `${u}…`;
    return ultimas;
  }
  return salida;
}

function dibujarQr(pagina, url, x, y, lado) {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const margen = 1; // un módulo en blanco alrededor
  const m = lado / (n + 2 * margen);
  for (let fila = 0; fila < n; fila++) {
    // Une los módulos negros contiguos de cada fila en un solo rectángulo
    let inicio = -1;
    for (let col = 0; col <= n; col++) {
      const negro = col < n && modules.get(fila, col);
      if (negro && inicio < 0) inicio = col;
      if (!negro && inicio >= 0) {
        pagina.drawRectangle({
          x: x + (margen + inicio) * m,
          y: y + lado - (margen + fila + 1) * m,
          width: (col - inicio) * m,
          height: m,
          color: rgb(0, 0, 0),
        });
        inicio = -1;
      }
    }
  }
}

/** @param etiquetas [{ inventario, equipo_nombre, url }] */
async function generarPdf(etiquetas, { titulo = 'Etiquetas QR' } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(titulo);
  doc.setCreator('Servicio de Impresión LPT');
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const gris = rgb(0.45, 0.48, 0.53);

  let pagina;
  etiquetas.forEach((e, i) => {
    const pos = i % (COLUMNAS * FILAS);
    if (pos === 0) pagina = doc.addPage([PAGINA.ancho, PAGINA.alto]);
    const col = pos % COLUMNAS;
    const fila = Math.floor(pos / COLUMNAS);
    const x = MARGEN + col * (ANCHO + SEPARACION);
    const y = PAGINA.alto - MARGEN - (fila + 1) * ALTO - fila * SEPARACION;

    // Borde punteado para recortar
    pagina.drawRectangle({ x, y, width: ANCHO, height: ALTO, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5, borderDashArray: [3, 3] });
    dibujarQr(pagina, e.url, x + 2 * MM, y + 2 * MM, LADO_QR);

    const tx = x + 2 * MM + LADO_QR + 2 * MM;
    const ancho = x + ANCHO - 2 * MM - tx;
    let ty = y + ALTO - 6 * MM;
    pagina.drawText('LPT · UCT', { x: tx, y: ty, size: 6.5, font: normal, color: gris });
    ty -= 5 * MM;
    for (const l of lineas(negrita, aptoParaFuente(negrita, e.inventario), 10, ancho, 2)) {
      pagina.drawText(l, { x: tx, y: ty, size: 10, font: negrita });
      ty -= 4.2 * MM;
    }
    ty -= 0.6 * MM;
    for (const l of lineas(normal, aptoParaFuente(normal, e.equipo_nombre), 7, ancho, 3)) {
      pagina.drawText(l, { x: tx, y: ty, size: 7, font: normal });
      ty -= 3.2 * MM;
    }
  });
  if (!etiquetas.length) doc.addPage([PAGINA.ancho, PAGINA.alto]);
  return Buffer.from(await doc.save());
}

module.exports = { generarPdf, POR_HOJA: COLUMNAS * FILAS };
