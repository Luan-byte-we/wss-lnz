const WebSocket = require('ws');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// PORTA do Railway (eles fornecem automaticamente)
const PORT = process.env.PORT || 8080;

// Criar servidor HTTP para o dashboard
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // Rota principal - Dashboard
    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/dashboard') {
        fs.readFile(path.join(__dirname, 'dashboard.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Erro ao carregar dashboard');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    }
    // Rota do cliente exemplo
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
    // API para estatísticas
    else if (parsedUrl.pathname === '/api/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            totalClientes: clientes.size,
            totalDados: dadosRecebidos.length,
            status: 'online',
            timestamp: new Date().toISOString()
        }));
    }
    else {
        res.writeHead(404);
        res.end('Rota não encontrada. Use /dashboard ou /cliente');
    }
});

// WebSocket Server na rota /wss
const wss = new WebSocket.Server({ 
    server,
    path: '/wss'  // IMPORTANTE: sua rota será /wss
});

// Armazenamento de dados
const dadosRecebidos = [];
const clientes = new Map();
let contadorId = 0;

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║     🚀 SERVIDOR WSS RECEPTOR DE DADOS GLOBAL        ║');
console.log('╠══════════════════════════════════════════════════════╣');
console.log(`║  🌐 WebSocket: wss://wss-lnz1-production.up.railway.app/wss`);
console.log(`║  📊 Dashboard: https://wss-lnz1-production.up.railway.app/dashboard`);
console.log(`║  📱 Cliente:   https://wss-lnz1-production.up.railway.app/cliente`);
console.log('╠══════════════════════════════════════════════════════╣');
console.log('║  ✅ Aceitando conexões de QUALQUER dispositivo!     ║');
console.log('╚══════════════════════════════════════════════════════╝');

wss.on('connection', (ws, req) => {
    contadorId++;
    const clienteId = `Cliente_${contadorId}`;
    const ip = req.socket.remoteAddress?.replace('::ffff:', '') || 'Desconhecido';
    const userAgent = req.headers['user-agent'] || 'Desconhecido';
    
    // Identificar tipo de dispositivo
    let tipoDispositivo = 'desconhecido';
    if (userAgent.includes('Mobile')) tipoDispositivo = '📱 Celular';
    else if (userAgent.includes('Discord')) tipoDispositivo = '🤖 Discord Bot';
    else if (userAgent.includes('Bot')) tipoDispositivo = '🤖 Bot';
    else if (userAgent.includes('Chrome')) tipoDispositivo = '🌐 Chrome';
    else if (userAgent.includes('Firefox')) tipoDispositivo = '🦊 Firefox';
    else if (userAgent.includes('Safari')) tipoDispositivo = '🍎 Safari';
    else tipoDispositivo = '💻 Computador';
    
    // Salvar cliente
    clientes.set(clienteId, {
        id: clienteId,
        ip: ip,
        tipo: tipoDispositivo,
        userAgent: userAgent,
        conectadoEm: new Date(),
        ultimaMsg: new Date()
    });
    
    console.log(`\n✅ [${new Date().toLocaleString()}] NOVO CLIENTE:`);
    console.log(`   ID: ${clienteId}`);
    console.log(`   IP: ${ip}`);
    console.log(`   Tipo: ${tipoDispositivo}`);
    console.log(`   Total conectados: ${clientes.size}`);
    
    // Enviar boas-vindas com histórico
    ws.send(JSON.stringify({
        tipo: 'boas_vindas',
        clienteId: clienteId,
        mensagem: `Bem-vindo! Você é o cliente #${contadorId}`,
        totalClientes: clientes.size,
        historico: dadosRecebidos.slice(-20),
        timestamp: new Date().toISOString()
    }));
    
    // Notificar todos sobre nova conexão
    broadcast({
        tipo: 'cliente_conectou',
        cliente: {
            id: clienteId,
            ip: ip,
            tipo: tipoDispositivo
        },
        totalClientes: clientes.size,
        timestamp: new Date().toISOString()
    });
    
    // Receber mensagens/dados
    ws.on('message', (data) => {
        try {
            const mensagemRecebida = data.toString();
            let dadoProcessado;
            
            // Tenta parsear como JSON
            try {
                dadoProcessado = JSON.parse(mensagemRecebida);
            } catch {
                dadoProcessado = {
                    tipo: 'texto_simples',
                    conteudo: mensagemRecebida
                };
            }
            
            // Adicionar metadados completos
            const dadoCompleto = {
                ...dadoProcessado,
                clienteId: clienteId,
                clienteIp: ip,
                clienteTipo: tipoDispositivo,
                timestamp: new Date().toISOString(),
                timestampUnix: Date.now()
            };
            
            // Armazenar
            dadosRecebidos.push(dadoCompleto);
            if (dadosRecebidos.length > 1000) dadosRecebidos.shift();
            
            // Atualizar última mensagem do cliente
            const cliente = clientes.get(clienteId);
            if (cliente) {
                cliente.ultimaMsg = new Date();
                clientes.set(clienteId, cliente);
            }
            
            console.log(`📨 [${clienteId}] ${tipoDispositivo}: ${mensagemRecebida.substring(0, 100)}`);
            
            // Broadcast para TODOS os clientes (dashboard, outros dispositivos)
            broadcast({
                tipo: 'dados_recebidos',
                dado: dadoCompleto,
                stats: {
                    totalDados: dadosRecebidos.length,
                    totalClientes: clientes.size,
                    ultimoDado: new Date().toISOString()
                }
            });
            
        } catch (error) {
            console.error(`❌ Erro ao processar mensagem de ${clienteId}:`, error.message);
            ws.send(JSON.stringify({
                tipo: 'erro',
                mensagem: 'Erro ao processar seus dados',
                erro: error.message
            }));
        }
    });
    
    // Cliente desconectou
    ws.on('close', () => {
        clientes.delete(clienteId);
        console.log(`\n❌ [${new Date().toLocaleString()}] ${clienteId} (${tipoDispositivo}) desconectou`);
        console.log(`   👥 Restam ${clientes.size} clientes conectados`);
        
        broadcast({
            tipo: 'cliente_desconectou',
            clienteId: clienteId,
            clienteTipo: tipoDispositivo,
            totalClientes: clientes.size,
            timestamp: new Date().toISOString()
        });
    });
    
    ws.on('error', (error) => {
        console.error(`⚠️ Erro no ${clienteId}:`, error.message);
    });
});

// Função para enviar mensagem para todos
function broadcast(mensagem) {
    const msgString = JSON.stringify(mensagem);
    let enviados = 0;
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msgString);
            enviados++;
        }
    });
    
    if (enviados > 0 && mensagem.tipo === 'dados_recebidos') {
        console.log(`   📡 Broadcast para ${enviados} clientes`);
    }
}

// Iniciar servidor
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✨ Servidor rodando em 0.0.0.0:${PORT}`);
    console.log(`🔗 Endereços disponíveis:`);
    console.log(`   📊 Dashboard: https://wss-lnz1-production.up.railway.app/dashboard`);
    console.log(`   🔌 WebSocket: wss://wss-lnz1-production.up.railway.app/wss`);
    console.log(`   📱 Cliente:   https://wss-lnz1-production.up.railway.app/cliente\n`);
});
