import { API_BASE } from '../config/api';
import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';
import { useAPI } from '../hooks/useData';

const API = `${API_BASE}/api`;

// Portas padrão por protocolo
const DEFAULT_PORTS = {
  fanuc:        8193,
  fanuc_china:  8193,
  siemens_opcua: 4840,
  siemens_s7:   102,
  modbus:       502,
  heidenhain:   19000,
  mtconnect:    5000,
  mazak:        5000,
  mitsubishi:   5007,
  simulator:    null,
};

// Labels para exibição dos protocolos
const PROTOCOL_LABELS = {
  fanuc:         'Fanuc FOCAS2',
  fanuc_china:   'Fanuc (China/Syntec)',
  siemens_opcua: 'Siemens OPC-UA',
  siemens_s7:    'Siemens S7',
  modbus:        'Modbus TCP',
  heidenhain:    'Heidenhain LSV2',
  mtconnect:     'MTConnect (Mazak/Okuma/Haas)',
  mazak:         'Mazak (descoberta automática)',
  mitsubishi:    'Mitsubishi MC Protocol',
  simulator:     'Simulador',
};

// Registros Modbus padrão
const DEFAULT_REGISTERS = {
  status: 0, spindle_speed: 1, spindle_load: 2, feed_rate: 3,
  parts_count: 4, feed_override: 5, spindle_override: 6,
  pos_x: 7, pos_y: 8, pos_z: 9,
};

const REGISTER_LABELS = {
  status:          'Status',
  spindle_speed:   'Spindle RPM',
  spindle_load:    'Carga Spindle',
  feed_rate:       'Feed Rate',
  parts_count:     'Peças',
  feed_override:   'Override Feed',
  spindle_override:'Override Spindle',
  pos_x:           'Posição X',
  pos_y:           'Posição Y',
  pos_z:           'Posição Z',
};

function emptyForm() {
  return {
    id: '', name: '', protocol: 'simulator',
    address: '', port: '', enabled: true,
    registers: { ...DEFAULT_REGISTERS },
    opcUser: '', opcPass: '',
  };
}

// Monta o registers enviado ao backend conforme o protocolo
function buildRegisters(form) {
  if (form.protocol === 'modbus') return form.registers;
  if (form.protocol === 'siemens_opcua' && form.opcUser.trim()) {
    return { opc_user: form.opcUser.trim(), opc_pass: form.opcPass };
  }
  return null;
}

// ── Formulário de criação/edição ───────────────────────────────────────────────
function MachineForm({ initial, onSave, onCancel, isNew }) {
  const [form, setForm]     = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value };
      // Auto-preenche porta ao trocar protocolo
      if (field === 'protocol') {
        next.port = DEFAULT_PORTS[value] || '';
      }
      return next;
    });
  }

  function setReg(key, value) {
    setForm(f => ({
      ...f,
      registers: { ...f.registers, [key]: value === '' ? '' : parseInt(value) || 0 }
    }));
  }

  async function handleSave() {
    if (!form.name.trim())     return setError('Informe o nome da máquina.');
    if (!form.protocol)        return setError('Selecione o protocolo.');
    if (isNew && !form.id.trim()) return setError('Informe um ID único para a máquina.');

    const needsAddress = form.protocol !== 'simulator';
    if (needsAddress && !form.address.trim()) return setError('Informe o endereço IP.');

    setSaving(true);
    setError('');

    const body = {
      id:       form.id.trim(),
      name:     form.name.trim(),
      protocol: form.protocol,
      address:  form.address.trim() || null,
      port:     form.port ? parseInt(form.port) : null,
      enabled:  form.enabled,
      registers: buildRegisters(form),
    };

    try {
      const url    = isNew ? `${API}/machines` : `${API}/machines/${body.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const res    = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Erro ao salvar');
      onSave();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const needsAddress = form.protocol !== 'simulator';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '20px' }}>

      {/* ID (só na criação) */}
      {isNew && (
        <div className="form-group">
          <label className="form-label">ID único *</label>
          <input
            className="form-input"
            placeholder="ex: cnc-05"
            value={form.id}
            onChange={e => set('id', e.target.value.toLowerCase().replace(/\s/g, '-'))}
          />
        </div>
      )}

      <div className="form-row form-row-2">
        {/* Nome */}
        <div className="form-group">
          <label className="form-label">Nome *</label>
          <input
            className="form-input"
            placeholder="ex: Centro de Usinagem #5"
            value={form.name}
            onChange={e => set('name', e.target.value)}
          />
        </div>

        {/* Protocolo */}
        <div className="form-group">
          <label className="form-label">Protocolo *</label>
          <select
            className="form-select"
            value={form.protocol}
            onChange={e => set('protocol', e.target.value)}
          >
            {Object.entries(PROTOCOL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {needsAddress && (
        <div className="form-row form-row-2">
          {/* IP */}
          <div className="form-group">
            <label className="form-label">Endereço IP *</label>
            <input
              className="form-input"
              placeholder="192.168.1.101"
              value={form.address}
              onChange={e => set('address', e.target.value)}
            />
          </div>

          {/* Porta */}
          <div className="form-group">
            <label className="form-label">Porta</label>
            <input
              className="form-input"
              type="number"
              placeholder={DEFAULT_PORTS[form.protocol] || ''}
              value={form.port}
              onChange={e => set('port', e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Credenciais OPC-UA (Sinumerik exige usuário/senha) */}
      {form.protocol === 'siemens_opcua' && (
        <div className="form-row form-row-2">
          <div className="form-group">
            <label className="form-label">Usuário OPC-UA</label>
            <input
              className="form-input"
              placeholder="ex: OpcUaClient"
              value={form.opcUser}
              onChange={e => set('opcUser', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Senha OPC-UA</label>
            <input
              className="form-input"
              type="password"
              value={form.opcPass}
              onChange={e => set('opcPass', e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Ativo */}
      <label className="toggle-wrap">
        <span className="toggle">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={e => set('enabled', e.target.checked)}
          />
          <span className="toggle-slider" />
        </span>
        <span className="toggle-label">Máquina ativa (monitorada)</span>
      </label>

      {/* Mapeamento Modbus */}
      {form.protocol === 'modbus' && (
        <div className="form-section">
          <div className="form-section-title">Mapeamento de Registros Modbus</div>
          <div className="form-row form-row-3">
            {Object.entries(REGISTER_LABELS).map(([key, label]) => (
              <div className="form-group" key={key}>
                <label className="form-label">{label}</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  value={form.registers[key] ?? DEFAULT_REGISTERS[key]}
                  onChange={e => setReg(key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>
      )}

      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}

// ── Card de máquina ────────────────────────────────────────────────────────────
function MachineCard({ machine, onRefetch }) {
  const [editing,    setEditing]    = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testing,    setTesting]    = useState(false);
  const [deleting,   setDeleting]   = useState(false);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res  = await fetch(`${API}/machines/${machine.id}/test`, { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, error: 'Falha na requisição' });
    } finally {
      setTesting(false);
    }
  }

  async function handleToggle() {
    await fetch(`${API}/machines/${machine.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...machine, enabled: !machine.enabled }),
    });
    onRefetch();
  }

  async function handleDelete() {
    if (!window.confirm(`Excluir "${machine.name}"? Esta ação não pode ser desfeita.`)) return;
    setDeleting(true);
    await fetch(`${API}/machines/${machine.id}`, { method: 'DELETE' });
    onRefetch();
  }

  const proto = PROTOCOL_LABELS[machine.protocol] || machine.protocol;
  const addr  = machine.address ? `${machine.address}:${machine.port}` : '—';
  const isOn  = !!machine.enabled;

  // Constrói formulário inicial com registers do banco (ou defaults)
  const editInitial = {
    id:        machine.id,
    name:      machine.name,
    protocol:  machine.protocol,
    address:   machine.address || '',
    port:      machine.port    || '',
    enabled:   isOn,
    registers: { ...DEFAULT_REGISTERS, ...(machine.registers || {}) },
    opcUser:   machine.registers?.opc_user || '',
    opcPass:   machine.registers?.opc_pass || '',
  };

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <div className="settings-card-info">
          <span className="settings-card-name">{machine.name}</span>
          <span className="settings-card-meta">
            {proto}{machine.address ? ` · ${addr}` : ''}
          </span>
        </div>

        <div className="settings-card-actions">
          {testResult && (
            testResult.ok
              ? <span className="test-ok">✓ {testResult.latency}ms</span>
              : <span className="test-err">✗ {testResult.error}</span>
          )}

          <button
            className="btn-ghost"
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={handleTest}
            disabled={testing || machine.protocol === 'simulator'}
            title={machine.protocol === 'simulator' ? 'Simulador não precisa de teste' : 'Testar conexão'}
          >
            {testing ? '…' : 'Testar'}
          </button>

          <label className="toggle-wrap" style={{ marginBottom: 0 }}>
            <span className="toggle">
              <input type="checkbox" checked={isOn} onChange={handleToggle} />
              <span className="toggle-slider" />
            </span>
          </label>

          <button
            className="btn-ghost"
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setEditing(e => !e); setTestResult(null); }}
          >
            {editing ? 'Fechar' : 'Editar'}
          </button>

          <button
            className="btn-ghost"
            style={{ fontSize: 12, padding: '6px 12px', color: 'var(--red)' }}
            onClick={handleDelete}
            disabled={deleting}
          >
            Excluir
          </button>
        </div>
      </div>

      {editing && (
        <div className="settings-card-body">
          <MachineForm
            initial={editInitial}
            isNew={false}
            onSave={() => { setEditing(false); onRefetch(); }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
export default function Settings() {
  const [showNew, setShowNew] = useState(false);
  const [tick,    setTick]    = useState(0);

  // Força refetch incrementando tick (usado como parte da key do useAPI)
  const refetch = useCallback(() => setTick(t => t + 1), []);

  const { data: machines, loading } = useAPI(`/machines?_=${tick}`, 0);

  return (
    <div className="page">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link to="/" className="app-logo">
            <img
              src={process.env.PUBLIC_URL + '/logo.png'}
              alt="SpindleOps"
              className="app-logo-img"
            />
          </Link>
        </div>

        <nav className="nav-tabs">
          <Link to="/"        className="nav-tab">Dashboard</Link>
          <Link to="/history" className="nav-tab">Histórico</Link>
          <Link to="/settings" className="nav-tab active">Configurações</Link>
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ThemeToggle />
        </div>
      </header>

      <div className="main-content" style={{ padding: '28px 24px', maxWidth: 900, margin: '0 auto', width: '100%' }}>

        {/* Cabeçalho da seção */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Máquinas CNC</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Gerencie as máquinas monitoradas pelo SpindleOps
            </div>
          </div>
          <button
            className="btn-primary"
            onClick={() => setShowNew(v => !v)}
          >
            {showNew ? '✕ Cancelar' : '+ Nova Máquina'}
          </button>
        </div>

        {/* Formulário de nova máquina */}
        {showNew && (
          <div className="settings-card" style={{ marginBottom: 20 }}>
            <div style={{ padding: '14px 20px 0', fontWeight: 600, fontSize: 14, color: 'var(--blue)' }}>
              Nova Máquina
            </div>
            <MachineForm
              initial={emptyForm()}
              isNew={true}
              onSave={() => { setShowNew(false); refetch(); }}
              onCancel={() => setShowNew(false)}
            />
          </div>
        )}

        {/* Lista de máquinas */}
        {loading ? (
          <div className="empty-state">
            <span className="empty-icon">⚙</span>
            <span>Carregando máquinas…</span>
          </div>
        ) : !machines?.length ? (
          <div className="empty-state">
            <span style={{ fontSize: 36 }}>🏭</span>
            <span style={{ fontWeight: 600 }}>Nenhuma máquina cadastrada</span>
            <span style={{ fontSize: 13 }}>Clique em "Nova Máquina" para começar</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {machines.map(m => (
              <MachineCard key={m.id} machine={m} onRefetch={refetch} />
            ))}
          </div>
        )}

        {/* Rodapé informativo */}
        <div style={{
          marginTop: 32, padding: '16px 20px',
          background: 'var(--bg2)', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)',
          lineHeight: 1.7
        }}>
          <strong style={{ color: 'var(--text)' }}>Dicas:</strong>
          {' '}As configurações são salvas no banco de dados local e persistem entre reinicializações.
          Use o botão <strong style={{ color: 'var(--text)' }}>Testar</strong> para verificar se a máquina está acessível na rede antes de salvar.
          Máquinas <strong style={{ color: 'var(--text)' }}>desativadas</strong> continuam no histórico mas param de ser monitoradas.
        </div>
      </div>
    </div>
  );
}
