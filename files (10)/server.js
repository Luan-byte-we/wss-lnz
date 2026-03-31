/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          WSS SERVER — wss://ws-LNZ.online/on               ║
 * ║                                                              ║
 * ║  Este servidor CRIA e HOSPEDA a WSS.                        ║
 * ║  Quando o servidor roda, a WSS fica ONLINE.                 ║
 * ║  Bots conectam em /on e enviam dados.                       ║
 * ║  O painel web monitora tudo em /ws.                         ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

const express    = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http       = require('http');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

// ════════════════════════════════════════════════
// CONFIGURAÇÃO
// ════════════════════════════════════════════════
const PORT         = process.env.PORT         || 3000;
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN  || 'admin123';
const DATA_DIR     = path.join(__dirname, 'data');
const CONFIG_FILE  = path.join(DATA_DIR, 'config.json');
const DATA_FILE    = path.join(DATA_DIR, 'brainrots.json');
const BACKUP_DIR   = path.join(DATA_DIR, 'backups');

// Garante que as pastas existem
[DATA_DIR, BACKUP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ════════════════════════════════════════════════
// ESTADO GLOBAL
// ════════════════════════════════════════════════
const state = {
  startTime:       Date.now(),
  wssEnabled:      true,
  maintenanceMode: false,
  autoBackup:      true,
  encryptionKey:   crypto.randomBytes(32).toString('hex'),
  lastBackup:      null,

  // Dados recebidos dos bots
  brainrots:       [],
  totalBrainrots:  0,
  todayBrainrots:  0,

  // Log de eventos
  events:          [],

  // Clientes ativos
  bots:            new Map(),   // ws → { id, ip, ua, connectedAt, msgCount, lastMsg }
  panels:          new Set(),   // ws do painel
};

let heartbeatInterval = null;
let backupInterval    = null;

// ════════════════════════════════════════════════
// PERSISTÊNCIA
// ════════════════════════════════════════════════
function loadData() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      state.wssEnabled      = cfg.wssEnabled      ?? true;
      state.maintenanceMode = cfg.maintenanceMode ?? false;
      state.autoBackup      = cfg.autoBackup      ?? true;
      state.encryptionKey   = cfg.encryptionKey   || state.encryptionKey;
      state.lastBackup      = cfg.lastBackup      || null;
    }
    if (fs.existsSync(DATA_FILE)) {
      const saved          = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      state.brainrots      = saved.brainrots     || [];
      state.totalBrainrots = saved.total         || state.brainrots.length;
    }
  } catch (e) { console.error('[LOAD]', e.message); }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      wssEnabled:      state.wssEnabled,
      maintenanceMode: state.maintenanceMode,
      autoBackup:      state.autoBackup,
      encryptionKey:   state.encryptionKey,
      lastBackup:      state.lastBackup,
    }, null, 2));
  } catch (e) { console.error('[SAVE_CFG]', e.message); }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      total:     state.totalBrainrots,
      brainrots: state.brainrots.slice(0, 2000),
      savedAt:   new Date().toISOString(),
    }, null, 2));
  } catch (e) { console.error('[SAVE_DATA]', e.message); }
}

function doBackup() {
  try {
    const name = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(path.join(BACKUP_DIR, name), JSON.stringify({
      brainrots:  state.brainrots,
      total:      state.totalBrainrots,
      exportedAt: new Date().toISOString(),
    }, null, 2));
    state.lastBackup = new Date().toISOString();
    saveConfig();
    addEvent('backup', `Backup automático: ${name}`);
    pushToAll({ event: 'stats', stats: buildStats() });
  } catch (e) { console.error('[BACKUP]', e.message); }
}

function startAutoBackup() {
  if (backupInterval) clearInterval(backupInterval);
  if (state.autoBackup) backupInterval = setInterval(doBackup, 60 * 60 * 1000); // 1h
}

// ════════════════════════════════════════════════
// EVENTOS / LOG
// ════════════════════════════════════════════════
function addEvent(type, msg, extra = null) {
  const entry = {
    id:   `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    time: new Date().toISOString(),
    type,
    msg,
    extra,
  };
  state.events.unshift(entry);
  if (state.events.length > 500) state.events.pop();
  pushToAll({ event: 'log', entry });
  console.log(`[${type.toUpperCase().padEnd(8)}] ${msg}`);
  return entry;
}

// ════════════════════════════════════════════════
// BROADCAST PARA PAINÉIS
// ════════════════════════════════════════════════
function pushToAll(payload) {
  const str = JSON.stringify(payload);
  state.panels.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(str); } catch {}
    }
  });
}

// ════════════════════════════════════════════════
// STATS
// ════════════════════════════════════════════════
function buildStats() {
  const upMs  = Date.now() - state.startTime;
  const d     = Math.floor(upMs / 86400000);
  const h     = Math.floor((upMs % 86400000) / 3600000);
  const m     = Math.floor((upMs % 3600000)  / 60000);
  const mem   = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

  const botList = Array.from(state.bots.values()).map(b => ({
    id:          b.id,
    ip:          b.ip,
    connectedAt: b.connectedAt,
    msgCount:    b.msgCount,
    lastMsg:     b.lastMsg,
  }));

  return {
    wssOnline:        true,
    wssEnabled:       state.wssEnabled,
    maintenanceMode:  state.maintenanceMode,
    autoBackup:       state.autoBackup,
    uptime:           `${d}d ${h}h ${m}m`,
    uptimeMs:         upMs,
    memMB:            mem,
    totalBrainrots:   state.totalBrainrots,
    todayBrainrots:   state.todayBrainrots,
    botsOnline:       state.bots.size,
    panelsOnline:     state.panels.size,
    lastBackup:       state.lastBackup,
    keyPreview:       state.encryptionKey.slice(0, 8) + '••••••••••••••••••••••••',
    bots:             botList,
  };
}

// ════════════════════════════════════════════════
// EXPRESS
// ════════════════════════════════════════════════
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/', rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));

// Auth middleware
function auth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token || req.body?.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'Token inválido' });
  next();
}

// ── Rotas públicas ──────────────────────────────
app.get('/api/status', (_, res) => {
  res.json({ online: true, wssEnabled: state.wssEnabled, bots: state.bots.size, time: new Date().toISOString() });
});

// ── Rotas admin ─────────────────────────────────
app.get('/api/stats',     auth, (_, res) => res.json(buildStats()));
app.get('/api/events',    auth, (_, res) => res.json(state.events.slice(0, 200)));
app.get('/api/brainrots', auth, (req, res) => {
  const page  = parseInt(req.query.page  || 0);
  const limit = parseInt(req.query.limit || 50);
  res.json({
    total: state.totalBrainrots,
    page,
    data:  state.brainrots.slice(page * limit, page * limit + limit),
  });
});

app.post('/api/wss/enable',  auth, (_, res) => {
  state.wssEnabled = true;
  saveConfig();
  addEvent('admin', 'WSS habilitada');
  pushToAll({ event: 'stats', stats: buildStats() });
  res.json({ ok: true });
});
app.post('/api/wss/disable', auth, (_, res) => {
  state.wssEnabled = false;
  saveConfig();
  state.bots.forEach((_, ws) => { try { ws.close(1001, 'WSS disabled'); } catch {} });
  addEvent('admin', `WSS desabilitada — ${state.bots.size} bots desconectados`);
  pushToAll({ event: 'stats', stats: buildStats() });
  res.json({ ok: true });
});

app.post('/api/maintenance/on',  auth, (_, res) => {
  state.maintenanceMode = true; saveConfig();
  addEvent('admin', 'Modo manutenção ATIVADO');
  pushToAll({ event: 'stats', stats: buildStats() });
  res.json({ ok: true });
});
app.post('/api/maintenance/off', auth, (_, res) => {
  state.maintenanceMode = false; saveConfig();
  addEvent('admin', 'Modo manutenção DESATIVADO');
  pushToAll({ event: 'stats', stats: buildStats() });
  res.json({ ok: true });
});

app.post('/api/backup/auto/on',  auth, (_, res) => {
  state.autoBackup = true; saveConfig(); startAutoBackup();
  addEvent('admin', 'Auto-backup ativado');
  res.json({ ok: true });
});
app.post('/api/backup/auto/off', auth, (_, res) => {
  state.autoBackup = false; saveConfig();
  if (backupInterval) { clearInterval(backupInterval); backupInterval = null; }
  addEvent('admin', 'Auto-backup desativado');
  res.json({ ok: true });
});
app.post('/api/backup/now', auth, (_, res) => {
  doBackup();
  res.json({ ok: true, lastBackup: state.lastBackup });
});

app.post('/api/bots/kick-all', auth, (_, res) => {
  let n = 0;
  state.bots.forEach((_, ws) => { try { ws.close(1001, 'Kicked by admin'); n++; } catch {} });
  addEvent('admin', `${n} bots desconectados pelo admin`);
  res.json({ ok: true, kicked: n });
});

app.post('/api/bots/kick/:id', auth, (req, res) => {
  let found = false;
  state.bots.forEach((info, ws) => {
    if (info.id === req.params.id) {
      try { ws.close(1001, 'Kicked by admin'); found = true; } catch {}
    }
  });
  if (found) addEvent('admin', `Bot ${req.params.id} kickado`);
  res.json({ ok: found });
});

app.delete('/api/brainrots', auth, (_, res) => {
  const n = state.brainrots.length;
  state.brainrots      = [];
  state.totalBrainrots = 0;
  state.todayBrainrots = 0;
  saveData();
  addEvent('admin', `${n} brainrots deletados`);
  pushToAll({ event: 'cleared' });
  pushToAll({ event: 'stats', stats: buildStats() });
  res.json({ ok: true, deleted: n });
});

app.post('/api/security/regen-key', auth, (_, res) => {
  state.encryptionKey = crypto.randomBytes(32).toString('hex');
  saveConfig();
  addEvent('admin', 'Chave de criptografia regenerada');
  res.json({ ok: true });
});
app.get('/api/security/key',   auth, (_, res) => res.json({ key:   state.encryptionKey }));
app.get('/api/security/token', auth, (_, res) => res.json({ token: ADMIN_TOKEN }));

// Fallback
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ════════════════════════════════════════════════
// HTTP SERVER
// ════════════════════════════════════════════════
const server = http.createServer(app);

// ════════════════════════════════════════════════
// WSS PRINCIPAL — /on — onde os BOTS se conectam
// ════════════════════════════════════════════════
const wssMain = new WebSocketServer({ server, path: '/on' });

wssMain.on('connection', (ws, req) => {
  // ── Checar estado ──
  if (!state.wssEnabled) {
    ws.send(JSON.stringify({ error: 'disabled', msg: 'WSS está desabilitada no momento.' }));
    ws.close(1013, 'WSS disabled'); return;
  }
  if (state.maintenanceMode) {
    ws.send(JSON.stringify({ error: 'maintenance', msg: 'Servidor em manutenção. Tente em breve.' }));
    ws.close(1013, 'Maintenance'); return;
  }

  // ── Info do bot ──
  const ip  = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
  const ua  = req.headers['user-agent'] || 'unknown';
  const id  = crypto.randomBytes(5).toString('hex').toUpperCase();

  const botInfo = { id, ip, ua, connectedAt: new Date().toISOString(), msgCount: 0, lastMsg: null };
  state.bots.set(ws, botInfo);
  ws.isAlive = true;

  addEvent('connect', `Bot conectado | id:${id} | ip:${ip} | bots online: ${state.bots.size}`);
  pushToAll({ event: 'bot_connected', bot: botInfo, stats: buildStats() });

  // ── Boas-vindas para o bot ──
  ws.send(JSON.stringify({
    event:     'connected',
    botId:     id,
    wss:       'wss://ws-LNZ.online/on',
    timestamp: new Date().toISOString(),
    msg:       'Conectado! Envie dados e eles aparecem no painel.',
  }));

  // ── Mensagem recebida ──
  ws.on('message', (raw) => {
    if (!state.wssEnabled) return;

    botInfo.msgCount++;
    botInfo.lastMsg = new Date().toISOString();

    let payload;
    try   { payload = JSON.parse(raw.toString()); }
    catch { payload = { raw: raw.toString() }; }

    const brainrot = {
      id:         `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      receivedAt: new Date().toISOString(),
      botId:      id,
      botIp:      ip,
      data:       payload,
    };

    state.brainrots.unshift(brainrot);
    if (state.brainrots.length > 2000) state.brainrots.pop();
    state.totalBrainrots++;
    state.todayBrainrots++;

    addEvent('data', `[${id}] ${JSON.stringify(payload).slice(0, 100)}`, payload);
    pushToAll({ event: 'brainrot', brainrot, stats: buildStats() });

    // ACK para o bot
    ws.send(JSON.stringify({
      event:     'received',
      botId:     id,
      msgCount:  botInfo.msgCount,
      timestamp: new Date().toISOString(),
    }));

    // Salva a cada 10 mensagens
    if (state.totalBrainrots % 10 === 0) saveData();
  });

  // ── Desconexão ──
  ws.on('close', (code, reason) => {
    state.bots.delete(ws);
    addEvent('disconnect', `Bot desconectado | id:${id} | msgs:${botInfo.msgCount} | bots restantes:${state.bots.size}`);
    pushToAll({ event: 'bot_disconnected', botId: id, stats: buildStats() });
  });

  ws.on('error', err => {
    state.bots.delete(ws);
    addEvent('error', `Erro bot ${id}: ${err.message}`);
  });

  ws.on('pong', () => { ws.isAlive = true; });
});

// Heartbeat — detecta zumbis a cada 30s
heartbeatInterval = setInterval(() => {
  wssMain.clients.forEach(ws => {
    if (ws.isAlive === false) { ws.terminate(); return; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 30_000);

// ════════════════════════════════════════════════
// WSS PAINEL — /ws — onde o frontend se conecta
// ════════════════════════════════════════════════
const wssPanel = new WebSocketServer({ server, path: '/ws' });

wssPanel.on('connection', (ws) => {
  state.panels.add(ws);
  addEvent('panel', `Painel conectado | paineis: ${state.panels.size}`);

  // Envia estado completo inicial
  ws.send(JSON.stringify({
    event:     'init',
    stats:     buildStats(),
    events:    state.events.slice(0, 100),
    brainrots: state.brainrots.slice(0, 50),
  }));

  ws.on('close', () => {
    state.panels.delete(ws);
    addEvent('panel', `Painel desconectado | paineis: ${state.panels.size}`);
  });
  ws.on('error', () => state.panels.delete(ws));
});

// ════════════════════════════════════════════════
// RESET DIÁRIO à meia-noite
// ════════════════════════════════════════════════
(function scheduleMidnight() {
  const now  = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => {
    state.todayBrainrots = 0;
    addEvent('server', 'Contador diário resetado');
    pushToAll({ event: 'stats', stats: buildStats() });
    scheduleMidnight();
  }, next - now);
})();

// ════════════════════════════════════════════════
// PUSH DE STATS a cada 10s
// ════════════════════════════════════════════════
setInterval(() => {
  pushToAll({ event: 'stats', stats: buildStats() });
}, 10_000);

// ════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════
loadData();
startAutoBackup();

server.listen(PORT, '0.0.0.0', () => {
  const line = '═'.repeat(54);
  console.log(`\n╔${line}╗`);
  console.log(`║${'  WSS SERVER — ONLINE'.padEnd(54)}║`);
  console.log(`╠${line}╣`);
  console.log(`║  Painel web : http://localhost:${PORT}${''.padEnd(22)}║`);
  console.log(`║  WSS (bots) : ws://localhost:${PORT}/on${''.padEnd(20)}║`);
  console.log(`║  Em produção: wss://ws-LNZ.online/on${''.padEnd(17)}║`);
  console.log(`╚${line}╝\n`);
  addEvent('server', `Servidor iniciado na porta ${PORT} — WSS online em /on`);
});

// ════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ════════════════════════════════════════════════
function shutdown() {
  console.log('\n[SERVER] Encerrando...');
  saveData();
  clearInterval(heartbeatInterval);
  if (backupInterval) clearInterval(backupInterval);
  wssMain.clients.forEach(ws => { try { ws.close(1001, 'Server shutdown'); } catch {} });
  wssPanel.clients.forEach(ws => { try { ws.close(); } catch {} });
  server.close(() => { console.log('[SERVER] Encerrado.'); process.exit(0); });
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
