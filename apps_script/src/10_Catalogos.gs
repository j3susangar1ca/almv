/**
 * CRUD de los catálogos maestros. Cada guardarX() reproduce las mismas
 * restricciones que tenían en schema_dietologia.sql (UNIQUE, FK, CHECK).
 * No hay guardarSede()/guardarAlmacen(): la herramienta es de una sola
 * sede (SEDE_NOMBRE, 00_Config.gs) y un solo almacén, así que no son
 * catálogos — son una constante.
 */

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

function guardarArticulo(datos) {
  if (!buscarPorClave_('grupo_alimento', 'grupo_id', datos.grupo_id)) {
    throw new Error('articulo: grupo_id ' + datos.grupo_id + ' no existe.');
  }
  if (UNIDADES_MEDIDA.indexOf(datos.unidad_medida) === -1) {
    throw new Error('articulo: unidad_medida inválida: ' + datos.unidad_medida);
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

function guardarAreaServicio(datos) {
  return conLock_(() => {
    if (existeValor_('area_servicio', 'clave', datos.clave)) {
      throw new Error('Ya existe el área de servicio "' + datos.clave + '".');
    }
    const id = siguienteId_('area_servicio');
    escribirFila_('area_servicio', Object.assign({ area_id: id, activo: true }, datos));
    return id;
  });
}
