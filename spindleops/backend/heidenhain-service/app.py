from flask import Flask, request, jsonify
import os
import pyLSV2

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
    return jsonify({"ok": True, "service": "heidenhain"})


@app.route("/test")
def test():
    ip = request.args.get("ip")
    port = int(request.args.get("port", 19000))
    try:
        con = pyLSV2.LSV2(ip, port=port, timeout=5)
        con.connect()
        versions = con.versions()
        con.disconnect()
        return jsonify({
            "connected": True,
            "control": versions.control,
            "nc_sw": versions.nc_sw,
            "plc": versions.plc,
            "type": versions.type,
        })
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)})


@app.route("/read")
def read():
    ip = request.args.get("ip")
    port = int(request.args.get("port", 19000))
    try:
        con = pyLSV2.LSV2(ip, port=port, timeout=5)
        con.connect()

        # Status / programa ativo
        program_status = con.program_status()
        execution_status = con.execution_status()
        current_program = con.program_stack()

        # Override values
        overrides = con.override_info()

        # Posição dos eixos
        axes_positions = con.axes_location()

        con.disconnect()

        # Mapeia status pra padrão SpindleOps
        status = "running" if execution_status and "RUN" in str(execution_status).upper() else "idle"

        return jsonify({
            "connected": True,
            "status": status,
            "program_name": current_program.main if current_program else None,
            "feed_override": overrides.feed if overrides else None,
            "spindle_override": overrides.spindle if overrides else None,
            "axes": {k: v for k, v in (axes_positions.items() if axes_positions else [])},
            "raw_program_status": str(program_status),
            "raw_execution_status": str(execution_status),
        })
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)})


if __name__ == "__main__":
    from waitress import serve
    serve(app, host=os.environ.get("BIND_HOST", "127.0.0.1"), port=8768, threads=8)
