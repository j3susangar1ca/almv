/**
 * Autenticación (whitelist, sin contraseña) y autorización (RBAC + alcance
 * por servicio). Implementa la Opción 1 del documento de requerimientos
 * (recomendada): la identidad NUNCA se toma de un campo de texto que el
 * usuario escribe (eso permitiría suplantación, ver sección 2.2 del SRS),
 * sino de la sesión de Google ya autenticada con la que se accede a la Web
 * App — por eso appsscript.json exige executeAs=USER_ACCESSING y
 * access=DOMAIN: sin esa combinación, Session.getActiveUser() no devuelve
 * el correo de quien accede.
 */

/** Correo de quien está ejecutando la petición actual. Nunca viene de un parámetro del cliente. */
function obtenerCorreoSesion_() {
  const correo = Session.getActiveUser().getEmail();
  if (!correo) {
    throw new Error(
      'No se pudo determinar el usuario de la sesión de Google. Verifica que la Web App esté ' +
      'implementada con "Ejecutar como: Usuario que accede a la aplicación web" y acceso restringido ' +
      'al dominio (ver apps_script/README.md, sección 4).'
    );
  }
  return correo;
}

/**
 * Valida la sesión actual contra la whitelist (usuarios.activo=true) y
 * arma el payload {usuario, rol, servicios_asignados} — el mismo formato
 * que el documento de requerimientos define en la sección 4. Lanza error
 * (equivalente a 403 Forbidden) si el correo no está registrado o está
 * inactivo.
 */
function obtenerSesionActual() {
  const correo = obtenerCorreoSesion_();
  const usuario = leerFilas_('usuarios').find((u) => String(u.correo).toLowerCase() === correo.toLowerCase());
  if (!usuario || usuario.activo !== true) {
    throw new Error('403: Usuario no autorizado o inactivo (' + correo + ').');
  }

  const areas = leerFilas_('area_servicio');
  const serviciosAsignados = leerFilas_('usuario_servicios')
    .filter((a) => String(a.usuario_id) === String(usuario.usuario_id))
    .map((a) => {
      const area = areas.find((ar) => String(ar.area_id) === String(a.area_id));
      return { servicio_id: a.area_id, nombre: area ? area.nombre : ('Servicio ' + a.area_id), permiso: a.permiso };
    });

  return {
    usuario_id: usuario.usuario_id,
    correo: usuario.correo,
    nombre: usuario.nombre,
    rol: usuario.rol,
    servicios_asignados: serviciosAsignados,
  };
}

/**
 * Gatekeeper de servidor (sección 4, "Server-Side Gatekeeper"): toda
 * escritura sobre un servicio debe pasar por aquí. ADMINISTRADOR tiene
 * acceso total sin necesidad de asignación explícita en usuario_servicios.
 * Lanza error si el usuario no tiene, al menos, permisoMinimo sobre areaId.
 */
function requiereAcceso_(areaId, permisoMinimo) {
  const sesion = obtenerSesionActual();
  if (sesion.rol === 'ADMINISTRADOR') return sesion;

  const asignacion = sesion.servicios_asignados.find((s) => String(s.servicio_id) === String(areaId));
  if (!asignacion) {
    throw new Error('403: ' + sesion.correo + ' no tiene asignado el servicio ' + areaId + '.');
  }
  if (NIVEL_PERMISO[asignacion.permiso] < NIVEL_PERMISO[permisoMinimo]) {
    throw new Error(
      '403: ' + sesion.correo + ' tiene permiso "' + asignacion.permiso + '" sobre el servicio ' +
      areaId + '; se requiere al menos "' + permisoMinimo + '".'
    );
  }
  return sesion;
}

/** Gatekeeper para acciones que no están ligadas a un servicio específico (ej. generar una OC). */
function requiereRol_(rolesPermitidos) {
  const sesion = obtenerSesionActual();
  if (rolesPermitidos.indexOf(sesion.rol) === -1) {
    throw new Error('403: se requiere rol ' + rolesPermitidos.join(' o ') + ' (usuario actual: ' + sesion.rol + ').');
  }
  return sesion;
}
