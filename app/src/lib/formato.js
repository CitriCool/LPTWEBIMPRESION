'use strict';

const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });
// 'AAAA-MM-DD' se interpreta como fecha local (new Date() la tomaría como UTC)
const aFecha = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d));
const fecha = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

module.exports = {
  clp: (v) => clp.format(v),
  num: (v) => num.format(v),
  cm: (m) => num.format(Math.round(m * 1000) / 10),
  fecha: (d) => (d ? fecha.format(aFecha(d)) : ''),
  escapar: (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
};
