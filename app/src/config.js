'use strict';

const env = process.env;

function lista(valor, porDefecto) {
  return (valor || porDefecto)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  production: env.NODE_ENV === 'production',

  db: {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'lpt',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'lpt_impresion',
  },

  session: {
    secret: env.SESSION_SECRET || 'solo-desarrollo-cambiar',
    secure: env.COOKIE_SECURE === 'true',
  },

  admin: {
    nombre: env.ADMIN_NOMBRE || 'Administrador LPT',
    email: env.ADMIN_EMAIL || '',
    password: env.ADMIN_PASSWORD || '',
  },

  uploadDir: env.UPLOAD_DIR || require('path').join(__dirname, '..', 'uploads'),

  mail: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Servicio de Impresión LPT <lpt@uct.cl>',
    lpt: lista(env.MAIL_LPT, 'rcallejas@uct.cl,lpt@uct.cl'),
    // Adjuntar el PDF del cliente en el aviso de pedido nuevo al equipo LPT
    adjuntarPdf: env.MAIL_ADJUNTAR_PDF !== 'false',
    adjuntarMaxBytes: Number(env.MAIL_ADJUNTAR_MAX_MB || 10) * 1024 * 1024,
  },

  // Reglas de negocio publicadas en el afiche del servicio
  reglas: {
    entidad: 'Universidad Católica de Temuco - Laboratorio de Planificación Territorial (LPT)',
    maxBytes: 15 * 1024 * 1024,
    // Comprobante de pago (boleta o traspaso): PDF, JPG o PNG
    comprobanteMaxBytes: 5 * 1024 * 1024,
    // Estados a los que un pedido solo puede pasar con el pago verificado
    estadosConPago: ['en_impresion', 'listo', 'entregado'],
    anchoMaxM: 1.0,
    // Tolerancia por redondeo al convertir puntos PDF a metros (1 mm)
    toleranciaM: 0.001,
    maxPaginas: 50,
    maxCopias: 100,
    diasHabilesMin: 1,
    diasHabilesMax: 2,
    scc: '251-1148',
    metodosPago: {
      cajas_uct: 'Pago en Cajas UCT',
      traspaso_presupuestario: 'Traspaso presupuestario',
    },
  },

  // Préstamo de equipos: piden estudiantes y académicos con correo institucional
  prestamos: {
    dominios: lista(env.PRESTAMO_DOMINIOS, 'uct.cl,alu.uct.cl').map((d) => d.toLowerCase()),
    lugarRetiro: env.PRESTAMO_LUGAR_RETIRO || 'Laboratorio de Planificación Territorial (LPT)',
    // Con cuánta anticipación se puede pedir
    anticipacionMaxDias: 60,
  },
};
