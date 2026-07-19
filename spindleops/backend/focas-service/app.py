from flask import Flask, request, jsonify
import os
import ctypes
import threading
from collections import defaultdict

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


# Carrega a lib FOCAS (volume montado dentro do container)
LIBPATH = "/app/libfwlib32.so"
focas = ctypes.cdll.LoadLibrary(LIBPATH)

# Define tipos de retorno (nem toda build da fwlib exporta todas — guarda com hasattr)
for fn in [
    "cnc_startupprocess", "cnc_exitprocess",
    "cnc_allclibhndl3", "cnc_freelibhndl",
    "cnc_rdcncid", "cnc_statinfo", "cnc_rdspeed",
    "cnc_rdaxisdata", "cnc_alarm2",
    "cnc_exeprgname", "cnc_rdspmeter", "cnc_rdalmmsg",
    "cnc_modal", "cnc_rdtimer", "cnc_rdparam", "cnc_rdsvmeter",
]:
    if hasattr(focas, fn):
        getattr(focas, fn).restype = ctypes.c_short

# Inicializa processo FOCAS
ret = focas.cnc_startupprocess(0, b"focas.log")
if ret != 0:
    print(f"WARNING: cnc_startupprocess returned {ret}")


# ── STRUCTS FOCAS ────────────────────────────────────────────────────────────

class ODBST(ctypes.Structure):
    _fields_ = [
        ("dummy", ctypes.c_short * 2),
        ("tmmode", ctypes.c_short),
        ("aut", ctypes.c_short),
        ("run", ctypes.c_short),
        ("motion", ctypes.c_short),
        ("mstb", ctypes.c_short),
        ("emergency", ctypes.c_short),
        ("alarm", ctypes.c_short),
        ("edit", ctypes.c_short),
    ]


class SPEED(ctypes.Structure):
    _fields_ = [
        ("data", ctypes.c_long),
        ("dec", ctypes.c_short),
        ("unit", ctypes.c_short),
        ("disp", ctypes.c_short),
        ("name", ctypes.c_char),
        ("suff", ctypes.c_char),
    ]


class ODBSPEED(ctypes.Structure):
    _fields_ = [("actf", SPEED), ("acts", SPEED)]


class ODBEXEPRG(ctypes.Structure):
    _fields_ = [("name", ctypes.c_char * 36), ("o_num", ctypes.c_long)]


class SPEEDELM(ctypes.Structure):
    _fields_ = [
        ("data", ctypes.c_long),
        ("dec", ctypes.c_short),
        ("unit", ctypes.c_short),
        ("name", ctypes.c_short),
        ("suff1", ctypes.c_char),
        ("suff2", ctypes.c_char),
        ("reserve", ctypes.c_char),
    ]


class ODBSPLOAD(ctypes.Structure):
    _fields_ = [("spload", SPEEDELM), ("spspeed", SPEEDELM)]


class ODBALMMSG(ctypes.Structure):
    _fields_ = [
        ("alm_no", ctypes.c_long),
        ("type", ctypes.c_short),
        ("axis", ctypes.c_short),
        ("dummy", ctypes.c_short),
        ("msg_len", ctypes.c_short),
        ("alm_msg", ctypes.c_char * 32),
    ]


class MODALAUX(ctypes.Structure):
    _fields_ = [("aux_data", ctypes.c_long), ("flag1", ctypes.c_char), ("flag2", ctypes.c_char)]


class ODBMDL_AUX(ctypes.Structure):
    _fields_ = [("datano", ctypes.c_short), ("type", ctypes.c_short), ("aux", MODALAUX)]


class IODBTIME(ctypes.Structure):
    _fields_ = [("minute", ctypes.c_long), ("msec", ctypes.c_long)]


class IODBPSD(ctypes.Structure):
    _fields_ = [("datano", ctypes.c_short), ("type", ctypes.c_short), ("ldata", ctypes.c_long)]


# Modo de operação (ODBST.aut) — manual B do FOCAS2
AUT_MODES = {
    0: "MDI", 1: "AUTO", 2: "NO_SEL", 3: "EDIT", 4: "HANDLE",
    5: "JOG", 6: "TEACH_JOG", 7: "TEACH_HANDLE", 8: "INC",
    9: "REFERENCE", 10: "REMOTE",
}

# Prefixo do código de alarme por tipo (ODBALMMSG.type)
ALARM_TYPES = {
    0: "SW", 1: "PW", 2: "IO", 3: "PS", 4: "OT", 5: "OH",
    6: "SV", 7: "SR", 8: "MC", 9: "SP", 10: "DS", 11: "IE",
    12: "BG", 13: "SN", 15: "EX",
}


# ── CONEXÃO (handle cacheado por máquina) ────────────────────────────────────
# Abrir/fechar handle FOCAS a cada polling é caro; mantém um por (ip, porta)
# e derruba quando uma leitura falha.

_handles = {}
_locks = defaultdict(threading.Lock)


def get_handle(ip, port, timeout=10):
    key = (ip, port)
    if key in _handles:
        return _handles[key], 0
    libh = ctypes.c_ushort(0)
    ret = focas.cnc_allclibhndl3(ip.encode(), port, timeout, ctypes.byref(libh))
    if ret != 0:
        return None, ret
    _handles[key] = libh
    return libh, 0


def drop_handle(ip, port):
    key = (ip, port)
    libh = _handles.pop(key, None)
    if libh is not None:
        try:
            focas.cnc_freelibhndl(libh)
        except Exception:
            pass


# ── LEITURAS AUXILIARES (best-effort: falha vira None, não derruba o payload) ─

def read_program(libh):
    if not hasattr(focas, "cnc_exeprgname"):
        return None
    prg = ODBEXEPRG()
    if focas.cnc_exeprgname(libh, ctypes.byref(prg)) != 0:
        return None
    name = prg.name.decode(errors="ignore").strip("\x00").strip()
    if name:
        return name
    return f"O{prg.o_num}" if prg.o_num else None


def read_spindle_load(libh):
    if not hasattr(focas, "cnc_rdspmeter"):
        return None
    num = ctypes.c_short(1)
    load = ODBSPLOAD()
    if focas.cnc_rdspmeter(libh, 0, ctypes.byref(num), ctypes.byref(load)) != 0:
        return None
    return load.spload.data / (10 ** load.spload.dec)


def read_alarm(libh):
    """Retorna (code, message) do primeiro alarme ativo, ou (None, None)."""
    if not hasattr(focas, "cnc_rdalmmsg"):
        return None, None
    num = ctypes.c_short(5)
    msgs = (ODBALMMSG * 5)()
    if focas.cnc_rdalmmsg(libh, -1, ctypes.byref(num), msgs) != 0 or num.value < 1:
        return None, None
    m = msgs[0]
    prefix = ALARM_TYPES.get(m.type, "ALM")
    code = f"{prefix}{m.alm_no:04d}"
    message = m.alm_msg[:m.msg_len].decode(errors="ignore").strip("\x00").strip() or None
    return code, message


def read_tool(libh):
    if not hasattr(focas, "cnc_modal"):
        return None
    mdl = ODBMDL_AUX()
    if focas.cnc_modal(libh, 108, 1, ctypes.byref(mdl)) != 0:  # 108 = T code modal
        return None
    return int(mdl.aux.aux_data)


def read_timer(libh, timer_type):
    """type 1 = tempo em automático, 2 = tempo de corte. Retorna minutos."""
    if not hasattr(focas, "cnc_rdtimer"):
        return None
    t = IODBTIME()
    if focas.cnc_rdtimer(libh, timer_type, ctypes.byref(t)) != 0:
        return None
    return round(t.minute + t.msec / 60000.0, 1)


def read_axis_loads(libh):
    """Load meter dos servos (%). Retorna {axis_load_x: ..., ...} dos eixos X/Y/Z."""
    if not hasattr(focas, "cnc_rdsvmeter"):
        return {}
    num = ctypes.c_short(8)
    loads = (SPEEDELM * 8)()
    if focas.cnc_rdsvmeter(libh, ctypes.byref(num), loads) != 0:
        return {}
    out = {}
    for i in range(min(num.value, 8)):
        elm = loads[i]
        axis = chr(elm.name & 0xFF).lower() if 0 < (elm.name & 0xFF) < 128 else None
        if axis in ("x", "y", "z"):
            out[f"axis_load_{axis}"] = elm.data / (10 ** elm.dec)
    return out


def read_parts(libh):
    if not hasattr(focas, "cnc_rdparam"):
        return None
    p = IODBPSD()
    length = 4 + ctypes.sizeof(ctypes.c_long)
    if focas.cnc_rdparam(libh, 6711, 0, length, ctypes.byref(p)) != 0:  # param 6711 = peças
        return None
    return int(p.ldata)


# ── ROTAS ────────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"ok": True, "service": "focas"})


@app.route("/test")
def test():
    ip = request.args.get("ip")
    port = int(request.args.get("port", 8193))
    with _locks[(ip, port)]:
        libh, err = get_handle(ip, port)
        if err != 0:
            return jsonify({"connected": False, "error_code": err})
        try:
            cnc_ids = (ctypes.c_uint32 * 4)()
            focas.cnc_rdcncid(libh, cnc_ids)
            machine_id = "-".join([f"{cnc_ids[i]:08x}" for i in range(4)])
            return jsonify({"connected": True, "machine_id": machine_id})
        except Exception as e:
            drop_handle(ip, port)
            return jsonify({"connected": False, "error": str(e)})


@app.route("/read")
def read():
    ip = request.args.get("ip")
    port = int(request.args.get("port", 8193))
    with _locks[(ip, port)]:
        libh, err = get_handle(ip, port)
        if err != 0:
            return jsonify({"connected": False, "error_code": err}), 200

        try:
            st = ODBST()
            if focas.cnc_statinfo(libh, ctypes.byref(st)) != 0:
                # handle morreu (rede caiu, CNC reiniciou) — derruba e reporta
                drop_handle(ip, port)
                return jsonify({"connected": False, "error": "statinfo failed"}), 200

            sp = ODBSPEED()
            focas.cnc_rdspeed(libh, -1, ctypes.byref(sp))

            status_map = {0: "idle", 1: "running", 2: "idle", 3: "alarm"}
            status = "alarm" if st.alarm else status_map.get(st.run, "offline")

            alarm_code, alarm_message = (None, None)
            if st.alarm:
                alarm_code, alarm_message = read_alarm(libh)

            return jsonify({
                "connected": True,
                "status": status,
                "cnc_mode": AUT_MODES.get(st.aut),
                "program_name": read_program(libh),
                "spindle_speed": sp.acts.data,
                "spindle_load": read_spindle_load(libh),
                "feed_rate": sp.actf.data,
                "tool_number": read_tool(libh),
                "parts_count": read_parts(libh),
                **read_axis_loads(libh),
                "auto_time": read_timer(libh, 1),
                "cutting_time": read_timer(libh, 2),
                "alarm_code": alarm_code,
                "alarm_message": alarm_message,
                "emergency": bool(st.emergency),
                "alarm_active": bool(st.alarm),
            })
        except Exception as e:
            drop_handle(ip, port)
            return jsonify({"connected": False, "error": str(e)})


if __name__ == "__main__":
    from waitress import serve
    serve(app, host=os.environ.get("BIND_HOST", "127.0.0.1"), port=8765, threads=8)
