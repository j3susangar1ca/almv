#!/usr/bin/env python3
"""
ETL de normalización — Dietología y Nutrición
Lee las fuentes originales SIN MODIFICARLAS (licitacion.csv y
PROGRAMACION_OCTUBRE_26.xlsx) y genera un CSV por cada una de las 19
tablas del modelo 3FN descrito en INFORME_DISENO_BD_DIETOLOGIA.md,
dentro de dietologia_normalizado/.

Reglas de transformación: ver Fase 5 del informe. Las decisiones de
negocio que el informe deja explícitamente a un área funcional (cuál
renglón del código duplicado 2212001066 queda activo, etc.) se resuelven
aquí de forma determinista y se documentan en dietologia_normalizado/LEEME.md.
"""
import re
import csv
from pathlib import Path
from datetime import date

import pandas as pd
import openpyxl

BASE = Path(__file__).parent
OUT = BASE / "dietologia_normalizado"
OUT.mkdir(exist_ok=True)

CSV_PATH = BASE / "licitacion.csv"
XLSX_PATH = BASE / "PROGRAMACION_OCTUBRE_26.xlsx"

NOTES = []  # decisiones de negocio / advertencias, se vuelcan a LEEME.md


def note(msg):
    NOTES.append(msg)
    print("NOTA:", msg)


# =====================================================================
# 0. UTILIDADES DE LIMPIEZA
# =====================================================================

UNIDAD_SINONIMOS = {
    "FRASCO": "FRASCO", "FRASCOS": "FRASCO", "FCO": "FRASCO",
    "KG": "KG", "KG                           K": "KG",
    "PIEZA": "PIEZA", "PZA": "PIEZA",
    "PAQUETE": "PAQUETE", "PAQ": "PAQUETE",
    "LITRO": "LITRO", "LT": "LITRO",
    "CAJA": "CAJA", "CJA": "CAJA",
    "BOTE": "BOTE",
    "GALON": "GALON",
    "BIDON": "BIDON",
    "SOBRE": "SOBRE", "SOBRES": "SOBRE",
    "BOLSA": "BOLSA",
    "MANOJO": "MANOJO",
    "LATA": "LATA",
}

UNIDAD_TIPO = {
    "KG": "PESO", "LITRO": "VOLUMEN", "GALON": "VOLUMEN", "BIDON": "VOLUMEN",
    "PIEZA": "PIEZA", "MANOJO": "PIEZA",
    "PAQUETE": "PAQUETE", "CAJA": "PAQUETE", "FRASCO": "PAQUETE",
    "BOTE": "PAQUETE", "SOBRE": "PAQUETE", "BOLSA": "PAQUETE", "LATA": "PAQUETE",
}


def normaliza_unidad(valor):
    """Normaliza sinónimos y errores de captura de unidad/presentación."""
    if valor is None:
        return None
    v = str(valor).strip()
    if v == "":
        return None
    if v.upper() == "PZA 8 GS":
        return "PIEZA"
    v = re.sub(r"\s+", " ", v).strip().upper()
    return UNIDAD_SINONIMOS.get(v, v)


def normaliza_texto(v):
    if v is None:
        return None
    s = re.sub(r"\s+", " ", str(v)).strip().upper()
    return s if s else None


def limpia_moneda(v):
    """'$ 44.00 ' -> 44.00 ; '' -> None"""
    if v is None:
        return None
    s = str(v).replace("$", "").replace(",", "").strip()
    if s == "" or s.lower() == "nan":
        return None
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def to_number(v, default=None):
    if v is None:
        return default
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip()
    if s == "":
        return default
    try:
        return float(s)
    except ValueError:
        return default


def write_csv(name, rows, columns):
    path = OUT / f"{name}.csv"
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=columns, quoting=csv.QUOTE_MINIMAL)
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in columns})
    print(f"  -> {name}.csv ({len(rows)} filas)")


# =====================================================================
# 1. LECTURA DE FUENTES (solo lectura, nunca se escribe sobre ellas)
# =====================================================================

print("Leyendo licitacion.csv ...")
df_lic = pd.read_csv(CSV_PATH, dtype=str, skipfooter=1, engine="python")
df_lic.columns = [c.strip() for c in df_lic.columns]
# columnas numéricas/monetarias
for c in ["MINIMO FAA", "MAXIMO FAA", "MINIMO JIM", "MAXIMO JIM",
          "MINIMO ORI", "MAXIMO ORI", "MINIMO OPD", "MAXIMO OPD",
          "MINIMO TOTAL", "MAXIMO TOTAL", "PRECIO REFERENCIA"]:
    df_lic[c] = pd.to_numeric(df_lic[c], errors="coerce")
df_lic["COSTO"] = df_lic["COSTO"].apply(limpia_moneda)
df_lic["CODIGO"] = df_lic["CODIGO"].astype(str).str.strip()
df_lic["NUMERO PROVEEDOR"] = df_lic["NUMERO PROVEEDOR"].astype(str).str.strip()
print(f"  {len(df_lic)} renglones de contrato leídos (excluida fila de totales).")

print("Leyendo PROGRAMACION_OCTUBRE_26.xlsx ...")
wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)

CATALOG_SHEETS = ["GENERAL", "RECEPCIÓN", "PACIENTES", "COMEDOR", "JORNADA",
                   "DIETOLOGÍA(S)", "BANCO DE LECHE", "NUTRICIÓN CLÍNICA"]

AREA_CLAVE = {
    "GENERAL": "GENERAL", "RECEPCIÓN": "RECEPCION", "PACIENTES": "PACIENTES",
    "COMEDOR": "COMEDOR", "JORNADA": "JORNADA", "DIETOLOGÍA(S)": "DIETOLOGIA",
    "BANCO DE LECHE": "BANCO_LECHE", "NUTRICIÓN CLÍNICA": "NUTRICION_CLINICA",
    "TORTILLAS": "TORTILLERIA", "PAN": "PANADERIA",
}


def leer_hoja_catalogo(nombre_hoja):
    """Devuelve (filas_articulo, grupos_por_fila) para una hoja de catálogo.
    filas_articulo: lista de dicts {codigo, descripcion, unidad, grupo, dias:{1..31: valor|None}}
    """
    ws = wb[nombre_hoja]
    filas = []
    grupo_actual = None
    for r in range(1, ws.max_row + 1):
        a = ws.cell(row=r, column=1).value
        b = ws.cell(row=r, column=2).value
        if isinstance(a, str) and "GRUPO" in a.upper():
            grupo_actual = normaliza_texto(a.split(":", 1)[-1])
            continue
        if isinstance(a, str) and a.upper() in ("BANCO DE LECHE", "NUTRICIÓN CLÍNICA", "NUTRICION CLINICA"):
            grupo_actual = normaliza_texto(a)
            continue
        if a is None:
            continue
        # clave: puede venir como número o como texto (hallazgo P6)
        codigo = str(a).strip()
        if not re.match(r"^\d+$", codigo):
            continue
        descripcion = normaliza_texto(b)
        unidad = normaliza_unidad(ws.cell(row=r, column=3).value)
        dias = {}
        for d in range(1, 32):
            v = ws.cell(row=r, column=3 + d).value
            dias[d] = to_number(v, default=None)
        filas.append({
            "codigo": codigo, "descripcion": descripcion, "unidad": unidad,
            "grupo": grupo_actual, "dias": dias,
        })
    return filas


datos_hojas = {h: leer_hoja_catalogo(h) for h in CATALOG_SHEETS}
for h, filas in datos_hojas.items():
    print(f"  hoja '{h}': {len(filas)} artículos")

print("Lectura de fuentes completa.\n")

# =====================================================================
# 2. CATÁLOGOS MAESTROS: unidad_medida, familia, grupo_alimento,
#    proveedor, sede
# =====================================================================

print("Construyendo catálogos maestros...")

# --- unidad_medida: unión de unidades normalizadas de ambas fuentes ---
unidades_crudas = set(df_lic["PRESENTACION"].dropna().apply(normaliza_unidad))
for filas in datos_hojas.values():
    for f in filas:
        if f["unidad"]:
            unidades_crudas.add(f["unidad"])
unidades_crudas.discard(None)

unidad_medida_rows = []
unidad_id_por_clave = {}
for i, clave in enumerate(sorted(unidades_crudas), start=1):
    unidad_id_por_clave[clave] = i
    unidad_medida_rows.append({
        "unidad_id": i, "clave": clave,
        "nombre": clave.title(),
        "tipo_medida": UNIDAD_TIPO.get(clave, "PIEZA"),
    })
note(f"unidad_medida: {len(unidad_medida_rows)} unidades únicas tras normalizar sinónimos "
     f"(FRASCO/FRASCOS/FCO, 'KG   K', 'Pza 8 GS', SOBRES->SOBRE, etc.).")

# --- familia: parseo del prefijo numérico de la columna FAMILIA ---
familia_rows = []
familia_id_por_clave = {}
familia_id_por_nombre = {}
for i, valor in enumerate(sorted(df_lic["FAMILIA"].dropna().unique(),
                                  key=lambda s: int(s.split(" ", 1)[0])), start=1):
    clave, nombre = valor.split(" ", 1)
    familia_id_por_clave[clave.strip()] = i
    familia_id_por_nombre[nombre.strip().upper()] = i
    familia_rows.append({"familia_id": i, "clave_presupuestal": clave.strip(),
                          "nombre": nombre.strip()})

# --- grupo_alimento: grupos operativos (hojas) + mapeo N:1 a familia,
#     derivado de los datos (cruce codigo_articulo GENERAL <-> FAMILIA contrato) ---
grupo_por_codigo_general = {f["codigo"]: f["grupo"] for f in datos_hojas["GENERAL"] if f["grupo"]}
familia_por_codigo_lic = dict(zip(df_lic["CODIGO"], df_lic["FAMILIA"]))

from collections import Counter
grupo_a_familias = {}
for codigo, grupo in grupo_por_codigo_general.items():
    fam = familia_por_codigo_lic.get(codigo)
    if fam:
        grupo_a_familias.setdefault(grupo, Counter())[fam] += 1

grupo_alimento_rows = []
grupo_id_por_nombre = {}
grupos_unicos = sorted(set(grupo_por_codigo_general.values()))
for i, grupo in enumerate(grupos_unicos, start=1):
    grupo_id_por_nombre[grupo] = i
    if grupo in grupo_a_familias and grupo_a_familias[grupo]:
        familia_mas_comun, _ = grupo_a_familias[grupo].most_common(1)[0]
        fam_id = familia_id_por_clave[familia_mas_comun.split(" ", 1)[0].strip()]
    else:
        fam_id = None
        note(f"grupo_alimento '{grupo}': sin artículos cruzables con el contrato para "
             f"inferir su familia presupuestal; requiere asignación manual.")
    es_perecedero = grupo not in ("SECOS", "ENLATADOS Y PROCESADOS", "NUTRICIONAL", "CEREALES")
    grupo_alimento_rows.append({
        "grupo_id": i, "familia_id": fam_id, "nombre": grupo,
        "es_perecedero": es_perecedero,
    })
note("grupo_alimento -> familia: mapeo N:1 derivado empíricamente cruzando el código de "
     "artículo entre la hoja GENERAL y el contrato LPL47/2026 (familia más frecuente por "
     "grupo), en vez de mapear por coincidencia de texto.")

# --- proveedor ---
prov = df_lic[["NUMERO PROVEEDOR", "NOMBRE PROVEEDOR"]].drop_duplicates("NUMERO PROVEEDOR")
proveedor_rows = [
    {"proveedor_id": r["NUMERO PROVEEDOR"], "razon_social": normaliza_texto(r["NOMBRE PROVEEDOR"]),
     "activo": True}
    for _, r in prov.iterrows()
]

# --- sede (fija, 4 unidades del contrato) ---
sede_rows = [
    {"sede_id": "FAA", "nombre_sede": "Hospital Civil de Guadalajara Fray Antonio Alcalde", "tipo_sede": "HOSPITAL"},
    {"sede_id": "JIM", "nombre_sede": "Hospital Civil de Guadalajara Dr. Juan I. Menchaca", "tipo_sede": "HOSPITAL"},
    {"sede_id": "ORI", "nombre_sede": "Hospital Civil de Oriente", "tipo_sede": "HOSPITAL"},
    {"sede_id": "OPD", "nombre_sede": "Oficinas Centrales OPD Hospitales Civiles de Guadalajara", "tipo_sede": "OFICINA_CENTRAL"},
]

print(f"  unidad_medida={len(unidad_medida_rows)}  familia={len(familia_rows)}  "
      f"grupo_alimento={len(grupo_alimento_rows)}  proveedor={len(proveedor_rows)}  sede={len(sede_rows)}")

# =====================================================================
# 3. articulo — catálogo maestro único (unión de TODAS las fuentes)
# =====================================================================

print("Construyendo catálogo maestro de artículos...")

# familia -> grupo más frecuente (mapeo inverso, para códigos que sólo
# existen en el contrato y no tienen grupo operativo asignado en ninguna hoja)
familia_a_grupos = {}
for grupo, contador in grupo_a_familias.items():
    for fam, n in contador.items():
        familia_a_grupos.setdefault(fam, Counter())[grupo] += n

atributos_codigo = {}  # codigo -> {descripcion, unidad, grupo}
PRIORIDAD_HOJAS = ["GENERAL", "PACIENTES", "COMEDOR", "JORNADA",
                    "DIETOLOGÍA(S)", "BANCO DE LECHE", "NUTRICIÓN CLÍNICA"]
for hoja in PRIORIDAD_HOJAS:
    for f in datos_hojas[hoja]:
        if f["codigo"] not in atributos_codigo:
            atributos_codigo[f["codigo"]] = {
                "descripcion": f["descripcion"], "unidad": f["unidad"], "grupo": f["grupo"],
            }
        elif atributos_codigo[f["codigo"]]["grupo"] is None and f["grupo"]:
            atributos_codigo[f["codigo"]]["grupo"] = f["grupo"]

codigos_solo_contrato = 0
for _, r in df_lic.iterrows():
    codigo = r["CODIGO"]
    if codigo not in atributos_codigo:
        fam = r["FAMILIA"]
        grupo_inferido = None
        if fam and fam in familia_a_grupos:
            grupo_inferido, _ = familia_a_grupos[fam].most_common(1)[0]
        atributos_codigo[codigo] = {
            "descripcion": normaliza_texto(r["DESCRIPCION"]),
            "unidad": normaliza_unidad(r["PRESENTACION"]),
            "grupo": grupo_inferido,
        }
        codigos_solo_contrato += 1
note(f"articulo: {codigos_solo_contrato} códigos existen únicamente en el contrato "
     f"LPL47/2026 (no aparecen en ninguna hoja de programación); su grupo_alimento se "
     f"infirió a partir de la familia presupuestal más común para ese grupo.")

UNIDAD_DEFECTO = sorted(unidades_crudas)[0]
GRUPO_DEFECTO = grupos_unicos[0]
articulo_rows = []
sin_grupo, sin_unidad = 0, 0
for codigo in sorted(atributos_codigo):
    a = atributos_codigo[codigo]
    grupo_nombre = a["grupo"] or GRUPO_DEFECTO
    if not a["grupo"]:
        sin_grupo += 1
    unidad_clave = a["unidad"] or UNIDAD_DEFECTO
    if not a["unidad"]:
        sin_unidad += 1
    grupo_id = grupo_id_por_nombre.get(grupo_nombre, grupo_id_por_nombre[GRUPO_DEFECTO])
    es_perecedero = next(g["es_perecedero"] for g in grupo_alimento_rows if g["grupo_id"] == grupo_id)
    articulo_rows.append({
        "codigo_articulo": codigo,
        "descripcion": a["descripcion"] or f"ARTICULO {codigo} (SIN DESCRIPCION EN ORIGEN)",
        "grupo_id": grupo_id,
        "unidad_id": unidad_id_por_clave.get(unidad_clave, unidad_id_por_clave[UNIDAD_DEFECTO]),
        "requiere_control_lote": es_perecedero,
        "activo": True,
        "fecha_alta": date.today().isoformat(),
    })
if sin_grupo or sin_unidad:
    note(f"articulo: {sin_grupo} códigos sin grupo_alimento determinable y {sin_unidad} sin "
         f"unidad determinable se cargaron con valores por defecto ('{GRUPO_DEFECTO}' / "
         f"'{UNIDAD_DEFECTO}') — requieren revisión manual antes de producción.")
print(f"  articulo: {len(articulo_rows)} códigos únicos (unión de contrato + 8 hojas de programación).")

# =====================================================================
# 4. almacen, area_servicio
# =====================================================================

# No hay en las fuentes un catálogo explícito de almacenes físicos; se
# crea un almacén central por sede como población mínima operativa.
# Ver LEEME.md.
almacen_rows = []
almacen_id_por_sede = {}
for i, s in enumerate(sede_rows, start=1):
    almacen_id_por_sede[s["sede_id"]] = i
    almacen_rows.append({
        "almacen_id": i, "sede_id": s["sede_id"], "clave_almacen": "CENTRAL",
        "nombre": f"Almacén Central {s['sede_id']}", "tipo_almacen": "CENTRAL",
    })
note("almacen: las fuentes no incluyen un catálogo de almacenes/cocinas físicos; se "
     "generó un almacén CENTRAL por sede como población mínima. Los almacenes "
     "periféricos/cocinas reales deben darse de alta por el área de Dietología.")

AREAS_CON_PROGRAMACION = ["GENERAL", "PACIENTES", "COMEDOR", "JORNADA",
                           "DIETOLOGÍA(S)", "BANCO DE LECHE", "NUTRICIÓN CLÍNICA"]
AREAS_CON_PRODUCCION = ["TORTILLAS", "PAN"]

area_servicio_rows = []
area_id_por_hoja = {}
i = 1
for hoja in AREAS_CON_PROGRAMACION + ["RECEPCIÓN"] + AREAS_CON_PRODUCCION:
    area_id_por_hoja[hoja] = i
    area_servicio_rows.append({
        "area_id": i, "clave": AREA_CLAVE[hoja], "nombre": hoja.title(),
        "almacen_id": almacen_id_por_sede["FAA"],  # hospital sede de captura del libro origen
        "activo": hoja != "RECEPCIÓN",
    })
    i += 1
note("area_servicio 'RECEPCION' se cargó con activo=FALSE: la hoja RECEPCIÓN del libro "
     "origen tiene 0 valores capturados en sus 11,966 celdas de día (hallazgo P4).")
note("area_servicio.almacen_id se asignó a la sede FAA para las 10 áreas por ser el "
     "hospital de origen del libro de programación; debe reasignarse por área real.")

print(f"  almacen={len(almacen_rows)}  area_servicio={len(area_servicio_rows)}")

# =====================================================================
# 5. licitacion, contrato_articulo, cupo_contractual_sede
# =====================================================================

print("Construyendo dominio contractual...")

licitacion_rows = [{
    "licitacion_id": df_lic["LICITACION"].iloc[0],
    "partida": int(df_lic["PARTIDA"].iloc[0]),
    "ejercicio_fiscal": 2026,
    "estatus": "ADJUDICADA",
    "fecha_fallo": "",
}]

# Resolución de la colisión de clave CODIGO=2212001066 (2 proveedores):
# se conserva ACTIVO el primer renglón en orden de aparición en el
# origen y se marca el segundo como histórico (activo=False); es una
# decisión determinista para poder generar el CSV — la decisión de
# negocio real le corresponde a la mesa de control de adquisiciones
# (ver Fase 5 del informe).
vistos_activos = set()
contrato_articulo_rows = []
contrato_id_por_indice = {}
for idx, r in df_lic.iterrows():
    codigo = r["CODIGO"]
    activo = codigo not in vistos_activos
    if activo:
        vistos_activos.add(codigo)
    else:
        note(f"contrato_articulo: código duplicado {codigo} — renglón de "
             f"'{r['NOMBRE PROVEEDOR']}' marcado activo=False (colisión de clave "
             f"CODIGO detectada en el diagnóstico; decisión determinista de ETL, "
             f"pendiente de confirmación por Compras).")
    contrato_id = len(contrato_articulo_rows) + 1
    contrato_id_por_indice[idx] = contrato_id
    contrato_articulo_rows.append({
        "contrato_articulo_id": contrato_id,
        "licitacion_id": r["LICITACION"],
        "codigo_articulo": codigo,
        "proveedor_id": r["NUMERO PROVEEDOR"],
        "marca_adjudicada": normaliza_texto(r["MARCA"]),
        "marca_autorizada": normaliza_texto(r["AUTORIZA"]) if pd.notna(r["AUTORIZA"]) else "",
        "presentacion_comercial": normaliza_unidad(r["PRESENTACION"]) or "",
        "especificacion_empaque": normaliza_texto(r["OBSERVACIONES"]) if pd.notna(r["OBSERVACIONES"]) else "",
        "precio_unitario": r["COSTO"],
        "precio_referencia": r["PRECIO REFERENCIA"] if pd.notna(r["PRECIO REFERENCIA"]) else "",
        "activo": activo,
        "fecha_registro": date.today().isoformat(),
    })

# cupo_contractual_sede: despivote de MINIMO/MAXIMO {FAA,JIM,ORI,OPD};
# sólo se genera una fila cuando el techo máximo de esa sede es > 0
# (un máximo de 0 equivale a "sin asignación para esa sede").
SEDES_COLS = [("FAA", "MINIMO FAA", "MAXIMO FAA"), ("JIM", "MINIMO JIM", "MAXIMO JIM"),
              ("ORI", "MINIMO ORI", "MAXIMO ORI"), ("OPD", "MINIMO OPD", "MAXIMO OPD")]
cupo_contractual_sede_rows = []
cupo_id = 1
for idx, r in df_lic.iterrows():
    contrato_id = contrato_id_por_indice[idx]
    for sede_id, col_min, col_max in SEDES_COLS:
        minimo = r[col_min] if pd.notna(r[col_min]) else 0
        maximo = r[col_max] if pd.notna(r[col_max]) else 0
        if maximo <= 0:
            continue
        cupo_contractual_sede_rows.append({
            "cupo_id": cupo_id, "contrato_articulo_id": contrato_id, "sede_id": sede_id,
            "cantidad_minima_anual": minimo, "cantidad_maxima_anual": maximo,
            "cantidad_acumulada_ejercicio": 0,
        })
        cupo_id += 1
note("cupo_contractual_sede: se omiten las combinaciones artículo-sede con techo máximo "
     "= 0 (equivalen a 'sin asignación'); nulos en MINIMO/MAXIMO ORI/OPD de la colisión "
     "2212001066 se imputaron a 0 antes del filtro, según la Fase 5 del informe.")

print(f"  licitacion={len(licitacion_rows)}  contrato_articulo={len(contrato_articulo_rows)}  "
      f"cupo_contractual_sede={len(cupo_contractual_sede_rows)}")

# =====================================================================
# 6. Tablas operativas sin historial en las fuentes origen (arrancan
#    vacías: sólo se generan la cabecera/columnas del CSV; ninguna fila
#    se inventa porque no existe evidencia de movimientos/pedidos/lotes
#    reales en licitacion.csv ni en PROGRAMACION_OCTUBRE_26.xlsx)
# =====================================================================

lote_rows = []
orden_suministro_rows = []
orden_suministro_detalle_rows = []
movimiento_inventario_rows = []
existencia_almacen_rows = []
consolidacion_pedido_rows = []
asignacion_salida_entrada_rows = []
note("lote, orden_suministro, orden_suministro_detalle, movimiento_inventario, "
     "existencia_almacen, consolidacion_pedido y asignacion_salida_entrada se generan "
     "vacías (sólo encabezado): ninguna de las dos fuentes origen contiene captura real de "
     "lotes, pedidos a proveedor, Kardex de almacén ni del proceso de consolidación de "
     "demanda en Órdenes de Compra (ver Fase 5.1.1 del informe: es un flujo nuevo que el "
     "sistema debe ejecutar hacia adelante, no algo reconstruible desde el Excel histórico).")

# =====================================================================
# 7. programacion_mensual / programacion_detalle — despivote de las 31
#    columnas de día de cada hoja operativa
# =====================================================================

print("Despivotando programación mensual (octubre 2026)...")

ANIO, MES = 2026, 10
import calendar
dias_en_mes = calendar.monthrange(ANIO, MES)[1]

programacion_mensual_rows = []
programacion_detalle_rows = []
prog_id_por_hoja = {}
detalle_id = 1
for hoja in AREAS_CON_PROGRAMACION:
    prog_id = len(programacion_mensual_rows) + 1
    prog_id_por_hoja[hoja] = prog_id
    programacion_mensual_rows.append({
        "programacion_id": prog_id, "area_id": area_id_por_hoja[hoja],
        "anio": ANIO, "mes": MES, "fecha_elaboracion": date.today().isoformat(),
        "estatus": "PUBLICADA",
    })
    for f in datos_hojas[hoja]:
        for dia, cantidad in f["dias"].items():
            if dia > dias_en_mes:
                continue
            if cantidad is None:
                # celda vacía en origen: sin captura, no se inventa un valor (ver P4/P9)
                continue
            programacion_detalle_rows.append({
                "programacion_detalle_id": detalle_id,
                "programacion_id": prog_id,
                "codigo_articulo": f["codigo"],
                "fecha": date(ANIO, MES, dia).isoformat(),
                "cantidad_programada": cantidad,
            })
            detalle_id += 1
note("programacion_detalle: las celdas vacías (None) del origen NO se cargaron como 0 — "
     "se omite la fila para no inventar un dato de consumo que no fue capturado, siguiendo "
     "la recomendación de la Fase 5 del informe de confirmar su significado con Dietología. "
     "La columna TOTAL del Excel se descartó por completo (100% redundante y recalculable "
     "con SUM()).")

print(f"  programacion_mensual={len(programacion_mensual_rows)}  "
      f"programacion_detalle={len(programacion_detalle_rows)}")

# =====================================================================
# 8. produccion_diaria — hojas TORTILLAS (matriz numérica limpia) y PAN
#    (texto libre no atómico, hallazgo P11)
# =====================================================================

print("Reestructurando producción diaria (TORTILLAS / PAN)...")

produccion_diaria_rows = []
prod_id = 1

# --- TORTILLAS: matriz numérica limpia, sólo se despivota ---
ws_tort = wb["TORTILLAS"]
TORTILLA_COLS = [  # (columna, numero_viaje, punto_entrega)
    (2, 1, "DIETAS"), (3, 1, "COMEDOR"), (4, 1, "JORNADA"),
    (5, 2, "DIETAS"), (6, 2, "JORNADA"),
    (7, 3, "COMEDOR"), (8, 3, "JORNADA"),
    (9, 4, "DIETAS"), (10, 4, "COMEDOR"), (11, 4, "JORNADA"),
]
area_tortilleria = area_id_por_hoja["TORTILLAS"]
unidad_pieza = unidad_id_por_clave["PIEZA"]
filas_tortillas = 0
for r in range(3, ws_tort.max_row + 1):
    dia = ws_tort.cell(row=r, column=1).value
    if not isinstance(dia, (int, float)) or dia > dias_en_mes:
        continue
    for col, viaje, punto in TORTILLA_COLS:
        v = to_number(ws_tort.cell(row=r, column=col).value, default=None)
        if v is None or v == 0:
            continue
        produccion_diaria_rows.append({
            "produccion_id": prod_id, "area_id": area_tortilleria,
            "fecha": date(ANIO, MES, int(dia)).isoformat(), "numero_viaje": viaje,
            "codigo_articulo": "", "producto_texto": f"TORTILLA - ENTREGA {punto}",
            "cantidad": v, "unidad_id": unidad_pieza,
        })
        prod_id += 1
        filas_tortillas += 1
note(f"produccion_diaria (TORTILLAS): {filas_tortillas} filas; el destino de entrega "
     "(DIETAS/COMEDOR/JORNADA) se conserva en 'producto_texto' porque el modelo no define "
     "una columna de punto de entrega independiente del área productora. La columna TOTAL "
     "de la hoja se descartó (recalculable con SUM()).")

# --- PAN: texto libre, requiere extracción de entidades (producto, cantidad, unidad) ---
UNIT_MAP_TXT = {
    "piezas": "PIEZA", "pieza": "PIEZA", "piez": "PIEZA", "piezs": "PIEZA", "piz": "PIEZA",
    "pizas": "PIEZA", "pza": "PIEZA", "pz": "PIEZA",
    "kg": "KG", "kgs": "KG",
    "paquetes": "PAQUETE", "paquete": "PAQUETE", "paq": "PAQUETE",
    "cajas": "CAJA", "caja": "CAJA",
}
_UNIT_WORDS = "|".join(sorted(UNIT_MAP_TXT.keys(), key=len, reverse=True))
_MATCH_RE = re.compile(rf"(\d+(?:\.\d+)?)\s*({_UNIT_WORDS})\b\.?", re.IGNORECASE)
_BARE_NUM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*$")


def parse_texto_libre_pan(texto):
    """Extrae (producto, cantidad, unidad) de una celda de texto libre de PAN,
    admitiendo varios artículos por celda separados por coma y ambos órdenes
    'producto cantidad unidad' / 'cantidad unidad producto'."""
    items = []
    for frag in str(texto).split(","):
        frag = frag.strip().strip(",").strip()
        if not frag:
            continue
        matches = list(_MATCH_RE.finditer(frag))
        if not matches:
            m = _BARE_NUM_RE.search(frag)
            if m:
                producto = frag[: m.start()].strip().strip(",").strip()
                items.append((producto.upper() or "PAN (SIN ESPECIFICAR)", float(m.group(1)), "PIEZA"))
            else:
                items.append((frag.upper(), None, None))
            continue
        prev_end = 0
        for i, m in enumerate(matches):
            before = frag[prev_end:m.start()].strip().strip(",").strip()
            next_start = matches[i + 1].start() if i + 1 < len(matches) else len(frag)
            after = frag[m.end():next_start].strip().strip(",").strip()
            producto = before if before else after
            unidad = UNIT_MAP_TXT[m.group(2).lower()]
            items.append(((producto or "PAN (SIN ESPECIFICAR)").upper(), float(m.group(1)), unidad))
            prev_end = m.end() if before else next_start
    return items


ws_pan = wb["PAN"]
PAN_COLS = [
    (2, "DESAYUNO", "DIETAS"), (3, "DESAYUNO", "COMEDOR"), (4, "DESAYUNO", "JORNADA"),
    (5, "COMIDA", "DIETAS"), (6, "COMIDA", "COMEDOR"), (7, "COMIDA", "JORNADA"),
    (8, "CENA", "DIETAS"), (9, "CENA", "COMEDOR"),
]
area_panaderia = area_id_por_hoja["PAN"]
filas_pan, celdas_no_parseadas = 0, 0
for r in range(3, ws_pan.max_row + 1):
    dia = ws_pan.cell(row=r, column=1).value
    if not isinstance(dia, (int, float)) or dia > dias_en_mes:
        continue
    for col, comida, punto in PAN_COLS:
        v = ws_pan.cell(row=r, column=col).value
        if v is None or not str(v).strip():
            continue
        for producto, cantidad, unidad in parse_texto_libre_pan(v):
            if cantidad is None:
                celdas_no_parseadas += 1
                produccion_diaria_rows.append({
                    "produccion_id": prod_id, "area_id": area_panaderia,
                    "fecha": date(ANIO, MES, int(dia)).isoformat(), "numero_viaje": "",
                    "codigo_articulo": "",
                    "producto_texto": f"{comida}-{punto}: {producto} (CANTIDAD NO INTERPRETABLE, REVISAR ORIGEN)",
                    "cantidad": 0, "unidad_id": unidad_pieza,
                })
            else:
                produccion_diaria_rows.append({
                    "produccion_id": prod_id, "area_id": area_panaderia,
                    "fecha": date(ANIO, MES, int(dia)).isoformat(), "numero_viaje": "",
                    "codigo_articulo": "", "producto_texto": f"{comida}-{punto}: {producto}",
                    "cantidad": cantidad,
                    "unidad_id": unidad_id_por_clave.get(unidad, unidad_pieza),
                })
            prod_id += 1
            filas_pan += 1
note(f"produccion_diaria (PAN): {filas_pan} filas extraídas de celdas de texto libre "
     f"mediante expresiones regulares (producto + cantidad + unidad, admitiendo varios "
     f"artículos por celda); {celdas_no_parseadas} fragmentos no tenían una cantidad "
     "interpretable y se cargaron con cantidad=0 y una marca explícita para revisión manual "
     "(hallazgo P11 — no se descartó ninguna celda capturada en el origen).")

print(f"  produccion_diaria={len(produccion_diaria_rows)} "
      f"(TORTILLAS={filas_tortillas}, PAN={filas_pan})")

# =====================================================================
# 9. ESCRITURA DE LOS 19 CSV (uno por tabla) — nunca se sobrescriben
#    licitacion.csv ni PROGRAMACION_OCTUBRE_26.xlsx
# =====================================================================

print(f"\nEscribiendo CSV en {OUT}/ ...")

write_csv("unidad_medida", unidad_medida_rows, ["unidad_id", "clave", "nombre", "tipo_medida"])
write_csv("familia", familia_rows, ["familia_id", "clave_presupuestal", "nombre"])
write_csv("grupo_alimento", grupo_alimento_rows, ["grupo_id", "familia_id", "nombre", "es_perecedero"])
write_csv("proveedor", proveedor_rows, ["proveedor_id", "razon_social", "activo"])
write_csv("sede", sede_rows, ["sede_id", "nombre_sede", "tipo_sede"])
write_csv("articulo", articulo_rows,
          ["codigo_articulo", "descripcion", "grupo_id", "unidad_id",
           "requiere_control_lote", "activo", "fecha_alta"])
write_csv("almacen", almacen_rows, ["almacen_id", "sede_id", "clave_almacen", "nombre", "tipo_almacen"])
write_csv("area_servicio", area_servicio_rows, ["area_id", "clave", "nombre", "almacen_id", "activo"])
write_csv("licitacion", licitacion_rows, ["licitacion_id", "partida", "ejercicio_fiscal", "estatus", "fecha_fallo"])
write_csv("contrato_articulo", contrato_articulo_rows,
          ["contrato_articulo_id", "licitacion_id", "codigo_articulo", "proveedor_id",
           "marca_adjudicada", "marca_autorizada", "presentacion_comercial",
           "especificacion_empaque", "precio_unitario", "precio_referencia", "activo",
           "fecha_registro"])
write_csv("cupo_contractual_sede", cupo_contractual_sede_rows,
          ["cupo_id", "contrato_articulo_id", "sede_id", "cantidad_minima_anual",
           "cantidad_maxima_anual", "cantidad_acumulada_ejercicio"])
write_csv("lote", lote_rows,
          ["lote_id", "codigo_articulo", "proveedor_id", "numero_lote_proveedor",
           "fecha_fabricacion", "fecha_caducidad", "fecha_recepcion"])
write_csv("orden_suministro", orden_suministro_rows,
          ["orden_id", "proveedor_id", "sede_id", "fecha_emision",
           "fecha_entrega_programada", "estatus"])
write_csv("orden_suministro_detalle", orden_suministro_detalle_rows,
          ["orden_detalle_id", "orden_id", "contrato_articulo_id",
           "cantidad_solicitada", "cantidad_recibida"])
write_csv("movimiento_inventario", movimiento_inventario_rows,
          ["movimiento_id", "almacen_id", "codigo_articulo", "lote_id", "tipo_movimiento",
           "cantidad", "orden_detalle_id", "programacion_detalle_id", "fecha_movimiento",
           "referencia_documento"])
write_csv("existencia_almacen", existencia_almacen_rows,
          ["almacen_id", "codigo_articulo", "lote_id", "cantidad_actual"])
write_csv("consolidacion_pedido", consolidacion_pedido_rows,
          ["consolidacion_id", "programacion_detalle_id", "orden_detalle_id", "cantidad_consolidada"])
write_csv("asignacion_salida_entrada", asignacion_salida_entrada_rows,
          ["asignacion_id", "movimiento_salida_id", "movimiento_entrada_id", "cantidad_asignada"])
write_csv("programacion_mensual", programacion_mensual_rows,
          ["programacion_id", "area_id", "anio", "mes", "fecha_elaboracion", "estatus"])
write_csv("programacion_detalle", programacion_detalle_rows,
          ["programacion_detalle_id", "programacion_id", "codigo_articulo", "fecha",
           "cantidad_programada"])
write_csv("produccion_diaria", produccion_diaria_rows,
          ["produccion_id", "area_id", "fecha", "numero_viaje", "codigo_articulo",
           "producto_texto", "cantidad", "unidad_id"])

leeme = OUT / "LEEME.md"
with open(leeme, "w", encoding="utf-8") as f:
    f.write("# Notas de la ejecución del ETL de normalización\n\n")
    f.write(
        "Este directorio se generó automáticamente con `etl_normalizacion.py` a partir de "
        "`licitacion.csv` y `PROGRAMACION_OCTUBRE_26.xlsx` (ninguno de los dos se modifica). "
        "Contiene un CSV por cada una de las 19 tablas del modelo 3FN descrito en "
        "`INFORME_DISENO_BD_DIETOLOGIA.md`, listo para cargarse con `COPY` en el esquema "
        "`dietologia` generado por `schema_dietologia.sql`.\n\n"
        "## Decisiones de negocio tomadas de forma determinista por el ETL\n\n"
        "Las siguientes decisiones estaban señaladas en el informe como pendientes de "
        "definición por un área funcional (Compras/Dietología). Para poder generar los CSV "
        "de forma reproducible se tomó una decisión determinista y documentada; **deben "
        "confirmarse antes de operar en producción**:\n\n"
    )
    for i, n in enumerate(NOTES, start=1):
        f.write(f"{i}. {n}\n")
    f.write(
        "\n## Orden de carga recomendado\n\n"
        "unidad_medida, familia → grupo_alimento → proveedor, sede → articulo → almacen → "
        "area_servicio → licitacion → contrato_articulo → cupo_contractual_sede → lote → "
        "orden_suministro → orden_suministro_detalle → movimiento_inventario → "
        "existencia_almacen → programacion_mensual → programacion_detalle → "
        "produccion_diaria → consolidacion_pedido → asignacion_salida_entrada "
        "(coincide con la Fase 5 del informe). Las dos últimas tablas y el proceso de "
        "consolidación de OC (Fase 5.1.1) son un flujo operativo hacia adelante: arrancan "
        "vacías porque no existen en el histórico de origen.\n"
        "\n**Nota:** después de cargar cualquier tabla por `\\copy` con IDs explícitos "
        "(como `programacion_detalle` o `contrato_articulo`), hay que sincronizar la "
        "secuencia `SERIAL` correspondiente con `SELECT setval(...)` antes de insertar "
        "nuevas filas por la aplicación — `\\copy` no la avanza automáticamente.\n"
    )
print(f"  -> LEEME.md ({len(NOTES)} notas)")
print("\nETL completado.")

