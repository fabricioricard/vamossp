const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const multer = require('multer');

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

function seedData() {
  const newsCount = db.prepare('SELECT COUNT(*) as c FROM news').get().c;
  if (newsCount > 0) return;

  const newsItems = [
    { title: 'São Paulo vence clássico e assume a liderança do Brasileirão', summary: 'Tricolor domina o Palmeiras no Morumbi e conquista vitória por 3x1 com grande atuação coletiva.', body: 'Em noite inspirada no MorumBIS, o São Paulo FC venceu o Palmeiras por 3 a 1 em clássico válido pela 12ª rodada do Brasileirão 2026. Os gols foram marcados por Lucas Moura, Calleri e Luciano. O Tricolor agora lidera a competição com 28 pontos.\n\nO técnico elogiou a entrega dos jogadores e a força da torcida que lotou o estádio. "Esse é o São Paulo que a torcida merece. Jogamos com raça e qualidade", disse em coletiva.\n\nCom o resultado, o time paulista abre três pontos de vantagem sobre o segundo colocado e se consolida como forte candidato ao título.', image: '', category: 'campeonato' },
    { title: 'Cotia revela mais uma joia: meio-campista de 17 anos impressiona', summary: 'Jovem promessa das categorias de base ganha chance no time profissional e mostra qualidade técnica acima da média.', body: 'O Centro de Formação de Atletas de Cotia voltou a mostrar sua força. O meio-campista de apenas 17 anos ganhou sua primeira oportunidade no time profissional durante o treino desta semana e chamou atenção de toda a comissão técnica.\n\nCom passes precisos e visão de jogo diferenciada, o jovem é comparado aos grandes meias revelados pelo Tricolor ao longo de sua história. A expectativa é que ele seja relacionado para o próximo jogo.', image: '', category: 'base' },
    { title: 'São Paulo anuncia novo patrocinador máster para a temporada', summary: 'Acordo comercial é o maior da história do clube e reforça o projeto de modernização institucional.', body: 'O São Paulo Futebol Clube anunciou nesta quinta-feira o novo patrocinador máster para a temporada 2026. O contrato, válido por três anos, é considerado o maior da história do clube em termos de valores.\n\nA diretoria destacou que os recursos serão investidos em infraestrutura, contratações e no programa de categorias de base. "É um marco para o São Paulo. Estamos construindo um clube cada vez mais forte dentro e fora de campo", afirmou o presidente.', image: '', category: 'institucional' },
    { title: 'Calleri atinge marca histórica: 100 gols com a camisa tricolor', summary: 'Artilheiro argentino se consolida como um dos maiores goleadores estrangeiros da história do clube.', body: 'Jonathan Calleri atingiu a marca de 100 gols com a camisa do São Paulo FC. O centésimo gol veio justamente no clássico contra o Palmeiras, em jogada individual que consagrou a vitória tricolor.\n\n"Este clube me deu tudo. Chegar aos 100 gols é um sonho realizado. Quero muitos mais", declarou o argentino emocionado após a partida. Calleri se torna o terceiro estrangeiro com mais gols na história do São Paulo.', image: '', category: 'campeonato' },
    { title: 'MorumBIS recebe modernização com novo setor premium', summary: 'Estádio ganha área VIP com vista privilegiada e serviços exclusivos para torcedores.', body: 'O estádio MorumBIS passa por mais uma etapa de modernização. O novo setor premium, com capacidade para 2.000 pessoas, oferecerá vista privilegiada do campo, serviço de buffet e estacionamento exclusivo.\n\nA inauguração está prevista para o próximo mês, a tempo do confronto pela Copa do Brasil. O projeto faz parte do plano de valorização do patrimônio do clube e aumento de receitas em dias de jogo.', image: '', category: 'institucional' },
    { title: 'Tricolor goleia na Libertadores e avança às quartas de final', summary: 'São Paulo vence time colombiano por 4x0 e carimba classificação com rodada de antecedência.', body: 'O São Paulo FC não tomou conhecimento do adversário colombiano e goleou por 4 a 0 no MorumBIS, garantindo a classificação antecipada para as quartas de final da Libertadores 2026.\n\nCom gols de Lucas Moura (2), Luciano e um golaço de falta de Rodrigo Nestor, o Tricolor mostrou um futebol envolvente e eficiente. A torcida fez a festa nas arquibancadas e o time responde dentro de campo.', image: '', category: 'libertadores' }
  ];
  const insertNews = db.prepare('INSERT INTO news (title, summary, body, image, category) VALUES (?, ?, ?, ?, ?)');
  newsItems.forEach(n => insertNews.run(n.title, n.summary, n.body, n.image, n.category));

  const matchItems = [
    { opponent: 'Corinthians', match_date: '2026-06-08', match_time: '16:00', stadium: 'MorumBIS', competition: 'Brasileirão', is_home: 1 },
    { opponent: 'Flamengo', match_date: '2026-06-15', match_time: '18:30', stadium: 'Maracanã', competition: 'Brasileirão', is_home: 0 },
    { opponent: 'Atlético-MG', match_date: '2026-06-22', match_time: '19:00', stadium: 'MorumBIS', competition: 'Copa do Brasil', is_home: 1 },
    { opponent: 'Racing', match_date: '2026-06-29', match_time: '21:30', stadium: 'MorumBIS', competition: 'Libertadores', is_home: 1 },
    { opponent: 'Grêmio', match_date: '2026-07-06', match_time: '16:00', stadium: 'Arena do Grêmio', competition: 'Brasileirão', is_home: 0 },
    { opponent: 'Santos', match_date: '2026-07-13', match_time: '18:30', stadium: 'MorumBIS', competition: 'Brasileirão', is_home: 1 }
  ];
  const insertMatch = db.prepare('INSERT INTO matches (opponent, match_date, match_time, stadium, competition, is_home) VALUES (?, ?, ?, ?, ?, ?)');
  matchItems.forEach(m => insertMatch.run(m.opponent, m.match_date, m.match_time, m.stadium, m.competition, m.is_home));

  const standingsData = [
    { position: 1, team: 'São Paulo', points: 28, played: 12, won: 8, drawn: 4, lost: 0, gf: 22, ga: 8 },
    { position: 2, team: 'Flamengo', points: 25, played: 12, won: 7, drawn: 4, lost: 1, gf: 20, ga: 10 },
    { position: 3, team: 'Palmeiras', points: 24, played: 12, won: 7, drawn: 3, lost: 2, gf: 19, ga: 11 },
    { position: 4, team: 'Botafogo', points: 22, played: 12, won: 6, drawn: 4, lost: 2, gf: 17, ga: 9 },
    { position: 5, team: 'Atlético-MG', points: 21, played: 12, won: 6, drawn: 3, lost: 3, gf: 18, ga: 14 },
    { position: 6, team: 'Internacional', points: 20, played: 12, won: 5, drawn: 5, lost: 2, gf: 15, ga: 10 },
    { position: 7, team: 'Fortaleza', points: 19, played: 12, won: 5, drawn: 4, lost: 3, gf: 14, ga: 11 },
    { position: 8, team: 'Cruzeiro', points: 18, played: 12, won: 5, drawn: 3, lost: 4, gf: 16, ga: 15 },
    { position: 9, team: 'Grêmio', points: 17, played: 12, won: 4, drawn: 5, lost: 3, gf: 13, ga: 12 },
    { position: 10, team: 'Bahia', points: 16, played: 12, won: 4, drawn: 4, lost: 4, gf: 14, ga: 14 },
    { position: 11, team: 'Corinthians', points: 15, played: 12, won: 4, drawn: 3, lost: 5, gf: 12, ga: 13 },
    { position: 12, team: 'Fluminense', points: 14, played: 12, won: 3, drawn: 5, lost: 4, gf: 11, ga: 12 },
    { position: 13, team: 'Santos', points: 13, played: 12, won: 3, drawn: 4, lost: 5, gf: 10, ga: 14 },
    { position: 14, team: 'Vasco', points: 12, played: 12, won: 3, drawn: 3, lost: 6, gf: 11, ga: 16 },
    { position: 15, team: 'Athletico-PR', points: 11, played: 12, won: 2, drawn: 5, lost: 5, gf: 9, ga: 13 },
    { position: 16, team: 'Bragantino', points: 10, played: 12, won: 2, drawn: 4, lost: 6, gf: 10, ga: 17 },
    { position: 17, team: 'Juventude', points: 9, played: 12, won: 2, drawn: 3, lost: 7, gf: 8, ga: 18 },
    { position: 18, team: 'Vitória', points: 8, played: 12, won: 1, drawn: 5, lost: 6, gf: 9, ga: 19 },
    { position: 19, team: 'Cuiabá', points: 7, played: 12, won: 1, drawn: 4, lost: 7, gf: 7, ga: 20 },
    { position: 20, team: 'Goiás', points: 5, played: 12, won: 1, drawn: 2, lost: 9, gf: 6, ga: 22 }
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
