'use strict';

// Revisión de las medidas de cada página del PDF antes de enviar el pedido.
// Lo usa el sitio (window.LPT_MEDIDAS) y las pruebas (require).
(function (raiz) {
  // Tamaños de hoja conocidos, en mm (lado menor × lado mayor)
  const TAMANOS = [
    { nombre: 'A0', mm: [841, 1189] },
    { nombre: 'A1', mm: [594, 841] },
    { nombre: 'A2', mm: [420, 594] },
    { nombre: 'A3', mm: [297, 420] },
    { nombre: 'A4', mm: [210, 297], oficina: true },
    { nombre: 'A5', mm: [148, 210], oficina: true },
    { nombre: 'Carta', mm: [216, 279], oficina: true },
    { nombre: 'Oficio', mm: [216, 330], oficina: true },
    { nombre: 'Legal', mm: [216, 356], oficina: true },
    { nombre: 'Tabloide', mm: [279, 432] },
  ];
  // Margen para reconocer un tamaño (redondeos al exportar el PDF)
  const TOLERANCIA_MM = 3;

  /** Tamaño de hoja reconocido para unas medidas en metros, o null. */
  function tamanoHoja(anchoM, altoM) {
    const menor = Math.min(anchoM, altoM) * 1000;
    const mayor = Math.max(anchoM, altoM) * 1000;
    return TAMANOS.find((t) => Math.abs(t.mm[0] - menor) <= TOLERANCIA_MM && Math.abs(t.mm[1] - mayor) <= TOLERANCIA_MM) || null;
  }

  /**
   * Revisa las páginas ({ ancho_m, alto_m }) contra el ancho máximo del rollo.
   * Devuelve una fila por página (lado menor como ancho, igual que el cobro),
   * las páginas que se pasan y si todas son hojas de oficina (A4, carta…), lo
   * que suele indicar un plano exportado sin su tamaño final.
   */
  function revisarPaginas(paginas, anchoMaxM, toleranciaM = 0.001) {
    const filas = paginas.map((p, i) => {
      const ancho = Math.min(p.ancho_m, p.alto_m);
      const alto = Math.max(p.ancho_m, p.alto_m);
      const t = tamanoHoja(ancho, alto);
      return {
        pagina: i + 1,
        ancho_m: ancho,
        alto_m: alto,
        area_m2: ancho * alto,
        tamano: t ? t.nombre : null,
        oficina: Boolean(t && t.oficina),
        excede: ancho > anchoMaxM + toleranciaM,
      };
    });
    return {
      filas,
      excedidas: filas.filter((f) => f.excede).map((f) => f.pagina),
      todasOficina: filas.length > 0 && filas.every((f) => f.oficina),
    };
  }

  const api = { TAMANOS, tamanoHoja, revisarPaginas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.LPT_MEDIDAS = api;
})(typeof window !== 'undefined' ? window : globalThis);
