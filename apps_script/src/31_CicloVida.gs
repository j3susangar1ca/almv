/**
 * Máquina de estados BORRADOR -> ENVIADO de una programación mensual
 * (sección 5 del SRS). Implementa el Enfoque A de consolidación (sección
 * 6.2, "tiempo real / transaccional"): al enviar, la misma operación con
 * lock escribe en consolidado_general — no hay un job aparte ni una vista
 * calculada por separado.
 */

/**
 * Acción "Enviar Información" / "Cerrar Carga". Requiere permiso APROBACION
 * sobre el servicio (RBAC) — capturar (ESCRITURA) no basta para cerrar la
 * carga, así el documento distingue explícitamente a quien aprueba/envía.
 */
function enviarCarga(programacionId) {
  const programacion = buscarPorClave_('programacion_mensual', 'programacion_id', programacionId);
  if (!programacion) throw new Error('programacion_mensual ' + programacionId + ' no existe.');

  const sesion = requiereAcceso_(programacion.area_id, 'APROBACION');
  if (programacion.estatus !== 'BORRADOR') {
    throw new Error('Esta carga ya está en estatus ' + programacion.estatus + '; no se puede volver a enviar.');
  }

  const detalle = leerFilas_('programacion_detalle').filter(
    (f) => String(f.programacion_id) === String(programacionId)
  );
  // Validación de esquema mínima exigida por el SRS (5.2): no se envía una carga vacía,
  // y cada cantidad ya pasó por el CHECK de guardarProgramacionDetalle al capturarse.
  if (detalle.length === 0) {
    throw new Error('No hay renglones capturados para esta programación; no se puede enviar una carga vacía.');
  }

  return conLock_(() => {
    const ahora = new Date().toISOString();
    actualizarFila_('programacion_mensual', programacion._row, {
      estatus: 'ENVIADO', fecha_envio: ahora, enviado_por_usuario_id: sesion.usuario_id,
    });

    // Enfoque A: consolidación inmediata y transaccional en consolidado_general.
    let siguiente = siguienteId_('consolidado_general');
    detalle.forEach((d) => {
      escribirFila_('consolidado_general', {
        consolidado_id: siguiente++,
        programacion_id: programacionId,
        area_id: programacion.area_id,
        codigo_articulo: d.codigo_articulo,
        fecha: d.fecha,
        cantidad_programada: d.cantidad_programada,
        programacion_detalle_id: d.programacion_detalle_id,
        usuario_envio_id: sesion.usuario_id,
        fecha_envio: ahora,
      });
    });

    return { estatus: 'ENVIADO', filasConsolidadas: detalle.length, fechaEnvio: ahora };
  });
}

/**
 * "Reabrir Carga" (sección 6.2): exclusivo de ADMINISTRADOR. Regresa la
 * programación a BORRADOR y purga sus filas de consolidado_general —
 * el requerimiento pide que el General "se recalcule automáticamente";
 * como la siguiente enviarCarga() vuelve a escribir esas filas, purgar
 * ahora es ese recálculo.
 */
function reabrirCarga(programacionId) {
  requiereRol_(['ADMINISTRADOR']);
  const programacion = buscarPorClave_('programacion_mensual', 'programacion_id', programacionId);
  if (!programacion) throw new Error('programacion_mensual ' + programacionId + ' no existe.');
  if (programacion.estatus !== 'ENVIADO') {
    throw new Error('Sólo se puede reabrir una carga en estatus ENVIADO (actual: ' + programacion.estatus + ').');
  }

  return conLock_(() => {
    actualizarFila_('programacion_mensual', programacion._row, {
      estatus: 'BORRADOR', fecha_envio: '', enviado_por_usuario_id: '',
    });

    const sheet = hoja_('consolidado_general');
    leerFilas_('consolidado_general')
      .filter((f) => String(f.programacion_id) === String(programacionId))
      .sort((a, b) => b._row - a._row) // de abajo hacia arriba para no correr los índices de fila al borrar
      .forEach((f) => sheet.deleteRow(f._row));

    return { estatus: 'BORRADOR' };
  });
}
