const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin123';

const app = express();
const server = http.createServer(app);

app.use(express.static(__dirname));
app.use(express.json());

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
let todayBrainrots = 0;
const startTime = Date.now();

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
        if (ws.readyState === WebSocket.OPEN) {
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

// API Routes
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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ============================================
// 🧠 BOT INTERNO CORRIGIDO - Mantém a WSS ativa 24/7
// ============================================
let internalBot = null;
let reconnectTimeout = null;

function iniciarBotInterno() {
    if (internalBot && internalBot.readyState === WebSocket.OPEN) {
        console.log('🤖 [BOT INTERNO] Já está conectado.');
        return;
    }
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    console.log('🤖 [BOT INTERNO] Iniciando/Reconectando bot de keep-alive...');
    
    // 🔧 FIX: Usa o domínio público do Render, não localhost
    const publicUrl = `wss://ws-lnz-online.onrender.com/on`;
    console.log(`🤖 [BOT INTERNO] Conectando a ${publicUrl}`);
    
    try {
        internalBot = new WebSocket(publicUrl);
        
        internalBot.on('open', () => {
            console.log('✅ [BOT INTERNO] CONECTADO AO WSS! Enviando keep-alive...');
            
            internalBot.send(JSON.stringify({
                type: "keepalive",
                bot: "internal_bot",
                message: "oi, estou aqui para manter a WSS ativa!",
                timestamp: new Date().toISOString()
            }));
            console.log('💓 [BOT INTERNO] Primeira mensagem enviada.');
            
            if (internalBot.keepAliveInterval) clearInterval(internalBot.keepAliveInterval);
            internalBot.keepAliveInterval = setInterval(() => {
                if (internalBot && internalBot.readyState === WebSocket.OPEN) {
                    internalBot.send(JSON.stringify({
                        type: "keepalive",
                        bot: "internal_bot",
                        message: "oi",
                        timestamp: new Date().toISOString()
                    }));
                    console.log(`💓 [BOT INTERNO] Keep-alive enviado às ${new Date().toLocaleTimeString()}`);
                } else if (internalBot && internalBot.readyState !== WebSocket.OPEN) {
                    console.log('⚠️ [BOT INTERNO] Conexão perdida, tentando reconectar em 10 segundos...');
                    clearInterval(internalBot.keepAliveInterval);
                    reconnectTimeout = setTimeout(() => iniciarBotInterno(), 10000);
                }
            }, 4 * 60 * 1000); // 4 minutos
        });
        
        internalBot.on('message', (data) => {
            console.log(`📥 [BOT INTERNO] Resposta do servidor: ${data.toString().slice(0, 80)}`);
        });
        
        internalBot.on('error', (err) => {
            console.log(`❌ [BOT INTERNO] Erro: ${err.message}`);
            if (internalBot) internalBot.terminate();
            if (!reconnectTimeout) reconnectTimeout = setTimeout(() => iniciarBotInterno(), 15000);
        });
        
        internalBot.on('close', () => {
            console.log('🔌 [BOT INTERNO] Desconectado! Tentando reconectar em 15 segundos...');
            if (internalBot.keepAliveInterval) clearInterval(internalBot.keepAliveInterval);
            if (!reconnectTimeout) reconnectTimeout = setTimeout(() => iniciarBotInterno(), 15000);
        });
        
    } catch (err) {
        console.log(`❌ [BOT INTERNO] Falha ao criar conexão: ${err.message}`);
        reconnectTimeout = setTimeout(() => iniciarBotInterno(), 15000);
    }
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
║  🤖 BOT INTERNO CORRIGIDO ATIVO!           ║
╚════════════════════════════════════════════╝
    `);
    
    // Aguarda 3 segundos e inicia o bot interno com o domínio correto
    setTimeout(() => {
        iniciarBotInterno();
    }, 3000);
});
