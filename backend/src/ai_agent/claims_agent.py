# src/ai_agent/claims_agent.py
"""Claims Agent – Conversational RAG agent for insurance claims.

Uses Gemini 3.1 Flash Lite to answer questions in Spanish about the claims database.
Pre-calculates analytical views (provider rankings, sucursal distributions, top risks,
missing documents) to provide accurate answers to dataset-level questions.
"""

import os
import re
import pandas as pd
import numpy as np
import sqlite3
from pathlib import Path
from typing import Dict, Any, List
from dotenv import load_dotenv
# pyrefly: ignore [missing-import]
from google import genai
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

load_dotenv()  # Load GEMINI_API_KEY from .env

class ClaimsAgent:
    """Agent that answers questions in Spanish about claims, alerts, and providers."""

    def __init__(self, data_dir: str | Path = "data/processed") -> None:
        self.data_dir = Path(data_dir)
        
        # Load processed datasets
        siniestros_path = self.data_dir / "siniestros_processed.csv"
        polizas_path = self.data_dir / "polizas.csv"
        asegurados_path = self.data_dir / "asegurados.csv"
        proveedores_path = self.data_dir / "proveedores.csv"
        documentos_path = self.data_dir / "documentos.csv"
        
        # Fallback to raw if processed features aren't built yet
        if not siniestros_path.exists():
            siniestros_path = Path(__file__).resolve().parents[2] / "data" / "raw" / "siniestros.csv"
            
        if not siniestros_path.exists():
            raise FileNotFoundError(f"Claims dataset not found. Please generate the data first.")
            
        self.df_sin = pd.read_csv(siniestros_path)
        self.df_pol = pd.read_csv(polizas_path) if polizas_path.exists() else pd.DataFrame()
        self.df_aseg = pd.read_csv(asegurados_path) if asegurados_path.exists() else pd.DataFrame()
        self.df_prov = pd.read_csv(proveedores_path) if proveedores_path.exists() else pd.DataFrame()
        self.df_docs = pd.read_csv(documentos_path) if documentos_path.exists() else pd.DataFrame()

        # Prefer relational view if available (enables richer joins for the IA)
        try:
            from src.storage.relational_db import DEFAULT_DB_PATH, ensure_relational_db  # noqa: PLC0415

            ensure_relational_db(DEFAULT_DB_PATH)
            conn = sqlite3.connect(DEFAULT_DB_PATH)
            try:
                self.df_rel = pd.read_sql_query("SELECT * FROM claims_enriched", conn)
            finally:
                conn.close()

            # Use enriched view for analytics + retrieval when present
            if not self.df_rel.empty:
                self.df_sin = self.df_rel
        except Exception:
            self.df_rel = pd.DataFrame()
        
        # Initialize text vectorizer for semantic queries
        self.vectorizer = TfidfVectorizer()
        if "descripcion" in self.df_sin.columns:
            self.tfidf_matrix = self.vectorizer.fit_transform(self.df_sin["descripcion"].astype(str).tolist())
            
        # Ensure scoring columns exist in the working dataframe too (not only in the summary copy)
        self._ensure_scores_inplace()

        # Compile static summary stats to pass to Gemini
        self.dataset_summary = self._generate_dataset_summary()
        
    def _ensure_scores_inplace(self) -> None:
        """Guarantee final_score/final_color exist on self.df_sin for retrieval flows."""
        if self.df_sin.empty:
            return
        if "final_score" in self.df_sin.columns and "final_color" in self.df_sin.columns:
            return

        # Prefer simulated label if present, otherwise default to 0 (verde)
        if "etiqueta_fraude_simulada" in self.df_sin.columns:
            self.df_sin["final_score"] = pd.to_numeric(self.df_sin["etiqueta_fraude_simulada"], errors="coerce").fillna(0) * 85
        else:
            self.df_sin["final_score"] = 0
        self.df_sin["final_color"] = self.df_sin["final_score"].apply(
            lambda s: "rojo" if s > 75 else ("amarillo" if s > 40 else "verde")
        )

    def _generate_dataset_summary(self) -> str:
        """Pre-compute statistics and formats them in Markdown for Gemini's context."""
        df = self.df_sin.copy()
        
        # Total counts
        total = len(df)
        if total == 0:
            return "El dataset está vacío."
            
        # Ensure final_score exists
        if "final_score" not in df.columns:
            # Fallback if features are raw
            if "etiqueta_fraude_simulada" in df.columns:
                df["final_score"] = df["etiqueta_fraude_simulada"] * 85
            else:
                df["final_score"] = 0
            df["final_color"] = df["final_score"].apply(lambda s: "rojo" if s > 75 else ("amarillo" if s > 40 else "verde"))
            
        red_count = (df["final_color"] == "rojo").sum()
        yellow_count = (df["final_color"] == "amarillo").sum()
        green_count = (df["final_color"] == "verde").sum()
        
        # 1. Top 15 Siniestros con mayor riesgo
        top_risk = df.nlargest(15, "final_score")[
            ["id_siniestro", "ramo", "cobertura", "sucursal", "beneficiario", "monto_reclamado", "final_score", "final_color"]
        ]
        top_risk_md = top_risk.to_markdown(index=False)
        
        # 2. Concentración por Proveedores (Beneficiarios)
        # Count total claims, red alerts, and yellow alerts
        prov_stats = df.groupby("beneficiario").agg(
            total_siniestros=("id_siniestro", "count"),
            alertas_rojas=("final_color", lambda x: (x == "rojo").sum()),
            alertas_amarillas=("final_color", lambda x: (x == "amarillo").sum()),
            monto_total_reclamado=("monto_reclamado", "sum")
        ).reset_index()
        prov_stats["alertas_totales"] = prov_stats["alertas_rojas"] + prov_stats["alertas_amarillas"]
        prov_stats = prov_stats.sort_values(by="alertas_rojas", ascending=False).head(10)
        prov_stats_md = prov_stats.to_markdown(index=False)
        
        # 3. Concentración por Ramos
        ramo_stats = df.groupby("ramo").agg(
            total_siniestros=("id_siniestro", "count"),
            alertas_rojas=("final_color", lambda x: (x == "rojo").sum()),
            alertas_amarillas=("final_color", lambda x: (x == "amarillo").sum()),
            monto_total_reclamado=("monto_reclamado", "sum")
        ).reset_index()
        ramo_stats["porcentaje_sospechosos"] = ((ramo_stats["alertas_rojas"] + ramo_stats["alertas_amarillas"]) / ramo_stats["total_siniestros"] * 100).round(2)
        ramo_stats_md = ramo_stats.sort_values(by="porcentaje_sospechosos", ascending=False).to_markdown(index=False)
        
        # 4. Concentración por Sucursales (Ciudades)
        city_stats = df.groupby("sucursal").agg(
            total_siniestros=("id_siniestro", "count"),
            alertas_rojas=("final_color", lambda x: (x == "rojo").sum()),
            alertas_amarillas=("final_color", lambda x: (x == "amarillo").sum()),
            monto_total_reclamado=("monto_reclamado", "sum")
        ).reset_index()
        city_stats["porcentaje_sospechosos"] = ((city_stats["alertas_rojas"] + city_stats["alertas_amarillas"]) / city_stats["total_siniestros"] * 100).round(2)
        city_stats_md = city_stats.sort_values(by="porcentaje_sospechosos", ascending=False).to_markdown(index=False)
        
        # 5. Asegurados con más siniestros
        aseg_counts = df.groupby(["id_asegurado"]).agg(
            total_siniestros=("id_siniestro", "count"),
            monto_total_reclamado=("monto_reclamado", "sum"),
            alertas_rojas=("final_color", lambda x: (x == "rojo").sum())
        ).reset_index()
        # Join with client name
        if not self.df_aseg.empty and "nombre" in self.df_aseg.columns:
            name_dict = self.df_aseg.set_index("id_asegurado")["nombre"].to_dict()
            aseg_counts["nombre_asegurado"] = aseg_counts["id_asegurado"].map(name_dict)
        else:
            aseg_counts["nombre_asegurado"] = "N/A"
            
        top_aseg_md = aseg_counts.sort_values(by="total_siniestros", ascending=False).head(10).to_markdown(index=False)
        
        # 6. Documentos faltantes en casos críticos
        criticos_df = df[df["final_color"].isin(["rojo", "amarillo"]) & (df["documentos_completos"] == "No")]
        missing_docs_list = []
        if not self.df_docs.empty and not criticos_df.empty:
            for idx, r in criticos_df.head(10).iterrows():
                sid = r["id_siniestro"]
                missing = self.df_docs[(self.df_docs["id_siniestro"] == sid) & (self.df_docs["entregado"] == "No")]["tipo_documento"].tolist()
                missing_docs_list.append({
                    "id_siniestro": sid,
                    "color": r["final_color"],
                    "beneficiario": r["beneficiario"],
                    "documentos_faltantes": ", ".join(missing) or "Ninguno (marcado incompleto por legibilidad)"
                })
        missing_docs_md = pd.DataFrame(missing_docs_list).to_markdown(index=False) if missing_docs_list else "No hay casos críticos con documentos faltantes en el top."
        
        # 7. Siniestros cercanos al inicio de póliza (<= 10 días)
        cercanos_df = df[df["dias_desde_inicio_poliza"] <= 10].sort_values(by="dias_desde_inicio_poliza")
        cercanos_md = cercanos_df[["id_siniestro", "id_poliza", "dias_desde_inicio_poliza", "monto_reclamado", "final_score", "final_color"]].head(10).to_markdown(index=False)
        
        # 8. Casos con montos atípicos (reclamos mayores a $12,000 o cercanos a la suma asegurada)
        cerca_mask = (df["monto_cercano_suma_asegurada"] == 1) if "monto_cercano_suma_asegurada" in df.columns else pd.Series(False, index=df.index)
        atipicos_df = df[(df["monto_reclamado"] > 12000) | cerca_mask].sort_values(by="monto_reclamado", ascending=False)
        atip_cols = ["id_siniestro", "ramo", "cobertura", "monto_reclamado", "final_score", "final_color"]
        if "suma_asegurada" in df.columns:
            atip_cols.insert(4, "suma_asegurada")
        atipicos_md = atipicos_df[atip_cols].head(10).to_markdown(index=False)

        summary = f"""
### RESUMEN CONSOLIDADO DE LA CARPETA DE SINIESTROS:
- **Total Siniestros**: {total}
- **Alertas Rojas (Riesgo Alto)**: {red_count} ({(red_count/total*100):.2f}%)
- **Alertas Amarillas (Riesgo Medio)**: {yellow_count} ({(yellow_count/total*100):.2f}%)
- **Casos Verdes (Riesgo Bajo)**: {green_count} ({(green_count/total*100):.2f}%)

### 1. TOP 15 SINIESTROS DE MAYOR RIESGO
{top_risk_md}

### 2. CONCENTRACIÓN DE ALERTAS POR PROVEEDORES (TALLERES/CLÍNICAS/PERITOS)
{prov_stats_md}

### 3. CONCENTRACIÓN DE ALERTAS POR RAMO DE SEGURO
{ramo_stats_md}

### 4. CONCENTRACIÓN DE ALERTAS POR SUCURSAL / CIUDAD (SUR DE ECUADOR)
{city_stats_md}

### 5. ASEGURADOS CON MAYOR FRECUENCIA DE RECLAMOS
{top_aseg_md}

### 6. DOCUMENTOS FALTANTES EN SINIESTROS CRÍTICOS INCOMPLETOS
{missing_docs_md}

### 7. SINIESTROS OCURRIDOS CERCA DEL INICIO DE LA PÓLIZA (<= 10 DÍAS)
{cercanos_md}

### 8. SINIESTROS CON MONTOS ATÍPICOS O CERCANOS A LA SUMA ASEGURADA
{atipicos_md}
"""
        return summary

    def _retrieve_similar_claims(self, query: str, top_k: int = 3) -> str:
        """Find the top_k most semantically similar claims in the dataset using TF-IDF."""
        if not hasattr(self, "tfidf_matrix") or self.df_sin.empty:
            return ""
        
        query_vec = self.vectorizer.transform([query])
        sims = cosine_similarity(query_vec, self.tfidf_matrix).flatten()
        top_idx = np.argsort(sims)[-top_k:][::-1]
        
        retrieved_df = self.df_sin.iloc[top_idx][
            ["id_siniestro", "ramo", "cobertura", "monto_reclamado", "final_score", "final_color", "descripcion"]
        ]
        return "\nSiniestros similares encontrados en el archivo histórico:\n" + retrieved_df.to_markdown(index=False)

    def answer_question(self, question: str) -> str:
        """Answer the analyst's question in natural language in Spanish."""
        # 1. Check if the query asks for a specific claim (e.g. "siniestro 14", "id 25", "reclamo 100")
        match = re.search(r'(?:siniestro|reclamo|caso|id)\s*#?\s*(\d+)', question, re.IGNORECASE)
        specific_context = ""
        
        if match:
            claim_id = int(match.group(1))
            specific_claim = self.df_sin[self.df_sin["id_siniestro"] == claim_id]
            if not specific_claim.empty:
                rec = specific_claim.iloc[0]
                triggered = []
                # Check what rules are in play (based on features)
                if rec.get("dias_desde_inicio_poliza", 999) <= 2 or rec.get("dias_desde_fin_poliza", 999) <= 2:
                    triggered.append("RF05 (Borde de Vigencia < 48h)")
                if "robo" in str(rec.get("cobertura", "")).lower() and rec.get("dias_entre_ocurrencia_reporte", 0) > 4:
                    triggered.append("RF06 (Demora en Reporte de Robo > 4 días)")
                if rec.get("narrativa_clonada", 0) == 1:
                    triggered.append("RF07 (Narrativa Clonada)")
                if rec.get("proveedor_lista_restrictiva", 0) == 1:
                    triggered.append("RF03 (Proveedor en Lista Restrictiva)")
                if rec.get("documento_alterado", 0) == 1:
                    triggered.append("RF02 (Inconsistencia Documental)")
                if rec.get("relato_ilogico", 0) == 1:
                    triggered.append("RF04 (Dinámica Físicamente Imposible)")
                
                # Fetch documents status
                docs_status = ""
                if not self.df_docs.empty:
                    claim_docs = self.df_docs[self.df_docs["id_siniestro"] == claim_id]
                    docs_status = "\nDocumentos Relacionados:\n" + claim_docs[["tipo_documento", "entregado", "legible", "inconsistencia_detectada", "observacion"]].to_markdown(index=False)
                
                specific_context = f"""
### DETALLES ESPECÍFICOS DEL SINIESTRO CONSULTADO (Siniestro #{claim_id}):
- **ID Siniestro**: {rec.get('id_siniestro')}
- **ID Póliza**: {rec.get('id_poliza')}
- **Asegurado**: {rec.get('id_asegurado')}
- **Ramo**: {rec.get('ramo')}
- **Cobertura**: {rec.get('cobertura')}
- **Fecha Ocurrencia**: {rec.get('fecha_ocurrencia')}
- **Fecha Reporte**: {rec.get('fecha_reporte')}
- **Monto Reclamado**: ${rec.get('monto_reclamado'):,.2f}
- **Monto Estimado**: ${rec.get('monto_estimado'):,.2f}
- **Sucursal**: {rec.get('sucursal')}
- **Beneficiario**: {rec.get('beneficiario')}
- **Estado**: {rec.get('estado')}
- **Score Final de Riesgo**: {rec.get('final_score')}/100 ({rec.get('final_color').upper()})
- **Días desde Inicio Póliza**: {rec.get('dias_desde_inicio_poliza')}
- **Días desde Fin Póliza**: {rec.get('dias_desde_fin_poliza')}
- **Diferencia Ocurrencia-Reporte**: {rec.get('dias_entre_ocurrencia_reporte')} días
- **Narrativa del Reclamo**: "{rec.get('descripcion')}"
- **Reglas Duras Activadas**: {", ".join(triggered) or "Ninguna"}
{docs_status}
"""
        
        # 2. Check if the question is semantic and retrieve similar claims
        similar_claims_context = ""
        if len(question) > 20 and not match:
            similar_claims_context = self._retrieve_similar_claims(question)
            
        # Build prompt
        system_instruction = """
        Eres un agente experto en análisis de fraude de seguros y auditoría para "Aseguradora del Sur" (Ecuador).
        Tu función es ayudar a los analistas humanos a revisar reclamos sospechosos utilizando información consolidada del dataset.
        Responde SIEMPRE en español con un tono profesional, analítico y preventivo.

        PAUTAS IMPORTANTES:
        - Utiliza las tablas de estadísticas y los datos provistos en el contexto para dar respuestas exactas y numéricas.
        - No inventes estadísticas si no están en las tablas; cita las cifras exactas que aparecen en el "Resumen Consolidado".
        - Explica que el sistema genera alertas de posible fraude para que un analista humano decida, y nunca acuses formalmente a un cliente de fraude.
        - El dólar de EE.UU. (USD $) es la moneda oficial de Ecuador, así que presenta los montos financieros en dólares con el formato adecuado.
        - Enfócate en la zona sur de Ecuador (Loja, Cuenca, Machala, Zamora, Azogues) y menciona estos nombres con orgullo local.
        """
        
        prompt = f"""
{system_instruction}

CONTEXTO DEL DATASET DE SINIESTROS DE ASEGURADORA DEL SUR:
{self.dataset_summary}

{specific_context}

{similar_claims_context}

Pregunta del Analista: "{question}"

Respuesta del Agente de IA:
"""
        
        try:
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key:
                return "Error: GEMINI_API_KEY no configurado en el archivo .env. " \
                       "Por favor, configure la clave de la API para interactuar con el agente conversacional."

            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model="gemini-3.1-flash-lite",
                contents=prompt,
            )
            return response.text.strip()
        except Exception as e:
            return f"Error en la interacción con el Agente de Gemini: {str(e)}\n\n" \
                   f"Intenta revisar los datos directamente en el panel del Dashboard."

if __name__ == "__main__":
    agent = ClaimsAgent()
    print("Agent initialized successfully!")
    q = "¿Cuáles son los 10 siniestros con mayor riesgo de posible fraude?"
    print(f"Q: {q}")
    print(agent.answer_question(q))
