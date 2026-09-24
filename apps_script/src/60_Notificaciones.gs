/**
 * Notificaciones por correo (GmailApp). Ambas funciones están pensadas
 * para correr en un disparador diario por tiempo:
 * Apps Script editor → Triggers → Add Trigger → time-driven, daily,
 * entre las 6 y 7 AM (antes de que empiece la operación del almacén).
 */

/** El lote ya no es una tabla aparte: se lee directo de las entradas de compra (movimiento_inventario). */
function alertaCaducidadLotes() {
  const cfg = CONFIG_();
  const limite = new Date();
  limite.setDate(limite.getDate() + cfg.DIAS_ALERTA_CADUCIDAD);
  const limiteIso = Utilities.formatDate(limite, 'America/Mexico_City', 'yyyy-MM-dd');

  const entradas = leerFilas_('movimiento_inventario').filter(
    (f) => f.tipo_movimiento === 'ENTRADA_COMPRA' && f.fecha_caducidad && f.fecha_caducidad <= limiteIso && f.fecha_caducidad >= hoy_()
  );
  if (entradas.length === 0) return;

  const articulos = leerFilas_('articulo');
  const filasHtml = entradas
    .sort((a, b) => a.fecha_caducidad.localeCompare(b.fecha_caducidad))
    .map((e) => {
      const art = articulos.find((a) => a.codigo_articulo === e.codigo_articulo);
      return '<tr><td>' + e.fecha_caducidad + '</td><td>' + e.codigo_articulo + '</td><td>' +
        (art ? art.descripcion : '') + '</td><td>' + e.numero_lote_proveedor + '</td></tr>';
    }).join('');

  enviarCorreo_(
    'Alerta de caducidad — próximos ' + cfg.DIAS_ALERTA_CADUCIDAD + ' días',
    '<p>Los siguientes lotes recibidos caducan dentro de los próximos ' + cfg.DIAS_ALERTA_CADUCIDAD + ' días:</p>' +
    '<table border="1" cellpadding="4"><tr><th>Caduca</th><th>Artículo</th><th>Descripción</th><th>Lote</th></tr>' +
    filasHtml + '</table>'
  );
}

/** El techo contractual vive en contrato_articulo (una sola sede: ya no hay cupo_contractual_sede). */
function alertaTechoContractual() {
  const cfg = CONFIG_();
  const articulos = leerFilas_('articulo');
  const contratos = leerFilas_('contrato_articulo').filter((f) => {
    const maximo = Number(f.cantidad_maxima_anual);
    if (maximo <= 0) return false;
    return Number(f.cantidad_acumulada_ejercicio) / maximo >= cfg.UMBRAL_ALERTA_TECHO_CONTRACTUAL;
  });
  if (contratos.length === 0) return;

  const filasHtml = contratos.map((c) => {
    const art = articulos.find((a) => a.codigo_articulo === c.codigo_articulo);
    const pct = (100 * Number(c.cantidad_acumulada_ejercicio) / Number(c.cantidad_maxima_anual)).toFixed(1);
    return '<tr><td>' + c.codigo_articulo + '</td><td>' + (art ? art.descripcion : '') +
      '</td><td>' + c.cantidad_acumulada_ejercicio + ' / ' + c.cantidad_maxima_anual + '</td><td>' + pct + '%</td></tr>';
  }).join('');

  enviarCorreo_(
    'Alerta de techo contractual — ≥' + (cfg.UMBRAL_ALERTA_TECHO_CONTRACTUAL * 100) + '% ejercido',
    '<p>Los siguientes artículos están cerca de agotar su máximo anual contratado:</p>' +
    '<table border="1" cellpadding="4"><tr><th>Artículo</th><th>Descripción</th><th>Acumulado / Máximo</th><th>%</th></tr>' +
    filasHtml + '</table>'
  );
}

function enviarCorreo_(asunto, cuerpoHtml) {
  const destinatarios = CONFIG_().CORREOS_NOTIFICACION;
  if (destinatarios.length === 0) {
    Logger.log('Sin destinatarios configurados (CORREOS_NOTIFICACION). Asunto omitido: ' + asunto);
    return;
  }
  GmailApp.sendEmail(destinatarios.join(','), '[Dietología] ' + asunto, '', { htmlBody: cuerpoHtml });
}
