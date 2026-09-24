/**
 * Importa los CSV ya saneados (dietologia_normalizado/*.csv, generados por
 * etl_normalizacion.py) hacia sus pestañas correspondientes. Apps Script
 * no puede leer el sistema de archivos local del repositorio, así que el
 * requisito previo es subir los 21 CSV a UNA carpeta de Drive.
 *
 * Uso:
 *   1. Sube los .csv de dietologia_normalizado/ a una carpeta de Drive.
 *   2. Copia el ID de esa carpeta (de la URL).
 *   3. Ejecuta importarTodosLosCSV('ese_id') desde el editor.
 */
function importarTodosLosCSV(idCarpetaDrive) {
  // Orden de carga = el mismo de la Fase 5.1 del informe (respeta FKs)
  const ORDEN_CARGA = [
    'unidad_medida', 'familia', 'grupo_alimento', 'proveedor', 'sede',
    'articulo', 'almacen', 'area_servicio',
    'licitacion', 'contrato_articulo', 'cupo_contractual_sede',
    'lote', 'orden_suministro', 'orden_suministro_detalle', 'movimiento_inventario', 'existencia_almacen',
    'programacion_mensual', 'programacion_detalle', 'produccion_diaria',
    'consolidacion_pedido', 'asignacion_salida_entrada',
  ];
  const carpeta = DriveApp.getFolderById(idCarpetaDrive);
  const resultados = [];
  ORDEN_CARGA.forEach((nombreHoja) => {
    const archivos = carpeta.getFilesByName(nombreHoja + '.csv');
    if (!archivos.hasNext()) {
      resultados.push(nombreHoja + ': archivo no encontrado, se omite');
      return;
    }
    const filas = importarCSV_(nombreHoja, archivos.next());
    resultados.push(nombreHoja + ': ' + filas + ' filas importadas');
  });
  Logger.log(resultados.join('\n'));
  SpreadsheetApp.getUi().alert(resultados.join('\n'));
}

/** Importa un único CSV (por nombre de pestaña) hacia su hoja, en lotes. */
function importarCSV_(nombreHoja, archivoDrive) {
  const def = ESQUEMA_HOJAS[nombreHoja];
  const texto = archivoDrive.getBlob().getDataAsString('UTF-8');
  const filas = Utilities.parseCsv(texto);
  if (filas.length === 0) return 0;

  const encabezadoCsv = filas[0];
  if (encabezadoCsv.join(',') !== def.headers.join(',')) {
    throw new Error('El CSV de "' + nombreHoja + '" no tiene las columnas esperadas.\n' +
      'Esperado: ' + def.headers.join(',') + '\nEncontrado: ' + encabezadoCsv.join(','));
  }

  const datos = filas.slice(1).map((fila) => fila.map((valor, i) => coercionColumna_(def.headers[i], valor)));

  const sheet = hoja_(nombreHoja);
  // limpia datos previos (conserva encabezado en la fila 1)
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, def.headers.length).clearContent();
  }

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
