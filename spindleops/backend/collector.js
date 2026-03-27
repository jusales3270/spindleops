/**
 * SpindleOps — Collector
 * Conecta em cada máquina CNC pelo protocolo correto
 * e retorna um objeto padronizado de métricas.
 */

const { EventEmitter } = require('events');
const net = require('net');

class Collector extends EventEmitter {
  constructor(config) {
    super();
    this.config    = config;
    this.connected = false;
    this.client    = null;
    this._simState = null;
  }

  async connect() {
    try {
      switch (this.config.protocol) {
        case 'fanuc':
        case 'fanuc_china':
          await this._connectFanuc(); break;
        case 'siemens_s7':
        case 'siemens_opcua':
          await this._connectOPCUA(); break;
        case 'modbus':
          await this._connectModbus(); break;
        case 'heidenhain':
          await this._connectTCP(); break;
        case 'simulator':
          this._initSimulator(); break;
        default:
          console.warn(`[${this.config.id}] Protocolo não suportado: ${this.config.protocol}`);
      }
    } catch (err) {
      console.error(`[${this.config.id}] Falha na conexão: ${err.message}`);
      this.connected = false;
    }
  }

  // ── FANUC FOCAS2 ────────────────────────────────────────────────────────
  async _connectFanuc() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(
        { host: this.config.address, port: this.config.port || 8193, timeout: 5000 },
        () => {
          this.client    = socket;
          this.connected = true;
          console.log(`[${this.config.id}] Fanuc conectado em ${this.config.address}`);
          this.emit('connected', this.config.id);
          resolve();
        }
      );
      socket.on('error',   err => reject(err));
      socket.on('timeout', ()  => reject(new Error('Timeout Fanuc')));
    });
  }

  async _readFanuc() {
    /**
     * Leitura real via Fanuc FOCAS2:
     *
     * Instale:  npm install fanuc-focas2
     * Docs:     https://www.fwsi.jp/en/products/focas/focas2/
     *
     * Funções principais:
     *   cnc_allclibhndl3()  → abre handle
     *   cnc_statinfo()      → status (modo, programa)
     *   cnc_rdspeed()       → velocidades spindle/feed
     *   cnc_rdaxisdata()    → posições X Y Z
     *   cnc_rdprgnum()      → número do programa ativo
     *   cnc_rdalarmmsg()    → alarmes ativos
     *
     * Por ora retorna simulação para não bloquear o servidor.
     */
    return this._simulateData();
  }

  // ── SIEMENS OPC-UA ──────────────────────────────────────────────────────
  async _connectOPCUA() {
    const { OPCUAClient } = require('node-opcua');
    this.opcClient = OPCUAClient.create({
      endpointMustExist: false,
      connectionStrategy: { maxRetry: 3, initialDelay: 1000 }
    });
    await this.opcClient.connect(this.config.address);
    this.opcSession = await this.opcClient.createSession();
    this.connected  = true;
    console.log(`[${this.config.id}] OPC-UA conectado em ${this.config.address}`);
    this.emit('connected', this.config.id);
  }

  async _readOPCUA() {
    if (!this.opcSession) return null;
    /**
     * Node IDs padrão Siemens 840D sl / 828D
     * Adapte conforme sua versão de firmware.
     *
     * Use o UaExpert (gratuito) para explorar os nós disponíveis.
     */
    const nodes = {
      status:           'ns=2;s=Channel/ProgramInfo/status',
      program_name:     'ns=2;s=Channel/ProgramInfo/progName',
      spindle_speed:    'ns=2;s=Channel/SpindleControl/ActSpeed',
      spindle_load:     'ns=2;s=Channel/SpindleControl/ActLoad',
      feed_rate:        'ns=2;s=Channel/FeedControl/ActFeedrate',
      feed_override:    'ns=2;s=Channel/FeedControl/FeedRateOvr',
      spindle_override: 'ns=2;s=Channel/SpindleControl/SpindleSpeedOvr',
      pos_x:            'ns=2;s=Channel/GeometricMachinePos/X',
      pos_y:            'ns=2;s=Channel/GeometricMachinePos/Y',
      pos_z:            'ns=2;s=Channel/GeometricMachinePos/Z',
      parts_count:      'ns=2;s=Channel/ProgramInfo/WorkpiecesProduced',
    };
    try {
      const results = await Promise.all(
        Object.entries(nodes).map(async ([key, nodeId]) => {
          try {
            const dv = await this.opcSession.readVariableValue(nodeId);
            return [key, dv.value?.value ?? null];
          } catch { return [key, null]; }
        })
      );
      const data = Object.fromEntries(results);
      data.status = this._normalizeStatus(data.status);
      return data;
    } catch (err) {
      console.error(`[${this.config.id}] Leitura OPC-UA: ${err.message}`);
      return null;
    }
  }

  // ── MODBUS TCP ──────────────────────────────────────────────────────────
  async _connectModbus() {
    const ModbusRTU = require('modbus-serial');
    this.client = new ModbusRTU();
    await this.client.connectTCP(this.config.address, { port: this.config.port || 502 });
    this.client.setID(1);
    this.connected = true;
    console.log(`[${this.config.id}] Modbus TCP conectado`);
    this.emit('connected', this.config.id);
  }

  async _readModbus() {
    // Mapeamento padrão de registros (pode ser sobrescrito por config.registers)
    const DEFAULT_REG = {
      status: 0, spindle_speed: 1, spindle_load: 2, feed_rate: 3,
      parts_count: 4, feed_override: 5, spindle_override: 6,
      pos_x: 7, pos_y: 8, pos_z: 9
    };
    const reg = { ...DEFAULT_REG, ...(this.config.registers || {}) };

    // Descobre o maior índice para saber quantos registros ler
    const maxReg = Math.max(...Object.values(reg));
    const r = await this.client.readHoldingRegisters(0, maxReg + 1);
    const d = r.data;

    return {
      status:           ['offline','idle','running','alarm'][d[reg.status]] || 'offline',
      spindle_speed:    d[reg.spindle_speed],
      spindle_load:     d[reg.spindle_load] / 10,
      feed_rate:        d[reg.feed_rate],
      parts_count:      d[reg.parts_count],
      feed_override:    d[reg.feed_override] || 100,
      spindle_override: d[reg.spindle_override] || 100,
      pos_x: d[reg.pos_x] / 100,
      pos_y: d[reg.pos_y] / 100,
      pos_z: d[reg.pos_z] / 100,
    };
  }

  // ── TCP GENÉRICO (Heidenhain LSV2) ──────────────────────────────────────
  async _connectTCP() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(
        { host: this.config.address, port: this.config.port || 19000, timeout: 5000 },
        () => {
          this.client    = socket;
          this.connected = true;
          console.log(`[${this.config.id}] TCP conectado em ${this.config.address}`);
          resolve();
        }
      );
      socket.on('error',   err => reject(err));
      socket.on('timeout', ()  => reject(new Error('Timeout TCP')));
    });
  }

  // ── SIMULADOR ───────────────────────────────────────────────────────────
  _initSimulator() {
    this._simState = {
      status:      'running',
      program:     'FLANGE_M8.NC',
      spindleRpm:  8000,
      feedRate:    800,
      parts:       0,
      cycleStart:  Date.now(),
      loadBase:    68,
    };
    this.connected = true;
    console.log(`[${this.config.id}] Simulador iniciado`);
    this.emit('connected', this.config.id);
  }

  _simulateData() {
    const s   = this._simState;
    const now = Date.now();
    const elapsed = (now - s.cycleStart) / 1000;

    if (elapsed > 120) {
      s.parts++;
      s.cycleStart = now;
    }

    const j   = r => (Math.random() - 0.5) * r;
    const load = Math.min(100, Math.max(5,
      s.loadBase + j(18) + Math.sin(elapsed / 12) * 12
    ));
    const hasAlarm = Math.random() < 0.008;
    const isIdle   = Math.random() < 0.04;

    return {
      status:           hasAlarm ? 'alarm' : isIdle ? 'idle' : 'running',
      program_name:     s.program,
      spindle_speed:    Math.round(Math.max(0, s.spindleRpm + j(300))),
      spindle_load:     +load.toFixed(1),
      feed_rate:        Math.round(Math.max(0, s.feedRate + j(60))),
      feed_override:    100,
      spindle_override: 100,
      pos_x:            +(125.4 + j(60)).toFixed(3),
      pos_y:            +(-88.2 + j(40)).toFixed(3),
      pos_z:            +(-15.6 + j(12)).toFixed(3),
      alarm_code:       hasAlarm ? 'ALM-1001' : null,
      alarm_message:    hasAlarm ? 'Sobrecarga no eixo X' : null,
      parts_count:      s.parts,
      cycle_time:       +elapsed.toFixed(1),
    };
  }

  // ── LEITURA UNIFICADA ───────────────────────────────────────────────────
  async read() {
    if (!this.connected) return null;
    try {
      switch (this.config.protocol) {
        case 'fanuc':
        case 'fanuc_china':   return await this._readFanuc();
        case 'siemens_s7':
        case 'siemens_opcua': return await this._readOPCUA();
        case 'modbus':        return await this._readModbus();
        case 'simulator':     return this._simulateData();
        default:              return null;
      }
    } catch (err) {
      console.error(`[${this.config.id}] Erro leitura: ${err.message}`);
      this.connected = false;
      return null;
    }
  }

  async disconnect() {
    try {
      if (this.opcSession) await this.opcSession.close();
      if (this.opcClient)  await this.opcClient.disconnect();
      if (this.client?.end)     this.client.end();
      if (this.client?.destroy) this.client.destroy();
    } catch {}
    this.connected = false;
  }

  _normalizeStatus(raw) {
    if (typeof raw === 'string') return raw;
    return { 0:'idle', 1:'running', 2:'idle', 3:'idle' }[raw] || 'offline';
  }
}

module.exports = Collector;
