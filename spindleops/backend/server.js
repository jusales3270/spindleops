require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const { WebSocketServer } = require('ws');
const db         = require('./database');
const Collector  = require('./collector');
const aiRoutes   = require('./ai-routes');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use('/api/ai', aiRoutes);

// ── ESTADO ────────────────────────────────────────────────────────────────────
const collectors = new Map();  // id → Collector
const intervals  = new Map();  // id → intervalId
const liveData   = new Map();  // id → última leitura

// ── WEBSOCKET ─────────────────────────────────────────────────────────────────
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, ...payload });
  wss.clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({
    type: 'snapshot',
    data: Array.from(liveData.values())
  }));
  ws.on('error', () => {});
});

// ── CICLO DE VIDA DE COLLECTORS ───────────────────────────────────────────────
async function startCollector(cfg) {
  const interval = parseInt(process.env.POLL_INTERVAL) || 5000;
  const col = new Collector(cfg);
  collectors.set(cfg.id, col);

  col.on('connected', () => {
    console.log(`  ✓ ${cfg.name} (${cfg.protocol})`);
  });

  await col.connect();

  const tid = setInterval(async () => {
    try {
      const data = await col.read();
      if (!data) return;

      db.saveMetrics(cfg.id, data);

      const live = {
        ...data,
        machine_id:   cfg.id,
        machine_name: cfg.name,
        protocol:     cfg.protocol,
        address:      cfg.address,
        connected:    col.connected,
        timestamp:    new Date().toISOString(),
      };
      liveData.set(cfg.id, live);
      broadcast('metrics', { machineId: cfg.id, data: live });

    } catch (err) {
      console.error(`[${cfg.id}] Erro no polling:`, err.message);
      liveData.set(cfg.id, {
        machine_id: cfg.id, machine_name: cfg.name,
        connected: false, status: 'offline',
        timestamp: new Date().toISOString()
      });
    }
  }, interval);

  intervals.set(cfg.id, tid);
}

function stopCollector(id) {
  const tid = intervals.get(id);
  if (tid) { clearInterval(tid); intervals.delete(id); }
  const col = collectors.get(id);
  if (col) {
    try { col.client?.end?.(); col.client?.close?.(); } catch (_) {}
    collectors.delete(id);
  }
  liveData.delete(id);
}

// ── INICIALIZAÇÃO ─────────────────────────────────────────────────────────────
async function loadMachines() {
  // Lê do banco primeiro; se vazio, faz seed do .env (primeira execução)
  let machines = db.getMachines();
  if (machines.length === 0) {
    try {
      const fromEnv = JSON.parse(process.env.MACHINES_CONFIG || '[]');
      fromEnv.forEach(m => db.upsertMachine({
        id: m.id, name: m.name, protocol: m.protocol,
        address: m.address || null, port: m.port || null,
        enabled: m.enabled !== false ? 1 : 0,
        registers: m.registers || null
      }));
      machines = db.getMachines();
    } catch (e) {
      console.error('Erro ao ler MACHINES_CONFIG:', e.message);
    }
  }
  console.log(`Conectando ${machines.length} máquina(s)...\n`);
  for (const cfg of machines) await startCollector(cfg);
}

// ── ROTAS API ─────────────────────────────────────────────────────────────────

// Lista todas as máquinas (incluindo desativadas) com status ao vivo
app.get('/api/machines', (req, res) => {
  const machines = db.getAllMachines();
  res.json(machines.map(m => ({
    ...m,
    connected: collectors.get(m.id)?.connected || false,
    latest:    liveData.get(m.id) || null
  })));
});

app.get('/api/metrics', (req, res) => {
  res.json(Array.from(liveData.values()));
});

app.get('/api/metrics/:id', (req, res) => {
  const hours = parseInt(req.query.hours) || 8;
  res.json(db.getMachineHistory(req.params.id, hours));
});

app.get('/api/metrics/:id/hourly', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  res.json(db.getHourlyStats(req.params.id, hours));
});

app.get('/api/metrics/:id/timeline', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  res.json(db.getTimelineByHour(req.params.id, hours));
});

app.get('/api/oee/:id', (req, res) => {
  const hours = parseInt(req.query.hours) || 8;
  const oee   = db.getOEE(req.params.id, hours);
  if (!oee) return res.status(404).json({ error: 'Dados insuficientes' });
  res.json(oee);
});

app.get('/api/events/:id', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  res.json(db.getEvents(req.params.id, hours));
});

app.get('/api/summary', (req, res) => {
  const all = Array.from(liveData.values());
  const run = all.filter(m => m.status === 'running').length;
  res.json({
    total:       all.length,
    running:     run,
    idle:        all.filter(m => m.status === 'idle').length,
    alarm:       all.filter(m => m.status === 'alarm').length,
    offline:     all.filter(m => !m.connected || m.status === 'offline').length,
    utilization: all.length > 0 ? +(run / all.length * 100).toFixed(1) : 0
  });
});

// Criar nova máquina
app.post('/api/machines', async (req, res) => {
  const { id, name, protocol, address, port, registers } = req.body;
  if (!id || !name || !protocol)
    return res.status(400).json({ error: 'id, name e protocol são obrigatórios' });

  const cfg = { id, name, protocol, address: address||null, port: port||null, enabled: 1, registers: registers||null };
  db.upsertMachine(cfg);
  await startCollector(cfg);
  res.json({ ok: true });
});

// Atualizar máquina existente
app.put('/api/machines/:id', async (req, res) => {
  const { id } = req.params;
  const { name, protocol, address, port, enabled, registers } = req.body;
  if (!name || !protocol)
    return res.status(400).json({ error: 'name e protocol são obrigatórios' });

  const cfg = {
    id, name, protocol,
    address:   address  || null,
    port:      port     || null,
    enabled:   enabled  !== false ? 1 : 0,
    registers: registers || null
  };

  db.updateMachine(cfg);
  stopCollector(id);

  if (cfg.enabled) await startCollector(cfg);

  res.json({ ok: true });
});

// Excluir máquina
app.delete('/api/machines/:id', (req, res) => {
  const { id } = req.params;
  stopCollector(id);
  db.deleteMachine(id);
  broadcast('snapshot', { data: Array.from(liveData.values()) });
  res.json({ ok: true });
});

// Testar conexão com máquina
app.post('/api/machines/:id/test', async (req, res) => {
  const machine = db.getAllMachines().find(m => m.id === req.params.id);
  if (!machine) return res.status(404).json({ error: 'Máquina não encontrada' });

  const start = Date.now();
  const col = new Collector(machine);
  try {
    await Promise.race([
      col.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout (5s)')), 5000))
    ]);
    const latency = Date.now() - start;
    try { col.client?.end?.(); col.client?.close?.(); } catch (_) {}
    res.json({ ok: true, latency });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── START ─────────────────────────────────────────────────────────────────────
// ── SERVE FRONTEND ────────────────────────────────────────────────────────────
const path = require('path');
const BUILD_DIR = path.join(__dirname, '..', 'frontend', 'build');
app.use(express.static(BUILD_DIR));
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(BUILD_DIR, 'index.html')));

const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  console.log(`\n⚙  SpindleOps backend rodando em http://localhost:${PORT}`);
  console.log(`📡 WebSocket em ws://localhost:${PORT}\n`);
  await loadMachines();
  console.log('\nPronto!\n');
});
