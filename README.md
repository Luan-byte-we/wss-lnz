# Brainrot Server - WebSocket Universal

Um servidor WebSocket robusto que aceita QUALQUER formato de dados (JSON, texto, números, XML, HTML) e fornece um painel de controle em tempo real.

## 🚀 Deploy no Railway

1. **Faça fork deste repositório ou crie um novo no GitHub**

2. **No Railway.app:**
   - Clique em "New Project"
   - Selecione "Deploy from GitHub repo"
   - Escolha seu repositório
   - Railway irá automaticamente detectar o Node.js e fazer o deploy

3. **Configuração automática:**
   - A Railway irá definir a variável `PORT` automaticamente
   - O servidor estará disponível em `https://seu-projeto.up.railway.app`
   - WebSocket em `wss://seu-projeto.up.railway.app/ws`

## 🔧 Teste Localmente

```bash
# Clone o repositório
git clone seu-repositorio
cd seu-repositorio

# Instale as dependências
npm install

# Inicie o servidor
npm start

# Para desenvolvimento com auto-reload
npm run dev
