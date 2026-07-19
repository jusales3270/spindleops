from flask import Flask, request, jsonify
import os
import requests
import socket
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


# Portas comuns Mazak por geração de controle
MAZAK_PORTS = {
    "mtconnect": [5000, 5717, 7878, 7879],   # MTConnect adapter
    "smooth_ax": [683, 5562, 5007],          # Smooth Monitor AX / MC Protocol
    "matrix": [9870, 9871],                  # Matrix / Matrix 2
}


def strip_ns(tag):
    return tag.split("}", 1)[1] if "}" in tag else tag


def try_mtconnect(ip, port, timeout=3):
    """Tenta /probe MTConnect"""
    try:
        url = f"http://{ip}:{port}/probe"
        r = requests.get(url, timeout=timeout)
        if r.status_code == 200 and "MTConnect" in r.text:
            return {"port": port, "type": "mtconnect", "xml_sample": r.text[:200]}
    except: pass
    return None


def try_socket(ip, port, timeout=2):
    """Verifica se a porta TCP aceita conexão"""
    try:
        s = socket.create_connection((ip, port), timeout=timeout)
        s.close()
        return True
    except: return False


@app.route("/health")
def health():
    return jsonify({"ok": True, "service": "mazak"})


@app.route("/discover")
def discover():
    """
    Varre as portas conhecidas Mazak pra descobrir
    qual geração de controle a máquina é.
    """
    ip = request.args.get("ip")
    found = {"mtconnect": [], "smooth_ax": [], "matrix": []}

    # Primeiro tenta MTConnect (mais comum em Mazak moderno)
    for port in MAZAK_PORTS["mtconnect"]:
        r = try_mtconnect(ip, port)
        if r:
            found["mtconnect"].append(r)

    # Depois Smooth AX / Matrix (TCP simples)
    for port in MAZAK_PORTS["smooth_ax"]:
        if try_socket(ip, port):
            found["smooth_ax"].append({"port": port, "tcp_open": True})
    for port in MAZAK_PORTS["matrix"]:
        if try_socket(ip, port):
            found["matrix"].append({"port": port, "tcp_open": True})

    # Recomendação
    if found["mtconnect"]:
        recommended = {"protocol": "mtconnect", "port": found["mtconnect"][0]["port"]}
    elif found["smooth_ax"]:
        recommended = {"protocol": "smooth_ax", "port": found["smooth_ax"][0]["port"]}
    elif found["matrix"]:
        recommended = {"protocol": "matrix", "port": found["matrix"][0]["port"]}
    else:
        recommended = None

    return jsonify({
        "ip": ip,
        "found": found,
        "recommended": recommended,
    })


@app.route("/test")
def test():
    """Tenta MTConnect primeiro (caminho mais limpo)"""
    ip = request.args.get("ip")
    port = int(request.args.get("port", 5000))
    try:
        url = f"http://{ip}:{port}/probe"
        r = requests.get(url, timeout=5)
        r.raise_for_status()
        root = ET.fromstring(r.text)
        devices = []
        for dev in root.iter():
            if strip_ns(dev.tag) == "Device":
                devices.append({
                    "name": dev.attrib.get("name"),
                    "uuid": dev.attrib.get("uuid"),
                    "manufacturer": dev.attrib.get("manufacturer", "Mazak"),
                })
        return jsonify({"connected": True, "via": "mtconnect", "devices": devices})
    except Exception as e:
        return jsonify({"connected": False, "error": str(e), "hint": "Tente /discover primeiro pra encontrar porta certa"})


@app.route("/read")
def read():
    """Lê via MTConnect /current"""
    ip = request.args.get("ip")
    port = int(request.args.get("port", 5000))
    try:
        url = f"http://{ip}:{port}/current"
        r = requests.get(url, timeout=5)
        r.raise_for_status()
        root = ET.fromstring(r.text)

        items = {}
        for el in root.iter():
            name = el.attrib.get("name") or el.attrib.get("dataItemId")
            if name and el.text and el.text.strip():
                items[name] = el.text.strip()

        def find(*keys):
            for k in keys:
                for n, v in items.items():
                    if k.lower() in n.lower():
                        return v
            return None

        try: spindle = float(find("Sspeed", "Sact", "spindle_speed") or 0) or None
        except: spindle = None
        try: feed = float(find("Fact", "feed_rate", "Frt") or 0) or None
        except: feed = None

        execution = find("execution", "exec")
        status = "running" if execution and "ACTIVE" in str(execution).upper() else "idle"

        return jsonify({
            "connected": True,
            "status": status,
            "spindle_speed": spindle,
            "feed_rate": feed,
            "program_name": find("program", "pgm"),
            "execution": execution,
            "all_items": items,
        })
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)})


if __name__ == "__main__":
    from waitress import serve
    serve(app, host=os.environ.get("BIND_HOST", "127.0.0.1"), port=8771, threads=8)
