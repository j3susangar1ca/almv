/**
 * CRUD de usuarios (whitelist) y de sus asignaciones a servicios
 * (usuario_servicios). Sólo ADMINISTRADOR puede administrar usuarios — el
 * gatekeeper vive en 80_WebApp.gs (apiGuardarUsuario, apiAsignarServicio),
 * no aquí, para permitir que sembrarPrimerAdministrador() se ejecute sin
 * necesitar ya un administrador (arranque en frío del sistema).
 */

function guardarUsuario(datos) {
  if (['CAPTURISTA', 'SUPERVISOR', 'ADMINISTRADOR'].indexOf(datos.rol) === -1) {
    throw new Error('rol inválido: ' + datos.rol);
  }
  return conLock_(() => {
    if (existeValor_('usuarios', 'correo', datos.correo)) {
      throw new Error('Ya existe un usuario con correo ' + datos.correo + '.');
    }
    const id = siguienteId_('usuarios');
    escribirFila_('usuarios', Object.assign({ usuario_id: id, activo: datos.activo !== false }, datos));
    return id;
  });
}

function desactivarUsuario(usuarioId) {
  return conLock_(() => {
    const usuario = buscarPorClave_('usuarios', 'usuario_id', usuarioId);
    if (!usuario) throw new Error('usuario ' + usuarioId + ' no existe.');
    actualizarFila_('usuarios', usuario._row, { activo: false });
  });
}

/** Asigna (o actualiza, si ya existía) el permiso de un usuario sobre un servicio (area_servicio). */
function asignarUsuarioServicio(usuarioId, areaId, permiso) {
  if (['LECTURA', 'ESCRITURA', 'APROBACION'].indexOf(permiso) === -1) throw new Error('permiso inválido: ' + permiso);
  if (!buscarPorClave_('usuarios', 'usuario_id', usuarioId)) throw new Error('usuario ' + usuarioId + ' no existe.');
  if (!buscarPorClave_('area_servicio', 'area_id', areaId)) throw new Error('servicio (area_id) ' + areaId + ' no existe.');

  return conLock_(() => {
    const existente = leerFilas_('usuario_servicios').find(
      (f) => String(f.usuario_id) === String(usuarioId) && String(f.area_id) === String(areaId)
    );
    if (existente) {
      actualizarFila_('usuario_servicios', existente._row, { permiso: permiso });
      return existente.asignacion_id;
    }
    const id = siguienteId_('usuario_servicios');
    escribirFila_('usuario_servicios', { asignacion_id: id, usuario_id: usuarioId, area_id: areaId, permiso: permiso });
    return id;
  });
}

function revocarUsuarioServicio(usuarioId, areaId) {
  return conLock_(() => {
    const existente = leerFilas_('usuario_servicios').find(
      (f) => String(f.usuario_id) === String(usuarioId) && String(f.area_id) === String(areaId)
    );
    if (!existente) return false;
    hoja_('usuario_servicios').deleteRow(existente._row);
    return true;
  });
}

/**
 * Arranque en frío: crea al primer ADMINISTRADOR con el correo de quien
 * ejecuta esta función. Debe correrse UNA VEZ, manualmente, desde el
 * editor de Apps Script (nunca desde la Web App) — es la única función de
 * este módulo que no pasa por el gatekeeper de rol, porque hasta que se
 * ejecuta no existe ningún administrador que pudiera autorizarla.
 */
function sembrarPrimerAdministrador(correoManual) {
  const correo = correoManual || Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  if (!correo) throw new Error('No se pudo determinar tu correo; pasa tu correo como parámetro. Ejemplo: sembrarPrimerAdministrador("tu_correo@gmail.com")');
  if (existeValor_('usuarios', 'correo', correo)) {
    Logger.log('Ya existe un usuario con el correo ' + correo + '; no se creó uno nuevo.');
    return;
  }
  const id = guardarUsuario({ correo: correo, nombre: correo, rol: 'ADMINISTRADOR' });
  Logger.log('Administrador creado: ' + correo + ' (usuario_id=' + id + ')');
  return id;
}
