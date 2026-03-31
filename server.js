const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// CONFIGURAÇÃO CORS CORRIGIDA
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// WebSocket server para bots (rota /on)
const wssBots = new WebSocket.Server({ 
    noServer: true,
    // Configuração importante para aceitar conexões
    handleProtocols: () => true
});

// WebSocket server para o painel (rota /ws)
const wssPanel = new WebSocket.Server({ noServer: true });

// Armazenamento
let brainrots = [];
let botsOnline = new Map();
let startTime = Date.now();
const ADMIN_TOKEN = 'admin123';

// Funções de broadcast
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
        uptime: Math.floor((Date.now() - startTime) / 1000),
        totalBrainrots: brainrots.length,
        botsOnline: botsOnline.size,
        wssStatus: 'online',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/brainrots', (req, res) => {
    res.json(brainrots.slice(-100).reverse());
});

app.delete('/api/brainrots', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Token inválido' });
    }
    brainrots = [];
    broadcastBrainrots();
    broadcastStats();
    res.json({ message: 'Todos brainrots foram limpos', count: 0 });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        service: 'WSS Brainrot Collector',
        version: '1.0.0',
        websocket: 'wss://' + req.get('host') + '/on'
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check para Render
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Keep-alive
setInterval(() => {
    console.log('🔥 Keep-alive ping - Servidor ativo');
    fetch('https://' + process.env.RENDER_EXTERNAL_HOSTNAME + '/health').catch(() => {});
    broadcastStats();
}, 240000);

setInterval(() => {
    broadcastStats();
}, 5000);

// WebSocket upgrade handler CORRIGIDO
server.on('upgrade', (request, socket, head) => {
    const url = request.url;
    console.log(`📡 Upgrade request para: ${url}`);
    
    if (url === '/on') {
        wssBots.handleUpgrade(request, socket, head, (ws) => {
            wssBots.emit('connection', ws, request);
        });
    } else if (url === '/ws') {
        wssPanel.handleUpgrade(request, socket, head, (ws) => {
            wssPanel.emit('connection', ws, request);
        });
    } else {
        console.log(`❌ Rota desconhecida: ${url}`);
        socket.destroy();
    }
});

// Conexões dos bots CORRIGIDAS
wssBots.on('connection', (ws, req) => {
    const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`🤖 Bot conectado: ${botId}`);
    console.log(`📡 IP: ${req.socket.remoteAddress}`);
    
    botsOnline.set(botId, {
        id: botId,
        connectedAt: new Date().toISOString(),
        messagesCount: 0
    });
    
    broadcastStats();
    
    // Envia confirmação
    ws.send(JSON.stringify({
        type: 'connection',
        status: 'connected',
        botId: botId,
        message: 'Conectado ao servidor WSS com sucesso!',
        timestamp: new Date().toISOString()
    }));
    
    // Recebe mensagens
    ws.on('message', (data) => {
        try {
            // Tenta fazer parse do JSON
            let message;
            try {
                message = JSON.parse(data.toString());
            } catch (e) {
                // Se não for JSON, trata como texto
                message = { raw: data.toString(), type: 'text' };
            }
            
            console.log(`📨 Mensagem do bot ${botId}:`, message);
            
            const botInfo = botsOnline.get(botId);
            if (botInfo) {
                botInfo.messagesCount++;
                botInfo.lastMessage = new Date().toISOString();
                botsOnline.set(botId, botInfo);
            }
            
            const brainrot = {
                id: brainrots.length + 1,
                botId: botId,
                timestamp: new Date().toISOString(),
                data: message,
                type: message.type || 'brainrot'
            };
            
            brainrots.push(brainrot);
            
            if (brainrots.length > 1000) {
                brainrots = brainrots.slice(-1000);
            }
            
            // Confirmação para o bot
            ws.send(JSON.stringify({
                type: 'ack',
                status: 'received',
                id: brainrot.id,
                timestamp: brainrot.timestamp,
                message: 'Dados recebidos com sucesso!'
            }));
            
            broadcastBrainrots();
            broadcastStats();
            
        } catch (error) {
            console.error(`❌ Erro ao processar:`, error);
            ws.send(JSON.stringify({
                type: 'error',
                status: 'error',
                message: 'Erro ao processar mensagem: ' + error.message
            }));
        }
    });
    
    ws.on('close', () => {
        console.log(`🔌 Bot desconectado: ${botId}`);
        botsOnline.delete(botId);
        broadcastStats();
    });
    
    ws.on('error', (error) => {
        console.error(`❌ Erro no bot ${botId}:`, error.message);
        botsOnline.delete(botId);
        broadcastStats();
    });
});

// Painel WebSocket
wssPanel.on('connection', (ws) => {
    console.log('📊 Painel conectado');
    
    ws.send(JSON.stringify({
        type: 'connected',
        message: 'Conectado ao painel WSS'
    }));
    
    ws.send(JSON.stringify({
        type: 'stats',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        totalBrainrots: brainrots.length,
        botsOnline: botsOnline.size,
        wssStatus: 'online',
        timestamp: new Date().toISOString()
    }));
    
    ws.send(JSON.stringify({
        type: 'brainrots',
        data: brainrots.slice(-50).reverse()
    }));
    
    ws.on('close', () => {
        console.log('📊 Painel desconectado');
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando em http://0.0.0.0:${PORT}`);
    console.log(`🔗 WebSocket para bots: wss://ws-lnz-online.onrender.com/on`);
    console.log(`📊 Painel WebSocket: wss://ws-lnz-online.onrender.com/ws`);
    console.log(`🔐 Token Admin: ${ADMIN_TOKEN}`);
    console.log(`💚 Keep-alive ativado`);
});
