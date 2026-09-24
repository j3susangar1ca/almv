/**
 * CRUD de los 8 catálogos maestros. Cada guardarX() reproduce las mismas
 * restricciones que tenían en schema_dietologia.sql (UNIQUE, FK, CHECK).
 */

function guardarUnidadMedida(datos) {
  if (['PESO', 'VOLUMEN', 'PIEZA', 'PAQUETE'].indexOf(datos.tipo_medida) === -1) {
    throw new Error('tipo_medida inválido: ' + datos.tipo_medida);
  }
  return conLock_(() => {
    if (existeValor_('unidad_medida', 'clave', datos.clave)) {
      throw new Error('Ya existe una unidad de medida con clave "' + datos.clave + '".');
    }
    const id = siguienteId_('unidad_medida');
    escribirFila_('unidad_medida', Object.assign({ unidad_id: id }, datos));
    return id;
  });
}

function guardarFamilia(datos) {
  return conLock_(() => {
    if (existeValor_('familia', 'clave_presupuestal', datos.clave_presupuestal)) {
      throw new Error('Ya existe la familia presupuestal "' + datos.clave_presupuestal + '".');
    }
    const id = siguienteId_('familia');
    escribirFila_('familia', Object.assign({ familia_id: id }, datos));
    return id;
  });
}

function guardarGrupoAlimento(datos) {
  if (!buscarPorClave_('familia', 'familia_id', datos.familia_id)) {
    throw new Error('grupo_alimento: la familia_id ' + datos.familia_id + ' no existe.');
  }
  return conLock_(() => {
    if (existeValor_('grupo_alimento', 'nombre', datos.nombre)) {
      throw new Error('Ya existe el grupo de alimento "' + datos.nombre + '".');
    }
    const id = siguienteId_('grupo_alimento');
    escribirFila_('grupo_alimento', Object.assign({ grupo_id: id, es_perecedero: !!datos.es_perecedero }, datos));
    return id;
  });
}

function guardarProveedor(datos) {
  return conLock_(() => {
    if (buscarPorClave_('proveedor', 'proveedor_id', datos.proveedor_id)) {
      throw new Error('Ya existe el proveedor "' + datos.proveedor_id + '".');
    }
    escribirFila_('proveedor', Object.assign({ activo: true }, datos));
    return datos.proveedor_id;
  });
}

function guardarSede(datos) {
  if (['HOSPITAL', 'OFICINA_CENTRAL'].indexOf(datos.tipo_sede) === -1) {
    throw new Error('tipo_sede inválido: ' + datos.tipo_sede);
  }
  return conLock_(() => {
    if (buscarPorClave_('sede', 'sede_id', datos.sede_id)) {
      throw new Error('Ya existe la sede "' + datos.sede_id + '".');
    }
    escribirFila_('sede', datos);
    return datos.sede_id;
  });
}

function guardarArticulo(datos) {
  if (!buscarPorClave_('grupo_alimento', 'grupo_id', datos.grupo_id)) {
    throw new Error('articulo: grupo_id ' + datos.grupo_id + ' no existe.');
  }
  if (!buscarPorClave_('unidad_medida', 'unidad_id', datos.unidad_id)) {
    throw new Error('articulo: unidad_id ' + datos.unidad_id + ' no existe.');
  }
  return conLock_(() => {
    if (buscarPorClave_('articulo', 'codigo_articulo', datos.codigo_articulo)) {
      throw new Error('Ya existe el artículo "' + datos.codigo_articulo + '".');
    }
    escribirFila_('articulo', Object.assign({
      requiere_control_lote: datos.requiere_control_lote !== false,
      activo: true,
      fecha_alta: hoy_(),
    }, datos));
    return datos.codigo_articulo;
  });
}

function guardarAlmacen(datos) {
  if (!buscarPorClave_('sede', 'sede_id', datos.sede_id)) {
    throw new Error('almacen: sede_id ' + datos.sede_id + ' no existe.');
  }
  if (['CENTRAL', 'PERIFERICO', 'COCINA'].indexOf(datos.tipo_almacen) === -1) {
    throw new Error('tipo_almacen inválido: ' + datos.tipo_almacen);
  }
  return conLock_(() => {
    const yaExiste = leerFilas_('almacen').some(
      (f) => f.sede_id === datos.sede_id && f.clave_almacen === datos.clave_almacen
    );
    if (yaExiste) throw new Error('Ya existe el almacén "' + datos.clave_almacen + '" en la sede ' + datos.sede_id + '.');
    const id = siguienteId_('almacen');
    escribirFila_('almacen', Object.assign({ almacen_id: id }, datos));
    return id;
  });
}

function guardarAreaServicio(datos) {
  if (datos.almacen_id && !buscarPorClave_('almacen', 'almacen_id', datos.almacen_id)) {
    throw new Error('area_servicio: almacen_id ' + datos.almacen_id + ' no existe.');
  }
  return conLock_(() => {
    if (existeValor_('area_servicio', 'clave', datos.clave)) {
      throw new Error('Ya existe el área de servicio "' + datos.clave + '".');
    }
    const id = siguienteId_('area_servicio');
    escribirFila_('area_servicio', Object.assign({ area_id: id, activo: true }, datos));
    return id;
  });
}
