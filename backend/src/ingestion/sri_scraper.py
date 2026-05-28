import os
import re
import json
import time
import urllib.error
from urllib.parse import urlencode, urlparse, parse_qs
from urllib.request import Request, urlopen
from typing import Any, Dict, Optional

from playwright.async_api import async_playwright, Error as PlaywrightError

SRI_CONSULTA_URL = "https://srienlinea.sri.gob.ec/sri-en-linea/SriRucWeb/ConsultaRuc/Consultas/consultaRuc"
SRI_WEB_URL = "https://srienlinea.sri.gob.ec/sri-en-linea/SriRucWeb/ConsultaRuc"
TWOCAPTCHA_IN_URL = "http://2captcha.com/in.php"
TWOCAPTCHA_RES_URL = "http://2captcha.com/res.php"


def _get_2captcha_key() -> str:
    api_key = os.environ.get("CAPTCHA_2CAPTCHA_KEY") or os.environ.get("TWOCAPTCHA_API_KEY")
    if not api_key:
        raise RuntimeError(
            "CAPTCHA_2CAPTCHA_KEY o TWOCAPTCHA_API_KEY no está configurado en el entorno."
        )
    return api_key


def _extract_sitekey_from_iframe_src(src: str) -> Optional[str]:
    if not src:
        return None
    parsed = urlparse(src)
    params = parse_qs(parsed.query)
    keys = params.get("k") or params.get("sitekey")
    return keys[0] if keys else None


def _post_url(url: str, data: Dict[str, Any]) -> Dict[str, Any]:
    payload = urlencode(data).encode("utf-8")
    request = Request(url, data=payload, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urlopen(request, timeout=120) as response:
        body = response.read().decode("utf-8")
        return json.loads(body)


def _http_get(url: str, headers: Dict[str, str] | None = None) -> str:
    request = Request(url, headers=headers or {})
    with urlopen(request, timeout=120) as response:
        return response.read().decode("utf-8", errors="ignore")


def _http_post(url: str, data: Dict[str, Any], headers: Dict[str, str] | None = None) -> str:
    payload = urlencode(data).encode("utf-8")
    request = Request(url, data=payload, headers=headers or {"Content-Type": "application/x-www-form-urlencoded"})
    with urlopen(request, timeout=120) as response:
        return response.read().decode("utf-8", errors="ignore")


def _parse_html_search_result(html: str, ruc: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        'ruc': ruc,
        'source': 'SRI',
        'exists': True,
    }
    if re.search(r"no existe|no registrado|no se ha encontrado|sin datos|sin resultado|error.*buscar", html, re.I):
        return {
            'ruc': ruc,
            'source': 'SRI',
            'exists': False,
            'message': 'El RUC no aparece como registrado en el SRI.',
            'raw_text': html.strip()[:1600],
        }

    if match := re.search(r"RUC\s*[:\-]?\s*(\d{10,13})", html, re.I):
        result['ruc_encontrado'] = match.group(1).strip()
    if match := re.search(r"Raz[oó]n\s*Social\s*[:\-]?\s*(.+?)(?:<|\n|$)", html, re.I):
        result['razon_social'] = match.group(1).strip()
    if match := re.search(r"Estado\s*[:\-]?\s*([A-Za-záéíóúÁÉÍÓÚ\s]+)", html, re.I):
        result['estado_sri'] = match.group(1).strip()
    if match := re.search(r"Actividad\s*Económica\s*[:\-]?\s*(.+?)(?:<|\n|$)", html, re.I):
        result['actividad_economica'] = match.group(1).strip()

    result['raw_text'] = html.strip()[:1600]
    return result


def _try_direct_sri_search(ruc_num: str) -> Optional[Dict[str, Any]]:
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Referer': SRI_WEB_URL,
    }

    attempts = [
        (SRI_CONSULTA_URL + f"?ruc={ruc_num}"),
        (SRI_CONSULTA_URL + f"?txtId={ruc_num}"),
        (SRI_CONSULTA_URL + f"?txtRuc={ruc_num}"),
    ]
    for url in attempts:
        try:
            html = _http_get(url, headers=headers)
            if re.search(r"recaptcha|g-recaptcha|captcha", html, re.I):
                return None
            if 'estado_sri' in html.lower() or 'razón social' in html.lower() or 'razon social' in html.lower():
                return _parse_html_search_result(html, ruc_num)
        except Exception:
            continue

    post_payloads = [
        {'txtId': ruc_num},
        {'ruc': ruc_num},
        {'txtRuc': ruc_num},
        {'identificacion': ruc_num},
    ]
    for payload in post_payloads:
        try:
            html = _http_post(SRI_CONSULTA_URL, payload, headers=headers)
            if re.search(r"recaptcha|g-recaptcha|captcha", html, re.I):
                return None
            if 'estado_sri' in html.lower() or 'razón social' in html.lower() or 'razon social' in html.lower():
                return _parse_html_search_result(html, ruc_num)
        except Exception:
            continue

    return None


def _solve_recaptcha_with_2captcha(api_key: str, site_key: str, page_url: str) -> str:
    payload = {
        "key": api_key,
        "method": "userrecaptcha",
        "googlekey": site_key,
        "pageurl": page_url,
        "json": 1,
        "invisible": 1,
    }
    response = _post_url(TWOCAPTCHA_IN_URL, payload)
    if response.get("status") != 1:
        raise RuntimeError(f"2Captcha in.php error: {response.get('request')}")

    request_id = response["request"]
    wait_seconds = 5
    max_seconds = 180
    elapsed = 0

    while elapsed < max_seconds:
        time.sleep(wait_seconds)
        elapsed += wait_seconds
        result = _post_url(
            TWOCAPTCHA_RES_URL,
            {
                "key": api_key,
                "action": "get",
                "id": request_id,
                "json": 1,
            },
        )
        if result.get("status") == 1:
            return result["request"]
        if result.get("request") not in ("CAPCHA_NOT_READY", "CAPTCHA_NOT_READY"):
            raise RuntimeError(f"2Captcha error while polling: {result.get('request')}")

    raise RuntimeError("Timeout al resolver el captcha con 2Captcha.")


async def _inject_recaptcha_token(page, token: str) -> None:
    script = """
    (token) => {
        const fields = Array.from(document.querySelectorAll('textarea[name="g-recaptcha-response"], #g-recaptcha-response'));
        for (const field of fields) {
            field.value = token;
            field.innerHTML = token;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
        }

        if (window.grecaptcha && typeof window.grecaptcha.execute === 'function') {
            try {
                window.grecaptcha.execute();
            } catch (e) {
                // ignore: some pages execute automatically after the token is set
            }
        }
    }
    """
    await page.evaluate(script, token)


async def _is_captcha_present(page) -> bool:
    frame = await page.query_selector("iframe[src*='recaptcha']")
    if frame:
        return True
    return await page.query_selector("textarea[name='g-recaptcha-response']") is not None


async def _find_ruc_input(page):
    selectors = [
        "input#ruc",
        "input[name='ruc']",
        "input[name='txt_ruc']",
        "input[name='identificacion']",
        "input[placeholder*='RUC']",
        "input[placeholder*='ruc']",
        "input[type='text']",
    ]
    for selector in selectors:
        element = await page.query_selector(selector)
        if element:
            return selector
    return None


async def _find_submit_button(page):
    selectors = [
        "button[type='submit']",
        "input[type='submit']",
        "button:has-text('Consultar')",
        "button:has-text('Buscar')",
        "button:has-text('Verificar')",
        "button:has-text('Enviar')",
    ]
    for selector in selectors:
        button = await page.query_selector(selector)
        if button:
            return button
    return None


def _normalize_label(label: str) -> str:
    normalized = label.strip().lower()
    mapping = {
        "razón social": "razon_social",
        "nombre o razón social": "razon_social",
        "nombre": "razon_social",
        "estado": "estado_sri",
        "situación": "estado_sri",
        "tipo contribuyente": "tipo_contribuyente",
        "actividad económica": "actividad_economica",
        "actividad economica": "actividad_economica",
        "clase de contribuyente": "clase_contribuyente",
        "dirección matriz": "direccion",
        "direccion matriz": "direccion",
        "domicilio fiscal": "direccion",
        "fecha de inicio de actividades": "fecha_inicio_actividades",
        "fecha de inscripción": "fecha_inscripcion",
        "fecha de inicio de actividades": "fecha_inicio_actividades",
        "fecha de constitución": "fecha_constitucion",
    }
    for key, value in mapping.items():
        if key in normalized:
            return value
    sanitized = re.sub(r"[^a-z0-9_]+", "_", normalized)
    return sanitized


async def _extract_sri_results(page) -> Dict[str, Any]:
    data: Dict[str, Any] = {}
    rows = await page.query_selector_all("table tr")
    for row in rows:
        cells = await row.query_selector_all("th, td")
        if len(cells) != 2:
            continue
        label = (await cells[0].inner_text() or "").strip()
        value = (await cells[1].inner_text() or "").strip()
        if label and value:
            data[_normalize_label(label)] = value

    if not data:
        # Fallback simple heuristics from raw page text
        body = await page.inner_text('body') or ''
        if match := re.search(r"(ACTIVO|ACTIVA|ACTIVO\s*\n)", body, re.I):
            data['estado_sri'] = match.group(1).strip()
        if match := re.search(r"RUC\s*[:\-]?\s*(\d{10,13})", body, re.I):
            data['ruc_encontrado'] = match.group(1).strip()
        if match := re.search(r"Raz[oó]n\s*Social\s*[:\-]?\s*(.+?)(?:\n|$)", body, re.I):
            data['razon_social'] = match.group(1).strip()

    return data


async def _parse_search_result(page, ruc: str) -> Dict[str, Any]:
    body_text = await page.inner_text('body') or ''
    result: Dict[str, Any] = {
        'ruc': ruc,
        'source': 'SRI',
        'exists': True,
    }

    if re.search(r"no existe|no registrado|no se ha encontrado|sin datos|sin resultado|error.*buscar", body_text, re.I):
        result.update({
            'exists': False,
            'message': 'El RUC no aparece como registrado en el SRI.',
            'raw_text': body_text.strip()[:1600],
        })
        return result

    fields = await _extract_sri_results(page)
    if fields:
        result.update(fields)
        result['raw_text'] = body_text.strip()[:1600]
        return result

    result['message'] = 'No se pudo extraer información estructurada del sitio SRI.'
    result['raw_text'] = body_text.strip()[:1600]
    return result


async def consultar_sri_rpa(ruc: str) -> Dict[str, Any]:
    ruc_num = ''.join(ch for ch in str(ruc or '') if ch.isdigit())
    if len(ruc_num) not in (10, 13):
        raise ValueError('RUC inválido: debe contener 10 o 13 dígitos numéricos.')

    direct = _try_direct_sri_search(ruc_num)
    if direct:
        return direct

    api_key = _get_2captcha_key()
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
            ],
        )
        context = await browser.new_context(
            user_agent=(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/122.0.0.0 Safari/537.36'
            ),
            viewport={'width': 1366, 'height': 768},
            locale='es-ES',
        )

        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => false});"
        )

        page = await context.new_page()
        try:
            await page.goto(SRI_CONSULTA_URL, wait_until='domcontentloaded', timeout=60000)
            await page.wait_for_timeout(2500)

            input_selector = await _find_ruc_input(page)
            if not input_selector:
                raise RuntimeError('No se encontró el campo de ingreso de RUC en la página del SRI.')

            await page.fill(input_selector, ruc_num)
            await page.wait_for_timeout(500)

            submit_button = await _find_submit_button(page)
            if submit_button:
                await submit_button.click()
            else:
                await page.press(input_selector, 'Enter')

            await page.wait_for_timeout(4000)

            if await _is_captcha_present(page):
                iframe = await page.query_selector("iframe[src*='recaptcha']")
                site_key = _extract_sitekey_from_iframe_src(await iframe.get_attribute('src') if iframe else '')
                if not site_key:
                    raise RuntimeError('Se detectó un captcha de Google, pero no se pudo extraer el sitekey.')

                token = await asyncio.to_thread(_solve_recaptcha_with_2captcha, api_key, site_key, page.url)
                await _inject_recaptcha_token(page, token)
                await page.wait_for_timeout(1200)
                if submit_button:
                    await submit_button.click()
                else:
                    await page.press(input_selector, 'Enter')
                await page.wait_for_timeout(4000)

            if await _is_captcha_present(page):
                raise RuntimeError('Captcha detectado en el SRI y no pudo resolverse correctamente.')

            return await _parse_search_result(page, ruc_num)
        except PlaywrightError as err:
            raise RuntimeError(f'Error de Playwright en la consulta SRI: {err}')
        finally:
            await context.close()
            await browser.close()
