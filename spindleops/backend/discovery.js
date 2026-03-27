/**
 * SpindleOps — Discovery
 * Identifica automaticamente protocolo e porta de máquinas CNC.
 *
 * Uso:
 *   node discovery.js 192.168.1.101          # máquina específica
 *   node discovery.js 192.168.1.101 8193     # com porta manual
 *   node discovery.js 192.168.1.0/24         # scan de subnet inteira
 */

const net = require('net');

const PROTOCOLS = [
  {
    id: 'fanuc', name: 'Fanuc FOCAS2', manufacturer: 'Fanuc',
    ports: [8193, 8192],
    probe: async (host, port) => {
      const handshake = Buffer.from([0x70,0x00,0x18,0x00,0x02,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]);
      const r = await tcpProbe(host, port, handshake, 3000);
      return r && r[0] === 0x70;
    },
    fields: ['status','program','spindle_speed','spindle_load','feed_rate','pos_xyz','alarms','parts_count'],
    note: 'Habilite o FOCAS2: parâmetro #904 bit 0 = 1',
  },
  {
    id: 'fanuc_china', name: 'Fanuc China / Syntec', manufacturer: 'Fanuc China',
    ports: [6789, 8193],
    probe: async (host, port) => {
      const r = await tcpProbe(host, port, Buffer.from([0x01, 0x00]), 2000);
      return r !== null && port === 6789;
    },
    fields: ['status','program','spindle_speed','feed_rate','alarms'],
    note: 'Variante chinesa do Fanuc. Pode precisar de ajuste fino.',
  },
  {
    id: 'siemens_s7', name: 'Siemens S7 (S7comm)', manufacturer: 'Siemens',
    ports: [102],
    probe: async (host, port) => {
      const cotpCR = Buffer.from([0x03,0x00,0x00,0x16,0x11,0xe0,0x00,0x00,0x00,0x01,0x00,0xc0,0x01,0x0a,0xc1,0x02,0x01,0x00,0xc2,0x02,0x01,0x02]);
      const r = await tcpProbe(host, port, cotpCR, 3000);
      return r && r[0] === 0x03 && r[4] === 0xd0;
    },
    fields: ['status','program','spindle_speed','spindle_load','feed_rate','pos_xyz','alarms'],
    note: 'Siemens S7-300/400/1200/1500. Habilite PUT/GET no TIA Portal.',
  },
  {
    id: 'siemens_opcua', name: 'Siemens OPC-UA', manufacturer: 'Siemens',
    ports: [4840, 4841, 4845],
    probe: async (host, port) => {
      const hello = Buffer.from([0x48,0x45,0x4c,0x46,0x00,0x00,0x00,0x00,0x28,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]);
      const r = await tcpProbe(host, port, hello, 4000);
      return r && r[0]===0x41 && r[1]===0x43 && r[2]===0x4b && r[3]===0x46;
    },
    fields: ['status','program','spindle_speed','spindle_load','feed_rate','feed_override','spindle_override','pos_xyz','alarms','parts_count'],
    note: 'Siemens 840D sl, 828D. Suporte completo a OPC-UA.',
  },
  {
    id: 'haas_mtconnect', name: 'Haas MTConnect', manufacturer: 'Haas',
    ports: [5051, 7878],
    probe: async (host, port) => {
      const req = Buffer.from(`GET /probe HTTP/1.0\r\nHost: ${host}\r\n\r\n`);
      const r = await tcpProbe(host, port, req, 3000);
      return r && r.toString('utf8', 0, 60).includes('MTConnect');
    },
    fields: ['status','program','spindle_speed','feed_rate','alarms'],
    note: 'Haas com MTConnect Agent ativo.',
  },
  {
    id: 'heidenhain', name: 'Heidenhain DNC', manufacturer: 'Heidenhain',
    ports: [19000, 19001],
    probe: async (host, port) => {
      const lsv2 = Buffer.from([0x00,0x00,0x00,0x0a,0x00,0x00,0x12,0x00,0x00,0x00]);
      const r = await tcpProbe(host, port, lsv2, 3000);
      return r && r.length >= 4;
    },
    fields: ['status','program','feed_rate','spindle_speed','pos_xyz'],
    note: 'Heidenhain iTNC 530, TNC 640. Requer opção DNC.',
  },
];

// ── UTILITÁRIOS ───────────────────────────────────────────────────────────────
function tcpProbe(host, port, payload, timeout = 3000) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    let done = false;
    const finish = r => { if (!done) { done = true; sock.destroy(); resolve(r); } };
    sock.setTimeout(timeout);
    sock.connect(port, host, () => { if (payload) sock.write(payload); });
    sock.on('data', d => finish(d));
    sock.on('error', () => finish(null));
    sock.on('timeout', () => finish(null));
    sock.on('close', () => finish(null));
  });
}

function portOpen(host, port, timeout = 1500) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    sock.setTimeout(timeout);
    sock.connect(port, host, () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

// ── SCANNER ───────────────────────────────────────────────────────────────────
async function discover(host, manualPort = null) {
  console.log(`\n🔍 Scanning ${host}${manualPort ? ':'+manualPort : ''}...\n`);

  if (manualPort) {
    const open = await portOpen(host, manualPort, 2000);
    if (!open) return fail(host, `Porta ${manualPort} inacessível em ${host}`);
    console.log(`  ✓ Porta ${manualPort} aberta`);

    for (const proto of PROTOCOLS) {
      if (!proto.ports.includes(manualPort)) continue;
      try {
        if (await proto.probe(host, manualPort)) {
          return success(host, manualPort, proto);
        }
      } catch {}
    }
    console.log(`  ⚠ Protocolo não identificado na porta ${manualPort}`);
    return { success: true, host, port: manualPort, protocol: 'unknown', manufacturer: 'Desconhecido', note: `Porta ${manualPort} aberta mas protocolo não reconhecido. Consulte o manual.` };
  }

  // Scan automático
  const allPorts = [...new Set(PROTOCOLS.flatMap(p => p.ports))];
  console.log(`  Testando ${allPorts.length} portas conhecidas...`);

  const checks = await Promise.all(allPorts.map(async p => ({ port: p, open: await portOpen(host, p, 1200) })));
  const open   = checks.filter(c => c.open).map(c => c.port);

  if (open.length === 0) {
    return fail(host, 'Nenhuma porta CNC conhecida encontrada. Máquina pode estar desligada ou com firewall.');
  }

  console.log(`  Portas abertas: ${open.join(', ')}\n  Identificando protocolo...`);

  for (const proto of PROTOCOLS) {
    for (const port of proto.ports.filter(p => open.includes(p))) {
      process.stdout.write(`  → ${proto.name} (porta ${port})... `);
      try {
        if (await proto.probe(host, port)) {
          console.log('✅');
          return success(host, port, proto);
        }
        console.log('✗');
      } catch { console.log('✗'); }
    }
  }

  return fail(host, `Portas abertas (${open.join(', ')}) mas protocolo não confirmado. Tente informar a porta manualmente.`, open);
}

function success(host, port, proto) {
  const config = { id: `cnc-${host.replace(/\./g,'-')}`, name: `${proto.manufacturer} — ${host}`, protocol: proto.id, address: host, port, enabled: true };
  console.log(`\n✅ Identificado: ${proto.name}`);
  console.log(`   Porta:    ${port}`);
  console.log(`   Dados:    ${proto.fields.join(', ')}`);
  if (proto.note) console.log(`   Nota:     ${proto.note}`);
  console.log(`\n   Config para o .env:\n`);
  console.log(JSON.stringify(config, null, 2));
  return { success: true, host, port, ...proto, config };
}

function fail(host, error, openPorts = []) {
  console.log(`\n❌ ${error}`);
  if (openPorts.length) console.log(`   Portas abertas: ${openPorts.join(', ')}`);
  return { success: false, host, error, openPorts };
}

// ── SCAN DE SUBNET ────────────────────────────────────────────────────────────
async function scanSubnet(subnet) {
  const base    = subnet.replace('/24', '').replace(/\.\d+$/, '');
  const results = [];
  console.log(`\n🌐 Varrendo ${base}.1 → ${base}.254 ...\n`);

  for (let i = 1; i <= 254; i += 20) {
    const batch = Array.from({ length: Math.min(20, 255 - i) }, (_, j) => `${base}.${i + j}`);
    const found = await Promise.all(batch.map(async ip => {
      const anyOpen = await Promise.any(
        PROTOCOLS.flatMap(p => p.ports).map(port =>
          portOpen(ip, port, 700).then(o => o ? true : Promise.reject())
        )
      ).catch(() => false);
      if (!anyOpen) return null;
      console.log(`🎯 Possível CNC: ${ip}`);
      return discover(ip);
    }));
    found.filter(r => r?.success).forEach(r => results.push(r));
    process.stdout.write(`  ${Math.min(i + 19, 254)}/254 IPs verificados\r`);
  }

  console.log(`\n\n✅ Scan concluído — ${results.length} máquina(s) encontrada(s)\n`);
  return results;
}

// ── CLI ────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];

  if (!arg1) {
    console.log('Uso:');
    console.log('  node discovery.js 192.168.1.101          # scan automático');
    console.log('  node discovery.js 192.168.1.101 8193     # porta manual');
    console.log('  node discovery.js 192.168.1.0/24         # subnet inteira');
    process.exit(0);
  }

  if (arg1.includes('/24')) {
    scanSubnet(arg1).then(() => process.exit(0));
  } else {
    discover(arg1, arg2 ? parseInt(arg2) : null).then(() => process.exit(0));
  }
}

module.exports = { discover, scanSubnet, PROTOCOLS };
