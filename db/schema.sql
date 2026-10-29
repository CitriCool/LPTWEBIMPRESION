-- =====================================================================
-- Sistema de pedidos de impresión / ploteo
-- Laboratorio de Planificación Territorial (LPT) - Universidad Católica de Temuco
-- Motor: MariaDB 10.6+ (probado con 11.4)
-- Se ejecuta automáticamente la primera vez que se crea el volumen de MariaDB.
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '-03:00';

CREATE DATABASE IF NOT EXISTS lpt_impresion
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE lpt_impresion;

-- ---------------------------------------------------------------------
-- Operadores del LPT que acceden al panel de administración
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre          VARCHAR(120) NOT NULL,
  email           VARCHAR(160) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  rol             ENUM('admin', 'operador') NOT NULL DEFAULT 'operador',
  activo          TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_acceso   DATETIME NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Tipos de papel y su precio por metro cuadrado (CLP)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS servicios_papel (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo          VARCHAR(30)  NOT NULL,
  nombre          VARCHAR(80)  NOT NULL,
  descripcion     VARCHAR(255) NULL,
  precio_m2       INT UNSIGNED NOT NULL,
  activo          TINYINT(1)   NOT NULL DEFAULT 1,
  orden           SMALLINT     NOT NULL DEFAULT 0,
  actualizado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_papel_codigo (codigo)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Catálogo de estados del pedido
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estados_pedido (
  id               TINYINT UNSIGNED PRIMARY KEY,
  codigo           VARCHAR(30) NOT NULL,
  nombre           VARCHAR(60) NOT NULL,
  descripcion      VARCHAR(255) NULL,
  orden            TINYINT NOT NULL,
  es_final         TINYINT(1) NOT NULL DEFAULT 0,
  notifica_cliente TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_estado_codigo (codigo)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Cotizaciones / pedidos. Los precios se copian al momento del pedido
-- para que un cambio de tarifa no altere pedidos ya cotizados.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cotizaciones_pedidos (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo                VARCHAR(20)  NOT NULL,               -- ej. LPT-2026-00042
  -- Cliente
  cliente_nombre        VARCHAR(120) NOT NULL,
  cliente_rut           VARCHAR(20)  NOT NULL,
  cliente_email         VARCHAR(160) NOT NULL,
  cliente_telefono      VARCHAR(30)  NOT NULL,
  cliente_unidad        VARCHAR(160) NULL,                   -- carrera, unidad o institución
  metodo_pago           ENUM('cajas_uct', 'traspaso_presupuestario') NOT NULL,
  -- Trabajo
  papel_id              INT UNSIGNED NOT NULL,
  copias                SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  paginas               SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  ancho_m               DECIMAL(6,3) NOT NULL,              -- lado menor de la página más grande
  alto_m                DECIMAL(6,3) NOT NULL,
  area_m2               DECIMAL(10,4) NOT NULL,             -- suma de todas las páginas x copias
  precio_m2             INT UNSIGNED NOT NULL,              -- tarifa vigente al cotizar
  total_clp             INT UNSIGNED NOT NULL,
  observaciones         TEXT NULL,
  -- Archivo
  archivo_nombre        VARCHAR(255) NOT NULL,              -- nombre original
  archivo_ruta          VARCHAR(255) NOT NULL,              -- nombre interno en el volumen
  archivo_bytes         INT UNSIGNED NOT NULL,
  archivo_sha256        CHAR(64) NOT NULL,
  -- Pago: el cliente sube el comprobante después de pagar y el LPT lo revisa
  pago_estado           ENUM('sin_comprobante', 'por_revisar', 'verificado', 'rechazado') NOT NULL DEFAULT 'sin_comprobante',
  comprobante_nombre    VARCHAR(255) NULL,
  comprobante_ruta      VARCHAR(255) NULL,
  comprobante_mime      VARCHAR(40)  NULL,
  comprobante_bytes     INT UNSIGNED NULL,
  comprobante_subido_en DATETIME NULL,
  pago_revisado_por     INT UNSIGNED NULL,
  pago_revisado_en      DATETIME NULL,
  pago_comentario       VARCHAR(500) NULL,
  -- Gestión
  estado_id             TINYINT UNSIGNED NOT NULL DEFAULT 1,
  notas_internas        TEXT NULL,
  fecha_entrega_estimada DATE NULL,
  creado_en             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pedido_codigo (codigo),
  KEY idx_pedido_estado (estado_id, creado_en),
  KEY idx_pedido_email (cliente_email),
  KEY idx_pedido_pago (pago_estado),
  CONSTRAINT fk_pedido_papel  FOREIGN KEY (papel_id)  REFERENCES servicios_papel (id),
  CONSTRAINT fk_pedido_estado FOREIGN KEY (estado_id) REFERENCES estados_pedido (id),
  CONSTRAINT fk_pedido_revisor FOREIGN KEY (pago_revisado_por) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT chk_ancho CHECK (ancho_m > 0 AND ancho_m <= 1.000),
  CONSTRAINT chk_copias CHECK (copias BETWEEN 1 AND 100)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Historial de cambios de estado (auditoría y trazabilidad)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historial_estados (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pedido_id     INT UNSIGNED NOT NULL,
  estado_id     TINYINT UNSIGNED NOT NULL,
  usuario_id    INT UNSIGNED NULL,                           -- NULL = sistema / cliente
  comentario    VARCHAR(500) NULL,
  creado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_hist_pedido (pedido_id, creado_en),
  CONSTRAINT fk_hist_pedido  FOREIGN KEY (pedido_id)  REFERENCES cotizaciones_pedidos (id) ON DELETE CASCADE,
  CONSTRAINT fk_hist_estado  FOREIGN KEY (estado_id)  REFERENCES estados_pedido (id),
  CONSTRAINT fk_hist_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Datos iniciales
-- ---------------------------------------------------------------------
INSERT INTO servicios_papel (codigo, nombre, descripcion, precio_m2, orden) VALUES
  ('bond',     'Bond',     'Papel básico / delgado',  6000, 1),
  ('matte',    'Matte',    'Cartulina',               9000, 2),
  ('satinado', 'Satinado', 'Papel fotográfico',      17000, 3)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

INSERT INTO estados_pedido (id, codigo, nombre, descripcion, orden, es_final, notifica_cliente) VALUES
  (1, 'pendiente',   'Pendiente',           'Pedido recibido, en espera de revisión y pago', 1, 0, 1),
  (2, 'en_impresion','En impresión',        'El archivo está siendo impreso',              2, 0, 1),
  (3, 'listo',       'Listo para retirar',  'Puede retirarse en el LPT',                   3, 0, 1),
  (4, 'entregado',   'Entregado',           'Pedido retirado por el cliente',              4, 1, 1),
  (5, 'cancelado',   'Cancelado',           'Pedido anulado',                              5, 1, 1)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- El primer usuario administrador NO se crea aquí: la aplicación lo crea al
-- arrancar a partir de ADMIN_EMAIL / ADMIN_PASSWORD (ver .env.example), para
-- no dejar contraseñas en el repositorio.
