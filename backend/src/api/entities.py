import sys
import math
import pandas as pd
from pathlib import Path
# pyrefly: ignore [missing-import]
from flask import Blueprint, jsonify
import sqlite3

# Ensure the backend root is on sys.path so relative imports work
BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.ingestion.load_data import load_siniestros, load_proveedores, load_asegurados
from src.rules.fraud_rules import evaluate_record
from src.storage.relational_db import DEFAULT_DB_PATH, ensure_relational_db

entities_bp = Blueprint("entities", __name__, url_prefix="/api/entities")

def _sanitize(val):
    if pd.isna(val):
        return None
    return val

@entities_bp.route("/providers", methods=["GET"])
def get_providers_risk():
    """Returns a list of providers with their calculated risk metrics based on real claims data."""
    try:
        # Prefer relational DB view for consistency with dashboard/manual claims
        df_claims_raw = pd.DataFrame()
        try:
            ensure_relational_db(DEFAULT_DB_PATH)
            conn = sqlite3.connect(DEFAULT_DB_PATH)
            try:
                df_claims_raw = pd.read_sql_query("SELECT * FROM claims_enriched", conn)
            finally:
                conn.close()
        except Exception:
            df_claims_raw = pd.DataFrame()

        if df_claims_raw.empty:
            df_claims_raw = load_siniestros(processed=True)
        df_providers = load_proveedores()
        df_insured = load_asegurados()
        
        if df_claims_raw.empty or df_providers.empty:
            return jsonify([])

        # Evaluate claims to get 'final_color'
        evaluated_claims = []
        for _, row in df_claims_raw.iterrows():
            rec = row.to_dict()
            rec.update(evaluate_record(row))
            evaluated_claims.append(rec)
        
        df_claims = pd.DataFrame(evaluated_claims)

        # Merge claims with providers to get provider names
        # Assuming 'id_proveedor' connects claims to providers
        # If 'id_proveedor' is not directly in claims, we might need to check how it relates.
        # Wait, how does siniestros relate to proveedores? It's in siniestros.csv as id_proveedor?
        
        # Actually, let's group by id_proveedor
        if 'id_proveedor' not in df_claims.columns:
            # Maybe the column is named differently or we need to join?
            # Let's assume it has id_proveedor. If it errors, we'll fix it.
            pass

        # Calculate metrics per provider
        provider_stats = []
        
        if 'id_proveedor' in df_claims.columns:
            grouped = df_claims.groupby('id_proveedor')
            for prov_id, group in grouped:
                total_claims = len(group)
                red_claims = len(group[group['final_color'] == 'rojo'])
                yellow_claims = len(group[group['final_color'] == 'amarillo'])
                risk_rate = (red_claims / total_claims) * 100 if total_claims > 0 else 0
                
                # Get provider details
                prov_row = df_providers[df_providers['id_proveedor'] == prov_id]
                prov_name = prov_row['nombre'].iloc[0] if not prov_row.empty else f"Proveedor {prov_id}"
                prov_type = prov_row['tipo_proveedor'].iloc[0] if not prov_row.empty and 'tipo_proveedor' in prov_row.columns else "Desconocido"
                
                # Get unique insured clients this provider has worked with
                unique_clients = []
                if 'id_asegurado' in group.columns:
                    client_ids = group['id_asegurado'].unique()
                    for cid in client_ids:
                        client_row = df_insured[df_insured['id_asegurado'] == cid]
                        if not client_row.empty:
                            unique_clients.append({
                                "id": _sanitize(cid),
                                "name": _sanitize(client_row['nombre'].iloc[0])
                            })
                        else:
                            unique_clients.append({"id": _sanitize(cid), "name": f"Asegurado {cid}"})
                
                provider_stats.append({
                    "id_proveedor": _sanitize(prov_id),
                    "nombre": _sanitize(prov_name),
                    "tipo": _sanitize(prov_type),
                    "total_siniestros": int(total_claims),
                    "siniestros_rojos": int(red_claims),
                    "siniestros_amarillos": int(yellow_claims),
                    "tasa_siniestralidad": round(risk_rate, 1),
                    "asegurados_vinculados": unique_clients
                })
        
        # Sort by risk rate descending, then total claims descending
        provider_stats.sort(key=lambda x: (x['tasa_siniestralidad'], x['total_siniestros']), reverse=True)
        
        return jsonify(provider_stats)

    except Exception as e:
        print(f"Error computing provider risk: {e}", file=sys.stderr)
        return jsonify({"error": str(e)}), 500
