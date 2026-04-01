const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// PORTA DO RAILWAY
const PORT = process.env.PORT || 8080;

// Criar servidor HTTP
const server = http.createServer((req, res) => {
    const url = req.url;
    
    console.log(`📡 Requisição: ${url}`);
    
    // Rota principal - dashboard
    if (url === '/' || url === '/index.html' || url === '/dashboard') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Erro ao carregar dashboard');
                console.error('Erro:', err);
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    }
    // Health check
    else if (url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'online', 
            timestamp: new Date().toISOString(),
            clients: clients.size,
            totalData: dadosRecebidos.length
        }));
    }
    else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>WSS Server Online</title>
                <meta charset="UTF-8">
                <style>
                    body { font-family: sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
                    .card { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; margin: 20px 0; }
                    code { background: rgba(0,0,0,0.3); padding: 2px 5px; border-radius: 3px; }
                </style>
            </head>
            <body>
                <h1>🚀 Servidor WSS Online!</h1>
                <div class="card">
                    <h2>📡 WebSocket Endpoint:</h2>
                    <p><code>wss://wss-lnz-production.up.railway.app/on</code></p>
                </div>
                <div class="card">
                    <h2>📊 Dashboard:</h2>
                    <p><a href="/dashboard" style="color:white;">Clique aqui para ver os dados em tempo real</a></p>
                </div>
                <div class="card">
                    <h2>📈 Status:</h2>
                    <p>✅ Servidor rodando perfeitamente</p>
                    <p>👥 Clientes conectados: <strong id="clientCount">0</strong></p>
                    <p>📨 Total de dados: <strong id="dataCount">0</strong></p>
                </div>
                <script>
                    fetch('/health').then(r=>r.json()).then(d=>{
                        document.getElementById('clientCount').textContent = d.clients;
                        document.getElementById('dataCount').textContent = d.totalData;
                    });
                </script>
            </body>
            </html>
        `);
    }
});

// WEBSOCKET NA ROTA /on
const wss = new WebSocket.Server({ 
    server,
    path: '/on'
});

// Armazenamento
const dadosRecebidos = [];
const clients = new Map();
let clientIdCounter = 0;

console.log('╔═══════════════════════════════════════════════════════╗');
console.log('║     🚀 WSS SERVER - RECEPTOR DE DADOS GLOBAL         ║');
console.log('╠═══════════════════════════════════════════════════════╣');
console.log(`║  🌐 Porta: ${PORT}`);
console.log(`║  🔌 WebSocket: wss://wss-lnz-production.up.railway.app/on`);
console.log(`║  📊 Dashboard: https://wss-lnz-production.up.railway.app/`);
console.log('╚═══════════════════════════════════════════════════════╝');

wss.on('connection', (ws, req) => {
    clientIdCounter++;
    const clientId = `Client_${clientIdCounter}`;
    const ip = req.socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    let deviceType = '💻 Desktop';
    if (userAgent.includes('Mobile')) deviceType = '📱 Mobile';
    if (userAgent.includes('Discord')) deviceType = '🤖 Discord Bot';
    if (userAgent.includes('Bot')) deviceType = '🤖 Bot';
    
    clients.set(clientId, {
        id: clientId,
        ip: ip,
        deviceType: deviceType,
        connectedAt: new Date()
    });
    
    console.log(`\n✅ NOVA CONEXÃO! ID: ${clientId} | Tipo: ${deviceType} | Total: ${clients.size}`);
    
    // Envia boas-vindas
    ws.send(JSON.stringify({
        type: 'welcome',
        clientId: clientId,
        message: `Conectado! Seu ID: ${clientId}`,
        totalClients: clients.size,
        history: dadosRecebidos.slice(-20),
        timestamp: new Date().toISOString()
    }));
    
    // Notifica todos
    broadcast({
        type: 'client_connected',
        client: { id: clientId, deviceType: deviceType },
        totalClients: clients.size,
        timestamp: new Date().toISOString()
    });
    
    // Recebe dados
    ws.on('message', (data) => {
        try {
            const rawMessage = data.toString();
            let messageData;
            
            try {
                messageData = JSON.parse(rawMessage);
            } catch {
                messageData = { type: 'text', content: rawMessage };
            }
            
            const fullData = {
                ...messageData,
                clientId: clientId,
                clientDevice: deviceType,
                timestamp: new Date().toISOString()
            };
            
            dadosRecebidos.push(fullData);
            if (dadosRecebidos.length > 500) dadosRecebidos.shift();
            
            console.log(`📨 [${clientId}] ${rawMessage.substring(0, 80)}`);
            
            broadcast({
                type: 'new_data',
                data: fullData,
                stats: {
                    totalData: dadosRecebidos.length,
                    totalClients: clients.size
                }
            });
            
        } catch (error) {
            console.error('Erro:', error.message);
        }
    });
    
    ws.on('close', () => {
        clients.delete(clientId);
        console.log(`❌ ${clientId} desconectou | Restam: ${clients.size}`);
        
        broadcast({
            type: 'client_disconnected',
            clientId: clientId,
            totalClients: clients.size,
            timestamp: new Date().toISOString()
        });
    });
});

function broadcast(message, excludeWs = null) {
    const msgStr = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(msgStr);
        }
    });
}

// Inicia servidor
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✨ Servidor rodando na porta ${PORT}`);
    console.log(`🔗 URLs disponíveis:`);
    console.log(`   📊 Dashboard: https://wss-lnz-production.up.railway.app/`);
    console.log(`   🔌 WebSocket: wss://wss-lnz-production.up.railway.app/on\n`);
});

// Heartbeat
setInterval(() => {
    console.log(`💓 Heartbeat - Clientes: ${clients.size} | Dados: ${dadosRecebidos.length}`);
}, 30000);
