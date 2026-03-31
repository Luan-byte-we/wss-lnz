# WSS Server — wss://ws-LNZ.online/on

> **Este servidor CRIA e HOSPEDA a WSS.**  
> Quando o servidor está rodando → a WSS `wss://ws-LNZ.online/on` está ONLINE.  
> Bots se conectam nela. O painel web gerencia tudo.

---

## 📐 Arquitetura

```
┌─────────────────────────────────────────────┐
│              SEU SERVIDOR (Node.js)          │
│                                              │
│   server.js   ←  cria e hospeda a WSS       │
│                                              │
│   /on   ←  bots se conectam aqui            │
│   /ws   ←  painel web se conecta aqui       │
│   /     ←  serve o painel HTML              │
└───────────┬─────────────────────────────────┘
            │
            │  wss://ws-LNZ.online/on
            │
    ┌───────┼────────┐
    ↓       ↓        ↓
[Python] [Lua] [Discord Bot]  ← bots enviam dados
```

---

## 📁 Estrutura de arquivos

```
wss-panel/
├── server.js          ← O servidor (WSS + API REST + painel)
├── package.json       ← Dependências npm
├── data/
│   ├── config.json    ← Gerado automaticamente
│   ├── brainrots.json ← Dados salvos automaticamente
│   └── backups/       ← Backups automáticos (1h)
└── public/
    └── index.html     ← Painel de controle web
```

---

## 🚀 Deploy no Render.com (Grátis)

### 1. Preparar o repositório GitHub

Suba os arquivos mantendo a estrutura:
```
server.js
package.json
public/
  index.html
```

> **Não precisa subir** `data/` — é criado automaticamente.

### 2. Criar Web Service no Render

1. Acesse [render.com](https://render.com) → **New +** → **Web Service**
2. Conecte seu GitHub e selecione o repositório
3. Configure:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free

### 3. Variáveis de Ambiente

Na aba **Environment** do Render, adicione:

| Variável | Valor |
|----------|-------|
| `PORT` | `10000` *(Render usa 10000 por padrão)* |
| `ADMIN_TOKEN` | `coloque_um_token_forte_aqui` |

### 4. Domínio personalizado (para ter wss://ws-LNZ.online/on)

1. Você precisa ser dono do domínio `ws-LNZ.online`
2. No Render: **Settings → Custom Domains → Add**
3. No seu DNS: adicione um registro CNAME apontando para o Render
4. Aguarde a propagação (~5 min)

**Sem domínio próprio**, funciona igual com a URL do Render:  
`wss://seu-projeto.onrender.com/on`

---

## 💻 Rodar localmente

```bash
# 1. Instalar dependências
npm install

# 2. Rodar
npm start

# Painel:    http://localhost:3000
# WSS bots:  ws://localhost:3000/on
```

---

## 🤖 Como bots se conectam

Os bots conectam diretamente em `wss://ws-LNZ.online/on`.

**Python:**
```python
import websocket, json

def on_open(ws):
    ws.send(json.dumps({"bot": "python", "dados": "brainrot"}))

ws = websocket.WebSocketApp("wss://ws-LNZ.online/on", on_open=on_open)
ws.run_forever()
```

**Node.js:**
```js
const ws = new (require('ws'))('wss://ws-LNZ.online/on')
ws.on('open', () => ws.send(JSON.stringify({ bot: 'nodejs', dados: 'brainrot' })))
ws.on('message', d => console.log(JSON.parse(d)))
```

**Resposta ao conectar:**
```json
{
  "event": "connected",
  "botId": "A1B2C3D4E5",
  "wss": "wss://ws-LNZ.online/on",
  "msg": "Conectado! Envie dados e eles aparecem no painel."
}
```

**ACK após enviar dados:**
```json
{
  "event": "received",
  "botId": "A1B2C3D4E5",
  "msgCount": 1,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

## 🔌 API REST

Todas as rotas admin exigem o header: `x-admin-token: seu_token`

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/status` | Status público (sem token) |
| GET | `/api/stats` | Estatísticas completas |
| GET | `/api/events` | Log de eventos |
| GET | `/api/brainrots` | Dados recebidos (paginado) |
| POST | `/api/wss/enable` | Habilita a WSS |
| POST | `/api/wss/disable` | Desabilita e desconecta bots |
| POST | `/api/maintenance/on` | Ativa manutenção |
| POST | `/api/maintenance/off` | Desativa manutenção |
| POST | `/api/backup/auto/on` | Ativa auto-backup |
| POST | `/api/backup/auto/off` | Desativa auto-backup |
| POST | `/api/backup/now` | Backup manual |
| POST | `/api/bots/kick-all` | Desconecta todos os bots |
| POST | `/api/bots/kick/:id` | Desconecta um bot específico |
| DELETE | `/api/brainrots` | Deleta todos os brainrots |
| POST | `/api/security/regen-key` | Regenera chave de criptografia |
| GET | `/api/security/key` | Ver chave atual |
| GET | `/api/security/token` | Ver token admin |

---

## ⚙️ Funcionalidades

- ✅ **WSS fica online** quando o servidor inicia
- ✅ Bots se conectam em `/on` e recebem confirmação
- ✅ Painel web em tempo real via WebSocket (`/ws`)
- ✅ Heartbeat (ping/pong 30s) — detecta bots zumbis
- ✅ Dados salvos automaticamente a cada 10 msgs
- ✅ Backup automático a cada 1 hora
- ✅ Reset de contador diário à meia-noite
- ✅ Kick individual ou em massa de bots
- ✅ Modo manutenção (rejeita novas conexões)
- ✅ Regeneração de chave de criptografia
- ✅ Rate limiting na API (200 req/min)
- ✅ Polling fallback se WebSocket do painel cair

---

## 🔒 Segurança

- Troque `ADMIN_TOKEN` por algo forte (ex: `openssl rand -hex 32`)
- Os arquivos `data/config.json` e `data/brainrots.json` são criados automaticamente
- Adicione `.gitignore`:

```
node_modules/
data/
```
