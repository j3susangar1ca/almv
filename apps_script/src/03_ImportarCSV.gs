/**
 * Importa los CSV ya saneados (dietologia_normalizado/*.csv, generados por
 * etl_normalizacion.py) hacia las pestañas del esquema SIMPLIFICADO de esta
 * herramienta (sin sede/almacén/lote/cupo-por-sede como catálogos aparte,
 * sin unidad_medida como tabla). Esos CSV siguen teniendo la forma del
 * diseño de referencia en PostgreSQL (ver ../INFORME_DISENO_BD_DIETOLOGIA.md);
 * en vez de regenerarlos, este importador hace la traducción una sola vez,
 * al momento de cargar:
 *   - unidad_medida.csv resuelve unidad_id -> texto en articulo/produccion_diaria.
 *   - cupo_contractual_sede.csv se fusiona en contrato_articulo, tomando SÓLO
 *     la fila de la sede FAA (las demás sedes no aplican a esta herramienta).
 *   - sede.csv, almacen.csv y lote.csv NO se importan (no existen como pestañas).
 *   - orden_suministro(.csv)/orden_suministro_detalle.csv se cargan en
 *     orden_compra/orden_compra_detalle (mismo contenido, sede_id descartado).
 *
 * Apps Script no puede leer el sistema de archivos local del repositorio,
 * así que el requisito previo es subir los CSV de dietologia_normalizado/ a
 * UNA carpeta de Drive.
 *
 * Uso:
 *   1. Sube los .csv de dietologia_normalizado/ a una carpeta de Drive.
 *   2. Copia el ID de esa carpeta (de la URL).
 *   3. Ejecuta importarTodosLosCSV('ese_id') desde el editor.
 */
function importarTodosLosCSV(idCarpetaDrive) {
  const folderId = idCarpetaDrive || CONFIG_().CARPETA_CSV_ID || '1uKZQ1RKhq71fuUaq--XbRTNYKT3RhnF4';
  const carpeta = DriveApp.getFolderById(folderId);
  const resultados = [];

  // 1) Catálogos que se importan sin transformación de forma
  ['familia', 'grupo_alimento', 'proveedor', 'licitacion',
    'programacion_mensual', 'programacion_detalle',
    'consolidacion_pedido', 'asignacion_salida_entrada'].forEach((nombre) => {
    const filas = leerCSVDrive_(carpeta, nombre + '.csv');
    if (filas === null) { resultados.push(nombre + ': archivo no encontrado, se omite'); return; }
    resultados.push(nombre + ': ' + escribirFilasHoja_(nombre, filas) + ' filas importadas');
  });

  // 2) Resolver unidad_id -> texto (unidad_medida.csv es sólo un puente, no se importa como tabla).
  //    Un par de variantes del CSV origen no están en el catálogo cerrado UNIDADES_MEDIDA
  //    (mismo tipo de sinónimo/error de captura que ya documentó el informe de diseño para
  //    FRASCO/FRASCOS/FCO y 'KG   K'); se normalizan aquí antes de escribir en articulo/produccion_diaria.
  const SINONIMOS_UNIDAD = { 'FCO.': 'FRASCO', 'KG K': 'KG' };
  const unidadesCsv = leerCSVDrive_(carpeta, 'unidad_medida.csv') || [];
  const claveUnidadPorId = {};
  unidadesCsv.forEach((u) => { claveUnidadPorId[u.unidad_id] = SINONIMOS_UNIDAD[u.clave] || u.clave; });

  const articulosCsv = leerCSVDrive_(carpeta, 'articulo.csv');
  if (articulosCsv) {
    const filas = articulosCsv.map((a) => ({
      codigo_articulo: a.codigo_articulo, descripcion: a.descripcion, grupo_id: a.grupo_id,
      unidad_medida: claveUnidadPorId[a.unidad_id] || '', requiere_control_lote: a.requiere_control_lote,
      activo: a.activo, fecha_alta: a.fecha_alta,
    }));
    resultados.push('articulo: ' + escribirFilasHoja_('articulo', filas) + ' filas importadas (unidad_id -> unidad_medida resuelto)');
  }

  const produccionCsv = leerCSVDrive_(carpeta, 'produccion_diaria.csv');
  if (produccionCsv) {
    const filas = produccionCsv.map((p) => ({
      produccion_id: p.produccion_id, area_id: p.area_id, fecha: p.fecha, numero_viaje: p.numero_viaje,
      codigo_articulo: p.codigo_articulo, producto_texto: p.producto_texto, cantidad: p.cantidad,
      unidad_medida: claveUnidadPorId[p.unidad_id] || '',
    }));
    resultados.push('produccion_diaria: ' + escribirFilasHoja_('produccion_diaria', filas) + ' filas importadas (unidad_id -> unidad_medida resuelto)');
  }

  // 3) area_servicio: se descarta almacen_id (ya no existe almacén separado)
  const areasCsv = leerCSVDrive_(carpeta, 'area_servicio.csv');
  if (areasCsv) {
    const filas = areasCsv.map((a) => ({ area_id: a.area_id, clave: a.clave, nombre: a.nombre, activo: a.activo }));
    resultados.push('area_servicio: ' + escribirFilasHoja_('area_servicio', filas) + ' filas importadas (almacen_id descartado)');
  }

  // 4) contrato_articulo + cupo_contractual_sede (sólo FAA) fusionados
  const cuposCsv = leerCSVDrive_(carpeta, 'cupo_contractual_sede.csv') || [];
  const cupoFaaPorContrato = {};
  cuposCsv.filter((c) => c.sede_id === 'FAA').forEach((c) => { cupoFaaPorContrato[c.contrato_articulo_id] = c; });

  const contratosCsv = leerCSVDrive_(carpeta, 'contrato_articulo.csv');
  if (contratosCsv) {
    let sinCupoFaa = 0;
    const filas = contratosCsv.map((c) => {
      const cupo = cupoFaaPorContrato[c.contrato_articulo_id];
      if (!cupo) sinCupoFaa++;
      return {
        contrato_articulo_id: c.contrato_articulo_id, licitacion_id: c.licitacion_id, codigo_articulo: c.codigo_articulo,
        proveedor_id: c.proveedor_id, marca_adjudicada: c.marca_adjudicada, marca_autorizada: c.marca_autorizada,
        presentacion_comercial: c.presentacion_comercial, especificacion_empaque: c.especificacion_empaque,
        precio_unitario: c.precio_unitario, precio_referencia: c.precio_referencia,
        cantidad_minima_anual: cupo ? cupo.cantidad_minima_anual : 0,
        cantidad_maxima_anual: cupo ? cupo.cantidad_maxima_anual : 0,
        cantidad_acumulada_ejercicio: cupo ? cupo.cantidad_acumulada_ejercicio : 0,
        activo: c.activo, fecha_registro: c.fecha_registro,
      };
    });
    resultados.push('contrato_articulo: ' + escribirFilasHoja_('contrato_articulo', filas) +
      ' filas importadas (cupo de FAA fusionado; ' + sinCupoFaa + ' renglones sin cupo en FAA quedaron con techo 0)');
  }

  // 5) orden_compra / orden_compra_detalle (renombradas; orden_suministro.csv pierde sede_id)
  const ordenCsv = leerCSVDrive_(carpeta, 'orden_suministro.csv');
  if (ordenCsv) {
    const filas = ordenCsv.map((o) => ({
      orden_id: o.orden_id, proveedor_id: o.proveedor_id, fecha_emision: o.fecha_emision,
      fecha_entrega_programada: o.fecha_entrega_programada, estatus: o.estatus,
    }));
    resultados.push('orden_compra: ' + escribirFilasHoja_('orden_compra', filas) + ' filas importadas (sede_id descartado)');
  }
  const ordenDetalleCsv = leerCSVDrive_(carpeta, 'orden_suministro_detalle.csv');
  if (ordenDetalleCsv) {
    resultados.push('orden_compra_detalle: ' + escribirFilasHoja_('orden_compra_detalle', ordenDetalleCsv) + ' filas importadas');
  }

  // 6) movimiento_inventario: pierde almacen_id/lote_id, gana columnas de lote inline
  //    (el histórico de origen no tiene movimientos capturados, así que llegan vacías)
  const movCsv = leerCSVDrive_(carpeta, 'movimiento_inventario.csv');
  if (movCsv) {
    const filas = movCsv.map((m) => ({
      movimiento_id: m.movimiento_id, codigo_articulo: m.codigo_articulo, tipo_movimiento: m.tipo_movimiento,
      cantidad: m.cantidad, numero_lote_proveedor: '', fecha_fabricacion: '', fecha_caducidad: '',
      orden_detalle_id: m.orden_detalle_id, programacion_detalle_id: m.programacion_detalle_id,
      fecha_movimiento: m.fecha_movimiento, referencia_documento: m.referencia_documento,
    }));
    resultados.push('movimiento_inventario: ' + escribirFilasHoja_('movimiento_inventario', filas) + ' filas importadas');
  }

  // 7) existencia (antes existencia_almacen): pierde almacen_id/lote_id
  const existCsv = leerCSVDrive_(carpeta, 'existencia_almacen.csv');
  if (existCsv) {
    const filas = existCsv.map((e) => ({ codigo_articulo: e.codigo_articulo, cantidad_actual: e.cantidad_actual }));
    resultados.push('existencia: ' + escribirFilasHoja_('existencia', filas) + ' filas importadas');
  }

  Logger.log(resultados.join('\n'));
  try {
    SpreadsheetApp.getUi().alert(resultados.join('\n'));
  } catch (e) {
    // Si se ejecuta sin interfaz gráfica de UI
  }
}

/** Lee un CSV de Drive y lo devuelve como arreglo de objetos {columna: valorTexto}. Null si el archivo no existe. */
function leerCSVDrive_(carpeta, nombreArchivo) {
  const archivos = carpeta.getFilesByName(nombreArchivo);
  if (!archivos.hasNext()) return null;
  const texto = archivos.next().getBlob().getDataAsString('UTF-8');
  const filas = Utilities.parseCsv(texto);
  if (filas.length === 0) return [];
  const headers = filas[0];
  return filas.slice(1).map((fila) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = fila[i]; });
    return obj;
  });
}

/** Escribe un arreglo de objetos en una pestaña, en el orden de columnas del esquema, en lotes. */
function escribirFilasHoja_(nombreHoja, filasObjeto) {
  const def = ESQUEMA_HOJAS[nombreHoja];
  const sheet = hoja_(nombreHoja);
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, def.headers.length).clearContent();
  if (filasObjeto.length === 0) return 0;

  const datos = filasObjeto.map((obj) => def.headers.map(
    (h) => coercionColumna_(h, obj[h] === undefined || obj[h] === null ? '' : String(obj[h]))
  ));

  const TAMANO_LOTE = 5000; // margen amplio frente a la cuota de 6 min de ejecución
  for (let inicio = 0; inicio < datos.length; inicio += TAMANO_LOTE) {
    const lote = datos.slice(inicio, inicio + TAMANO_LOTE);
    sheet.getRange(2 + inicio, 1, lote.length, def.headers.length).setValues(lote);
  }
  return datos.length;
}

/** Convierte el texto crudo del CSV al tipo que corresponde según la columna. */
function coercionColumna_(nombreColumna, valorTexto) {
  if (valorTexto === '') return '';
  if (COLUMNAS_BOOLEANAS.indexOf(nombreColumna) !== -1) {
    return String(valorTexto).trim().toLowerCase() === 'true';
  }
  if (COLUMNAS_FECHA.indexOf(nombreColumna) !== -1) {
    return valorTexto; // se guarda como texto ISO 'yyyy-mm-dd'; el formato de columna lo muestra como fecha
  }
  const numero = Number(valorTexto);
  return Number.isFinite(numero) && valorTexto.trim() !== '' && /^-?\d+(\.\d+)?$/.test(valorTexto.trim())
    ? numero
    : valorTexto;
}
