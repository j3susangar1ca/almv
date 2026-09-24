# Adaptación del Proyecto al Stack de Google (Sheets + Apps Script)

**Contexto:** herramienta interna de sistematización para Dietología/Almacén de Víveres del Hospital Civil de Guadalajara, uso acotado (≈10 usuarios concurrentes como máximo), sin objetivo de escalar ni comercializarse. El diseño relacional en 3FN (`INFORME_DISENO_BD_DIETOLOGIA.md`, `schema_dietologia.sql`) y los datos ya saneados (`dietologia_normalizado/*.csv`) **no se descartan**: son el contrato de datos que este stack implementa. Lo que cambia es el motor de ejecución.

| Capa | Antes (PostgreSQL) | Ahora (Google) |
|---|---|---|
| Base de datos | PostgreSQL 15+, esquema `dietologia` | Google Sheets — 1 libro, 1 pestaña por tabla (21) |
| Integridad (PK/FK/CHECK/UNIQUE) | Motor relacional | Apps Script (`Validaciones.gs`) + `LockService` |
| Lógica de negocio / triggers | `plpgsql` (2 funciones + 2 triggers) | Funciones `.gs` equivalentes, mismas reglas y mismos mensajes de error |
| Backend | — | Google Apps Script (contenedor ligado al Sheet) |
| Frontend | — | Apps Script Web App: HTML5 + Tailwind CSS (CDN) + Vue 3 (CDN) |
| Documentos (Vale de Pedido, OC) | — | Google Docs (plantilla) → PDF vía Drive API |
| Notificaciones (caducidad, techo contractual) | — | `GmailApp` + disparadores por tiempo (`Triggers`) |
| Tableros | — | Looker Studio, conectado directo a las pestañas del Sheet |

---

## 1. Por qué este stack es adecuado aquí (y dónde no lo sería)

Con ≤10 usuarios y volúmenes como los ya medidos (414 artículos, 348 renglones de contrato, ~52 mil filas de `programacion_detalle` para un mes), Sheets está muy por debajo de sus límites duros (10,000,000 de celdas por libro, ~50 pestañas cómodas). Los cuellos de botella reales a los que sí hay que diseñarles alrededor:

- **Sin transacciones ACID reales.** Dos usuarios pueden intentar editar la misma fila a la vez. Toda escritura que dependa de un cálculo previo (folios `SERIAL`, sumas de validación) debe envolverse en `LockService.getScriptLock()`.
- **Apps Script tiene cuota de 6 minutos por ejecución** (cuentas gratuitas/Workspace estándar) y límites diarios de triggers. Para 10 usuarios y los volúmenes actuales no es un riesgo, pero el import masivo inicial de `programacion_detalle` (51,858 filas) debe hacerse por lotes (`batch` de `setValues`, no fila por fila) — ya está resuelto así en `03_ImportarCSV.gs`.
- **No hay `FOREIGN KEY`/`CHECK` nativos.** Toda la integridad que antes vivía en el `CREATE TABLE`/triggers de PostgreSQL se reimplementa como funciones de validación explícitas que se llaman **antes** de cada escritura (ver sección 3). Esto es más frágil que un constraint de base de datos —cualquier función nueva que escriba directo con `appendRow` sin pasar por `Validaciones.gs` rompe la integridad silenciosamente— así que la regla del proyecto es: **ninguna escritura a una pestaña de datos ocurre fuera de las funciones `guardarX()` de `10_Catalogos.gs`…`50_Consolidacion.gs`.**
- **Cuándo migrar de stack:** si el número de usuarios concurrentes crece a decenas, si se necesita reportes en tiempo real pesados, o si la operación exige transacciones estrictas (p. ej. conciliación contable), el mismo `schema_dietologia.sql` ya diseñado es la ruta de salida — los nombres de columna son idénticos entre las pestañas de Sheets y las tablas de Postgres a propósito, para que una migración futura sea un `\copy` y no un rediseño.

---

## 2. Mapeo de las 21 tablas a pestañas de Google Sheets

Cada pestaña usa **exactamente** los mismos nombres y orden de columna que su CSV en `dietologia_normalizado/`, para poder poblarla por importación directa (ver `03_ImportarCSV.gs`). Esto también es lo que hace trivial reconectar Looker Studio o, el día de mañana, migrar a Postgres.

| Pestaña | Filas iniciales (de `dietologia_normalizado/`) | Notas de adaptación |
|---|---|---|
| `unidad_medida`, `familia`, `grupo_alimento`, `proveedor`, `sede` | 16 / 22 / 13 / 6 / 4 | Catálogos; se cargan primero. |
| `articulo`, `almacen`, `area_servicio` | 414 / 4 / 10 | `articulo.codigo_articulo` es la clave que más se usa en validaciones cruzadas (`buscarPorClave_`). |
| `licitacion`, `contrato_articulo`, `cupo_contractual_sede` | 1 / 348 / 577 | El índice único parcial de Postgres (`WHERE activo`) se reimplementa como función `existeContratoActivo_()`. |
| `lote`, `orden_suministro`, `orden_suministro_detalle`, `movimiento_inventario`, `existencia_almacen` | 0 (arrancan vacías) | Flujo operativo hacia adelante. |
| `programacion_mensual`, `programacion_detalle`, `produccion_diaria` | 7 / 51,858 / 232 | `programacion_detalle` se importa en lotes de 5,000 filas para no acercarse al límite de ejecución. |
| `consolidacion_pedido`, `asignacion_salida_entrada` | 0 (arrancan vacías) | Igual que en Postgres: es el flujo de consolidación de OC que el sistema ejecuta hacia adelante. |

Fila 1 de cada pestaña = encabezados (congelados con `setFrozenRows(1)`); `02_SetupSheets.gs` también aplica formato de fecha, y listas desplegables (`DataValidation`) en las columnas que en el DDL eran `CHECK (... IN (...))` — por ejemplo `tipo_movimiento`, `estatus` de `orden_suministro`, `tipo_almacen`.

---

## 3. Traducción de restricciones SQL → validación en Apps Script

| Restricción SQL (`schema_dietologia.sql`) | Equivalente en Apps Script |
|---|---|
| `PRIMARY KEY` autoincremental (`BIGSERIAL`) | `siguienteId_(nombreHoja)` — lee el máximo id actual con `LockService` tomado, único punto de generación de folios. |
| `FOREIGN KEY` | `buscarPorClave_(hoja, columnaClave, valor)`; si no encuentra la fila, la función `guardarX()` lanza `throw new Error(...)` con el mismo texto que el `RAISE EXCEPTION` original. |
| `UNIQUE` | `existeValor_(hoja, columna, valor)` antes de insertar. |
| Índice único parcial `WHERE activo` (`contrato_articulo`) | `existeContratoActivo_(licitacionId, codigoArticulo)` recorre la pestaña y verifica que ningún otro renglón tenga `activo=true` para esa combinación antes de activar uno nuevo. |
| `CHECK (cantidad_acumulada_ejercicio <= cantidad_maxima_anual)` | Se revalida en `registrarConsumoCupo_()` cada vez que se liga una `orden_suministro_detalle` a un `cupo_contractual_sede`. |
| Trigger `trg_valida_consolidacion_pedido` | Función `validarConsolidacionPedido_()` en `50_Consolidacion.gs` — mismo algoritmo, mismos mensajes de error que la función `plpgsql` original. |
| Trigger `trg_valida_asignacion_salida_entrada` | Función `validarAsignacionSalidaEntrada_()` — ídem, incluye la comprobación de mismo artículo/almacén/lote y las dos sumas (contra la entrada y contra la salida). |
| `existencia_almacen` (saldo materializado) | `actualizarExistencia_()` se llama al final de `registrarMovimiento()`, dentro del mismo `Lock`, para que el saldo nunca quede desincronizado del Kardex — el mismo criterio de diseño que ya se documentó para Postgres en la sección 2.1 del informe original. |

**Patrón general de escritura** (todas las funciones `guardarX()` lo siguen):

```javascript
function registrarMovimiento(datos) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    validarMovimiento_(datos);              // FK + CHECK, lanza Error si algo no cuadra
    const id = siguienteId_('movimiento_inventario');
    escribirFila_('movimiento_inventario', Object.assign({movimiento_id: id}, datos));
    actualizarExistencia_(datos);           // mantiene existencia_almacen sincronizada
    return id;
  } finally {
    lock.releaseLock();
  }
}
```

---

## 4. Estructura del proyecto (`apps_script/`)

Apps Script no tiene carpetas reales dentro de un proyecto (`clasp` las aplana), así que se usa la convención estándar de prefijo numérico para fijar el orden lógico de lectura — **no** el de ejecución, que siempre depende de las llamadas entre funciones:

```
apps_script/
├── appsscript.json          # manifest: scopes, huso horario, Web App
├── .clasp.json.example      # plantilla (scriptId real nunca se versiona)
├── README.md                # pasos de instalación con clasp
└── src/
    ├── 00_Config.gs          # IDs del Sheet/carpeta Drive, encabezados de las 21 pestañas
    ├── 01_Utilidades.gs      # helpers genéricos: leer/escribir filas, siguienteId_, lock
    ├── 02_SetupSheets.gs     # crea las 21 pestañas con encabezados + validación de datos
    ├── 03_ImportarCSV.gs     # importa los CSV de dietologia_normalizado/ subidos a Drive
    ├── 10_Catalogos.gs       # CRUD de los 8 catálogos maestros
    ├── 20_Contratos.gs       # Licitación / ContratoArticulo / CupoContractualSede
    ├── 30_Programacion.gs    # ProgramacionMensual / ProgramacionDetalle / ProduccionDiaria
    ├── 40_Inventario.gs      # Lote / OrdenSuministro(+Detalle) / MovimientoInventario / Existencia
    ├── 50_Consolidacion.gs   # ConsolidacionPedido / AsignacionSalidaEntrada (los 2 triggers)
    ├── 60_Notificaciones.gs  # GmailApp: caducidad de lotes, techo contractual excedido
    ├── 70_GeneradorDocumentos.gs  # PDF del Vale de Pedido y de la Orden de Compra
    ├── 80_WebApp.gs          # doGet(), endpoints google.script.run
    ├── Index.html            # shell de la Web App
    ├── JavaScript.html       # app Vue 3 (incluido dentro de Index.html)
    └── Stylesheet.html       # Tailwind CDN + estilos propios
```

## 5. Generación de documentos: el Vale de Pedido ya existe, se reutiliza

`formato salida.html` (raíz del repo) es la exportación real de la hoja **"PEDIDO AL ALMACEN VIVERES"** que Dietología usa hoy: encabezado (Hospital, Partida Presupuestal, Unidad Hospitalaria, Fecha, Servicio), tabla `CODIGO / DESCRIPCION DEL ARTICULO / UNIDAD / CANTIDAD PEDIDA / CANTIDAD SURTIDA / OBSERVACIONES`, y pie de firmas (`JEFE DE SERVICIO DIETOLOGÍA`, `ALMACÉN DE VÍVERES`, `ENTREGADO POR`, `RECIBIDO POR`). Ese layout es exactamente el que `70_GeneradorDocumentos.gs` reproduce en `generarValePedido(areaId, fecha)`: agrupa las filas de `movimiento_inventario` (`SALIDA_CONSUMO`) de una `area_servicio`/día y llena una plantilla de Google Docs con esas columnas — no se inventó un formato nuevo, se sistematizó el que el hospital ya usa en papel/Excel.

`generarPDFOrdenCompra(ordenId)` sigue el mismo mecanismo (plantilla de Google Docs con placeholders `{{proveedor}}`, `{{fecha}}`, tabla de renglones) pero para la Orden de Compra hacia el proveedor — es un documento distinto (dirigido afuera, no al almacén interno).

Ambas funciones usan el patrón estándar de Apps Script para "mail merge" documental: duplicar una plantilla de Google Docs (`DriveApp.getFileById(idPlantilla).makeCopy(...)`), reemplazar marcadores de texto (`body.replaceText('{{marcador}}', valor)`), y exportar a PDF (`DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF)`) guardándolo en una carpeta de Drive dedicada (`Config.CARPETA_DOCUMENTOS_ID`).

## 6. Notificaciones (`GmailApp`)

Dos reglas ya definidas en el informe original se vuelven disparadores por tiempo (`Triggers → Add Trigger → time-driven, daily`):

- `alertaCaducidadLotes()` — recorre `lote`, filtra `fecha_caducidad` dentro de los próximos N días (configurable en `00_Config.gs`), agrupa por artículo y envía un correo a la lista de Dietología/Almacén.
- `alertaTechoContractual()` — recorre `cupo_contractual_sede`, detecta renglones donde `cantidad_acumulada_ejercicio` se acerca (>90%) a `cantidad_maxima_anual`, y avisa antes de que el `CHECK` equivalente bloquee un pedido.

## 7. Looker Studio

Looker Studio no hace `JOIN` cómodo entre pestañas separadas de un mismo Sheet sin el conector "BigQuery"/fórmulas auxiliares, así que en vez de conectarlo a las 21 pestañas transaccionales, `02_SetupSheets.gs` crea además un pequeño número de **pestañas de vista** (prefijo `vista_`) mantenidas con `QUERY()`/`IMPORTRANGE` o recalculadas por un trigger diario, ya aplanadas para reporte:

- `vista_consumo_diario` — `programacion_detalle` + `articulo` + `area_servicio`, una fila por día/área/artículo.
- `vista_ejecucion_contractual` — `cupo_contractual_sede` + `contrato_articulo` + `articulo` + `proveedor`, con `% ejercido` ya calculado.
- `vista_trazabilidad_oc` — la misma consulta que se probó en PostgreSQL (área → OC → proveedor → entrada → salida) resuelta con fórmulas, para el tablero de trazabilidad.

Looker Studio se conecta a esas 3 vistas (conector nativo de Google Sheets), no a las tablas transaccionales.

## 8. Puesta en marcha

Ver `apps_script/README.md` para los pasos con `clasp` (login, `clasp create`, `clasp push`), la primera ejecución de `crearEstructuraCompleta()` (pestañas) y de `importarTodosLosCSV(idCarpetaDrive)` (datos), y cómo desplegar la Web App (`Deploy → New deployment → Web app`, ejecutar como el usuario que accede, acceso restringido al dominio o a la lista de los ~10 usuarios).
