import os
import re
import asyncio
from flask import Flask, request, jsonify
from flask_cors import CORS

from src.ingestion.sri_scraper import consultar_sri_rpa
from src.integrations.notion_client import create_report_page

app = Flask(__name__)
CORS(app)


def _normalize_ruc(ruc: str) -> str:
    return "".join(ch for ch in str(ruc or "") if ch.isdigit())


def _validate_ec_ruc(ruc: str) -> tuple[bool, dict]:
    ruc_num = _normalize_ruc(ruc)
    if len(ruc_num) not in (10, 13):
        return False, {
            "valid_ruc": False,
            "message": "El RUC debe tener 10 o 13 dígitos numéricos.",
        }

    if not ruc_num.isdigit():
        return False, {
            "valid_ruc": False,
            "message": "El RUC sólo puede contener dígitos.",
        }

    province = int(ruc_num[:2])
    if province < 1 or province > 24:
        return False, {
            "valid_ruc": False,
            "message": "Los dos primeros dígitos deben corresponder a una provincia válida de Ecuador.",
        }

    third_digit = int(ruc_num[2])
    if third_digit in range(0, 6):
        tipo = "Persona Natural"
        valid_checksum = _validate_ec_natural(ruc_num[:10])
        check_message = "Los primeros 10 dígitos no cumplen la fórmula de validación de cédula/RUC natural." if not valid_checksum else "RUC válido para Persona Natural."
    elif third_digit == 6:
        tipo = "Entidad Pública"
        valid_checksum = _validate_ec_public(ruc_num[:9])
        check_message = "Los primeros 9 dígitos no cumplen la fórmula de validación de RUC público." if not valid_checksum else "RUC válido para Entidad Pública."
    elif third_digit == 9:
        tipo = "Sociedad Privada"
        valid_checksum = _validate_ec_private(ruc_num[:10])
        check_message = "Los primeros 10 dígitos no cumplen la fórmula de validación de RUC privado." if not valid_checksum else "RUC válido para Sociedad Privada."
    else:
        return False, {
            "valid_ruc": False,
            "message": "El tercer dígito del RUC debe ser 0-5, 6 o 9 según la normativa ecuatoriana.",
        }

    if not valid_checksum:
        return False, {
            "valid_ruc": False,
            "ruc": ruc_num,
            "tipo": tipo,
            "message": check_message,
        }

    sucursal = ruc_num[10:] if len(ruc_num) == 13 else "001"
    return True, {
        "valid_ruc": True,
        "ruc": ruc_num,
        "tipo": tipo,
        "sucursal": sucursal,
        "main_branch": sucursal in ("001", "000"),
        "message": "RUC válido según la lógica de Ecuador.",
    }


def _validate_ec_natural(cedula: str) -> bool:
    if len(cedula) != 10:
        return False

    coefficients = [2, 1, 2, 1, 2, 1, 2, 1, 2]
    total = 0
    for digit, coef in zip(cedula[:9], coefficients):
        value = int(digit) * coef
        if value > 9:
            value -= 9
        total += value

    expected = 10 - (total % 10)
    if expected == 10:
        expected = 0

    return expected == int(cedula[9])


def _validate_ec_public(cedula: str) -> bool:
    if len(cedula) != 9:
        return False

    coefficients = [3, 2, 7, 6, 5, 4, 3, 2]
    total = sum(int(digit) * coef for digit, coef in zip(cedula[:8], coefficients))

    expected = 11 - (total % 11)
    if expected == 11:
        expected = 0
    if expected == 10:
        return False

    return expected == int(cedula[8])


def _validate_ec_private(cedula: str) -> bool:
    if len(cedula) != 10:
        return False

    coefficients = [4, 3, 2, 7, 6, 5, 4, 3, 2]
    total = sum(int(digit) * coef for digit, coef in zip(cedula[:9], coefficients))

    expected = 11 - (total % 11)
    if expected == 11:
        expected = 0
    if expected == 10:
        return False

    return expected == int(cedula[9])


def _run_async(coro):
    try:
        return asyncio.run(coro)
    except RuntimeError as exc:
        if "asyncio.run() cannot be called from a running event loop" in str(exc):
            loop = asyncio.new_event_loop()
            try:
                return loop.run_until_complete(coro)
            finally:
                loop.close()
        raise


@app.route('/api/validar-sri', methods=['POST'])
def validar_sri():
    data = request.get_json(silent=True) or {}
    ruc = (data.get('ruc') or '').strip()

    if not ruc:
        return jsonify({"error": "RUC es requerido"}), 400

    valid, validation = _validate_ec_ruc(ruc)
    if not valid:
        return jsonify(validation), 400

    try:
        resultado_sri = _run_async(consultar_sri_rpa(validation['ruc']))
        if not resultado_sri:
            return jsonify({"error": "No se pudo obtener respuesta del SRI."}), 502
        return jsonify({"valid_ruc": True, "sri": resultado_sri, **validation}), 200
    except Exception as exc:
        return jsonify({"valid_ruc": True, "ruc": validation['ruc'], "error": str(exc)}), 500


@app.route('/api/escalar-notion', methods=['POST'])
def escalar_notion():
    data = request.get_json(silent=True) or {}
    parent_page_id = os.environ.get('NOTION_PAGE_ID')

    if not parent_page_id:
        return jsonify({"success": False, "error": "NOTION_PAGE_ID no está configurado."}), 500

    title = data.get('title') or f"Investigación SRI - {data.get('ruc', 'sin-ruc')}"
    stats = {
        "ahorro_potencial": float(data.get('score', 0) or 0),
        "monto_total": float(data.get('monto', 0) or 0),
    }
    claim = {
        "id_siniestro": data.get('id_siniestro'),
        "beneficiario": data.get('beneficiario', 'N/A'),
        "ramo": data.get('ramo', 'N/A'),
        "monto_reclamado": float(data.get('monto', 0) or 0),
        "final_color": data.get('final_color', 'N/A'),
    }

    try:
        notion_url = create_report_page(parent_page_id, title, stats, [claim])
        return jsonify({"success": True, "url": notion_url}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
