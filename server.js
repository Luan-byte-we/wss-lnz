const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Criar servidor HTTP para servir o dashboard
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        fs.readFile(path.join(__dirname, 'dashboard.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Erro ao carregar dashboard');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

// WebSocket server na mesma porta
const wss = new WebSocket.Server({ server });

// Armazenar dados recebidos
const dadosRecebidos = [];
let contadorClientes = 0;

console.log('🚀 Servidor rodando em:');
console.log('   WebSocket: ws://localhost:8080');
console.log('   Dashboard: http://localhost:8080');

wss.on('connection', (ws, req) => {
    contadorClientes++;
    const clienteId = `Cliente_${contadorClientes}`;
    const ip = req.socket.remoteAddress;
    
    console.log(`✅ ${clienteId} conectou (IP: ${ip})`);
    
    // Identificar tipo de cliente (opcional)
    let tipoCliente = 'desconhecido';
    
    // Enviar ID pro cliente
    ws.send(JSON.stringify({
        tipo: 'identificacao',
        clienteId: clienteId,
        dadosHistoricos: dadosRecebidos.slice(-50) // últimos 50 dados
    }));
    
    ws.on('message', (data) => {
        try {
            // Tenta parsear como JSON
            let mensagem;
            try {
                mensagem = JSON.parse(data.toString());
            } catch {
                // Se não for JSON, trata como texto simples
                mensagem = {
                    tipo: 'texto',
                    conteudo: data.toString(),
                    timestamp: new Date().toISOString()
                };
            }
            
            // Adicionar metadados
            const dadoCompleto = {
                ...mensagem,
                clienteId: clienteId,
                clienteIp: ip,
                timestamp: new Date().toISOString(),
                tipoCliente: tipoCliente
            };
            
            // Armazenar
            dadosRecebidos.push(dadoCompleto);
            
            // Manter só últimos 1000 dados
            if (dadosRecebidos.length > 1000) {
                dadosRecebidos.shift();
            }
            
            console.log(`📨 [${clienteId}] Recebido:`, dadoCompleto);
            
            // Broadcast para todos os clientes (incluindo dashboard)
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        tipo: 'novo_dado',
                        dado: dadoCompleto,
                        total: dadosRecebidos.length
                    }));
                }
            });
            
        } catch (error) {
            console.error('Erro ao processar mensagem:', error);
        }
    });
    
    ws.on('close', () => {
        console.log(`❌ ${clienteId} desconectou`);
        
        // Notificar todos sobre desconexão
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    tipo: 'cliente_desconectou',
                    clienteId: clienteId
                }));
            }
        });
    });
    
    ws.on('error', (error) => {
        console.error(`Erro no ${clienteId}:`, error);
    });
});

server.listen(8080, () => {
    console.log('\n✨ Servidor pronto para receber conexões!');
    console.log('📊 Dashboard: http://localhost:8080');
    console.log('🔌 WebSocket: ws://localhost:8080\n');
});
