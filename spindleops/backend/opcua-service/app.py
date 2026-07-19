from flask import Flask, request, jsonify
import os
import threading
from collections import defaultdict
from asyncua.sync import Client

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


# Node IDs padrão Siemens 840D sl / 828D.
# Variam por firmware — confirme com UaExpert na máquina real.
# Qualquer um pode ser sobrescrito por máquina via config.registers,
# ex.: {"node_spindle_speed": "ns=2;s=/Channel/Spindle/actSpeed"}
DEFAULT_NODES = {
    "status":           "ns=2;s=Channel/ProgramInfo/status",
    "program_name":     "ns=2;s=Channel/ProgramInfo/progName",
    "spindle_speed":    "ns=2;s=Channel/SpindleControl/ActSpeed",
    "spindle_load":     "ns=2;s=Channel/SpindleControl/ActLoad",
    "feed_rate":        "ns=2;s=Channel/FeedControl/ActFeedrate",
    "feed_override":    "ns=2;s=Channel/FeedControl/FeedRateOvr",
    "spindle_override": "ns=2;s=Channel/SpindleControl/SpindleSpeedOvr",
    "pos_x":            "ns=2;s=Channel/GeometricMachinePos/X",
    "pos_y":            "ns=2;s=Channel/GeometricMachinePos/Y",
    "pos_z":            "ns=2;s=Channel/GeometricMachinePos/Z",
    "parts_count":      "ns=2;s=Channel/ProgramInfo/WorkpiecesProduced",
    # Campos do pente fino (paridade com CNC Monitor)
    "tool_number":      "ns=2;s=Channel/State/actTNumber",
    "cnc_mode":         "ns=2;s=Bag/State/opMode",
    "axis_load_x":      "ns=2;s=Channel/MachineAxis/aaLoad[u1,1]",
    "axis_load_y":      "ns=2;s=Channel/MachineAxis/aaLoad[u1,2]",
    "axis_load_z":      "ns=2;s=Channel/MachineAxis/aaLoad[u1,3]",
}

# Sinumerik Bag/State/opMode
OP_MODES = {0: "JOG", 1: "MDI", 2: "AUTO"}


def endpoint_url(ip, port):
    if ip.startswith("opc.tcp://"):
        return ip
    return f"opc.tcp://{ip}:{port}"


# ── SESSÃO (cliente cacheado por endpoint, mesmo padrão do focas-service) ────

_clients = {}
_locks = defaultdict(threading.Lock)


def get_client(url, user=None, password=None):
    if url in _clients:
        return _clients[url]
    client = Client(url=url)
    if user:
        # Sinumerik em produção exige usuário/senha no servidor OPC-UA
        client.aio_obj.set_user(user)
        client.aio_obj.set_password(password or "")
    client.connect()
    _clients[url] = client
    return client


def drop_client(url):
    client = _clients.pop(url, None)
    if client is not None:
        try:
            client.disconnect()
        except Exception:
            pass


def resolve_nodes(args):
    """DEFAULT_NODES com overrides node_<campo> vindos do config.registers."""
    nodes = dict(DEFAULT_NODES)
    for key, value in args.items():
        if key.startswith("node_") and value:
            nodes[key[len("node_"):]] = value
    return nodes


def normalize_status(raw):
    if isinstance(raw, str):
        return raw
    return {0: "idle", 1: "running", 2: "idle", 3: "idle"}.get(raw, "offline")


# ── ROTAS ────────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"ok": True, "service": "opcua"})


@app.route("/test")
def test():
    ip = request.args.get("ip")
    port = int(request.args.get("port", 4840))
    url = endpoint_url(ip, port)
    with _locks[url]:
        try:
            client = get_client(url, request.args.get("opc_user"), request.args.get("opc_pass"))
            # ns=0;i=2259 = Server/ServerStatus/State (padrão OPC-UA, existe em todo servidor)
            state = client.get_node("ns=0;i=2259").read_value()
            return jsonify({"connected": True, "endpoint": url, "server_state": str(state)})
        except Exception as e:
            drop_client(url)
            return jsonify({"connected": False, "error": str(e)})


@app.route("/read")
def read():
    ip = request.args.get("ip")
    port = int(request.args.get("port", 4840))
    url = endpoint_url(ip, port)
    nodes = resolve_nodes(request.args)

    with _locks[url]:
        try:
            client = get_client(url, request.args.get("opc_user"), request.args.get("opc_pass"))
        except Exception as e:
            return jsonify({"connected": False, "error": str(e)}), 200

        data = {}
        failures = 0
        for field, node_id in nodes.items():
            try:
                data[field] = client.get_node(node_id).read_value()
            except Exception:
                data[field] = None
                failures += 1

        if failures == len(nodes):
            # nenhum nó respondeu — sessão provavelmente morta; derruba e reporta
            drop_client(url)
            return jsonify({"connected": False, "error": "all node reads failed"}), 200

        data["status"] = normalize_status(data.get("status"))
        if data.get("cnc_mode") is not None and not isinstance(data["cnc_mode"], str):
            data["cnc_mode"] = OP_MODES.get(data["cnc_mode"], str(data["cnc_mode"]))

        return jsonify({"connected": True, **data})


if __name__ == "__main__":
    from waitress import serve
    serve(app, host=os.environ.get("BIND_HOST", "127.0.0.1"), port=8772, threads=8)
