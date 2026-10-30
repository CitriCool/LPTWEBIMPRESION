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
-- Préstamo de equipos: categorías, equipos (lo que se ofrece) y unidades
-- (cada aparato físico, con su n° de inventario y su etiqueta QR)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equipos_categorias (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre          VARCHAR(80) NOT NULL,
  orden           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  activo          TINYINT(1) NOT NULL DEFAULT 1,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_categoria_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS equipos (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  categoria_id    INT UNSIGNED NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  marca_modelo    VARCHAR(120) NULL,
  descripcion     VARCHAR(1000) NULL,
  accesorios      VARCHAR(500) NULL,                         -- lo que se entrega junto al equipo
  garantia        VARCHAR(255) NULL,                         -- lo que deja quien lo pide, ej. credencial UCT
  tarifa_dia_clp  INT UNSIGNED NOT NULL DEFAULT 0,           -- 0 = préstamo sin costo
  dias_max        SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  activo          TINYINT(1) NOT NULL DEFAULT 1,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_equipo_categoria (categoria_id),
  CONSTRAINT fk_equipo_categoria FOREIGN KEY (categoria_id) REFERENCES equipos_categorias (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS equipos_unidades (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  equipo_id       INT UNSIGNED NOT NULL,
  inventario      VARCHAR(40) NOT NULL,                      -- n° de inventario UCT
  serie           VARCHAR(80) NULL,
  qr_token        CHAR(12) NOT NULL,                         -- aleatorio: el QR apunta a /q/<token>
  estado          ENUM('disponible', 'prestado', 'mantencion', 'baja') NOT NULL DEFAULT 'disponible',
  ubicacion       VARCHAR(120) NULL,
  notas           VARCHAR(1000) NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_unidad_inventario (inventario),
  UNIQUE KEY uq_unidad_qr (qr_token),
  KEY idx_unidad_equipo (equipo_id, estado),
  CONSTRAINT fk_unidad_equipo FOREIGN KEY (equipo_id) REFERENCES equipos (id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Solicitudes de préstamo y su bitácora
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prestamos (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo              VARCHAR(20)  NOT NULL,                 -- ej. PRE-2026-00007
  equipo_id           INT UNSIGNED NOT NULL,
  unidad_id           INT UNSIGNED NULL,                     -- se asigna al aceptar la solicitud
  -- Solicitante (estudiante o académico UCT)
  solicitante_nombre  VARCHAR(120) NOT NULL,
  solicitante_rut     VARCHAR(20)  NOT NULL,
  solicitante_email   VARCHAR(160) NOT NULL,
  solicitante_telefono VARCHAR(30) NOT NULL,
  solicitante_tipo    ENUM('estudiante', 'academico') NOT NULL,
  solicitante_unidad  VARCHAR(160) NOT NULL,                 -- carrera o unidad académica
  motivo              VARCHAR(1000) NOT NULL,
  -- Préstamo
  fecha_desde         DATE NOT NULL,
  fecha_hasta         DATE NOT NULL,
  dias                SMALLINT UNSIGNED NOT NULL,
  tarifa_dia_clp      INT UNSIGNED NOT NULL,                 -- copiadas del equipo al solicitar
  total_clp           INT UNSIGNED NOT NULL,
  garantia            VARCHAR(255) NULL,
  estado              ENUM('solicitado', 'aprobado', 'rechazado', 'cancelado', 'entregado', 'devuelto') NOT NULL DEFAULT 'solicitado',
  retiro_en           DATETIME NULL,
  retiro_lugar        VARCHAR(160) NULL,
  comentario_lpt      VARCHAR(500) NULL,                     -- lo recibe el solicitante
  revisado_por        INT UNSIGNED NULL,
  revisado_en         DATETIME NULL,
  creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_prestamo_codigo (codigo),
  KEY idx_prestamo_estado (estado, creado_en),
  KEY idx_prestamo_equipo_fechas (equipo_id, fecha_desde, fecha_hasta),
  KEY idx_prestamo_unidad_fechas (unidad_id, fecha_desde, fecha_hasta),
  KEY idx_prestamo_email (solicitante_email),
  CONSTRAINT fk_prestamo_equipo  FOREIGN KEY (equipo_id) REFERENCES equipos (id),
  CONSTRAINT fk_prestamo_unidad  FOREIGN KEY (unidad_id) REFERENCES equipos_unidades (id),
  CONSTRAINT fk_prestamo_revisor FOREIGN KEY (revisado_por) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS prestamos_movimientos (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  prestamo_id   INT UNSIGNED NOT NULL,
  tipo          VARCHAR(30) NOT NULL,                        -- solicitado, aprobado, rechazado, cancelado...
  usuario_id    INT UNSIGNED NULL,                           -- NULL = solicitante / sistema
  comentario    VARCHAR(500) NULL,
  creado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mov_prestamo (prestamo_id, creado_en),
  CONSTRAINT fk_mov_prestamo FOREIGN KEY (prestamo_id) REFERENCES prestamos (id) ON DELETE CASCADE,
  CONSTRAINT fk_mov_usuario  FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
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

INSERT INTO equipos_categorias (nombre, orden) VALUES
  ('Notebooks', 1),
  ('Drones',    2)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- El primer usuario administrador NO se crea aquí: la aplicación lo crea al
-- arrancar a partir de ADMIN_EMAIL / ADMIN_PASSWORD (ver .env.example), para
-- no dejar contraseñas en el repositorio.
