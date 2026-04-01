const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;

// Armazenar clientes conectados e dados
const clients = new Map();
let dadosRecebidos = [];
const MAX_DADOS_ARMAZENADOS = 500;
let totalDataReceived = 0;
let startTime = Date.now();

// Gerar ID único para cliente
function gerarClientId() {
  return `Client_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
}

// Detectar tipo de dispositivo pelo User-Agent
function detectarDispositivo(userAgent) {
  if (!userAgent) return '💻 Unknown';
  
  const ua = userAgent.toLowerCase();
  
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone') || ua.includes('ipad')) {
    return '📱 Mobile';
  } else if (ua.includes('bot') || ua.includes('curl') || ua.includes('postman') || ua.includes('discord')) {
    return '🤖 Bot';
  } else if (ua.includes('windows') || ua.includes('mac') || ua.includes('linux')) {
    return '💻 Desktop';
  }
  
  return '💻 Desktop';
}

// Servir arquivos estáticos
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  // Remover trailing slash
  if (pathname !== '/' && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // Health check
  if (pathname === '/health') {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const healthData = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: `${uptime}s`,
      clients_connected: clients.size,
      total_data_received: totalDataReceived,
      data_stored: dadosRecebidos.length,
      max_data_stored: MAX_DADOS_ARMAZENADOS
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthData, null, 2));
    return;
  }

  // Servir dashboard
  if (pathname === '/' || pathname === '/dashboard') {
    fs.readFile(path.join(__dirname, 'index.html'), 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Dashboard não encontrado');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // Página inicial informativa
  if (pathname === '/info') {
    const infoHtml = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WSS Server Info</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          background: white;
          border-radius: 20px;
          padding: 40px;
          max-width: 600px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }
        h1 {
          color: #333;
          margin-bottom: 10px;
          font-size: 32px;
        }
        .status {
          color: #667eea;
          font-size: 14px;
          margin-bottom: 30px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .dot {
          width: 12px;
          height: 12px;
          background: #10b981;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .links {
          display: grid;
          gap: 15px;
          margin-bottom: 30px;
        }
        a {
          display: flex;
          align-items: center;
          padding: 15px 20px;
          background: #f3f4f6;
          border-radius: 10px;
          text-decoration: none;
          color: #333;
          transition: all 0.3s ease;
          border-left: 4px solid #667eea;
        }
        a:hover {
          background: #667eea;
          color: white;
          transform: translateX(5px);
        }
        .icon {
          font-size: 24px;
          margin-right: 15px;
        }
        .info {
          background: #f0f4ff;
          border-radius: 10px;
          padding: 20px;
          margin-top: 30px;
          font-size: 14px;
          color: #555;
          line-height: 1.8;
        }
        code {
          background: #ddd;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: 'Courier New', monospace;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚀 WSS Servidor</h1>
        <div class="status">
          <div class="dot"></div>
          Servidor ativo e funcionando
        </div>
        
        <div class="links">
          <a href="/">
            <span class="icon">📊</span>
            <div>
              <div style="font-weight: 600;">Dashboard</div>
              <div style="font-size: 12px; opacity: 0.7;">Visualize dados em tempo real</div>
            </div>
          </a>
          
          <a href="/health">
            <span class="icon">💚</span>
            <div>
              <div style="font-weight: 600;">Health Check</div>
              <div style="font-size: 12px; opacity: 0.7;">Status do servidor</div>
            </div>
          </a>
        </div>
        
        <div class="info">
          <strong>📡 WebSocket URL:</strong><br>
          <code>wss://wss-lnz-production.up.railway.app/on</code>
          <br><br>
          <strong>✅ Recursos:</strong><br>
          ✓ Broadcast automático de dados<br>
          ✓ Histórico de até 500 mensagens<br>
          ✓ Identificação de dispositivos<br>
          ✓ Reconexão automática<br>
          ✓ Dashboard em tempo real
        </div>
      </div>
    </body>
    </html>
    `;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(infoHtml);
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 - Página não encontrada');
});

// Criar servidor WebSocket na rota /on
const wss = new WebSocket.Server({ server, path: '/on' });

// Configuração do WebSocket
wss.on('connection', (ws, req) => {
  const clientId = gerarClientId();
  const clientDevice = detectarDispositivo(req.headers['user-agent']);
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const connectionTime = new Date().toISOString();

  // Armazenar cliente
  clients.set(clientId, {
    ws,
    device: clientDevice,
    ip: clientIp,
    connectedAt: connectionTime
  });

  console.log(`\n✅ Cliente Conectado`);
  console.log(`   ID: ${clientId}`);
  console.log(`   Device: ${clientDevice}`);
  console.log(`   IP: ${clientIp}`);
  console.log(`   Hora: ${connectionTime}`);
  console.log(`   Total de clientes: ${clients.size}`);

  // Enviar mensagem de boas-vindas
  const welcomeMessage = {
    type: 'welcome',
    clientId: clientId,
    clientDevice: clientDevice,
    timestamp: new Date().toISOString(),
    message: `Bem-vindo ao WSS! Seu ID: ${clientId}`,
    stats: {
      totalClients: clients.size,
      totalData: totalDataReceived,
      dataStored: dadosRecebidos.length
    },
    history: dadosRecebidos.slice(-20) // Últimos 20 dados
  };

  ws.send(JSON.stringify(welcomeMessage));

  // Notificar outros clientes sobre a nova conexão
  broadcastMessage({
    type: 'client_connected',
    clientId: clientId,
    clientDevice: clientDevice,
    timestamp: new Date().toISOString(),
    stats: {
      totalClients: clients.size,
      totalData: totalDataReceived
    }
  });

  // Heartbeat
  let heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30000);

  // Processar mensagens recebidas
  ws.on('message', (message) => {
    try {
      let dados;
      
      // Tentar fazer parse de JSON
      try {
        dados = JSON.parse(message);
      } catch {
        // Se não for JSON válido, criar objeto com texto puro
        dados = {
          type: 'text',
          content: message.toString()
        };
      }

      // Adicionar metadados
      const messageData = {
        ...dados,
        clientId: clientId,
        clientDevice: clientDevice,
        timestamp: new Date().toISOString()
      };

      // Armazenar no histórico
      dadosRecebidos.push(messageData);
      if (dadosRecebidos.length > MAX_DADOS_ARMAZENADOS) {
        dadosRecebidos.shift();
      }

      totalDataReceived++;

      console.log(`\n📨 Dados Recebidos`);
      console.log(`   De: ${clientId} (${clientDevice})`);
      console.log(`   Tipo: ${dados.type || 'generic'}`);
      console.log(`   Conteúdo: ${JSON.stringify(dados).substring(0, 100)}...`);
      console.log(`   Total armazenado: ${dadosRecebidos.length}/${MAX_DADOS_ARMAZENADOS}`);

      // Broadcast para todos os clientes
      broadcastMessage({
        type: 'new_data',
        data: messageData,
        stats: {
          totalClients: clients.size,
          totalData: totalDataReceived
        }
      });

    } catch (error) {
      console.error(`❌ Erro ao processar mensagem: ${error.message}`);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Erro ao processar mensagem',
        error: error.message
      }));
    }
  });

  // Tratar desconexão
  ws.on('close', () => {
    clearInterval(heartbeatInterval);
    clients.delete(clientId);

    console.log(`\n❌ Cliente Desconectado`);
    console.log(`   ID: ${clientId}`);
    console.log(`   Device: ${clientDevice}`);
    console.log(`   Total de clientes: ${clients.size}`);

    broadcastMessage({
      type: 'client_disconnected',
      clientId: clientId,
      clientDevice: clientDevice,
      timestamp: new Date().toISOString(),
      stats: {
        totalClients: clients.size,
        totalData: totalDataReceived
      }
    });
  });

  // Tratar erros
  ws.on('error', (error) => {
    console.error(`⚠️  Erro no WebSocket (${clientId}): ${error.message}`);
  });

  // Responder a pings (heartbeat)
  ws.on('ping', () => {
    ws.pong();
  });
});

// Função para fazer broadcast
function broadcastMessage(message) {
  const messageString = JSON.stringify(message);
  
  clients.forEach((clientData, clientId) => {
    if (clientData.ws.readyState === WebSocket.OPEN) {
      clientData.ws.send(messageString);
    }
  });
}

// Iniciar servidor
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 WSS SERVER INICIADO COM SUCESSO');
  console.log('='.repeat(60));
  console.log(`\n📍 Porta: ${PORT}`);
  console.log(`🌐 URL HTTP: http://0.0.0.0:${PORT}`);
  console.log(`📡 WebSocket URL: wss://wss-lnz-production.up.railway.app/on`);
  console.log(`\n📊 Links disponíveis:`);
  console.log(`   - Dashboard: https://wss-lnz-production.up.railway.app/`);
  console.log(`   - Info: https://wss-lnz-production.up.railway.app/info`);
  console.log(`   - Health: https://wss-lnz-production.up.railway.app/health`);
  console.log('\n' + '='.repeat(60) + '\n');
});

// Tratamento de sinais de encerramento
process.on('SIGINT', () => {
  console.log('\n\n⛔ Encerrando servidor...');
  wss.clients.forEach((client) => {
    client.close();
  });
  server.close();
  process.exit(0);
});
