const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// CORS TOTALMENTE LIBERADO - ACEITA QUALQUER ORIGEM
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

// WebSocket Servers
const wssBots = new WebSocket.Server({ 
    noServer: true,
    clientTracking: true
});

const wssPanel = new WebSocket.Server({ noServer: true });

// Armazenamento de dados
let brainrots = [];
let botsOnline = new Map();
let startTime = Date.now();
const ADMIN_TOKEN = 'admin123';

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
        botsOnline: botsOnline.size,
        wssStatus: 'online',
        timestamp: new Date().toISOString()
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
    const deleted = brainrots.length;
    brainrots = [];
    broadcastBrainrots();
    broadcastStats();
    res.json({ success: true, message: `${deleted} brainrots deletados` });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        service: 'WSS Brainrot Collector',
        version: '2.0.0',
        websocket: `wss://${req.get('host')}/ws`,
        connections: botsOnline.size,
        totalMessages: brainrots.length,
        uptime: Math.floor((Date.now() - startTime) / 1000)
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        connections: botsOnline.size,
        brainrots: brainrots.length
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Keep-alive para manter o servidor ativo
setInterval(() => {
    console.log('🔥 Keep-alive - Servidor ativo em:', new Date().toISOString());
    console.log(`📊 Status: ${botsOnline.size} bots online, ${brainrots.length} brainrots`);
    broadcastStats();
}, 240000); // 4 minutos

setInterval(() => {
    broadcastStats();
}, 10000); // 10 segundos

// WebSocket upgrade handler - ROTA /ws
server.on('upgrade', (request, socket, head) => {
    const url = request.url;
    console.log(`📡 Upgrade request para: ${url} - ${new Date().toISOString()}`);
    
    // ACEITA QUALQUER CONEXÃO NA ROTA /ws
    if (url === '/ws' || url === '/ws/' || url === '/on' || url === '/on/') {
        wssBots.handleUpgrade(request, socket, head, (ws) => {
            wssBots.emit('connection', ws, request);
        });
    } else if (url === '/panel-ws' || url === '/panel-ws/') {
        wssPanel.handleUpgrade(request, socket, head, (ws) => {
            wssPanel.emit('connection', ws, request);
        });
    } else {
        console.log(`❌ Rota não reconhecida: ${url}`);
        socket.destroy();
    }
});

// Conexão WebSocket principal - ACEITA DE QUALQUER LUGAR
wssBots.on('connection', (ws, req) => {
    const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const ip = req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Desconhecido';
    
    console.log(`✅ [${botId}] NOVO BOT CONECTADO!`);
    console.log(`📍 IP: ${ip}`);
    console.log(`🖥️ User-Agent: ${userAgent}`);
    console.log(`🕐 Horário: ${new Date().toISOString()}`);
    console.log(`📊 Total bots online: ${botsOnline.size + 1}`);
    
    // Registra o bot
    botsOnline.set(botId, {
        id: botId,
        connectedAt: new Date().toISOString(),
        messagesCount: 0,
        ip: ip,
        userAgent: userAgent
    });
    
    // Envia confirmação de conexão
    try {
        ws.send(JSON.stringify({
            type: 'connection',
            status: 'connected',
            botId: botId,
            message: '✅ Conectado ao servidor WSS com sucesso!',
            endpoint: 'wss://wss-lnz-production.up.railway.app/ws',
            timestamp: new Date().toISOString()
        }));
        console.log(`📤 Confirmação enviada para ${botId}`);
    } catch (err) {
        console.error(`❌ Erro ao enviar confirmação:`, err);
    }
    
    broadcastStats();
    
    // Recebe QUALQUER mensagem de QUALQUER lugar
    ws.on('message', (data) => {
        const messageStr = data.toString();
        console.log(`📨 [${botId}] MENSAGEM RECEBIDA: ${messageStr.substring(0, 200)}`);
        console.log(`🕐 ${new Date().toISOString()}`);
        
        try {
            // Tenta parsear JSON, se não conseguir, guarda como texto
            let jsonData;
            let isJson = false;
            try {
                jsonData = JSON.parse(messageStr);
                isJson = true;
            } catch(e) {
                jsonData = { raw_text: messageStr, type: 'text_message' };
            }
            
            // Cria o brainrot
            const brainrot = {
                id: brainrots.length + 1,
                botId: botId,
                timestamp: new Date().toISOString(),
                data: jsonData,
                raw: messageStr,
                isJson: isJson,
                ip: ip
            };
            
            // Adiciona no início do array
            brainrots.unshift(brainrot);
            
            // Mantém apenas os últimos 500 brainrots
            if (brainrots.length > 500) {
                brainrots = brainrots.slice(0, 500);
            }
            
            // Atualiza contagem de mensagens do bot
            const bot = botsOnline.get(botId);
            if (bot) {
                bot.messagesCount++;
                bot.lastMessage = new Date().toISOString();
                bot.lastMessageData = jsonData;
                botsOnline.set(botId, bot);
            }
            
            // Confirma recebimento para o bot
            ws.send(JSON.stringify({
                type: 'ack',
                status: 'received',
                id: brainrot.id,
                message: '✅ Dados recebidos com sucesso!',
                timestamp: new Date().toISOString()
            }));
            
            // Atualiza o painel
            broadcastBrainrots();
            broadcastStats();
            
            console.log(`💾 [${botId}] Brainrot #${brainrot.id} salvo com sucesso!`);
            console.log(`📊 Total brainrots: ${brainrots.length}`);
            
        } catch(error) {
            console.error(`❌ [${botId}] Erro ao processar mensagem:`, error);
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    status: 'error',
                    message: 'Erro ao processar mensagem: ' + error.message,
                    timestamp: new Date().toISOString()
                }));
            } catch(err) {}
        }
    });
    
    // Trata desconexão
    ws.on('close', (code, reason) => {
        console.log(`🔌 [${botId}] BOT DESCONECTADO!`);
        console.log(`📋 Código: ${code}`);
        console.log(`📋 Motivo: ${reason || 'Não informado'}`);
        console.log(`🕐 ${new Date().toISOString()}`);
        botsOnline.delete(botId);
        broadcastStats();
        console.log(`📊 Bots restantes: ${botsOnline.size}`);
    });
    
    // Trata erros
    ws.on('error', (error) => {
        console.error(`❌ [${botId}] ERRO NO WEBSOCKET:`, error.message);
        console.log(`🕐 ${new Date().toISOString()}`);
        if (botsOnline.has(botId)) {
            botsOnline.delete(botId);
            broadcastStats();
        }
    });
});

// Painel WebSocket (para o dashboard)
wssPanel.on('connection', (ws) => {
    console.log('📊 PAINEL DE CONTROLE CONECTADO');
    console.log(`🕐 ${new Date().toISOString()}`);
    
    // Envia dados iniciais
    ws.send(JSON.stringify({ 
        type: 'connected', 
        message: 'Conectado ao painel WSS',
        timestamp: new Date().toISOString()
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
        data: brainrots.slice(0, 50) 
    }));
    
    ws.on('close', () => {
        console.log('📊 PAINEL DE CONTROLE DESCONECTADO');
        console.log(`🕐 ${new Date().toISOString()}`);
    });
});

// Inicia o servidor
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 SERVIDOR WSS RODANDO COM SUCESSO!');
    console.log('='.repeat(60));
    console.log(`📡 WebSocket Principal: wss://wss-lnz-production.up.railway.app/ws`);
    console.log(`🌐 Site: https://wss-lnz-production.up.railway.app`);
    console.log(`🔐 Token Admin: admin123`);
    console.log(`📊 Painel WebSocket: wss://wss-lnz-production.up.railway.app/panel-ws`);
    console.log(`💚 Status: ONLINE - Pronto para receber dados de QUALQUER lugar!`);
    console.log(`🕐 Iniciado em: ${new Date().toISOString()}`);
    console.log('='.repeat(60) + '\n');
});

// Tratamento de erros globais
process.on('uncaughtException', (error) => {
    console.error('❌ ERRO NÃO TRATADO:', error);
    console.log('🕐', new Date().toISOString());
});

process.on('unhandledRejection', (error) => {
    console.error('❌ PROMISE REJEITADA:', error);
    console.log('🕐', new Date().toISOString());
});
