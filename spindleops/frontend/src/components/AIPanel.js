import React, { useState, useRef, useEffect } from 'react';

// ── ESTILOS INLINE (adicione ao App.css se preferir) ─────────────────────────
const S = {
  panel: {
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 14, padding: 16, marginTop: 16,
  },
  tabs: { display:'flex', gap:6, marginBottom:16, flexWrap:'wrap' },
  tab: (active) => ({
    padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
    border: `1px solid ${active ? '#a78bfa40' : 'var(--border)'}`,
    background: active ? '#a78bfa18' : 'transparent',
    color: active ? '#a78bfa' : 'var(--muted)',
    cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all .15s',
  }),
  card: {
    background: 'var(--bg3)', borderRadius: 10, padding: 14, marginBottom: 12,
  },
  badge: (color) => ({
    display:'inline-block', padding:'2px 8px', borderRadius:5, fontSize:11,
    fontWeight:600, background:`${color}18`, color,
  }),
  btn: (color='#a78bfa') => ({
    display:'inline-flex', alignItems:'center', gap:6,
    padding:'8px 16px', borderRadius:8, fontSize:12, fontWeight:600,
    background: color, color: '#000', border:'none', cursor:'pointer',
    transition:'opacity .15s', fontFamily:'inherit',
  }),
  btnGhost: {
    display:'inline-flex', alignItems:'center', gap:6,
    padding:'8px 14px', borderRadius:8, fontSize:12,
    background:'transparent', color:'var(--muted)',
    border:'1px solid var(--border)', cursor:'pointer', fontFamily:'inherit',
  },
  input: {
    width:'100%', background:'var(--bg)', border:'1px solid var(--border)',
    borderRadius:8, color:'var(--text)', fontFamily:'inherit',
    fontSize:13, padding:'10px 14px', outline:'none',
    resize:'none',
  },
  chatMsg: (role) => ({
    maxWidth:'85%', padding:'10px 14px', borderRadius:10, fontSize:13,
    lineHeight:1.6, marginBottom:8,
    alignSelf: role==='user' ? 'flex-end' : 'flex-start',
    background: role==='user' ? '#38bdf818' : 'var(--bg3)',
    border: `1px solid ${role==='user' ? '#38bdf830' : 'var(--border)'}`,
    color: 'var(--text)',
    borderBottomRightRadius: role==='user' ? 2 : 10,
    borderBottomLeftRadius:  role==='assistant' ? 2 : 10,
  }),
};

// ── SUBCOMPONENTES ────────────────────────────────────────────────────────────

function Spinner() {
  return <span style={{ display:'inline-block', width:14, height:14, border:'2px solid #333', borderTopColor:'#a78bfa', borderRadius:'50%', animation:'spin .6s linear infinite' }} />;
}

function RiskBadge({ risk }) {
  const map = { alto:'#ef4444', medio:'#eab308', baixo:'#22c55e', indeterminado:'#64748b' };
  return <span style={S.badge(map[risk] || '#64748b')}>{risk?.toUpperCase()}</span>;
}

// 1. Preditivo
function PredictiveTab({ machineId, machineName }) {
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState(null);

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      const res  = await fetch(`/api/ai/predictive/${machineId}`, { method:'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div style={{ fontSize:12, color:'var(--muted)' }}>
          Analisa padrões das últimas 8h para detectar risco de falha iminente
        </div>
        <button style={S.btn()} onClick={run} disabled={loading}>
          {loading ? <Spinner /> : '⚡'}
          {loading ? 'Analisando...' : 'Analisar agora'}
        </button>
      </div>

      {error && (
        <div style={{ ...S.card, border:'1px solid #ef444430', color:'#ef4444', fontSize:12 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={S.card}>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
            <RiskBadge risk={result.risco} />
            <div style={{ fontSize:22, fontWeight:700, color:'var(--text)' }}>
              Score de risco: {result.score}/100
            </div>
            <div style={{ ...S.badge('#eab308'), marginLeft:'auto' }}>
              Urgência: {result.urgencia?.replace('_',' ')}
            </div>
          </div>

          {result.sinais?.length > 0 && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>
                Sinais detectados
              </div>
              {result.sinais.map((s, i) => (
                <div key={i} style={{ fontSize:12, padding:'4px 0', borderBottom:'1px solid var(--border)', color:'var(--text)' }}>
                  • {s}
                </div>
              ))}
            </div>
          )}

          <div style={{ background:'var(--bg)', borderRadius:8, padding:12, fontSize:13, color:'var(--text)', lineHeight:1.6 }}>
            <strong style={{ color:'#a78bfa' }}>Recomendação: </strong>{result.recomendacao}
          </div>

          {result.cached && (
            <div style={{ fontSize:10, color:'var(--muted)', marginTop:8 }}>
              Resultado em cache — atualiza a cada 5 minutos
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 2. Resumo do turno
function SummaryTab({ machineId }) {
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [hours,   setHours]   = useState(8);

  async function run() {
    setLoading(true); setResult(null);
    try {
      const res  = await fetch(`/api/ai/summary/${machineId}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ hours }),
      });
      setResult(await res.json());
    } catch {}
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <div style={{ fontSize:12, color:'var(--muted)' }}>Período:</div>
        {[8,12,24].map(h => (
          <button key={h}
            style={{ ...S.btnGhost, padding:'4px 12px', color: hours===h ? '#a78bfa':'var(--muted)', borderColor: hours===h ? '#a78bfa40':'var(--border)' }}
            onClick={() => setHours(h)}
          >
            {h}h
          </button>
        ))}
        <button style={{ ...S.btn(), marginLeft:'auto' }} onClick={run} disabled={loading}>
          {loading ? <Spinner /> : '📋'}
          {loading ? 'Gerando...' : 'Gerar resumo'}
        </button>
      </div>

      {result?.summary && (
        <div>
          <div style={S.card}>
            <div style={{ fontSize:13, lineHeight:1.8, color:'var(--text)' }}>
              {result.summary}
            </div>
          </div>

          {result.stats && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
              {[
                { lbl:'Peças produzidas', val:result.stats.parts,                   unit:'pçs',   color:'#38bdf8' },
                { lbl:'Disponibilidade',  val:result.stats.availability,            unit:'%',     color:'#22c55e' },
                { lbl:'OEE',              val:result.stats.oee,                     unit:'%',     color:'#a78bfa' },
                { lbl:'Usinando',         val:result.stats.run_hours,               unit:'h',     color:'#22c55e' },
                { lbl:'Parada',           val:result.stats.idle_hours,              unit:'h',     color:'#eab308' },
                { lbl:'Alarmes',          val:result.stats.alarms,                  unit:'',      color:result.stats.alarms>0?'#ef4444':'#22c55e' },
              ].map(s => (
                <div key={s.lbl} style={{ background:'var(--bg3)', borderRadius:8, padding:'10px 12px' }}>
                  <div style={{ fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:.5, marginBottom:4 }}>{s.lbl}</div>
                  <div style={{ fontSize:18, fontWeight:700, color:s.color }}>{s.val}<span style={{ fontSize:11, color:'var(--muted)', fontWeight:400 }}> {s.unit}</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 3. Diagnóstico de alarme
function DiagnoseTab({ machineId, currentAlarm }) {
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [code,     setCode]     = useState(currentAlarm?.code    || '');
  const [message,  setMessage]  = useState(currentAlarm?.message || '');

  async function run() {
    if (!code.trim()) return;
    setLoading(true); setResult(null);
    try {
      const res = await fetch(`/api/ai/diagnose/${machineId}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ alarm_code: code, alarm_message: message }),
      });
      setResult(await res.json());
    } catch {}
    finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <input
          style={{ ...S.input, flex:'0 0 120px' }}
          placeholder="Código (ex: ALM-1001)"
          value={code}
          onChange={e => setCode(e.target.value)}
        />
        <input
          style={S.input}
          placeholder="Mensagem do alarme"
          value={message}
          onChange={e => setMessage(e.target.value)}
        />
        <button style={{ ...S.btn(), whiteSpace:'nowrap', flexShrink:0 }} onClick={run} disabled={loading || !code.trim()}>
          {loading ? <Spinner /> : '🔍'}
          {loading ? 'Diagnosticando...' : 'Diagnosticar'}
        </button>
      </div>

      {result?.causa_provavel && (
        <div style={S.card}>
          <div style={{ fontWeight:600, fontSize:14, marginBottom:10, color:'var(--text)' }}>
            {result.alarm_code} — {result.alarm_message}
          </div>

          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>Causa provável</div>
            <div style={{ fontSize:13, color:'var(--text)', lineHeight:1.6 }}>{result.causa_provavel}</div>
          </div>

          {result.causas_alternativas?.length > 0 && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>Causas alternativas</div>
              {result.causas_alternativas.map((c,i) => (
                <div key={i} style={{ fontSize:12, color:'var(--muted)', padding:'2px 0' }}>• {c}</div>
              ))}
            </div>
          )}

          {result.passos_resolucao?.length > 0 && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>Passos para resolver</div>
              {result.passos_resolucao.map((p,i) => (
                <div key={i} style={{ display:'flex', gap:8, padding:'4px 0', fontSize:12, borderBottom:'1px solid var(--border)', color:'var(--text)' }}>
                  <span style={{ color:'#a78bfa', fontWeight:600, flexShrink:0 }}>{i+1}.</span>
                  {p}
                </div>
              ))}
            </div>
          )}

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {result.tempo_estimado && (
              <div style={{ background:'var(--bg)', borderRadius:8, padding:10, fontSize:12 }}>
                <div style={{ color:'var(--muted)', fontSize:10, marginBottom:3 }}>Tempo estimado</div>
                <div style={{ color:'#eab308', fontWeight:600 }}>{result.tempo_estimado}</div>
              </div>
            )}
            {result.prevencao && (
              <div style={{ background:'var(--bg)', borderRadius:8, padding:10, fontSize:12 }}>
                <div style={{ color:'var(--muted)', fontSize:10, marginBottom:3 }}>Prevenção</div>
                <div style={{ color:'#22c55e' }}>{result.prevencao}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 4. Chat
function ChatTab() {
  const [messages,  setMessages]  = useState([
    { role:'assistant', content:'Olá! Sou o assistente do SpindleOps. Pergunte-me sobre o status das máquinas, produção, alarmes ou qualquer dado da fábrica.' }
  ]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef             = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:'smooth' });
  }, [messages]);

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');

    const newMessages = [...messages, { role:'user', content:q }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const history = newMessages.slice(-8).filter(m => m.role !== 'system');
      const res = await fetch('/api/ai/chat', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ question:q, history: history.slice(0,-1) }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role:'assistant', content: data.answer || data.error || 'Sem resposta' }]);
    } catch (e) {
      setMessages(prev => [...prev, { role:'assistant', content:`Erro: ${e.message}` }]);
    }
    finally { setLoading(false); }
  }

  const suggestions = [
    'Qual máquina produziu mais peças hoje?',
    'Tem algum alarme ativo agora?',
    'Qual é a utilização geral da fábrica?',
    'Qual máquina está com menor OEE?',
  ];

  return (
    <div>
      <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:320, overflowY:'auto', marginBottom:12, padding:'4px 0' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display:'flex', justifyContent: m.role==='user' ? 'flex-end':'flex-start' }}>
            <div style={S.chatMsg(m.role)}>{m.content}</div>
          </div>
        ))}
        {loading && (
          <div style={{ display:'flex' }}>
            <div style={{ ...S.chatMsg('assistant'), color:'var(--muted)' }}>
              <Spinner /> Analisando dados da fábrica...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length <= 1 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
          {suggestions.map(s => (
            <button key={s} style={{ ...S.btnGhost, fontSize:11, padding:'4px 10px' }}
              onClick={() => { setInput(s); }}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div style={{ display:'flex', gap:8 }}>
        <textarea
          style={{ ...S.input, height:44, resize:'none' }}
          placeholder="Pergunte sobre as máquinas, produção, alarmes..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
        />
        <button
          style={{ ...S.btn('#38bdf8'), flexShrink:0, alignSelf:'flex-end' }}
          onClick={send}
          disabled={loading || !input.trim()}
        >
          {loading ? <Spinner /> : '→'}
        </button>
      </div>
    </div>
  );
}

// ── PAINEL PRINCIPAL ──────────────────────────────────────────────────────────
export default function AIPanel({ machineId, machineName, currentAlarm }) {
  const [tab, setTab] = useState('predictive');

  const tabs = [
    { id:'predictive', label:'⚡ Preditivo' },
    { id:'summary',    label:'📋 Resumo turno' },
    { id:'diagnose',   label:'🔍 Diagnóstico' },
    { id:'chat',       label:'💬 Chat' },
  ];

  return (
    <div style={S.panel}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
        <div style={{ fontSize:13, fontWeight:600, color:'#a78bfa', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:16 }}>✦</span> SpindleOps AI
          {machineName && <span style={{ color:'var(--muted)', fontWeight:400 }}>— {machineName}</span>}
        </div>
        <div style={{ fontSize:10, color:'var(--muted)', fontFamily:'monospace' }}>
          claude-sonnet-4-5
        </div>
      </div>

      <div style={S.tabs}>
        {tabs.map(t => (
          <button key={t.id} style={S.tab(tab===t.id)} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab==='predictive' && <PredictiveTab machineId={machineId} machineName={machineName} />}
      {tab==='summary'    && <SummaryTab    machineId={machineId} />}
      {tab==='diagnose'   && <DiagnoseTab   machineId={machineId} currentAlarm={currentAlarm} />}
      {tab==='chat'       && <ChatTab />}
    </div>
  );
}
