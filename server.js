const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// CORS TOTALMENTE LIBERADO
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// WebSocket Server
const wssBots = new WebSocket.Server({ noServer: true });
const wssPanel = new WebSocket.Server({ noServer: true });

// Armazenamento
let brainrots = [];
let botsOnline = new Map();
let startTime = Date.now();
const ADMIN_TOKEN = 'admin123';

// Broadcasts
function broadcastStats() {
    const stats = {
        type: 'stats',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        totalBrainrots: brainrots.length,
        botsOnline: botsOnline.size,
        wssStatus: 'online',
        timestamp: new Date().toISOString()
    };
    
    wssPanel.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(stats));
        }
    });
}

function broadcastBrainrots() {
    const brainrotsData = {
        type: 'brainrots',
        data: brainrots.slice(-50).reverse()
    };
    
    wssPanel.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(brainrotsData));
        }
    });
}

// API REST
app.get('/api/stats', (req, res) => {
    res.json({
        success: true,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        totalBrainrots: brainrots.length,
        botsOnline: botsOnline.size
    });
});

app.get('/api/brainrots', (req, res) => {
    res.json({
        success: true,
        count: brainrots.length,
        data: brainrots.slice(-100).reverse()
    });
});

app.delete('/api/brainrots', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Token inválido' });
    }
    brainrots = [];
    broadcastBrainrots();
    broadcastStats();
    res.json({ success: true, message: 'Todos brainrots foram limpos' });
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Keep-alive
setInterval(() => {
    console.log('🔥 Keep-alive - Servidor ativo');
    broadcastStats();
}, 240000);

setInterval(() => {
    broadcastStats();
}, 10000);

// WebSocket upgrade handler
server.on('upgrade', (request, socket, head) => {
    const url = request.url;
    console.log(`📡 Upgrade request: ${url}`);
    
    if (url === '/ws' || url === '/ws/') {
        wssBots.handleUpgrade(request, socket, head, (ws) => {
            wssBots.emit('connection', ws, request);
        });
    } else if (url === '/panel-ws' || url === '/panel-ws/') {
        wssPanel.handleUpgrade(request, socket, head, (ws) => {
            wssPanel.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// CONEXÃO PRINCIPAL - ACEITA QUALQUER FORMATO
wssBots.on('connection', (ws, req) => {
    const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    console.log(`✅ Bot conectado: ${botId}`);
    
    botsOnline.set(botId, {
        id: botId,
        connectedAt: new Date().toISOString(),
        messagesCount: 0
    });
    
    ws.send(JSON.stringify({
        type: 'connection',
        status: 'connected',
        botId: botId,
        message: '✅ Conectado! Envie QUALQUER formato (JSON, texto, números, etc)',
        timestamp: new Date().toISOString()
    }));
    
    broadcastStats();
    
    // RECEBE QUALQUER FORMATO DE DADOS
    ws.on('message', (data) => {
        const messageStr = data.toString();
        console.log(`📨 Recebido de ${botId}: ${messageStr.substring(0, 200)}`);
        
        // GUARDA EXATAMENTE O QUE FOI RECEBIDO, SEM IMPOR O FORMATO
        const brainrot = {
            id: brainrots.length + 1,
            botId: botId,
            timestamp: new Date().toISOString(),
            rawData: messageStr,  // Dados BRUTOS originais
            dataType: detectDataType(messageStr) // Detecta o tipo
        };
        
        // Tenta fazer parse se for JSON, mas guarda o original
        try {
            brainrot.parsedJson = JSON.parse(messageStr);
            brainrot.isJson = true;
        } catch(e) {
            brainrot.isJson = false;
            brainrot.parsedJson = null;
        }
        
        brainrots.unshift(brainrot);
        
        if (brainrots.length > 500) {
            brainrots = brainrots.slice(0, 500);
        }
        
        const bot = botsOnline.get(botId);
        if (bot) {
            bot.messagesCount++;
            bot.lastMessage = new Date().toISOString();
            botsOnline.set(botId, bot);
        }
        
        ws.send(JSON.stringify({
            type: 'ack',
            status: 'received',
            id: brainrot.id,
            message: '✅ Dados recebidos em qualquer formato!',
            receivedData: messageStr,
            timestamp: new Date().toISOString()
        }));
        
        broadcastBrainrots();
        broadcastStats();
    });
    
    ws.on('close', () => {
        console.log(`🔌 Bot desconectado: ${botId}`);
        botsOnline.delete(botId);
        broadcastStats();
    });
});

// Função para detectar tipo de dado
function detectDataType(str) {
    if (str.startsWith('{') || str.startsWith('[')) {
        try {
            JSON.parse(str);
            return 'JSON';
        } catch(e) {}
    }
    if (str.startsWith('<')) return 'XML/HTML';
    if (!isNaN(Number(str))) return 'NUMBER';
    return 'TEXT';
}

// Painel WebSocket
wssPanel.on('connection', (ws) => {
    console.log('📊 Painel conectado');
    
    ws.send(JSON.stringify({ type: 'connected', message: 'Conectado ao painel' }));
    ws.send(JSON.stringify({
        type: 'stats',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        totalBrainrots: brainrots.length,
        botsOnline: botsOnline.size
    }));
    ws.send(JSON.stringify({ type: 'brainrots', data: brainrots.slice(0, 50) }));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 WSS RODANDO - ACEITA QUALQUER FORMATO!');
    console.log('='.repeat(60));
    console.log(`📡 WebSocket: wss://wss-lnz-production.up.railway.app/ws`);
    console.log(`✅ Aceita: JSON, Texto, Números, XML, HTML, QUALQUER COISA!`);
    console.log(`🔐 Token: admin123`);
    console.log('='.repeat(60) + '\n');
});
