'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const f = require('./formato');

const { reglas } = config;

const transporte = config.mail.host
  ? nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    })
  : nodemailer.createTransport({ jsonTransport: true });

async function enviar(msg) {
  try {
    const info = await transporte.sendMail({ from: config.mail.from, ...msg });
    if (!config.mail.host) {
      console.log(`[correo no enviado: SMTP sin configurar] Para: ${msg.to} | Asunto: ${msg.subject}`);
    }
    return info;
  } catch (e) {
    // Un fallo de correo no debe romper el pedido; queda registrado en el log.
    console.error('Error enviando correo:', e.message);
    return null;
  }
}

function instruccionesPago(metodo, codigo) {
  if (metodo === 'traspaso_presupuestario') {
    return `Solicite el traspaso presupuestario al centro de costo SCC ${reglas.scc}, indicando el código de pedido ${codigo}.`;
  }
  return `Pague en Cajas UCT indicando el SCC ${reglas.scc} y el código de pedido ${codigo}. Guarde el comprobante para el retiro.`;
}

function plantilla(titulo, cuerpoHtml) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f2f5fa;font-family:Arial,Helvetica,sans-serif;color:#1d2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="background:#1f5aa6;color:#fff;padding:20px 24px">
<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.85">UCT · Laboratorio de Planificación Territorial</div>
<div style="font-size:20px;font-weight:bold;margin-top:4px">${f.escapar(titulo)}</div></td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.5">${cuerpoHtml}</td></tr>
<tr><td style="padding:16px 24px;background:#f7f9fc;font-size:12px;color:#5b6576">Servicio de Impresión LPT · ${config.mail.lpt.map(f.escapar).join(' · ')}</td></tr>
</table></td></tr></table></body></html>`;
}

function tablaPedido(p) {
  const filas = [
    ['Código', p.codigo],
    ['Papel', p.papel_nombre],
    ['Medidas', `${f.cm(p.ancho_m)} × ${f.cm(p.alto_m)} cm${p.paginas > 1 ? ` (página mayor, ${p.paginas} páginas)` : ''}`],
    ['Copias', p.copias],
    ['Superficie', `${f.num(p.area_m2)} m²`],
    ['Total', f.clp(p.total_clp)],
    ['Forma de pago', reglas.metodosPago[p.metodo_pago]],
    ['Entrega estimada', f.fecha(p.fecha_entrega_estimada)],
  ];
  return `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px;margin:12px 0">${filas
    .map(([k, v]) => `<tr><td style="color:#5b6576;border-bottom:1px solid #e6eaf0;width:40%">${k}</td><td style="border-bottom:1px solid #e6eaf0"><b>${f.escapar(v)}</b></td></tr>`)
    .join('')}</table>`;
}

/** Comprueba la conexión SMTP. Devuelve null si está bien o el mensaje de error. */
async function verificar() {
  if (!config.mail.host) return 'SMTP_HOST no está configurado: los correos solo se muestran en el log.';
  try {
    await transporte.verify();
    return null;
  } catch (e) {
    return e.message;
  }
}

function adjuntoPdf(p, pdf) {
  if (!pdf || !config.mail.adjuntarPdf || pdf.length > config.mail.adjuntarMaxBytes) return null;
  return { filename: `${p.codigo}-${p.archivo_nombre}`, content: pdf, contentType: 'application/pdf' };
}

/**
 * Avisa al cliente (confirmación con instrucciones de pago) y al equipo LPT
 * (aviso de pedido nuevo, con el PDF adjunto si no supera el límite).
 */
async function pedidoRecibido(p, pdf) {
  const pago = instruccionesPago(p.metodo_pago, p.codigo);
  const seguimiento = `${config.publicUrl}/#seguimiento`;

  await enviar({
    to: p.cliente_email,
    subject: `Pedido ${p.codigo} recibido - Servicio de Impresión LPT`,
    html: plantilla('Recibimos tu pedido', `
      <p>Hola ${f.escapar(p.cliente_nombre)}, recibimos tu archivo <b>${f.escapar(p.archivo_nombre)}</b>.</p>
      ${tablaPedido(p)}
      <p style="background:#fff8db;border-left:4px solid #f2c200;padding:12px"><b>Instrucciones de pago:</b><br>${f.escapar(pago)}</p>
      <p>El plazo mínimo de impresión es de ${reglas.diasHabilesMin} a ${reglas.diasHabilesMax} días hábiles. Te avisaremos por correo cuando cambie el estado.</p>
      <p>Puedes consultar el estado en <a href="${seguimiento}">${seguimiento}</a> con tu código y correo.</p>`),
    text: `Pedido ${p.codigo} recibido. Total ${f.clp(p.total_clp)}. ${pago}`,
  });

  const adjunto = adjuntoPdf(p, pdf);
  const panel = `${config.publicUrl}/admin/#pedido/${p.id}`;
  await enviar({
    to: config.mail.lpt.join(','),
    replyTo: p.cliente_email,
    attachments: adjunto ? [adjunto] : undefined,
    subject: `[Nuevo pedido] ${p.codigo} · ${p.papel_nombre} · ${f.clp(p.total_clp)}`,
    html: plantilla(`Nuevo pedido ${p.codigo}`, `
      <p><b>${f.escapar(p.cliente_nombre)}</b> (${f.escapar(p.cliente_rut)})<br>
      ${f.escapar(p.cliente_email)} · ${f.escapar(p.cliente_telefono)}${p.cliente_unidad ? `<br>${f.escapar(p.cliente_unidad)}` : ''}</p>
      ${tablaPedido(p)}
      ${p.observaciones ? `<p><b>Observaciones:</b> ${f.escapar(p.observaciones)}</p>` : ''}
      <p>${adjunto ? 'El PDF va adjunto a este correo. ' : 'El PDF se descarga desde el panel. '}
      <a href="${panel}">Ver en el panel de administración</a></p>`),
    text: `Nuevo pedido ${p.codigo} de ${p.cliente_nombre}. Total ${f.clp(p.total_clp)}. Panel: ${panel}`,
  });
}

const MENSAJES_ESTADO = {
  pendiente: 'Tu pedido volvió a estado pendiente de revisión.',
  en_impresion: 'Tu pedido está siendo impreso.',
  listo: 'Tu pedido está listo. Puedes retirarlo en el Laboratorio de Planificación Territorial presentando tu comprobante de pago.',
  entregado: 'Tu pedido fue entregado. ¡Gracias por usar el servicio!',
  cancelado: 'Tu pedido fue cancelado. Si tienes dudas, responde a este correo.',
};

async function cambioEstado(p, estado, comentario, notificarCliente) {
  const mensaje = MENSAJES_ESTADO[estado.codigo] || `Nuevo estado: ${estado.nombre}.`;
  const extra = comentario ? `<p><b>Comentario del LPT:</b> ${f.escapar(comentario)}</p>` : '';
  const destinatarios = [...config.mail.lpt];
  if (notificarCliente) destinatarios.unshift(p.cliente_email);

  await enviar({
    to: destinatarios.join(','),
    subject: `Pedido ${p.codigo}: ${estado.nombre}`,
    html: plantilla(`Pedido ${p.codigo}: ${estado.nombre}`, `
      <p>Hola ${f.escapar(p.cliente_nombre)},</p><p>${f.escapar(mensaje)}</p>${extra}
      ${estado.codigo === 'pendiente' || estado.codigo === 'en_impresion' ? `<p style="background:#fff8db;border-left:4px solid #f2c200;padding:12px">${f.escapar(instruccionesPago(p.metodo_pago, p.codigo))}</p>` : ''}
      ${tablaPedido(p)}`),
    text: `Pedido ${p.codigo}: ${estado.nombre}. ${mensaje} ${comentario || ''}`,
  });
}

module.exports = { pedidoRecibido, cambioEstado, instruccionesPago, verificar, enviar, plantilla };
