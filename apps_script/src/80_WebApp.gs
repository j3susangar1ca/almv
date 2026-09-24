/**
 * Web App: sirve Index.html y expone las funciones que el frontend Vue
 * llama por google.script.run. Cada endpoint es una envoltura delgada
 * sobre las funciones de negocio ya definidas — el control de acceso
 * (RBAC) vive en esas funciones (o se aplica aquí explícitamente cuando
 * la función de negocio no tiene un "servicio" al que atarse), nunca sólo
 * en el frontend (sección 4 del SRS, "Server-Side Gatekeeper").
 */

function doGet() {
  try {
    obtenerSesionActual(); // 403 si el correo de la sesión de Google no está en la whitelist
  } catch (e) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
      '<body style="font-family:Arial, sans-serif; max-width:480px; margin:15vh auto; text-align:center; color:#334;">' +
      '<h2>Acceso no autorizado</h2><p>' + e.message + '</p>' +
      '<p style="color:#888; font-size:13px;">Si crees que esto es un error, contacta al administrador del sistema.</p>' +
      '</body></html>'
    ).setTitle('Acceso no autorizado');
  }

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

// ---- Sesión ----

/** El frontend llama esto al montar la app para saber quién es el usuario, su rol y sus servicios (sección 4 del SRS). */
function apiObtenerSesion() {
  return _paraCliente_(obtenerSesionActual());
}

// ---- Endpoints de catálogo (listas para selects del frontend) ----

/** Sólo los servicios asignados al usuario (o todos, si es ADMINISTRADOR) — aislamiento de información (criterio de aceptación 2). */
function apiListarAreasServicio() {
  const sesion = obtenerSesionActual();
  const todas = leerFilas_('area_servicio').filter((f) => f.activo).map(limpiarFila_);
  if (sesion.rol === 'ADMINISTRADOR') return _paraCliente_(todas);
  const permitidas = {};
  sesion.servicios_asignados.forEach((s) => { permitidas[String(s.servicio_id)] = true; });
  return _paraCliente_(todas.filter((a) => permitidas[String(a.area_id)]));
}

function apiListarArticulos() {
  const contratos = leerFilas_('contrato_articulo');
  const articulos = leerFilas_('articulo').filter((f) => f.activo).map((a) => {
    const contrato = contratos.find((c) => c.codigo_articulo === a.codigo_articulo && c.activo === true);
    return Object.assign(limpiarFila_(a), {
      unidad_clave: a.unidad_medida, // alias por compatibilidad con el frontend existente
      precio_unitario: contrato ? Number(contrato.precio_unitario) : null, // para el resumen $ de la barra sticky
    });
  });
  return _paraCliente_(articulos);
}

// ---- Endpoints de programación mensual (el "menú y calendario") ----

function apiObtenerProgramacionMes(areaId, anio, mes) {
  requiereAcceso_(areaId, 'LECTURA');
  const cabecera = leerFilas_('programacion_mensual').find(
    (f) => String(f.area_id) === String(areaId) && Number(f.anio) === Number(anio) && Number(f.mes) === Number(mes)
  );
  if (!cabecera) return { cabecera: null, detalle: [] };
  const detalle = leerFilas_('programacion_detalle')
    .filter((f) => String(f.programacion_id) === String(cabecera.programacion_id))
    .map(limpiarFila_);
  return _paraCliente_({ cabecera: limpiarFila_(cabecera), detalle: detalle });
}

// El RBAC y el bloqueo por estatus ENVIADO se validan DENTRO de
// guardarProgramacionDetalle/guardarProgramacionMensual — no se duplica
// aquí para que no haya dos lugares que puedan quedar desincronizados.
function apiGuardarCantidadProgramada(programacionId, codigoArticulo, fecha, cantidad) {
  return guardarProgramacionDetalle({
    programacion_id: programacionId, codigo_articulo: codigoArticulo, fecha: fecha, cantidad_programada: cantidad,
  });
}

/** Guardado por lote: el frontend agrupa varias celdas modificadas (debounce) y las manda en una sola llamada. */
function apiGuardarLoteCantidades(programacionId, cambios) {
  return guardarLoteProgramacionDetalle(programacionId, cambios);
}

/** Techo contractual por artículo (semáforo de techo presupuestal) — una sola sede, ya no hay que resolverla por servicio. */
function apiObtenerCuposArticulos() {
  obtenerSesionActual(); // cualquier usuario autenticado puede consultarlo, es información de referencia
  return _paraCliente_(obtenerCuposArticulos_());
}

function apiCrearProgramacionMensual(areaId, anio, mes) {
  return guardarProgramacionMensual({ area_id: areaId, anio: anio, mes: mes });
}

function apiEnviarCarga(programacionId) {
  return enviarCarga(programacionId);
}

function apiReabrirCarga(programacionId) {
  return reabrirCarga(programacionId);
}

// ---- Endpoints de consolidación / OC / documentos ----

function apiConsolidarDemanda(codigoArticulo, fechaInicio, fechaFin) {
  return consolidarDemandaEnOC(codigoArticulo, fechaInicio, fechaFin);
}

function apiGenerarValePedido(areaId, fecha) {
  requiereAcceso_(areaId, 'LECTURA');
  return generarValePedido(areaId, fecha);
}

function apiGenerarOrdenCompraPdf(ordenId) {
  requiereRol_(['ADMINISTRADOR', 'SUPERVISOR']);
  return generarPDFOrdenCompra(ordenId);
}

// ---- Endpoints de administración (pestaña "Administración y Consolidado General") ----

function apiListarUsuarios() {
  requiereRol_(['ADMINISTRADOR']);
  const servicios = leerFilas_('usuario_servicios');
  const areas = leerFilas_('area_servicio');
  const usuarios = leerFilas_('usuarios').map((u) => {
    const asignaciones = servicios
      .filter((s) => String(s.usuario_id) === String(u.usuario_id))
      .map((s) => {
        const area = areas.find((a) => String(a.area_id) === String(s.area_id));
        return { area_id: s.area_id, nombre: area ? area.nombre : '', permiso: s.permiso };
      });
    return Object.assign(limpiarFila_(u), { servicios_asignados: asignaciones });
  });
  return _paraCliente_(usuarios);
}

function apiGuardarUsuario(datos) {
  requiereRol_(['ADMINISTRADOR']);
  return guardarUsuario(datos);
}

function apiDesactivarUsuario(usuarioId) {
  requiereRol_(['ADMINISTRADOR']);
  return desactivarUsuario(usuarioId);
}

function apiAsignarServicio(usuarioId, areaId, permiso) {
  requiereRol_(['ADMINISTRADOR']);
  return asignarUsuarioServicio(usuarioId, areaId, permiso);
}

function apiRevocarServicio(usuarioId, areaId) {
  requiereRol_(['ADMINISTRADOR']);
  return revocarUsuarioServicio(usuarioId, areaId);
}

/** Consolidado general con descripciones resueltas, para la pestaña de Administración. */
function apiListarConsolidadoGeneral() {
  requiereRol_(['ADMINISTRADOR']);
  const articulos = leerFilas_('articulo');
  const areas = leerFilas_('area_servicio');
  const usuarios = leerFilas_('usuarios');
  const filas = leerFilas_('consolidado_general').map((f) => {
    const art = articulos.find((a) => a.codigo_articulo === f.codigo_articulo);
    const area = areas.find((a) => String(a.area_id) === String(f.area_id));
    const usuario = usuarios.find((u) => String(u.usuario_id) === String(f.usuario_envio_id));
    return Object.assign(limpiarFila_(f), {
      descripcion_articulo: art ? art.descripcion : '',
      nombre_area: area ? area.nombre : '',
      correo_envio: usuario ? usuario.correo : '',
    });
  });
  return _paraCliente_(filas);
}

/** Quita la propiedad interna _row antes de mandar un objeto al frontend. */
function limpiarFila_(fila) {
  const copia = Object.assign({}, fila);
  delete copia._row;
  return copia;
}

/**
 * Red de seguridad final antes de devolver algo al frontend por
 * google.script.run: lo redondea por JSON para garantizar que sólo viajen
 * tipos que sabe serializar (string/number/boolean/null/array/object).
 * google.script.run no serializa de vuelta al navegador un objeto Date (ni
 * cualquier otro tipo no-JSON que se haya colado) y, en vez de lanzar un
 * error, entrega `null` al successHandler en silencio — el frontend recibía
 * null y tronaba con "Cannot read properties of null" al leer cualquier
 * propiedad de la respuesta. leerFilas_ (01_Utilidades.gs) ya normaliza los
 * Date reales de las hojas a texto "yyyy-mm-dd" al leerlas, así que esto es
 * el respaldo — por si algún valor no-JSON se cuela desde cualquier otro
 * lado — no el mecanismo principal.
 */
function _paraCliente_(valor) {
  return JSON.parse(JSON.stringify(valor));
}
