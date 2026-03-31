const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Criar servidores WebSocket para diferentes endpoints
const wssMain = new WebSocket.Server({ noServer: true }); // Para /ws
const wssAlt = new WebSocket.Server({ noServer: true });   // Para /wss (fallback)

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb', type: '*/*' }));
app.use(express.static(path.join(__dirname)));

// CORS liberado COMPLETAMENTE
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

// Configuração
const ADMIN_TOKEN = 'admin123';
let brainrots = [];
let startTime = Date.now();
let connectedBots = new Map(); // Armazena ID e timestamp da conexão

// Heartbeat para manter conexões vivas
function heartbeat(ws) {
    ws.isAlive = true;
}

// Função para configurar heartbeat em uma conexão
function setupHeartbeat(ws) {
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
        console.log(`[Heartbeat] Pong recebido de ${ws.botId || 'unknown'}`);
    });
}

// Função para processar mensagens recebidas
function processMessage(ws, data, botId) {
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
            parsedData: type === 'JSON' ? parsedData : rawData,
            size: rawData.length
        };
        
        brainrots.unshift(brainrot);
        // Mantém apenas os últimos 2000 registros
        if (brainrots.length > 2000) brainrots.pop();
        
        console.log(`[RECEBIDO] Bot: ${botId} | Tipo: ${type} | Tamanho: ${rawData.length} bytes`);
        console.log(`[DADO] ${rawData.substring(0, 100)}${rawData.length > 100 ? '...' : ''}`);
        
        // Notifica todos os painéis conectados
        if (global.panelWss) {
            global.panelWss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'new_brainrot',
                        data: brainrot
                    }));
                }
            });
        }
        
        // Envia confirmação para o bot
        const confirmation = JSON.stringify({
            status: 'received',
            id: brainrot.id,
            type: type,
            timestamp: brainrot.timestamp,
            message: 'Dados recebidos com sucesso!'
        });
        ws.send(confirmation);
        
    } catch (error) {
        console.error(`[ERRO] Processando mensagem de ${botId}:`, error);
        ws.send(JSON.stringify({
            status: 'error',
            message: error.message
        }));
    }
}

// Função para configurar conexão WebSocket
function setupWebSocketConnection(ws, req, endpoint) {
    const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    ws.botId = botId;
    
    // Armazena informações da conexão
    connectedBots.set(botId, {
        id: botId,
        connectedAt: new Date().toISOString(),
        endpoint: endpoint,
        ip: req.socket.remoteAddress
    });
    
    console.log(`[CONECTADO] Bot: ${botId} | Endpoint: ${endpoint} | IP: ${req.socket.remoteAddress}`);
    console.log(`[STATUS] Total de bots conectados: ${connectedBots.size}`);
    
    setupHeartbeat(ws);
    
    // Envia mensagem de boas-vindas
    ws.send(JSON.stringify({
        status: 'connected',
        botId: botId,
        endpoint: endpoint,
        message: 'Conectado ao servidor Brainrot!',
        timestamp: new Date().toISOString(),
        instructions: 'Envie qualquer dado (JSON, texto, números, XML, HTML) - todos serão aceitos!'
    }));
    
    ws.on('message', (data) => {
        processMessage(ws, data, botId);
    });
    
    ws.on('close', () => {
        connectedBots.delete(botId);
        console.log(`[DESCONECTADO] Bot: ${botId} | Total restante: ${connectedBots.size}`);
        
        // Notifica painéis sobre atualização
        if (global.panelWss) {
            global.panelWss.clients.forEach(client => {
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
        }
    });
    
    ws.on('error', (error) => {
        console.error(`[ERRO] Bot ${botId}:`, error.message);
    });
    
    ws.on('pong', () => {
        // Heartbeat já tratado
    });
}

// Configurar upgrade do HTTP para WebSocket
server.on('upgrade', (request, socket, head) => {
    const pathname = request.url;
    
    console.log(`[UPGRADE] Tentando upgrade para: ${pathname}`);
    
    // Aceita tanto /ws quanto /wss
    if (pathname === '/ws' || pathname === '/wss') {
        wssMain.handleUpgrade(request, socket, head, (ws) => {
            setupWebSocketConnection(ws, request, pathname);
            wssMain.emit('connection', ws, request);
        });
    } 
    // Endpoint do painel
    else if (pathname === '/panel-ws') {
        if (!global.panelWss) {
            global.panelWss = new WebSocket.Server({ noServer: true });
        }
        global.panelWss.handleUpgrade(request, socket, head, (ws) => {
            console.log('[PAINEL] Conexão estabelecida');
            global.panelWss.emit('connection', ws, request);
        });
    }
    else {
        socket.destroy();
    }
});

// WebSocket do painel (se não existir, criar)
if (!global.panelWss) {
    global.panelWss = new WebSocket.Server({ noServer: true });
}

global.panelWss.on('connection', (ws) => {
    console.log('[PAINEL] Painel de controle conectado');
    
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
        console.log('[PAINEL] Painel desconectado');
    });
});

// Rotas API REST
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        connections: connectedBots.size,
        totalMessages: brainrots.length
    });
});

app.get('/api/stats', (req, res) => {
    res.json({
        uptime: Date.now() - startTime,
        totalBrainrots: brainrots.length,
        botsOnline: connectedBots.size,
        status: 'online',
        startTime: startTime,
        endpoints: {
            ws: '/ws',
            wss: '/wss',
            panel: '/panel-ws'
        }
    });
});

app.get('/api/brainrots', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const type = req.query.type;
    
    let filtered = brainrots.slice(0, limit);
    if (type) {
        filtered = filtered.filter(b => b.type === type.toUpperCase());
    }
    
    res.json(filtered);
});

app.delete('/api/brainrots', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Token inválido', hint: 'Use x-admin-token: admin123' });
    }
    
    const count = brainrots.length;
    brainrots = [];
    console.log(`[API] Todos os ${count} brainrots foram limpos`);
    
    // Notifica painéis
    if (global.panelWss) {
        global.panelWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'brainrots_cleared',
                    count: count
                }));
            }
        });
    }
    
    res.json({ 
        message: `${count} brainrots removidos`,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/connections', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Token inválido' });
    }
    
    const connections = Array.from(connectedBots.values());
    res.json({
        total: connections.length,
        connections: connections
    });
});

// Rota de teste para enviar dados via HTTP
app.post('/api/send', express.text({ type: '*/*' }), (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Token inválido' });
    }
    
    const rawData = req.body;
    const testBotId = `http_${Date.now()}`;
    
    // Processa como se fosse uma mensagem WebSocket
    const brainrot = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 8),
        timestamp: new Date().toISOString(),
        botId: testBotId,
        rawData: rawData,
        type: 'HTTP_TEST',
        size: rawData.length
    };
    
    brainrots.unshift(brainrot);
    
    // Notifica painéis
    if (global.panelWss) {
        global.panelWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'new_brainrot',
                    data: brainrot
                }));
            }
        });
    }
    
    res.json({
        status: 'received',
        id: brainrot.id,
        message: 'Dados recebidos via HTTP'
    });
});

// Keep-alive para Railway (evita dormência)
setInterval(() => {
    const healthUrl = `http://localhost:${PORT}/health`;
    const httpModule = require('http');
    httpModule.get(healthUrl, (res) => {
        console.log(`[Keep-Alive] Health check realizado - Status: ${res.statusCode}`);
    }).on('error', (err) => {
        console.error('[Keep-Alive] Erro:', err.message);
    });
}, 3 * 60 * 1000); // 3 minutos

// Heartbeat para WebSockets (ping a cada 25 segundos)
setInterval(() => {
    // Verifica conexões do WebSocket principal
    if (wssMain && wssMain.clients) {
        wssMain.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                console.log(`[Heartbeat] Desconectando cliente inativo: ${ws.botId || 'unknown'}`);
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }
    
    // Verifica conexões do painel
    if (global.panelWss && global.panelWss.clients) {
        global.panelWss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }
    
    console.log(`[Heartbeat] Ping enviado - Bots ativos: ${connectedBots.size}`);
}, 25000); // 25 segundos

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════════');
    console.log('🚀 BRAINROT SERVER - WebSocket Universal');
    console.log('═══════════════════════════════════════════════════');
    console.log(`📡 Servidor rodando na porta: ${PORT}`);
    console.log(`🌐 HTTP: http://localhost:${PORT}`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws`);
    console.log(`🔌 WebSocket (alt): ws://localhost:${PORT}/wss`);
    console.log(`🎮 Painel WebSocket: ws://localhost:${PORT}/panel-ws`);
    console.log('═══════════════════════════════════════════════════');
    console.log('✅ Aceitando conexões de QUALQUER origem');
    console.log('✅ Aceitando QUALQUER formato de dados');
    console.log('✅ Heartbeat ativo (ping a cada 25s)');
    console.log('✅ Keep-alive ativo (health check a cada 3min)');
    console.log('═══════════════════════════════════════════════════');
});
