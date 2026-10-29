'use strict';

// Utilidades compartidas por el sitio público y el panel.
window.LPT = (() => {
  const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
  const num = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });
  const fechaLarga = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  const fechaHora = new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' });

  // 'AAAA-MM-DD' se interpreta como fecha local (new Date() la tomaría como UTC)
  const aFecha = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d));

  const PUNTOS_POR_METRO = 72 / 0.0254;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(url, opciones = {}) {
    const init = { credentials: 'same-origin', ...opciones, headers: { Accept: 'application/json', ...(opciones.headers || {}) } };
    if (init.body && !(init.body instanceof FormData) && typeof init.body !== 'string') {
      init.body = JSON.stringify(init.body);
      init.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, init);
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(datos.error || 'No se pudo completar la solicitud.');
      err.status = res.status;
      err.errores = datos.errores;
      throw err;
    }
    return datos;
  }

  return {
    PUNTOS_POR_METRO,
    clp: (v) => clp.format(v),
    num: (v) => num.format(v),
    cm: (m) => num.format(Math.round(m * 1000) / 10),
    fecha: (d) => (d ? fechaLarga.format(aFecha(d)) : ''),
    fechaHora: (d) => (d ? fechaHora.format(new Date(d)) : ''),
    esc,
    api,
  };
})();
