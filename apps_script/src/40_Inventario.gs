/**
 * Órdenes de Compra (orden_compra), Kardex (movimiento_inventario) y saldo
 * materializado (existencia). Un solo almacén implícito: ninguna de estas
 * tablas tiene almacen_id. El lote ya no es una entidad aparte — es un
 * dato de la entrada (numero_lote_proveedor/fecha_fabricacion/
 * fecha_caducidad viajan directamente en movimiento_inventario cuando
 * tipo_movimiento='ENTRADA_COMPRA' y el artículo requiere control de lote).
 * existencia se mantiene sincronizada dentro del mismo lock que registra
 * el movimiento.
 */

function guardarOrdenCompra(datos) {
  if (!buscarPorClave_('proveedor', 'proveedor_id', datos.proveedor_id)) throw new Error('orden_compra: proveedor no existe.');
  return conLock_(() => {
    const id = siguienteId_('orden_compra');
    escribirFila_('orden_compra', Object.assign({
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
function guardarOrdenCompraDetalle(datos) {
  const orden = buscarPorClave_('orden_compra', 'orden_id', datos.orden_id);
  if (!orden) throw new Error('orden_compra_detalle: orden_id ' + datos.orden_id + ' no existe.');
  if (!buscarPorClave_('contrato_articulo', 'contrato_articulo_id', datos.contrato_articulo_id)) {
    throw new Error('orden_compra_detalle: contrato_articulo_id ' + datos.contrato_articulo_id + ' no existe.');
  }
  if (Number(datos.cantidad_solicitada) <= 0) throw new Error('cantidad_solicitada debe ser mayor a 0.');

  return conLock_(() => {
    registrarConsumoCupo_(datos.contrato_articulo_id, datos.cantidad_solicitada);
    const id = siguienteId_('orden_compra_detalle');
    escribirFila_('orden_compra_detalle', Object.assign({
      orden_detalle_id: id, cantidad_recibida: 0,
    }, datos));
    return id;
  });
}

/**
 * Registra un movimiento de Kardex (entrada o salida) y mantiene
 * existencia sincronizada, todo dentro del mismo lock.
 * datos: { codigo_articulo, tipo_movimiento, cantidad,
 *          numero_lote_proveedor?, fecha_fabricacion?, fecha_caducidad? (sólo entradas,
 *            obligatorios si el artículo requiere_control_lote y tipo_movimiento='ENTRADA_COMPRA'),
 *          orden_detalle_id? (sólo entradas), programacion_detalle_id? (sólo salidas),
 *          referencia_documento? }
 */
function registrarMovimiento(datos) {
  const articulo = buscarPorClave_('articulo', 'codigo_articulo', datos.codigo_articulo);
  if (!articulo) throw new Error('movimiento: articulo no existe.');
  if (Number(datos.cantidad) <= 0) throw new Error('cantidad debe ser mayor a 0.');

  const esEntrada = TIPOS_MOVIMIENTO_ENTRADA.indexOf(datos.tipo_movimiento) !== -1;
  const esSalida = TIPOS_MOVIMIENTO_SALIDA.indexOf(datos.tipo_movimiento) !== -1;
  if (!esEntrada && !esSalida) throw new Error('tipo_movimiento inválido: ' + datos.tipo_movimiento);

  if (articulo.requiere_control_lote && datos.tipo_movimiento === 'ENTRADA_COMPRA') {
    if (!datos.numero_lote_proveedor || !datos.fecha_caducidad) {
      throw new Error('El artículo ' + datos.codigo_articulo + ' requiere control de lote: numero_lote_proveedor y fecha_caducidad son obligatorios en una entrada de compra.');
    }
    if (datos.fecha_fabricacion && datos.fecha_caducidad <= datos.fecha_fabricacion) {
      throw new Error('fecha_caducidad debe ser posterior a fecha_fabricacion.');
    }
  }

  return conLock_(() => {
    if (esSalida) {
      const saldo = obtenerExistencia_(datos.codigo_articulo);
      if (saldo < Number(datos.cantidad)) {
        throw new Error('Existencia insuficiente: hay ' + saldo + ' y se intentan sacar ' + datos.cantidad + '.');
      }
    }
    if (datos.orden_detalle_id) {
      const detalle = buscarPorClave_('orden_compra_detalle', 'orden_detalle_id', datos.orden_detalle_id);
      if (!detalle) throw new Error('movimiento: orden_detalle_id ' + datos.orden_detalle_id + ' no existe.');
      const nuevaRecibida = Number(detalle.cantidad_recibida) + Number(datos.cantidad);
      if (nuevaRecibida > Number(detalle.cantidad_solicitada)) {
        throw new Error('La entrada excede lo solicitado en ese renglón de OC.');
      }
      actualizarFila_('orden_compra_detalle', detalle._row, { cantidad_recibida: nuevaRecibida });
    }
    if (datos.programacion_detalle_id && !buscarPorClave_('programacion_detalle', 'programacion_detalle_id', datos.programacion_detalle_id)) {
      throw new Error('movimiento: programacion_detalle_id ' + datos.programacion_detalle_id + ' no existe.');
    }

    const id = siguienteId_('movimiento_inventario');
    escribirFila_('movimiento_inventario', Object.assign({
      movimiento_id: id, fecha_movimiento: new Date().toISOString(),
    }, datos));

    actualizarExistencia_(datos.codigo_articulo, esEntrada ? Number(datos.cantidad) : -Number(datos.cantidad));
    return id;
  });
}

function obtenerExistencia_(codigoArticulo) {
  const fila = buscarPorClave_('existencia', 'codigo_articulo', codigoArticulo);
  return fila ? Number(fila.cantidad_actual) : 0;
}

/** Suma (o resta, si delta es negativo) al saldo de existencia; crea la fila si no existía. */
function actualizarExistencia_(codigoArticulo, delta) {
  const fila = buscarPorClave_('existencia', 'codigo_articulo', codigoArticulo);
  if (fila) {
    const nuevo = Number(fila.cantidad_actual) + delta;
    if (nuevo < 0) throw new Error('La existencia no puede quedar negativa.');
    actualizarFila_('existencia', fila._row, { cantidad_actual: nuevo });
  } else {
    if (delta < 0) throw new Error('No hay existencia previa para descontar.');
    escribirFila_('existencia', { codigo_articulo: codigoArticulo, cantidad_actual: delta });
  }
}
