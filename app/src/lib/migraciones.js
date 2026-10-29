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
  // Préstamo de equipos (misma definición que en db/schema.sql)
  `CREATE TABLE IF NOT EXISTS equipos_categorias (
     id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     nombre          VARCHAR(80) NOT NULL,
     orden           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
     activo          TINYINT(1) NOT NULL DEFAULT 1,
     creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE KEY uq_categoria_nombre (nombre)
   ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS equipos (
     id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     categoria_id    INT UNSIGNED NOT NULL,
     nombre          VARCHAR(120) NOT NULL,
     marca_modelo    VARCHAR(120) NULL,
     descripcion     VARCHAR(1000) NULL,
     accesorios      VARCHAR(500) NULL,
     garantia        VARCHAR(255) NULL,
     tarifa_dia_clp  INT UNSIGNED NOT NULL DEFAULT 0,
     dias_max        SMALLINT UNSIGNED NOT NULL DEFAULT 3,
     activo          TINYINT(1) NOT NULL DEFAULT 1,
     creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     actualizado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     KEY idx_equipo_categoria (categoria_id),
     CONSTRAINT fk_equipo_categoria FOREIGN KEY (categoria_id) REFERENCES equipos_categorias (id)
   ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS equipos_unidades (
     id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     equipo_id       INT UNSIGNED NOT NULL,
     inventario      VARCHAR(40) NOT NULL,
     serie           VARCHAR(80) NULL,
     qr_token        CHAR(12) NOT NULL,
     estado          ENUM('disponible', 'prestado', 'mantencion', 'baja') NOT NULL DEFAULT 'disponible',
     ubicacion       VARCHAR(120) NULL,
     notas           VARCHAR(1000) NULL,
     creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     actualizado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     UNIQUE KEY uq_unidad_inventario (inventario),
     UNIQUE KEY uq_unidad_qr (qr_token),
     KEY idx_unidad_equipo (equipo_id, estado),
     CONSTRAINT fk_unidad_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id)
   ) ENGINE=InnoDB`,
  // Categorías de partida solo si no hay ninguna (no revive las que el admin renombró)
  `INSERT INTO equipos_categorias (nombre, orden)
     SELECT * FROM (SELECT 'Notebooks', 1 UNION ALL SELECT 'Drones', 2) AS iniciales
     WHERE NOT EXISTS (SELECT 1 FROM equipos_categorias)`,
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
