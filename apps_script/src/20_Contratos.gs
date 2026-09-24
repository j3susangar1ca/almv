/**
 * Dominio contractual: Licitación / ContratoArticulo / CupoContractualSede.
 * Reproduce el índice único parcial "un solo renglón activo por
 * artículo+licitación" y el CHECK de techo contractual del DDL original.
 */

function guardarLicitacion(datos) {
  const ESTATUS_VALIDOS = ['EN_PROCESO', 'ADJUDICADA', 'CANCELADA', 'VENCIDA'];
  if (ESTATUS_VALIDOS.indexOf(datos.estatus) === -1) throw new Error('estatus de licitación inválido: ' + datos.estatus);
  return conLock_(() => {
    if (buscarPorClave_('licitacion', 'licitacion_id', datos.licitacion_id)) {
      throw new Error('Ya existe la licitación "' + datos.licitacion_id + '".');
    }
    escribirFila_('licitacion', datos);
    return datos.licitacion_id;
  });
}

/** true si YA existe un renglón activo para ese artículo dentro de esa licitación. */
function existeContratoActivo_(licitacionId, codigoArticulo, excluirId) {
  return leerFilas_('contrato_articulo').some(
    (f) => f.licitacion_id === licitacionId && f.codigo_articulo === codigoArticulo &&
      f.activo === true && String(f.contrato_articulo_id) !== String(excluirId)
  );
}

function guardarContratoArticulo(datos) {
  if (!buscarPorClave_('licitacion', 'licitacion_id', datos.licitacion_id)) {
    throw new Error('contrato_articulo: licitacion_id ' + datos.licitacion_id + ' no existe.');
  }
  if (!buscarPorClave_('articulo', 'codigo_articulo', datos.codigo_articulo)) {
    throw new Error('contrato_articulo: codigo_articulo ' + datos.codigo_articulo + ' no existe.');
  }
  if (!buscarPorClave_('proveedor', 'proveedor_id', datos.proveedor_id)) {
    throw new Error('contrato_articulo: proveedor_id ' + datos.proveedor_id + ' no existe.');
  }
  if (Number(datos.precio_unitario) <= 0) throw new Error('precio_unitario debe ser mayor a 0.');

  return conLock_(() => {
    const activo = datos.activo !== false;
    if (activo && existeContratoActivo_(datos.licitacion_id, datos.codigo_articulo)) {
      throw new Error(
        'Ya existe un renglón ACTIVO para el artículo ' + datos.codigo_articulo +
        ' en la licitación ' + datos.licitacion_id + ' (equivalente al índice único parcial ' +
        'ux_contrato_articulo_activo). Desactiva el renglón anterior antes de activar uno nuevo.'
      );
    }
    const id = siguienteId_('contrato_articulo');
    escribirFila_('contrato_articulo', Object.assign({
      contrato_articulo_id: id, activo, fecha_registro: hoy_(),
    }, datos));
    return id;
  });
}

/** Activa un renglón de contrato y desactiva cualquier otro activo del mismo artículo+licitación. */
function activarContratoArticulo(contratoArticuloId) {
  return conLock_(() => {
    const filas = leerFilas_('contrato_articulo');
    const objetivo = filas.find((f) => String(f.contrato_articulo_id) === String(contratoArticuloId));
    if (!objetivo) throw new Error('contrato_articulo ' + contratoArticuloId + ' no existe.');

    filas
      .filter((f) => f.licitacion_id === objetivo.licitacion_id && f.codigo_articulo === objetivo.codigo_articulo && f.activo === true)
      .forEach((f) => actualizarFila_('contrato_articulo', f._row, { activo: false }));

    actualizarFila_('contrato_articulo', objetivo._row, { activo: true });
  });
}

function guardarCupoContractualSede(datos) {
  if (!buscarPorClave_('contrato_articulo', 'contrato_articulo_id', datos.contrato_articulo_id)) {
    throw new Error('cupo_contractual_sede: contrato_articulo_id ' + datos.contrato_articulo_id + ' no existe.');
  }
  if (!buscarPorClave_('sede', 'sede_id', datos.sede_id)) {
    throw new Error('cupo_contractual_sede: sede_id ' + datos.sede_id + ' no existe.');
  }
  const minima = Number(datos.cantidad_minima_anual) || 0;
  const maxima = Number(datos.cantidad_maxima_anual);
  if (maxima < minima) throw new Error('cantidad_maxima_anual no puede ser menor que cantidad_minima_anual.');

  return conLock_(() => {
    const yaExiste = leerFilas_('cupo_contractual_sede').some(
      (f) => String(f.contrato_articulo_id) === String(datos.contrato_articulo_id) && f.sede_id === datos.sede_id
    );
    if (yaExiste) throw new Error('Ya existe un cupo para ese artículo de contrato en la sede ' + datos.sede_id + '.');
    const id = siguienteId_('cupo_contractual_sede');
    escribirFila_('cupo_contractual_sede', Object.assign({
      cupo_id: id, cantidad_minima_anual: minima, cantidad_maxima_anual: maxima,
      cantidad_acumulada_ejercicio: 0,
    }, datos));
    return id;
  });
}

/**
 * Acumula cantidad contra el techo contractual de una sede (se llama al
 * confirmar una orden_suministro_detalle). Lanza error si se excede el
 * máximo — el mismo CHECK (cantidad_acumulada_ejercicio <= cantidad_maxima_anual)
 * del DDL original, hecho explícito aquí porque Sheets no lo valida solo.
 */
function registrarConsumoCupo_(contratoArticuloId, sedeId, cantidad) {
  const filas = leerFilas_('cupo_contractual_sede');
  const cupo = filas.find((f) => String(f.contrato_articulo_id) === String(contratoArticuloId) && f.sede_id === sedeId);
  if (!cupo) throw new Error('No hay cupo_contractual_sede definido para ese artículo/sede — no se puede pedir.');

  const nuevaAcumulada = Number(cupo.cantidad_acumulada_ejercicio) + Number(cantidad);
  if (nuevaAcumulada > Number(cupo.cantidad_maxima_anual)) {
    throw new Error(
      'El pedido excede el remanente contractual disponible para esta sede ' +
      '(acumulado ' + nuevaAcumulada + ' > máximo ' + cupo.cantidad_maxima_anual + ').'
    );
  }
  actualizarFila_('cupo_contractual_sede', cupo._row, { cantidad_acumulada_ejercicio: nuevaAcumulada });
}
