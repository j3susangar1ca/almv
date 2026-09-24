/**
 * Programación mensual y producción diaria: reemplaza las hojas
 * GENERAL/PACIENTES/COMEDOR/.../TORTILLAS/PAN del Excel original por
 * pestañas normalizadas (una fila por artículo/día), tal como quedó en
 * el modelo 3FN.
 */

function guardarProgramacionMensual(datos) {
  if (!buscarPorClave_('area_servicio', 'area_id', datos.area_id)) {
    throw new Error('programacion_mensual: area_id ' + datos.area_id + ' no existe.');
  }
  return conLock_(() => {
    const yaExiste = leerFilas_('programacion_mensual').some(
      (f) => String(f.area_id) === String(datos.area_id) && Number(f.anio) === Number(datos.anio) && Number(f.mes) === Number(datos.mes)
    );
    if (yaExiste) throw new Error('Ya existe una programación para esa área en ' + datos.mes + '/' + datos.anio + '.');
    const id = siguienteId_('programacion_mensual');
    escribirFila_('programacion_mensual', Object.assign({
      programacion_id: id, fecha_elaboracion: hoy_(), estatus: datos.estatus || 'BORRADOR',
    }, datos));
    return id;
  });
}

function guardarProgramacionDetalle(datos) {
  if (!buscarPorClave_('programacion_mensual', 'programacion_id', datos.programacion_id)) {
    throw new Error('programacion_detalle: programacion_id ' + datos.programacion_id + ' no existe.');
  }
  if (!buscarPorClave_('articulo', 'codigo_articulo', datos.codigo_articulo)) {
    throw new Error('programacion_detalle: codigo_articulo ' + datos.codigo_articulo + ' no existe.');
  }
  if (Number(datos.cantidad_programada) < 0) throw new Error('cantidad_programada no puede ser negativa.');

  return conLock_(() => {
    const yaExiste = leerFilas_('programacion_detalle').some(
      (f) => String(f.programacion_id) === String(datos.programacion_id) &&
        f.codigo_articulo === datos.codigo_articulo && f.fecha === datos.fecha
    );
    if (yaExiste) throw new Error('Ya existe una cantidad programada para ese artículo en esa fecha.');
    const id = siguienteId_('programacion_detalle');
    escribirFila_('programacion_detalle', Object.assign({ programacion_detalle_id: id }, datos));
    return id;
  });
}

function guardarProduccionDiaria(datos) {
  if (!buscarPorClave_('area_servicio', 'area_id', datos.area_id)) {
    throw new Error('produccion_diaria: area_id ' + datos.area_id + ' no existe.');
  }
  if (!datos.codigo_articulo && !datos.producto_texto) {
    throw new Error('produccion_diaria: se requiere codigo_articulo o producto_texto.');
  }
  if (Number(datos.cantidad) <= 0) throw new Error('cantidad debe ser mayor a 0.');

  return conLock_(() => {
    const id = siguienteId_('produccion_diaria');
    escribirFila_('produccion_diaria', Object.assign({ produccion_id: id }, datos));
    return id;
  });
}

/** Suma cantidad_programada por artículo+fecha, todas las áreas — la base del paso 1 de consolidación (ver 50_Consolidacion.gs). */
function demandaTotalPorArticulo_(codigoArticulo, fechaInicio, fechaFin) {
  return sumarColumna_('programacion_detalle', 'cantidad_programada', (f) =>
    f.codigo_articulo === codigoArticulo && f.fecha >= fechaInicio && f.fecha <= fechaFin
  );
}
