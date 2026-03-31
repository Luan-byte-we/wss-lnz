const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// CORS para permitir qualquer origem
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Configuração do WebSocket com keep-alive e heartbeat
const wssBots = new WebSocket.Server({ 
    noServer: true,
    clientTracking: true
});

const wssPanel = new WebSocket.Server({ noServer: true });

let brainrots = [];
let botsOnline = new Map();
let startTime = Date.now();
const ADMIN_TOKEN = 'admin123';

// Heartbeat para manter conexões vivas
function heartbeat() {
    this.isAlive = true;
}

// Broadcast stats
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
        websocket: `wss://${req.get('host')}/on`,
        connections: botsOnline.size
    });
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
    fetch(`https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}/health`).catch(() => {});
    broadcastStats();
}, 240000);

setInterval(() => {
    broadcastStats();
}, 5000);

// WebSocket upgrade handler
server.on('upgrade', (request, socket, head) => {
    const url = request.url;
    console.log(`📡 Requisição upgrade para: ${url}`);
    
    if (url === '/on') {
        wssBots.handleUpgrade(request, socket, head, (ws) => {
            wssBots.emit('connection', ws, request);
        });
    } else if (url === '/ws') {
        wssPanel.handleUpgrade(request, socket, head, (ws) => {
            wssPanel.emit('connection', ws, request);
        });
    } else {
        console.log(`❌ Rota não encontrada: ${url}`);
        socket.destroy();
    }
});

// Conexão dos bots - VERSÃO CORRIGIDA
wssBots.on('connection', (ws, req) => {
    const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`✅ Bot conectado: ${botId}`);
    console.log(`📍 IP: ${req.socket.remoteAddress}`);
    
    // Configurar heartbeat
    ws.isAlive = true;
    ws.on('pong', heartbeat);
    
    // Registrar bot
    botsOnline.set(botId, {
        id: botId,
        connectedAt: new Date().toISOString(),
        messagesCount: 0,
        ip: req.socket.remoteAddress
    });
    
    // Enviar confirmação de conexão
    try {
        ws.send(JSON.stringify({
            type: 'connection',
            status: 'connected',
            botId: botId,
            message: '✅ Conectado ao servidor WSS com sucesso!',
            timestamp: new Date().toISOString()
        }));
    } catch (err) {
        console.error('Erro ao enviar confirmação:', err);
    }
    
    broadcastStats();
    
    // Receber mensagens
    ws.on('message', (data) => {
        try {
            console.log(`📨 Mensagem recebida de ${botId}: ${data.toString().substring(0, 200)}`);
            
            let message;
            try {
                message = JSON.parse(data.toString());
            } catch (e) {
                message = { raw: data.toString(), type: 'text' };
            }
            
            // Atualizar estatísticas do bot
            const botInfo = botsOnline.get(botId);
            if (botInfo) {
                botInfo.messagesCount++;
                botInfo.lastMessage = new Date().toISOString();
                botInfo.lastData = message;
                botsOnline.set(botId, botInfo);
            }
            
            // Salvar brainrot
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
            
            // Enviar ACK para o bot
            try {
                ws.send(JSON.stringify({
                    type: 'ack',
                    status: 'received',
                    id: brainrot.id,
                    timestamp: brainrot.timestamp,
                    message: '✅ Dados recebidos com sucesso!'
                }));
            } catch (err) {
                console.error('Erro ao enviar ACK:', err);
            }
            
            // Atualizar painel
            broadcastBrainrots();
            broadcastStats();
            
        } catch (error) {
            console.error(`❌ Erro ao processar mensagem:`, error);
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    status: 'error',
                    message: 'Erro: ' + error.message
                }));
            } catch (err) {}
        }
    });
    
    // Tratar desconexão
    ws.on('close', (code, reason) => {
        console.log(`🔌 Bot desconectado: ${botId} (Código: ${code})`);
        botsOnline.delete(botId);
        broadcastStats();
    });
    
    // Tratar erros
    ws.on('error', (error) => {
        console.error(`❌ Erro WebSocket para ${botId}:`, error.message);
        if (botsOnline.has(botId)) {
            botsOnline.delete(botId);
            broadcastStats();
        }
    });
});

// Painel WebSocket
wssPanel.on('connection', (ws) => {
    console.log('📊 Painel conectado');
    
    // Enviar dados iniciais
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

// Ping interval para manter conexões vivas
const interval = setInterval(() => {
    wssBots.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('💀 Terminando conexão inativa');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wssBots.on('close', () => {
    clearInterval(interval);
});

// Iniciar servidor
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando em http://0.0.0.0:${PORT}`);
    console.log(`🔗 WebSocket para bots: wss://ws-linz-online.onrender.com/on`);
    console.log(`📊 Painel WebSocket: wss://ws-linz-online.onrender.com/ws`);
    console.log(`🔐 Token Admin: ${ADMIN_TOKEN}`);
    console.log(`💚 Keep-alive ativado (ping a cada 4 minutos)`);
});
