# Dietología — Apps Script (Sheets + Web App)

Implementación del modelo de datos de `INFORME_DISENO_BD_DIETOLOGIA.md` sobre
Google Sheets + Apps Script, para uso interno (≈10 usuarios). Ver
`../ADAPTACION_STACK_GOOGLE.md` para el porqué de cada decisión de diseño.

## 1. Requisitos

- Cuenta de Google (Workspace o personal) con acceso a Sheets/Drive/Gmail.
- [`clasp`](https://github.com/google/clasp) instalado: `npm install -g @google/clasp`.
- Node.js sólo para `clasp` (no se usa en tiempo de ejecución; Apps Script corre en el navegador/servidores de Google).

## 2. Primer despliegue

```bash
clasp login                       # abre el navegador, autoriza tu cuenta de Google
```

1. Crea un Google Sheet en blanco (será la base de datos) y anota su ID (el string largo en la URL).
2. Desde ese Sheet: **Extensiones → Apps Script**. Se abre un proyecto vacío ligado a ese Sheet — copia su **Script ID** (Configuración del proyecto ⚙️).
3. En esta carpeta:
   ```bash
   cp .clasp.json.example .clasp.json
   # edita .clasp.json y pega el Script ID copiado en el paso anterior
   clasp push                      # sube appsscript.json y todo src/
   ```
4. Abre el proyecto (`clasp open`) y, desde el editor de Apps Script, ejecuta **una vez**, en este orden:
   - `configurarProyectoInicial` — guarda el ID del Sheet activo y valores por defecto (correos de notificación, días de alerta de caducidad). Ajusta después esos valores en **Configuración del proyecto → Propiedades del script** si hace falta.
   - `crearEstructuraCompleta` — crea las 21 pestañas con encabezados, formato de fecha y listas desplegables.
   - `crearVistasReporte` — crea las 3 pestañas `vista_*` para Looker Studio (quedan vacías hasta que haya datos).

   La primera vez que ejecutes cualquier función te pedirá autorizar los permisos (Sheets, Drive, Docs, Gmail) — es normal, es el propio dueño del Sheet autorizando su copia del script.

## 3. Cargar los datos ya saneados

Los 21 CSV de `../dietologia_normalizado/` ya están limpios (ver `ADAPTACION_STACK_GOOGLE.md` y el informe). Apps Script no puede leer archivos del repositorio directamente, así que:

1. Sube los 21 `.csv` de `dietologia_normalizado/` a una carpeta de Drive (arrastrar y soltar).
2. Copia el ID de esa carpeta (de la URL de Drive).
3. En el editor de Apps Script, ejecuta:
   ```javascript
   importarTodosLosCSV('ID_DE_LA_CARPETA_DE_DRIVE')
   ```
   Carga en orden de dependencia (unidad_medida → … → asignacion_salida_entrada) y en lotes de 5,000 filas. Las tablas que arrancan vacías (`lote`, `orden_suministro`, `movimiento_inventario`, `consolidacion_pedido`, `asignacion_salida_entrada`, etc.) se omiten automáticamente si no subiste su CSV (o se cargan con 0 filas si sí lo subiste).

## 4. Publicar la Web App

**Implementar → Nueva implementación → tipo: Aplicación web**:
- Ejecutar como: *Usuario que accede a la aplicación web* (ya configurado en `appsscript.json`).
- Quién tiene acceso: *Cualquier usuario de \<tu dominio\>* (ajusta si el hospital no usa Workspace con dominio propio; con ~10 usuarios también sirve compartir por lista de correos específica cambiando `access` en `appsscript.json` a `"MYSELF"` + compartir el despliegue manualmente).

La URL de la implementación es la que usan los ~10 usuarios día a día.

## 5. Documentos (Vale de Pedido / Orden de Compra)

`generarValePedido(areaId, fecha)` y `generarPDFOrdenCompra(ordenId)` (en `70_GeneradorDocumentos.gs`) construyen el documento **desde cero** con `DocumentApp`, replicando el layout real de `../formato salida.html` — no necesitan una plantilla previa. Si más adelante quieres partir de una plantilla con membrete diseñado en Google Docs, define `PLANTILLA_VALE_PEDIDO_ID` / `PLANTILLA_ORDEN_COMPRA_ID` en las propiedades del script y usa la función `copiarYRellenarPlantilla_` (comentada al final de `70_GeneradorDocumentos.gs`) como punto de partida.

Configura también `CARPETA_DOCUMENTOS_ID` (propiedad del script) con el ID de una carpeta de Drive donde se guardarán los PDF generados; si no la defines, se guardan en la raíz de tu Drive.

## 6. Notificaciones y vistas (disparadores por tiempo)

En el editor de Apps Script: **Activadores (⏰) → Añadir activador**, uno por cada función, tipo *Basado en tiempo*, diario:

- `alertaCaducidadLotes`
- `alertaTechoContractual`
- `actualizarVistas`

## 7. Qué se validó y qué no (léelo antes de confiar el proyecto)

- **Sí se validó:** toda la lógica de negocio de `01_Utilidades.gs`, `10_Catalogos.gs`, `20_Contratos.gs`, `30_Programacion.gs`, `40_Inventario.gs` y `50_Consolidacion.gs` — se corrió con un arnés de pruebas en Node.js con mocks de `SpreadsheetApp`/`PropertiesService`/`LockService`, reproduciendo el mismo escenario extremo a extremo que se probó contra PostgreSQL real (10 kg Pacientes + 10 kg Comedor → OC de 20 kg → entrada → 2 salidas de 10 kg, incluyendo los 3 casos de rechazo: contrato duplicado activo, sobre-consolidación de OC, sobre-asignación de entrada, y sobregiro de techo contractual). Los 13 pasos del escenario pasaron.
- **No se pudo ejecutar contra Google real** (Sheets/Drive/Gmail/Docs en vivo) porque este entorno no tiene acceso a las APIs de Google — sólo se verificó sintaxis válida de JavaScript/V8 en `02_SetupSheets.gs`, `03_ImportarCSV.gs`, `60_Notificaciones.gs`, `70_GeneradorDocumentos.gs`, `80_WebApp.gs` y `90_Vistas.gs`. Antes de operar con datos reales, corre el flujo completo (pasos 2–6 de este README) sobre un Sheet de prueba.

## 8. Estructura de archivos

Ver la sección 4 de `../ADAPTACION_STACK_GOOGLE.md`.
