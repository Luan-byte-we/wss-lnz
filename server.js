const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// PEGA A PORTA DO RAILWAY
const PORT = process.env.PORT || 8080;

// Cria servidor HTTP
const server = http.createServer((req, res) => {
    const url = req.url;
    
    console.log(`📡 Requisição: ${url}`);
    
    // Rota principal - dashboard
    if (url === '/' || url === '/index.html' || url === '/dashboard') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Erro ao carregar dashboard');
                console.error('Erro ao ler index.html:', err);
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    }
    // Rota de teste
    else if (url === '/teste') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Servidor funcionando!</h1><p>WebSocket disponível em: /on</p>');
    }
    // Health check para Railway
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
                    a { color: white; }
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
                    <p><a href="/dashboard">Clique aqui para ver os dados em tempo real</a></p>
                </div>
                <div class="card">
                    <h2>📈 Status:</h2>
                    <p>✅ Servidor rodando perfeitamente</p>
                    <p>👥 Clientes conectados: <strong id="clientCount">0</strong></p>
                    <p>📨 Total de dados recebidos: <strong id="dataCount">0</strong></p>
                </div>
                <script>
                    fetch('/health')
                        .then(r => r.json())
                        .then(d => {
                            document.getElementById('clientCount').textContent = d.clients;
                            document.getElementById('dataCount').textContent = d.totalData;
                        });
                </script>
            </body>
            </html>
        `);
    }
});

// WEBSOCKET SERVER - NA ROTA /on (como você pediu)
const wss = new WebSocket.Server({ 
    server,
    path: '/on'  // AGORA É /on - sua URL será wss://.../on
});

// Armazenamento de dados
const dadosRecebidos = [];
const clients = new Map();
let clientIdCounter = 0;

console.log('╔═══════════════════════════════════════════════════════╗');
console.log('║     🚀 WSS SERVER - RECEPTOR DE DADOS GLOBAL         ║');
console.log('╠═══════════════════════════════════════════════════════╣');
console.log(`║  🌐 Porta: ${PORT}`);
console.log(`║  🔌 WebSocket: wss://wss-lnz-production.up.railway.app/on`);
console.log(`║  📊 Dashboard: https://wss-lnz-production.up.railway.app/dashboard`);
console.log('╚═══════════════════════════════════════════════════════╝');

// Evento de conexão WebSocket
wss.on('connection', (ws, req) => {
    clientIdCounter++;
    const clientId = `Client_${clientIdCounter}`;
    const ip = req.socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    // Identifica tipo de dispositivo
    let deviceType = '💻 Desktop';
    if (userAgent.includes('Mobile')) deviceType = '📱 Mobile';
    if (userAgent.includes('Discord')) deviceType = '🤖 Discord Bot';
    if (userAgent.includes('Bot')) deviceType = '🤖 Bot';
    
    // Salva cliente
    clients.set(clientId, {
        id: clientId,
        ip: ip,
        deviceType: deviceType,
        connectedAt: new Date(),
        lastMessage: null
    });
    
    console.log(`\n✅ NOVA CONEXÃO!`);
    console.log(`   ID: ${clientId}`);
    console.log(`   IP: ${ip}`);
    console.log(`   Tipo: ${deviceType}`);
    console.log(`   Total conectados: ${clients.size}`);
    
    // Envia boas-vindas com histórico
    ws.send(JSON.stringify({
        type: 'welcome',
        clientId: clientId,
        message: `Conectado! Seu ID: ${clientId}`,
        totalClients: clients.size,
        history: dadosRecebidos.slice(-20),
        timestamp: new Date().toISOString()
    }));
    
    // Notifica todos os outros clientes sobre nova conexão
    broadcast({
        type: 'client_connected',
        client: {
            id: clientId,
            deviceType: deviceType,
            ip: ip
        },
        totalClients: clients.size,
        timestamp: new Date().toISOString()
    }, ws); // ws = não envia para quem acabou de conectar
    
    // Recebe mensagens/dados
    ws.on('message', (data) => {
        try {
            const rawMessage = data.toString();
            let messageData;
            
            // Tenta parsear JSON
            try {
                messageData = JSON.parse(rawMessage);
            } catch {
                messageData = {
                    type: 'text',
                    content: rawMessage
                };
            }
            
            // Cria registro completo
            const fullData = {
                ...messageData,
                clientId: clientId,
                clientIp: ip,
                clientDevice: deviceType,
                timestamp: new Date().toISOString(),
                timestampUnix: Date.now()
            };
            
            // Armazena
            dadosRecebidos.push(fullData);
            
            // Mantém só últimos 500 dados
            if (dadosRecebidos.length > 500) {
                dadosRecebidos.shift();
            }
            
            // Atualiza última mensagem do cliente
            const client = clients.get(clientId);
            if (client) {
                client.lastMessage = new Date();
                clients.set(clientId, client);
            }
            
            console.log(`📨 [${clientId}] ${deviceType}: ${rawMessage.substring(0, 100)}`);
            
            // Envia para TODOS os clientes conectados
            broadcast({
                type: 'new_data',
                data: fullData,
                stats: {
                    totalData: dadosRecebidos.length,
                    totalClients: clients.size,
                    lastUpdate: new Date().toISOString()
                }
            });
            
        } catch (error) {
            console.error(`❌ Erro ao processar mensagem:`, error.message);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Erro ao processar dados',
                error: error.message
            }));
        }
    });
    
    // Cliente desconectou
    ws.on('close', () => {
        clients.delete(clientId);
        console.log(`\n❌ CLIENTE DESCONECTOU!`);
        console.log(`   ID: ${clientId}`);
        console.log(`   Restam: ${clients.size} clientes`);
        
        broadcast({
            type: 'client_disconnected',
            clientId: clientId,
            totalClients: clients.size,
            timestamp: new Date().toISOString()
        });
    });
    
    ws.on('error', (error) => {
        console.error(`⚠️ Erro no cliente ${clientId}:`, error.message);
    });
});

// Função para enviar mensagem para todos os clientes
function broadcast(message, excludeWs = null) {
    const messageStr = JSON.stringify(message);
    let sentCount = 0;
    
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
            sentCount++;
        }
    });
    
    if (message.type === 'new_data' && sentCount > 0) {
        console.log(`   📡 Broadcast enviado para ${sentCount} clientes`);
    }
}

// Health check endpoint
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✨ Servidor rodando em 0.0.0.0:${PORT}`);
    console.log(`🔗 URLs disponíveis:`);
    console.log(`   📊 Dashboard: https://wss-lnz-production.up.railway.app/`);
    console.log(`   🔌 WebSocket: wss://wss-lnz-production.up.railway.app/on`);
    console.log(`   💚 Health:    https://wss-lnz-production.up.railway.app/health\n`);
});

// Mantém o servidor ativo (importante para Railway)
setInterval(() => {
    console.log(`💓 Heartbeat - Clientes: ${clients.size} | Dados: ${dadosRecebidos.length}`);
}, 30000);
