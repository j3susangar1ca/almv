/**
 * Lotes, Órdenes de Compra (orden_suministro), Kardex (movimiento_inventario)
 * y saldo materializado (existencia_almacen). Mismas reglas que el DDL de
 * Postgres: lote_id nunca queda vacío (centinela 0 = "SIN LOTE"), y
 * existencia_almacen se mantiene sincronizada dentro del mismo lock que
 * registra el movimiento.
 */

function guardarLote(datos) {
  if (!buscarPorClave_('articulo', 'codigo_articulo', datos.codigo_articulo)) {
    throw new Error('lote: codigo_articulo ' + datos.codigo_articulo + ' no existe.');
  }
  if (datos.fecha_fabricacion && datos.fecha_caducidad && datos.fecha_caducidad <= datos.fecha_fabricacion) {
    throw new Error('fecha_caducidad debe ser posterior a fecha_fabricacion.');
  }
  return conLock_(() => {
    const yaExiste = leerFilas_('lote').some(
      (f) => f.codigo_articulo === datos.codigo_articulo && f.proveedor_id === datos.proveedor_id &&
        f.numero_lote_proveedor === datos.numero_lote_proveedor
    );
    if (yaExiste) throw new Error('Ese lote ya está registrado para ese artículo/proveedor.');
    const id = siguienteId_('lote');
    escribirFila_('lote', Object.assign({ lote_id: id, fecha_recepcion: datos.fecha_recepcion || hoy_() }, datos));
    return id;
  });
}

function guardarOrdenSuministro(datos) {
  if (!buscarPorClave_('proveedor', 'proveedor_id', datos.proveedor_id)) throw new Error('orden_suministro: proveedor no existe.');
  if (!buscarPorClave_('sede', 'sede_id', datos.sede_id)) throw new Error('orden_suministro: sede no existe.');
  return conLock_(() => {
    const id = siguienteId_('orden_suministro');
    escribirFila_('orden_suministro', Object.assign({
      orden_id: id, fecha_emision: datos.fecha_emision || hoy_(), estatus: datos.estatus || 'PENDIENTE',
    }, datos));
    return id;
  });
}

/**
 * cantidad_solicitada aquí es, por diseño, la demanda YA CONSOLIDADA de
 * todas las áreas para ese proveedor+artículo (ver 50_Consolidacion.gs,
 * que es quien calcula ese total antes de llamar a esta función).
 */
function guardarOrdenSuministroDetalle(datos) {
  const orden = buscarPorClave_('orden_suministro', 'orden_id', datos.orden_id);
  if (!orden) throw new Error('orden_suministro_detalle: orden_id ' + datos.orden_id + ' no existe.');
  if (!buscarPorClave_('contrato_articulo', 'contrato_articulo_id', datos.contrato_articulo_id)) {
    throw new Error('orden_suministro_detalle: contrato_articulo_id ' + datos.contrato_articulo_id + ' no existe.');
  }
  if (Number(datos.cantidad_solicitada) <= 0) throw new Error('cantidad_solicitada debe ser mayor a 0.');

  return conLock_(() => {
    registrarConsumoCupo_(datos.contrato_articulo_id, orden.sede_id, datos.cantidad_solicitada);
    const id = siguienteId_('orden_suministro_detalle');
    escribirFila_('orden_suministro_detalle', Object.assign({
      orden_detalle_id: id, cantidad_recibida: 0,
    }, datos));
    return id;
  });
}

/**
 * Registra un movimiento de Kardex (entrada o salida) y mantiene
 * existencia_almacen sincronizada, todo dentro del mismo lock.
 * datos: { almacen_id, codigo_articulo, lote_id, tipo_movimiento, cantidad,
 *          orden_detalle_id? (sólo entradas), programacion_detalle_id? (sólo salidas),
 *          referencia_documento? }
 */
function registrarMovimiento(datos) {
  if (!buscarPorClave_('almacen', 'almacen_id', datos.almacen_id)) throw new Error('movimiento: almacen no existe.');
  const articulo = buscarPorClave_('articulo', 'codigo_articulo', datos.codigo_articulo);
  if (!articulo) throw new Error('movimiento: articulo no existe.');
  if (Number(datos.cantidad) <= 0) throw new Error('cantidad debe ser mayor a 0.');

  const esEntrada = TIPOS_MOVIMIENTO_ENTRADA.indexOf(datos.tipo_movimiento) !== -1;
  const esSalida = TIPOS_MOVIMIENTO_SALIDA.indexOf(datos.tipo_movimiento) !== -1;
  if (!esEntrada && !esSalida) throw new Error('tipo_movimiento inválido: ' + datos.tipo_movimiento);

  const loteId = datos.lote_id !== undefined && datos.lote_id !== '' ? Number(datos.lote_id) : LOTE_CENTINELA_ID;
  if (articulo.requiere_control_lote && loteId === LOTE_CENTINELA_ID) {
    throw new Error('El artículo ' + datos.codigo_articulo + ' requiere control de lote; no se puede usar el lote centinela.');
  }
  if (loteId !== LOTE_CENTINELA_ID && !buscarPorClave_('lote', 'lote_id', loteId)) {
    throw new Error('movimiento: lote_id ' + loteId + ' no existe.');
  }

  return conLock_(() => {
    if (esSalida) {
      const saldo = obtenerExistencia_(datos.almacen_id, datos.codigo_articulo, loteId);
      if (saldo < Number(datos.cantidad)) {
        throw new Error('Existencia insuficiente: hay ' + saldo + ' y se intentan sacar ' + datos.cantidad + '.');
      }
    }
    if (datos.orden_detalle_id) {
      const detalle = buscarPorClave_('orden_suministro_detalle', 'orden_detalle_id', datos.orden_detalle_id);
      if (!detalle) throw new Error('movimiento: orden_detalle_id ' + datos.orden_detalle_id + ' no existe.');
      const nuevaRecibida = Number(detalle.cantidad_recibida) + Number(datos.cantidad);
      if (nuevaRecibida > Number(detalle.cantidad_solicitada)) {
        throw new Error('La entrada excede lo solicitado en ese renglón de OC.');
      }
      actualizarFila_('orden_suministro_detalle', detalle._row, { cantidad_recibida: nuevaRecibida });
    }
    if (datos.programacion_detalle_id && !buscarPorClave_('programacion_detalle', 'programacion_detalle_id', datos.programacion_detalle_id)) {
      throw new Error('movimiento: programacion_detalle_id ' + datos.programacion_detalle_id + ' no existe.');
    }

    const id = siguienteId_('movimiento_inventario');
    escribirFila_('movimiento_inventario', Object.assign({
      movimiento_id: id, lote_id: loteId, fecha_movimiento: new Date().toISOString(),
    }, datos));

    actualizarExistencia_(datos.almacen_id, datos.codigo_articulo, loteId, esEntrada ? Number(datos.cantidad) : -Number(datos.cantidad));
    return id;
  });
}

function obtenerExistencia_(almacenId, codigoArticulo, loteId) {
  const fila = leerFilas_('existencia_almacen').find(
    (f) => String(f.almacen_id) === String(almacenId) && f.codigo_articulo === codigoArticulo && Number(f.lote_id) === Number(loteId)
  );
  return fila ? Number(fila.cantidad_actual) : 0;
}

/** Suma (o resta, si delta es negativo) al saldo de existencia_almacen; crea la fila si no existía. */
function actualizarExistencia_(almacenId, codigoArticulo, loteId, delta) {
  const filas = leerFilas_('existencia_almacen');
  const fila = filas.find(
    (f) => String(f.almacen_id) === String(almacenId) && f.codigo_articulo === codigoArticulo && Number(f.lote_id) === Number(loteId)
  );
  if (fila) {
    const nuevo = Number(fila.cantidad_actual) + delta;
    if (nuevo < 0) throw new Error('La existencia no puede quedar negativa.');
    actualizarFila_('existencia_almacen', fila._row, { cantidad_actual: nuevo });
  } else {
    if (delta < 0) throw new Error('No hay existencia previa para descontar.');
    escribirFila_('existencia_almacen', {
      almacen_id: almacenId, codigo_articulo: codigoArticulo, lote_id: loteId, cantidad_actual: delta,
    });
  }
}
