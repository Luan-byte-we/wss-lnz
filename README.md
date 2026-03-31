# 🚀 WSS Brainrot Collector para Railway

## Deploy no Railway (SUPER FÁCIL)

### Passo 1: Criar conta no Railway
1. Acesse [https://railway.com](https://railway.com)
2. Faça login com GitHub (grátis, ganha $5 de crédito)

### Passo 2: Fazer deploy
1. Clique em **"New Project"**
2. Escolha **"Deploy from GitHub repo"**
3. Selecione seu repositório com esses arquivos
4. Railway detecta automaticamente que é Node.js
5. **Pronto!** O deploy é automático

### Passo 3: Acessar sua WSS
- URL do site: `https://SEU-NOME.railway.app`
- WebSocket: `wss://SEU-NOME.railway.app/on`
- Token admin: `admin123`

## 📡 Testar WebSocket

### JavaScript (Navegador)
```javascript
const ws = new WebSocket('wss://SEU-NOME.railway.app/on');
ws.onopen = () => ws.send(JSON.stringify({teste: "funcionou!"}));
ws.onmessage = (e) => console.log(e.data);
