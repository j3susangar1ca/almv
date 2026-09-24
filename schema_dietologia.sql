-- =====================================================================
-- Esquema de datos: Gestión de Inventarios, Suministros y Almacenes
-- Área de Dietología y Nutrición — Sector Salud Pública, Jalisco
-- Motor objetivo: PostgreSQL 15+
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS dietologia;
SET search_path TO dietologia;

-- =====================================================================
-- 1. CATÁLOGOS MAESTROS INDEPENDIENTES
-- =====================================================================

CREATE TABLE dietologia.unidad_medida (
    unidad_id     SMALLSERIAL PRIMARY KEY,
    clave         VARCHAR(10) NOT NULL UNIQUE,
    nombre        VARCHAR(40) NOT NULL,
    tipo_medida   VARCHAR(10) NOT NULL
                  CHECK (tipo_medida IN ('PESO','VOLUMEN','PIEZA','PAQUETE'))
);

CREATE TABLE dietologia.familia (
    familia_id         SMALLSERIAL PRIMARY KEY,
    clave_presupuestal VARCHAR(5)  NOT NULL UNIQUE,
    nombre             VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE dietologia.grupo_alimento (
    grupo_id       SMALLSERIAL PRIMARY KEY,
    familia_id     SMALLINT NOT NULL REFERENCES dietologia.familia(familia_id),
    nombre         VARCHAR(60) NOT NULL UNIQUE,
    es_perecedero  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE dietologia.proveedor (
    proveedor_id   VARCHAR(10) PRIMARY KEY,
    razon_social   VARCHAR(150) NOT NULL,
    activo         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE dietologia.sede (
    sede_id      VARCHAR(5) PRIMARY KEY,
    nombre_sede  VARCHAR(120) NOT NULL,
    tipo_sede    VARCHAR(20) NOT NULL
                 CHECK (tipo_sede IN ('HOSPITAL','OFICINA_CENTRAL'))
);

-- =====================================================================
-- 2. CATÁLOGO DE ARTÍCULOS Y ESTRUCTURA FÍSICA
-- =====================================================================

CREATE TABLE dietologia.articulo (
    codigo_articulo         VARCHAR(15) PRIMARY KEY,
    descripcion              VARCHAR(255) NOT NULL,
    grupo_id                 SMALLINT NOT NULL REFERENCES dietologia.grupo_alimento(grupo_id),
    unidad_id                SMALLINT NOT NULL REFERENCES dietologia.unidad_medida(unidad_id),
    requiere_control_lote    BOOLEAN NOT NULL DEFAULT TRUE,
    activo                   BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_alta               DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE dietologia.almacen (
    almacen_id     SERIAL PRIMARY KEY,
    sede_id        VARCHAR(5) NOT NULL REFERENCES dietologia.sede(sede_id),
    clave_almacen  VARCHAR(10) NOT NULL,
    nombre         VARCHAR(120) NOT NULL,
    tipo_almacen   VARCHAR(15) NOT NULL
                   CHECK (tipo_almacen IN ('CENTRAL','PERIFERICO','COCINA')),
    UNIQUE (sede_id, clave_almacen)
);

CREATE TABLE dietologia.area_servicio (
    area_id      SMALLSERIAL PRIMARY KEY,
    clave        VARCHAR(30) NOT NULL UNIQUE,
    nombre       VARCHAR(80) NOT NULL,
    almacen_id   INT REFERENCES dietologia.almacen(almacen_id),
    activo       BOOLEAN NOT NULL DEFAULT TRUE
);

-- =====================================================================
-- 3. DOMINIO CONTRACTUAL (LICITACIONES Y CUOTAS POR SEDE)
-- =====================================================================

CREATE TABLE dietologia.licitacion (
    licitacion_id      VARCHAR(20) PRIMARY KEY,
    partida            INT NOT NULL CHECK (partida > 0),
    ejercicio_fiscal   SMALLINT NOT NULL CHECK (ejercicio_fiscal BETWEEN 2000 AND 2100),
    estatus            VARCHAR(20) NOT NULL DEFAULT 'ADJUDICADA'
                       CHECK (estatus IN ('EN_PROCESO','ADJUDICADA','CANCELADA','VENCIDA')),
    fecha_fallo        DATE
);

CREATE TABLE dietologia.contrato_articulo (
    contrato_articulo_id    BIGSERIAL PRIMARY KEY,
    licitacion_id            VARCHAR(20) NOT NULL REFERENCES dietologia.licitacion(licitacion_id),
    codigo_articulo           VARCHAR(15) NOT NULL REFERENCES dietologia.articulo(codigo_articulo),
    proveedor_id              VARCHAR(10) NOT NULL REFERENCES dietologia.proveedor(proveedor_id),
    marca_adjudicada          VARCHAR(60),
    marca_autorizada          VARCHAR(60),
    presentacion_comercial    VARCHAR(120) NOT NULL,
    especificacion_empaque    VARCHAR(255),
    precio_unitario           NUMERIC(12,2) NOT NULL CHECK (precio_unitario > 0),
    precio_referencia         NUMERIC(12,2) CHECK (precio_referencia >= 0),
    activo                    BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_registro            DATE NOT NULL DEFAULT CURRENT_DATE,
    UNIQUE (licitacion_id, codigo_articulo, proveedor_id)
);

-- Garantiza un único renglón contractual ACTIVO por artículo dentro de
-- cada licitación (resuelve la colisión de clave CODIGO=2212001066).
CREATE UNIQUE INDEX ux_contrato_articulo_activo
    ON dietologia.contrato_articulo (licitacion_id, codigo_articulo)
    WHERE activo;

CREATE TABLE dietologia.cupo_contractual_sede (
    cupo_id                        BIGSERIAL PRIMARY KEY,
    contrato_articulo_id            BIGINT NOT NULL REFERENCES dietologia.contrato_articulo(contrato_articulo_id) ON DELETE CASCADE,
    sede_id                         VARCHAR(5) NOT NULL REFERENCES dietologia.sede(sede_id),
    cantidad_minima_anual           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cantidad_minima_anual >= 0),
    cantidad_maxima_anual           NUMERIC(12,2) NOT NULL CHECK (cantidad_maxima_anual >= cantidad_minima_anual),
    cantidad_acumulada_ejercicio    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cantidad_acumulada_ejercicio >= 0),
    UNIQUE (contrato_articulo_id, sede_id),
    CHECK (cantidad_acumulada_ejercicio <= cantidad_maxima_anual)
);

-- =====================================================================
-- 4. DOMINIO DE INVENTARIO Y TRAZABILIDAD (LOTES / KARDEX / SALDOS)
-- =====================================================================

CREATE TABLE dietologia.lote (
    lote_id                 BIGSERIAL PRIMARY KEY,
    codigo_articulo          VARCHAR(15) NOT NULL REFERENCES dietologia.articulo(codigo_articulo),
    proveedor_id             VARCHAR(10) REFERENCES dietologia.proveedor(proveedor_id),
    numero_lote_proveedor    VARCHAR(50) NOT NULL,
    fecha_fabricacion        DATE,
    fecha_caducidad          DATE,
    fecha_recepcion          DATE NOT NULL DEFAULT CURRENT_DATE,
    CHECK (fecha_caducidad IS NULL OR fecha_fabricacion IS NULL OR fecha_caducidad > fecha_fabricacion),
    UNIQUE (codigo_articulo, proveedor_id, numero_lote_proveedor)
);

-- Registro centinela: representa "SIN LOTE" para artículos que no
-- requieren control de caducidad, evitando valores NULL en las llaves
-- compuestas de movimiento_inventario / existencia_almacen. Se apoya en
-- catálogos técnicos placeholder (id = 0) que no se usan en captura real.
INSERT INTO dietologia.familia (familia_id, clave_presupuestal, nombre)
VALUES (0, '0', 'N/A - TECNICO')
ON CONFLICT DO NOTHING;

INSERT INTO dietologia.grupo_alimento (grupo_id, familia_id, nombre, es_perecedero)
VALUES (0, 0, 'N/A - TECNICO', FALSE)
ON CONFLICT DO NOTHING;

INSERT INTO dietologia.unidad_medida (unidad_id, clave, nombre, tipo_medida)
VALUES (0, 'N/A', 'No aplica', 'PIEZA')
ON CONFLICT DO NOTHING;

INSERT INTO dietologia.articulo (codigo_articulo, descripcion, grupo_id, unidad_id, requiere_control_lote, activo)
VALUES ('SIN_ARTICULO', 'REGISTRO TÉCNICO — NO USAR EN CAPTURA', 0, 0, FALSE, FALSE)
ON CONFLICT DO NOTHING;

INSERT INTO dietologia.lote (lote_id, codigo_articulo, numero_lote_proveedor, fecha_recepcion)
VALUES (0, 'SIN_ARTICULO', 'SIN_LOTE', CURRENT_DATE)
ON CONFLICT DO NOTHING;

CREATE TABLE dietologia.orden_suministro (
    orden_id                    BIGSERIAL PRIMARY KEY,
    proveedor_id                 VARCHAR(10) NOT NULL REFERENCES dietologia.proveedor(proveedor_id),
    sede_id                      VARCHAR(5) NOT NULL REFERENCES dietologia.sede(sede_id),
    fecha_emision                DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_entrega_programada     DATE,
    estatus                      VARCHAR(15) NOT NULL DEFAULT 'PENDIENTE'
                                 CHECK (estatus IN ('PENDIENTE','PARCIAL','RECIBIDA','CANCELADA')),
    CHECK (fecha_entrega_programada IS NULL OR fecha_entrega_programada >= fecha_emision)
);

CREATE TABLE dietologia.orden_suministro_detalle (
    orden_detalle_id       BIGSERIAL PRIMARY KEY,
    orden_id                BIGINT NOT NULL REFERENCES dietologia.orden_suministro(orden_id) ON DELETE CASCADE,
    contrato_articulo_id    BIGINT NOT NULL REFERENCES dietologia.contrato_articulo(contrato_articulo_id),
    cantidad_solicitada      NUMERIC(12,2) NOT NULL CHECK (cantidad_solicitada > 0),
    cantidad_recibida        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cantidad_recibida >= 0),
    UNIQUE (orden_id, contrato_articulo_id),
    CHECK (cantidad_recibida <= cantidad_solicitada)
);

CREATE TABLE dietologia.movimiento_inventario (
    movimiento_id          BIGSERIAL PRIMARY KEY,
    almacen_id               INT NOT NULL REFERENCES dietologia.almacen(almacen_id),
    codigo_articulo           VARCHAR(15) NOT NULL REFERENCES dietologia.articulo(codigo_articulo),
    lote_id                   BIGINT NOT NULL DEFAULT 0 REFERENCES dietologia.lote(lote_id),
    tipo_movimiento           VARCHAR(20) NOT NULL
                              CHECK (tipo_movimiento IN (
                                  'ENTRADA_COMPRA','SALIDA_CONSUMO',
                                  'TRANSFERENCIA_SALIDA','TRANSFERENCIA_ENTRADA',
                                  'MERMA','AJUSTE_POSITIVO','AJUSTE_NEGATIVO')),
    cantidad                  NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
    orden_detalle_id          BIGINT REFERENCES dietologia.orden_suministro_detalle(orden_detalle_id),
    fecha_movimiento          TIMESTAMP NOT NULL DEFAULT now(),
    referencia_documento      VARCHAR(60)
);

CREATE TABLE dietologia.existencia_almacen (
    almacen_id       INT NOT NULL REFERENCES dietologia.almacen(almacen_id),
    codigo_articulo    VARCHAR(15) NOT NULL REFERENCES dietologia.articulo(codigo_articulo),
    lote_id             BIGINT NOT NULL DEFAULT 0 REFERENCES dietologia.lote(lote_id),
    cantidad_actual     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cantidad_actual >= 0),
    PRIMARY KEY (almacen_id, codigo_articulo, lote_id)
);

-- =====================================================================
-- 5. DOMINIO DE PROGRAMACIÓN Y PRODUCCIÓN OPERATIVA
-- =====================================================================

CREATE TABLE dietologia.programacion_mensual (
    programacion_id     BIGSERIAL PRIMARY KEY,
    area_id               SMALLINT NOT NULL REFERENCES dietologia.area_servicio(area_id),
    anio                  SMALLINT NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
    mes                   SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    fecha_elaboracion     DATE NOT NULL DEFAULT CURRENT_DATE,
    estatus               VARCHAR(15) NOT NULL DEFAULT 'BORRADOR'
                          CHECK (estatus IN ('BORRADOR','PUBLICADA','CERRADA')),
    UNIQUE (area_id, anio, mes)
);

CREATE TABLE dietologia.programacion_detalle (
    programacion_detalle_id   BIGSERIAL PRIMARY KEY,
    programacion_id             BIGINT NOT NULL REFERENCES dietologia.programacion_mensual(programacion_id) ON DELETE CASCADE,
    codigo_articulo              VARCHAR(15) NOT NULL REFERENCES dietologia.articulo(codigo_articulo),
    fecha                        DATE NOT NULL,
    cantidad_programada          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cantidad_programada >= 0),
    UNIQUE (programacion_id, codigo_articulo, fecha)
);

CREATE TABLE dietologia.produccion_diaria (
    produccion_id      BIGSERIAL PRIMARY KEY,
    area_id              SMALLINT NOT NULL REFERENCES dietologia.area_servicio(area_id),
    fecha                DATE NOT NULL,
    numero_viaje         SMALLINT CHECK (numero_viaje IS NULL OR numero_viaje > 0),
    codigo_articulo       VARCHAR(15) REFERENCES dietologia.articulo(codigo_articulo),
    producto_texto        VARCHAR(255),
    cantidad              NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
    unidad_id             SMALLINT NOT NULL REFERENCES dietologia.unidad_medida(unidad_id),
    CHECK (codigo_articulo IS NOT NULL OR producto_texto IS NOT NULL)
);

-- =====================================================================
-- 6. ÍNDICES OPERATIVOS RECOMENDADOS
-- =====================================================================

-- Requerida antes de crear el índice de búsqueda de texto de la sección 6.2
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Búsqueda de lotes próximos a caducar (operación diaria crítica de Dietología)
CREATE INDEX ix_lote_caducidad ON dietologia.lote (fecha_caducidad)
    WHERE fecha_caducidad IS NOT NULL;

-- Insumos por categoría (consulta frecuente de captura/menú)
CREATE INDEX ix_articulo_grupo ON dietologia.articulo (grupo_id);
CREATE INDEX ix_articulo_descripcion ON dietologia.articulo USING gin (descripcion gin_trgm_ops);

-- Movimientos de almacén por fecha (Kardex, reportes de periodo)
CREATE INDEX ix_movimiento_fecha ON dietologia.movimiento_inventario (fecha_movimiento);
CREATE INDEX ix_movimiento_almacen_articulo ON dietologia.movimiento_inventario (almacen_id, codigo_articulo);

-- Consultas de techo contractual por sede (validación de pedidos en tiempo real)
CREATE INDEX ix_cupo_sede ON dietologia.cupo_contractual_sede (sede_id);

-- Consulta de programación por artículo y rango de fechas (sustituye el
-- barrido de 31 columnas anchas del Excel origen)
CREATE INDEX ix_programacion_detalle_fecha ON dietologia.programacion_detalle (fecha);
CREATE INDEX ix_programacion_detalle_articulo ON dietologia.programacion_detalle (codigo_articulo);

-- Trazabilidad de contratos vigentes por artículo
CREATE INDEX ix_contrato_articulo_codigo ON dietologia.contrato_articulo (codigo_articulo) WHERE activo;
