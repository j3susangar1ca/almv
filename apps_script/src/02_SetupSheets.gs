/**
 * Crea (o repara) las pestañas de datos con sus encabezados, formato
 * de fecha y listas desplegables — el equivalente a correr un DDL una
 * sola vez sobre una base nueva. El número exacto de pestañas es
 * Object.keys(ESQUEMA_HOJAS).length (ver 00_Config.gs); crece o se
 * reduce según ese esquema, no está fijo aquí.
 *
 * Ejecutar UNA VEZ desde el editor de Apps Script, después de
 * configurarProyectoInicial().
 */
function crearEstructuraCompleta() {
  const ss = SpreadsheetApp.openById(CONFIG_().SPREADSHEET_ID);

  Object.keys(ESQUEMA_HOJAS).forEach((nombre) => {
    const def = ESQUEMA_HOJAS[nombre];
    let sheet = ss.getSheetByName(nombre);
    if (!sheet) sheet = ss.insertSheet(nombre);

    sheet.clear();
    sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, def.headers.length).setFontWeight('bold').setBackground('#e8eaed');

    aplicarValidacionesColumna_(sheet, nombre, def.headers);
  });

  // Elimina la pestaña "Hoja 1"/"Sheet1" por defecto si sigue vacía
  const porDefecto = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (porDefecto && porDefecto.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(porDefecto);
  }

  SpreadsheetApp.getUi().alert('Estructura creada: ' + Object.keys(ESQUEMA_HOJAS).length + ' pestañas. Siguiente paso: importarTodosLosCSV(idCarpetaDrive).');
}

function aplicarValidacionesColumna_(sheet, nombreHoja, headers) {
  const MAX_FILAS = 20000; // suficiente para el volumen esperado (~10 usuarios); ampliar si hace falta
  const listaCols = VALIDACIONES_LISTA[nombreHoja] || {};

  headers.forEach((col, i) => {
    const colNum = i + 1;
    const rango = sheet.getRange(2, colNum, MAX_FILAS, 1);

    if (listaCols[col]) {
      const regla = SpreadsheetApp.newDataValidation()
        .requireValueInList(listaCols[col], true)
        .setAllowInvalid(false)
        .build();
      rango.setDataValidation(regla);
    } else if (COLUMNAS_BOOLEANAS.indexOf(col) !== -1) {
      const regla = SpreadsheetApp.newDataValidation().requireCheckbox().build();
      rango.setDataValidation(regla);
    } else if (COLUMNAS_FECHA.indexOf(col) !== -1) {
      rango.setNumberFormat('yyyy-mm-dd');
    }
  });
}

/**
 * Crea las 3 pestañas de vista para Looker Studio (ver sección 7 de
 * ADAPTACION_STACK_GOOGLE.md). Se recalculan con actualizarVistas(),
 * pensado para correr en un trigger diario junto con las notificaciones.
 */
function crearVistasReporte() {
  const ss = SpreadsheetApp.openById(CONFIG_().SPREADSHEET_ID);
  ['vista_consumo_diario', 'vista_ejecucion_contractual', 'vista_trazabilidad_oc'].forEach((nombre) => {
    if (!ss.getSheetByName(nombre)) ss.insertSheet(nombre);
  });
  actualizarVistas();
}
