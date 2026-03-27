/**
 * SpindleOps — AI Routes
 *
 * Adicione ao server.js:
 *   const aiRoutes = require('./ai-routes');
 *   app.use('/api/ai', aiRoutes);
 *
 * Endpoints:
 *   POST /api/ai/predictive/:machineId    → análise preditiva
 *   POST /api/ai/summary/:machineId       → resumo do turno
 *   POST /api/ai/diagnose/:machineId      → diagnóstico de alarme
 *   POST /api/ai/chat                     → chat livre com os dados
 */

const express = require('express');
const router  = express.Router();
const ai      = require('./ai');

// Cache simples para não chamar a API toda hora para a mesma máquina
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.ts > CACHE_TTL) { cache.delete(key); return null; }
  return item.data;
}
function setCached(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// POST /api/ai/predictive/:machineId
router.post('/predictive/:machineId', async (req, res) => {
  try {
    const key    = `pred:${req.params.machineId}`;
    const cached = getCached(key);
    if (cached) return res.json({ ...cached, cached: true });

    const result = await ai.predictive(req.params.machineId);
    setCached(key, result);
    res.json(result);
  } catch (err) {
    console.error('AI predictive error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/summary/:machineId
router.post('/summary/:machineId', async (req, res) => {
  try {
    const hours  = parseInt(req.body?.hours) || 8;
    const key    = `summary:${req.params.machineId}:${hours}`;
    const cached = getCached(key);
    if (cached) return res.json({ ...cached, cached: true });

    const result = await ai.shiftSummary(req.params.machineId, hours);
    setCached(key, result);
    res.json(result);
  } catch (err) {
    console.error('AI summary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/diagnose/:machineId
router.post('/diagnose/:machineId', async (req, res) => {
  try {
    const { alarm_code, alarm_message } = req.body;
    if (!alarm_code) return res.status(400).json({ error: 'alarm_code é obrigatório' });

    const result = await ai.diagnoseAlarm(req.params.machineId, alarm_code, alarm_message || '');
    res.json(result);
  } catch (err) {
    console.error('AI diagnose error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/chat
// Body: { question: string, history: [{role, content}] }
router.post('/chat', async (req, res) => {
  try {
    const { question, history = [] } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: 'question é obrigatória' });

    const answer = await ai.chat(question, history);
    res.json({ answer, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('AI chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
