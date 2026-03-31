const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin123';

const app = express();
const server = http.createServer(app);

app.use(express.static(__dirname));
app.use(express.json());

// ============================================
// WSS para BOTS em /on
// ============================================
const wssBots = new WebSocketServer({ server, path: '/on' });

const bots = new Map();
let totalBrainrots = 0;
let brainrots = [];
let todayBrainrots = 0;
const startTime = Date.now();

// Reset diário
function resetDaily() {
    const now = new Date();
    const night = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const msToMidnight = night - now;
    setTimeout(() => {
        todayBrainrots = 0;
        console.log('📅 Contador diário resetado');
        resetDaily();
    }, msToMidnight);
}
resetDaily();

wssBots.on('connection', (ws, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const botId = crypto.randomBytes(4).toString('hex').toUpperCase();
    
    bots.set(ws, { id: botId, ip, connectedAt: Date.now(), msgCount: 0 });
    console.log(`✅ Bot ${botId} conectado`);
    
    ws.send(JSON.stringify({ 
        event: 'connected', 
        botId, 
        msg: 'Conectado! Envie dados JSON.'
    }));
    
    ws.on('message', (data) => {
        try {
            const jsonData = JSON.parse(data.toString());
            const botInfo = bots.get(ws);
            if (botInfo) botInfo.msgCount++;
            
            brainrots.unshift({
                id: Date.now(),
                receivedAt: new Date().toISOString(),
                botId: botInfo?.id || 'unknown',
                data: jsonData
            });
            if (brainrots.length > 200) brainrots.pop();
            totalBrainrots++;
            todayBrainrots++;
            
            console.log(`📦 Dado recebido de ${botId}`);
            ws.send(JSON.stringify({ event: 'received', ack: true }));
            broadcastToPanels({ event: 'brainrot', stats: getStats() });
            
        } catch(e) {
            ws.send(JSON.stringify({ error: 'JSON inválido' }));
        }
    });
    
    ws.on('close', () => {
        bots.delete(ws);
        console.log(`❌ Bot ${botId} desconectado`);
    });
});

// ============================================
// WSS para PAINEL em /ws
// ============================================
const wssPanel = new WebSocketServer({ server, path: '/ws' });
const panels = new Set();

function broadcastToPanels(data) {
    const msg = JSON.stringify(data);
    panels.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
            try { ws.send(msg); } catch(e) {}
        }
    });
}

function getStats() {
    const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
    const d = Math.floor(uptimeSec / 86400);
    const h = Math.floor((uptimeSec % 86400) / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    
    return {
        uptime: `${d}d ${h}h ${m}m`,
        totalBrainrots: totalBrainrots,
        todayBrainrots: todayBrainrots,
        botsOnline: bots.size,
        panelsOnline: panels.size,
        memMB: mem
    };
}

wssPanel.on('connection', (ws) => {
    panels.add(ws);
    console.log(`📺 Painel conectado (${panels.size} ativos)`);
    ws.send(JSON.stringify({
        event: 'init',
        stats: getStats(),
        brainrots: brainrots.slice(0, 50)
    }));
    
    ws.on('close', () => panels.delete(ws));
});

setInterval(() => {
    broadcastToPanels({ event: 'stats', stats: getStats() });
}, 5000);

// ============================================
// API Routes
// ============================================
app.get('/api/status', (req, res) => {
    res.json({ online: true, time: new Date().toISOString() });
});

app.get('/api/stats', (req, res) => res.json(getStats()));
app.get('/api/brainrots', (req, res) => res.json({ data: brainrots.slice(0, 50), total: totalBrainrots }));

app.delete('/api/brainrots', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Token inválido' });
    brainrots = [];
    totalBrainrots = 0;
    todayBrainrots = 0;
    res.json({ ok: true });
});

app.post('/api/wss/enable', (req, res) => res.json({ ok: true }));
app.post('/api/wss/disable', (req, res) => res.json({ ok: true }));
app.post('/api/bots/kick-all', (req, res) => res.json({ ok: true, kicked: 0 }));
app.get('/api/security/token', (req, res) => res.json({ token: ADMIN_TOKEN }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ============================================
// 🧠 KEEP-ALIVE VIA HTTP (NÃO WebSocket)
// ============================================
// Isso evita o erro "Invalid WebSocket frame"
// O Render mantém o servidor acordado com qualquer tráfego HTTP
// ============================================

function iniciarKeepAlive() {
    console.log('🔄 [KEEP-ALIVE] Iniciando ping automático a cada 4 minutos...');
    
    // Função que faz uma requisição HTTP para o próprio servidor
    const ping = () => {
        const url = `http://localhost:${PORT}/api/status`;
        const http = require('http');
        
        http.get(url, (res) => {
            console.log(`💓 [KEEP-ALIVE] Ping realizado às ${new Date().toLocaleTimeString()} - Status: ${res.statusCode}`);
        }).on('error', (err) => {
            console.log(`⚠️ [KEEP-ALIVE] Ping falhou: ${err.message}`);
        });
    };
    
    // Primeiro ping após 5 segundos
    setTimeout(ping, 5000);
    
    // Depois a cada 4 minutos (240 segundos)
    setInterval(ping, 4 * 60 * 1000);
}

// ============================================
// START SERVER
// ============================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════╗
║     🚀 WSS SERVER RODANDO!                 ║
╠════════════════════════════════════════════╣
║  Painel:    http://localhost:${PORT}         ║
║  WSS Bots:  ws://localhost:${PORT}/on       ║
║                                            ║
║  🔄 KEEP-ALIVE VIA HTTP ATIVO!             ║
║  O servidor NUNCA vai dormir!              ║
╚════════════════════════════════════════════╝
    `);
    
    // Iniciar o sistema de keep-alive
    iniciarKeepAlive();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🔌 Encerrando servidor...');
    process.exit(0);
});
