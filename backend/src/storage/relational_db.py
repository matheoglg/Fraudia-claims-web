"""
SQLite-backed relational data store built from the raw CSVs.

Goal:
- Materialize relational tables (siniestros, polizas, asegurados, proveedores, documentos)
  so API endpoints (search / analytics / agent) can query consistent joins.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pandas as pd

from src.ingestion.load_data import (
    load_siniestros,
    load_polizas,
    load_asegurados,
    load_proveedores,
    load_documentos,
)


PROJECT_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_DB_PATH = PROJECT_ROOT / "fraudia.db"


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    )
    return cur.fetchone() is not None


def ensure_relational_db(db_path: Path = DEFAULT_DB_PATH) -> Path:
    """
    Ensure a SQLite DB exists with the relational tables.

    The build is idempotent: if the required tables exist, it will no-op.
    """
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path)
    try:
        required = {"siniestros", "polizas", "asegurados", "proveedores", "documentos"}
        if all(_table_exists(conn, t) for t in required):
            return db_path

        _build_relational_db(conn)
        return db_path
    finally:
        conn.close()


def _build_relational_db(conn: sqlite3.Connection) -> None:
    # Load from raw/processed loaders (they handle date parsing)
    df_sin = load_siniestros(processed=False)
    df_pol = load_polizas(processed=False)
    df_aseg = load_asegurados(processed=False)
    df_prov = load_proveedores(processed=False)
    df_docs = load_documentos(processed=False)

    # Normalize IDs as strings for reliable joins
    for df, col in [
        (df_sin, "id_siniestro"),
        (df_sin, "id_poliza"),
        (df_sin, "id_asegurado"),
        (df_sin, "id_proveedor"),
        (df_pol, "id_poliza"),
        (df_pol, "id_asegurado"),
        (df_aseg, "id_asegurado"),
        (df_prov, "id_proveedor"),
        (df_docs, "id_siniestro"),
    ]:
        if col in df.columns:
            df[col] = df[col].astype(str)

    df_sin.to_sql("siniestros", conn, if_exists="replace", index=False)
    df_pol.to_sql("polizas", conn, if_exists="replace", index=False)
    df_aseg.to_sql("asegurados", conn, if_exists="replace", index=False)
    df_prov.to_sql("proveedores", conn, if_exists="replace", index=False)
    df_docs.to_sql("documentos", conn, if_exists="replace", index=False)

    # Basic indexes for search + joins
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sin_id ON siniestros(id_siniestro)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sin_pol ON siniestros(id_poliza)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sin_aseg ON siniestros(id_asegurado)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sin_prov ON siniestros(id_proveedor)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pol_id ON polizas(id_poliza)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_aseg_id ON asegurados(id_asegurado)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_prov_id ON proveedores(id_proveedor)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_docs_sin ON documentos(id_siniestro)")

    # Convenience view for enriched claim rows
    conn.execute("DROP VIEW IF EXISTS claims_enriched")
    conn.execute(
        """
        CREATE VIEW claims_enriched AS
        SELECT
          s.*,
          a.nombre AS asegurado_nombre,
          a.cedula AS asegurado_cedula,
          p.fecha_inicio AS poliza_fecha_inicio,
          p.fecha_fin AS poliza_fecha_fin,
          p.suma_asegurada AS poliza_suma_asegurada,
          pr.nombre AS proveedor_nombre,
          pr.tipo_proveedor AS proveedor_tipo
        FROM siniestros s
        LEFT JOIN asegurados a ON a.id_asegurado = s.id_asegurado
        LEFT JOIN polizas p ON p.id_poliza = s.id_poliza
        LEFT JOIN proveedores pr ON pr.id_proveedor = s.id_proveedor
        """
    )
    conn.commit()


def db_query(db_path: Path, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    conn = sqlite3.connect(Path(db_path))
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.execute(sql, params)
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

