from flask import Flask, request, jsonify
import os
import snap7
from snap7.util import get_real, get_int, get_dint, get_bool

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



def connect(ip, rack=0, slot=2):
    """
    Conecta na CNC Siemens Sinumerik 840D.
    Rack=0, Slot=2 é padrão para NCK do 840D.
    Para PLC use Slot=3.
    """
    client = snap7.client.Client()
    client.connect(ip, rack, slot)
    return client


@app.route("/health")
def health():
    return jsonify({"ok": True, "service": "s7"})


@app.route("/test")
def test():
    ip = request.args.get("ip")
    rack = int(request.args.get("rack", 0))
    slot = int(request.args.get("slot", 2))
    try:
        client = connect(ip, rack, slot)
        connected = client.get_connected()
        info = client.get_cpu_info()
        client.disconnect()
        return jsonify({
            "connected": connected,
            "module_typename": info.ModuleTypeName.decode(errors="ignore"),
            "serial": info.SerialNumber.decode(errors="ignore"),
            "as_name": info.ASName.decode(errors="ignore"),
        })
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)})


@app.route("/scan-slots")
def scan_slots():
    """
    Tenta vários rack/slot para descobrir onde o CN responde.
    Útil quando você não sabe a configuração do Sinumerik.
    """
    ip = request.args.get("ip")
    results = []
    for rack in [0, 1]:
        for slot in [0, 1, 2, 3, 4]:
            try:
                client = snap7.client.Client()
                client.set_connection_params(ip, 0x0100, (rack * 0x20) + slot)
                client.connect(ip, rack, slot)
                if client.get_connected():
                    info = client.get_cpu_info()
                    results.append({
                        "rack": rack,
                        "slot": slot,
                        "connected": True,
                        "module": info.ModuleTypeName.decode(errors="ignore"),
                    })
                client.disconnect()
            except Exception as e:
                results.append({
                    "rack": rack,
                    "slot": slot,
                    "connected": False,
                    "error": str(e)[:80]
                })
    return jsonify(results)


@app.route("/read")
def read():
    """
    Leitura básica via DB (Data Block).
    Os endereços específicos do Sinumerik 840D variam por máquina.
    Por enquanto retorna info do CPU e tenta ler DB1.
    """
    ip = request.args.get("ip")
    rack = int(request.args.get("rack", 0))
    slot = int(request.args.get("slot", 2))
    try:
        client = connect(ip, rack, slot)
        cpu_info = client.get_cpu_info()
        state = client.get_cpu_state()
        client.disconnect()
        return jsonify({
            "connected": True,
            "cpu_state": state,
            "module": cpu_info.ModuleTypeName.decode(errors="ignore"),
            "status": "running" if "RUN" in state else "idle",
            "spindle_speed": None,
            "feed_rate": None,
            "note": "Leitura de DBs específicos do Sinumerik requer mapeamento por modelo"
        })
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)})


if __name__ == "__main__":
    from waitress import serve
    serve(app, host=os.environ.get("BIND_HOST", "127.0.0.1"), port=8766, threads=8)
