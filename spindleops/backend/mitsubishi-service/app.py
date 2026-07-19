from flask import Flask, request, jsonify
import os
import pymcprotocol

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



def connect(ip, port=5007, plctype="Q"):
    """
    Conecta via MELSEC SLMP/MC Protocol.
    plctype: Q (Q-Series), L (L-Series), iQ-R, iQ-L, F
    Porta padrão MC Protocol: 5007 ou 5562.
    """
    pymc = pymcprotocol.Type3E(plctype=plctype)
    pymc.connect(ip, port)
    return pymc


@app.route("/health")
def health():
    return jsonify({"ok": True, "service": "mitsubishi"})


@app.route("/test")
def test():
    ip = request.args.get("ip")
    port = int(request.args.get("port", 5007))
    plctype = request.args.get("plctype", "Q")
    try:
        pymc = connect(ip, port, plctype)
        # Tenta ler 1 word do device D0 pra confirmar diálogo
        word_values = pymc.batchread_wordunits(headdevice="D0", readsize=1)
        pymc.close()
        return jsonify({
            "connected": True,
            "plctype": plctype,
            "test_register_D0": word_values[0] if word_values else None,
        })
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)})


@app.route("/read")
def read():
    """
    Leitura básica via MC Protocol.
    Lê 10 words a partir de D0 (mapeamento padrão).
    Pode ser sobrescrito por config no Node.
    """
    ip = request.args.get("ip")
    port = int(request.args.get("port", 5007))
    plctype = request.args.get("plctype", "Q")
    headdevice = request.args.get("headdevice", "D0")
    count = int(request.args.get("count", 10))
    try:
        pymc = connect(ip, port, plctype)
        regs = pymc.batchread_wordunits(headdevice=headdevice, readsize=count)
        pymc.close()

        # Mapeamento padrão SpindleOps
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
    serve(app, host=os.environ.get("BIND_HOST", "127.0.0.1"), port=8770, threads=8)
