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

## 2. Mapeo de tablas a pestañas de Google Sheets (19 pestañas de datos)

El diseño de referencia en PostgreSQL (`INFORME_DISENO_BD_DIETOLOGIA.md`, `schema_dietologia.sql`) modela 21 tablas pensando en un despliegue potencialmente multi-sede. Esta herramienta es de **una sola sede** (FAA) **y un solo almacén**, así que la implementación en Apps Script simplifica deliberadamente 5 de esas tablas frente al diseño de referencia:

| Tabla del diseño de referencia | Qué pasó en Apps Script |
|---|---|
| `sede` | **Eliminada.** Es una constante (`SEDE_NOMBRE` en `00_Config.gs`), no un catálogo — con una sola sede, una tabla de 1 fila no aporta nada y sí agrega JOINs. |
| `almacen` | **Eliminada.** Un solo almacén implícito: `movimiento_inventario`/`existencia` ya no tienen `almacen_id`. |
| `cupo_contractual_sede` | **Fusionada en `contrato_articulo`.** Con una sola sede, "cupo por sede" era una tabla puente 1:1 disfrazada de N:M; `cantidad_minima_anual`/`cantidad_maxima_anual`/`cantidad_acumulada_ejercicio` ahora son columnas directas del renglón de contrato. |
| `lote` | **Eliminada como tabla; sus datos se movieron a la entrada.** El número de lote y la fecha de caducidad son un dato de la recepción, no una entidad con vida propia: `movimiento_inventario` gana `numero_lote_proveedor`/`fecha_fabricacion`/`fecha_caducidad`, obligatorios sólo cuando `tipo_movimiento='ENTRADA_COMPRA'` y el artículo tiene `requiere_control_lote=true`. Como ya no hay `lote_id`, tampoco hace falta el registro centinela que sí necesitaba el diseño de Postgres. |
| `unidad_medida` | **Eliminada como tabla.** Con ~14 valores fijos, una FK cuesta más de lo que resuelve; `articulo.unidad_medida` y `produccion_diaria.unidad_medida` son texto con lista desplegable (`UNIDADES_MEDIDA` en `00_Config.gs`), igual que ya se hacía con `tipo_movimiento` o `estatus`. |
| `orden_suministro` / `orden_suministro_detalle` | **Renombradas** a `orden_compra` / `orden_compra_detalle` (mismo contenido; era la terminología correcta del negocio). |
| `existencia_almacen` | **Renombrada** a `existencia`, con llave primaria `codigo_articulo` (antes compuesta con `almacen_id`+`lote_id`, que ya no existen). |

Las 19 pestañas de datos resultantes:

| Pestaña | Notas de adaptación |
|---|---|
| `familia`, `grupo_alimento`, `proveedor` | Catálogos; se cargan primero. |
| `articulo`, `area_servicio` | `articulo.codigo_articulo` es la clave que más se usa en validaciones cruzadas (`buscarPorClave_`); `articulo.unidad_medida` es texto, no FK. |
| `licitacion`, `contrato_articulo` | El índice único parcial de Postgres (`WHERE activo`) se reimplementa como función `existeContratoActivo_()`; el techo contractual vive en el propio renglón. |
| `orden_compra`, `orden_compra_detalle`, `movimiento_inventario`, `existencia` | Flujo operativo hacia adelante — arrancan vacías. |
| `programacion_mensual`, `programacion_detalle`, `produccion_diaria` | `programacion_detalle` se importa en lotes de 5,000 filas para no acercarse al límite de ejecución. |
| `consolidacion_pedido`, `asignacion_salida_entrada` | Arrancan vacías — es el flujo de consolidación de OC que el sistema ejecuta hacia adelante. |
| `usuarios`, `usuario_servicios`, `consolidado_general` | RBAC y ciclo de vida de captura (ver sección 8). |

`dietologia_normalizado/*.csv` (el ETL en Python) sigue teniendo la forma del diseño de 21 tablas — no se regeneró sólo para esta simplificación. `03_ImportarCSV.gs` hace la traducción al cargar: resuelve `unidad_id → texto`, fusiona el cupo de la sede **FAA únicamente** dentro de `contrato_articulo` (las demás sedes del CSV no aplican a esta herramienta) y descarta `sede_id`/`almacen_id` donde aparecían. De paso esa traducción destapó dos sinónimos de unidad de medida que el ETL de origen no había normalizado (`'FCO.'` y `'KG K'`, la misma clase de defecto que `FRASCO/FRASCOS/FCO` y `'KG   K'` ya documentados en el informe) — se normalizan ahí mismo.

Fila 1 de cada pestaña = encabezados (congelados con `setFrozenRows(1)`); `02_SetupSheets.gs` también aplica formato de fecha, y listas desplegables (`DataValidation`) en las columnas que en el DDL eran `CHECK (... IN (...))` — por ejemplo `tipo_movimiento`, `estatus` de `orden_compra`, `unidad_medida`.

---

## 3. Traducción de restricciones SQL → validación en Apps Script

| Restricción SQL (`schema_dietologia.sql`) | Equivalente en Apps Script |
|---|---|
| `PRIMARY KEY` autoincremental (`BIGSERIAL`) | `siguienteId_(nombreHoja)` — lee el máximo id actual con `LockService` tomado, único punto de generación de folios. |
| `FOREIGN KEY` | `buscarPorClave_(hoja, columnaClave, valor)`; si no encuentra la fila, la función `guardarX()` lanza `throw new Error(...)` con el mismo texto que el `RAISE EXCEPTION` original. |
| `UNIQUE` | `existeValor_(hoja, columna, valor)` antes de insertar. |
| Índice único parcial `WHERE activo` (`contrato_articulo`) | `existeContratoActivo_(licitacionId, codigoArticulo)` recorre la pestaña y verifica que ningún otro renglón tenga `activo=true` para esa combinación antes de activar uno nuevo. |
| `CHECK (cantidad_acumulada_ejercicio <= cantidad_maxima_anual)` | Se revalida en `registrarConsumoCupo_()` cada vez que se liga un `orden_compra_detalle` a su `contrato_articulo` (el techo vive en el propio renglón de contrato, ver sección 2). |
| Trigger `trg_valida_consolidacion_pedido` | Función `validarConsolidacionPedido_()` en `50_Consolidacion.gs` — mismo algoritmo, mismos mensajes de error que la función `plpgsql` original. |
| Trigger `trg_valida_asignacion_salida_entrada` | Función `validarAsignacionSalidaEntrada_()` — ídem; con un solo almacén y sin tabla de lotes aparte, sólo compara que ambos movimientos sean del mismo artículo, más las dos sumas (contra la entrada y contra la salida). |
| `existencia_almacen` (saldo materializado) | `actualizarExistencia_()` se llama al final de `registrarMovimiento()`, dentro del mismo `Lock`, para que el saldo (pestaña `existencia`, una fila por artículo) nunca quede desincronizado del Kardex. |

**Patrón general de escritura** (todas las funciones `guardarX()` lo siguen):

```javascript
function registrarMovimiento(datos) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    validarMovimiento_(datos);              // FK + CHECK, lanza Error si algo no cuadra
    const id = siguienteId_('movimiento_inventario');
    escribirFila_('movimiento_inventario', Object.assign({movimiento_id: id}, datos));
    actualizarExistencia_(datos);           // mantiene existencia sincronizada
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
    ├── 00_Config.gs          # constante SEDE_NOMBRE, encabezados de las 19 pestañas, catálogo UNIDADES_MEDIDA
    ├── 01_Utilidades.gs      # helpers genéricos: leer/escribir filas, siguienteId_, lock
    ├── 02_SetupSheets.gs     # crea las pestañas con encabezados + validación de datos
    ├── 03_ImportarCSV.gs     # importa y adapta los CSV de dietologia_normalizado/ subidos a Drive
    ├── 05_Autenticacion.gs   # whitelist + gatekeepers requiereAcceso_/requiereRol_
    ├── 10_Catalogos.gs       # CRUD de familia/grupo_alimento/proveedor/articulo/area_servicio
    ├── 11_Usuarios.gs        # CRUD de usuarios/usuario_servicios + arranque en frío
    ├── 20_Contratos.gs       # Licitación / ContratoArticulo (techo contractual incluido)
    ├── 30_Programacion.gs    # ProgramacionMensual / ProgramacionDetalle (upsert + lote) / ProduccionDiaria
    ├── 31_CicloVida.gs       # enviarCarga() / reabrirCarga()
    ├── 40_Inventario.gs      # OrdenCompra(+Detalle) / MovimientoInventario (con lote inline) / Existencia
    ├── 50_Consolidacion.gs   # ConsolidacionPedido / AsignacionSalidaEntrada (los 2 triggers)
    ├── 60_Notificaciones.gs  # GmailApp: caducidad de lotes, techo contractual excedido
    ├── 70_GeneradorDocumentos.gs  # PDF del Vale de Pedido y de la Orden de Compra
    ├── 80_WebApp.gs          # doGet(), endpoints google.script.run
    ├── 90_Vistas.gs          # pestañas vista_* para Looker Studio
    ├── Index.html            # shell de la Web App
    ├── JavaScript.html       # app Vue 3 (incluido dentro de Index.html)
    └── Stylesheet.html       # Tailwind CDN + sistema de diseño propio (estética Apple)
```

## 5. Generación de documentos: el Vale de Pedido ya existe, se reutiliza

`formato salida.html` (raíz del repo) es la exportación real de la hoja **"PEDIDO AL ALMACEN VIVERES"** que Dietología usa hoy: encabezado (Hospital, Partida Presupuestal, Unidad Hospitalaria, Fecha, Servicio), tabla `CODIGO / DESCRIPCION DEL ARTICULO / UNIDAD / CANTIDAD PEDIDA / CANTIDAD SURTIDA / OBSERVACIONES`, y pie de firmas (`JEFE DE SERVICIO DIETOLOGÍA`, `ALMACÉN DE VÍVERES`, `ENTREGADO POR`, `RECIBIDO POR`). Ese layout es exactamente el que `70_GeneradorDocumentos.gs` reproduce en `generarValePedido(areaId, fecha)`: agrupa las filas de `movimiento_inventario` (`SALIDA_CONSUMO`) de una `area_servicio`/día y llena una plantilla de Google Docs con esas columnas — no se inventó un formato nuevo, se sistematizó el que el hospital ya usa en papel/Excel.

`generarPDFOrdenCompra(ordenId)` sigue el mismo mecanismo (plantilla de Google Docs con placeholders `{{proveedor}}`, `{{fecha}}`, tabla de renglones) pero para la Orden de Compra hacia el proveedor — es un documento distinto (dirigido afuera, no al almacén interno).

Ambas funciones usan el patrón estándar de Apps Script para "mail merge" documental: duplicar una plantilla de Google Docs (`DriveApp.getFileById(idPlantilla).makeCopy(...)`), reemplazar marcadores de texto (`body.replaceText('{{marcador}}', valor)`), y exportar a PDF (`DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF)`) guardándolo en una carpeta de Drive dedicada (`Config.CARPETA_DOCUMENTOS_ID`).

## 6. Notificaciones (`GmailApp`)

Dos reglas ya definidas en el informe original se vuelven disparadores por tiempo (`Triggers → Add Trigger → time-driven, daily`):

- `alertaCaducidadLotes()` — recorre las entradas de `movimiento_inventario` (`tipo_movimiento='ENTRADA_COMPRA'`), filtra `fecha_caducidad` dentro de los próximos N días (configurable en `00_Config.gs`), agrupa por artículo y envía un correo a la lista de Dietología/Almacén. El lote ya no es una tabla aparte (ver sección 2), así que se lee directo de la entrada que lo recibió.
- `alertaTechoContractual()` — recorre `contrato_articulo`, detecta renglones donde `cantidad_acumulada_ejercicio` se acerca (>90%) a `cantidad_maxima_anual`, y avisa antes de que el `CHECK` equivalente bloquee un pedido.

## 7. Looker Studio

Looker Studio no hace `JOIN` cómodo entre pestañas separadas de un mismo Sheet sin el conector "BigQuery"/fórmulas auxiliares, así que en vez de conectarlo a las pestañas transaccionales, `02_SetupSheets.gs` crea además un pequeño número de **pestañas de vista** (prefijo `vista_`) mantenidas con `QUERY()`/`IMPORTRANGE` o recalculadas por un trigger diario, ya aplanadas para reporte:

- `vista_consumo_diario` — `programacion_detalle` + `articulo` + `area_servicio`, una fila por día/área/artículo.
- `vista_ejecucion_contractual` — `contrato_articulo` + `articulo` + `proveedor`, con `% ejercido` ya calculado (el techo vive directo en `contrato_articulo`, ver sección 2).
- `vista_trazabilidad_oc` — la misma consulta que se probó en PostgreSQL (área → OC → proveedor → entrada → salida) resuelta con fórmulas, para el tablero de trazabilidad.

Looker Studio se conecta a esas 3 vistas (conector nativo de Google Sheets), no a las tablas transaccionales.

## 8. Control de acceso: whitelist, RBAC por servicio y ciclo de vida de captura

Añadido sobre el diseño original para cumplir el documento de requerimientos de Control de Acceso (RBAC), Carga Segmentada por Servicio y Consolidación Centralizada.

### 8.1 Autenticación sin contraseña, sin riesgo de suplantación

El documento de requerimientos advierte explícitamente que pedir el correo por un campo de texto permite suplantación, y ofrece 3 estrategias. Se implementó la **Opción 1 (recomendada)** porque además es la más natural en este stack: `Session.getActiveUser().getEmail()` — la identidad nunca la escribe el usuario, la entrega la sesión de Google ya autenticada con la que abrió la Web App. Esto exige dos ajustes en `appsscript.json` sin los cuales `getActiveUser()` devuelve vacío:
- `webapp.executeAs: "USER_ACCESSING"` (cada petición corre con los permisos y la identidad de quien la hace, no del dueño del script).
- `webapp.access: "DOMAIN"` (o una lista de correos específica) — con acceso "Cualquiera", Google no expone el correo por privacidad.

`doGet()` valida la sesión contra la whitelist (`usuarios`, `activo=true`) **antes** de servir una sola línea de la interfaz; si el correo no está registrado, la respuesta es la página de "Acceso no autorizado" (el equivalente funcional al `403 Forbidden` del documento — Apps Script Web Apps no exponen códigos de estado HTTP a nivel de aplicación, así que el 403 se modela como excepción + página de rechazo).

### 8.2 Modelo de datos (RBAC & Scoping)

El documento pide 3 entidades (`usuarios`, `servicios`, `usuario_servicios`). `servicios` **no se duplicó**: es, conceptualmente, la misma entidad que `area_servicio` ya existente en el modelo (GENERAL, PACIENTES, COMEDOR, DIETOLOGIA, …) — tener dos catálogos para el mismo concepto real habría reintroducido exactamente el tipo de redundancia que el informe original (`INFORME_DISENO_BD_DIETOLOGIA.md`) identificó y eliminó. `usuario_servicios` referencia `area_servicio.area_id` directamente.

| Tabla | Corresponde a | Notas |
|---|---|---|
| `usuarios` | sección 3.1 del SRS | `rol` con lista desplegable `CAPTURISTA`/`SUPERVISOR`/`ADMINISTRADOR`. |
| `usuario_servicios` | sección 3.3 del SRS | M:N real vía `asignacion_id`; `permiso` con jerarquía `LECTURA < ESCRITURA < APROBACION` (`NIVEL_PERMISO` en `00_Config.gs`). |
| `consolidado_general` | sección 6.1 del SRS | Ver 8.4. |

### 8.3 Gatekeeper de servidor, no sólo de interfaz

El documento es explícito: "la restricción no debe ser solo visual". El gatekeeper (`requiereAcceso_(areaId, permisoMinimo)` / `requiereRol_(roles)` en `05_Autenticacion.gs`) se llama **dentro de las funciones de negocio** (`guardarProgramacionMensual`, `guardarProgramacionDetalle`, `enviarCarga`, `reabrirCarga`, `consolidarDemandaEnOC`), no sólo en los endpoints de `80_WebApp.gs` — así cualquier futuro punto de entrada que llame a esas funciones hereda la protección automáticamente, en vez de depender de que cada nuevo endpoint recuerde agregarla. El frontend, además, sólo pide (`apiListarAreasServicio`) y sólo pinta los servicios que el gatekeeper ya sabe que le corresponden al usuario — el aislamiento visual es una consecuencia del aislamiento real, no una capa aparte que pueda desincronizarse.

### 8.4 Ciclo de vida BORRADOR → ENVIADO y consolidación (Enfoque A)

Se implementó el **Enfoque A** de la sección 6.2 (tiempo real/transaccional), no el B (vista `UNION ALL`), porque en Sheets no hay un motor de consultas que mantenga una vista unida en vivo sin recalcularla por completo cada vez — el Enfoque A además es el que da trazabilidad exacta (`usuario_envio_id`, `fecha_envio`) sin ambigüedad. `programacion_mensual.estatus` sólo tiene dos valores (`BORRADOR`/`ENVIADO`): como la consolidación ocurre en el mismo paso atómico que el envío, no existe un estado `CONSOLIDADO` intermedio que pueda desincronizarse del general — `consolidado_general` es la fuente de verdad de "qué quedó consolidado".

`enviarCarga(programacionId)` (permiso `APROBACION`) escribe en `consolidado_general` dentro del mismo `LockService` que cambia el estatus. `guardarProgramacionDetalle` rechaza cualquier escritura si `estatus != 'BORRADOR'`. `reabrirCarga(programacionId)` (exclusivo `ADMINISTRADOR`) regresa el estatus a `BORRADOR` y **purga** las filas de esa programación en `consolidado_general` — es el "recálculo automático" que pide el documento: la siguiente vez que se envíe, se vuelven a escribir.

El motor de consolidación de demanda en Órdenes de Compra (`consolidarDemandaEnOC`, ya existente desde antes de este SRS) se conectó a este nuevo ciclo de vida: ahora lee de `consolidado_general` en vez de `programacion_detalle` directamente, así que Compras **sólo puede convertir en OC demanda que los servicios ya enviaron formalmente**, nunca un borrador a medio capturar. Es además una acción exclusiva de `ADMINISTRADOR` (cruza servicios, no tiene un único "dueño").

## 9. UX de captura de alta densidad: qué se adaptó del documento de Frontend y qué no

Se recibió un segundo documento de requerimientos pidiendo React 18+/Next.js/Vite+TypeScript, Zustand/Jotai, `@tanstack/react-virtual`, shadcn/ui y una API REST (`PUT /api/programacion/batch-update`) para una matriz de captura de alta densidad. **Ese stack es incompatible con Apps Script** (`HtmlService` no tiene paso de build/bundler; el patrón nativo de comunicación es `google.script.run`, no `fetch` a rutas REST) y resuelve un problema de escala — 60 FPS con decenas de miles de celdas virtualizadas — que no existe a los volúmenes reales de este proyecto (≈235 artículos × 31 días ≈ 7,285 celdas, ~10 usuarios). Se optó por adaptar el **espíritu** de ese documento (UX de captura tipo hoja de cálculo) dentro del Vue 3 + Tailwind por CDN ya existente, sin librerías nuevas:

| Pedido del documento | Adaptación implementada (`JavaScript.html`) |
|---|---|
| 2.1 Navegación por teclado | `onKeydownCelda`: flechas mueven el foco entre celdas (`moverFoco`, por `data-codigo`/`data-dia`), `Enter` confirma y baja una fila, `Tab` usa el orden natural del DOM (ya es "siguiente día"), `Escape` revierte al valor que tenía la celda al enfocarla (`iniciarEdicion`). |
| 2.2 Pegado desde Excel | `onPasteCelda`: intercepta `Ctrl+V`, separa el texto por `\n`/`\t` y mapea cada celda pegada a (artículo visible siguiente, día siguiente) a partir de la celda con foco, recortando lo que exceda el mes o las filas visibles. Probado de forma aislada (5 casos: bloque 2×3, recorte de límites, celda única, valores no numéricos, coma decimal). |
| 2.3 Command Palette (Ctrl+K) | Modal de búsqueda global sobre `articulos` (todo el catálogo, no sólo lo visible) por código o descripción; al elegir un resultado, lo agrega a la tabla si no estaba y hace scroll + resaltado temporal (`filaResaltada`). |
| 3. Freeze panes | Panel izquierdo (`col-fija-izq`, código+descripción con `title` como tooltip) y panel derecho (`col-fija-der`: total/semáforo/tendencia) con `position: sticky`; encabezado de cada día con su letra de día de la semana y sombreado sutil en fines de semana (`dia-finde`). Se implementó como **una sola** columna derecha compuesta en vez de 3 columnas `sticky` independientes (offsets múltiples de `sticky right` son frágiles sin un layout engine) — mismo contenido, más robusto sin build step. |
| 4.1 Semáforo de techo presupuestal | Nuevo endpoint `apiObtenerCuposArticulos` (→ `obtenerCuposArticulos_()` en `20_Contratos.gs`, que ahora lee directo de `contrato_articulo` — una sola sede, ver sección 2) trae `cantidad_acumulada_ejercicio`/`cantidad_maxima_anual` por artículo; la barra de 3px usa las mismas franjas verde ≤75% / ámbar 76-95% / rojo >95% con animación de pulso vía CSS. |
| 4.2 Sparklines | `sparklinePoints(codigo)`: SVG `<polyline>` de 56×14px generado en el cliente a partir de `detalle`, sin librería de gráficas. |
| 4.3 Sticky Summary Bar | Barra superior con unidades y presupuesto programado, recalculada en vivo (`totalUnidadesVivo`/`totalImporteVivo`); el precio unitario viaja ahora en `apiListarArticulos` (tomado del renglón de contrato activo). |
| 5. Offline-first / debounce | `encolarCambio` acumula cambios en un `Map` local y dispara `flushCola()` a los 400ms de inactividad (se reinicia con cada tecla); el guardado optimista ya lo daba `v-model` (la celda se ve actualizada al instante). En el servidor, `guardarLoteProgramacionDetalle` valida y escribe todo el lote bajo **un solo** `LockService` y una sola lectura de la pestaña, en vez de una operación por celda — la versión "PUT batch-update" del documento, hecha con `google.script.run` en vez de REST. Indicador 🟢/🟡/🔴 (`estadoSync`) igual que el documento pide. |
| 6.1 Pre-Flight Validation Modal | Antes de enviar, un modal (`modalEnviarAbierto`/`resumenPreEnvio`) resume artículos con demanda, unidades, presupuesto estimado, y lista los insumos que ya superaron 90% de su cupo — usando el mismo semáforo del punto 4.1 — antes de pedir confirmación explícita. |
| 6.2 Bloqueo visual | El badge cambia a "Carga Enviada y Bloqueada", las celdas quedan `disabled` (estilo atenuado ya existente de la iteración anterior) y el botón cambia a "Descargar PDF / Vale". |

**No se implementó** (porque depende de infraestructura fuera de Apps Script y no aporta a la escala real del proyecto): virtualización de filas/columnas con librería (`@tanstack/react-virtual`), estado atómico tipo Zustand/Jotai, ni una API REST — con ~235 filas visibles como máximo, el DOM de un navegador moderno las renderiza sin virtualizar.

### 9.1 Identidad visual: estética Apple (macOS / iOS)

Rediseño completo de `Stylesheet.html`, sin librerías nuevas: tipografía del sistema (`-apple-system, BlinkMacSystemFont, "SF Pro Display"...`, no una fuente web cargada aparte), **fondo blanco** con tarjetas delimitadas por borde de 1px + sombra difusa muy sutil (nunca un gris de lienzo ni sombras duras), esquinas de 12–16px, control segmentado tipo iOS para las pestañas (en vez de tabs subrayados), botones con forma de píldora y un solo azul de acento (`#0071e3`) reservado para las acciones primarias, colores semánticos de sistema (verde `#34c759`/ámbar `#ff9f0a`/rojo `#ff3b30`) para estados y el semáforo de techo, iconografía SVG en línea de trazo fino (1.7px, sin relleno) en vez de emoji, y una barra de resumen flotante con efecto vidrio (`backdrop-filter: blur`) al estilo de las barras de herramientas de macOS. Los tokens de color/radio/sombra quedan como variables CSS (`:root { --color-acento: ...}`) en la parte superior de `Stylesheet.html` para que cualquier ajuste de marca se haga en un solo lugar.

## 10. Puesta en marcha

Ver `apps_script/README.md` para los pasos con `clasp` (login, `clasp create`, `clasp push`), la primera ejecución de `crearEstructuraCompleta()` (pestañas) y de `importarTodosLosCSV(idCarpetaDrive)` (datos), y cómo desplegar la Web App (`Deploy → New deployment → Web app`, ejecutar como el usuario que accede, acceso restringido al dominio o a la lista de los ~10 usuarios).
