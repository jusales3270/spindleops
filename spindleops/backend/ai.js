/**
 * SpindleOps — AI Module
 *
 * Quatro funcionalidades usando Claude API:
 *   1. predictive  — detecta padrões que antecedem falhas
 *   2. shiftSummary — resumo automático do turno em linguagem natural
 *   3. diagnoseAlarm — diagnóstico de causa de alarmes
 *   4. chat — perguntas livres sobre os dados da fábrica
 *
 * Requer: ANTHROPIC_API_KEY no .env
 */

const db = require('./database');

const CLAUDE_MODEL = 'claude-sonnet-4-5-20251001';
const API_URL      = 'https://api.anthropic.com/v1/messages';

// ── CLIENTE CLAUDE ────────────────────────────────────────────────────────────
async function callClaude(systemPrompt, userMessage, maxTokens = 1024) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada no .env');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API erro ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ── FORMATADORES DE CONTEXTO ──────────────────────────────────────────────────

function formatMachineContext(machine, history = [], events = []) {
  const recent = history.slice(-48); // últimas 4h (leitura a cada 5s)
  const loads  = recent.map(r => r.spindle_load).filter(Boolean);
  const avgLoad = loads.length
    ? (loads.reduce((a, b) => a + b, 0) / loads.length).toFixed(1)
    : 'N/A';

  return `
Máquina: ${machine.name}
Protocolo: ${machine.protocol}
Status atual: ${machine.status || 'desconhecido'}
Programa ativo: ${machine.program_name || '—'}
Spindle: ${machine.spindle_speed || 0} RPM
Carga spindle: ${machine.spindle_load || 0}%
Carga média (últimas 4h): ${avgLoad}%
Avanço: ${machine.feed_rate || 0} mm/min
Peças produzidas: ${machine.parts_count || 0}
Alarme ativo: ${machine.alarm_code ? `${machine.alarm_code} — ${machine.alarm_message}` : 'nenhum'}

Últimos eventos:
${events.slice(0, 10).map(e =>
  `  [${new Date(e.timestamp).toLocaleTimeString('pt-BR')}] ${e.type}: ${e.description}`
).join('\n') || '  Nenhum evento registrado'}
`.trim();
}

function formatLoadTrend(history) {
  const byHour = {};
  history.forEach(r => {
    const h = new Date(r.timestamp).getHours();
    if (!byHour[h]) byHour[h] = [];
    if (r.spindle_load) byHour[h].push(r.spindle_load);
  });

  return Object.entries(byHour)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([h, vals]) => {
      const avg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
      return `${h}h: ${avg}%`;
    })
    .join(' | ');
}

// ── 1. DETECÇÃO PREDITIVA DE FALHAS ──────────────────────────────────────────
async function predictive(machineId) {
  const machine = db.getMachines().find(m => m.id === machineId);
  if (!machine) throw new Error('Máquina não encontrada');

  const history = db.getMachineHistory(machineId, 8);
  const events  = db.getEvents(machineId, 24);
  const oee     = db.getOEE(machineId, 8);

  // Calcula tendência de carga nas últimas horas
  const loadTrend = formatLoadTrend(history);

  // Conta alarmes recentes
  const recentAlarms = events.filter(e => e.type === 'alarm');

  const system = `Você é um especialista em manutenção preditiva de máquinas CNC.
Analise os dados operacionais fornecidos e identifique sinais de alerta
que podem indicar uma falha iminente. Seja objetivo e prático.
Responda sempre em português brasileiro.
Formato da resposta: JSON com os campos:
{
  "risco": "alto" | "medio" | "baixo",
  "score": 0-100,
  "sinais": ["sinal 1", "sinal 2"],
  "recomendacao": "ação recomendada em 1-2 frases",
  "urgencia": "imediata" | "proximas_horas" | "proximos_dias" | "nenhuma"
}`;

  const user = `Analise esta máquina CNC para riscos de falha:

${formatMachineContext(machine, history, events)}

Tendência de carga spindle por hora:
${loadTrend}

Alarmes nas últimas 24h: ${recentAlarms.length}
${recentAlarms.map(a => `  - ${a.description}`).join('\n')}

OEE atual: ${oee?.oee ?? 'N/A'}%
Disponibilidade: ${oee?.availability ?? 'N/A'}%

Identifique padrões de risco e retorne o JSON solicitado.`;

  const text = await callClaude(system, user, 512);

  try {
    const clean = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { risco: 'indeterminado', score: 0, sinais: [], recomendacao: text, urgencia: 'nenhuma' };
  }
}

// ── 2. RESUMO AUTOMÁTICO DO TURNO ─────────────────────────────────────────────
async function shiftSummary(machineId, hours = 8) {
  const machine = db.getMachines().find(m => m.id === machineId);
  if (!machine) throw new Error('Máquina não encontrada');

  const history = db.getMachineHistory(machineId, hours);
  const events  = db.getEvents(machineId, hours);
  const oee     = db.getOEE(machineId, hours);
  const hourly  = db.getHourlyStats(machineId, hours);

  const totalParts = hourly.reduce((a, h) => a + (h.parts_produced || 0), 0);
  const runHours   = history.filter(r => r.status === 'running').length * 5 / 3600;
  const idleHours  = history.filter(r => r.status === 'idle').length * 5 / 3600;
  const alarmCount = events.filter(e => e.type === 'alarm').length;

  const system = `Você é um assistente de gestão industrial que gera relatórios
de turno para donos de empresas de usinagem.
Escreva de forma clara, direta e em português brasileiro.
Use números concretos. Seja como um gerente de fábrica experiente relatando o turno.
Evite jargões técnicos excessivos.`;

  const user = `Gere um resumo executivo do turno para esta máquina:

Máquina: ${machine.name}
Duração monitorada: ${hours}h

Indicadores do turno:
- Peças produzidas: ${totalParts}
- Tempo usinando: ${runHours.toFixed(1)}h (${oee?.availability ?? 0}% de disponibilidade)
- Tempo parada: ${idleHours.toFixed(1)}h
- OEE: ${oee?.oee ?? 'N/A'}%
- Alarmes: ${alarmCount}

Eventos do turno:
${events.slice(0, 15).map(e =>
  `[${new Date(e.timestamp).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}] ${e.type}: ${e.description}`
).join('\n') || 'Nenhum evento'}

Carga média do spindle por hora:
${formatLoadTrend(history)}

Escreva um parágrafo de resumo executivo (4-6 frases) que o dono da empresa
possa ler em 30 segundos e entender o que aconteceu neste turno.
Destaque conquistas, problemas e pontos de atenção.`;

  const summary = await callClaude(system, user, 512);
  return {
    summary,
    stats: {
      parts:        totalParts,
      run_hours:    +runHours.toFixed(1),
      idle_hours:   +idleHours.toFixed(1),
      availability: oee?.availability ?? 0,
      oee:          oee?.oee ?? 0,
      alarms:       alarmCount,
    }
  };
}

// ── 3. DIAGNÓSTICO DE ALARME ──────────────────────────────────────────────────
async function diagnoseAlarm(machineId, alarmCode, alarmMessage) {
  const machine = db.getMachines().find(m => m.id === machineId);
  if (!machine) throw new Error('Máquina não encontrada');

  const history      = db.getMachineHistory(machineId, 4);  // 4h antes do alarme
  const pastAlarms   = db.getEvents(machineId, 168);         // 7 dias de histórico
  const sameAlarms   = pastAlarms.filter(e =>
    e.type === 'alarm' && e.description?.includes(alarmCode)
  );

  // Dados 30 minutos antes do alarme (tendência)
  const preTrend = history.slice(-6).map(r =>
    `spindle: ${r.spindle_load?.toFixed(0) ?? 0}%, feed: ${r.feed_rate?.toFixed(0) ?? 0} mm/min`
  ).join(' → ');

  const system = `Você é um técnico especialista em manutenção de máquinas CNC
com vasto conhecimento em alarmes Fanuc e Siemens.
Analise o alarme e forneça um diagnóstico prático.
Responda em português brasileiro.
Formato JSON:
{
  "causa_provavel": "descrição em 1-2 frases",
  "causas_alternativas": ["causa 2", "causa 3"],
  "passos_resolucao": ["passo 1", "passo 2", "passo 3"],
  "tempo_estimado": "estimativa de tempo para resolver",
  "recorrencia": "análise se é alarme recorrente",
  "prevencao": "como evitar no futuro"
}`;

  const user = `Diagnostique este alarme CNC:

Máquina: ${machine.name} (${machine.protocol})
Alarme: ${alarmCode}
Mensagem: ${alarmMessage}

Contexto antes do alarme:
${preTrend || 'Sem dados de tendência'}

Histórico de ocorrências nas últimas 168h:
- Mesmo alarme: ${sameAlarms.length} vezes
${sameAlarms.slice(0, 5).map(a =>
  `  [${new Date(a.timestamp).toLocaleDateString('pt-BR')} ${new Date(a.timestamp).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}] ${a.description}`
).join('\n')}

Forneça diagnóstico completo e passos práticos de resolução.`;

  const text = await callClaude(system, user, 768);

  try {
    const clean = text.replace(/```json\n?|\n?```/g, '').trim();
    return { alarm_code: alarmCode, alarm_message: alarmMessage, ...JSON.parse(clean) };
  } catch {
    return { alarm_code: alarmCode, alarm_message: alarmMessage, causa_provavel: text, passos_resolucao: [] };
  }
}

// ── 4. CHAT COM OS DADOS DA FÁBRICA ──────────────────────────────────────────
async function chat(question, conversationHistory = []) {
  // Contexto completo de todas as máquinas
  const machines    = db.getMachines();
  const latestStats = db.getLatestMetrics();
  const summary     = db.getSummary();

  const factoryContext = machines.map(m => {
    const latest = latestStats.find(s => s.machine_id === m.id);
    const oee    = db.getOEE(m.id, 8);
    return `
${m.name} (${m.protocol} · ${m.address || 'simulador'}):
  Status: ${latest?.status || 'offline'}
  Spindle: ${latest?.spindle_speed || 0} RPM | Carga: ${latest?.spindle_load || 0}%
  Avanço: ${latest?.feed_rate || 0} mm/min
  Peças hoje: ${latest?.parts_count || 0}
  OEE (8h): ${oee?.oee ?? 'N/A'}%
  Alarme ativo: ${latest?.alarm_code ? `${latest.alarm_code} — ${latest.alarm_message}` : 'nenhum'}
    `.trim();
  }).join('\n\n');

  const running = summary.filter(m => m.status === 'running').length;
  const util    = summary.length > 0
    ? Math.round(running / summary.length * 100)
    : 0;

  const system = `Você é o assistente de IA do SpindleOps, sistema de monitoramento CNC.
Você tem acesso aos dados em tempo real de todas as máquinas CNC da fábrica.
Responda perguntas sobre produção, status, alarmes, OEE e eficiência.
Seja direto, use dados concretos e fale como um gerente de fábrica experiente.
Responda sempre em português brasileiro.
Não invente dados — use apenas o que está no contexto fornecido.
Se não souber algo, diga claramente.`;

  const contextMessage = `Dados atuais da fábrica (${new Date().toLocaleString('pt-BR')}):

Resumo geral:
- Total de máquinas: ${summary.length}
- Usinando agora: ${running}
- Utilização: ${util}%
- Alarmes ativos: ${summary.filter(m => m.status === 'alarm').length}

Detalhes por máquina:
${factoryContext}

Pergunta do usuário: ${question}`;

  // Monta histórico de conversa para contexto
  const messages = [
    ...conversationHistory.slice(-6).map(msg => ({
      role:    msg.role,
      content: msg.content,
    })),
    { role: 'user', content: contextMessage }
  ];

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 1024,
      system,
      messages,
    }),
  });

  if (!res.ok) throw new Error(`Claude API erro ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

module.exports = { predictive, shiftSummary, diagnoseAlarm, chat };
