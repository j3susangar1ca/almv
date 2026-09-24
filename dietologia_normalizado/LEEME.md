# Notas de la ejecución del ETL de normalización

Este directorio se generó automáticamente con `etl_normalizacion.py` a partir de `licitacion.csv` y `PROGRAMACION_OCTUBRE_26.xlsx` (ninguno de los dos se modifica). Contiene un CSV por cada una de las 19 tablas del modelo 3FN descrito en `INFORME_DISENO_BD_DIETOLOGIA.md`, listo para cargarse con `COPY` en el esquema `dietologia` generado por `schema_dietologia.sql`.

## Decisiones de negocio tomadas de forma determinista por el ETL

Las siguientes decisiones estaban señaladas en el informe como pendientes de definición por un área funcional (Compras/Dietología). Para poder generar los CSV de forma reproducible se tomó una decisión determinista y documentada; **deben confirmarse antes de operar en producción**:

1. unidad_medida: 16 unidades únicas tras normalizar sinónimos (FRASCO/FRASCOS/FCO, 'KG   K', 'Pza 8 GS', SOBRES->SOBRE, etc.).
2. grupo_alimento -> familia: mapeo N:1 derivado empíricamente cruzando el código de artículo entre la hoja GENERAL y el contrato LPL47/2026 (familia más frecuente por grupo), en vez de mapear por coincidencia de texto.
3. articulo: 27 códigos existen únicamente en el contrato LPL47/2026 (no aparecen en ninguna hoja de programación); su grupo_alimento se infirió a partir de la familia presupuestal más común para ese grupo.
4. almacen: las fuentes no incluyen un catálogo de almacenes/cocinas físicos; se generó un almacén CENTRAL por sede como población mínima. Los almacenes periféricos/cocinas reales deben darse de alta por el área de Dietología.
5. area_servicio 'RECEPCION' se cargó con activo=FALSE: la hoja RECEPCIÓN del libro origen tiene 0 valores capturados en sus 11,966 celdas de día (hallazgo P4).
6. area_servicio.almacen_id se asignó a la sede FAA para las 10 áreas por ser el hospital de origen del libro de programación; debe reasignarse por área real.
7. contrato_articulo: código duplicado 2212001066 — renglón de 'MORALES RIOS FELIPE DE JESUS' marcado activo=False (colisión de clave CODIGO detectada en el diagnóstico; decisión determinista de ETL, pendiente de confirmación por Compras).
8. cupo_contractual_sede: se omiten las combinaciones artículo-sede con techo máximo = 0 (equivalen a 'sin asignación'); nulos en MINIMO/MAXIMO ORI/OPD de la colisión 2212001066 se imputaron a 0 antes del filtro, según la Fase 5 del informe.
9. lote, orden_suministro, orden_suministro_detalle, movimiento_inventario y existencia_almacen se generan vacías (sólo encabezado): ninguna de las dos fuentes origen contiene captura real de lotes, pedidos a proveedor o Kardex de almacén.
10. programacion_detalle: las celdas vacías (None) del origen NO se cargaron como 0 — se omite la fila para no inventar un dato de consumo que no fue capturado, siguiendo la recomendación de la Fase 5 del informe de confirmar su significado con Dietología. La columna TOTAL del Excel se descartó por completo (100% redundante y recalculable con SUM()).
11. produccion_diaria (TORTILLAS): 131 filas; el destino de entrega (DIETAS/COMEDOR/JORNADA) se conserva en 'producto_texto' porque el modelo no define una columna de punto de entrega independiente del área productora. La columna TOTAL de la hoja se descartó (recalculable con SUM()).
12. produccion_diaria (PAN): 101 filas extraídas de celdas de texto libre mediante expresiones regulares (producto + cantidad + unidad, admitiendo varios artículos por celda); 0 fragmentos no tenían una cantidad interpretable y se cargaron con cantidad=0 y una marca explícita para revisión manual (hallazgo P11 — no se descartó ninguna celda capturada en el origen).

## Orden de carga recomendado

unidad_medida, familia → grupo_alimento → proveedor, sede → articulo → almacen → area_servicio → licitacion → contrato_articulo → cupo_contractual_sede → lote → orden_suministro → orden_suministro_detalle → movimiento_inventario → existencia_almacen → programacion_mensual → programacion_detalle → produccion_diaria (coincide con la Fase 5 del informe).
