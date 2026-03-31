# 🚀 WSS Brainrot Collector

Servidor WebSocket para coleta de brainrots com painel de controle em tempo real.

## 📋 Funcionalidades

- ✅ WebSocket real na rota `/on` (`wss://ws-lnz.onrender.com/on`)
- ✅ Painel de controle com autenticação
- ✅ Recebimento e armazenamento de dados JSON
- ✅ Estatísticas em tempo real (uptime, brainrots, bots online)
- ✅ API REST completa
- ✅ Keep-alive automático (não dorme no Render)
- ✅ Exemplos de código para múltiplas linguagens

## 🚀 Deploy no Render

### 1. Faça o deploy do código

1. Crie um repositório no GitHub e envie todos os arquivos
2. Acesse [Render.com](https://render.com)
3. Clique em "New +" > "Web Service"
4. Conecte seu repositório GitHub
5. Configure:
   - **Name:** `ws-lnz` (ou o nome que preferir)
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
6. Clique em "Create Web Service"

### 2. Configure o domínio

O Render vai gerar automaticamente uma URL como:
- `https://ws-lnz.onrender.com` (site)
- `wss://ws-lnz.onrender.com/on` (WebSocket)

### 3. Acesse o painel

- URL do site: `https://ws-lnz.onrender.com`
- Token de acesso: `admin123`

## 🔧 Teste Localmente

```bash
# Clone o repositório
git clone seu-repositorio

# Entre na pasta
cd wss-brainrot-collector

# Instale as dependências
npm install

# Inicie o servidor
npm start

# Acesse no navegador
http://localhost:3000
