/**
 * Dominio contractual: Licitación / ContratoArticulo (el techo contractual
 * vive directamente en cada renglón de contrato — con una sola sede, un
 * cupo "por sede" aparte era una tabla puente 1:1 disfrazada de N:M).
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

/**
 * datos incluye, además de los campos comerciales, el techo contractual:
 * cantidad_minima_anual (opcional, default 0) y cantidad_maxima_anual
 * (opcional; 0 = "sin techo asignado todavía", bloquea cualquier pedido
 * hasta que se actualice con actualizarTechoContrato()).
 */
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
  const minima = Number(datos.cantidad_minima_anual) || 0;
  const maxima = Number(datos.cantidad_maxima_anual) || 0;
  if (maxima < minima) throw new Error('cantidad_maxima_anual no puede ser menor que cantidad_minima_anual.');

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
      cantidad_minima_anual: minima, cantidad_maxima_anual: maxima, cantidad_acumulada_ejercicio: 0,
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

/** Actualiza el techo contractual (mínimo/máximo anual) de un renglón de contrato ya existente. */
function actualizarTechoContrato(contratoArticuloId, cantidadMinimaAnual, cantidadMaximaAnual) {
  const minima = Number(cantidadMinimaAnual) || 0;
  const maxima = Number(cantidadMaximaAnual) || 0;
  if (maxima < minima) throw new Error('cantidad_maxima_anual no puede ser menor que cantidad_minima_anual.');
  return conLock_(() => {
    const contrato = buscarPorClave_('contrato_articulo', 'contrato_articulo_id', contratoArticuloId);
    if (!contrato) throw new Error('contrato_articulo ' + contratoArticuloId + ' no existe.');
    if (Number(contrato.cantidad_acumulada_ejercicio) > maxima) {
      throw new Error('No se puede bajar el techo por debajo de lo ya acumulado (' + contrato.cantidad_acumulada_ejercicio + ').');
    }
    actualizarFila_('contrato_articulo', contrato._row, { cantidad_minima_anual: minima, cantidad_maxima_anual: maxima });
  });
}

/**
 * Techo contractual por artículo, como {codigo_articulo: {acumulado,
 * maximo, pct}} — es la fuente del semáforo de techo presupuestal de la
 * interfaz (verde ≤75%, ámbar 76-95%, rojo >95%). Ya no recibe sede: con
 * una sola sede el techo es una propiedad directa del renglón de contrato.
 */
function obtenerCuposArticulos_() {
  const resultado = {};
  leerFilas_('contrato_articulo')
    .filter((f) => f.activo === true)
    .forEach((f) => {
      const maximo = Number(f.cantidad_maxima_anual);
      const acumulado = Number(f.cantidad_acumulada_ejercicio);
      resultado[f.codigo_articulo] = { acumulado: acumulado, maximo: maximo, pct: maximo > 0 ? acumulado / maximo : 0 };
    });
  return resultado;
}

/**
 * Acumula cantidad contra el techo contractual de un renglón de contrato
 * (se llama al confirmar una orden_compra_detalle). Lanza error si se
 * excede el máximo — el mismo CHECK
 * (cantidad_acumulada_ejercicio <= cantidad_maxima_anual) del DDL
 * original, hecho explícito aquí porque Sheets no lo valida solo.
 */
function registrarConsumoCupo_(contratoArticuloId, cantidad) {
  const contrato = buscarPorClave_('contrato_articulo', 'contrato_articulo_id', contratoArticuloId);
  if (!contrato) throw new Error('contrato_articulo ' + contratoArticuloId + ' no existe.');

  const nuevaAcumulada = Number(contrato.cantidad_acumulada_ejercicio) + Number(cantidad);
  if (nuevaAcumulada > Number(contrato.cantidad_maxima_anual)) {
    throw new Error(
      'El pedido excede el remanente contractual disponible ' +
      '(acumulado ' + nuevaAcumulada + ' > máximo ' + contrato.cantidad_maxima_anual + ').'
    );
  }
  actualizarFila_('contrato_articulo', contrato._row, { cantidad_acumulada_ejercicio: nuevaAcumulada });
}
