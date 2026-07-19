from flask import Flask, request, jsonify
import os
import requests
import xml.etree.ElementTree as ET

app = Flask(__name__)

# ── SEGURANÇA ────────────────────────────────────────────────────────────────
# Estes serviços são proxies de protocolo industrial: qualquer um com acesso
# HTTP a eles consegue dialogar com os CNCs da rede. Defina
# SPINDLEOPS_SERVICE_TOKEN (no backend Node e aqui) para exigir o token;
# sem a variável, o acesso fica aberto (modo dev). /health fica sempre livre.
SERVICE_TOKEN = os.environ.get("SPINDLEOPS_SERVICE_TOKEN")


@app.before_request
def _check_service_token():
    if request.path == "/health":
        return None
    if SERVICE_TOKEN and request.headers.get("X-Service-Token") != SERVICE_TOKEN:
        return jsonify({"error": "unauthorized"}), 401


# Namespaces MTConnect padrão
NS = {
    "m": "urn:mtconnect.org:MTConnectStreams:1.7",
    "p": "urn:mtconnect.org:MTConnectStreams:1.4",
}


def fetch(ip, port, path):
    url = f"http://{ip}:{port}{path}"
    r = requests.get(url, timeout=5)
    r.raise_for_status()
    return r.text


def strip_ns(tag):
    return tag.split("}", 1)[1] if "}" in tag else tag


@app.route("/health")
def health():
    return jsonify({"ok": True, "service": "mtconnect"})


@app.route("/test")
def test():
    """Conecta no /probe — descobre device e capabilities"""
    ip = request.args.get("ip")
    port = int(request.args.get("port", 5000))
    try:
        xml = fetch(ip, port, "/probe")
        root = ET.fromstring(xml)
        devices = []
        for dev in root.iter():
            if strip_ns(dev.tag) == "Device":
                devices.append({
                    "name": dev.attrib.get("name"),
                    "uuid": dev.attrib.get("uuid"),
                    "id": dev.attrib.get("id"),
                })
        return jsonify({"connected": True, "devices": devices})
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)})


@app.route("/read")
def read():
    """Lê o /current — snapshot atual de todos os dataitems"""
    ip = request.args.get("ip")
    port = int(request.args.get("port", 5000))
    try:
        xml = fetch(ip, port, "/current")
        root = ET.fromstring(xml)

        # Extrai todos os DataItems com nome legível
        items = {}
        for el in root.iter():
            tag = strip_ns(el.tag)
            name = el.attrib.get("name") or el.attrib.get("dataItemId")
            if name and el.text and el.text.strip():
                items[name] = el.text.strip()

        # Mapeia campos comuns pro padrão SpindleOps
        def find(*keys):
            for k in keys:
                for item_name, val in items.items():
                    if any(part.lower() in item_name.lower() for part in [k]):
                        return val
            return None

        spindle_speed = find("Sspeed", "spindle_speed", "Sact")
        feed_rate = find("Fact", "feed_rate", "Frt")
        program = find("program", "pgm")
        execution = find("execution", "exec")
        emergency = find("estop", "emergency")

        # Posições
        pos_x = find("Xact", "Xabs")
        pos_y = find("Yact", "Yabs")
        pos_z = find("Zact", "Zabs")

        status = "running" if execution and "ACTIVE" in str(execution).upper() else "idle"

        try:
            spindle_speed = float(spindle_speed) if spindle_speed else None
        except: spindle_speed = None
        try:
            feed_rate = float(feed_rate) if feed_rate else None
        except: feed_rate = None

        return jsonify({
            "connected": True,
            "status": status,
            "program_name": program,
            "spindle_speed": spindle_speed,
            "feed_rate": feed_rate,
            "pos_x": pos_x,
            "pos_y": pos_y,
            "pos_z": pos_z,
            "emergency": emergency,
            "execution": execution,
            "all_items": items,
        })
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)})


if __name__ == "__main__":
    from waitress import serve
    serve(app, host=os.environ.get("BIND_HOST", "127.0.0.1"), port=8769, threads=8)
