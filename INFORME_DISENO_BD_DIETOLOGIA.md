# Informe Técnico: Diseño de la Capa de Datos — Sistema de Gestión de Inventarios, Suministros y Almacenes de Dietología y Nutrición

**Sector:** Salud pública, Jalisco (OPD / Hospital Civil de Guadalajara)
**Fuentes auditadas:**
1. `licitacion.csv` / hoja `LPL472026` del libro adjunto — Fallo de la Licitación Pública Local **LPL47/2026**, Partida presupuestal **2212** (348 renglones útiles, 36 columnas).
2. `PROGRAMACION_OCTUBRE_26.xlsx` — libro operativo de programación mensual de pedidos de Dietología, **11 hojas**: `GENERAL`, `RECEPCIÓN`, `PACIENTES`, `COMEDOR`, `JORNADA`, `DIETOLOGÍA(S)`, `BANCO DE LECHE`, `TORTILLAS`, `NUTRICIÓN CLÍNICA`, `PAN`, `LPL472026` (copia embebida del contrato).
3. `datos_licitacion.md` — perfilado técnico preexistente sobre la fuente (1), tomado como insumo y ampliado en este informe con el perfilado íntegro del libro operativo (2), que no había sido auditado.

Metodología: perfilado programático (Python/openpyxl) sobre el 100% de filas y columnas de ambas fuentes — sin muestreo ni datos sintéticos. Todas las cifras citadas provienen de conteos ejecutados directamente sobre los archivos adjuntos.

---

## 1. Resumen Ejecutivo y Diagnóstico de Calidad de Datos

### 1.1 Panorama general

El sistema actual opera sobre **dos fuentes de verdad desacopladas y parcialmente contradictorias**:

- El **contrato de suministro** (`LPL472026`): define qué artículos existen, quién los provee, a qué precio y con qué techo contractual por sede (FAA, JIM, ORI, OPD).
- La **programación operativa** (`PROGRAMACION_OCTUBRE_26.xlsx`): un catálogo maestro de 386 artículos comestibles, replicado íntegramente en 8 hojas distintas (una por área de consumo), con una matriz de 31 columnas (un día de octubre por columna) más una columna `TOTAL` calculada.

Ninguna de las dos fuentes es autoritativa sobre la otra: **67 de los 386 artículos programables (17.4%)** no tienen ningún renglón vigente en el contrato LPL47/2026, y las unidades de medida del mismo código de artículo difieren entre hojas del propio libro de programación. Esta desconexión es la causa raíz de los errores de asignación, sobrecosto y doble captura descritos abajo.

### 1.2 Anomalías detectadas en el contrato (`licitacion.csv` / `LPL472026`)

*(Perfilado exhaustivo ya documentado en `datos_licitacion.md`; se resume y se referencia como insumo normativo de este diseño.)*

| Categoría | Hallazgo | Magnitud |
|---|---|---|
| Formato/tipado | Encabezados con espacios parásitos (`' COSTO '`, `' MIN TOTAL '`, `' MAX TOTAL '`) | 3 columnas |
| Formato/tipado | Campos monetarios importados como texto (`$`, comas de miles) | `COSTO`, `MIN TOTAL`, `MAX TOTAL` |
| Formato/tipado | Fila 350 = totalizador manual de texto, no es un registro | 1 fila contaminante |
| Unicidad | Colisión de clave primaria `CODIGO` = `2212001066` (2 proveedores distintos, mismo costo y cuota) | 1 código, 2 renglones |
| Unicidad | Homonimia: `ZARZAMORA CONGELADA` con 2 códigos, 2 familias, dispersión de precio de 212% | 2 códigos |
| Completitud | `COMENTARIOS` 100% nulo; `OBSERVACIONES` 98.28% nulo; `AUTORIZA` 35.63% nulo | 3 columnas críticas |
| Consistencia | `PRESENTACION` con sinónimos no normalizados (`FRASCO`/`FRASCOS`/`FCO`) y errores de captura (`'KG   K'`, `'Pza 8 GS'`) | 17 valores distintos para ~10 unidades reales |
| Redundancia | 10 columnas calculadas (`MIN/MAX <sede>`, `MIN/MAX TOTAL`) son 100% derivables de `Cantidad × COSTO` | Antipatrón transaccional |
| Varianza cero | `PARTIDA`, `LICITACION`, `ACREDITA`, `ACREDITA2`, `COMENTARIOS` son constantes | 5 columnas sin poder discriminante |

### 1.3 Anomalías detectadas en el libro de programación (`PROGRAMACION_OCTUBRE_26.xlsx`) — hallazgos nuevos de este informe

| # | Hoja(s) afectada(s) | Anomalía | Evidencia cuantificada |
|---|---|---|---|
| P1 | `GENERAL`, `RECEPCIÓN`, `PACIENTES`, `COMEDOR`, `JORNADA`, `DIETOLOGÍA(S)`, `BANCO DE LECHE`, `NUTRICIÓN CLÍNICA` | **Repetición íntegra del catálogo maestro** (código, descripción, unidad de medida) en 8 hojas independientes, en vez de referenciarlo una sola vez. Viola 2FN/3FN: cualquier corrección de nombre o unidad debe replicarse manualmente 8 veces. | 386+386+369+369+370+370+16+14 = **2,280 filas de catálogo redundantes**, correspondientes a 386 artículos únicos reales. |
| P2 | Todas las hojas de catálogo | **Diseño en formato ancho (pivotado)**: un día de octubre = una columna (`1`…`31`). Viola 1FN (grupo repetitivo). Cualquier consulta por rango de fechas requiere `UNPIVOT` manual. | 31 columnas de día × 8 hojas. |
| P3 | Todas las hojas de catálogo | **Columna `TOTAL` 100% redundante**: se verificó que `TOTAL = SUM(día 1..31)` sin una sola discrepancia en los 2,280 renglones evaluados. Antipatrón idéntico al de `MIN/MAX TOTAL` del contrato. | 0 discrepancias / 2,280 filas → redundancia perfecta y por tanto 100% eliminable. |
| P4 | `RECEPCIÓN` | Hoja **100% vacía** (11,966 celdas de día en `None`, cero valores capturados) pese a existir la estructura completa de 386 artículos. Es una plantilla sin uso operativo real o un flujo de captura pendiente de implementar. | 386 filas × 31 días = 11,966 celdas nulas. |
| P5 | `GENERAL`, `RECEPCIÓN` | El encabezado de la columna de clave del artículo está **vacío** (`None`), mientras que en `PACIENTES`, `COMEDOR`, `JORNADA`, `DIETOLOGÍA(S)`, `BANCO DE LECHE`, `NUTRICIÓN CLÍNICA` sí dice `CÓDIGO`. Inconsistencia de metadatos entre hojas estructuralmente idénticas. | 2 de 8 hojas |
| P6 | `PACIENTES`, fila 384 | **Tipo de dato mixto en la clave de negocio**: el código `2212008048` se almacena como **cadena de texto** (`'2212008048'`), mientras el resto de los 2,279 códigos restantes son numéricos. Rompe cualquier `JOIN`/comparación directa. | 1 de 2,280 registros |
| P7 | `JORNADA`, fila 31, columna día 1 | Celda numérica de cantidad almacenada como **texto** (`'0'`) en vez de `0` numérico. | 1 celda puntual, pero indica ausencia de validación de tipo en captura. |
| P8 | `BANCO DE LECHE` vs. resto de hojas | **Inconsistencia de unidad de medida para el mismo código de artículo**: `2212012004` (Fórmula líquida para prematuros) aparece con unidad `FRASCOS` en el resto del libro y `FCO` en `BANCO DE LECHE`. | 1 código detectado; confirma el mismo patrón de sinónimos ya visto en `PRESENTACION` del contrato. |
| P9 | `GENERAL`/`RECEPCIÓN` (13 grupos), `PACIENTES` (11), `COMEDOR`/`JORNADA`/`DIETOLOGÍA(S)` (12) | **Taxonomía de "GRUPO DE ALIMENTO" aplicada de forma inconsistente entre hojas** (p. ej. `VERDURA` está presente en unas hojas y ausente en otras para el mismo universo de artículos). Además, esta taxonomía de grupos (13 valores como `FRUTA`, `CERDO`, `RES`, `POLLO`…) **no coincide en granularidad** con la columna `FAMILIA` del contrato (22 valores presupuestales, p. ej. `'14 Res y Cerdo'` fusiona lo que en programación son dos grupos separados `CERDO` y `RES`). | 22 familias contractuales vs. 13 grupos operativos, relación N:1 no explicitada. |
| P10 | `GENERAL`/`RECEPCIÓN` (67), `PACIENTES`/`COMEDOR`/`JORNADA`/`DIETOLOGÍA(S)` (53), `BANCO DE LECHE` (14 de 16 = 87.5%), `NUTRICIÓN CLÍNICA` (1 de 14) | **Ruptura de integridad referencial implícita**: códigos de artículo programables que **no existen** en ningún renglón del contrato vigente `LPL472026` (347 códigos únicos contractuales vs. 386 códigos del catálogo de programación). Se trata típicamente de artículos estacionales o de partidas anteriores (`TEJOCOTE`, `GRANADA ROJA`, `ROSCA DE REYES...`, `TERNERA CON HUESO`, `CAMARON SECO`, etc.) que hoy pueden capturarse en la programación sin que exista respaldo contractual para surtirlos. | Hasta 87.5% de huérfanos en `BANCO DE LECHE`. |
| P11 | `TORTILLAS`, `PAN` | **No atomicidad severa**: celdas de texto libre que combinan múltiples productos, cantidades y unidades en un solo campo, p. ej. `"bolillo mini con sal 150 piezas totopo 15 kg"` o `"galleta salada 2 cajas"`. Encabezados en 3 niveles (`N° VIAJE` / `DIETAS·COMEDOR·JORNADA` / día) sin clave de artículo. Imposible de vincular al catálogo maestro sin reestructuración total. | 2 hojas completas, ~460 filas de captura libre. |
| P12 | `DESCRIPCION` (contrato) y `DESCRIPCIÓN` (programación) | Inconsistencias de captura por mayúsculas/minúsculas mezcladas dentro del mismo campo (`"QUESO ADOBERA OREADO pasteurizado"`), señal de ausencia de estandarización en el origen. | Puntual, pero sistemático en ambas fuentes. |

### 1.4 Síntesis de impacto operativo

Estas anomalías se traducen en tres riesgos concretos para el negocio:

1. **Riesgo de sobregiro contractual**: al no existir un techo por sede consultable en una sola fuente normalizada, Dietología puede solicitar cantidades que ya rebasaron el máximo anual pactado (hallazgo P10 agrava esto: 53–87.5% de los artículos programables por área ni siquiera tienen techo contractual definido).
2. **Riesgo de sobrecosto por ambigüedad de catálogo**: la homonimia de `ZARZAMORA CONGELADA` (212% de dispersión de precio) puede repetirse en cualquier código que Dietología seleccione manualmente sin unicidad garantizada.
3. **Riesgo de inconsistencia de reportes**: columnas calculadas (`TOTAL`, `MIN/MAX TOTAL`) almacenadas en vez de derivadas generan desincronización si alguien edita una celda manualmente, como ya advierte `datos_licitacion.md`.

---

## 2. Estrategia de Normalización y Arquitectura Relacional

### 2.1 Principios de diseño

1. **Una sola fuente de verdad por concepto de negocio**: el catálogo de artículos, proveedores, unidades de medida y familias/grupos de alimento se modelan una única vez (elimina P1, P8, P9, P12 y la homonimia del contrato).
2. **1FN estricta — sin grupos repetitivos**: las 31 columnas de día y las 8+ columnas de sede/techo se despivotan en filas (elimina P2 y las columnas `MINIMO/MAXIMO <sede>` del contrato).
3. **Eliminación de campos derivados almacenados**: `TOTAL`, `MIN TOTAL`, `MAX TOTAL` y los 8 campos `MIN/MAX <sede>` del contrato **no se materializan**; se calculan con `SUM()`/vistas cuando se necesiten (elimina P3 y la dependencia funcional transitiva documentada en `datos_licitacion.md`, sección 3).
4. **Separación explícita de "catálogo posible" vs. "vigencia contractual"**: el hallazgo P10 exige modelar el universo de artículos (`articulo`) como superconjunto independiente del contrato activo (`contrato_articulo`), de forma que un artículo pueda existir en el catálogo aunque hoy no tenga proveedor adjudicado — y que el sistema pueda **bloquear pedidos** contra artículos sin contrato vigente (regla *poka-yoke* ya prevista en `datos_licitacion.md`, sección 6).
5. **Jerarquía de clasificación de dos niveles** para resolver P9: `familia` (22 valores, nivel presupuestal/contractual, ligado a `PARTIDA`) → `grupo_alimento` (nivel operativo usado en la programación, ej. `CERDO`, `RES`) en relación N:1 hacia `familia`.
6. **Trazabilidad por lote como eje central del control de perecederos**: aunque las fuentes no traían un campo de lote/caducidad explícito, es un requisito de negocio no negociable en dietología hospitalaria (riesgo sanitario). Se modela `lote` como entidad independiente vinculada a `articulo`, con un registro centinela `lote_id = 0` ("SIN LOTE") para artículos no perecederos que no requieren este control — evitando así valores nulos dentro de la llave compuesta de existencias.
7. **Separación de jerarquía física**: `sede` (unidad hospitalaria: FAA/JIM/ORI/OPD, nivel contractual) es distinta de `almacen` (ubicación física: central vs. periférico/cocina, nivel logístico) y de `area_servicio` (punto de consumo/programación: `PACIENTES`, `COMEDOR`, `JORNADA`, `DIETOLOGÍA`, `BANCO DE LECHE`, `NUTRICIÓN CLÍNICA`, `TORTILLERIA`, `PANADERIA` — que corresponden 1:1 a las hojas operativas del libro Excel). Esta separación permite que una sede tenga múltiples almacenes y que un almacén sirva a múltiples áreas de consumo.
8. **Tipado consistente de claves de negocio**: `codigo_articulo` y `proveedor_id` se tipifican como `VARCHAR` desde el diseño (nunca `INT`), anticipando proveedores alfanuméricos como `A4684` y evitando la colisión de tipo detectada en P6.

### 2.2 Listado de entidades del modelo (21 tablas, 3FN)

**Catálogos maestros (sin dependencias, 1:N hacia el resto):**
1. `unidad_medida` — catálogo único de unidades (resuelve la heterogeneidad de `PRESENTACION`/`UNIDAD DE MEDIDA`: KG, PIEZA, LITRO, CAJA, PAQUETE, FRASCO, BOTE, GALÓN, BIDÓN, SOBRE, BOLSA, MANOJO, LATA).
2. `familia` — 22 familias presupuestales (columna `FAMILIA` del contrato).
3. `grupo_alimento` — subgrupo operativo (N:1 hacia `familia`), con bandera `es_perecedero`.
4. `proveedor`.
5. `sede` — FAA, JIM, ORI, OPD.

**Catálogo de artículos y estructura física (1:N desde los maestros):**
6. `articulo` (FK → `grupo_alimento`, `unidad_medida`).
7. `almacen` (FK → `sede`; tipo `CENTRAL`/`PERIFERICO`/`COCINA`).
8. `area_servicio` (FK opcional → `almacen`; corresponde a las hojas del libro de programación).

**Dominio contractual (N:M artículo↔proveedor↔sede vía tablas puente):**
9. `licitacion`.
10. `contrato_articulo` (tabla puente `articulo` × `proveedor` × `licitacion`, cardinalidad N:M resuelta).
11. `cupo_contractual_sede` (tabla puente `contrato_articulo` × `sede`, N:M; sustituye las 10 columnas `MINIMO/MAXIMO <sede>`/`TOTAL`).

**Dominio de inventario y trazabilidad (control de lotes/caducidad):**
12. `lote` (FK → `articulo`, `proveedor`).
13. `orden_suministro` (encabezado de pedido; FK → `proveedor`, `sede`).
14. `orden_suministro_detalle` (FK → `orden_suministro`, `contrato_articulo`).
15. `movimiento_inventario` (Kardex; FK → `almacen`, `articulo`, `lote`, `orden_suministro_detalle`, `programacion_detalle` opcional).
16. `existencia_almacen` (saldo vigente por almacén/artículo/lote; mantenida por los movimientos).

**Dominio de programación y producción operativa (sustituye la matriz de días):**
17. `programacion_mensual` (encabezado; FK → `area_servicio`).
18. `programacion_detalle` (FK → `programacion_mensual`, `articulo`; una fila por día, sustituye las 31 columnas y la columna `TOTAL`).
19. `produccion_diaria` (FK → `area_servicio`, `articulo` opcional; sustituye las hojas de texto libre `TORTILLAS`/`PAN`).

**Dominio de consolidación de pedidos y trazabilidad demanda↔entrada↔salida (nuevo, ver 2.4):**
20. `consolidacion_pedido` (tabla puente `programacion_detalle` × `orden_suministro_detalle`, N:M; registra qué renglones de demanda por área se agregaron en cada renglón de Orden de Compra).
21. `asignacion_salida_entrada` (tabla puente `movimiento_inventario` salida × `movimiento_inventario` entrada, N:M; registra con qué recepción(es) se surtió cada entrega a un área).

*(21 tablas en total; ver DDL para el detalle completo.)*

### 2.3 Justificación de cardinalidades clave

| Relación | Cardinalidad | Justificación |
|---|---|---|
| `proveedor` → `contrato_articulo` | 1:N | Un proveedor puede tener adjudicados muchos renglones de artículo; un renglón de contrato pertenece a un único proveedor (confirmado en `datos_licitacion.md`: `PROVEEDOR → CODIGO` es 1:N salvo la anomalía `2212001066`, que este modelo resuelve con `UNIQUE(licitacion_id, codigo_articulo, proveedor_id)` + índice único parcial sobre el renglón `activo`). |
| `articulo` → `contrato_articulo` | 1:N | Un artículo del catálogo maestro puede ser licitado por 0 (huérfano, hallazgo P10), 1 o varias veces a lo largo de distintas licitaciones históricas. |
| `contrato_articulo` × `sede` → `cupo_contractual_sede` | N:M | Cada renglón de contrato define un techo distinto por cada una de las 4 sedes (columnas anchas `MINIMO/MAXIMO FAA/JIM/ORI/OPD` del origen); se despivota a una fila por combinación. |
| `articulo` → `lote` | 1:N | Cada artículo perecedero puede tener múltiples lotes activos simultáneamente (distintas fechas de caducidad/recepción), requisito explícito de trazabilidad sanitaria. |
| `almacen` × `articulo` × `lote` → `existencia_almacen` | N:M (vía tabla de saldos) | Un mismo artículo puede tener existencia en varios almacenes y en varios lotes distintos dentro del mismo almacén. |
| `area_servicio` → `programacion_mensual` | 1:N | Cada área de consumo (hoja del libro operativo) genera una programación mensual propia, una vez por mes/año (`UNIQUE(area_id, anio, mes)`). |
| `programacion_mensual` → `programacion_detalle` | 1:N | Un encabezado de programación contiene una fila por artículo y por día calendario del mes (despivote de las 31 columnas de día). |
| `programacion_detalle` × `orden_suministro_detalle` → `consolidacion_pedido` | N:M | Varias filas de demanda (distintas áreas, distintos días) se agregan hacia uno o más renglones de Orden de Compra; en el caso general una sola OC concentra la demanda de todo el periodo. |
| `movimiento_inventario` (salida) × `movimiento_inventario` (entrada) → `asignacion_salida_entrada` | N:M | Una entrada puede repartirse entre varias salidas y, si un lote se agota a media entrega, una salida puede cubrirse con más de una entrada. |

### 2.4 Consolidación de pedidos en Órdenes de Compra y trazabilidad entrada↔salida

Este es el mecanismo que faltaba para cerrar el ciclo completo **demanda → compra → almacén → entrega**, y responde directamente a la necesidad operativa planteada: varias áreas piden el mismo artículo por separado (`programacion_detalle`), Compras consolida esa demanda por proveedor y genera una sola Orden de Compra, Almacén recibe una sola entrada física, y esa entrada se reparte de vuelta hacia las áreas que la pidieron. Sin esta capa, la Orden de Compra, la entrada de almacén y las salidas a Dietología quedarían como hechos aislados, exactamente como ocurre hoy en el Excel de origen (no hay ninguna columna que ligue una recepción con la programación que la originó).

**Ejemplo de trazabilidad extremo a extremo** (el mismo que motivó este cambio: 10 kg para `PACIENTES` + 10 kg para `COMEDOR` del mismo artículo y proveedor):

```
programacion_detalle (PACIENTES, art. X, 10 kg) ──┐
                                                    ├──> consolidacion_pedido ──> orden_suministro_detalle (20 kg) ──> orden_suministro (OC, proveedor Y)
programacion_detalle (COMEDOR,   art. X, 10 kg) ──┘                                        │
                                                                                            ▼
                                                                      movimiento_inventario ENTRADA_COMPRA (20 kg, orden_detalle_id, lote_id)
                                                                                            │
                                                                          asignacion_salida_entrada (reparte la entrada)
                                                                                ┌───────────┴───────────┐
                                                                                ▼                       ▼
                                                    movimiento_inventario SALIDA_CONSUMO       movimiento_inventario SALIDA_CONSUMO
                                                    (10 kg, almacén→PACIENTES,                  (10 kg, almacén→COMEDOR,
                                                     programacion_detalle_id = PACIENTES)         programacion_detalle_id = COMEDOR)
```

1. **Consolidación (demanda → OC):** `consolidacion_pedido` vincula cada renglón de `programacion_detalle` con el renglón de `orden_suministro_detalle` que lo agregó. La cantidad de la OC (`cantidad_solicitada`) es la suma de las consolidaciones que la respaldan; un trigger (`trg_valida_consolidacion_pedido`, ver DDL) impide consolidar hacia un artículo distinto al programado y evita que la suma consolidada exceda lo que la OC declara.
2. **Entrada (OC → almacén):** ya existente en el modelo — `movimiento_inventario` con `tipo_movimiento='ENTRADA_COMPRA'` y `orden_detalle_id` apuntando al renglón de OC recién surtido; los 20 kg entran en un único `lote`.
3. **Salida (almacén → Dietología/área):** cada entrega a un área se registra como `movimiento_inventario` con `tipo_movimiento='SALIDA_CONSUMO'`, y ahora incluye `programacion_detalle_id` (columna nueva) para saber **a qué solicitud de área** corresponde esa entrega.
4. **Asignación (qué entrada cubrió qué salida):** `asignacion_salida_entrada` liga cada salida con la o las entradas de donde salió físicamente la mercancía. Un trigger (`trg_valida_asignacion_salida_entrada`) obliga a que ambos movimientos sean del mismo artículo/almacén/lote y a que ninguna suma de asignaciones exceda la cantidad real de la entrada ni de la salida — es decir, impide por diseño que de una entrada de 20 kg se "repartan" 25 kg entre las salidas.

Con esto, una pregunta como *"¿de qué proveedor y de qué Orden de Compra vinieron los 10 kg que Dietología entregó a Comedor el día 14?"* se resuelve con un solo recorrido de llaves foráneas, sin reconciliar hojas de Excel a mano.

---

## 3. Diccionario de Datos Estructurado

> Convenciones: `PK` = llave primaria, `FK` = llave foránea, `NN` = `NOT NULL`. Todas las tablas residen en el esquema `dietologia`.

### 3.1 `unidad_medida`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| unidad_id | SMALLSERIAL | PK | No | — | Identificador interno. |
| clave | VARCHAR(10) | — | No | `UNIQUE` | Clave corta normalizada (`KG`, `PZA`, `LT`, `CJA`, `PAQ`, `FRAS`, `BOTE`, `GAL`, `BID`, `SOB`, `BOL`, `MJO`, `LATA`). Resuelve sinónimos `FRASCO/FRASCOS/FCO`. |
| nombre | VARCHAR(40) | — | No | — | Nombre descriptivo completo. |
| tipo_medida | VARCHAR(10) | — | No | `CHECK IN ('PESO','VOLUMEN','PIEZA','PAQUETE')` | Clasifica la unidad para validaciones de conversión futura. |

### 3.2 `familia`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| familia_id | SMALLSERIAL | PK | No | — | Identificador interno. |
| clave_presupuestal | VARCHAR(5) | — | No | `UNIQUE` | Número de la familia contractual (`'1'`…`'22'`, columna `FAMILIA` del contrato). |
| nombre | VARCHAR(60) | — | No | `UNIQUE` | Nombre de familia (ej. `'Res y Cerdo'`). |

### 3.3 `grupo_alimento`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| grupo_id | SMALLSERIAL | PK | No | — | Identificador interno. |
| familia_id | SMALLINT | FK → `familia` | No | — | Familia presupuestal a la que pertenece (resuelve la relación N:1 del hallazgo P9). |
| nombre | VARCHAR(60) | — | No | `UNIQUE` | Nombre del grupo operativo usado en la programación (`FRUTA`, `VERDURA`, `CERDO`, `RES`, `POLLO`, `PESCADOS Y MARISCOS`, `EMBUTIDOS`, `LÁCTEOS`, `CEREALES`, `SECOS`, `CONGELADOS`, `ENLATADOS Y PROCESADOS`, `NUTRICIONAL`, …). |
| es_perecedero | BOOLEAN | — | No | `DEFAULT TRUE` | Determina si los artículos del grupo exigen control de lote/caducidad. |

### 3.4 `proveedor`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| proveedor_id | VARCHAR(10) | PK | No | — | Clave alfanumérica de proveedor (`'3269'`, `'A4684'`), tipada como texto para evitar la colisión de tipo del hallazgo P6. |
| razon_social | VARCHAR(150) | — | No | — | Nombre/razón social. |
| activo | BOOLEAN | — | No | `DEFAULT TRUE` | Vigencia administrativa del proveedor. |

### 3.5 `sede`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| sede_id | VARCHAR(5) | PK | No | — | `'FAA'`, `'JIM'`, `'ORI'`, `'OPD'`. |
| nombre_sede | VARCHAR(120) | — | No | — | Nombre completo de la unidad hospitalaria u oficina. |
| tipo_sede | VARCHAR(20) | — | No | `CHECK IN ('HOSPITAL','OFICINA_CENTRAL')` | Distingue hospitales de oficinas administrativas (OPD). |

### 3.6 `articulo`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| codigo_articulo | VARCHAR(15) | PK | No | — | Clave HCG del insumo (ej. `'2212001066'`), tipada como texto para preservar ceros a la izquierda. |
| descripcion | VARCHAR(255) | — | No | — | Nombre/especificación del artículo, normalizada a mayúsculas en la carga (resuelve P12). |
| grupo_id | SMALLINT | FK → `grupo_alimento` | No | — | Clasificación operativa. |
| unidad_id | SMALLINT | FK → `unidad_medida` | No | — | Unidad de medida base del artículo, única fuente de verdad (resuelve P8). |
| requiere_control_lote | BOOLEAN | — | No | `DEFAULT TRUE` | Determina si los movimientos de este artículo exigen `lote_id` real (distinto del centinela). |
| activo | BOOLEAN | — | No | `DEFAULT TRUE` | Permite dar de baja artículos obsoletos sin borrarlos (integridad histórica). |
| fecha_alta | DATE | — | No | `DEFAULT CURRENT_DATE` | Auditoría de alta en el catálogo maestro. |

### 3.7 `almacen`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| almacen_id | SERIAL | PK | No | — | Identificador interno. |
| sede_id | VARCHAR(5) | FK → `sede` | No | — | Sede a la que pertenece físicamente. |
| clave_almacen | VARCHAR(10) | — | No | `UNIQUE (sede_id, clave_almacen)` | Clave corta del almacén dentro de la sede. |
| nombre | VARCHAR(120) | — | No | — | Nombre descriptivo. |
| tipo_almacen | VARCHAR(15) | — | No | `CHECK IN ('CENTRAL','PERIFERICO','COCINA')` | Distingue almacén central de almacenes periféricos/cocinas, requisito explícito del negocio. |

### 3.8 `area_servicio`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| area_id | SMALLSERIAL | PK | No | — | Identificador interno. |
| clave | VARCHAR(30) | — | No | `UNIQUE` | Corresponde 1:1 a cada hoja operativa: `GENERAL`, `PACIENTES`, `COMEDOR`, `JORNADA`, `DIETOLOGIA`, `BANCO_LECHE`, `NUTRICION_CLINICA`, `TORTILLERIA`, `PANADERIA`, `RECEPCION`. |
| nombre | VARCHAR(80) | — | No | — | Nombre para interfaz. |
| almacen_id | INT | FK → `almacen` | Sí | — | Almacén/cocina que surte a esta área (opcional; `RECEPCIÓN` puede no tener almacén asociado — hallazgo P4). |
| activo | BOOLEAN | — | No | `DEFAULT TRUE` | Permite desactivar áreas sin datos reales (ver P4: `RECEPCIÓN` 100% vacía). |

### 3.9 `licitacion`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| licitacion_id | VARCHAR(20) | PK | No | — | `'LPL47/2026'`. |
| partida | INT | — | No | `CHECK (partida > 0)` | Partida presupuestal (`2212`). |
| ejercicio_fiscal | SMALLINT | — | No | `CHECK (ejercicio_fiscal BETWEEN 2000 AND 2100)` | Año fiscal del contrato. |
| estatus | VARCHAR(20) | — | No | `DEFAULT 'ADJUDICADA'`, `CHECK IN ('EN_PROCESO','ADJUDICADA','CANCELADA','VENCIDA')` | Ciclo de vida contractual. |
| fecha_fallo | DATE | — | Sí | — | Fecha del fallo de licitación. |

### 3.10 `contrato_articulo`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| contrato_articulo_id | BIGSERIAL | PK | No | — | Identificador interno del renglón contractual. |
| licitacion_id | VARCHAR(20) | FK → `licitacion` | No | — | Contrato al que pertenece. |
| codigo_articulo | VARCHAR(15) | FK → `articulo` | No | — | Artículo adjudicado. |
| proveedor_id | VARCHAR(10) | FK → `proveedor` | No | — | Proveedor adjudicado. |
| marca_adjudicada | VARCHAR(60) | — | Sí | — | Marca comercial propuesta (`MARCA`). |
| marca_autorizada | VARCHAR(60) | — | Sí | — | Marca validada por comité (`AUTORIZA`, 35.63% nulo en origen — nulo legítimo). |
| presentacion_comercial | VARCHAR(120) | — | No | — | Empaque de entrega (`PRESENTACION` normalizada). |
| especificacion_empaque | VARCHAR(255) | — | Sí | — | Detalle adicional rescatado de `OBSERVACIONES` (98.28% nulo en origen — nulo legítimo). |
| precio_unitario | NUMERIC(12,2) | — | No | `CHECK (precio_unitario > 0)` | `COSTO` saneado (sin `$`/comas). |
| precio_referencia | NUMERIC(12,2) | — | Sí | `CHECK (precio_referencia >= 0)` | Precio de estudio de mercado. |
| activo | BOOLEAN | — | No | `DEFAULT TRUE` | Marca el renglón vigente cuando existe colisión de clave (resuelve P/duplicado `2212001066`). |
| fecha_registro | DATE | — | No | `DEFAULT CURRENT_DATE` | Auditoría. |
| — | — | — | — | `UNIQUE(licitacion_id, codigo_articulo, proveedor_id)`; índice único parcial `(licitacion_id, codigo_articulo) WHERE activo` | Garantiza que sólo exista **un** renglón activo por artículo dentro de una licitación, resolviendo la ambigüedad del `JOIN`/`VLOOKUP` descrita en `datos_licitacion.md`. |

### 3.11 `cupo_contractual_sede`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| cupo_id | BIGSERIAL | PK | No | — | Identificador interno. |
| contrato_articulo_id | BIGINT | FK → `contrato_articulo` | No | — | Renglón contractual. |
| sede_id | VARCHAR(5) | FK → `sede` | No | — | Sede a la que aplica el techo. |
| cantidad_minima_anual | NUMERIC(12,2) | — | No | `DEFAULT 0`, `CHECK (>= 0)` | Sustituye `MINIMO <sede>`. |
| cantidad_maxima_anual | NUMERIC(12,2) | — | No | `CHECK (cantidad_maxima_anual >= cantidad_minima_anual)` | Techo estricto e infranqueable (sustituye `MAXIMO <sede>`). |
| cantidad_acumulada_ejercicio | NUMERIC(12,2) | — | No | `DEFAULT 0`, `CHECK (>= 0)`, `CHECK (cantidad_acumulada_ejercicio <= cantidad_maxima_anual)` | Contador vivo de lo ya pedido en el ejercicio; el `CHECK` aplica en base de datos la regla *poka-yoke* de bloqueo transaccional del punto 6 de `datos_licitacion.md`. |
| — | — | — | — | `UNIQUE(contrato_articulo_id, sede_id)` | Un solo techo por combinación artículo-contrato-sede. |

### 3.12 `lote`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| lote_id | BIGSERIAL | PK | No | — | `lote_id = 0` reservado como registro centinela `'SIN LOTE'` (sembrado por el DDL) para artículos que no requieren control de lote. |
| codigo_articulo | VARCHAR(15) | FK → `articulo` | No | — | Artículo del lote. |
| proveedor_id | VARCHAR(10) | FK → `proveedor` | Sí | — | Proveedor que entregó el lote. |
| numero_lote_proveedor | VARCHAR(50) | — | No | — | Identificador de lote impreso por el proveedor. |
| fecha_fabricacion | DATE | — | Sí | — | Fecha de fabricación (perecederos). |
| fecha_caducidad | DATE | — | Sí | `CHECK (fecha_caducidad IS NULL OR fecha_fabricacion IS NULL OR fecha_caducidad > fecha_fabricacion)` | Fecha de caducidad; obligatoria a nivel de aplicación cuando `articulo.requiere_control_lote = TRUE`. |
| fecha_recepcion | DATE | — | No | `DEFAULT CURRENT_DATE` | Fecha de ingreso a almacén. |
| — | — | — | — | `UNIQUE(codigo_articulo, proveedor_id, numero_lote_proveedor)` | Evita duplicar el mismo lote físico. |

### 3.13 `orden_suministro` (Orden de Compra / OC)
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| orden_id | BIGSERIAL | PK | No | — | Encabezado del pedido al proveedor. |
| proveedor_id | VARCHAR(10) | FK → `proveedor` | No | — | Proveedor destino del pedido. |
| sede_id | VARCHAR(5) | FK → `sede` | No | — | Sede solicitante. |
| fecha_emision | DATE | — | No | `DEFAULT CURRENT_DATE` | Fecha de emisión. |
| fecha_entrega_programada | DATE | — | Sí | `CHECK (fecha_entrega_programada IS NULL OR fecha_entrega_programada >= fecha_emision)` | Fecha comprometida de entrega. |
| estatus | VARCHAR(15) | — | No | `DEFAULT 'PENDIENTE'`, `CHECK IN ('PENDIENTE','PARCIAL','RECIBIDA','CANCELADA')` | Ciclo de vida del pedido. |

### 3.14 `orden_suministro_detalle`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| orden_detalle_id | BIGSERIAL | PK | No | — | Renglón del pedido. |
| orden_id | BIGINT | FK → `orden_suministro` (`ON DELETE CASCADE`) | No | — | Pedido al que pertenece. |
| contrato_articulo_id | BIGINT | FK → `contrato_articulo` | No | — | Renglón contractual contra el que se surte (garantiza precio y proveedor pactados). |
| cantidad_solicitada | NUMERIC(12,2) | — | No | `CHECK (cantidad_solicitada > 0)` | Cantidad pedida. |
| cantidad_recibida | NUMERIC(12,2) | — | No | `DEFAULT 0`, `CHECK (cantidad_recibida >= 0)`, `CHECK (cantidad_recibida <= cantidad_solicitada)` | Cantidad efectivamente recibida (control de surtido parcial). |
| — | — | — | — | `UNIQUE(orden_id, contrato_articulo_id)` | Un artículo aparece una sola vez por pedido. |

### 3.15 `movimiento_inventario`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| movimiento_id | BIGSERIAL | PK | No | — | Renglón de Kardex. |
| almacen_id | INT | FK → `almacen` | No | — | Almacén afectado. |
| codigo_articulo | VARCHAR(15) | FK → `articulo` | No | — | Artículo movido. |
| lote_id | BIGINT | FK → `lote` | No | `DEFAULT 0` (centinela `'SIN LOTE'`) | Lote afectado; obligatorio siempre (evita nulos en la llave de saldos). |
| tipo_movimiento | VARCHAR(20) | — | No | `CHECK IN ('ENTRADA_COMPRA','SALIDA_CONSUMO','TRANSFERENCIA_SALIDA','TRANSFERENCIA_ENTRADA','MERMA','AJUSTE_POSITIVO','AJUSTE_NEGATIVO')` | Naturaleza del movimiento. |
| cantidad | NUMERIC(12,2) | — | No | `CHECK (cantidad > 0)` | Magnitud del movimiento (siempre positiva; el signo lo define `tipo_movimiento`). |
| orden_detalle_id | BIGINT | FK → `orden_suministro_detalle` | Sí | — | Enlaza la entrada física con el renglón de OC de origen, cuando aplica (`tipo_movimiento='ENTRADA_COMPRA'`). |
| programacion_detalle_id | BIGINT | FK → `programacion_detalle` | Sí | — | Enlaza la salida con la solicitud de área/día que cubre, cuando aplica (`tipo_movimiento='SALIDA_CONSUMO'`); es la columna que cierra el ciclo demanda→entrega descrito en 2.4. |
| fecha_movimiento | TIMESTAMP | — | No | `DEFAULT now()` | Momento del movimiento. |
| referencia_documento | VARCHAR(60) | — | Sí | — | Folio de remisión, factura o vale de salida. |

### 3.16 `existencia_almacen`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| almacen_id | INT | PK, FK → `almacen` | No | — | Compuesto con los siguientes dos campos. |
| codigo_articulo | VARCHAR(15) | PK, FK → `articulo` | No | — | — |
| lote_id | BIGINT | PK, FK → `lote` | No | `DEFAULT 0` | Saldo por lote específico (o `0` = agregado sin control de lote). |
| cantidad_actual | NUMERIC(12,2) | — | No | `DEFAULT 0`, `CHECK (cantidad_actual >= 0)` | Saldo vigente, mantenido por la aplicación/triggers a partir de `movimiento_inventario` (denormalización intencional documentada para desempeño de consulta operativa en punto de captura). |

### 3.17 `programacion_mensual`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| programacion_id | BIGSERIAL | PK | No | — | Encabezado. |
| area_id | SMALLINT | FK → `area_servicio` | No | — | Área de consumo (hoja de origen). |
| anio | SMALLINT | — | No | `CHECK (anio BETWEEN 2000 AND 2100)` | Año de la programación. |
| mes | SMALLINT | — | No | `CHECK (mes BETWEEN 1 AND 12)` | Mes de la programación. |
| fecha_elaboracion | DATE | — | No | `DEFAULT CURRENT_DATE` | Fecha de captura. |
| estatus | VARCHAR(15) | — | No | `DEFAULT 'BORRADOR'`, `CHECK IN ('BORRADOR','PUBLICADA','CERRADA')` | Ciclo de vida de la programación. |
| — | — | — | — | `UNIQUE(area_id, anio, mes)` | Una sola programación vigente por área-mes. |

### 3.18 `programacion_detalle`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| programacion_detalle_id | BIGSERIAL | PK | No | — | Renglón diario. |
| programacion_id | BIGINT | FK → `programacion_mensual` (`ON DELETE CASCADE`) | No | — | Encabezado al que pertenece. |
| codigo_articulo | VARCHAR(15) | FK → `articulo` | No | — | Artículo programado. |
| fecha | DATE | — | No | — | Día calendario (sustituye las 31 columnas anchas). |
| cantidad_programada | NUMERIC(12,2) | — | No | `DEFAULT 0`, `CHECK (cantidad_programada >= 0)` | Cantidad requerida ese día. |
| — | — | — | — | `UNIQUE(programacion_id, codigo_articulo, fecha)` | Un solo valor por artículo/día (la columna `TOTAL` se obtiene con `SUM()`, nunca se almacena). |

### 3.19 `produccion_diaria`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| produccion_id | BIGSERIAL | PK | No | — | Renglón de producción (sustituye `TORTILLAS`/`PAN`). |
| area_id | SMALLINT | FK → `area_servicio` | No | — | Área productora (`TORTILLERIA`, `PANADERIA`). |
| fecha | DATE | — | No | — | Día de producción. |
| numero_viaje | SMALLINT | — | Sí | `CHECK (numero_viaje IS NULL OR numero_viaje > 0)` | Corresponde a `1° VIAJE`…`4° VIAJE` de la hoja `TORTILLAS`. |
| codigo_articulo | VARCHAR(15) | FK → `articulo` | Sí | — | Producto catalogado, cuando existe correspondencia. |
| producto_texto | VARCHAR(255) | — | Sí | — | Respaldo de texto libre durante la transición, mientras se cataloga cada producto de `TORTILLAS`/`PAN` (hallazgo P11). |
| cantidad | NUMERIC(12,2) | — | No | `CHECK (cantidad > 0)` | Cantidad producida/entregada. |
| unidad_id | SMALLINT | FK → `unidad_medida` | No | — | Unidad de la cantidad. |
| — | — | — | — | `CHECK (codigo_articulo IS NOT NULL OR producto_texto IS NOT NULL)` | Exige al menos una referencia de producto (evita filas vacías). |

### 3.20 `consolidacion_pedido`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| consolidacion_id | BIGSERIAL | PK | No | — | Renglón de trazabilidad demanda→OC. |
| programacion_detalle_id | BIGINT | FK → `programacion_detalle` (`ON DELETE CASCADE`) | No | — | Solicitud de área/día que se está agregando. |
| orden_detalle_id | BIGINT | FK → `orden_suministro_detalle` (`ON DELETE CASCADE`) | No | — | Renglón de OC que la consolida. |
| cantidad_consolidada | NUMERIC(12,2) | — | No | `CHECK (cantidad_consolidada > 0)` | Porción de `cantidad_programada` que se incluyó en esta OC (normalmente el total; admite consolidación parcial entre dos periodos de compra). |
| — | — | — | — | `UNIQUE(programacion_detalle_id, orden_detalle_id)`; trigger `trg_valida_consolidacion_pedido` | El trigger exige que el artículo programado coincida con el artículo de la OC y que la suma de consolidaciones de un renglón de OC nunca exceda su `cantidad_solicitada` (ver 2.4 y DDL). |

### 3.21 `asignacion_salida_entrada`
| Campo | Tipo | PK/FK | Nulo | Restricciones/Checks | Descripción |
|---|---|---|---|---|---|
| asignacion_id | BIGSERIAL | PK | No | — | Renglón de trazabilidad entrada→salida. |
| movimiento_salida_id | BIGINT | FK → `movimiento_inventario` (`ON DELETE CASCADE`) | No | — | Movimiento de salida (entrega a un área) que se está cubriendo. |
| movimiento_entrada_id | BIGINT | FK → `movimiento_inventario` (`ON DELETE CASCADE`) | No | — | Movimiento de entrada del que físicamente salió la mercancía. |
| cantidad_asignada | NUMERIC(12,2) | — | No | `CHECK (cantidad_asignada > 0)`, `CHECK (movimiento_salida_id <> movimiento_entrada_id)` | Cantidad de la salida cubierta por esta entrada específica. |
| — | — | — | — | `UNIQUE(movimiento_salida_id, movimiento_entrada_id)`; trigger `trg_valida_asignacion_salida_entrada` | El trigger exige mismo artículo/almacén/lote entre ambos movimientos y que ninguna suma de asignaciones exceda la cantidad real de la entrada ni de la salida (evita "repartir" más de lo que físicamente entró o salió). |

---

## 4. Script DDL (PostgreSQL 15+)

```sql
-- =====================================================================
-- Esquema de datos: Gestión de Inventarios, Suministros y Almacenes
-- Área de Dietología y Nutrición — Sector Salud Pública, Jalisco
-- Motor objetivo: PostgreSQL 15+
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS dietologia;
SET search_path TO dietologia;

-- =====================================================================
-- 1. CATÁLOGOS MAESTROS INDEPENDIENTES
-- =====================================================================

CREATE TABLE dietologia.unidad_medida (
    unidad_id     SMALLSERIAL PRIMARY KEY,
    clave         VARCHAR(10) NOT NULL UNIQUE,
    nombre        VARCHAR(40) NOT NULL,
    tipo_medida   VARCHAR(10) NOT NULL
                  CHECK (tipo_medida IN ('PESO','VOLUMEN','PIEZA','PAQUETE'))
);

CREATE TABLE dietologia.familia (
    familia_id         SMALLSERIAL PRIMARY KEY,
    clave_presupuestal VARCHAR(5)  NOT NULL UNIQUE,
    nombre             VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE dietologia.grupo_alimento (
    grupo_id       SMALLSERIAL PRIMARY KEY,
    familia_id     SMALLINT NOT NULL REFERENCES dietologia.familia(familia_id),
    nombre         VARCHAR(60) NOT NULL UNIQUE,
    es_perecedero  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE dietologia.proveedor (
    proveedor_id   VARCHAR(10) PRIMARY KEY,
    razon_social   VARCHAR(150) NOT NULL,
    activo         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE dietologia.sede (
    sede_id      VARCHAR(5) PRIMARY KEY,
    nombre_sede  VARCHAR(120) NOT NULL,
    tipo_sede    VARCHAR(20) NOT NULL
                 CHECK (tipo_sede IN ('HOSPITAL','OFICINA_CENTRAL'))
);

-- =====================================================================
-- 2. CATÁLOGO DE ARTÍCULOS Y ESTRUCTURA FÍSICA
-- =====================================================================

CREATE TABLE dietologia.articulo (
    codigo_articulo         VARCHAR(15) PRIMARY KEY,
    descripcion              VARCHAR(255) NOT NULL,
    grupo_id                 SMALLINT NOT NULL REFERENCES dietologia.grupo_alimento(grupo_id),
    unidad_id                SMALLINT NOT NULL REFERENCES dietologia.unidad_medida(unidad_id),
    requiere_control_lote    BOOLEAN NOT NULL DEFAULT TRUE,
    activo                   BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_alta               DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE dietologia.almacen (
    almacen_id     SERIAL PRIMARY KEY,
    sede_id        VARCHAR(5) NOT NULL REFERENCES dietologia.sede(sede_id),
    clave_almacen  VARCHAR(10) NOT NULL,
    nombre         VARCHAR(120) NOT NULL,
    tipo_almacen   VARCHAR(15) NOT NULL
                   CHECK (tipo_almacen IN ('CENTRAL','PERIFERICO','COCINA')),
    UNIQUE (sede_id, clave_almacen)
);

CREATE TABLE dietologia.area_servicio (
    area_id      SMALLSERIAL PRIMARY KEY,
    clave        VARCHAR(30) NOT NULL UNIQUE,
    nombre       VARCHAR(80) NOT NULL,
    almacen_id   INT REFERENCES dietologia.almacen(almacen_id),
    activo       BOOLEAN NOT NULL DEFAULT TRUE
);

-- =====================================================================
-- 3. DOMINIO CONTRACTUAL (LICITACIONES Y CUOTAS POR SEDE)
-- =====================================================================

CREATE TABLE dietologia.licitacion (
    licitacion_id      VARCHAR(20) PRIMARY KEY,
    partida            INT NOT NULL CHECK (partida > 0),
    ejercicio_fiscal   SMALLINT NOT NULL CHECK (ejercicio_fiscal BETWEEN 2000 AND 2100),
    estatus            VARCHAR(20) NOT NULL DEFAULT 'ADJUDICADA'
                       CHECK (estatus IN ('EN_PROCESO','ADJUDICADA','CANCELADA','VENCIDA')),
    fecha_fallo        DATE
);

CREATE TABLE dietologia.contrato_articulo (
    contrato_articulo_id    BIGSERIAL PRIMARY KEY,
    licitacion_id            VARCHAR(20) NOT NULL REFERENCES dietologia.licitacion(licitacion_id),
    codigo_articulo           VARCHAR(15) NOT NULL REFERENCES dietologia.articulo(codigo_articulo),
    proveedor_id              VARCHAR(10) NOT NULL REFERENCES dietologia.proveedor(proveedor_id),
    marca_adjudicada          VARCHAR(60),
    marca_autorizada          VARCHAR(60),
    presentacion_comercial    VARCHAR(120) NOT NULL,
    especificacion_empaque    VARCHAR(255),
    precio_unitario           NUMERIC(12,2) NOT NULL CHECK (precio_unitario > 0),
    precio_referencia         NUMERIC(12,2) CHECK (precio_referencia >= 0),
    activo                    BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_registro            DATE NOT NULL DEFAULT CURRENT_DATE,
    UNIQUE (licitacion_id, codigo_articulo, proveedor_id)
);

-- Garantiza un único renglón contractual ACTIVO por artículo dentro de
-- cada licitación (resuelve la colisión de clave CODIGO=2212001066).
CREATE UNIQUE INDEX ux_contrato_articulo_activo
    ON dietologia.contrato_articulo (licitacion_id, codigo_articulo)
    WHERE activo;

CREATE TABLE dietologia.cupo_contractual_sede (
    cupo_id                        BIGSERIAL PRIMARY KEY,
    contrato_articulo_id            BIGINT NOT NULL REFERENCES dietologia.contrato_articulo(contrato_articulo_id) ON DELETE CASCADE,
    sede_id                         VARCHAR(5) NOT NULL REFERENCES dietologia.sede(sede_id),
    cantidad_minima_anual           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cantidad_minima_anual >= 0),
    cantidad_maxima_anual           NUMERIC(12,2) NOT NULL CHECK (cantidad_maxima_anual >= cantidad_minima_anual),
    cantidad_acumulada_ejercicio    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cantidad_acumulada_ejercicio >= 0),
    UNIQUE (contrato_articulo_id, sede_id),
    CHECK (cantidad_acumulada_ejercicio <= cantidad_maxima_anual)
);

-- =====================================================================
-- 4. DOMINIO DE INVENTARIO Y TRAZABILIDAD (LOTES / KARDEX / SALDOS)
-- =====================================================================

CREATE TABLE dietologia.lote (
    lote_id                 BIGSERIAL PRIMARY KEY,
    codigo_articulo          VARCHAR(15) NOT NULL REFERENCES dietologia.articulo(codigo_articulo),
    proveedor_id             VARCHAR(10) REFERENCES dietologia.proveedor(proveedor_id),
    numero_lote_proveedor    VARCHAR(50) NOT NULL,
    fecha_fabricacion        DATE,
    fecha_caducidad          DATE,
    fecha_recepcion          DATE NOT NULL DEFAULT CURRENT_DATE,
    CHECK (fecha_caducidad IS NULL OR fecha_fabricacion IS NULL OR fecha_caducidad > fecha_fabricacion),
    UNIQUE (codigo_articulo, proveedor_id, numero_lote_proveedor)
);

-- Registro centinela: representa "SIN LOTE" para artículos que no
-- requieren control de caducidad, evitando valores NULL en las llaves
-- compuestas de movimiento_inventario / existencia_almacen. Se apoya en
-- catálogos técnicos placeholder (id = 0) que no se usan en captura real.
INSERT INTO dietologia.familia (familia_id, clave_presupuestal, nombre)
VALUES (0, '0', 'N/A - TECNICO')
ON CONFLICT DO NOTHING;

INSERT INTO dietologia.grupo_alimento (grupo_id, familia_id, nombre, es_perecedero)
VALUES (0, 0, 'N/A - TECNICO', FALSE)
ON CONFLICT DO NOTHING;

INSERT INTO dietologia.unidad_medida (unidad_id, clave, nombre, tipo_medida)
VALUES (0, 'N/A', 'No aplica', 'PIEZA')
ON CONFLICT DO NOTHING;

INSERT INTO dietologia.articulo (codigo_articulo, descripcion, grupo_id, unidad_id, requiere_control_lote, activo)
VALUES ('SIN_ARTICULO', 'REGISTRO TÉCNICO — NO USAR EN CAPTURA', 0, 0, FALSE, FALSE)
ON CONFLICT DO NOTHING;

INSERT INTO dietologia.lote (lote_id, codigo_articulo, numero_lote_proveedor, fecha_recepcion)
VALUES (0, 'SIN_ARTICULO', 'SIN_LOTE', CURRENT_DATE)
ON CONFLICT DO NOTHING;

CREATE TABLE dietologia.orden_suministro (
    orden_id                    BIGSERIAL PRIMARY KEY,
    proveedor_id                 VARCHAR(10) NOT NULL REFERENCES dietologia.proveedor(proveedor_id),
    sede_id                      VARCHAR(5) NOT NULL REFERENCES dietologia.sede(sede_id),
    fecha_emision                DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_entrega_programada     DATE,
    estatus                      VARCHAR(15) NOT NULL DEFAULT 'PENDIENTE'
                                 CHECK (estatus IN ('PENDIENTE','PARCIAL','RECIBIDA','CANCELADA')),
    CHECK (fecha_entrega_programada IS NULL OR fecha_entrega_programada >= fecha_emision)
);

CREATE TABLE dietologia.orden_suministro_detalle (
    orden_detalle_id       BIGSERIAL PRIMARY KEY,
    orden_id                BIGINT NOT NULL REFERENCES dietologia.orden_suministro(orden_id) ON DELETE CASCADE,
    contrato_articulo_id    BIGINT NOT NULL REFERENCES dietologia.contrato_articulo(contrato_articulo_id),
    cantidad_solicitada      NUMERIC(12,2) NOT NULL CHECK (cantidad_solicitada > 0),
    cantidad_recibida        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cantidad_recibida >= 0),
    UNIQUE (orden_id, contrato_articulo_id),
    CHECK (cantidad_recibida <= cantidad_solicitada)
);

CREATE TABLE dietologia.movimiento_inventario (
    movimiento_id          BIGSERIAL PRIMARY KEY,
    almacen_id               INT NOT NULL REFERENCES dietologia.almacen(almacen_id),
    codigo_articulo           VARCHAR(15) NOT NULL REFERENCES dietologia.articulo(codigo_articulo),
    lote_id                   BIGINT NOT NULL DEFAULT 0 REFERENCES dietologia.lote(lote_id),
    tipo_movimiento           VARCHAR(20) NOT NULL
                              CHECK (tipo_movimiento IN (
                                  'ENTRADA_COMPRA','SALIDA_CONSUMO',
                                  'TRANSFERENCIA_SALIDA','TRANSFERENCIA_ENTRADA',
                                  'MERMA','AJUSTE_POSITIVO','AJUSTE_NEGATIVO')),
    cantidad                  NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
    orden_detalle_id          BIGINT REFERENCES dietologia.orden_suministro_detalle(orden_detalle_id),
    fecha_movimiento          TIMESTAMP NOT NULL DEFAULT now(),
    referencia_documento      VARCHAR(60)
);

CREATE TABLE dietologia.existencia_almacen (
    almacen_id       INT NOT NULL REFERENCES dietologia.almacen(almacen_id),
    codigo_articulo    VARCHAR(15) NOT NULL REFERENCES dietologia.articulo(codigo_articulo),
    lote_id             BIGINT NOT NULL DEFAULT 0 REFERENCES dietologia.lote(lote_id),
    cantidad_actual     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cantidad_actual >= 0),
    PRIMARY KEY (almacen_id, codigo_articulo, lote_id)
);

-- =====================================================================
-- 5. DOMINIO DE PROGRAMACIÓN Y PRODUCCIÓN OPERATIVA
-- =====================================================================

CREATE TABLE dietologia.programacion_mensual (
    programacion_id     BIGSERIAL PRIMARY KEY,
    area_id               SMALLINT NOT NULL REFERENCES dietologia.area_servicio(area_id),
    anio                  SMALLINT NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
    mes                   SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    fecha_elaboracion     DATE NOT NULL DEFAULT CURRENT_DATE,
    estatus               VARCHAR(15) NOT NULL DEFAULT 'BORRADOR'
                          CHECK (estatus IN ('BORRADOR','PUBLICADA','CERRADA')),
    UNIQUE (area_id, anio, mes)
);

CREATE TABLE dietologia.programacion_detalle (
    programacion_detalle_id   BIGSERIAL PRIMARY KEY,
    programacion_id             BIGINT NOT NULL REFERENCES dietologia.programacion_mensual(programacion_id) ON DELETE CASCADE,
    codigo_articulo              VARCHAR(15) NOT NULL REFERENCES dietologia.articulo(codigo_articulo),
    fecha                        DATE NOT NULL,
    cantidad_programada          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cantidad_programada >= 0),
    UNIQUE (programacion_id, codigo_articulo, fecha)
);

CREATE TABLE dietologia.produccion_diaria (
    produccion_id      BIGSERIAL PRIMARY KEY,
    area_id              SMALLINT NOT NULL REFERENCES dietologia.area_servicio(area_id),
    fecha                DATE NOT NULL,
    numero_viaje         SMALLINT CHECK (numero_viaje IS NULL OR numero_viaje > 0),
    codigo_articulo       VARCHAR(15) REFERENCES dietologia.articulo(codigo_articulo),
    producto_texto        VARCHAR(255),
    cantidad              NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
    unidad_id             SMALLINT NOT NULL REFERENCES dietologia.unidad_medida(unidad_id),
    CHECK (codigo_articulo IS NOT NULL OR producto_texto IS NOT NULL)
);

-- =====================================================================
-- 6. CONSOLIDACIÓN DE PEDIDOS EN ÓRDENES DE COMPRA Y TRAZABILIDAD
--    ENTRADA -> SALIDA DE ALMACÉN (ver Fase 2.4 del informe)
-- =====================================================================

-- La salida de almacén queda ligada a la solicitud de área/día que
-- cubre (ej. la entrega de 10 kg a PACIENTES). Se agrega por ALTER
-- porque programacion_detalle se define en la sección 5, posterior a
-- movimiento_inventario.
ALTER TABLE dietologia.movimiento_inventario
    ADD COLUMN programacion_detalle_id BIGINT
        REFERENCES dietologia.programacion_detalle(programacion_detalle_id);

-- Vínculo entre la demanda programada por área (programacion_detalle) y
-- el renglón de Orden de Compra (orden_suministro_detalle) que la
-- consolida. Varias filas de programacion_detalle (de distintas áreas y
-- distintos días del periodo) se agregan hacia uno o más renglones de OC
-- por proveedor+artículo (ej. 10 kg PACIENTES + 10 kg COMEDOR -> 20 kg
-- en un solo renglón de OC).
CREATE TABLE dietologia.consolidacion_pedido (
    consolidacion_id           BIGSERIAL PRIMARY KEY,
    programacion_detalle_id     BIGINT NOT NULL REFERENCES dietologia.programacion_detalle(programacion_detalle_id) ON DELETE CASCADE,
    orden_detalle_id             BIGINT NOT NULL REFERENCES dietologia.orden_suministro_detalle(orden_detalle_id) ON DELETE CASCADE,
    cantidad_consolidada          NUMERIC(12,2) NOT NULL CHECK (cantidad_consolidada > 0),
    UNIQUE (programacion_detalle_id, orden_detalle_id)
);

-- Exige que el artículo programado coincida con el artículo de la OC y
-- que la suma de consolidaciones de un renglón de OC nunca exceda su
-- cantidad_solicitada (la OC se crea primero con el total ya agregado
-- por el proceso de compras; ver Fase 5.2 del informe).
CREATE OR REPLACE FUNCTION dietologia.fn_valida_consolidacion_pedido()
RETURNS TRIGGER AS $$
DECLARE
    v_articulo_programado   VARCHAR(15);
    v_articulo_ordenado     VARCHAR(15);
    v_cantidad_solicitada   NUMERIC(12,2);
    v_suma_consolidada      NUMERIC(12,2);
BEGIN
    SELECT codigo_articulo INTO v_articulo_programado
      FROM dietologia.programacion_detalle
     WHERE programacion_detalle_id = NEW.programacion_detalle_id;

    SELECT ca.codigo_articulo, osd.cantidad_solicitada
      INTO v_articulo_ordenado, v_cantidad_solicitada
      FROM dietologia.orden_suministro_detalle osd
      JOIN dietologia.contrato_articulo ca ON ca.contrato_articulo_id = osd.contrato_articulo_id
     WHERE osd.orden_detalle_id = NEW.orden_detalle_id;

    IF v_articulo_programado IS DISTINCT FROM v_articulo_ordenado THEN
        RAISE EXCEPTION 'consolidacion_pedido: el artículo programado (%) no coincide con el artículo de la OC (%)',
            v_articulo_programado, v_articulo_ordenado;
    END IF;

    SELECT COALESCE(SUM(cantidad_consolidada), 0) INTO v_suma_consolidada
      FROM dietologia.consolidacion_pedido
     WHERE orden_detalle_id = NEW.orden_detalle_id
       AND consolidacion_id <> COALESCE(NEW.consolidacion_id, -1);

    IF v_suma_consolidada + NEW.cantidad_consolidada > v_cantidad_solicitada THEN
        RAISE EXCEPTION 'consolidacion_pedido: la suma consolidada (%) excedería la cantidad_solicitada de la OC (%)',
            v_suma_consolidada + NEW.cantidad_consolidada, v_cantidad_solicitada;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_valida_consolidacion_pedido
    BEFORE INSERT OR UPDATE ON dietologia.consolidacion_pedido
    FOR EACH ROW EXECUTE FUNCTION dietologia.fn_valida_consolidacion_pedido();

-- Trazabilidad de asignación de existencias: qué SALIDA (entrega de
-- almacén a un área) se surtió con qué ENTRADA (recepción ligada a una
-- OC). Permite dividir una sola entrada (ej. 20 kg) entre varias salidas
-- (10 kg a PACIENTES + 10 kg a COMEDOR) y, si un lote se agota, cubrir
-- una salida con más de una entrada.
CREATE TABLE dietologia.asignacion_salida_entrada (
    asignacion_id           BIGSERIAL PRIMARY KEY,
    movimiento_salida_id      BIGINT NOT NULL REFERENCES dietologia.movimiento_inventario(movimiento_id) ON DELETE CASCADE,
    movimiento_entrada_id     BIGINT NOT NULL REFERENCES dietologia.movimiento_inventario(movimiento_id) ON DELETE CASCADE,
    cantidad_asignada          NUMERIC(12,2) NOT NULL CHECK (cantidad_asignada > 0),
    CHECK (movimiento_salida_id <> movimiento_entrada_id),
    UNIQUE (movimiento_salida_id, movimiento_entrada_id)
);

-- Exige que ambos movimientos sean, respectivamente, una salida y una
-- entrada reales; que compartan artículo/almacén/lote; y que ninguna
-- suma de asignaciones exceda la cantidad física de la entrada ni de la
-- salida (impide "repartir" más de lo que realmente entró o salió).
CREATE OR REPLACE FUNCTION dietologia.fn_valida_asignacion_salida_entrada()
RETURNS TRIGGER AS $$
DECLARE
    v_salida         dietologia.movimiento_inventario%ROWTYPE;
    v_entrada        dietologia.movimiento_inventario%ROWTYPE;
    v_suma_entrada   NUMERIC(12,2);
    v_suma_salida    NUMERIC(12,2);
BEGIN
    SELECT * INTO v_salida  FROM dietologia.movimiento_inventario WHERE movimiento_id = NEW.movimiento_salida_id;
    SELECT * INTO v_entrada FROM dietologia.movimiento_inventario WHERE movimiento_id = NEW.movimiento_entrada_id;

    IF v_salida.tipo_movimiento NOT IN ('SALIDA_CONSUMO','TRANSFERENCIA_SALIDA','MERMA','AJUSTE_NEGATIVO') THEN
        RAISE EXCEPTION 'asignacion_salida_entrada: el movimiento % no es una salida (tipo=%)',
            NEW.movimiento_salida_id, v_salida.tipo_movimiento;
    END IF;
    IF v_entrada.tipo_movimiento NOT IN ('ENTRADA_COMPRA','TRANSFERENCIA_ENTRADA','AJUSTE_POSITIVO') THEN
        RAISE EXCEPTION 'asignacion_salida_entrada: el movimiento % no es una entrada (tipo=%)',
            NEW.movimiento_entrada_id, v_entrada.tipo_movimiento;
    END IF;
    IF v_salida.codigo_articulo <> v_entrada.codigo_articulo
       OR v_salida.almacen_id <> v_entrada.almacen_id
       OR v_salida.lote_id <> v_entrada.lote_id THEN
        RAISE EXCEPTION 'asignacion_salida_entrada: la salida % y la entrada % no corresponden al mismo artículo/almacén/lote',
            NEW.movimiento_salida_id, NEW.movimiento_entrada_id;
    END IF;

    SELECT COALESCE(SUM(cantidad_asignada), 0) INTO v_suma_entrada
      FROM dietologia.asignacion_salida_entrada
     WHERE movimiento_entrada_id = NEW.movimiento_entrada_id
       AND asignacion_id <> COALESCE(NEW.asignacion_id, -1);
    IF v_suma_entrada + NEW.cantidad_asignada > v_entrada.cantidad THEN
        RAISE EXCEPTION 'asignacion_salida_entrada: se asignaría % contra una entrada de sólo % unidades',
            v_suma_entrada + NEW.cantidad_asignada, v_entrada.cantidad;
    END IF;

    SELECT COALESCE(SUM(cantidad_asignada), 0) INTO v_suma_salida
      FROM dietologia.asignacion_salida_entrada
     WHERE movimiento_salida_id = NEW.movimiento_salida_id
       AND asignacion_id <> COALESCE(NEW.asignacion_id, -1);
    IF v_suma_salida + NEW.cantidad_asignada > v_salida.cantidad THEN
        RAISE EXCEPTION 'asignacion_salida_entrada: se asignaría % contra una salida de sólo % unidades',
            v_suma_salida + NEW.cantidad_asignada, v_salida.cantidad;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_valida_asignacion_salida_entrada
    BEFORE INSERT OR UPDATE ON dietologia.asignacion_salida_entrada
    FOR EACH ROW EXECUTE FUNCTION dietologia.fn_valida_asignacion_salida_entrada();

-- =====================================================================
-- 7. ÍNDICES OPERATIVOS RECOMENDADOS
-- =====================================================================

-- Requerida antes de crear el índice de búsqueda de texto más abajo
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Búsqueda de lotes próximos a caducar (operación diaria crítica de Dietología)
CREATE INDEX ix_lote_caducidad ON dietologia.lote (fecha_caducidad)
    WHERE fecha_caducidad IS NOT NULL;

-- Insumos por categoría (consulta frecuente de captura/menú)
CREATE INDEX ix_articulo_grupo ON dietologia.articulo (grupo_id);
CREATE INDEX ix_articulo_descripcion ON dietologia.articulo USING gin (descripcion gin_trgm_ops);

-- Movimientos de almacén por fecha (Kardex, reportes de periodo)
CREATE INDEX ix_movimiento_fecha ON dietologia.movimiento_inventario (fecha_movimiento);
CREATE INDEX ix_movimiento_almacen_articulo ON dietologia.movimiento_inventario (almacen_id, codigo_articulo);

-- Consultas de techo contractual por sede (validación de pedidos en tiempo real)
CREATE INDEX ix_cupo_sede ON dietologia.cupo_contractual_sede (sede_id);

-- Consulta de programación por artículo y rango de fechas (sustituye el
-- barrido de 31 columnas anchas del Excel origen)
CREATE INDEX ix_programacion_detalle_fecha ON dietologia.programacion_detalle (fecha);
CREATE INDEX ix_programacion_detalle_articulo ON dietologia.programacion_detalle (codigo_articulo);

-- Trazabilidad de contratos vigentes por artículo
CREATE INDEX ix_contrato_articulo_codigo ON dietologia.contrato_articulo (codigo_articulo) WHERE activo;

-- Consolidación de pedidos en OC (sección 6): resolver en ambos sentidos
-- "¿qué áreas están detrás de este renglón de OC?" y "¿en qué OC quedó
-- consolidada esta solicitud de área?"
CREATE INDEX ix_consolidacion_pedido_orden ON dietologia.consolidacion_pedido (orden_detalle_id);
CREATE INDEX ix_consolidacion_pedido_programacion ON dietologia.consolidacion_pedido (programacion_detalle_id);

-- Trazabilidad entrada<->salida (sección 6) y salidas ligadas a una
-- solicitud de área
CREATE INDEX ix_asignacion_entrada ON dietologia.asignacion_salida_entrada (movimiento_entrada_id);
CREATE INDEX ix_asignacion_salida ON dietologia.asignacion_salida_entrada (movimiento_salida_id);
CREATE INDEX ix_movimiento_programacion_detalle ON dietologia.movimiento_inventario (programacion_detalle_id)
    WHERE programacion_detalle_id IS NOT NULL;
```

---

## 5. Pautas Técnicas para el Pipeline ETL y Limpieza

### 5.1 Secuencia obligatoria de carga (respeta integridad referencial)

1. `unidad_medida`, `familia` — catálogos sin dependencias.
2. `grupo_alimento` (depende de `familia`).
3. `proveedor`.
4. `sede` → `almacen` → `area_servicio`.
5. `articulo` (depende de `grupo_alimento`, `unidad_medida`) — **incluye el registro centinela y la unificación del catálogo de 386 códigos del libro de programación con los 347 códigos del contrato**, ya que `articulo` es el superconjunto.
6. `licitacion`.
7. `contrato_articulo` (depende de `licitacion`, `articulo`, `proveedor`).
8. `cupo_contractual_sede` (depende de `contrato_articulo`, `sede`) — poblada por el **despivote** de las columnas `MINIMO/MAXIMO FAA/JIM/ORI/OPD`.
9. `lote` (depende de `articulo`, `proveedor`) — sólo se puebla a partir de recepciones reales; no existe en el origen histórico y arranca vacía salvo el registro centinela `lote_id = 0`.
10. `orden_suministro` → `orden_suministro_detalle` (dependen de `proveedor`/`sede` y `contrato_articulo`).
11. `movimiento_inventario` (depende de `almacen`, `articulo`, `lote`, opcionalmente `orden_suministro_detalle`).
12. `existencia_almacen` — se recalcula/materializa **después** de cargar el histórico de movimientos (nunca se carga directamente desde Excel).
13. `programacion_mensual` (depende de `area_servicio`).
14. `programacion_detalle` (depende de `programacion_mensual`, `articulo`) — poblada por el **despivote** de las 31 columnas de día de cada hoja del libro `PROGRAMACION_OCTUBRE_26.xlsx`.
15. `produccion_diaria` (depende de `area_servicio`, opcionalmente `articulo`) — poblada tras el parsing de texto libre de `TORTILLAS`/`PAN`.
16. `consolidacion_pedido` (depende de `programacion_detalle` y `orden_suministro_detalle`) — se puebla **después** de que Compras consolida la demanda del periodo y genera la OC (ver 5.2.1); no existe en ninguna de las dos fuentes origen, arranca vacía.
17. `asignacion_salida_entrada` (depende de `movimiento_inventario`, tanto de la entrada como de la(s) salida(s) que reparte) — se puebla al momento de surtir cada salida de almacén; también arranca vacía, es la última en cargarse.

#### 5.1.1 Proceso de consolidación de pedidos en Orden de Compra (nuevo)

Este proceso no viene de ninguna de las dos fuentes origen (ni el Excel ni el contrato registran hoy una consolidación de demanda); es la regla de negocio que el sistema nuevo debe ejecutar para generar cada OC:

1. **Agregar demanda por proveedor+artículo+periodo:** `SELECT codigo_articulo, SUM(cantidad_programada) FROM programacion_detalle ... GROUP BY codigo_articulo, periodo` a través de **todas las áreas** (`PACIENTES`, `COMEDOR`, `JORNADA`, etc.), resolviendo el `proveedor_id` vigente vía `contrato_articulo` (`WHERE activo`). Ej.: 10 kg de `PACIENTES` + 10 kg de `COMEDOR` del mismo artículo ⇒ 20 kg agregados para el proveedor adjudicado.
2. **Crear el encabezado `orden_suministro`** (una OC por proveedor y periodo) y su(s) `orden_suministro_detalle` con `cantidad_solicitada` = la suma calculada en el paso 1 (20 kg en el ejemplo).
3. **Insertar `consolidacion_pedido`** por cada `programacion_detalle` que aportó a esa suma (una fila por PACIENTES, otra por COMEDOR), con su `cantidad_consolidada` correspondiente. El trigger `trg_valida_consolidacion_pedido` rechaza la carga si la suma no cuadra con `cantidad_solicitada` o si algún renglón corresponde a un artículo distinto — así el sistema queda protegido contra una consolidación mal armada.
4. **Recepción (entrada):** al llegar la mercancía, se inserta `movimiento_inventario` con `tipo_movimiento='ENTRADA_COMPRA'` y `orden_detalle_id` apuntando al renglón de OC recién surtido (ya existente en el modelo desde la primera versión de este informe).
5. **Entrega a las áreas (salida) y asignación:** por cada entrega física a una `area_servicio`, se inserta `movimiento_inventario` con `tipo_movimiento='SALIDA_CONSUMO'` y `programacion_detalle_id` apuntando a la solicitud original de esa área; y se inserta `asignacion_salida_entrada` ligando esa salida con la entrada de la que provino. El trigger `trg_valida_asignacion_salida_entrada` impide que la suma de las salidas asignadas a una entrada exceda lo realmente recibido.

### 5.2 Reglas de transformación — dominio contractual (`licitacion.csv` / `LPL472026`)

- **Ingestión:** cargar omitiendo la última fila (`skipfooter=1`); aplicar `.strip()` a todos los nombres de columna (elimina el problema de `' COSTO '`, `' MIN TOTAL '`, `' MAX TOTAL '`).
- **Saneo monetario:** `COSTO`, `MIN TOTAL`, `MAX TOTAL` → `regex REPLACE(valor, '[\$,]', '')` → `TRIM()` → `CAST` a `NUMERIC`.
- **Resolución de la colisión `2212001066`:** cargar ambos renglones en `contrato_articulo` (proveedores distintos son datos legítimos), pero **una decisión de mesa de control de adquisiciones** debe marcar `activo = TRUE` en un solo renglón antes de operar; el índice único parcial del DDL impide que ambos queden activos simultáneamente.
- **Reconciliación de `PRESENTACION`/unidad de medida:** tabla de mapeo determinista `{'FRASCO','FRASCOS','FCO'} → 'FRASCO'`; `'KG   K' → 'KG'`; `'Pza 8 GS' → unidad='PIEZA', atributo_texto='8 GR'` (agregar a `especificacion_empaque`, no a `unidad_medida`).
- **Reconciliación `FAMILIA` → `familia`/`grupo_alimento`:** parsear el prefijo numérico de `FAMILIA` (`'14 Res y Cerdo'` → `clave_presupuestal='14'`, `nombre='Res y Cerdo'`) para poblar `familia`; los 13 valores de `'GRUPO DE ALIMENTO:'` del libro de programación se mapean **muchos a uno** hacia la `familia` correspondiente (p. ej. `CERDO` y `RES` → familia `'14 Res y Cerdo'`) mediante tabla de correspondencia validada por Dietología, no por coincidencia automática de texto.
- **Despivote de cuotas:** transformar `MINIMO/MAXIMO {FAA,JIM,ORI,OPD}` de columnas a filas de `cupo_contractual_sede` (`UNPIVOT`/`melt`); descartar `MINIMO/MAXIMO TOTAL` (se recalculan con `SUM()`).
- **Columnas de varianza cero** (`PARTIDA`, `LICITACION`, `ACREDITA`, `ACREDITA2`, `COMENTARIOS`) se elevan a metadatos del encabezado `licitacion`/constantes de proceso, no se replican por renglón.
- **Imputación:** nulos en `MINIMO/MAXIMO ORI` y `MINIMO/MAXIMO OPD` (filas 46/47, la colisión de clave) se imputan a `0` únicamente tras resolver cuál renglón queda activo.

### 5.3 Reglas de transformación — dominio de programación (`PROGRAMACION_OCTUBRE_26.xlsx`)

- **Consolidación de catálogo:** de las 8 hojas con estructura `CÓDIGO/DESCRIPCIÓN/UNIDAD DE MEDIDA` repetida, extraer el catálogo **una sola vez** vía `UNION` + `DISTINCT` sobre `codigo_articulo`, verificando divergencias (como la detectada en `2212012004`, `FRASCOS` vs `FCO`) y resolviéndolas con la tabla de mapeo de `unidad_medida` antes de insertar en `articulo`.
- **Normalización de tipos de clave:** forzar `CAST(codigo AS VARCHAR)` con `TRIM()` en el 100% de las filas, incluyendo el caso `'2212008048'` (ya string) y el resto (numéricos), evitando el error de tipo mixto detectado en `PACIENTES` fila 384.
- **Normalización de celdas de cantidad:** forzar `CAST` numérico sobre las 31 columnas de día en las 8 hojas, capturando el caso puntual de `'0'` como texto en `JORNADA`; cualquier valor no convertible a número se marca para revisión manual, no se descarta silenciosamente.
- **Despivote (melt/unpivot):** transformar la matriz `[CÓDIGO, DESCRIPCIÓN, UNIDAD, día 1…día 31, TOTAL]` de cada hoja en filas `[area, fecha, codigo_articulo, cantidad_programada]`; la columna `TOTAL` se descarta (0 discrepancias detectadas contra `SUM(día1..31)`, por lo que es 100% recalculable).
- **Tratamiento de `None` vs. `0`:** documentar y decidir con Dietología si las celdas `None` de hojas como `JORNADA` (6,424 celdas nulas detectadas) representan "no aplica" o "captura pendiente"; no deben tratarse automáticamente como `0` sin confirmación de negocio, ya que alteraría el historial de consumo real.
- **Hoja `RECEPCIÓN`:** al estar 100% vacía (0 valores capturados en 11,966 celdas), se excluye de la carga inicial de `programacion_detalle` y su `area_servicio` correspondiente se marca `activo = FALSE` hasta que el área confirme si el flujo de recepción se captura por otro medio.
- **Reconciliación de catálogo vs. contrato:** los 67/53/14/1 códigos por hoja sin respaldo en `LPL472026` se cargan igualmente en `articulo` (son productos reales, posiblemente estacionales o de licitaciones previas), pero **sin** renglón correspondiente en `contrato_articulo`; la capa de aplicación debe aplicar la regla *poka-yoke* ya definida (`Input(articulo) ∉ Catálogo con contrato vigente ⇒ Rechazo inmediato` de pedido, aunque sí puede programarse en menú).
- **Hojas `TORTILLAS`/`PAN`:** requieren un proceso de **extracción de entidades por expresión regular** sobre el texto libre (`"bolillo mini con sal 150 piezas totopo 15 kg"` → dos renglones: `{producto:'bolillo mini con sal', cantidad:150, unidad:'PIEZA'}` y `{producto:'totopo', cantidad:15, unidad:'KG'}`), seguido de **revisión manual obligatoria** antes de vincular `codigo_articulo`; mientras no exista coincidencia validada en el catálogo, el renglón se carga usando `producto_texto` como respaldo, nunca se descarta.
- **Estandarización de mayúsculas/minúsculas:** aplicar `UPPER()` + `TRIM()` a `DESCRIPCION`/`DESCRIPCIÓN` en ambas fuentes durante la carga a `articulo`.

### 5.4 Reglas de reconciliación de unidades de medida (aplicables a ambas fuentes)

| Valor origen | Unidad destino normalizada |
|---|---|
| `KG`, `'KG   K'` (con basura tipográfica) | `KG` |
| `PIEZA`, `Pza` (dentro de `'Pza 8 GS'`) | `PIEZA` |
| `FRASCO`, `FRASCOS`, `FCO` | `FRASCO` |
| `PAQUETE`, `PAQ` | `PAQUETE` |
| `LITRO`, `LT` | `LITRO` |
| `CAJA`, `CJA` | `CAJA` |
| `BOTE` | `BOTE` |
| `GALON` | `GALON` |
| `BIDON` | `BIDON` |
| `SOBRE`, `SOBRES` | `SOBRE` |
| `BOLSA` | `BOLSA` |
| `MANOJO` | `MANOJO` |
| `LATA` | `LATA` |

### 5.5 Gobernanza posterior a la migración

1. **Congelar la doble captura**: una vez migrado, el libro Excel deja de ser fuente de verdad; toda modificación posterior se realiza contra el esquema `dietologia`.
2. **Job de recálculo de `existencia_almacen`**: ejecutar tras cada lote de `movimiento_inventario` (trigger `AFTER INSERT` recomendado) para mantener el saldo materializado sin depender de vistas costosas en cada consulta de piso.
3. **Alerta de caducidad**: consulta programada diaria sobre `ix_lote_caducidad` para alimentar el proceso de primeras-entradas-primeras-salidas (PEPS/FEFO) que hoy no existe en ninguna de las dos fuentes origen.
4. **Conciliación mensual catálogo-contrato**: reporte automático de artículos en `programacion_detalle` sin `contrato_articulo` activo, para que Compras decida si se incorporan a la siguiente licitación o se descontinúan del menú — cerrando de raíz la brecha detectada en el hallazgo P10.
