/**
 * Web App: sirve Index.html y expone las funciones que el frontend Vue
 * llama por google.script.run. Cada endpoint es una envoltura delgada
 * sobre las funciones de negocio ya definidas — no hay lógica nueva aquí.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Dietología — Programación y Almacén')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Permite <?!= include('JavaScript'); ?> dentro de Index.html. */
function include(nombreArchivo) {
  return HtmlService.createHtmlOutputFromFile(nombreArchivo).getContent();
}

// ---- Endpoints de catálogo (listas para selects del frontend) ----

function apiListarAreasServicio() {
  return leerFilas_('area_servicio').filter((f) => f.activo).map(limpiarFila_);
}

function apiListarArticulos() {
  const unidades = leerFilas_('unidad_medida');
  return leerFilas_('articulo').filter((f) => f.activo).map((a) => {
    const u = unidades.find((x) => Number(x.unidad_id) === Number(a.unidad_id));
    return Object.assign(limpiarFila_(a), { unidad_clave: u ? u.clave : '' });
  });
}

function apiListarSedes() {
  return leerFilas_('sede').map(limpiarFila_);
}

// ---- Endpoints de programación mensual (el "menú y calendario") ----

function apiObtenerProgramacionMes(areaId, anio, mes) {
  const cabecera = leerFilas_('programacion_mensual').find(
    (f) => String(f.area_id) === String(areaId) && Number(f.anio) === Number(anio) && Number(f.mes) === Number(mes)
  );
  if (!cabecera) return { cabecera: null, detalle: [] };
  const detalle = leerFilas_('programacion_detalle')
    .filter((f) => String(f.programacion_id) === String(cabecera.programacion_id))
    .map(limpiarFila_);
  return { cabecera: limpiarFila_(cabecera), detalle: detalle };
}

function apiGuardarCantidadProgramada(programacionId, codigoArticulo, fecha, cantidad) {
  return guardarProgramacionDetalle({
    programacion_id: programacionId, codigo_articulo: codigoArticulo, fecha: fecha, cantidad_programada: cantidad,
  });
}

function apiCrearProgramacionMensual(areaId, anio, mes) {
  return guardarProgramacionMensual({ area_id: areaId, anio: anio, mes: mes });
}

// ---- Endpoints de consolidación / OC / documentos ----

function apiConsolidarDemanda(codigoArticulo, sedeId, fechaInicio, fechaFin) {
  return consolidarDemandaEnOC(codigoArticulo, sedeId, fechaInicio, fechaFin);
}

function apiGenerarValePedido(areaId, fecha) {
  return generarValePedido(areaId, fecha);
}

function apiGenerarOrdenCompraPdf(ordenId) {
  return generarPDFOrdenCompra(ordenId);
}

/** Quita la propiedad interna _row antes de mandar un objeto al frontend. */
function limpiarFila_(fila) {
  const copia = Object.assign({}, fila);
  delete copia._row;
  return copia;
}
