const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const DataService = require('./lib/dataService');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
const sessionMiddleware = session({
  secret: 'spfc-tricolor-digital-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// --- Database Setup ---
const db = new Database(path.join(__dirname, 'tricolor.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
initDatabase();

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      image TEXT DEFAULT '',
      category TEXT DEFAULT 'geral',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (news_id) REFERENCES news(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opponent TEXT NOT NULL,
      match_date TEXT NOT NULL,
      match_time TEXT NOT NULL,
      stadium TEXT NOT NULL,
      competition TEXT NOT NULL,
      is_home INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS standings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER NOT NULL,
      team TEXT NOT NULL,
      points INTEGER DEFAULT 0,
      played INTEGER DEFAULT 0,
      won INTEGER DEFAULT 0,
      drawn INTEGER DEFAULT 0,
      lost INTEGER DEFAULT 0,
      gf INTEGER DEFAULT 0,
      ga INTEGER DEFAULT 0
    );
  `);
  seedData();
}

// --- Data Service (auto-refresh) ---
const dataService = new DataService(db);
// Atualiza automaticamente a cada 2 horas
dataService.startAutoRefresh(2 * 60 * 60 * 1000);

function seedData() {
  const newsCount = db.prepare('SELECT COUNT(*) as c FROM news').get().c;
  if (newsCount > 0) return;

  const newsItems = [
    { title: 'Trava a negociação entre São Paulo e Victor Sá; entenda', summary: 'Diferença salarial emperrou a transação nesta terça-feira.', body: 'A negociação entre São Paulo FC e o jogador Victor Sá foi interrompida devido a discrepâncias salariais. O clube avalia outras opções no mercado para reforçar o elenco para a sequência da temporada.', image: '', category: 'campeonato' },
    { title: 'Santos demonstra interesse em contratar Arboleda', summary: 'Zagueiro está afastado depois de viajar ao Equador sem autorização.', body: 'O Santos tem interesse em contratar o zagueiro Arboleda do São Paulo FC, que atualmente está afastado do grupo principal. A diretoria tricolor avalia propostas para o defensor.', image: '', category: 'campeonato' },
    { title: 'São Paulo reitera estratégia de mercado em negociações', summary: 'Clube discute permanência de nomes importantes do elenco.', body: 'O São Paulo FC reforçou sua estratégia de mercado ao discutir a permanência de jogadores chave. A diretoria trabalha para manter a base do elenco que tem apresentado bom desempenho no Brasileirão.', image: '', category: 'institucional' },
    { title: 'Cotia revela mais uma joia: meio-campista de 17 anos impressiona', summary: 'Jovem promessa das categorias de base ganha chance no time profissional e mostra qualidade técnica acima da média.', body: 'O Centro de Formação de Atletas de Cotia voltou a mostrar sua força. O meio-campista de apenas 17 anos ganhou sua primeira oportunidade no time profissional durante o treino desta semana e chamou atenção de toda a comissão técnica.', image: '', category: 'base' },
    { title: 'Tricolor busca reabilitação no Brasileirão', summary: 'São Paulo foca na recuperação para subir na tabela de classificação.', body: 'Após resultados irregulares, o São Paulo FC trabalha intensamente nos treinos para recuperar a confiança e escalar posições na tabela do Campeonato Brasileiro. O apoio da torcida no MorumBIS será fundamental.', image: '', category: 'campeonato' },
    { title: 'MorumBIS recebe modernização com novo setor premium', summary: 'Estádio ganha área VIP com vista privilegiada e serviços exclusivos para torcedores.', body: 'O estádio MorumBIS passa por mais uma etapa de modernização. O novo setor premium oferecerá vista privilegiada do campo, serviço de buffet e estacionamento exclusivo, fazendo parte do plano de valorização do patrimônio do clube.', image: '', category: 'institucional' }
  ];
  const insertNews = db.prepare('INSERT INTO news (title, summary, body, image, category) VALUES (?, ?, ?, ?, ?)');
  newsItems.forEach(n => insertNews.run(n.title, n.summary, n.body, n.image, n.category));

  const matchItems = [
    { opponent: 'Athletico-PR', match_date: '2026-07-12', match_time: '16:00', stadium: 'MorumBIS', competition: 'Brasileirão', is_home: 1 },
    { opponent: 'Flamengo', match_date: '2026-07-19', match_time: '18:30', stadium: 'Maracanã', competition: 'Brasileirão', is_home: 0 },
    { opponent: 'Santos', match_date: '2026-07-26', match_time: '19:00', stadium: 'MorumBIS', competition: 'Brasileirão', is_home: 1 },
    { opponent: 'Palmeiras', match_date: '2026-08-02', match_time: '16:00', stadium: 'MorumBIS', competition: 'Brasileirão', is_home: 1 },
    { opponent: 'Grêmio', match_date: '2026-08-09', match_time: '18:30', stadium: 'Arena do Grêmio', competition: 'Brasileirão', is_home: 0 },
    { opponent: 'Juventude', match_date: '2026-08-16', match_time: '16:00', stadium: 'MorumBIS', competition: 'Brasileirão', is_home: 1 }
  ];
  const insertMatch = db.prepare('INSERT INTO matches (opponent, match_date, match_time, stadium, competition, is_home) VALUES (?, ?, ?, ?, ?, ?)');
  matchItems.forEach(m => insertMatch.run(m.opponent, m.match_date, m.match_time, m.stadium, m.competition, m.is_home));

  const standingsData = [
    { position: 1, team: 'Palmeiras', points: 41, played: 18, won: 12, drawn: 5, lost: 1, gf: 30, ga: 13 },
    { position: 2, team: 'Flamengo', points: 34, played: 17, won: 10, drawn: 4, lost: 3, gf: 31, ga: 16 },
    { position: 3, team: 'Fluminense', points: 31, played: 18, won: 9, drawn: 4, lost: 5, gf: 28, ga: 23 },
    { position: 4, team: 'Athletico-PR', points: 30, played: 18, won: 9, drawn: 3, lost: 6, gf: 24, ga: 18 },
    { position: 5, team: 'Bragantino', points: 29, played: 18, won: 9, drawn: 2, lost: 7, gf: 25, ga: 19 },
    { position: 6, team: 'Bahia', points: 26, played: 17, won: 7, drawn: 5, lost: 5, gf: 25, ga: 23 },
    { position: 7, team: 'Coritiba', points: 26, played: 18, won: 7, drawn: 5, lost: 6, gf: 24, ga: 24 },
    { position: 8, team: 'São Paulo', points: 25, played: 18, won: 7, drawn: 4, lost: 7, gf: 23, ga: 20 },
    { position: 9, team: 'Atlético-MG', points: 24, played: 18, won: 7, drawn: 3, lost: 8, gf: 22, ga: 23 },
    { position: 10, team: 'Corinthians', points: 24, played: 18, won: 6, drawn: 6, lost: 6, gf: 18, ga: 19 },
    { position: 11, team: 'Internacional', points: 23, played: 18, won: 6, drawn: 5, lost: 7, gf: 20, ga: 21 },
    { position: 12, team: 'Cruzeiro', points: 22, played: 18, won: 6, drawn: 4, lost: 8, gf: 19, ga: 22 },
    { position: 13, team: 'Botafogo', points: 21, played: 18, won: 5, drawn: 6, lost: 7, gf: 18, ga: 20 },
    { position: 14, team: 'Grêmio', points: 20, played: 18, won: 5, drawn: 5, lost: 8, gf: 17, ga: 21 },
    { position: 15, team: 'Vitória', points: 19, played: 18, won: 5, drawn: 4, lost: 9, gf: 16, ga: 24 },
    { position: 16, team: 'Vasco', points: 18, played: 18, won: 4, drawn: 6, lost: 8, gf: 15, ga: 23 },
    { position: 17, team: 'Juventude', points: 17, played: 18, won: 4, drawn: 5, lost: 9, gf: 14, ga: 25 },
    { position: 18, team: 'Criciúma', points: 16, played: 18, won: 4, drawn: 4, lost: 10, gf: 13, ga: 26 },
    { position: 19, team: 'Cuiabá', points: 15, played: 18, won: 3, drawn: 6, lost: 9, gf: 12, ga: 24 },
    { position: 20, team: 'Atlético-GO', points: 10, played: 18, won: 2, drawn: 4, lost: 12, gf: 10, ga: 30 }
  ];
  const insertStanding = db.prepare('INSERT INTO standings (position, team, points, played, won, drawn, lost, gf, ga) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  standingsData.forEach(s => insertStanding.run(s.position, s.team, s.points, s.played, s.won, s.drawn, s.lost, s.gf, s.ga));
}

// --- Auth Helpers ---
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Faça login para continuar' });
  next();
}

// --- API Routes ---

// Auth
app.post('/api/register', (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Preencha todos os campos' });
    if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run(username, email, hash);
    req.session.userId = result.lastInsertRowid;
    req.session.username = username;
    res.json({ success: true, user: { id: result.lastInsertRowid, username, email } });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Usuário ou email já cadastrado' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Email ou senha incorretos' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ success: true, user: { id: user.id, username: user.username, email: user.email, bio: user.bio, avatar: user.avatar } });
  } catch (e) { res.status(500).json({ error: 'Erro interno do servidor' }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare('SELECT id, username, email, bio, avatar, created_at FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user: user || null });
});

app.put('/api/profile', requireAuth, (req, res) => {
  const { username, bio } = req.body;
  try {
    db.prepare('UPDATE users SET username = ?, bio = ? WHERE id = ?').run(username, bio, req.session.userId);
    req.session.username = username;
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Nome de usuário já existe' });
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }
});

// News
app.get('/api/news', (req, res) => {
  const news = db.prepare('SELECT * FROM news ORDER BY created_at DESC').all();
  res.json(news);
});

app.get('/api/news/:id', (req, res) => {
  const article = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
  if (!article) return res.status(404).json({ error: 'Notícia não encontrada' });
  res.json(article);
});

// Comments
app.get('/api/news/:id/comments', (req, res) => {
  const comments = db.prepare(`
    SELECT c.*, u.username, u.avatar FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.news_id = ? ORDER BY c.created_at DESC
  `).all(req.params.id);
  res.json(comments);
});

app.post('/api/news/:id/comments', requireAuth, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Comentário não pode ser vazio' });
  const result = db.prepare('INSERT INTO comments (news_id, user_id, content) VALUES (?, ?, ?)').run(req.params.id, req.session.userId, content.trim());
  const comment = db.prepare(`
    SELECT c.*, u.username, u.avatar FROM comments c
    JOIN users u ON c.user_id = u.id WHERE c.id = ?
  `).get(result.lastInsertRowid);
  res.json(comment);
});

// Matches
app.get('/api/matches', (req, res) => {
  const matches = db.prepare("SELECT * FROM matches WHERE match_date >= date('now') ORDER BY match_date ASC").all();
  res.json(matches);
});

// Standings
app.get('/api/standings', (req, res) => {
  const standings = db.prepare('SELECT * FROM standings ORDER BY position ASC').all();
  res.json(standings);
});

// Refresh data manually
app.post('/api/refresh', async (req, res) => {
  try {
    const result = await dataService.forceRefresh();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao atualizar dados: ' + e.message });
  }
});

// Data service status
app.get('/api/data-status', (req, res) => {
  res.json(dataService.getStatus());
});

// Chat history
app.get('/api/chat/history', (req, res) => {
  const messages = db.prepare(`
    SELECT cm.*, u.username, u.avatar FROM chat_messages cm
    JOIN users u ON cm.user_id = u.id
    ORDER BY cm.created_at DESC LIMIT 50
  `).all().reverse();
  res.json(messages);
});

// --- Socket.IO ---
io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (sess && sess.userId) {
    socket.join('chat');
    socket.on('chat_message', (msg) => {
      if (!msg || !msg.trim()) return;
      const clean = msg.trim().substring(0, 500);
      try {
        const result = db.prepare('INSERT INTO chat_messages (user_id, message) VALUES (?, ?)').run(sess.userId, clean);
        const saved = db.prepare(`
          SELECT cm.*, u.username, u.avatar FROM chat_messages cm
          JOIN users u ON cm.user_id = u.id WHERE cm.id = ?
        `).get(result.lastInsertRowid);
        io.to('chat').emit('chat_message', saved);
      } catch (e) { console.error('Chat error:', e); }
    });
  }
});

// --- Serve SPA ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Tricolor Digital rodando na porta ${PORT}`));
