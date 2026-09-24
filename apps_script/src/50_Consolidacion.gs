/**
 * Consolidación de pedidos en Orden de Compra y trazabilidad entrada↔salida.
 * Es el equivalente directo de trg_valida_consolidacion_pedido y
 * trg_valida_asignacion_salida_entrada de schema_dietologia.sql — mismas
 * reglas, mismos mensajes de error, para que quien conozca el DDL original
 * reconozca exactamente la misma lógica aquí.
 */

function validarConsolidacionPedido_(datos) {
  const detalle = buscarPorClave_('programacion_detalle', 'programacion_detalle_id', datos.programacion_detalle_id);
  if (!detalle) throw new Error('consolidacion_pedido: programacion_detalle_id no existe.');

  const ordenDetalle = buscarPorClave_('orden_compra_detalle', 'orden_detalle_id', datos.orden_detalle_id);
  if (!ordenDetalle) throw new Error('consolidacion_pedido: orden_detalle_id no existe.');
  const contrato = buscarPorClave_('contrato_articulo', 'contrato_articulo_id', ordenDetalle.contrato_articulo_id);

  if (detalle.codigo_articulo !== contrato.codigo_articulo) {
    throw new Error(
      'consolidacion_pedido: el artículo programado (' + detalle.codigo_articulo +
      ') no coincide con el artículo de la OC (' + contrato.codigo_articulo + ').'
    );
  }

  const sumaPrevia = sumarColumna_('consolidacion_pedido', 'cantidad_consolidada',
    (f) => String(f.orden_detalle_id) === String(datos.orden_detalle_id));
  const nuevaSuma = sumaPrevia + Number(datos.cantidad_consolidada);
  if (nuevaSuma > Number(ordenDetalle.cantidad_solicitada)) {
    throw new Error(
      'consolidacion_pedido: la suma consolidada (' + nuevaSuma +
      ') excedería la cantidad_solicitada de la OC (' + ordenDetalle.cantidad_solicitada + ').'
    );
  }
}

function guardarConsolidacionPedido(datos) {
  if (Number(datos.cantidad_consolidada) <= 0) throw new Error('cantidad_consolidada debe ser mayor a 0.');
  return conLock_(() => {
    validarConsolidacionPedido_(datos);
    const id = siguienteId_('consolidacion_pedido');
    escribirFila_('consolidacion_pedido', Object.assign({ consolidacion_id: id }, datos));
    return id;
  });
}

function validarAsignacionSalidaEntrada_(datos) {
  if (String(datos.movimiento_salida_id) === String(datos.movimiento_entrada_id)) {
    throw new Error('asignacion_salida_entrada: la salida y la entrada no pueden ser el mismo movimiento.');
  }
  const salida = buscarPorClave_('movimiento_inventario', 'movimiento_id', datos.movimiento_salida_id);
  const entrada = buscarPorClave_('movimiento_inventario', 'movimiento_id', datos.movimiento_entrada_id);
  if (!salida) throw new Error('asignacion_salida_entrada: movimiento_salida_id no existe.');
  if (!entrada) throw new Error('asignacion_salida_entrada: movimiento_entrada_id no existe.');

  if (TIPOS_MOVIMIENTO_SALIDA.indexOf(salida.tipo_movimiento) === -1) {
    throw new Error('asignacion_salida_entrada: el movimiento ' + datos.movimiento_salida_id + ' no es una salida (tipo=' + salida.tipo_movimiento + ').');
  }
  if (TIPOS_MOVIMIENTO_ENTRADA.indexOf(entrada.tipo_movimiento) === -1) {
    throw new Error('asignacion_salida_entrada: el movimiento ' + datos.movimiento_entrada_id + ' no es una entrada (tipo=' + entrada.tipo_movimiento + ').');
  }
  // Un solo almacén implícito, así que ya no se compara almacen_id; sin tabla de
  // lotes aparte tampoco hay lote_id que emparejar — sólo debe ser el mismo artículo.
  if (salida.codigo_articulo !== entrada.codigo_articulo) {
    throw new Error('asignacion_salida_entrada: la salida y la entrada no corresponden al mismo artículo.');
  }

  const sumaEntradaPrevia = sumarColumna_('asignacion_salida_entrada', 'cantidad_asignada',
    (f) => String(f.movimiento_entrada_id) === String(datos.movimiento_entrada_id));
  if (sumaEntradaPrevia + Number(datos.cantidad_asignada) > Number(entrada.cantidad)) {
    throw new Error(
      'asignacion_salida_entrada: se asignaría ' + (sumaEntradaPrevia + Number(datos.cantidad_asignada)) +
      ' contra una entrada de sólo ' + entrada.cantidad + ' unidades.'
    );
  }

  const sumaSalidaPrevia = sumarColumna_('asignacion_salida_entrada', 'cantidad_asignada',
    (f) => String(f.movimiento_salida_id) === String(datos.movimiento_salida_id));
  if (sumaSalidaPrevia + Number(datos.cantidad_asignada) > Number(salida.cantidad)) {
    throw new Error(
      'asignacion_salida_entrada: se asignaría ' + (sumaSalidaPrevia + Number(datos.cantidad_asignada)) +
      ' contra una salida de sólo ' + salida.cantidad + ' unidades.'
    );
  }
}

function guardarAsignacionSalidaEntrada(datos) {
  if (Number(datos.cantidad_asignada) <= 0) throw new Error('cantidad_asignada debe ser mayor a 0.');
  return conLock_(() => {
    validarAsignacionSalidaEntrada_(datos);
    const id = siguienteId_('asignacion_salida_entrada');
    escribirFila_('asignacion_salida_entrada', Object.assign({ asignacion_id: id }, datos));
    return id;
  });
}

/**
 * Orquesta el proceso completo de consolidación descrito en la Fase 5.1.1
 * del informe: agrega la demanda de TODAS las áreas para un artículo en un
 * rango de fechas, contra el proveedor con contrato activo, crea la OC (si
 * no se pasa una existente) y registra la trazabilidad en
 * consolidacion_pedido.
 *
 * Sólo consolida demanda ya ENVIADA por los servicios (lee de
 * consolidado_general, no de programacion_detalle): mientras una
 * programación siga en BORRADOR, Compras no debe verla ni convertirla en
 * OC — es el enlace entre el ciclo de vida de captura (31_CicloVida.gs) y
 * este motor de compras. Exclusivo de ADMINISTRADOR: consolidar cruza
 * varios servicios a la vez, no es una acción con alcance de un solo
 * servicio.
 *
 * Devuelve { ordenDetalleId, cantidadConsolidada, renglonesConsolidados }.
 */
function consolidarDemandaEnOC(codigoArticulo, fechaInicio, fechaFin, ordenId) {
  requiereRol_(['ADMINISTRADOR']);

  const contrato = leerFilas_('contrato_articulo').find(
    (f) => f.codigo_articulo === codigoArticulo && f.activo === true
  );
  if (!contrato) throw new Error('No hay contrato activo para el artículo ' + codigoArticulo + '; no se puede generar OC.');

  const renglones = leerFilas_('consolidado_general').filter(
    (f) => f.codigo_articulo === codigoArticulo && f.fecha >= fechaInicio && f.fecha <= fechaFin && Number(f.cantidad_programada) > 0
  );
  if (renglones.length === 0) throw new Error('No hay demanda ENVIADA para ese artículo en ese rango de fechas (¿sigue en borrador?).');

  const total = renglones.reduce((acc, f) => acc + Number(f.cantidad_programada), 0);

  return conLock_(() => {
    let orden = ordenId ? buscarPorClave_('orden_compra', 'orden_id', ordenId) : null;
    if (!orden) {
      const nuevoOrdenId = siguienteId_('orden_compra');
      escribirFila_('orden_compra', {
        orden_id: nuevoOrdenId, proveedor_id: contrato.proveedor_id,
        fecha_emision: hoy_(), estatus: 'PENDIENTE',
      });
      orden = { orden_id: nuevoOrdenId };
    }

    registrarConsumoCupo_(contrato.contrato_articulo_id, total);
    const ordenDetalleId = siguienteId_('orden_compra_detalle');
    escribirFila_('orden_compra_detalle', {
      orden_detalle_id: ordenDetalleId, orden_id: orden.orden_id,
      contrato_articulo_id: contrato.contrato_articulo_id, cantidad_solicitada: total, cantidad_recibida: 0,
    });

    renglones.forEach((r) => {
      validarConsolidacionPedido_({ programacion_detalle_id: r.programacion_detalle_id, orden_detalle_id: ordenDetalleId, cantidad_consolidada: r.cantidad_programada });
      const consolidacionId = siguienteId_('consolidacion_pedido');
      escribirFila_('consolidacion_pedido', {
        consolidacion_id: consolidacionId, programacion_detalle_id: r.programacion_detalle_id,
        orden_detalle_id: ordenDetalleId, cantidad_consolidada: r.cantidad_programada,
      });
    });

    return { ordenId: orden.orden_id, ordenDetalleId: ordenDetalleId, cantidadConsolidada: total, renglonesConsolidados: renglones.length };
  });
}
