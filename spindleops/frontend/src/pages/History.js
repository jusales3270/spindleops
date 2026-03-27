import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar,
  LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { useAPI } from '../hooks/useData';
import ThemeToggle from '../components/ThemeToggle';

const HOURS_MAP = { hoje: 24, ontem: 48, semana: 168 };
const TL_COLOR  = { running:'#22c55e', idle:'#eab308', alarm:'#ef4444', off:'#1e2a3a' };
const EV_CFG = {
  running: { label:'Usinando', color:'#22c55e', bg:'#22c55e18' },
  idle:    { label:'Parada',   color:'#eab308', bg:'#eab30818' },
  alarm:   { label:'Alarme',   color:'#ef4444', bg:'#ef444418' },
  offline: { label:'Offline',  color:'#64748b', bg:'#64748b18' },
  program: { label:'Programa', color:'#38bdf8', bg:'#38bdf818' },
  on:      { label:'Ligada',   color:'#a78bfa', bg:'#a78bfa18' },
};

const CHART_OPTS = {
  grid: 'rgba(128,128,128,.1)',
  text: '#64748b',
  tooltip: { contentStyle:{ background:'#0e1420', border:'1px solid #1e2a3a', borderRadius:8, fontSize:12 }, labelStyle:{ color:'#64748b' } }
};

export default function History() {
  const { id }      = useParams();
  const navigate    = useNavigate();
  const { data: machines } = useAPI('/machines', 0);

  const [curId,     setCurId]     = useState(id || null);
  const [period,    setPeriod]    = useState('hoje');

  const hours   = HOURS_MAP[period] || 24;
  const { data: hourly }  = useAPI(curId ? `/metrics/${curId}/hourly?hours=${hours}`  : null, 30000);
  const { data: timeline} = useAPI(curId ? `/metrics/${curId}/timeline?hours=${hours}` : null, 30000);
  const { data: events }  = useAPI(curId ? `/events/${curId}?hours=${hours}`           : null, 30000);
  const { data: oee }     = useAPI(curId ? `/oee/${curId}?hours=${Math.min(hours,8)}`  : null, 30000);

  // Seleciona primeira máquina automaticamente
  useEffect(() => {
    if (!curId && machines?.length > 0) setCurId(machines[0].id);
  }, [machines, curId]);

  const curMachine = machines?.find(m => m.id === curId);

  // Gráficos
  const chartData = (hourly || []).map(h => ({
    hora:  h.hour?.slice(11,16) || '',
    carga: +(h.avg_spindle_load || 0).toFixed(1),
    rpm:   Math.round(h.avg_rpm || 0),
    peças: h.parts_produced || 0,
    disp:  h.samples > 0 ? +((h.running_samples / h.samples) * 100).toFixed(1) : 0,
  }));

  // Timeline hora a hora
  const tlMap = {};
  (timeline || []).forEach(t => { tlMap[parseInt(t.hour)] = t.dominant_status; });
  const tlSegs = Array.from({ length: 24 }, (_, i) => ({
    h: i, status: tlMap[i] || 'off'
  }));

  // KPIs
  const run    = oee?.availability ?? 0;
  const oeeVal = oee?.oee          ?? 0;
  const parts  = oee?.parts_produced ?? 0;
  const alarms = (events || []).filter(e => e.type === 'alarm').length;

  return (
    <div className="page">
      {/* Header */}
      <header className="app-header">
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <Link to="/" className="app-logo">
            <img src={process.env.PUBLIC_URL + '/logo.png'} alt="SpindleOps" className="app-logo-img" />
          </Link>
        </div>
        <div className="nav-tabs">
          <Link to="/"          className="nav-tab">Dashboard</Link>
          <Link to="/history"   className="nav-tab active">Histórico</Link>
          <Link to="/settings"  className="nav-tab">Configurações</Link>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <ThemeToggle />
          <button className="btn-ghost" onClick={() => navigate('/')}>← Ao vivo</button>
        </div>
      </header>

      <div className="main-content">

        {/* Seleção máquina + período */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16, flexWrap:'wrap', gap:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            {curMachine && (
              <div>
                <div style={{ fontSize:15, fontWeight:600 }}>{curMachine.name}</div>
                <div style={{ fontSize:11, color:'#64748b' }}>
                  {curMachine.protocol} · {curMachine.address || 'simulator'}
                </div>
              </div>
            )}
          </div>
          <div className="history-controls">
            <div className="tab-group">
              {(machines || []).map(m => (
                <button
                  key={m.id}
                  className={`tab-btn${curId === m.id ? ' on' : ''}`}
                  onClick={() => { setCurId(m.id); navigate(`/history/${m.id}`); }}
                >
                  {m.name}
                </button>
              ))}
            </div>
            <div className="period-group">
              {['hoje','ontem','semana'].map(p => (
                <button
                  key={p}
                  className={`period-btn${period === p ? ' on' : ''}`}
                  onClick={() => setPeriod(p)}
                >
                  {p === 'hoje' ? 'Hoje' : p === 'ontem' ? 'Ontem' : '7 dias'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="kpi-grid">
          {[
            { lbl:'Disponibilidade', val:run,    unit:'%',   sub:`período de ${Math.min(hours,24)}h`,  color: run>=75?'#22c55e':'#eab308' },
            { lbl:'OEE estimado',    val:oeeVal, unit:'%',   sub:'Disp. × Desemp. × Qual.',             color: oeeVal>=75?'#22c55e':'#eab308' },
            { lbl:'Peças produzidas',val:parts,  unit:'pçs', sub:'no período',                          color:'#38bdf8' },
            { lbl:'Alarmes',         val:alarms, unit:'',    sub:alarms>0?'verificar eventos':'nenhum', color:alarms>0?'#ef4444':'#22c55e' },
          ].map(k => (
            <div key={k.lbl} className="kpi-card">
              <div className="kpi-lbl">{k.lbl}</div>
              <div className="kpi-val" style={{ color:k.color }}>
                {k.val}<span className="kpi-unit">{k.unit}</span>
              </div>
              <div className="kpi-sub">{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Linha do tempo */}
        <div className="tl-wrap">
          <div className="sec-lbl">Linha do tempo — status hora a hora</div>
          <div className="tl-hours">
            {tlSegs.map(s => <span key={s.h}>{s.h}h</span>)}
          </div>
          <div className="tl-track">
            {tlSegs.map(s => (
              <div
                key={s.h} className="tl-seg"
                title={`${s.h}h — ${s.status}`}
                style={{ flex:1, background:TL_COLOR[s.status]||TL_COLOR.off, opacity:s.status==='off'?.3:1 }}
              />
            ))}
          </div>
          <div className="tl-legend">
            {[['#22c55e','Usinando'],['#eab308','Parada'],['#ef4444','Alarme'],['#1e2a3a','Desligada']].map(([c,l])=>(
              <div key={l} className="tl-leg"><div className="tl-sq" style={{background:c}}/>{l}</div>
            ))}
          </div>
        </div>

        {/* Gráficos */}
        <div className="charts-grid">
          <div className="chart-card">
            <div className="sec-lbl">Carga spindle (%) — por hora</div>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={chartData}>
                <CartesianGrid stroke={CHART_OPTS.grid} strokeDasharray="3 3" />
                <XAxis dataKey="hora" tick={{ fill:CHART_OPTS.text, fontSize:10 }} />
                <YAxis domain={[0,100]} tick={{ fill:CHART_OPTS.text, fontSize:10 }} tickFormatter={v=>v+'%'} />
                <Tooltip {...CHART_OPTS.tooltip} formatter={v=>[v+'%','Carga']} />
                <Bar dataKey="carga" fill="#22c55e" radius={[3,3,0,0]}
                  label={false}
                  // cor dinâmica por valor
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card">
            <div className="sec-lbl">Peças produzidas — por hora</div>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={chartData}>
                <CartesianGrid stroke={CHART_OPTS.grid} strokeDasharray="3 3" />
                <XAxis dataKey="hora" tick={{ fill:CHART_OPTS.text, fontSize:10 }} />
                <YAxis tick={{ fill:CHART_OPTS.text, fontSize:10 }} />
                <Tooltip {...CHART_OPTS.tooltip} formatter={v=>[v+' pçs','Peças']} />
                <Bar dataKey="peças" fill="#38bdf8" radius={[3,3,0,0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card full">
            <div className="sec-lbl">Rotação spindle (RPM) — por hora</div>
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="rpmGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#a78bfa" stopOpacity={.3} />
                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART_OPTS.grid} strokeDasharray="3 3" />
                <XAxis dataKey="hora" tick={{ fill:CHART_OPTS.text, fontSize:10 }} />
                <YAxis tick={{ fill:CHART_OPTS.text, fontSize:10 }} tickFormatter={v=>v>0?v.toLocaleString('pt-BR'):'0'} />
                <Tooltip {...CHART_OPTS.tooltip} formatter={v=>[v.toLocaleString('pt-BR')+' rpm','RPM']} />
                <Area dataKey="rpm" stroke="#a78bfa" strokeWidth={1.5} fill="url(#rpmGrad)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Registro de eventos */}
        <div className="sec-lbl">Registro de eventos</div>
        <div className="ev-table">
          <div className="ev-head">
            <span>Hora</span><span>Tipo</span><span>Descrição</span><span>Status</span>
          </div>
          {(events || []).length === 0 && (
            <div style={{ padding:'20px 14px', color:'#64748b', fontSize:12 }}>
              Nenhum evento registrado no período.
            </div>
          )}
          {(events || []).map((e, i) => {
            const cfg = EV_CFG[e.type] || EV_CFG.on;
            return (
              <div key={i} className="ev-row">
                <span className="ev-time">
                  {new Date(e.timestamp).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}
                </span>
                <span>
                  <span className="ev-badge" style={{ color:cfg.color, background:cfg.bg }}>
                    {cfg.label}
                  </span>
                </span>
                <span className="ev-desc">{e.description}</span>
                <span className="ev-dur">{e.resolved ? 'resolvido' : 'ativo'}</span>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
