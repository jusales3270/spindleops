from flask import Flask, request, jsonify
import os
from pymodbus.client import ModbusTcpClient

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



@app.route("/health")
def health():
    return jsonify({"ok": True, "service": "modbus"})


@app.route("/test")
def test():
    ip = request.args.get("ip")
    port = int(request.args.get("port", 502))
    unit = int(request.args.get("unit", 1))
    try:
        client = ModbusTcpClient(ip, port=port, timeout=5)
        connected = client.connect()
        if not connected:
            return jsonify({"connected": False, "error": "connection refused"})
        # Tenta ler 1 registrador holding pra confirmar dialogo Modbus
        rr = client.read_holding_registers(address=0, count=1, slave=unit)
        client.close()
        if rr.isError():
            return jsonify({"connected": True, "modbus_dialog": False, "error": str(rr)})
        return jsonify({"connected": True, "modbus_dialog": True, "first_register": rr.registers[0]})
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)})


@app.route("/read")
def read():
    """
    Leitura genérica de Modbus holding registers.
    Por enquanto retorna os 10 primeiros registradores brutos.
    Mapeamento pra status/spindle/feed depende da máquina.
    """
    ip = request.args.get("ip")
    port = int(request.args.get("port", 502))
    unit = int(request.args.get("unit", 1))
    count = int(request.args.get("count", 10))
    try:
        client = ModbusTcpClient(ip, port=port, timeout=5)
        if not client.connect():
            return jsonify({"connected": False, "error": "connection refused"})
        rr = client.read_holding_registers(address=0, count=count, slave=unit)
        client.close()
        if rr.isError():
            return jsonify({"connected": True, "error": str(rr)})
        regs = rr.registers
        # Mapeamento padrão (pode ser sobrescrito por config no Node)
        return jsonify({
            "connected": True,
            "status": ["offline", "idle", "running", "alarm"][regs[0]] if regs[0] < 4 else "offline",
            "spindle_speed": regs[1] if len(regs) > 1 else None,
            "spindle_load": regs[2] / 10 if len(regs) > 2 else None,
            "feed_rate": regs[3] if len(regs) > 3 else None,
            "parts_count": regs[4] if len(regs) > 4 else None,
            "raw_registers": regs,
        })
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)})


if __name__ == "__main__":
    from waitress import serve
    serve(app, host=os.environ.get("BIND_HOST", "127.0.0.1"), port=8767, threads=8)
