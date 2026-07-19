/**
 * SpindleOps — Collector v2
 * Roteador que chama containers Python (um por protocolo) via HTTP.
 * Cada container expõe /health, /test e /read.
 */

const { EventEmitter } = require('events');

// Mapa de protocolo → URL base do container
const PROTOCOL_SERVICES = {
  fanuc:         'http://localhost:8765',
  fanuc_china:   'http://localhost:8765',
  siemens_s7:    'http://localhost:8766',
  siemens_opcua: 'http://localhost:8772',
  modbus:        'http://localhost:8767',
  heidenhain:    'http://localhost:8768',
  mtconnect:     'http://localhost:8769',
  mitsubishi:    'http://localhost:8770',
  mazak:         'http://localhost:8771',
};

// Schema canônico de uma leitura — tem que casar 1:1 com as colunas de `metrics`
// no database.js: o INSERT usa parâmetros nomeados e falha se faltar qualquer campo.
const METRIC_FIELDS = [
  'status', 'program_name',
  'spindle_speed', 'spindle_load', 'feed_rate',
  'feed_override', 'spindle_override',
  'pos_x', 'pos_y', 'pos_z',
  'alarm_code', 'alarm_message',
  'parts_count', 'cycle_time',
  'tool_number', 'cnc_mode',
  'axis_load_x', 'axis_load_y', 'axis_load_z',
  'auto_time', 'cutting_time',
];

const TEXT_FIELDS = new Set(['status', 'program_name', 'alarm_code', 'alarm_message', 'cnc_mode']);

class Collector extends EventEmitter {
  constructor(config) {
    super();
    this.config    = config;
    this.connected = false;
    this._simState = null;
  }

  _serviceUrl() {
    return PROTOCOL_SERVICES[this.config.protocol];
  }

  _params() {
    const p = new URLSearchParams();
    if (this.config.address) p.set('ip', this.config.address);
    if (this.config.port)    p.set('port', this.config.port);
    // params extras vindos do banco (rack/slot/plctype/etc)
    if (this.config.registers) {
      for (const [k, v] of Object.entries(this.config.registers)) {
        p.set(k, v);
      }
    }
    return p.toString();
  }

  async _callService(endpoint) {
    const base = this._serviceUrl();
    if (!base) throw new Error(`Protocolo não suportado: ${this.config.protocol}`);
    const url = `${base}${endpoint}?${this._params()}`;
    const headers = {};
    if (process.env.SPINDLEOPS_SERVICE_TOKEN) {
      headers['X-Service-Token'] = process.env.SPINDLEOPS_SERVICE_TOKEN;
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ── CONNECT ─────────────────────────────────────────────────────────────
  async connect() {
    try {
      if (this.config.protocol === 'simulator') {
        this._initSimulator();
        return;
      }
      const r = await this._callService('/test');
      this.connected = !!r.connected;
      if (this.connected) {
        console.log(`[${this.config.id}] ${this.config.protocol} conectado`);
        this.emit('connected', this.config.id);
      } else {
        console.warn(`[${this.config.id}] ${this.config.protocol} falhou: ${r.error || r.error_code}`);
      }
    } catch (err) {
      console.error(`[${this.config.id}] Falha conexão: ${err.message}`);
      this.connected = false;
    }
  }

  // ── READ ────────────────────────────────────────────────────────────────
  async read() {
    if (!this.connected) return null;
    try {
      if (this.config.protocol === 'simulator') {
        return this._normalize(this._simulateData());
      }
      const r = await this._callService('/read');
      if (!r.connected) {
        this.connected = false;
        return null;
      }
      return this._normalize(r);
    } catch (err) {
      console.error(`[${this.config.id}] Erro leitura: ${err.message}`);
      this.connected = false;
      return null;
    }
  }

  async disconnect() {
    this.connected = false;
  }

  // ── NORMALIZAÇÃO ────────────────────────────────────────────────────────
  // Cada serviço devolve um subconjunto diferente de campos (e às vezes
  // strings vindas de XML). Aqui tudo vira o objeto canônico do schema.
  _normalize(raw) {
    const out = {};
    for (const field of METRIC_FIELDS) {
      let v = raw[field];
      if (v === undefined || v === '') v = null;
      if (v !== null && !TEXT_FIELDS.has(field)) {
        const n = typeof v === 'number' ? v : parseFloat(v);
        v = Number.isFinite(n) ? n : null;
      }
      out[field] = v;
    }
    // Heidenhain devolve posições num dicionário `axes`
    if (raw.axes && typeof raw.axes === 'object') {
      for (const [axis, field] of [['X', 'pos_x'], ['Y', 'pos_y'], ['Z', 'pos_z']]) {
        const v = raw.axes[axis] ?? raw.axes[axis.toLowerCase()];
        if (out[field] === null && v != null) {
          const n = parseFloat(v);
          out[field] = Number.isFinite(n) ? n : null;
        }
      }
    }
    if (!out.status) out.status = 'offline';
    return out;
  }

  // ── SIMULADOR (mantido para fallback / demos) ──────────────────────────
  _initSimulator() {
    this._simState = {
      status: 'running', program: 'FLANGE_M8.NC',
      spindleRpm: 8000, feedRate: 800, parts: 0,
      cycleStart: Date.now(), loadBase: 68,
      startedAt: Date.now(), tool: 4,
    };
    this.connected = true;
    console.log(`[${this.config.id}] Simulador iniciado`);
    this.emit('connected', this.config.id);
  }

  _simulateData() {
    const s = this._simState;
    const now = Date.now();
    const elapsed = (now - s.cycleStart) / 1000;
    if (elapsed > 120) {
      s.parts++;
      s.cycleStart = now;
      s.tool = 1 + (s.tool % 8); // troca de ferramenta a cada ciclo
    }
    const j = r => (Math.random() - 0.5) * r;
    const load = Math.min(100, Math.max(5, s.loadBase + j(18) + Math.sin(elapsed / 12) * 12));
    const hasAlarm = Math.random() < 0.008;
    const isIdle   = Math.random() < 0.04;
    return {
      status: hasAlarm ? 'alarm' : isIdle ? 'idle' : 'running',
      program_name: s.program,
      spindle_speed: Math.round(Math.max(0, s.spindleRpm + j(300))),
      spindle_load: +load.toFixed(1),
      feed_rate: Math.round(Math.max(0, s.feedRate + j(60))),
      feed_override: 100, spindle_override: 100,
      pos_x: +(125.4 + j(60)).toFixed(3),
      pos_y: +(-88.2 + j(40)).toFixed(3),
      pos_z: +(-15.6 + j(12)).toFixed(3),
      alarm_code: hasAlarm ? 'ALM-1001' : null,
      alarm_message: hasAlarm ? 'Sobrecarga no eixo X' : null,
      parts_count: s.parts,
      cycle_time: +elapsed.toFixed(1),
      tool_number: s.tool,
      cnc_mode: isIdle ? 'EDIT' : 'AUTO',
      axis_load_x: +Math.min(100, Math.max(2, load * 0.6 + j(8))).toFixed(1),
      axis_load_y: +Math.min(100, Math.max(2, load * 0.5 + j(8))).toFixed(1),
      axis_load_z: +Math.min(100, Math.max(2, load * 0.7 + j(8))).toFixed(1),
      auto_time: +((now - s.startedAt) / 60000).toFixed(1),      // minutos em automático
      cutting_time: +((now - s.startedAt) / 60000 * 0.8).toFixed(1),
    };
  }
}

module.exports = Collector;
