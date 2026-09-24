/**
 * Generación de documentos en PDF. El Vale de Pedido reproduce el layout
 * real que ya usa Dietología (ver formato salida.html, raíz del repo):
 * encabezado del hospital, Partida Presupuestal / Unidad Hospitalaria,
 * Fecha / Servicio, tabla CÓDIGO/DESCRIPCIÓN/UNIDAD/CANTIDAD PEDIDA/
 * CANTIDAD SURTIDA/OBSERVACIONES, y pie de firmas. Se construye con
 * DocumentApp directamente (no requiere una plantilla previa en Drive);
 * si prefieres partir de una plantilla con membrete ya diseñado, define
 * PLANTILLA_VALE_PEDIDO_ID en las propiedades del script y usa
 * copiarYRellenarPlantilla_() en su lugar (ver comentario al final).
 */

function generarValePedido(areaId, fechaIso) {
  const area = buscarPorClave_('area_servicio', 'area_id', areaId);
  if (!area) throw new Error('area_servicio ' + areaId + ' no existe.');
  const almacen = area.almacen_id ? buscarPorClave_('almacen', 'almacen_id', area.almacen_id) : null;
  const sede = almacen ? buscarPorClave_('sede', 'sede_id', almacen.sede_id) : null;

  const renglones = renglonesValePedido_(areaId, fechaIso);
  if (renglones.length === 0) throw new Error('No hay programación registrada para ' + area.nombre + ' el ' + fechaIso + '.');

  const doc = DocumentApp.create('Vale de Pedido - ' + area.nombre + ' - ' + fechaIso);
  const body = doc.getBody();
  body.setPageWidth(612).setMarginLeft(36).setMarginRight(36); // carta, márgenes angostos

  body.appendParagraph('HOSPITAL CIVIL DE GUADALAJARA').setHeading(DocumentApp.ParagraphHeading.HEADING1).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph('PEDIDO AL ALMACÉN DE VÍVERES').setHeading(DocumentApp.ParagraphHeading.HEADING2).setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  const encabezado = body.appendTable([
    ['Partida Presupuestal:', '2212', 'Unidad Hospitalaria:', sede ? sede.nombre_sede : ''],
    ['Fecha:', fechaIso, 'Servicio:', area.nombre],
  ]);
  estiloTablaSinBorde_(encabezado);
  body.appendParagraph('');

  const filasTabla = [['CÓDIGO', 'DESCRIPCIÓN DEL ARTÍCULO', 'UNIDAD', 'CANT. PEDIDA', 'CANT. SURTIDA', 'OBSERVACIONES']]
    .concat(renglones.map((r) => [r.codigo, r.descripcion, r.unidad, String(r.cantidadPedida), String(r.cantidadSurtida || ''), r.observaciones || '']));
  const tabla = body.appendTable(filasTabla);
  const encabezadoFila = tabla.getRow(0);
  for (let c = 0; c < 6; c++) encabezadoFila.getCell(c).setBackgroundColor('#e8eaed');

  body.appendParagraph('');
  const firmas = body.appendTable([
    ['JEFE DE SERVICIO DIETOLOGÍA', 'ALMACÉN DE VÍVERES', 'ENTREGADO POR', 'RECIBIDO POR'],
    ['', '', '', ''],
    ['Nombre y firma', 'Nombre y firma', 'Nombre, firma y fecha', 'Nombre, firma y RUD'],
  ]);
  estiloTablaSinBorde_(firmas);

  doc.saveAndClose();
  return exportarComoPdf_(doc.getId(), 'Vale_Pedido_' + area.clave + '_' + fechaIso);
}

/** Renglones del vale: demanda programada de esa área/fecha, con lo surtido si ya hay movimiento registrado. */
function renglonesValePedido_(areaId, fechaIso) {
  const programaciones = leerFilas_('programacion_mensual').filter((f) => String(f.area_id) === String(areaId));
  const idsProgramacion = programaciones.map((p) => String(p.programacion_id));
  const detalle = leerFilas_('programacion_detalle').filter(
    (f) => idsProgramacion.indexOf(String(f.programacion_id)) !== -1 && f.fecha === fechaIso && Number(f.cantidad_programada) > 0
  );
  const articulos = leerFilas_('articulo');
  const unidades = leerFilas_('unidad_medida');
  const movimientos = leerFilas_('movimiento_inventario');

  return detalle.map((d) => {
    const art = articulos.find((a) => a.codigo_articulo === d.codigo_articulo);
    const unidad = art ? unidades.find((u) => Number(u.unidad_id) === Number(art.unidad_id)) : null;
    const surtido = movimientos.find((m) => String(m.programacion_detalle_id) === String(d.programacion_detalle_id) && m.tipo_movimiento === 'SALIDA_CONSUMO');
    return {
      codigo: d.codigo_articulo,
      descripcion: art ? art.descripcion : '',
      unidad: unidad ? unidad.clave : '',
      cantidadPedida: d.cantidad_programada,
      cantidadSurtida: surtido ? surtido.cantidad : '',
    };
  });
}

function generarPDFOrdenCompra(ordenId) {
  const orden = buscarPorClave_('orden_suministro', 'orden_id', ordenId);
  if (!orden) throw new Error('orden_suministro ' + ordenId + ' no existe.');
  const proveedor = buscarPorClave_('proveedor', 'proveedor_id', orden.proveedor_id);
  const sede = buscarPorClave_('sede', 'sede_id', orden.sede_id);

  const detalles = leerFilas_('orden_suministro_detalle').filter((f) => String(f.orden_id) === String(ordenId));
  const contratos = leerFilas_('contrato_articulo');
  const articulos = leerFilas_('articulo');

  const doc = DocumentApp.create('Orden de Compra ' + ordenId + ' - ' + (proveedor ? proveedor.razon_social : ''));
  const body = doc.getBody();
  body.appendParagraph('HOSPITAL CIVIL DE GUADALAJARA').setHeading(DocumentApp.ParagraphHeading.HEADING1).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph('ORDEN DE COMPRA N.° ' + ordenId).setHeading(DocumentApp.ParagraphHeading.HEADING2).setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  estiloTablaSinBorde_(body.appendTable([
    ['Proveedor:', proveedor ? proveedor.razon_social : orden.proveedor_id],
    ['Sede solicitante:', sede ? sede.nombre_sede : orden.sede_id],
    ['Fecha de emisión:', orden.fecha_emision],
    ['Fecha de entrega programada:', orden.fecha_entrega_programada || 'Por confirmar'],
  ]));
  body.appendParagraph('');

  const filas = [['Código', 'Descripción', 'Cantidad solicitada', 'Precio unitario', 'Importe']]
    .concat(detalles.map((d) => {
      const contrato = contratos.find((c) => String(c.contrato_articulo_id) === String(d.contrato_articulo_id));
      const art = contrato ? articulos.find((a) => a.codigo_articulo === contrato.codigo_articulo) : null;
      const precio = contrato ? Number(contrato.precio_unitario) : 0;
      const importe = precio * Number(d.cantidad_solicitada);
      return [
        contrato ? contrato.codigo_articulo : '',
        art ? art.descripcion : '',
        String(d.cantidad_solicitada),
        '$' + precio.toFixed(2),
        '$' + importe.toFixed(2),
      ];
    }));
  const tabla = body.appendTable(filas);
  for (let c = 0; c < 5; c++) tabla.getRow(0).getCell(c).setBackgroundColor('#e8eaed');

  doc.saveAndClose();
  return exportarComoPdf_(doc.getId(), 'OC_' + ordenId);
}

function estiloTablaSinBorde_(tabla) {
  tabla.setBorderWidth(0);
}

/** Exporta el Doc a PDF, lo guarda en la carpeta de documentos y borra el Doc temporal. */
function exportarComoPdf_(docId, nombreArchivo) {
  const cfg = CONFIG_();
  const pdfBlob = DriveApp.getFileById(docId).getAs(MimeType.PDF).setName(nombreArchivo + '.pdf');
  const carpeta = cfg.CARPETA_DOCUMENTOS_ID ? DriveApp.getFolderById(cfg.CARPETA_DOCUMENTOS_ID) : DriveApp.getRootFolder();
  const pdf = carpeta.createFile(pdfBlob);
  DriveApp.getFileById(docId).setTrashed(true); // conserva sólo el PDF final
  return pdf.getUrl();
}

/**
 * Alternativa si ya existe una plantilla de Google Docs con membrete real
 * y marcadores de texto tipo {{proveedor}}: duplica la plantilla y
 * reemplaza los marcadores antes de exportar a PDF.
 *
 * function copiarYRellenarPlantilla_(idPlantilla, nombreArchivo, reemplazos) {
 *   const copia = DriveApp.getFileById(idPlantilla).makeCopy(nombreArchivo);
 *   const doc = DocumentApp.openById(copia.getId());
 *   const body = doc.getBody();
 *   Object.keys(reemplazos).forEach((marcador) => body.replaceText('{{' + marcador + '}}', reemplazos[marcador]));
 *   doc.saveAndClose();
 *   return exportarComoPdf_(copia.getId(), nombreArchivo);
 * }
 */
