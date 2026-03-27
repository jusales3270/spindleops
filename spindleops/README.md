# SpindleOps

Sistema de monitoramento de máquinas CNC com Inteligência Artificial.
100% self-hosted — roda na rede local da fábrica, sem nuvem de terceiros.

---

## Início rápido

```bash
# 1. Backend
cd backend
npm install
node server.js

# 2. Frontend (outro terminal)
cd frontend
npm install
npm start
```

Acesse **http://localhost:3000**

O simulador sobe automaticamente — você já verá máquinas rodando antes de conectar as CNCs reais.

---

## Configurar suas máquinas

Edite `backend/.env`:

```env
ANTHROPIC_API_KEY=sk-ant-SUA-CHAVE-AQUI   # para funcionalidades de IA

MACHINES_CONFIG='[
  {
    "id": "cnc-01",
    "name": "Centro de Usinagem #1",
    "protocol": "fanuc",
    "address": "192.168.1.101",
    "port": 8193,
    "enabled": true
  },
  {
    "id": "cnc-02",
    "name": "Torno CNC #1",
    "protocol": "siemens_opcua",
    "address": "192.168.1.102",
    "port": 4840,
    "enabled": true
  }
]'
```

Não sabe o protocolo? Use o scanner:
```bash
node backend/discovery.js 192.168.1.101          # detecta automaticamente
node backend/discovery.js 192.168.1.101 8193     # porta manual
node backend/discovery.js 192.168.1.0/24         # varre a rede inteira
```

---

## Protocolos suportados

| Protocolo        | Fabricantes                    | Porta padrão |
|------------------|-------------------------------|-------------|
| `fanuc`          | Fanuc 0i, 30i, 31i             | 8193        |
| `fanuc_china`    | Syntec, GSK e similares        | 6789        |
| `siemens_s7`     | Siemens S7-300/400/1200/1500   | 102         |
| `siemens_opcua`  | Siemens 840D sl, 828D          | 4840        |
| `modbus`         | Haas, Mazak (parcial)          | 502         |
| `heidenhain`     | iTNC 530, TNC 640              | 19000       |
| `simulator`      | Sem hardware — para testes     | —           |

---

## Telas

### Dashboard ao vivo (`/`)
- Cards de todas as máquinas atualizando em tempo real via WebSocket
- Status, spindle (RPM), avanço (mm/min), carga (%), peças, alarmes
- Barra de utilização geral da fábrica
- Clique numa máquina → painel de detalhe com eixos X/Y/Z e **painel de IA**

### Histórico (`/history/:id`)
- KPIs: disponibilidade, OEE, peças, alarmes
- Linha do tempo hora a hora
- Gráficos de carga, peças e RPM
- Registro completo de eventos com horário e duração

---

## Inteligência Artificial

Quatro funcionalidades no painel de detalhe de cada máquina.
Requer `ANTHROPIC_API_KEY` no `.env`.

| Aba             | O que faz                                                     |
|-----------------|---------------------------------------------------------------|
| ⚡ Preditivo    | Score de risco 0–100 baseado em 8h de histórico e tendências  |
| 📋 Resumo turno | Parágrafo executivo em linguagem natural para o gestor        |
| 🔍 Diagnóstico  | Causa + passos de resolução para qualquer código de alarme    |
| 💬 Chat         | Perguntas livres sobre qualquer dado da fábrica               |

---

## API REST

| Endpoint                      | Descrição                        |
|-------------------------------|----------------------------------|
| `GET  /api/machines`          | Lista máquinas com status ao vivo|
| `GET  /api/metrics`           | Última leitura de todas          |
| `GET  /api/metrics/:id`       | Histórico de uma máquina         |
| `GET  /api/metrics/:id/hourly`| Agregado por hora (gráficos)     |
| `GET  /api/oee/:id`           | OEE calculado                    |
| `GET  /api/events/:id`        | Registro de eventos              |
| `GET  /api/summary`           | Resumo geral da fábrica          |
| `POST /api/ai/predictive/:id` | IA — análise preditiva           |
| `POST /api/ai/summary/:id`    | IA — resumo do turno             |
| `POST /api/ai/diagnose/:id`   | IA — diagnóstico de alarme       |
| `POST /api/ai/chat`           | IA — chat livre                  |
| `WS   ws://host:3001`         | Stream em tempo real             |

---

## Estrutura

```
spindleops/
├── backend/
│   ├── server.js          → API REST + WebSocket
│   ├── collector.js       → Coleta dados das CNCs
│   ├── database.js        → SQLite — histórico completo
│   ├── discovery.js       → Scanner automático de protocolo/porta
│   ├── ai.js              → Módulo de IA (Claude API)
│   ├── ai-routes.js       → Endpoints de IA com cache
│   ├── .env               → Configuração (máquinas + chave IA)
│   └── package.json
│
└── frontend/
    └── src/
        ├── App.js                        → Roteamento
        ├── App.css                       → Estilos dark theme
        ├── index.js
        ├── pages/
        │   ├── Live.js                   → Dashboard ao vivo
        │   └── History.js                → Histórico
        ├── components/
        │   └── AIPanel.js                → Painel de IA (4 abas)
        └── hooks/
            └── useData.js                → WebSocket + API hooks
```

---

## Stack

- **Backend**: Node.js + Express + ws + better-sqlite3
- **Frontend**: React 18 + React Router + Recharts
- **IA**: Claude Sonnet (Anthropic API)
- **Protocolos**: node-opcua, modbus-serial, TCP nativo
- **Banco**: SQLite — arquivo único, sem configuração

---

SpindleOps — Monitoramento CNC self-hosted com IA
