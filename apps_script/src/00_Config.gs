/**
 * Configuración central del proyecto.
 * IDs reales (Sheet, carpetas de Drive, plantillas de Docs) se guardan en
 * PropertiesService, nunca hardcodeados aquí, para poder reutilizar el
 * mismo código en un Sheet de pruebas y en el de producción.
 */

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
function configurarProyectoInicial(spreadsheetId) {
  const props = PropertiesService.getScriptProperties();
  let id = spreadsheetId;
  if (!id) {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) id = active.getId();
  }
  if (!id) {
    id = props.getProperty('SPREADSHEET_ID');
  }
  if (!id) {
    throw new Error('Debes proporcionar el ID del Google Sheet. Ejemplo: configurarProyectoInicial("TU_SPREADSHEET_ID")');
  }
  props.setProperties({
    SPREADSHEET_ID: id,
    CORREOS_NOTIFICACION: 'dietologia@hospitalcivil.example, almacen.viveres@hospitalcivil.example',
    DIAS_ALERTA_CADUCIDAD: '15',
    UMBRAL_ALERTA_TECHO_CONTRACTUAL: '0.9',
  }, false);
  const msg = 'Propiedades iniciales guardadas con SPREADSHEET_ID: ' + id;
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    // Si se ejecuta en un proyecto standalone sin contenedor de UI
  }
}

/**
 * Definición de las 21 pestañas de datos: nombre exacto de la hoja,
 * encabezados en el mismo orden que dietologia_normalizado/*.csv, y
 * columna(s) que actúan como llave primaria para siguienteId_() /
 * búsquedas por clave.
 */
const ESQUEMA_HOJAS = {
  unidad_medida: { headers: ['unidad_id', 'clave', 'nombre', 'tipo_medida'], pk: 'unidad_id' },
  familia: { headers: ['familia_id', 'clave_presupuestal', 'nombre'], pk: 'familia_id' },
  grupo_alimento: { headers: ['grupo_id', 'familia_id', 'nombre', 'es_perecedero'], pk: 'grupo_id' },
  proveedor: { headers: ['proveedor_id', 'razon_social', 'activo'], pk: 'proveedor_id' },
  sede: { headers: ['sede_id', 'nombre_sede', 'tipo_sede'], pk: 'sede_id' },
  articulo: {
    headers: ['codigo_articulo', 'descripcion', 'grupo_id', 'unidad_id', 'requiere_control_lote', 'activo', 'fecha_alta'],
    pk: 'codigo_articulo',
  },
  almacen: { headers: ['almacen_id', 'sede_id', 'clave_almacen', 'nombre', 'tipo_almacen'], pk: 'almacen_id' },
  area_servicio: { headers: ['area_id', 'clave', 'nombre', 'almacen_id', 'activo'], pk: 'area_id' },
  licitacion: { headers: ['licitacion_id', 'partida', 'ejercicio_fiscal', 'estatus', 'fecha_fallo'], pk: 'licitacion_id' },
  contrato_articulo: {
    headers: ['contrato_articulo_id', 'licitacion_id', 'codigo_articulo', 'proveedor_id', 'marca_adjudicada',
      'marca_autorizada', 'presentacion_comercial', 'especificacion_empaque', 'precio_unitario',
      'precio_referencia', 'activo', 'fecha_registro'],
    pk: 'contrato_articulo_id',
  },
  cupo_contractual_sede: {
    headers: ['cupo_id', 'contrato_articulo_id', 'sede_id', 'cantidad_minima_anual', 'cantidad_maxima_anual',
      'cantidad_acumulada_ejercicio'],
    pk: 'cupo_id',
  },
  lote: {
    headers: ['lote_id', 'codigo_articulo', 'proveedor_id', 'numero_lote_proveedor', 'fecha_fabricacion',
      'fecha_caducidad', 'fecha_recepcion'],
    pk: 'lote_id',
  },
  orden_suministro: {
    headers: ['orden_id', 'proveedor_id', 'sede_id', 'fecha_emision', 'fecha_entrega_programada', 'estatus'],
    pk: 'orden_id',
  },
  orden_suministro_detalle: {
    headers: ['orden_detalle_id', 'orden_id', 'contrato_articulo_id', 'cantidad_solicitada', 'cantidad_recibida'],
    pk: 'orden_detalle_id',
  },
  movimiento_inventario: {
    headers: ['movimiento_id', 'almacen_id', 'codigo_articulo', 'lote_id', 'tipo_movimiento', 'cantidad',
      'orden_detalle_id', 'programacion_detalle_id', 'fecha_movimiento', 'referencia_documento'],
    pk: 'movimiento_id',
  },
  existencia_almacen: {
    headers: ['almacen_id', 'codigo_articulo', 'lote_id', 'cantidad_actual'],
    pk: null, // llave compuesta (almacen_id, codigo_articulo, lote_id); ver 40_Inventario.gs
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
      'cantidad', 'unidad_id'],
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

// Tipos de movimiento válidos (antes CHECK de movimiento_inventario.tipo_movimiento)
const TIPOS_MOVIMIENTO_SALIDA = ['SALIDA_CONSUMO', 'TRANSFERENCIA_SALIDA', 'MERMA', 'AJUSTE_NEGATIVO'];
const TIPOS_MOVIMIENTO_ENTRADA = ['ENTRADA_COMPRA', 'TRANSFERENCIA_ENTRADA', 'AJUSTE_POSITIVO'];
const LOTE_CENTINELA_ID = 0; // "SIN LOTE", para artículos con requiere_control_lote = false

// Columnas con lista desplegable (antes CHECK ... IN (...) en el DDL de Postgres)
const VALIDACIONES_LISTA = {
  unidad_medida: { tipo_medida: ['PESO', 'VOLUMEN', 'PIEZA', 'PAQUETE'] },
  sede: { tipo_sede: ['HOSPITAL', 'OFICINA_CENTRAL'] },
  almacen: { tipo_almacen: ['CENTRAL', 'PERIFERICO', 'COCINA'] },
  licitacion: { estatus: ['EN_PROCESO', 'ADJUDICADA', 'CANCELADA', 'VENCIDA'] },
  orden_suministro: { estatus: ['PENDIENTE', 'PARCIAL', 'RECIBIDA', 'CANCELADA'] },
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
  'fecha_recepcion', 'fecha_emision', 'fecha_entrega_programada', 'fecha_elaboracion', 'fecha', 'fecha_envio',
];

// Jerarquía de permisos por servicio (RBAC), de menor a mayor alcance.
const NIVEL_PERMISO = { LECTURA: 1, ESCRITURA: 2, APROBACION: 3 };
