const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// WebSocket server para bots (rota /on)
const wssBots = new WebSocket.Server({ noServer: true });

// WebSocket server para o painel (rota /ws)
const wssPanel = new WebSocket.Server({ noServer: true });

// Armazenamento de dados
let brainrots = [];
let botsOnline = new Map(); // Map de socket.id para informações do bot
let totalConnections = 0;
let startTime = Date.now();

// Configuração do token admin
const ADMIN_TOKEN = 'admin123';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Estatísticas em tempo real
function broadcastStats() {
    const stats = {
        type: 'stats',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        totalBrainrots: brainrots.length,
        botsOnline: botsOnline.size,
        wssStatus: 'online',
        timestamp: new Date().toISOString()
    };
    
    // Envia para todos os clientes do painel
    wssPanel.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(stats));
        }
    });
    
    // Envia a lista atualizada de brainrots
    broadcastBrainrots();
}

function broadcastBrainrots() {
    const brainrotsData = {
        type: 'brainrots',
        data: brainrots.slice(-50).reverse() // Últimos 50 brainrots
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
        version: '1.0.0'
    });
});

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Keep-alive (ping a cada 4 minutos para evitar dormir no Render)
setInterval(() => {
    console.log('🔥 Keep-alive ping - Servidor ativo');
    broadcastStats();
}, 240000); // 4 minutos

// Atualiza estatísticas a cada 5 segundos
setInterval(() => {
    broadcastStats();
}, 5000);

// WebSocket upgrade handler
server.on('upgrade', (request, socket, head) => {
    const url = request.url;
    
    if (url === '/on') {
        wssBots.handleUpgrade(request, socket, head, (ws) => {
            wssBots.emit('connection', ws, request);
        });
    } else if (url === '/ws') {
        wssPanel.handleUpgrade(request, socket, head, (ws) => {
            wssPanel.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// Conexões WebSocket dos bots (rota /on)
wssBots.on('connection', (ws, req) => {
    const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    totalConnections++;
    
    console.log(`🤖 Bot conectado: ${botId}`);
    console.log(`📊 Total bots online: ${botsOnline.size + 1}`);
    
    // Registra o bot
    botsOnline.set(botId, {
        id: botId,
        connectedAt: new Date().toISOString(),
        messagesCount: 0
    });
    
    broadcastStats();
    
    // Envia confirmação de conexão para o bot
    ws.send(JSON.stringify({
        type: 'connection',
        status: 'connected',
        botId: botId,
        message: 'Conectado ao servidor WSS com sucesso!'
    }));
    
    // Recebe mensagens dos bots
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log(`📨 Mensagem recebida do bot ${botId}:`, message);
            
            // Atualiza contador de mensagens do bot
            const botInfo = botsOnline.get(botId);
            if (botInfo) {
                botInfo.messagesCount++;
                botInfo.lastMessage = new Date().toISOString();
                botsOnline.set(botId, botInfo);
            }
            
            // Adiciona ao array de brainrots
            const brainrot = {
                id: brainrots.length + 1,
                botId: botId,
                timestamp: new Date().toISOString(),
                data: message,
                type: message.type || 'brainrot'
            };
            
            brainrots.push(brainrot);
            
            // Limita o tamanho do array para não sobrecarregar a memória
            if (brainrots.length > 1000) {
                brainrots = brainrots.slice(-1000);
            }
            
            // Envia confirmação para o bot
            ws.send(JSON.stringify({
                type: 'ack',
                status: 'received',
                id: brainrot.id,
                timestamp: brainrot.timestamp
            }));
            
            // Atualiza o painel em tempo real
            broadcastBrainrots();
            broadcastStats();
            
        } catch (error) {
            console.error(`❌ Erro ao processar mensagem do bot ${botId}:`, error);
            ws.send(JSON.stringify({
                type: 'error',
                status: 'invalid_json',
                message: 'Formato JSON inválido'
            }));
        }
    });
    
    // Quando o bot desconecta
    ws.on('close', () => {
        console.log(`🔌 Bot desconectado: ${botId}`);
        botsOnline.delete(botId);
        broadcastStats();
        console.log(`📊 Total bots online: ${botsOnline.size}`);
    });
    
    ws.on('error', (error) => {
        console.error(`❌ Erro no bot ${botId}:`, error);
        botsOnline.delete(botId);
        broadcastStats();
    });
});

// Conexões WebSocket do painel (rota /ws)
wssPanel.on('connection', (ws) => {
    console.log('📊 Painel conectado ao WebSocket');
    
    // Envia dados iniciais
    ws.send(JSON.stringify({
        type: 'connected',
        message: 'Conectado ao painel WSS'
    }));
    
    // Envia estatísticas atuais
    const initialStats = {
        type: 'stats',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        totalBrainrots: brainrots.length,
        botsOnline: botsOnline.size,
        wssStatus: 'online',
        timestamp: new Date().toISOString()
    };
    ws.send(JSON.stringify(initialStats));
    
    // Envia brainrots existentes
    ws.send(JSON.stringify({
        type: 'brainrots',
        data: brainrots.slice(-50).reverse()
    }));
    
    ws.on('close', () => {
        console.log('📊 Painel desconectado');
    });
});

// Inicia o servidor
server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`🔗 WebSocket para bots: ws://localhost:${PORT}/on`);
    console.log(`📊 Painel WebSocket: ws://localhost:${PORT}/ws`);
    console.log(`🔐 Token Admin: ${ADMIN_TOKEN}`);
    console.log(`💚 Keep-alive ativado (ping a cada 4 minutos)`);
});

// Tratamento de erros globais
process.on('uncaughtException', (error) => {
    console.error('❌ Erro não tratado:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Promise rejeitada sem tratamento:', error);
});
