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
  requiereAcceso_(datos.area_id, 'ESCRITURA'); // RBAC: sólo quien puede capturar en ese servicio abre una carga

  return conLock_(() => {
    const yaExiste = leerFilas_('programacion_mensual').some(
      (f) => String(f.area_id) === String(datos.area_id) && Number(f.anio) === Number(datos.anio) && Number(f.mes) === Number(datos.mes)
    );
    if (yaExiste) throw new Error('Ya existe una programación para esa área en ' + datos.mes + '/' + datos.anio + '.');
    const id = siguienteId_('programacion_mensual');
    escribirFila_('programacion_mensual', Object.assign({
      programacion_id: id, fecha_elaboracion: hoy_(), estatus: 'BORRADOR', fecha_envio: '', enviado_por_usuario_id: '',
    }, datos));
    return id;
  });
}

/** Valida FK, rango y RBAC/ciclo de vida para una escritura de celda. Lanza si algo no procede. */
function _validarEscrituraDetalle(programacion, datos) {
  if (!buscarPorClave_('articulo', 'codigo_articulo', datos.codigo_articulo)) {
    throw new Error('programacion_detalle: codigo_articulo ' + datos.codigo_articulo + ' no existe.');
  }
  if (Number(datos.cantidad_programada) < 0) throw new Error('cantidad_programada no puede ser negativa.');
  if (programacion.estatus !== 'BORRADOR') {
    throw new Error(
      'Esta carga ya fue enviada (estatus ' + programacion.estatus + ') y quedó en modo solo lectura. ' +
      'Un administrador debe reabrirla (reabrirCarga) antes de poder modificarla.'
    );
  }
}

/** Upsert de UNA fila, sin lock propio — sólo se llama desde dentro de un conLock_ ya tomado. */
function _upsertDetalleFila(datos) {
  const existente = leerFilas_('programacion_detalle').find(
    (f) => String(f.programacion_id) === String(datos.programacion_id) &&
      f.codigo_articulo === datos.codigo_articulo && f.fecha === datos.fecha
  );
  if (existente) {
    actualizarFila_('programacion_detalle', existente._row, { cantidad_programada: datos.cantidad_programada });
    return existente.programacion_detalle_id;
  }
  const id = siguienteId_('programacion_detalle');
  escribirFila_('programacion_detalle', Object.assign({ programacion_detalle_id: id }, datos));
  return id;
}

/**
 * Upsert de una cantidad programada (crea la fila si no existía, la
 * actualiza si ya existía — así es como se comporta una celda editable de
 * calendario). Aplica el gatekeeper de RBAC (ESCRITURA sobre el servicio
 * dueño de la programación) y el bloqueo de escritura del ciclo de vida:
 * una vez que la carga está en estatus ENVIADO, ninguna escritura pasa,
 * sin excepción — sólo reabrirCarga() (31_CicloVida.gs) puede revertirlo.
 */
function guardarProgramacionDetalle(datos) {
  const programacion = buscarPorClave_('programacion_mensual', 'programacion_id', datos.programacion_id);
  if (!programacion) throw new Error('programacion_detalle: programacion_id ' + datos.programacion_id + ' no existe.');
  requiereAcceso_(programacion.area_id, 'ESCRITURA');
  _validarEscrituraDetalle(programacion, datos);

  return conLock_(() => _upsertDetalleFila(datos));
}

/**
 * Variante por lote de guardarProgramacionDetalle: valida y escribe todos
 * los cambios bajo UN solo lock y UNA sola lectura de la pestaña (en vez
 * de una lectura completa por celda) — es el equivalente en el servidor
 * a la cola con debounce del frontend (agrupa varias celdas modificadas y
 * las guarda en una sola operación de red y de escritura).
 * cambios: [{ codigo_articulo, fecha, cantidad_programada }, ...]
 */
function guardarLoteProgramacionDetalle(programacionId, cambios) {
  const programacion = buscarPorClave_('programacion_mensual', 'programacion_id', programacionId);
  if (!programacion) throw new Error('programacion_detalle: programacion_id ' + programacionId + ' no existe.');
  requiereAcceso_(programacion.area_id, 'ESCRITURA');
  cambios.forEach((c) => _validarEscrituraDetalle(programacion, c));

  return conLock_(() => {
    const indice = {};
    leerFilas_('programacion_detalle')
      .filter((f) => String(f.programacion_id) === String(programacionId))
      .forEach((f) => { indice[f.codigo_articulo + '|' + f.fecha] = f; });

    let siguienteId = null;
    cambios.forEach((c) => {
      const clave = c.codigo_articulo + '|' + c.fecha;
      const existente = indice[clave];
      if (existente) {
        actualizarFila_('programacion_detalle', existente._row, { cantidad_programada: c.cantidad_programada });
      } else {
        if (siguienteId === null) siguienteId = siguienteId_('programacion_detalle');
        escribirFila_('programacion_detalle', {
          programacion_detalle_id: siguienteId++, programacion_id: programacionId,
          codigo_articulo: c.codigo_articulo, fecha: c.fecha, cantidad_programada: c.cantidad_programada,
        });
        indice[clave] = { _row: -1 }; // por si el mismo lote trae la misma celda repetida
      }
    });
    return { guardados: cambios.length };
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
