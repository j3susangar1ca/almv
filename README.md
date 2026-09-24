# ALMV — Sistematización de Dietología y Almacén de Víveres

Herramienta interna (≈10 usuarios) para el Hospital Civil de Guadalajara: programación mensual de pedidos de Dietología, consolidación de esa demanda en Órdenes de Compra, y control de almacén (entradas, salidas, lotes) con trazabilidad completa entre las tres.

## Mapa del proyecto

| Qué | Dónde | Para qué |
|---|---|---|
| Fuentes originales (no se modifican) | `licitacion.csv`, `PROGRAMACION_OCTUBRE_26.xlsx`, `formato salida.html` | Datos reales del contrato LPL47/2026 y la programación operativa; el vale de pedido real que ya usa Dietología. |
| Diagnóstico de calidad + diseño relacional (3FN) | `datos_licitacion.md`, `INFORME_DISENO_BD_DIETOLOGIA.md` | Auditoría de anomalías y el modelo de 21 tablas que resuelve cada una (referencia de diseño, motor-agnóstica). |
| DDL de referencia (PostgreSQL 15+) | `schema_dietologia.sql` | Ruta de salida si el proyecto algún día necesita escalar más allá de Sheets. Validado contra una instancia real. |
| Datos ya saneados | `dietologia_normalizado/*.csv` | Salida del ETL, lista para cargarse — a Postgres o a Sheets. |
| ETL de limpieza | `etl_normalizacion.py` | Transforma las fuentes originales en los 21 CSV, documentando cada decisión de negocio en `dietologia_normalizado/LEEME.md`. |
| **Implementación actual: Google Sheets + Apps Script** | `apps_script/`, `ADAPTACION_STACK_GOOGLE.md` | El stack en el que se está desarrollando la herramienta — ver abajo. |

## Empezar aquí

- **¿Vas a instalar/operar la herramienta?** → `apps_script/README.md`.
- **¿Quieres entender por qué el diseño es así o qué reglas de negocio aplica?** → `INFORME_DISENO_BD_DIETOLOGIA.md` (diagnóstico y modelo) y `ADAPTACION_STACK_GOOGLE.md` (cómo se llevó ese modelo a Sheets/Apps Script).
- **¿Vas a tocar el código de Apps Script?** → `apps_script/src/`, estructura explicada en la sección 4 de `ADAPTACION_STACK_GOOGLE.md`.

## Stack

Google Sheets (base de datos) + Google Apps Script (backend y Web App con Vue 3 + Tailwind vía CDN) + Google Docs/Drive (generación de PDF) + GmailApp (notificaciones) + Looker Studio (tableros). Justificación completa del stack en `ADAPTACION_STACK_GOOGLE.md`, sección 1.
