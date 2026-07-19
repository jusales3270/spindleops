const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'spindleops.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS machines (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    protocol    TEXT NOT NULL,
    address     TEXT,
    port        INTEGER,
    enabled     INTEGER DEFAULT 1,
    registers   TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS metrics (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id       TEXT NOT NULL,
    timestamp        TEXT DEFAULT (datetime('now')),
    status           TEXT,
    program_name     TEXT,
    spindle_speed    REAL,
    spindle_load     REAL,
    feed_rate        REAL,
    feed_override    REAL,
    spindle_override REAL,
    pos_x            REAL,
    pos_y            REAL,
    pos_z            REAL,
    alarm_code       TEXT,
    alarm_message    TEXT,
    parts_count      INTEGER,
    cycle_time       REAL,
    tool_number      INTEGER,
    cnc_mode         TEXT,
    axis_load_x      REAL,
    axis_load_y      REAL,
    axis_load_z      REAL,
    auto_time        REAL,
    cutting_time     REAL,
    FOREIGN KEY (machine_id) REFERENCES machines(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id  TEXT NOT NULL,
    timestamp   TEXT DEFAULT (datetime('now')),
    type        TEXT,
    description TEXT,
    resolved    INTEGER DEFAULT 0,
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_metrics_machine_time
    ON metrics(machine_id, timestamp DESC);

  CREATE INDEX IF NOT EXISTS idx_events_machine
    ON events(machine_id, timestamp DESC);
`);

// Migrações: adiciona colunas que não existem (bancos já criados)
try {
  db.exec(`ALTER TABLE machines ADD COLUMN registers TEXT`);
} catch (_) { /* coluna já existe — ignorar */ }

for (const col of [
  'tool_number INTEGER', 'cnc_mode TEXT',
  'axis_load_x REAL', 'axis_load_y REAL', 'axis_load_z REAL',
  'auto_time REAL', 'cutting_time REAL',
]) {
  try {
    db.exec(`ALTER TABLE metrics ADD COLUMN ${col}`);
  } catch (_) { /* coluna já existe — ignorar */ }
}

// Detecta transições de status e registra como eventos
let lastStatus = {};

module.exports = {

  saveMetrics(machineId, data) {
    const stmt = db.prepare(`
      INSERT INTO metrics (
        machine_id, status, program_name,
        spindle_speed, spindle_load, feed_rate,
        feed_override, spindle_override,
        pos_x, pos_y, pos_z,
        alarm_code, alarm_message,
        parts_count, cycle_time,
        tool_number, cnc_mode,
        axis_load_x, axis_load_y, axis_load_z,
        auto_time, cutting_time
      ) VALUES (
        @machine_id, @status, @program_name,
        @spindle_speed, @spindle_load, @feed_rate,
        @feed_override, @spindle_override,
        @pos_x, @pos_y, @pos_z,
        @alarm_code, @alarm_message,
        @parts_count, @cycle_time,
        @tool_number, @cnc_mode,
        @axis_load_x, @axis_load_y, @axis_load_z,
        @auto_time, @cutting_time
      )
    `);
    stmt.run({ machine_id: machineId, ...data });

    // Registra evento se o status mudou
    const prev = lastStatus[machineId];
    if (prev !== data.status) {
      this.saveEvent(machineId, data.status, this._eventDesc(data));
      lastStatus[machineId] = data.status;
    }

    // Registra alarme como evento
    if (data.alarm_code && prev !== 'alarm') {
      this.saveEvent(machineId, 'alarm', `${data.alarm_code}: ${data.alarm_message || 'Alarme detectado'}`);
    }

    // Registra mudança de programa
    if (data.program_name && data.program_name !== '—') {
      const lastProg = this._lastProgram(machineId);
      if (lastProg && lastProg !== data.program_name) {
        this.saveEvent(machineId, 'program', `Programa carregado: ${data.program_name}`);
      }
    }
  },

  _eventDesc(data) {
    const map = {
      running: `Usinagem iniciada${data.program_name ? ' — ' + data.program_name : ''}`,
      idle:    'Máquina parada / setup',
      alarm:   `Alarme: ${data.alarm_code || ''}`,
      offline: 'Máquina offline',
    };
    return map[data.status] || data.status;
  },

  _lastProgram(machineId) {
    const row = db.prepare(`
      SELECT program_name FROM metrics
      WHERE machine_id = ? AND program_name IS NOT NULL
      ORDER BY id DESC LIMIT 1 OFFSET 1
    `).get(machineId);
    return row?.program_name;
  },

  saveEvent(machineId, type, description) {
    db.prepare(`
      INSERT INTO events (machine_id, type, description)
      VALUES (?, ?, ?)
    `).run(machineId, type, description);
  },

  getLatestMetrics() {
    return db.prepare(`
      SELECT m.*, mach.name as machine_name, mach.protocol, mach.address
      FROM metrics m
      JOIN machines mach ON m.machine_id = mach.id
      WHERE m.id IN (
        SELECT MAX(id) FROM metrics GROUP BY machine_id
      )
      ORDER BY mach.name
    `).all();
  },

  getMachineHistory(machineId, hours = 8) {
    return db.prepare(`
      SELECT * FROM metrics
      WHERE machine_id = ?
        AND timestamp >= datetime('now', '-' || ? || ' hours')
      ORDER BY timestamp ASC
    `).all(machineId, hours);
  },

  getHourlyStats(machineId, hours = 24) {
    return db.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00', timestamp) as hour,
        AVG(CASE WHEN status='running' THEN spindle_load ELSE NULL END) as avg_spindle_load,
        AVG(CASE WHEN status='running' THEN feed_rate    ELSE NULL END) as avg_feed_rate,
        AVG(CASE WHEN status='running' THEN spindle_speed ELSE NULL END) as avg_rpm,
        COUNT(*) as samples,
        SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) as running_samples,
        SUM(CASE WHEN status='idle'    THEN 1 ELSE 0 END) as idle_samples,
        SUM(CASE WHEN status='alarm'   THEN 1 ELSE 0 END) as alarm_samples,
        MAX(parts_count) - MIN(parts_count) as parts_produced
      FROM metrics
      WHERE machine_id = ?
        AND timestamp >= datetime('now', '-' || ? || ' hours')
      GROUP BY hour
      ORDER BY hour ASC
    `).all(machineId, hours);
  },

  getTimelineByHour(machineId, hours = 24) {
    return db.prepare(`
      SELECT
        strftime('%H', timestamp) as hour,
        CASE
          WHEN SUM(CASE WHEN status='alarm'   THEN 1 ELSE 0 END) > 0 THEN 'alarm'
          WHEN SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) > SUM(CASE WHEN status='idle' THEN 1 ELSE 0 END)
               THEN 'running'
          WHEN SUM(CASE WHEN status='idle'    THEN 1 ELSE 0 END) > 0 THEN 'idle'
          ELSE 'off'
        END as dominant_status
      FROM metrics
      WHERE machine_id = ?
        AND timestamp >= datetime('now', '-' || ? || ' hours')
      GROUP BY hour
      ORDER BY hour ASC
    `).all(machineId, hours);
  },

  getOEE(machineId, hours = 8) {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) as running,
        AVG(CASE WHEN status='running' THEN spindle_load ELSE NULL END) as avg_load,
        MAX(parts_count) - MIN(parts_count) as parts_produced,
        MAX(auto_time) - MIN(auto_time) as auto_minutes,
        MAX(cutting_time) - MIN(cutting_time) as cutting_minutes
      FROM metrics
      WHERE machine_id = ?
        AND timestamp >= datetime('now', '-' || ? || ' hours')
    `).get(machineId, hours);

    if (!stats || stats.total === 0) return null;
    const availability = stats.running / stats.total;
    const performance  = Math.min((stats.avg_load || 0) / 100, 1);
    const quality      = 0.98;
    return {
      availability: +(availability * 100).toFixed(1),
      performance:  +(performance  * 100).toFixed(1),
      quality:      +(quality      * 100).toFixed(1),
      oee:          +(availability * performance * quality * 100).toFixed(1),
      parts_produced: stats.parts_produced || 0,
      // contadores acumulados do CNC — delta do período, em minutos (null se a máquina não reporta)
      auto_minutes:    stats.auto_minutes    != null ? +stats.auto_minutes.toFixed(1)    : null,
      cutting_minutes: stats.cutting_minutes != null ? +stats.cutting_minutes.toFixed(1) : null,
    };
  },

  getEvents(machineId, hours = 24) {
    return db.prepare(`
      SELECT * FROM events
      WHERE machine_id = ?
        AND timestamp >= datetime('now', '-' || ? || ' hours')
      ORDER BY timestamp DESC
    `).all(machineId, hours);
  },

  getSummary() {
    return db.prepare(`
      SELECT
        m.machine_id,
        mach.name,
        m.status,
        m.timestamp
      FROM metrics m
      JOIN machines mach ON m.machine_id = mach.id
      WHERE m.id IN (
        SELECT MAX(id) FROM metrics GROUP BY machine_id
      )
    `).all();
  },

  upsertMachine(machine) {
    const registers = machine.registers
      ? (typeof machine.registers === 'string' ? machine.registers : JSON.stringify(machine.registers))
      : null;
    db.prepare(`
      INSERT INTO machines (id, name, protocol, address, port, enabled, registers)
      VALUES (@id, @name, @protocol, @address, @port, @enabled, @registers)
      ON CONFLICT(id) DO UPDATE SET
        name=@name, protocol=@protocol,
        address=@address, port=@port, enabled=@enabled, registers=@registers
    `).run({ ...machine, registers });
  },

  updateMachine(machine) {
    const registers = machine.registers
      ? (typeof machine.registers === 'string' ? machine.registers : JSON.stringify(machine.registers))
      : null;
    db.prepare(`
      UPDATE machines SET
        name=@name, protocol=@protocol,
        address=@address, port=@port, enabled=@enabled, registers=@registers
      WHERE id=@id
    `).run({ ...machine, registers });
  },

  deleteMachine(id) {
    // FK está ativa no better-sqlite3: métricas/eventos precisam sair antes da máquina
    db.transaction(() => {
      db.prepare('DELETE FROM metrics WHERE machine_id=?').run(id);
      db.prepare('DELETE FROM events WHERE machine_id=?').run(id);
      db.prepare('DELETE FROM machines WHERE id=?').run(id);
    })();
    delete lastStatus[id];
  },

  getMachines() {
    const rows = db.prepare('SELECT * FROM machines WHERE enabled=1 ORDER BY name').all();
    return rows.map(r => ({
      ...r,
      registers: r.registers ? JSON.parse(r.registers) : null
    }));
  },

  getAllMachines() {
    const rows = db.prepare('SELECT * FROM machines ORDER BY name').all();
    return rows.map(r => ({
      ...r,
      registers: r.registers ? JSON.parse(r.registers) : null
    }));
  },

  db
};
