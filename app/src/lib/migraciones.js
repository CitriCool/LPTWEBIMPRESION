'use strict';

const { query } = require('./db');

// db/schema.sql solo corre cuando se crea el volumen de MariaDB. Estos cambios
// ponen al día una base creada con una versión anterior; cada uno es idempotente.
const CAMBIOS = [
  `ALTER TABLE cotizaciones_pedidos
     ADD COLUMN IF NOT EXISTS pago_estado ENUM('sin_comprobante', 'por_revisar', 'verificado', 'rechazado')
       NOT NULL DEFAULT 'sin_comprobante' AFTER archivo_sha256,
     ADD COLUMN IF NOT EXISTS comprobante_nombre VARCHAR(255) NULL AFTER pago_estado,
     ADD COLUMN IF NOT EXISTS comprobante_ruta VARCHAR(255) NULL AFTER comprobante_nombre,
     ADD COLUMN IF NOT EXISTS comprobante_mime VARCHAR(40) NULL AFTER comprobante_ruta,
     ADD COLUMN IF NOT EXISTS comprobante_bytes INT UNSIGNED NULL AFTER comprobante_mime,
     ADD COLUMN IF NOT EXISTS comprobante_subido_en DATETIME NULL AFTER comprobante_bytes,
     ADD COLUMN IF NOT EXISTS pago_revisado_por INT UNSIGNED NULL AFTER comprobante_subido_en,
     ADD COLUMN IF NOT EXISTS pago_revisado_en DATETIME NULL AFTER pago_revisado_por,
     ADD COLUMN IF NOT EXISTS pago_comentario VARCHAR(500) NULL AFTER pago_revisado_en,
     ADD INDEX IF NOT EXISTS idx_pedido_pago (pago_estado)`,
];

async function migrar() {
  for (const sql of CAMBIOS) await query(sql);
  // La clave foránea no admite IF NOT EXISTS en MariaDB: se agrega solo si falta
  const [fk] = await query(
    `SELECT 1 AS hay FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'cotizaciones_pedidos' AND CONSTRAINT_NAME = 'fk_pedido_revisor'`
  );
  if (!fk) {
    await query(
      `ALTER TABLE cotizaciones_pedidos ADD CONSTRAINT fk_pedido_revisor
       FOREIGN KEY (pago_revisado_por) REFERENCES usuarios (id) ON DELETE SET NULL`
    );
  }
}

module.exports = { migrar };
