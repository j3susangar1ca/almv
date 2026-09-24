/**
 * Pestañas de vista (aplanadas) para Looker Studio — ver sección 7 de
 * ADAPTACION_STACK_GOOGLE.md. Se recalculan por completo cada vez que se
 * llama actualizarVistas(); conviene dejarla en el mismo disparador diario
 * que las notificaciones (60_Notificaciones.gs).
 */

function actualizarVistas() {
  actualizarVistaConsumoDiario_();
  actualizarVistaEjecucionContractual_();
  actualizarVistaTrazabilidadOC_();
}

function reescribirVista_(nombreHoja, headers, filas) {
  const ss = SpreadsheetApp.openById(CONFIG_().SPREADSHEET_ID);
  let sheet = ss.getSheetByName(nombreHoja);
  if (!sheet) sheet = ss.insertSheet(nombreHoja);
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  if (filas.length > 0) {
    sheet.getRange(2, 1, filas.length, headers.length).setValues(filas);
  }
}

function actualizarVistaConsumoDiario_() {
  const detalle = leerFilas_('programacion_detalle');
  const cabeceras = leerFilas_('programacion_mensual');
  const areas = leerFilas_('area_servicio');
  const articulos = leerFilas_('articulo');

  const filas = detalle
    .filter((d) => Number(d.cantidad_programada) > 0)
    .map((d) => {
      const cab = cabeceras.find((c) => String(c.programacion_id) === String(d.programacion_id));
      const area = cab ? areas.find((a) => String(a.area_id) === String(cab.area_id)) : null;
      const art = articulos.find((a) => a.codigo_articulo === d.codigo_articulo);
      return [d.fecha, area ? area.nombre : '', d.codigo_articulo, art ? art.descripcion : '', Number(d.cantidad_programada)];
    });

  reescribirVista_('vista_consumo_diario', ['fecha', 'area', 'codigo_articulo', 'descripcion', 'cantidad_programada'], filas);
}

function actualizarVistaEjecucionContractual_() {
  const cupos = leerFilas_('cupo_contractual_sede');
  const contratos = leerFilas_('contrato_articulo');
  const articulos = leerFilas_('articulo');
  const proveedores = leerFilas_('proveedor');

  const filas = cupos.map((c) => {
    const contrato = contratos.find((ct) => String(ct.contrato_articulo_id) === String(c.contrato_articulo_id));
    const art = contrato ? articulos.find((a) => a.codigo_articulo === contrato.codigo_articulo) : null;
    const prov = contrato ? proveedores.find((p) => p.proveedor_id === contrato.proveedor_id) : null;
    const maximo = Number(c.cantidad_maxima_anual);
    const pct = maximo > 0 ? Number(c.cantidad_acumulada_ejercicio) / maximo : 0;
    return [
      c.sede_id, contrato ? contrato.codigo_articulo : '', art ? art.descripcion : '',
      prov ? prov.razon_social : '', Number(c.cantidad_acumulada_ejercicio), maximo, pct,
    ];
  });

  reescribirVista_('vista_ejecucion_contractual',
    ['sede_id', 'codigo_articulo', 'descripcion', 'proveedor', 'cantidad_acumulada_ejercicio', 'cantidad_maxima_anual', 'pct_ejercido'],
    filas);
}

function actualizarVistaTrazabilidadOC_() {
  const asignaciones = leerFilas_('asignacion_salida_entrada');
  const movimientos = leerFilas_('movimiento_inventario');
  const detalleProg = leerFilas_('programacion_detalle');
  const cabProg = leerFilas_('programacion_mensual');
  const areas = leerFilas_('area_servicio');
  const detalleOC = leerFilas_('orden_suministro_detalle');
  const ordenes = leerFilas_('orden_suministro');
  const proveedores = leerFilas_('proveedor');

  const filas = asignaciones.map((asig) => {
    const salida = movimientos.find((m) => String(m.movimiento_id) === String(asig.movimiento_salida_id));
    const entrada = movimientos.find((m) => String(m.movimiento_id) === String(asig.movimiento_entrada_id));
    if (!salida || !entrada) return null;

    const progDet = salida.programacion_detalle_id
      ? detalleProg.find((d) => String(d.programacion_detalle_id) === String(salida.programacion_detalle_id))
      : null;
    const progCab = progDet ? cabProg.find((c) => String(c.programacion_id) === String(progDet.programacion_id)) : null;
    const area = progCab ? areas.find((a) => String(a.area_id) === String(progCab.area_id)) : null;

    const ocDetalle = entrada.orden_detalle_id ? detalleOC.find((d) => String(d.orden_detalle_id) === String(entrada.orden_detalle_id)) : null;
    const orden = ocDetalle ? ordenes.find((o) => String(o.orden_id) === String(ocDetalle.orden_id)) : null;
    const proveedor = orden ? proveedores.find((p) => p.proveedor_id === orden.proveedor_id) : null;

    return [
      area ? area.nombre : '', progDet ? progDet.fecha : '', progDet ? Number(progDet.cantidad_programada) : '',
      orden ? orden.orden_id : '', ocDetalle ? Number(ocDetalle.cantidad_solicitada) : '',
      proveedor ? proveedor.razon_social : '', Number(salida.cantidad), Number(asig.cantidad_asignada),
    ];
  }).filter(Boolean);

  reescribirVista_('vista_trazabilidad_oc',
    ['area_solicitante', 'fecha', 'kg_solicitados', 'oc_id', 'kg_totales_oc', 'proveedor', 'kg_entregados', 'kg_de_esta_entrada'],
    filas);
}
