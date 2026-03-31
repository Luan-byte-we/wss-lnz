const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });
const panelWss = new WebSocket.Server({ server, path: '/panel-ws' });

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb', type: '*/*' }));
app.use(express.static(path.join(__dirname)));

// CORS liberado
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Configuração
const ADMIN_TOKEN = 'admin123';
let brainrots = [];
let startTime = Date.now();
let connectedBots = new Set();

// Heartbeat para manter conexões vivas
function heartbeat(ws) {
    ws.isAlive = true;
}

function setupHeartbeat(ws) {
    ws.isAlive = true;
    ws.on('pong', () => heartbeat(ws));
}

// WebSocket principal (/ws) - Recebe dados
wss.on('connection', (ws, req) => {
    const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    connectedBots.add(botId);
    console.log(`[WSS] Bot conectado: ${botId} | Total: ${connectedBots.size}`);
    
    setupHeartbeat(ws);

    ws.on('message', (data) => {
        try {
            const rawData = data.toString();
            let type = 'TEXT';
            let parsedData = rawData;
            
            // Detecta o tipo de dado
            try {
                JSON.parse(rawData);
                type = 'JSON';
                parsedData = JSON.parse(rawData);
            } catch (e) {
                if (/^\d+(\.\d+)?$/.test(rawData.trim())) {
                    type = 'NUMBER';
                } else if (/<[^>]+>/.test(rawData)) {
                    type = 'XML/HTML';
                } else {
                    type = 'TEXT';
                }
            }
            
            const brainrot = {
                id: Date.now() + '_' + Math.random().toString(36).substr(2, 8),
                timestamp: new Date().toISOString(),
                botId: botId,
                rawData: rawData,
                type: type,
                parsedData: type === 'JSON' ? parsedData : rawData
            };
            
            brainrots.unshift(brainrot);
            // Mantém apenas os últimos 1000 registros
            if (brainrots.length > 1000) brainrots.pop();
            
            console.log(`[WSS] Mensagem recebida de ${botId} | Tipo: ${type} | Tamanho: ${rawData.length}`);
            
            // Notifica todos os painéis conectados
            panelWss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'new_brainrot',
                        data: brainrot
                    }));
                }
            });
            
            // Envia confirmação para o bot
            ws.send(JSON.stringify({
                status: 'received',
                id: brainrot.id,
                type: type,
                timestamp: brainrot.timestamp
            }));
            
        } catch (error) {
            console.error('[WSS] Erro ao processar mensagem:', error);
            ws.send(JSON.stringify({
                status: 'error',
                message: error.message
            }));
        }
    });
    
    ws.on('close', () => {
        connectedBots.delete(botId);
        console.log(`[WSS] Bot desconectado: ${botId} | Total: ${connectedBots.size}`);
        
        // Notifica painéis sobre atualização de bots online
        panelWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'stats_update',
                    data: {
                        totalBrainrots: brainrots.length,
                        botsOnline: connectedBots.size,
                        uptime: Date.now() - startTime
                    }
                }));
            }
        });
    });
    
    ws.on('error', (error) => {
        console.error(`[WSS] Erro no bot ${botId}:`, error);
    });
    
    // Envia boas-vindas
    ws.send(JSON.stringify({
        status: 'connected',
        botId: botId,
        message: 'Conectado ao servidor WebSocket!',
        timestamp: new Date().toISOString()
    }));
});

// WebSocket do painel (/panel-ws)
panelWss.on('connection', (ws) => {
    console.log('[Panel] Painel conectado');
    
    // Envia dados iniciais
    ws.send(JSON.stringify({
        type: 'initial_data',
        data: {
            brainrots: brainrots.slice(0, 50),
            stats: {
                totalBrainrots: brainrots.length,
                botsOnline: connectedBots.size,
                uptime: Date.now() - startTime,
                startTime: startTime
            }
        }
    }));
    
    ws.on('close', () => {
        console.log('[Panel] Painel desconectado');
    });
});

// Rotas API REST
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: Date.now() - startTime,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/stats', (req, res) => {
    res.json({
        uptime: Date.now() - startTime,
        totalBrainrots: brainrots.length,
        botsOnline: connectedBots.size,
        status: 'online',
        startTime: startTime
    });
});

app.get('/api/brainrots', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json(brainrots.slice(0, limit));
});

app.delete('/api/brainrots', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Token inválido' });
    }
    
    const count = brainrots.length;
    brainrots = [];
    console.log('[API] Todos os brainrots foram limpos');
    
    // Notifica painéis
    panelWss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'brainrots_cleared',
                count: count
            }));
        }
    });
    
    res.json({ message: `${count} brainrots removidos` });
});

// Keep-alive para Railway
setInterval(() => {
    http.get(`http://localhost:${PORT}/health`, (res) => {
        console.log('[Keep-Alive] Health check executado');
    }).on('error', (err) => {
        console.error('[Keep-Alive] Erro:', err.message);
    });
}, 4 * 60 * 1000); // 4 minutos

// Heartbeat para WebSockets
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('[WSS] Desconectando cliente inativo');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
    
    panelWss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000); // 30 segundos

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[Server] Rodando na porta ${PORT}`);
    console.log(`[WebSocket] Endpoint: ws://localhost:${PORT}/ws`);
    console.log(`[Panel WebSocket] Endpoint: ws://localhost:${PORT}/panel-ws`);
    console.log(`[HTTP] Endpoint: http://localhost:${PORT}`);
});
