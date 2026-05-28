# backend/src/api/agent.py
"""Blueprint for the conversational AI agent endpoint.

Exposes a single endpoint:
    POST /api/agent/chat
    Body:  { "question": "..." }
    Response: { "answer": "..." }

The ClaimsAgent is initialised lazily (once) so the heavy CSV/TF-IDF
setup only happens on the first request, then stays in memory.
"""

import sys
from pathlib import Path

# pyrefly: ignore [missing-import]
from flask import Blueprint, jsonify, request, send_file
from io import BytesIO
from datetime import datetime

# Ensure the backend root is on sys.path
BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

agent_bp = Blueprint("agent", __name__, url_prefix="/api/agent")

# Lazy singleton – initialised on first POST
_agent_instance = None


def _get_agent():
    """Return (or create) the singleton ClaimsAgent."""
    global _agent_instance
    if _agent_instance is None:
        from src.ai_agent.claims_agent import ClaimsAgent  # noqa: PLC0415

        data_dir = BACKEND_ROOT.parent / "data" / "processed"
        _agent_instance = ClaimsAgent(data_dir=str(data_dir))
    return _agent_instance


# ── POST /api/agent/chat ──────────────────────────────────────────────────────
@agent_bp.route("/chat", methods=["POST"])
def chat():
    """Handle a conversational question from the analyst UI."""
    body = request.get_json(silent=True) or {}
    question = (body.get("question") or "").strip()

    if not question:
        return jsonify({"error": "El campo 'question' es requerido."}), 400

    try:
        agent = _get_agent()
        answer = agent.answer_question(question)
        return jsonify({"answer": answer})
    except FileNotFoundError as exc:
        return jsonify({
            "answer": (
                "⚠️ No se encontró el dataset de siniestros. "
                "Por favor, ejecuta el script de ingesta de datos primero.\n\n"
                f"Detalle técnico: {exc}"
            )
        }), 200
    except Exception as exc:  # pragma: no cover
        return jsonify({
            "answer": (
                f"⚠️ Error al inicializar el agente: {exc}\n\n"
                "Verifica que el dataset esté disponible y que GEMINI_API_KEY esté configurado."
            )
        }), 200


@agent_bp.route("/export_pdf", methods=["POST"])
def export_pdf():
    """
    Export a chat session to a PDF for audit purposes.

    Body:
      {
        "title": "optional",
        "messages": [{ "role": "user"|"agent", "text": "..." }]
      }
    """
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "Auditoria - Agente de Fraude").strip()
    messages = body.get("messages") or []

    try:
        from fpdf import FPDF  # fpdf2

        pdf = FPDF()
        pdf.set_auto_page_break(auto=True, margin=12)
        pdf.add_page()

        def _sanitize(text: str) -> str:
            # Replace common Unicode punctuation with ASCII-safe equivalents
            return (
                text.replace("–", "-")
                .replace("—", "-")
                .replace("“", '"')
                .replace("”", '"')
                .replace("’", "'")
            )

        pdf.set_font("Helvetica", "B", 14)
        pdf.multi_cell(0, 8, _sanitize(title))
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 6, _sanitize(f"Generado: {datetime.now().strftime('%Y-%m-%d %H:%M')}"))
        pdf.ln(2)

        for m in messages:
            role = (m.get("role") or "").strip()
            text = (m.get("text") or "").strip()
            if not text:
                continue

            label = "Analista" if role == "user" else "Agente IA"
            pdf.set_font("Helvetica", "B", 11)
            pdf.multi_cell(0, 6, _sanitize(f"{label}:"))
            pdf.set_font("Helvetica", "", 10)
            pdf.multi_cell(0, 5, _sanitize(text))
            pdf.ln(2)

        pdf_bytes = pdf.output(dest="S")
        if isinstance(pdf_bytes, str):
            pdf_bytes = pdf_bytes.encode("latin-1", errors="ignore")

        buf = BytesIO(pdf_bytes)
        buf.seek(0)
        filename = "auditoria_agente.pdf"
        return send_file(
            buf,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=filename,
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
