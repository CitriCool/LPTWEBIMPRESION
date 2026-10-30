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
  return `Pague en Cajas UCT indicando el SCC ${reglas.scc} y el código de pedido ${codigo}. Luego suba la boleta en "Mi pedido" para que comencemos a imprimir.`;
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

const NOMBRE_PAGO = {
  sin_comprobante: 'Sin comprobante',
  por_revisar: 'Comprobante por revisar',
  verificado: 'Pago verificado',
  rechazado: 'Comprobante rechazado',
};

function tablaPedido(p) {
  const filas = [
    ['Código', p.codigo],
    ['Papel', p.papel_nombre],
    ['Medidas', `${f.cm(p.ancho_m)} × ${f.cm(p.alto_m)} cm${p.paginas > 1 ? ` (página mayor, ${p.paginas} páginas)` : ''}`],
    ['Copias', p.copias],
    ['Superficie', `${f.num(p.area_m2)} m²`],
    ['Total', f.clp(p.total_clp)],
    ['Forma de pago', reglas.metodosPago[p.metodo_pago]],
    ['Pago', NOMBRE_PAGO[p.pago_estado] || NOMBRE_PAGO.sin_comprobante],
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

/** Enlace a "Mi pedido" con el código y el correo ya completados. */
function enlaceSeguimiento(p) {
  const q = new URLSearchParams({ codigo: p.codigo, email: p.cliente_email });
  return `${config.publicUrl}/?${q}#seguimiento`;
}

function botonComprobante(p) {
  const url = enlaceSeguimiento(p);
  return `<p style="margin:20px 0"><a href="${f.escapar(url)}" style="background:#1f5aa6;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Subir comprobante de pago</a></p>`;
}

/**
 * Avisa al cliente (confirmación con instrucciones de pago) y al equipo LPT
 * (aviso de pedido nuevo, con el PDF adjunto si no supera el límite).
 */
async function pedidoRecibido(p, pdf) {
  const pago = instruccionesPago(p.metodo_pago, p.codigo);
  const seguimiento = enlaceSeguimiento(p);

  await enviar({
    to: p.cliente_email,
    subject: `Pedido ${p.codigo} recibido - Servicio de Impresión LPT`,
    html: plantilla('Recibimos tu pedido', `
      <p>Hola ${f.escapar(p.cliente_nombre)}, recibimos tu archivo <b>${f.escapar(p.archivo_nombre)}</b>.</p>
      ${tablaPedido(p)}
      <p style="background:#fff8db;border-left:4px solid #f2c200;padding:12px"><b>Instrucciones de pago:</b><br>${f.escapar(pago)}</p>
      <p><b>Después de pagar, sube tu boleta o comprobante.</b> Comenzamos a imprimir cuando verificamos el pago; desde ahí el plazo es de ${reglas.diasHabilesMin} a ${reglas.diasHabilesMax} días hábiles.</p>
      ${botonComprobante(p)}
      <p>En el mismo enlace puedes consultar el estado de tu pedido. Te avisaremos por correo cada vez que cambie.</p>`),
    text: `Pedido ${p.codigo} recibido. Total ${f.clp(p.total_clp)}. ${pago} Después de pagar, sube tu comprobante en ${seguimiento}`,
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

/** Aviso al equipo LPT: un cliente subió su comprobante y hay que revisarlo. */
async function comprobanteRecibido(p, archivo) {
  const panel = `${config.publicUrl}/admin/#pedido/${p.id}`;
  const adjuntar = archivo && archivo.length <= config.mail.adjuntarMaxBytes;
  await enviar({
    to: config.mail.lpt.join(','),
    replyTo: p.cliente_email,
    subject: `[Comprobante] ${p.codigo} · ${f.clp(p.total_clp)} · por revisar`,
    attachments: adjuntar
      ? [{ filename: `${p.codigo}-comprobante-${p.comprobante_nombre}`, content: archivo, contentType: p.comprobante_mime }]
      : undefined,
    html: plantilla(`Comprobante de pago ${p.codigo}`, `
      <p><b>${f.escapar(p.cliente_nombre)}</b> subió el comprobante de pago${adjuntar ? ' (va adjunto)' : ''}.</p>
      ${tablaPedido(p)}
      <p>Revísalo y márcalo como verificado para poder pasar el pedido a impresión:
      <a href="${panel}">abrir en el panel</a>.</p>`),
    text: `${p.cliente_nombre} subió el comprobante del pedido ${p.codigo}. Revísalo en ${panel}`,
  });
}

/** Aviso al cliente cuando el LPT verifica o rechaza su comprobante. */
async function pagoRevisado(p, verificado, comentario) {
  const cuerpo = verificado
    ? `<p>Hola ${f.escapar(p.cliente_nombre)}, verificamos el pago de tu pedido. Ya está en la fila de impresión y te avisaremos cuando esté listo para retirar.</p>`
    : `<p>Hola ${f.escapar(p.cliente_nombre)}, no pudimos validar el comprobante que subiste.</p>
       <p style="background:#fdecea;border-left:4px solid #c62828;padding:12px"><b>Motivo:</b> ${f.escapar(comentario)}</p>
       <p>Por favor sube un comprobante válido para que podamos imprimir tu pedido.</p>${botonComprobante(p)}`;
  await enviar({
    to: p.cliente_email,
    bcc: config.mail.lpt.join(','),
    subject: `Pedido ${p.codigo}: ${verificado ? 'pago verificado' : 'revisa tu comprobante de pago'}`,
    html: plantilla(`Pedido ${p.codigo}: ${verificado ? 'pago verificado' : 'comprobante rechazado'}`, `${cuerpo}
      ${verificado && comentario ? `<p><b>Comentario del LPT:</b> ${f.escapar(comentario)}</p>` : ''}
      ${tablaPedido(p)}`),
    text: verificado
      ? `Verificamos el pago del pedido ${p.codigo}. Te avisaremos cuando esté listo.`
      : `No pudimos validar el comprobante del pedido ${p.codigo}: ${comentario}. Sube uno nuevo en ${enlaceSeguimiento(p)}`,
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
      ${estado.codigo === 'pendiente' && p.pago_estado !== 'verificado' ? `<p style="background:#fff8db;border-left:4px solid #f2c200;padding:12px">${f.escapar(instruccionesPago(p.metodo_pago, p.codigo))}</p>${botonComprobante(p)}` : ''}
      ${tablaPedido(p)}`),
    text: `Pedido ${p.codigo}: ${estado.nombre}. ${mensaje} ${comentario || ''}`,
  });
}


// ---------- Préstamo de equipos ----------
const fechaHora = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function enlacePrestamo(p) {
  const q = new URLSearchParams({ codigo: p.codigo, email: p.solicitante_email });
  return `${config.publicUrl}/prestamos?${q}#mi-prestamo`;
}

function tablaPrestamo(p) {
  const filas = [
    ['Código', p.codigo],
    ['Equipo', `${p.equipo_nombre}${p.marca_modelo ? ` (${p.marca_modelo})` : ''}`],
    ...(p.unidad_inventario ? [['N° de inventario', p.unidad_inventario]] : []),
    ['Desde', f.fecha(p.fecha_desde)],
    ['Devolución', f.fecha(p.fecha_hasta)],
    ['Costo', p.total_clp ? `${f.clp(p.total_clp)} (${f.clp(p.tarifa_dia_clp)} por día)` : 'Sin costo'],
    ...(p.garantia ? [['Garantía a dejar', p.garantia]] : []),
    ...(p.accesorios ? [['Incluye', p.accesorios]] : []),
  ];
  return `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px;margin:12px 0">${filas
    .map(([k, v]) => `<tr><td style="color:#5b6576;border-bottom:1px solid #e6eaf0;width:40%">${k}</td><td style="border-bottom:1px solid #e6eaf0"><b>${f.escapar(v)}</b></td></tr>`)
    .join('')}</table>`;
}

function botonPrestamo(p) {
  return `<p style="margin:20px 0"><a href="${f.escapar(enlacePrestamo(p))}" style="background:#1f5aa6;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Ver mi préstamo</a></p>`;
}

/** Confirmación al solicitante y aviso al LPT de una solicitud nueva. */
async function prestamoRecibido(p) {
  await enviar({
    to: p.solicitante_email,
    subject: `Solicitud ${p.codigo} recibida - Préstamo de equipos LPT`,
    html: plantilla('Recibimos tu solicitud de préstamo', `
      <p>Hola ${f.escapar(p.solicitante_nombre)}, recibimos tu solicitud. El equipo del LPT la revisará y te avisaremos por correo
      si fue aceptada, con el día, la hora y el lugar de retiro.</p>
      ${tablaPrestamo(p)}${botonPrestamo(p)}`),
    text: `Solicitud ${p.codigo} recibida: ${p.equipo_nombre}, ${p.fecha_desde} a ${p.fecha_hasta}. Te avisaremos cuando la revisemos. ${enlacePrestamo(p)}`,
  });
  const panel = `${config.publicUrl}/admin/#prestamo/${p.id}`;
  await enviar({
    to: config.mail.lpt.join(','),
    replyTo: p.solicitante_email,
    subject: `[Préstamo] ${p.codigo} · ${p.equipo_nombre} · ${p.fecha_desde}`,
    html: plantilla(`Solicitud de préstamo ${p.codigo}`, `
      <p><b>${f.escapar(p.solicitante_nombre)}</b> (${f.escapar(p.solicitante_rut)}) · ${f.escapar(p.solicitante_unidad)}<br>
      ${f.escapar(p.solicitante_email)} · ${f.escapar(p.solicitante_telefono)}</p>
      ${tablaPrestamo(p)}
      <p><b>Motivo:</b> ${f.escapar(p.motivo)}</p>
      <p><a href="${panel}">Aceptar o rechazar en el panel</a></p>`),
    text: `Solicitud de préstamo ${p.codigo} de ${p.solicitante_nombre}: ${p.equipo_nombre}. Panel: ${panel}`,
  });
}

/** Aviso al solicitante: solicitud aceptada, con el retiro. */
async function prestamoAprobado(p) {
  const retiro = fechaHora.format(new Date(p.retiro_en));
  await enviar({
    to: p.solicitante_email,
    bcc: config.mail.lpt.join(','),
    subject: `Préstamo ${p.codigo} aceptado: retiro el ${retiro}`,
    html: plantilla('Tu préstamo fue aceptado', `
      <p>Hola ${f.escapar(p.solicitante_nombre)}, aceptamos tu solicitud.</p>
      <p style="background:#e8f6ee;border-left:4px solid #1e8e57;padding:12px"><b>Retiro:</b> ${f.escapar(retiro)}<br>
      <b>Lugar:</b> ${f.escapar(p.retiro_lugar)}${p.garantia ? `<br><b>Lleva:</b> ${f.escapar(p.garantia)} (queda como garantía)` : ''}</p>
      ${p.comentario_lpt ? `<p><b>Comentario del LPT:</b> ${f.escapar(p.comentario_lpt)}</p>` : ''}
      ${tablaPrestamo(p)}
      <p>Recuerda devolverlo el <b>${f.escapar(f.fecha(p.fecha_hasta))}</b> en las mismas condiciones. Si ya no lo necesitas, cancélalo para que otra persona pueda usarlo.</p>
      ${botonPrestamo(p)}`),
    text: `Préstamo ${p.codigo} aceptado. Retiro: ${retiro} en ${p.retiro_lugar}.${p.garantia ? ` Lleva ${p.garantia}.` : ''} Devolución: ${p.fecha_hasta}.`,
  });
}

/** Aviso al solicitante: rechazo de la solicitud o anulación de un préstamo aceptado. */
async function prestamoRechazado(p) {
  const anulado = p.estado === 'cancelado';
  await enviar({
    to: p.solicitante_email,
    bcc: config.mail.lpt.join(','),
    subject: `Préstamo ${p.codigo}: ${anulado ? 'anulado' : 'no pudimos aceptarlo'}`,
    html: plantilla(anulado ? 'Tu préstamo fue anulado' : 'No pudimos aceptar tu solicitud', `
      <p>Hola ${f.escapar(p.solicitante_nombre)},</p>
      <p style="background:#fdecea;border-left:4px solid #c62828;padding:12px"><b>Motivo:</b> ${f.escapar(p.comentario_lpt)}</p>
      ${tablaPrestamo(p)}
      <p>Si tienes dudas, responde a este correo.</p>`),
    text: `Préstamo ${p.codigo} ${anulado ? 'anulado' : 'rechazado'}: ${p.comentario_lpt}`,
  });
}

/** Aviso al LPT: el solicitante canceló. */
async function prestamoCancelado(p) {
  await enviar({
    to: config.mail.lpt.join(','),
    replyTo: p.solicitante_email,
    subject: `[Préstamo] ${p.codigo} cancelado por el solicitante`,
    html: plantilla(`Préstamo ${p.codigo} cancelado`, `
      <p><b>${f.escapar(p.solicitante_nombre)}</b> canceló su préstamo; la unidad queda libre en esas fechas.</p>${tablaPrestamo(p)}`),
    text: `${p.solicitante_nombre} canceló el préstamo ${p.codigo}.`,
  });
}

module.exports = {
  pedidoRecibido,
  comprobanteRecibido,
  pagoRevisado,
  cambioEstado,
  prestamoRecibido,
  prestamoAprobado,
  prestamoRechazado,
  prestamoCancelado,
  instruccionesPago,
  verificar,
  enviar,
  plantilla,
};
