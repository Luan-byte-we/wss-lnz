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

// Rota de status
app.get('/api/status', (req, res) => {
    res.json({ online: true, time: new Date().toISOString() });
});

// ============================================
// WSS para BOTS em /on
// ============================================
const wssBots = new WebSocketServer({ server, path: '/on' });

const bots = new Map();
let totalBrainrots = 0;
let brainrots = [];

wssBots.on('connection', (ws, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const botId = crypto.randomBytes(4).toString('hex').toUpperCase();
    
    bots.set(ws, { id: botId, ip, connectedAt: Date.now(), msgCount: 0 });
    console.log(`✅ Bot ${botId} conectado de ${ip}`);
    
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
            if (brainrots.length > 100) brainrots.pop();
            totalBrainrots++;
            
            console.log(`📦 Dado de ${botId}:`, jsonData);
            ws.send(JSON.stringify({ event: 'received', ack: true }));
            
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

wssPanel.on('connection', (ws) => {
    panels.add(ws);
    console.log(`📺 Painel conectado (${panels.size})`);
    
    ws.send(JSON.stringify({
        event: 'init',
        stats: {
            uptime: formatUptime(),
            totalBrainrots: totalBrainrots,
            botsOnline: bots.size
        },
        brainrots: brainrots.slice(0, 50)
    }));
    
    ws.on('close', () => panels.delete(ws));
});

function broadcastToPanels(data) {
    panels.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
            try { ws.send(JSON.stringify(data)); } catch(e) {}
        }
    });
}

setInterval(() => {
    broadcastToPanels({
        event: 'stats',
        stats: {
            uptime: formatUptime(),
            totalBrainrots: totalBrainrots,
            botsOnline: bots.size,
            panelsOnline: panels.size
        }
    });
}, 5000);

function formatUptime() {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
}

const startTime = Date.now();

app.get('/api/stats', (req, res) => {
    res.json({
        uptime: formatUptime(),
        totalBrainrots: totalBrainrots,
        botsOnline: bots.size,
        brainrots: brainrots.slice(0, 100)
    });
});

app.delete('/api/brainrots', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Token inválido' });
    }
    brainrots = [];
    totalBrainrots = 0;
    res.json({ ok: true });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════╗
║     🚀 WSS SERVER RODANDO!                 ║
╠════════════════════════════════════════════╣
║  Painel:    http://localhost:${PORT}         ║
║  WSS Bots:  ws://localhost:${PORT}/on       ║
║  WSS Panel: ws://localhost:${PORT}/ws       ║
╚════════════════════════════════════════════╝
    `);
});
