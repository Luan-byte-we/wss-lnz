const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Configuração CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, PUT');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  next();
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Variáveis globais
let brainrots = [];
let activeBots = new Set();
let startTime = Date.now();
const ADMIN_TOKEN = 'admin123';

// Detectar tipo de dados
function detectDataType(data) {
  try {
    JSON.parse(data);
    return 'JSON';
  } catch {}
  
  if (typeof data === 'string') {
    if (data.trim().startsWith('<')) return 'XML/HTML';
    if (!isNaN(data)) return 'NUMBER';
    return 'TEXT';
  }
  
  return 'UNKNOWN';
}

// Criar servidor HTTP
const server = http.createServer(app);

// WebSocket para clientes WSS (receber dados)
const wss = new WebSocket.Server({ 
  server, 
  path: '/ws'
});

// WebSocket para o painel (tempo real)
const panelWss = new WebSocket.Server({ 
  server, 
  path: '/panel-ws'
});

// Conexões WSS (dados dos bots)
wss.on('connection', (ws, req) => {
  const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  activeBots.add(botId);
  
  console.log(`[WSS] Nova conexão: ${botId}`);
  console.log(`[WSS] Total de bots online: ${activeBots.size}`);
  
  // Heartbeat para manter viva
  const heartbeat = setInterval(() => {
    if (ws.isAlive === false) {
      ws.terminate();
      clearInterval(heartbeat);
      activeBots.delete(botId);
      updatePanelStats();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  }, 30000);
  
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  
  // Receber dados
  ws.on('message', (rawData) => {
    const data = rawData.toString();
    const dataType = detectDataType(data);
    
    const brainrot = {
      id: `br_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      botId: botId,
      rawData: data,
      type: dataType
    };
    
    brainrots.push(brainrot);
    
    console.log(`[DATA] Tipo: ${dataType} | Bot: ${botId}`);
    console.log(`[DATA] Conteúdo: ${data.substring(0, 100)}...`);
    
    // Notificar painel
    updatePanelStats();
  });
  
  ws.on('error', (err) => {
    console.error(`[WSS ERROR] ${botId}:`, err.message);
  });
  
  ws.on('close', () => {
    console.log(`[WSS] Desconectado: ${botId}`);
    activeBots.delete(botId);
    clearInterval(heartbeat);
    updatePanelStats();
    console.log(`[WSS] Total de bots online: ${activeBots.size}`);
  });
  
  updatePanelStats();
});

// Conexões do painel (atualizações em tempo real)
panelWss.on('connection', (ws) => {
  console.log('[PANEL] Nova conexão do painel');
  
  // Enviar dados iniciais
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      brainrots: brainrots,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      totalBrainrots: brainrots.length,
      botsOnline: activeBots.size,
      wssStatus: 'online'
    }
  }));
  
  ws.on('error', (err) => {
    console.error('[PANEL ERROR]:', err.message);
  });
  
  ws.on('close', () => {
    console.log('[PANEL] Desconexão do painel');
  });
});

// Atualizar estatísticas para o painel
function updatePanelStats() {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  
  const stats = {
    type: 'stats',
    data: {
      uptime: uptime,
      totalBrainrots: brainrots.length,
      botsOnline: activeBots.size,
      wssStatus: 'online',
      brainrots: brainrots.slice(-50) // Últimos 50
    }
  };
  
  panelWss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(stats));
    }
  });
}

// ROTAS REST API

// Health check (para Railway manter vivo)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    uptime: Math.floor((Date.now() - startTime) / 1000),
    botsOnline: activeBots.size,
    totalBrainrots: brainrots.length
  });
});

// Estatísticas
app.get('/api/stats', (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  
  res.json({
    status: 'success',
    data: {
      uptime: uptime,
      totalBrainrots: brainrots.length,
      botsOnline: activeBots.size,
      wssStatus: 'online',
      upSince: new Date(startTime).toISOString()
    }
  });
});

// Listar brainrots
app.get('/api/brainrots', (req, res) => {
  res.json({
    status: 'success',
    total: brainrots.length,
    data: brainrots
  });
});

// Limpar brainrots (requer autenticação)
app.delete('/api/brainrots', (req, res) => {
  const token = req.headers['x-admin-token'];
  
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({
      status: 'error',
      message: 'Token inválido'
    });
  }
  
  const cleared = brainrots.length;
  brainrots = [];
  
  console.log(`[API] Brainrots limpos. Total: ${cleared}`);
  updatePanelStats();
  
  res.json({
    status: 'success',
    message: 'Todos os brainrots foram limpos',
    cleared: cleared
  });
});

// Página inicial (redirecionar para index.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Keep-alive para Railway (evitar que durma)
setInterval(() => {
  // Apenas log interno
}, 60000);

// Iniciar servidor
server.listen(port, () => {
  console.log(`\n================================================`);
  console.log(`✅ Servidor WebSocket iniciado!`);
  console.log(`🌐 HTTP: http://localhost:${port}`);
  console.log(`🔌 WSS: ws://localhost:${port}/ws`);
  console.log(`🎮 Painel: http://localhost:${port}`);
  console.log(`================================================\n`);
});

// Tratar erros de servidor
server.on('error', (err) => {
  console.error('[SERVER ERROR]:', err);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT ERROR]:', err);
});
