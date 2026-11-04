'use strict';

// Recordatorios de devolución de préstamos por correo: el día antes del
// vencimiento, el mismo día y, si no se devolvió, el día siguiente (con copia al
// LPT). Cada uno se envía una sola vez: la columna correspondiente guarda cuándo.
const { query } = require('./db');
const config = require('../config');
const prestamos = require('./prestamos');

const TIPOS = {
  previo: { columna: 'recordatorio_previo_en', texto: 'Recordatorio: la devolución es mañana' },
  vence: { columna: 'recordatorio_vence_en', texto: 'Recordatorio: la devolución es hoy' },
  atraso: { columna: 'recordatorio_atraso_en', texto: 'Aviso de atraso: el equipo no se ha devuelto' },
};

/**
 * Qué recordatorio le toca hoy a un préstamo, o null. Solo a equipos entregados.
 * Si el equipo se entregó hoy mismo no se recuerda nada: el comprobante de
 * entrega acaba de llegar con la fecha de devolución.
 */
function recordatorioQueToca(p, h = prestamos.hoy()) {
  if (p.estado !== 'entregado') return null;
  if (p.fecha_hasta < h) return p.recordatorio_atraso_en ? null : 'atraso';
  const entregadoHoy = p.entregado_en && prestamos.hoy(new Date(p.entregado_en)) >= h;
  if (entregadoHoy) return null;
  if (p.fecha_hasta === h) return p.recordatorio_vence_en ? null : 'vence';
  if (p.fecha_hasta === prestamos.sumarDias(h, 1)) return p.recordatorio_previo_en ? null : 'previo';
  return null;
}

/** Envía los recordatorios pendientes de hoy. Devuelve cuántos se enviaron. */
async function enviarPendientes(ahora = new Date()) {
  const mailer = require('./mailer');
  // Sin SMTP no sale nada: no se marcan como enviados para que salgan cuando se configure
  if (!config.mail.host) return 0;
  const h = prestamos.hoy(ahora);
  const candidatos = await prestamos.paraRecordar(prestamos.sumarDias(h, 1));
  let enviados = 0;
  for (const p of candidatos) {
    const tipo = recordatorioQueToca(p, h);
    if (!tipo) continue;
    const { columna, texto } = TIPOS[tipo];
    // Se marca antes de enviar y solo si nadie lo marcó: con dos instancias de la
    // app, o si el ciclo anterior sigue corriendo, el correo no sale repetido.
    const r = await query(`UPDATE prestamos SET ${columna} = NOW() WHERE id = ? AND ${columna} IS NULL AND estado = 'entregado'`, [p.id]);
    if (r.affectedRows === 0) continue;
    const ok = await mailer.prestamoRecordatorio(p, tipo).catch(() => false);
    if (!ok) {
      // Falló el envío (SMTP caído, clave vencida…): se desmarca y se reintenta en el próximo ciclo
      await query(`UPDATE prestamos SET ${columna} = NULL WHERE id = ?`, [p.id]);
      continue;
    }
    await query("INSERT INTO prestamos_movimientos (prestamo_id, tipo, comentario) VALUES (?, 'recordatorio', ?)", [p.id, texto]);
    enviados++;
  }
  return enviados;
}

let temporizador = null;
let corriendo = false;

/** Revisa cada 15 minutos; envía solo desde la hora configurada (por defecto 9:00). */
function iniciar() {
  const { activos, hora } = config.prestamos.recordatorios;
  if (!activos || temporizador) return;
  if (!config.mail.host) {
    console.log('Recordatorios de devolución desactivados: SMTP_HOST no está configurado.');
    return;
  }
  const ciclo = async () => {
    if (corriendo || new Date().getHours() < hora) return;
    corriendo = true;
    try {
      const n = await enviarPendientes();
      if (n) console.log(`Recordatorios de devolución enviados: ${n}`);
    } catch (e) {
      console.error('Error enviando recordatorios de devolución:', e.message);
    } finally {
      corriendo = false;
    }
  };
  temporizador = setInterval(ciclo, 15 * 60 * 1000);
  temporizador.unref();
  setTimeout(ciclo, 10 * 1000).unref();
  console.log(`Recordatorios de devolución activos (desde las ${hora}:00)`);
}

module.exports = { TIPOS, recordatorioQueToca, enviarPendientes, iniciar };
