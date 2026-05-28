import sys
import pandas as pd
from pathlib import Path
# pyrefly: ignore [missing-import]
from flask import Blueprint, jsonify
import sqlite3

# Ensure the backend root is on sys.path so relative imports work
BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from src.ingestion.load_data import load_siniestros
from src.rules.fraud_rules import evaluate_record
from src.storage.relational_db import DEFAULT_DB_PATH, ensure_relational_db

reports_bp = Blueprint("reports", __name__, url_prefix="/api/reports")

def _sanitize(val):
    if pd.isna(val):
        return None
    return val

@reports_bp.route("/stats", methods=["GET"])
def get_report_stats():
    """Returns analytics based on real claims data."""
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
        if df_claims_raw.empty:
            return jsonify({
                "ahorro_potencial": 0,
                "monto_total": 0,
                "heatmap_data": [],
                "riesgo_por_ramo": []
            })

        # Evaluate claims to get 'final_color'
        evaluated_claims = []
        for _, row in df_claims_raw.iterrows():
            rec = row.to_dict()
            rec.update(evaluate_record(row))
            evaluated_claims.append(rec)
            
        df_claims = pd.DataFrame(evaluated_claims)

        # Ahorro potencial: suma de monto_reclamado de todos los siniestros rojos
        red_claims = df_claims[df_claims['final_color'] == 'rojo']
        ahorro_potencial = red_claims['monto_reclamado'].sum() if 'monto_reclamado' in red_claims.columns else 0
        monto_total = df_claims['monto_reclamado'].sum() if 'monto_reclamado' in df_claims.columns else 0

        # Concentración por sucursal (Heatmap data)
        heatmap_data = []
        if 'sucursal' in df_claims.columns:
            # Agrupar solo los rojos por sucursal para ver la concentración del riesgo
            grouped_sucursal = red_claims.groupby('sucursal').size().reset_index(name='count')
            for _, row in grouped_sucursal.iterrows():
                heatmap_data.append({
                    "sucursal": _sanitize(row['sucursal']),
                    "siniestros_rojos": int(row['count'])
                })
            heatmap_data.sort(key=lambda x: x['siniestros_rojos'], reverse=True)

        # Concentración por ramo
        riesgo_ramo = []
        if 'ramo' in df_claims.columns:
            grouped_ramo = red_claims.groupby('ramo').size().reset_index(name='count')
            for _, row in grouped_ramo.iterrows():
                riesgo_ramo.append({
                    "ramo": _sanitize(row['ramo']),
                    "siniestros_rojos": int(row['count'])
                })
            riesgo_ramo.sort(key=lambda x: x['siniestros_rojos'], reverse=True)

        return jsonify({
            "ahorro_potencial": float(ahorro_potencial),
            "monto_total": float(monto_total),
            "heatmap_data": heatmap_data,
            "riesgo_por_ramo": riesgo_ramo
        })

    except Exception as e:
        print(f"Error computing report stats: {e}", file=sys.stderr)
        return jsonify({"error": str(e)}), 500
