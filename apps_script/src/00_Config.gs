/**
 * Configuración central del proyecto.
 * IDs reales (Sheet, carpetas de Drive, plantillas de Docs) se guardan en
 * PropertiesService, nunca hardcodeados aquí, para poder reutilizar el
 * mismo código en un Sheet de pruebas y en el de producción.
 *
 * Alcance deliberadamente acotado: esta herramienta es de UNA sola sede
 * (Hospital Civil de Guadalajara "Fray Antonio Alcalde", FAA) y UN solo
 * almacén de víveres — no hay concepto de sede ni de almacén como
 * catálogos separados, son una constante. Si el día de mañana el proyecto
 * necesitara más de una sede, ese es exactamente el escenario para el que
 * existe el diseño de referencia en PostgreSQL (`schema_dietologia.sql`),
 * que sí las modela por separado.
 */

const SEDE_NOMBRE = 'Hospital Civil de Guadalajara "Fray Antonio Alcalde"';

function CONFIG_() {
  const props = PropertiesService.getScriptProperties();
  return {
    SPREADSHEET_ID: props.getProperty('SPREADSHEET_ID'),
    CARPETA_DOCUMENTOS_ID: props.getProperty('CARPETA_DOCUMENTOS_ID'),
    PLANTILLA_VALE_PEDIDO_ID: props.getProperty('PLANTILLA_VALE_PEDIDO_ID'),
    PLANTILLA_ORDEN_COMPRA_ID: props.getProperty('PLANTILLA_ORDEN_COMPRA_ID'),
    CORREOS_NOTIFICACION: (props.getProperty('CORREOS_NOTIFICACION') || '').split(',').filter(String),
    DIAS_ALERTA_CADUCIDAD: Number(props.getProperty('DIAS_ALERTA_CADUCIDAD') || 15),
    UMBRAL_ALERTA_TECHO_CONTRACTUAL: Number(props.getProperty('UMBRAL_ALERTA_TECHO_CONTRACTUAL') || 0.9),
  };
}

/**
 * Ejecutar UNA VEZ manualmente desde el editor de Apps Script (menú
 * "Ejecutar" → seleccionar esta función) para dejar configurado el
 * proyecto antes de correr crearEstructuraCompleta().
 */
function configurarProyectoInicial() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    SPREADSHEET_ID: SpreadsheetApp.getActiveSpreadsheet().getId(),
    CORREOS_NOTIFICACION: 'dietologia@hospitalcivil.example, almacen.viveres@hospitalcivil.example',
    DIAS_ALERTA_CADUCIDAD: '15',
    UMBRAL_ALERTA_TECHO_CONTRACTUAL: '0.9',
  }, false);
  SpreadsheetApp.getUi().alert('Propiedades iniciales guardadas. Ajusta CARPETA_DOCUMENTOS_ID y las plantillas de Docs cuando las tengas creadas.');
}

/**
 * Definición de las pestañas de datos: nombre exacto de la hoja,
 * encabezados en el mismo orden, y columna(s) que actúan como llave
 * primaria para siguienteId_() / búsquedas por clave. Ver
 * 03_ImportarCSV.gs para cómo se puebla desde dietologia_normalizado/.
 */
const ESQUEMA_HOJAS = {
  familia: { headers: ['familia_id', 'clave_presupuestal', 'nombre'], pk: 'familia_id' },
  grupo_alimento: { headers: ['grupo_id', 'familia_id', 'nombre', 'es_perecedero'], pk: 'grupo_id' },
  proveedor: { headers: ['proveedor_id', 'razon_social', 'activo'], pk: 'proveedor_id' },
  articulo: {
    // unidad_medida es texto libre con lista desplegable (ver UNIDADES_MEDIDA), no una
    // tabla de catálogo aparte: con ~13 valores fijos, una FK es más costo que beneficio.
    headers: ['codigo_articulo', 'descripcion', 'grupo_id', 'unidad_medida', 'requiere_control_lote', 'activo', 'fecha_alta'],
    pk: 'codigo_articulo',
  },
  area_servicio: { headers: ['area_id', 'clave', 'nombre', 'activo'], pk: 'area_id' },
  licitacion: { headers: ['licitacion_id', 'partida', 'ejercicio_fiscal', 'estatus', 'fecha_fallo'], pk: 'licitacion_id' },
  contrato_articulo: {
    // El techo contractual (antes cupo_contractual_sede) vive aquí directamente: con una
    // sola sede, "cupo por sede" era una tabla puente 1:1 disfrazada de N:M.
    headers: ['contrato_articulo_id', 'licitacion_id', 'codigo_articulo', 'proveedor_id', 'marca_adjudicada',
      'marca_autorizada', 'presentacion_comercial', 'especificacion_empaque', 'precio_unitario',
      'precio_referencia', 'cantidad_minima_anual', 'cantidad_maxima_anual', 'cantidad_acumulada_ejercicio',
      'activo', 'fecha_registro'],
    pk: 'contrato_articulo_id',
  },
  orden_compra: {
    headers: ['orden_id', 'proveedor_id', 'fecha_emision', 'fecha_entrega_programada', 'estatus'],
    pk: 'orden_id',
  },
  orden_compra_detalle: {
    headers: ['orden_detalle_id', 'orden_id', 'contrato_articulo_id', 'cantidad_solicitada', 'cantidad_recibida'],
    pk: 'orden_detalle_id',
  },
  movimiento_inventario: {
    // El lote (antes tabla aparte) es un dato de la entrada, no una entidad con vida
    // propia: numero_lote_proveedor/fecha_fabricacion/fecha_caducidad viajan aquí,
    // vacíos salvo en movimientos ENTRADA_COMPRA de artículos con requiere_control_lote.
    headers: ['movimiento_id', 'codigo_articulo', 'tipo_movimiento', 'cantidad',
      'numero_lote_proveedor', 'fecha_fabricacion', 'fecha_caducidad',
      'orden_detalle_id', 'programacion_detalle_id', 'fecha_movimiento', 'referencia_documento'],
    pk: 'movimiento_id',
  },
  existencia: {
    headers: ['codigo_articulo', 'cantidad_actual'],
    pk: 'codigo_articulo', // un solo almacén: el saldo es 1 fila por artículo, sin más llave que esa.
  },
  programacion_mensual: {
    headers: ['programacion_id', 'area_id', 'anio', 'mes', 'fecha_elaboracion', 'estatus', 'fecha_envio', 'enviado_por_usuario_id'],
    pk: 'programacion_id',
  },
  programacion_detalle: {
    headers: ['programacion_detalle_id', 'programacion_id', 'codigo_articulo', 'fecha', 'cantidad_programada'],
    pk: 'programacion_detalle_id',
  },
  produccion_diaria: {
    headers: ['produccion_id', 'area_id', 'fecha', 'numero_viaje', 'codigo_articulo', 'producto_texto',
      'cantidad', 'unidad_medida'],
    pk: 'produccion_id',
  },
  consolidacion_pedido: {
    headers: ['consolidacion_id', 'programacion_detalle_id', 'orden_detalle_id', 'cantidad_consolidada'],
    pk: 'consolidacion_id',
  },
  asignacion_salida_entrada: {
    headers: ['asignacion_id', 'movimiento_salida_id', 'movimiento_entrada_id', 'cantidad_asignada'],
    pk: 'asignacion_id',
  },

  // --- RBAC, alcance por servicio y consolidación centralizada ---
  usuarios: {
    headers: ['usuario_id', 'correo', 'nombre', 'rol', 'activo'],
    pk: 'usuario_id',
  },
  // "servicio" del documento de requerimientos = area_servicio ya existente en el
  // modelo (GENERAL, PACIENTES, COMEDOR, ...); no se duplica el catálogo, sólo se
  // referencia por area_id para no tener dos fuentes de verdad del mismo concepto.
  usuario_servicios: {
    headers: ['asignacion_id', 'usuario_id', 'area_id', 'permiso'],
    pk: 'asignacion_id',
  },
  consolidado_general: {
    headers: ['consolidado_id', 'programacion_id', 'area_id', 'codigo_articulo', 'fecha',
      'cantidad_programada', 'programacion_detalle_id', 'usuario_envio_id', 'fecha_envio'],
    pk: 'consolidado_id',
  },
};

// Catálogo cerrado de unidades de medida — antes tabla `unidad_medida`, ahora una lista
// simple reutilizada como validación de datos en `articulo.unidad_medida` y
// `produccion_diaria.unidad_medida` (ver aplicarValidacionesColumna_ en 02_SetupSheets.gs).
const UNIDADES_MEDIDA = ['KG', 'PIEZA', 'LITRO', 'CAJA', 'PAQUETE', 'FRASCO', 'BOTE', 'GALON', 'BIDON', 'SOBRE', 'BOLSA', 'MANOJO', 'LATA', 'GARRAFON'];

// Tipos de movimiento válidos (antes CHECK de movimiento_inventario.tipo_movimiento)
const TIPOS_MOVIMIENTO_SALIDA = ['SALIDA_CONSUMO', 'TRANSFERENCIA_SALIDA', 'MERMA', 'AJUSTE_NEGATIVO'];
const TIPOS_MOVIMIENTO_ENTRADA = ['ENTRADA_COMPRA', 'TRANSFERENCIA_ENTRADA', 'AJUSTE_POSITIVO'];

// Columnas con lista desplegable (antes CHECK ... IN (...) en el DDL de Postgres)
const VALIDACIONES_LISTA = {
  articulo: { unidad_medida: UNIDADES_MEDIDA },
  produccion_diaria: { unidad_medida: UNIDADES_MEDIDA },
  licitacion: { estatus: ['EN_PROCESO', 'ADJUDICADA', 'CANCELADA', 'VENCIDA'] },
  orden_compra: { estatus: ['PENDIENTE', 'PARCIAL', 'RECIBIDA', 'CANCELADA'] },
  movimiento_inventario: { tipo_movimiento: TIPOS_MOVIMIENTO_SALIDA.concat(TIPOS_MOVIMIENTO_ENTRADA) },
  // BORRADOR -> ENVIADO es todo el ciclo de vida que se modela (ver 31_CicloVida.gs).
  // Con el Enfoque A de consolidación (transaccional, sección 6.2 del SRS) ENVIADO y
  // "CONSOLIDADO" ocurren en el mismo paso atómico, así que no se agrega un tercer
  // estatus: la fuente de verdad de qué quedó consolidado es la pestaña
  // consolidado_general, no un valor adicional de estatus.
  programacion_mensual: { estatus: ['BORRADOR', 'ENVIADO'] },
  usuarios: { rol: ['CAPTURISTA', 'SUPERVISOR', 'ADMINISTRADOR'] },
  usuario_servicios: { permiso: ['LECTURA', 'ESCRITURA', 'APROBACION'] },
};
const COLUMNAS_BOOLEANAS = ['activo', 'es_perecedero', 'requiere_control_lote'];
const COLUMNAS_FECHA = [
  'fecha_alta', 'fecha_fallo', 'fecha_registro', 'fecha_fabricacion', 'fecha_caducidad',
  'fecha_emision', 'fecha_entrega_programada', 'fecha_elaboracion', 'fecha', 'fecha_envio',
];

// Jerarquía de permisos por servicio (RBAC), de menor a mayor alcance.
const NIVEL_PERMISO = { LECTURA: 1, ESCRITURA: 2, APROBACION: 3 };
