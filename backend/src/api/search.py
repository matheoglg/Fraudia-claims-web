import sys
from pathlib import Path

# pyrefly: ignore [missing-import]
from flask import Blueprint, jsonify, request

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.storage.relational_db import DEFAULT_DB_PATH, ensure_relational_db, db_query

search_bp = Blueprint("search", __name__, url_prefix="/api/search")


@search_bp.route("", methods=["GET"])
def global_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify(
            {
                "query": "",
                "claims": [],
                "policies": [],
                "providers": [],
                "insured": [],
            }
        )

    ensure_relational_db(DEFAULT_DB_PATH)
    like = f"%{q}%"

    # Claims: search by id, policy, insured, provider/beneficiary, description
    claims = db_query(
        DEFAULT_DB_PATH,
        """
        SELECT
          id_siniestro,
          id_poliza,
          id_asegurado,
          ramo,
          cobertura,
          fecha_ocurrencia,
          monto_reclamado,
          beneficiario,
          asegurado_nombre,
          proveedor_nombre
        FROM claims_enriched
        WHERE
          id_siniestro LIKE ?
          OR id_poliza LIKE ?
          OR id_asegurado LIKE ?
          OR LOWER(COALESCE(beneficiario,'')) LIKE LOWER(?)
          OR LOWER(COALESCE(asegurado_nombre,'')) LIKE LOWER(?)
          OR LOWER(COALESCE(proveedor_nombre,'')) LIKE LOWER(?)
          OR LOWER(COALESCE(descripcion,'')) LIKE LOWER(?)
        LIMIT 10
        """,
        (like, like, like, like, like, like, like),
    )

    policies = db_query(
        DEFAULT_DB_PATH,
        """
        SELECT
          id_poliza,
          id_asegurado,
          fecha_inicio,
          fecha_fin,
          suma_asegurada
        FROM polizas
        WHERE id_poliza LIKE ? OR id_asegurado LIKE ?
        LIMIT 10
        """,
        (like, like),
    )

    providers = db_query(
        DEFAULT_DB_PATH,
        """
        SELECT
          id_proveedor,
          nombre,
          tipo_proveedor
        FROM proveedores
        WHERE id_proveedor LIKE ? OR LOWER(nombre) LIKE LOWER(?)
        LIMIT 10
        """,
        (like, like),
    )

    insured = db_query(
        DEFAULT_DB_PATH,
        """
        SELECT
          id_asegurado,
          cedula,
          nombre
        FROM asegurados
        WHERE id_asegurado LIKE ? OR cedula LIKE ? OR LOWER(nombre) LIKE LOWER(?)
        LIMIT 10
        """,
        (like, like, like),
    )

    return jsonify(
        {
            "query": q,
            "claims": claims,
            "policies": policies,
            "providers": providers,
            "insured": insured,
        }
    )

