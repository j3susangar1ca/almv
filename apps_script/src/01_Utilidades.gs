/**
 * Helpers genéricos de acceso a las pestañas de datos. Todo el resto del
 * proyecto pasa por aquí para leer/escribir — es el único lugar que sabe
 * de índices de columna y de cómo se generan los folios (PK autoincremental).
 */

function hoja_(nombre) {
  const ss = SpreadsheetApp.openById(CONFIG_().SPREADSHEET_ID);
  const sheet = ss.getSheetByName(nombre);
  if (!sheet) throw new Error('No existe la pestaña "' + nombre + '". ¿Ya corriste crearEstructuraCompleta()?');
  return sheet;
}

/** Lee todas las filas de una pestaña como arreglo de objetos {columna: valor}. */
function leerFilas_(nombreHoja) {
  const sheet = hoja_(nombreHoja);
  const rango = sheet.getDataRange().getValues();
  if (rango.length < 2) return [];
  const headers = rango[0];
  const filas = [];
  for (let r = 1; r < rango.length; r++) {
    const fila = {};
    headers.forEach((h, i) => { fila[h] = rango[r][i]; });
    fila._row = r + 1; // fila real en el Sheet (1-indexada), útil para actualizar/borrar
    filas.push(fila);
  }
  return filas;
}

/** Agrega una fila nueva al final, respetando el orden de columnas del esquema. */
function escribirFila_(nombreHoja, objeto) {
  const headers = ESQUEMA_HOJAS[nombreHoja].headers;
  const fila = headers.map((h) => (objeto[h] === undefined || objeto[h] === null ? '' : objeto[h]));
  hoja_(nombreHoja).appendRow(fila);
}

/** Sobrescribe una fila existente (por número de fila _row) con nuevos valores parciales. */
function actualizarFila_(nombreHoja, numeroFila, cambios) {
  const headers = ESQUEMA_HOJAS[nombreHoja].headers;
  const sheet = hoja_(nombreHoja);
  const actual = sheet.getRange(numeroFila, 1, 1, headers.length).getValues()[0];
  headers.forEach((h, i) => {
    if (cambios[h] !== undefined) actual[i] = cambios[h];
  });
  sheet.getRange(numeroFila, 1, 1, headers.length).setValues([actual]);
}

/**
 * Folio autoincremental por pestaña, equivalente a BIGSERIAL. Debe
 * llamarse SIEMPRE con el ScriptLock ya tomado (lo hacen las funciones
 * guardarX() de cada módulo) para que dos usuarios no generen el mismo id.
 */
function siguienteId_(nombreHoja) {
  const pk = ESQUEMA_HOJAS[nombreHoja].pk;
  if (!pk) throw new Error('"' + nombreHoja + '" no tiene llave primaria autoincremental (usa llave compuesta).');
  const filas = leerFilas_(nombreHoja);
  let max = 0;
  filas.forEach((f) => { if (Number(f[pk]) > max) max = Number(f[pk]); });
  return max + 1;
}

/** Busca una fila por el valor de una columna (equivalente a un lookup de FK). Null si no existe. */
function buscarPorClave_(nombreHoja, columna, valor) {
  const filas = leerFilas_(nombreHoja);
  return filas.find((f) => String(f[columna]) === String(valor)) || null;
}

/** true si ya existe una fila con ese valor en esa columna (equivalente a UNIQUE). */
function existeValor_(nombreHoja, columna, valor, excluirFila) {
  const filas = leerFilas_(nombreHoja);
  return filas.some((f) => String(f[columna]) === String(valor) && f._row !== excluirFila);
}

/** Suma los valores de una columna numérica para las filas que cumplen un filtro. */
function sumarColumna_(nombreHoja, columna, filtroFn) {
  return leerFilas_(nombreHoja)
    .filter(filtroFn)
    .reduce((acc, f) => acc + (Number(f[columna]) || 0), 0);
}

/** Envoltura estándar: toma el lock del script, corre fn, libera el lock pase lo que pase. */
function conLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function hoy_() {
  return Utilities.formatDate(new Date(), CONFIG_().TIMEZONE || 'America/Mexico_City', 'yyyy-MM-dd');
}
