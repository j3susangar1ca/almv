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
-- 6. CONSOLIDACIÓN DE PEDIDOS EN ÓRDENES DE COMPRA Y TRAZABILIDAD
--    ENTRADA -> SALIDA DE ALMACÉN (ver Fase 2.4 del informe)
-- =====================================================================

-- La salida de almacén queda ligada a la solicitud de área/día que
-- cubre (ej. la entrega de 10 kg a PACIENTES). Se agrega por ALTER
-- porque programacion_detalle se define en la sección 5, posterior a
-- movimiento_inventario.
ALTER TABLE dietologia.movimiento_inventario
    ADD COLUMN programacion_detalle_id BIGINT
        REFERENCES dietologia.programacion_detalle(programacion_detalle_id);

-- Vínculo entre la demanda programada por área (programacion_detalle) y
-- el renglón de Orden de Compra (orden_suministro_detalle) que la
-- consolida. Varias filas de programacion_detalle (de distintas áreas y
-- distintos días del periodo) se agregan hacia uno o más renglones de OC
-- por proveedor+artículo (ej. 10 kg PACIENTES + 10 kg COMEDOR -> 20 kg
-- en un solo renglón de OC).
CREATE TABLE dietologia.consolidacion_pedido (
    consolidacion_id           BIGSERIAL PRIMARY KEY,
    programacion_detalle_id     BIGINT NOT NULL REFERENCES dietologia.programacion_detalle(programacion_detalle_id) ON DELETE CASCADE,
    orden_detalle_id             BIGINT NOT NULL REFERENCES dietologia.orden_suministro_detalle(orden_detalle_id) ON DELETE CASCADE,
    cantidad_consolidada          NUMERIC(12,2) NOT NULL CHECK (cantidad_consolidada > 0),
    UNIQUE (programacion_detalle_id, orden_detalle_id)
);

-- Exige que el artículo programado coincida con el artículo de la OC y
-- que la suma de consolidaciones de un renglón de OC nunca exceda su
-- cantidad_solicitada (la OC se crea primero con el total ya agregado
-- por el proceso de compras; ver Fase 5.2 del informe).
CREATE OR REPLACE FUNCTION dietologia.fn_valida_consolidacion_pedido()
RETURNS TRIGGER AS $$
DECLARE
    v_articulo_programado   VARCHAR(15);
    v_articulo_ordenado     VARCHAR(15);
    v_cantidad_solicitada   NUMERIC(12,2);
    v_suma_consolidada      NUMERIC(12,2);
BEGIN
    SELECT codigo_articulo INTO v_articulo_programado
      FROM dietologia.programacion_detalle
     WHERE programacion_detalle_id = NEW.programacion_detalle_id;

    SELECT ca.codigo_articulo, osd.cantidad_solicitada
      INTO v_articulo_ordenado, v_cantidad_solicitada
      FROM dietologia.orden_suministro_detalle osd
      JOIN dietologia.contrato_articulo ca ON ca.contrato_articulo_id = osd.contrato_articulo_id
     WHERE osd.orden_detalle_id = NEW.orden_detalle_id;

    IF v_articulo_programado IS DISTINCT FROM v_articulo_ordenado THEN
        RAISE EXCEPTION 'consolidacion_pedido: el artículo programado (%) no coincide con el artículo de la OC (%)',
            v_articulo_programado, v_articulo_ordenado;
    END IF;

    SELECT COALESCE(SUM(cantidad_consolidada), 0) INTO v_suma_consolidada
      FROM dietologia.consolidacion_pedido
     WHERE orden_detalle_id = NEW.orden_detalle_id
       AND consolidacion_id <> COALESCE(NEW.consolidacion_id, -1);

    IF v_suma_consolidada + NEW.cantidad_consolidada > v_cantidad_solicitada THEN
        RAISE EXCEPTION 'consolidacion_pedido: la suma consolidada (%) excedería la cantidad_solicitada de la OC (%)',
            v_suma_consolidada + NEW.cantidad_consolidada, v_cantidad_solicitada;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_valida_consolidacion_pedido
    BEFORE INSERT OR UPDATE ON dietologia.consolidacion_pedido
    FOR EACH ROW EXECUTE FUNCTION dietologia.fn_valida_consolidacion_pedido();

-- Trazabilidad de asignación de existencias: qué SALIDA (entrega de
-- almacén a un área) se surtió con qué ENTRADA (recepción ligada a una
-- OC). Permite dividir una sola entrada (ej. 20 kg) entre varias salidas
-- (10 kg a PACIENTES + 10 kg a COMEDOR) y, si un lote se agota, cubrir
-- una salida con más de una entrada.
CREATE TABLE dietologia.asignacion_salida_entrada (
    asignacion_id           BIGSERIAL PRIMARY KEY,
    movimiento_salida_id      BIGINT NOT NULL REFERENCES dietologia.movimiento_inventario(movimiento_id) ON DELETE CASCADE,
    movimiento_entrada_id     BIGINT NOT NULL REFERENCES dietologia.movimiento_inventario(movimiento_id) ON DELETE CASCADE,
    cantidad_asignada          NUMERIC(12,2) NOT NULL CHECK (cantidad_asignada > 0),
    CHECK (movimiento_salida_id <> movimiento_entrada_id),
    UNIQUE (movimiento_salida_id, movimiento_entrada_id)
);

-- Exige que ambos movimientos sean, respectivamente, una salida y una
-- entrada reales; que compartan artículo/almacén/lote; y que ninguna
-- suma de asignaciones exceda la cantidad física de la entrada ni de la
-- salida (impide "repartir" más de lo que realmente entró o salió).
CREATE OR REPLACE FUNCTION dietologia.fn_valida_asignacion_salida_entrada()
RETURNS TRIGGER AS $$
DECLARE
    v_salida         dietologia.movimiento_inventario%ROWTYPE;
    v_entrada        dietologia.movimiento_inventario%ROWTYPE;
    v_suma_entrada   NUMERIC(12,2);
    v_suma_salida    NUMERIC(12,2);
BEGIN
    SELECT * INTO v_salida  FROM dietologia.movimiento_inventario WHERE movimiento_id = NEW.movimiento_salida_id;
    SELECT * INTO v_entrada FROM dietologia.movimiento_inventario WHERE movimiento_id = NEW.movimiento_entrada_id;

    IF v_salida.tipo_movimiento NOT IN ('SALIDA_CONSUMO','TRANSFERENCIA_SALIDA','MERMA','AJUSTE_NEGATIVO') THEN
        RAISE EXCEPTION 'asignacion_salida_entrada: el movimiento % no es una salida (tipo=%)',
            NEW.movimiento_salida_id, v_salida.tipo_movimiento;
    END IF;
    IF v_entrada.tipo_movimiento NOT IN ('ENTRADA_COMPRA','TRANSFERENCIA_ENTRADA','AJUSTE_POSITIVO') THEN
        RAISE EXCEPTION 'asignacion_salida_entrada: el movimiento % no es una entrada (tipo=%)',
            NEW.movimiento_entrada_id, v_entrada.tipo_movimiento;
    END IF;
    IF v_salida.codigo_articulo <> v_entrada.codigo_articulo
       OR v_salida.almacen_id <> v_entrada.almacen_id
       OR v_salida.lote_id <> v_entrada.lote_id THEN
        RAISE EXCEPTION 'asignacion_salida_entrada: la salida % y la entrada % no corresponden al mismo artículo/almacén/lote',
            NEW.movimiento_salida_id, NEW.movimiento_entrada_id;
    END IF;

    SELECT COALESCE(SUM(cantidad_asignada), 0) INTO v_suma_entrada
      FROM dietologia.asignacion_salida_entrada
     WHERE movimiento_entrada_id = NEW.movimiento_entrada_id
       AND asignacion_id <> COALESCE(NEW.asignacion_id, -1);
    IF v_suma_entrada + NEW.cantidad_asignada > v_entrada.cantidad THEN
        RAISE EXCEPTION 'asignacion_salida_entrada: se asignaría % contra una entrada de sólo % unidades',
            v_suma_entrada + NEW.cantidad_asignada, v_entrada.cantidad;
    END IF;

    SELECT COALESCE(SUM(cantidad_asignada), 0) INTO v_suma_salida
      FROM dietologia.asignacion_salida_entrada
     WHERE movimiento_salida_id = NEW.movimiento_salida_id
       AND asignacion_id <> COALESCE(NEW.asignacion_id, -1);
    IF v_suma_salida + NEW.cantidad_asignada > v_salida.cantidad THEN
        RAISE EXCEPTION 'asignacion_salida_entrada: se asignaría % contra una salida de sólo % unidades',
            v_suma_salida + NEW.cantidad_asignada, v_salida.cantidad;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_valida_asignacion_salida_entrada
    BEFORE INSERT OR UPDATE ON dietologia.asignacion_salida_entrada
    FOR EACH ROW EXECUTE FUNCTION dietologia.fn_valida_asignacion_salida_entrada();

-- =====================================================================
-- 7. ÍNDICES OPERATIVOS RECOMENDADOS
-- =====================================================================

-- Requerida antes de crear el índice de búsqueda de texto más abajo
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

-- Consolidación de pedidos en OC (sección 6): resolver en ambos sentidos
-- "¿qué áreas están detrás de este renglón de OC?" y "¿en qué OC quedó
-- consolidada esta solicitud de área?"
CREATE INDEX ix_consolidacion_pedido_orden ON dietologia.consolidacion_pedido (orden_detalle_id);
CREATE INDEX ix_consolidacion_pedido_programacion ON dietologia.consolidacion_pedido (programacion_detalle_id);

-- Trazabilidad entrada<->salida (sección 6) y salidas ligadas a una
-- solicitud de área
CREATE INDEX ix_asignacion_entrada ON dietologia.asignacion_salida_entrada (movimiento_entrada_id);
CREATE INDEX ix_asignacion_salida ON dietologia.asignacion_salida_entrada (movimiento_salida_id);
CREATE INDEX ix_movimiento_programacion_detalle ON dietologia.movimiento_inventario (programacion_detalle_id)
    WHERE programacion_detalle_id IS NOT NULL;
