# backend/src/api/network.py
"""Blueprint for network graph visualization endpoint.

Exposes:
    GET /api/network/graph
    Returns a node-link JSON structure representing connections between
    suspicious claims, insured clients, and service providers (workshops/clinics).
"""

import sys
from pathlib import Path
# pyrefly: ignore [missing-import]
from flask import Blueprint, jsonify
import sqlite3
import pandas as pd

# Ensure the backend root is on sys.path
BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.ingestion.load_data import load_siniestros, load_asegurados, load_proveedores
from src.rules.fraud_rules import evaluate_record
from src.storage.relational_db import DEFAULT_DB_PATH, ensure_relational_db

network_bp = Blueprint("network", __name__, url_prefix="/api/network")

@network_bp.route("/graph", methods=["GET"])
def get_network_graph():
    """Build and return the network graph of high-risk claims."""
    df_sin = pd.DataFrame()
    try:
        ensure_relational_db(DEFAULT_DB_PATH)
        conn = sqlite3.connect(DEFAULT_DB_PATH)
        try:
            df_sin = pd.read_sql_query("SELECT * FROM claims_enriched", conn)
        finally:
            conn.close()
    except Exception:
        df_sin = pd.DataFrame()

    if df_sin.empty:
        try:
            df_sin = load_siniestros(processed=True)
        except FileNotFoundError:
            try:
                df_sin = load_siniestros(processed=False)
            except FileNotFoundError as exc:
                return jsonify({"error": str(exc)}), 404

    # Load insured client names mapping
    asegurados_map = {}
    try:
        df_aseg = load_asegurados()
        if not df_aseg.empty and "id_asegurado" in df_aseg.columns and "nombre" in df_aseg.columns:
            asegurados_map = df_aseg.set_index("id_asegurado")["nombre"].to_dict()
    except Exception:
        pass

    # Load provider names mapping
    proveedores_map = {}
    try:
        df_prov = load_proveedores()
        if not df_prov.empty and "id_proveedor" in df_prov.columns and "nombre" in df_prov.columns:
            proveedores_map = df_prov.set_index("id_proveedor")["nombre"].to_dict()
    except Exception:
        pass

    # Filter claims to show high and medium risk ones (rojo, amarillo) to avoid clutter
    nodes = []
    edges = []
    
    seen_nodes = set()
    
    # Evaluate all records, sort by final_score descending, and take the top 15 highest risk claims
    evaluated_claims = []
    for _, row in df_sin.iterrows():
        evaluation = evaluate_record(row)
        color = evaluation["final_color"]
        if color in ["rojo", "amarillo"]:
            evaluated_claims.append((row, evaluation))
            
    evaluated_claims = sorted(evaluated_claims, key=lambda x: x[1]["final_score"], reverse=True)
    top_claims = evaluated_claims[:15]
    
    # We will iterate through the top claims and build the nodes and links
    for row, evaluation in top_claims:
        color = evaluation["final_color"]
        score = evaluation["final_score"]
            
        claim_id = str(row["id_siniestro"])
        claim_node_id = f"claim_{claim_id}"
        
        # 1. Claim Node
        if claim_node_id not in seen_nodes:
            nodes.append({
                "id": claim_node_id,
                "label": f"Siniestro #{claim_id}",
                "type": "claim",
                "score": score,
                "color": color,
                "ramo": row.get("ramo", "N/A"),
                "cobertura": row.get("cobertura", "N/A"),
                "monto": float(row.get("monto_reclamado", 0))
            })
            seen_nodes.add(claim_node_id)
            
        # 2. Insured Node
        asegurado_id = str(row["id_asegurado"]) if "id_asegurado" in row and row["id_asegurado"] is not None else None
        if asegurado_id:
            insured_node_id = f"insured_{asegurado_id}"
            if insured_node_id not in seen_nodes:
                insured_name = asegurados_map.get(asegurado_id, f"Asegurado #{asegurado_id}")
                nodes.append({
                    "id": insured_node_id,
                    "label": insured_name,
                    "type": "insured",
                    "id_original": asegurado_id
                })
                seen_nodes.add(insured_node_id)
                
            # Edge: Insured -> Claim
            edges.append({
                "id": f"e_{insured_node_id}_{claim_node_id}",
                "source": insured_node_id,
                "target": claim_node_id,
                "type": "insured_to_claim"
            })
            
        # 3. Provider Node (prefer id_proveedor, fallback to beneficiario)
        prov_id = row.get("id_proveedor")
        if prov_id and str(prov_id).strip() and str(prov_id).strip().lower() != "nan":
            clean_prov_id = str(prov_id).strip()
            provider_node_id = f"provider_{clean_prov_id}"
            if provider_node_id not in seen_nodes:
                label = proveedores_map.get(clean_prov_id) or row.get("proveedor_nombre") or row.get("beneficiario") or f"Proveedor {clean_prov_id}"
                nodes.append({
                    "id": provider_node_id,
                    "label": str(label).strip(),
                    "type": "provider",
                    "id_original": clean_prov_id,
                })
                seen_nodes.add(provider_node_id)

            edges.append({
                "id": f"e_{claim_node_id}_{provider_node_id}",
                "source": claim_node_id,
                "target": provider_node_id,
                "type": "claim_to_provider"
            })
        else:
            beneficiario = row.get("beneficiario")
            if beneficiario and isinstance(beneficiario, str) and beneficiario.strip():
                provider_node_id = f"provider_{beneficiario.strip()}"
                if provider_node_id not in seen_nodes:
                    nodes.append({
                        "id": provider_node_id,
                        "label": beneficiario.strip(),
                        "type": "provider"
                    })
                    seen_nodes.add(provider_node_id)
                edges.append({
                    "id": f"e_{claim_node_id}_{provider_node_id}",
                    "source": claim_node_id,
                    "target": provider_node_id,
                    "type": "claim_to_provider"
                })
            
    return jsonify({
        "nodes": nodes,
        "edges": edges
    })
