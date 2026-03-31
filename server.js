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
let todayBrainrots = 0;
const startTime = Date.now();

// Reset diário à meia-noite
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
    console.log(`✅ Bot ${botId} conectado de ${ip} | Total: ${bots.size}`);
    
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
            
            const brainrot = {
                id: Date.now(),
                receivedAt: new Date().toISOString(),
                botId: botInfo?.id || 'unknown',
                botIp: ip,
                data: jsonData
            };
            
            brainrots.unshift(brainrot);
            if (brainrots.length > 200) brainrots.pop();
            totalBrainrots++;
            todayBrainrots++;
            
            console.log(`📦 Brainrot #${totalBrainrots} de ${botId}:`, JSON.stringify(jsonData).slice(0, 100));
            
            ws.send(JSON.stringify({ 
                event: 'received', 
                msgCount: botInfo?.msgCount || 0,
                ack: true 
            }));
            
            // Broadcast para painéis
            broadcastToPanels({ event: 'brainrot', brainrot, stats: getStats() });
            
        } catch(e) {
            ws.send(JSON.stringify({ error: 'JSON inválido' }));
        }
    });
    
    ws.on('close', () => {
        bots.delete(ws);
        console.log(`❌ Bot ${botId} desconectado | Restam: ${bots.size}`);
    });
    
    // Heartbeat
    ws.on('pong', () => { ws.isAlive = true; });
});

// Heartbeat checker
setInterval(() => {
    wssBots.clients.forEach(ws => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

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
    
    ws.on('close', () => {
        panels.delete(ws);
        console.log(`📺 Painel desconectado (${panels.size} restantes)`);
    });
});

// Stats periódicos para os painéis
setInterval(() => {
    broadcastToPanels({ event: 'stats', stats: getStats() });
}, 5000);

// ============================================
// API Routes
// ============================================
app.get('/api/stats', (req, res) => {
    res.json(getStats());
});

app.get('/api/brainrots', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json({ data: brainrots.slice(0, limit), total: totalBrainrots });
});

app.delete('/api/brainrots', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Token inválido' });
    }
    brainrots = [];
    totalBrainrots = 0;
    todayBrainrots = 0;
    broadcastToPanels({ event: 'cleared' });
    res.json({ ok: true });
});

app.post('/api/wss/enable', (req, res) => {
    // WSS já está ativa por padrão
    res.json({ ok: true });
});

app.post('/api/wss/disable', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Token inválido' });
    }
    // Desconecta todos os bots
    bots.forEach((_, ws) => {
        try { ws.close(1001, 'WSS disabled by admin'); } catch(e) {}
    });
    res.json({ ok: true });
});

app.post('/api/bots/kick-all', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Token inválido' });
    }
    const count = bots.size;
    bots.forEach((_, ws) => {
        try { ws.close(1001, 'Kicked by admin'); } catch(e) {}
    });
    res.json({ ok: true, kicked: count });
});

app.get('/api/security/token', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Token inválido' });
    }
    res.json({ token: ADMIN_TOKEN });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// 🧠 BOT INTERNO - Mantém a WSS ativa 24/7
// ============================================
function iniciarBotInterno() {
    console.log('🤖 [BOT INTERNO] Iniciando bot de keep-alive...');
    
    setTimeout(() => {
        const botUrl = `ws://localhost:${PORT}/on`;
        const InternalBot = new WebSocket(botUrl);
        
        InternalBot.on('open', () => {
            console.log('✅ [BOT INTERNO] Conectado à WSS! Enviando keep-alive...');
            
            InternalBot.send(JSON.stringify({
                type: "keepalive",
                bot: "internal_bot",
                message: "oi",
                timestamp: new Date().toISOString()
            }));
            
            setInterval(() => {
                if (InternalBot.readyState === WebSocket.OPEN) {
                    InternalBot.send(JSON.stringify({
                        type: "keepalive",
                        bot: "internal_bot",
                        message: "oi",
                        timestamp: new Date().toISOString()
                    }));
                    console.log(`💓 [BOT INTERNO] Keep-alive enviado: ${new Date().toLocaleTimeString()}`);
                } else {
                    console.log('⚠️ [BOT INTERNO] Conexão perdida, tentando reconectar...');
                    setTimeout(() => iniciarBotInterno(), 5000);
                }
            }, 5 * 60 * 1000); // 5 minutos
        });
        
        InternalBot.on('message', (data) => {
            console.log(`📥 [BOT INTERNO] Resposta: ${data.toString().slice(0, 80)}`);
        });
        
        InternalBot.on('error', (err) => {
            console.log(`❌ [BOT INTERNO] Erro: ${err.message}`);
        });
        
        InternalBot.on('close', () => {
            console.log('🔌 [BOT INTERNO] Desconectado! Tentando reconectar em 10 segundos...');
            setTimeout(() => iniciarBotInterno(), 10000);
        });
        
    }, 5000);
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
║  WSS Panel: ws://localhost:${PORT}/ws       ║
║                                            ║
║  🤖 BOT INTERNO ATIVO!                     ║
║  Enviando keep-alive a cada 5 minutos      ║
╚════════════════════════════════════════════╝
    `);
    
    // Iniciar bot interno após servidor rodar
    setTimeout(iniciarBotInterno, 3000);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🔌 Encerrando servidor...');
    process.exit(0);
});
