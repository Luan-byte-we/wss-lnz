const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// RAILWAY: usa a porta que eles fornecem
const PORT = process.env.PORT || 8080;

// Criar servidor HTTP
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // Dashboard
    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/dashboard') {
        fs.readFile(path.join(__dirname, 'dashboard.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Erro ao carregar dashboard: ' + err.message);
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    }
    // Cliente exemplo
    else if (parsedUrl.pathname === '/cliente') {
        fs.readFile(path.join(__dirname, 'cliente.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Erro');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    }
    // Health check (importante para Railway)
    else if (parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'online', 
            timestamp: new Date().toISOString(),
            clients: clients.size
        }));
    }
    else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>WSS Server</title></head>
            <body>
                <h1>🚀 Servidor WSS Rodando!</h1>
                <p>WebSocket: <strong>wss://${req.headers.host}/wss</strong></p>
                <p>Dashboard: <a href="/dashboard">/dashboard</a></p>
                <p>Cliente: <a href="/cliente">/cliente</a></p>
                <hr>
                <p>Status: ✅ Online</p>
                <p>Clientes conectados: ${clients.size}</p>
            </body>
            </html>
        `);
    }
});

// WebSocket Server - QUALQUER rota /wss
const wss = new WebSocket.Server({ 
    server,
    path: '/wss'  // IMPORTANTE: seus clientes vão conectar aqui
});

// Armazenamento
const dadosRecebidos = [];
const clients = new Map();
let contadorId = 0;

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║     🚀 SERVIDOR WSS - RAILWAY                        ║');
console.log('╠══════════════════════════════════════════════════════╣');
console.log(`║  Porta: ${PORT}`);
console.log(`║  WebSocket: wss://SEU-URL.railway.app/wss`);
console.log('╚══════════════════════════════════════════════════════╝');

wss.on('connection', (ws, req) => {
    contadorId++;
    const clienteId = `Cliente_${contadorId}`;
    const ip = req.socket.remoteAddress?.replace('::ffff:', '') || 'Desconhecido';
    
    clients.set(clienteId, {
        id: clienteId,
        ip: ip,
        conectadoEm: new Date()
    });
    
    console.log(`✅ [${new Date().toISOString()}] ${clienteId} conectou | Total: ${clients.size}`);
    
    // Envia boas-vindas
    ws.send(JSON.stringify({
        tipo: 'boas_vindas',
        clienteId: clienteId,
        mensagem: `Conectado! ID: ${clienteId}`,
        totalClientes: clients.size,
        timestamp: new Date().toISOString()
    }));
    
    // Notifica todos
    broadcast({
        tipo: 'cliente_conectou',
        cliente: { id: clienteId, ip: ip },
        totalClientes: clients.size,
        timestamp: new Date().toISOString()
    });
    
    // Recebe dados
    ws.on('message', (data) => {
        try {
            const mensagem = data.toString();
            let dado;
            
            try {
                dado = JSON.parse(mensagem);
            } catch {
                dado = { tipo: 'texto', conteudo: mensagem };
            }
            
            const dadoCompleto = {
                ...dado,
                clienteId: clienteId,
                clienteIp: ip,
                timestamp: new Date().toISOString()
            };
            
            dadosRecebidos.push(dadoCompleto);
            if (dadosRecebidos.length > 500) dadosRecebidos.shift();
            
            console.log(`📨 [${clienteId}]: ${mensagem.substring(0, 100)}`);
            
            broadcast({
                tipo: 'dados_recebidos',
                dado: dadoCompleto,
                stats: {
                    totalDados: dadosRecebidos.length,
                    totalClientes: clients.size
                }
            });
            
        } catch (error) {
            console.error('Erro:', error.message);
        }
    });
    
    ws.on('close', () => {
        clients.delete(clienteId);
        console.log(`❌ ${clienteId} desconectou | Restam: ${clients.size}`);
        
        broadcast({
            tipo: 'cliente_desconectou',
            clienteId: clienteId,
            totalClientes: clients.size,
            timestamp: new Date().toISOString()
        });
    });
});

function broadcast(mensagem) {
    const msg = JSON.stringify(mensagem);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

// Inicia servidor
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✨ Servidor rodando na porta ${PORT}`);
    console.log(`📡 WebSocket disponível em: ws://localhost:${PORT}/wss`);
    console.log(`🌍 URL completa: https://${process.env.RAILWAY_STATIC_URL || 'localhost'}/wss\n`);
});

// Mantém o servidor vivo (importante para Railway)
setInterval(() => {
    console.log(`💓 Heartbeat - Clientes: ${clients.size} | Dados: ${dadosRecebidos.length}`);
}, 30000);
