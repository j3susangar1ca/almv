/**
 * Notificaciones por correo (GmailApp). Ambas funciones están pensadas
 * para correr en un disparador diario por tiempo:
 * Apps Script editor → Triggers → Add Trigger → time-driven, daily,
 * entre las 6 y 7 AM (antes de que empiece la operación del almacén).
 */

function alertaCaducidadLotes() {
  const cfg = CONFIG_();
  const limite = new Date();
  limite.setDate(limite.getDate() + cfg.DIAS_ALERTA_CADUCIDAD);
  const limiteIso = Utilities.formatDate(limite, 'America/Mexico_City', 'yyyy-MM-dd');

  const lotes = leerFilas_('lote').filter((f) => f.fecha_caducidad && f.fecha_caducidad <= limiteIso && f.fecha_caducidad >= hoy_());
  if (lotes.length === 0) return;

  const articulos = leerFilas_('articulo');
  const filasHtml = lotes
    .sort((a, b) => a.fecha_caducidad.localeCompare(b.fecha_caducidad))
    .map((l) => {
      const art = articulos.find((a) => a.codigo_articulo === l.codigo_articulo);
      return '<tr><td>' + l.fecha_caducidad + '</td><td>' + l.codigo_articulo + '</td><td>' +
        (art ? art.descripcion : '') + '</td><td>' + l.numero_lote_proveedor + '</td></tr>';
    }).join('');

  enviarCorreo_(
    'Alerta de caducidad — próximos ' + cfg.DIAS_ALERTA_CADUCIDAD + ' días',
    '<p>Los siguientes lotes caducan dentro de los próximos ' + cfg.DIAS_ALERTA_CADUCIDAD + ' días:</p>' +
    '<table border="1" cellpadding="4"><tr><th>Caduca</th><th>Artículo</th><th>Descripción</th><th>Lote</th></tr>' +
    filasHtml + '</table>'
  );
}

function alertaTechoContractual() {
  const cfg = CONFIG_();
  const cupos = leerFilas_('cupo_contractual_sede').filter((f) => {
    const maximo = Number(f.cantidad_maxima_anual);
    if (maximo <= 0) return false;
    return Number(f.cantidad_acumulada_ejercicio) / maximo >= cfg.UMBRAL_ALERTA_TECHO_CONTRACTUAL;
  });
  if (cupos.length === 0) return;

  const contratos = leerFilas_('contrato_articulo');
  const filasHtml = cupos.map((c) => {
    const contrato = contratos.find((ct) => String(ct.contrato_articulo_id) === String(c.contrato_articulo_id));
    const pct = (100 * Number(c.cantidad_acumulada_ejercicio) / Number(c.cantidad_maxima_anual)).toFixed(1);
    return '<tr><td>' + c.sede_id + '</td><td>' + (contrato ? contrato.codigo_articulo : c.contrato_articulo_id) +
      '</td><td>' + c.cantidad_acumulada_ejercicio + ' / ' + c.cantidad_maxima_anual + '</td><td>' + pct + '%</td></tr>';
  }).join('');

  enviarCorreo_(
    'Alerta de techo contractual — ≥' + (cfg.UMBRAL_ALERTA_TECHO_CONTRACTUAL * 100) + '% ejercido',
    '<p>Los siguientes cupos por sede están cerca de agotar su máximo anual:</p>' +
    '<table border="1" cellpadding="4"><tr><th>Sede</th><th>Artículo</th><th>Acumulado / Máximo</th><th>%</th></tr>' +
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
