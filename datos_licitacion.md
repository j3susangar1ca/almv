# Informe Técnico de Perfilado, Calidad y Reestructuración de Datos
**Proyecto:** Sistematización del Proceso de Programación Mensual de Pedidos de Dietología  
**Origen:** `input_file_0.csv` (Bases / Fallo Licitación LPL47/2026, Partida 2212)  
**Metodología:** Marco TDSP / DAMA-DMBOK (*Data Profiling, Quality Assessment & Dimensional Modeling*)

---

## 1. Perfilado de Estructura y Metadatos (Dataset Profiling)

* **Dimensiones físicas:** 350 líneas de texto plano $\rightarrow$ 348 registros útiles, 1 fila de encabezado y 1 fila residual de totales agregados.
* **Granularidad original:** Renglón licitado por artículo, proveedor adjudicado y distribución de cuotas por unidad hospitalaria.
* **Amplitud:** 36 columnas (altamente desnormalizado; combina atributos del artículo, condiciones comerciales, cuotas físicas y cálculos financieros precomputados).

### Diccionario de Datos y Tipos de Datos (As-Is vs. To-Be)

| # | Nombre de Columna Original | Tipo Detectado | Tipo Propuesto | Nulos (%) | Cardinalidad | Definición / Rol en el Negocio |
|:--|:---|:---:|:---:|:---:|:---:|:---|
| 0 | `CODIGO` | `int64` | `VARCHAR(10)` | 0.00% | 347 | Identificador institucional del insumo (Clave HCG). Tratar como texto para preservar ceros a la izquierda si los hubiera. |
| 1 | `DESCRIPCION` | `object` | `VARCHAR(255)` | 0.00% | 346 | Nombre genérico y especificación del artículo. |
| 2 | `NOMBRE PROVEEDOR` | `object` | `VARCHAR(100)` | 0.00% | 6 | Razón social o persona física adjudicada. |
| 3 | `NUMERO PROVEEDOR` | `object` | `VARCHAR(10)` | 0.00% | 6 | Identificador alfanumérico del proveedor (ej. `3269`, `A4684`). |
| 4 | `PARTIDA` | `int64` | `INT` | 0.00% | 1 | Partida presupuestal gubernamental (constante: `2212`). |
| 5 | `LICITACION` | `object` | `VARCHAR(20)` | 0.00% | 1 | Identificador del procedimiento contractual (constante: `LPL47/2026`). |
| 6-7 | `MINIMO FAA`, `MAXIMO FAA` | `int64` | `INT` | 0.00% | 163 / 164 | Límite físico contractual (piezas/kg) para Hospital Fray Antonio Alcalde. |
| 8-9 | `MINIMO JIM`, `MAXIMO JIM` | `int64` | `INT` | 0.00% | 120 / 129 | Límite físico contractual para Hospital Dr. Juan I. Menchaca. |
| 10-11 | `MINIMO ORI`, `MAXIMO ORI` | `float64` | `INT` | 0.57% | 13 / 13 | Límite físico contractual para Hospital Civil de Oriente. |
| 12-13 | `MINIMO OPD`, `MAXIMO OPD` | `float64` | `INT` | 0.57% | 15 / 16 | Límite físico contractual para Oficinas Centrales OPD. |
| 14-15 | `MINIMO TOTAL`, `MAXIMO TOTAL` | `int64` | `INT` | 0.00% | 236 / 254 | Suma agregada de cuotas físicas: $\sum(\text{FAA} + \text{JIM} + \text{ORI} + \text{OPD})$. |
| 16 | `MARCA` | `object` | `VARCHAR(50)` | 0.00% | 92 | Marca comercial propuesta por el licitante adjudicado. |
| 17 | `AUTORIZA` | `object` | `VARCHAR(50)` | 35.63% | 87 | Marca o fabricante validado técnicamente por el comité. |
| 18 | `PRESENTACION` | `object` | `VARCHAR(30)` | 0.00% | 17 | Unidad de medida / empaque de entrega. |
| 19 | `OBSERVACIONES` | `object` | `VARCHAR(255)` | 98.28% | 6 | Condiciones secundarias de empaque o dosificación. |
| 20 | ` COSTO ` *(con espacios)* | `object` (string) | `DECIMAL(12,2)`| 0.00% | 164 | Precio unitario neto de compra adjudicado (trae prefijo `$` y espacios). |
| 21 | `PRECIO REFERENCIA` | `float64` | `DECIMAL(12,2)`| 0.00% | 243 | Precio de estudio de mercado previo a la licitación. |
| 22 | `FAMILIA` | `object` | `VARCHAR(50)` | 0.00% | 22 | Agrupación taxonómica y logística del insumo. |
| 23 | `ACREDITA` | `object` | `BOOLEAN` | 0.00% | 1 | Estatus de acreditación técnica (constante: `SE ACEPTA`). |
| 24 | `COMENTARIOS` | `float64` | `N/A` | 100.00% | 0 | Sin valor informativo (columna 100% vacía). |
| 25 | `ACREDITA2` | `object` | `VARCHAR(20)` | 0.00% | 1 | Estatus de adjudicación administrativa (constante: `Adjudicado`). |
| 26-33 | `MIN FAA` ... `MAX OPD` | `float64` | `DECIMAL(14,2)`| 0.00% | Varios | Campos calculados: $\text{Cantidad Sede} \times \text{COSTO}$. |
| 34-35 | ` MIN TOTAL `, ` MAX TOTAL ` | `object` (string) | `DECIMAL(14,2)`| 0.00% | 327 / 330 | Campos calculados formateados: $\text{Cantidad Total} \times \text{COSTO}$ (trae `$` y comas). |

---

## 2. Diagnóstico de Calidad de Datos (Data Quality Assessment)

Aplicando las 6 dimensiones de calidad según DAMA:

### A. Integridad Sintáctica y Formato (Syntactic Accuracy)
1. **Espacios parásitos en cabeceras:** Las variables `' COSTO '`, `' MIN TOTAL '` y `' MAX TOTAL '` poseen espacios iniciales y finales, impidiendo la referencia directa mediante scripts SQL o sintaxis orientada a objetos (`df.COSTO`).
2. **Polución de tipos monetarios:** `COSTO`, `MIN TOTAL` y `MAX TOTAL` fueron importados como strings por contener caracteres tipográficos (`$`, comas de miles y espacios). Requieren *casting* forzado a numérico.
3. **Registro footer contaminante:** La fila 350 es un totalizador manual en formato texto (`",,,,,..., $28,523,914.03 "`), lo que rompe procesos de ingestión automatizados si no se excluye por rango de carga.

### B. Unicidad e Integridad de Entidades (Uniqueness)
1. **Colisión de Llave Primaria (`CODIGO`):**
   * El código **`2212001066` (SALSA DE SOYA)** se encuentra duplicado en 2 renglones:
     * Renglón 46: Adjudicado a *DYAMANTE, S.A. DE C.V.* (Marca: *DUEÑA WAN*).
     * Renglón 47: Adjudicado a *MORALES RIOS FELIPE DE JESUS* (Marca: *TOKIO*).
   * **Impacto logístico:** Ambos tienen idéntico costo ($44.00) e idéntica cuota (Mín: 10, Máx: 26). Al no existir un subíndice o código de orden de compra único, un `VLOOKUP` o un `JOIN` estándar genera ambigüedad de asignación o doble imputación de inventario.
2. **Ambigüedad de Descripción / Homonimia:**
   * La descripción **`ZARZAMORA CONGELADA`** aparece con 2 códigos distintos, en familias distintas y con una dispersión de precio del **212%**:
     * `2212001203`: Familia *7 Congelados*, Costo **$250.00**, Máximo: 10 kg.
     * `2212011020`: Familia *8 Frutas y Verduras*, Costo **$80.00**, Máximo: 180 kg.
   * Ambas están adjudicadas al mismo proveedor (*JACOBO GUTIERREZ FABIOLA*). Esto provoca que Dietología seleccione indistintamente un producto con un sobrecosto de $170.00/kg.

### C. Consistencia Semántica y Homogeneidad (Consistency)
1. **Heterogeneidad en `PRESENTACION`:**
   * Existen valores sinónimos no normalizados para un mismo empaque: `FRASCO` (2), `FRASCOS` (11) y `FCO` (5).
   * Errores de captura por pulsación de teclado: `'KG                           K'` (en el código `2212002013`, con múltiples espacios y una consonante espuria).
   * Confusión entre unidad de medida y gramaje en el mismo campo: `'Pza 8 GS'` (debiendo ser Unidad = `PIEZA`, Atributo = `8 GR`).
2. **Columnas de Varianza Cero (Zero-Variance Columns):**
   * `PARTIDA` (100% `2212`), `LICITACION` (100% `LPL47/2026`), `ACREDITA` (100% `SE ACEPTA`), `ACREDITA2` (100% `Adjudicado`), y `COMENTARIOS` (100% nulo). No aportan información para discriminar registros y deben desacoplarse a nivel de metadatos del contrato.

### D. Completitud (Completeness)
* `COMENTARIOS`: 100% nulo (348 registros).
* `OBSERVACIONES`: 98.28% nulo (342 registros). Contiene datos de empaque que deberían estar normalizados en la columna `PRESENTACION` (ej. "PRESENTACION CAJA CON 120 PIEZAS").
* `AUTORIZA`: 35.63% nulo (124 registros).
* `MINIMO ORI`, `MAXIMO ORI`, `MINIMO OPD`, `MAXIMO OPD`: Presentan valores vacíos en las filas 46 y 47 (clave duplicada de salsa de soya), rompiendo la homogeneidad numérica entera (se parsean como `float` debido al `NaN`).

---

## 3. Análisis de Dependencias y Relaciones (Functional Dependencies)

Del análisis matemático de los datos se derivan las siguientes reglas de dependencia:

1. **Redundancia Total en Campos Financieros:**
   Existe una dependencia funcional transitiva y determinista en 10 columnas del dataset:
   $$\text{Monto Sede} = \text{Cantidad Sede} \times \text{COSTO}$$
   $$\text{MAX TOTAL (Monto)} = \sum(\text{MAX Sede}) \times \text{COSTO}$$
   *Tener almacenados los importes por sede y los totales generales en una tabla transaccional es un antipatrón de diseño de bases de datos. Incrementa el riesgo de desincronización si Dietología o Almacén ajustan una celda manualmente.*

2. **Relación Proveedor - Clave:**
   $$\text{NUMERO PROVEEDOR} \longleftrightarrow \text{NOMBRE PROVEEDOR} \quad (1:1)$$
   $$\text{PROVEEDOR} \longrightarrow \text{CODIGO} \quad (1:N)$$
   Cada código está asociado a un único proveedor (excepto la colisión identificada en `2212001066`).

---

## 4. Propuesta de Reestructuración y Normalización (Modelo Relacional / Dimensional)

Para transitar del Excel desestructurado actual a un sistema de captura controlado, el dataset debe descomponerse en una arquitectura relacional en **Tercera Forma Normal (3NF)**:

```
[DIM_PROVEEDOR] 1 ────< N [DIM_ARTICULO] 1 ────< N [REL_CONTRATO_CUOTA] >──── 1 [DIM_SEDE]
                                                          │
                                                          │ 1
                                                          │
                                                          └───< N [FACT_PEDIDO_MENSUAL]
```

### Esquema Físico Propuesto

#### A. Tabla Dimensional: `DIM_PROVEEDOR`
* `proveedor_id` (PK, VARCHAR(10)): ej. `'3269'`, `'A4684'`
* `razon_social` (VARCHAR(100)): ej. `'JACOBO GUTIERREZ FABIOLA'`

#### B. Tabla Dimensional: `DIM_SEDE`
* `sede_id` (PK, VARCHAR(5)): `'FAA'`, `'JIM'`, `'ORI'`, `'OPD'`
* `nombre_sede` (VARCHAR(100)): ej. `'Hospital Civil Fray Antonio Alcalde'`

#### C. Tabla Dimensional: `DIM_ARTICULO`
* `articulo_codigo` (PK, VARCHAR(10)): ej. `'2212002033'`
* `descripcion` (VARCHAR(255))
* `familia_id` (VARCHAR(50)): ej. `'14 Res y Cerdo'`
* `unidad_medida` (VARCHAR(15)): Catálogo estandarizado (`KG`, `PIEZA`, `LITRO`, `CAJA`, `PAQUETE`, `MANOJO`, `LATA`, `FRASCO`, `BOTE`, `GALON`, `BIDON`, `SOBRE`)
* `marca_adjudicada` (VARCHAR(50))
* `marca_autorizada` (VARCHAR(50))
* `especificacion_empaque` (VARCHAR(100)): Datos rescatados de `OBSERVACIONES`

#### D. Tabla Puente / Reglas Contractuales: `REL_CONTRATO_CUOTA`
* `contrato_cuota_id` (PK, INT AUTO_INCREMENT)
* `licitacion` (VARCHAR(20)): `'LPL47/2026'`
* `partida` (INT): `2212`
* `articulo_codigo` (FK $\rightarrow$ `DIM_ARTICULO`)
* `proveedor_id` (FK $\rightarrow$ `DIM_PROVEEDOR`)
* `sede_id` (FK $\rightarrow$ `DIM_SEDE`)
* `precio_unitario` (DECIMAL(10,2)): Valor de `COSTO` limpio
* `precio_referencia` (DECIMAL(10,2))
* `cantidad_minima_anual` (INT)
* `cantidad_maxima_anual` (INT): **Techo estricto e infranqueable**
* `cantidad_sugerida_mensual` (INT): $\lfloor \text{cantidad\_maxima\_anual} / 12 \rfloor$

---

## 5. Pipeline ETL de Limpieza de Datos (Algoritmo de Transformación)

El script de ingestión y limpieza debe ejecutar las siguientes transformaciones deterministas:

```
1. INGESTIÓN:
   - Cargar CSV omitiendo la última fila (skipfooter=1).
   - Aplicar .strip() a todos los nombres de columnas.

2. SANITIZACIÓN DE CADENAS Y FORMATOS:
   - Limpiar campos numéricos monetarios:
     Regex: s.replace(r'[\$,]', '').strip() -> cast a FLOAT / DECIMAL.
   - En PRESENTACION:
     - Reemplazar 'KG   K' -> 'KG'
     - Homogeneizar {'FCO', 'FRASCOS'} -> 'FRASCO'
     - Homogeneizar 'Pza 8 GS' -> 'PIEZA'
   - Imputar nulos en MIN/MAX ORI y OPD con 0.

3. RESOLUCIÓN DE ENTIDADES:
   - Resolver duplicado 2212001066:
     Separar artificialmente la clave en catálogo maestro:
     '2212001066-A' (Dyamante) y '2212001066-B' (Morales Rios), o
     definir en mesa de control de adquisiciones cuál proveedor queda activo.

4. DESPIVOTADO (MELT / UNPIVOT):
   - Transformar la matriz ancha (FAA, JIM, ORI, OPD) a filas normalizadas:
     Columnas finales: [CODIGO, PROVEEDOR, SEDE, CANTIDAD_MIN, CANTIDAD_MAX, PRECIO].

5. PERSISTENCIA:
   - Cargar al Catálogo Maestro Centralizado.
```

---

## 6. Lógica de Validación para la Interfaz de Pedidos de Dietología (Reglas Poka-Yoke)

Con los datos estructurados bajo este esquema, el nuevo sistema de pedidos debe procesar los requerimientos mensuales aplicando las siguientes reglas lógicas en tiempo de captura:

1. **Restricción de Sede:**  
   Dietología de *FAA* solo puede consultar registros donde `sede_id == 'FAA'`. Queda anulada la visibilidad de techos ajenos o globales.
2. **Validación de Clave (Anti-Ítems no licitados):**  
   $\text{Input}(\text{articulo\_codigo}) \notin \text{Catálogo Maestro} \Longrightarrow \textbf{Rechazo Inmediato}$ (No existe campo de texto libre).
3. **Control de Techo Contractual Acumulado:**  
   Sea $Q_{\text{solicitada}}$ la cantidad requerida en el mes actual y $Q_{\text{acumulada}}$ la sumatoria de órdenes previas del ejercicio presupuestal:
   $$\text{Si } (Q_{\text{acumulada}} + Q_{\text{solicitada}}) > \text{cantidad\_maxima\_anual}_{\text{(Sede)}} \Longrightarrow \textbf{Bloqueo Transaccional}$$
   *Mensaje de excepción:* `"El pedido excede el remanente contractual disponible para esta sede."*
4. **Alerta de Variación de Consumo Mensual:**  
   $$\text{Si } Q_{\text{solicitada}} > (1.30 \times \text{cantidad\_sugerida\_mensual}) \Longrightarrow \textbf{Solicitar Justificación Técnica}$$
