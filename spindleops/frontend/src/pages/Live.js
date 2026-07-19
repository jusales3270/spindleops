import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveData, useAPI } from '../hooks/useData';
import AIPanel from '../components/AIPanel';
import ThemeToggle from '../components/ThemeToggle';

const STATUS = {
  running: { label: 'Usinando', color: '#22c55e' },
  idle:    { label: 'Parada',   color: '#eab308' },
  alarm:   { label: 'Alarme',   color: '#ef4444' },
  offline: { label: 'Offline',  color: '#64748b' },
};

function loadColor(load) {
  return load > 85 ? '#ef4444' : load > 60 ? '#22c55e' : '#eab308';
}

export default function Live() {
  const { machines, connected } = useLiveData();
  const { data: summary }       = useAPI('/summary', 5000);
  const [selected, setSelected] = useState(null);
  const [tick, setTick]         = useState(0);
  const navigate                = useNavigate();

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const sel = machines.find(m => m.machine_id === selected);

  const run  = summary?.running || 0;
  const idle = summary?.idle    || 0;
  const alm  = summary?.alarm   || 0;
  const util = summary?.utilization || 0;

  return (
    <div className="page">
      {/* Header */}
      <header className="app-header">
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <Link to="/" className="app-logo">
            <img src={process.env.PUBLIC_URL + '/logo.png'} alt="SpindleOps" className="app-logo-img" />
          </Link>
          <div className={`live-badge${connected ? '' : ' live-badge--off'}`}>
            <div className="live-badge-dot" style={{ background: connected ? '#22c55e' : '#ef4444' }} />
            {connected ? 'AO VIVO' : 'OFFLINE'}
          </div>
        </div>
        <div className="nav-tabs">
          <Link to="/"          className="nav-tab active">Dashboard</Link>
          <Link to="/history"   className="nav-tab">Histórico</Link>
          <Link to="/settings"  className="nav-tab">Configurações</Link>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <ThemeToggle />
          <div className="app-clock">{new Date().toLocaleTimeString('pt-BR')}</div>
        </div>
      </header>

      <div className="main-content">

        {/* Resumo geral */}
        <div className="summary-grid">
          {[
            { lbl: 'Usinando',    val: run,  color: '#22c55e' },
            { lbl: 'Paradas',     val: idle, color: '#eab308' },
            { lbl: 'Alarmes',     val: alm,  color: '#ef4444' },
            { lbl: 'Máquinas',    val: summary?.total || 0, color: '#e2e8f0' },
          ].map(s => (
            <div key={s.lbl} className="stat-card">
              <div className="stat-val" style={{ color: s.color }}>{s.val}</div>
              <div className="stat-lbl">{s.lbl}</div>
            </div>
          ))}
        </div>

        {/* Barra utilização */}
        <div className="util-wrap">
          <div className="util-meta">
            <span>Utilização da fábrica</span>
            <span style={{ fontWeight: 600 }}>{util}%</span>
          </div>
          <div className="util-track">
            <div className="util-fill" style={{ width: `${util}%` }} />
          </div>
        </div>

        {/* Cards das máquinas */}
        <div className="sec-lbl">Máquinas</div>
        <div className="machines-grid">
          {machines.length === 0 && (
            <div className="empty-state" style={{ gridColumn:'1/-1' }}>
              <div className="empty-icon">⚙</div>
              <p>Aguardando dados das máquinas...</p>
              <small>Verifique se o backend está rodando</small>
            </div>
          )}
          {machines.map(m => {
            const st  = STATUS[m.status] || STATUS.offline;
            const lc  = loadColor(m.spindle_load || 0);
            const sel = m.machine_id === selected;
            return (
              <div
                key={m.machine_id}
                className={`machine-card${sel ? ' selected' : ''}`}
                onClick={() => setSelected(sel ? null : m.machine_id)}
              >
                <div className="mc-header">
                  <div className="mc-name">
                    <div className="mc-dot" style={{ background: st.color, boxShadow: `0 0 6px ${st.color}80` }} />
                    {m.machine_name}
                  </div>
                  <span className="mc-proto">{m.protocol}</span>
                </div>

                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div className="mc-status" style={{ color: st.color }}>{st.label}</div>
                    {m.cnc_mode && (
                      <span className="mc-mode" title="Modo de operação do CNC">{m.cnc_mode}</span>
                    )}
                  </div>
                  {m.program_name && m.program_name !== '—' && (
                    <div className="mc-prog">▶ {m.program_name}</div>
                  )}
                </div>

                <div className="mc-metrics">
                  <div className="mc-metric">
                    <div className="mc-metric-lbl">Spindle</div>
                    <div className="mc-metric-val" style={{ color: st.color }}>
                      {m.spindle_speed > 0 ? m.spindle_speed.toLocaleString('pt-BR') : '—'}
                      <span className="mc-metric-unit"> rpm</span>
                    </div>
                  </div>
                  <div className="mc-metric">
                    <div className="mc-metric-lbl">Avanço</div>
                    <div className="mc-metric-val">
                      {m.feed_rate > 0 ? Math.round(m.feed_rate) : '—'}
                      <span className="mc-metric-unit"> mm/m</span>
                    </div>
                  </div>
                  <div className="mc-metric">
                    <div className="mc-metric-lbl">Ferram.</div>
                    <div className="mc-metric-val" style={{ color: '#a78bfa' }} title="Ferramenta em uso (T)">
                      {m.tool_number != null ? `T${m.tool_number}` : '—'}
                    </div>
                  </div>
                  <div className="mc-metric">
                    <div className="mc-metric-lbl">Peças</div>
                    <div className="mc-metric-val" style={{ color: '#38bdf8' }}>
                      {m.parts_count ?? '—'}
                    </div>
                  </div>
                </div>

                {m.status === 'running' && (
                  <div className="mc-gauge">
                    <div className="mc-gauge-hdr">
                      <span>Carga spindle</span>
                      <span style={{ color: lc, fontWeight: 600 }}>
                        {(m.spindle_load || 0).toFixed(1)}%
                      </span>
                    </div>
                    <div className="mc-gauge-track">
                      <div className="mc-gauge-fill" style={{ width: `${m.spindle_load || 0}%`, background: lc }} />
                    </div>
                  </div>
                )}

                {m.alarm_code && (
                  <div className="mc-alarm">⚠ {m.alarm_code} — {m.alarm_message}</div>
                )}

                <div className="mc-ip">{m.address}</div>
              </div>
            );
          })}
        </div>

        {/* Painel de detalhe */}
        {sel && (
          <>
            <div className="detail-panel">
              <div className="detail-hdr">
                <div>
                  <div className="detail-title">
                    {sel.machine_name} — {(STATUS[sel.status] || STATUS.offline).label}
                  </div>
                  <div className="detail-sub">
                    {sel.protocol} · {sel.address}
                    {sel.program_name && sel.program_name !== '—' ? ` · ${sel.program_name}` : ''}
                  </div>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button
                    className="btn-primary"
                    onClick={() => navigate(`/history/${sel.machine_id}`)}
                  >
                    Ver histórico →
                  </button>
                  <button className="btn-ghost" onClick={() => setSelected(null)}>
                    ✕
                  </button>
                </div>
              </div>
  
              <div className="detail-metrics">
                {[
                  { lbl: 'Rotação spindle', val: sel.spindle_speed > 0 ? sel.spindle_speed.toLocaleString('pt-BR') : '—', unit: 'rpm', color: (STATUS[sel.status]||STATUS.offline).color },
                  { lbl: 'Taxa de avanço',  val: sel.feed_rate > 0 ? Math.round(sel.feed_rate) : '—', unit: 'mm/min' },
                  { lbl: 'Ferramenta',      val: sel.tool_number != null ? `T${sel.tool_number}` : '—', unit: '', color: '#a78bfa' },
                  { lbl: 'Modo CNC',        val: sel.cnc_mode || '—', unit: '' },
                  { lbl: 'Peças no turno',  val: sel.parts_count ?? '—', unit: 'pçs', color: '#38bdf8' },
                ].map(d => (
                  <div key={d.lbl}>
                    <div className="detail-metric-lbl">{d.lbl}</div>
                    <div className="detail-metric-val" style={{ color: d.color || '#e2e8f0' }}>
                      {d.val}<span className="detail-metric-unit"> {d.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
  
              <div className="sec-lbl">Posição atual dos eixos</div>
              <div className="pos-grid">
                {['X','Y','Z'].map((ax, i) => {
                  const v    = [sel.pos_x, sel.pos_y, sel.pos_z][i];
                  const load = [sel.axis_load_x, sel.axis_load_y, sel.axis_load_z][i];
                  return (
                    <div key={ax} className="pos-box">
                      <div className="pos-ax">Eixo {ax}</div>
                      <div className="pos-val" style={{ color:'#a78bfa' }}>
                        {v != null ? v.toFixed(3) : '—'}
                        <span style={{ fontSize:11, color:'#64748b', fontWeight:400 }}> mm</span>
                      </div>
                      {load != null && (
                        <div className="pos-load" title={`Carga do eixo ${ax}`}>
                          <div className="mc-gauge-track" style={{ height:4, flex:1 }}>
                            <div className="mc-gauge-fill" style={{ width:`${Math.min(load,100)}%`, background: loadColor(load) }} />
                          </div>
                          <span style={{ fontSize:10, color: loadColor(load), fontWeight:600 }}>{load.toFixed(0)}%</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
  
              {sel.status === 'running' && (
                <div className="mc-gauge">
                  <div className="mc-gauge-hdr">
                    <span>Carga spindle</span>
                    <span style={{ color: loadColor(sel.spindle_load||0), fontWeight:600 }}>
                      {(sel.spindle_load||0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="mc-gauge-track" style={{ height:6 }}>
                    <div className="mc-gauge-fill" style={{
                      width: `${sel.spindle_load||0}%`,
                      background: loadColor(sel.spindle_load||0)
                    }} />
                  </div>
                </div>
              )}
            </div>
  
            <AIPanel
              machineId={sel.machine_id}
              machineName={sel.machine_name}
              currentAlarm={sel.alarm_code ? { code: sel.alarm_code, message: sel.alarm_message } : null}
            />
          </>
        )}
      </div>
    </div>
  );
}
