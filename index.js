const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const DataService = require('./lib/dataService');
const fs = require('fs');

// --- Firebase Admin Setup ---
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-admin-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

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

const avatarUpload = multer({ 
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, 'public', 'avatars');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Apenas imagens são permitidas'));
    cb(null, true);
  }
});

const db = new Database(path.join(__dirname, 'tricolor.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
initDatabase();

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firebase_uid TEXT UNIQUE,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT DEFAULT 'firebase_auth',
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
    CREATE TABLE IF NOT EXISTS comment_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(comment_id, user_id)
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
dataService.startAutoRefresh(2 * 60 * 60 * 1000);

function seedData() {
  const newsCount = db.prepare('SELECT COUNT(*) as c FROM news').get().c;
  if (newsCount > 0) return;

  // Notícias institucionais: quando você escrever uma matéria própria, 
  // ela será adicionada manualmente ao banco com category='institucional'
  // e aparecerá automaticamente no topo das outras notícias.

  const matchItems = [
    { opponent: 'Athletico-PR', match_date: '2026-07-22', match_time: 'A confirmar', stadium: 'MorumBIS', competition: 'Brasileirão', is_home: 1 },
    { opponent: 'Flamengo', match_date: '2026-07-26', match_time: 'A confirmar', stadium: 'Maracanã', competition: 'Brasileirão', is_home: 0 },
    { opponent: 'Santos', match_date: '2026-07-29', match_time: 'A confirmar', stadium: 'MorumBIS', competition: 'Brasileirão', is_home: 1 },
    { opponent: 'Grêmio', match_date: '2026-08-09', match_time: 'A confirmar', stadium: 'Arena do Grêmio', competition: 'Brasileirão', is_home: 0 }
  ];
  const insertMatch = db.prepare('INSERT INTO matches (opponent, match_date, match_time, stadium, competition, is_home) VALUES (?, ?, ?, ?, ?, ?)');
  matchItems.forEach(m => insertMatch.run(m.opponent, m.match_date, m.match_time, m.stadium, m.competition, m.is_home));

  const standingsData = [
    { position: 1, team: 'Palmeiras', points: 41, played: 18, won: 12, drawn: 5, lost: 1, gf: 30, ga: 13 },
    { position: 2, team: 'Flamengo', points: 34, played: 17, won: 10, drawn: 4, lost: 3, gf: 31, ga: 16 },
    { position: 3, team: 'Fluminense', points: 31, played: 18, won: 9, drawn: 4, lost: 5, gf: 28, ga: 23 },
    { position: 4, team: 'Athletico Paranaense', points: 30, played: 18, won: 9, drawn: 3, lost: 6, gf: 24, ga: 18 },
    { position: 5, team: 'Red Bull Bragantino', points: 29, played: 18, won: 9, drawn: 2, lost: 7, gf: 25, ga: 19 },
    { position: 6, team: 'Bahia', points: 26, played: 17, won: 7, drawn: 5, lost: 5, gf: 25, ga: 23 },
    { position: 7, team: 'Coritiba', points: 26, played: 18, won: 7, drawn: 5, lost: 6, gf: 24, ga: 24 },
    { position: 8, team: 'São Paulo', points: 25, played: 18, won: 7, drawn: 4, lost: 7, gf: 23, ga: 20 },
    { position: 9, team: 'Atlético Mineiro', points: 24, played: 18, won: 7, drawn: 3, lost: 8, gf: 22, ga: 23 },
    { position: 10, team: 'Corinthians', points: 24, played: 18, won: 6, drawn: 6, lost: 6, gf: 18, ga: 19 },
    { position: 11, team: 'Cruzeiro', points: 24, played: 18, won: 6, drawn: 6, lost: 6, gf: 24, ga: 28 },
    { position: 12, team: 'Botafogo', points: 22, played: 17, won: 6, drawn: 4, lost: 7, gf: 31, ga: 31 },
    { position: 13, team: 'Vitória', points: 22, played: 17, won: 6, drawn: 4, lost: 7, gf: 21, ga: 25 },
    { position: 14, team: 'Internacional', points: 21, played: 18, won: 5, drawn: 6, lost: 7, gf: 21, ga: 22 },
    { position: 15, team: 'Santos', points: 21, played: 18, won: 5, drawn: 6, lost: 7, gf: 26, ga: 29 },
    { position: 16, team: 'Grêmio', points: 21, played: 18, won: 5, drawn: 6, lost: 7, gf: 20, ga: 23 },
    { position: 17, team: 'Vasco da Gama', points: 20, played: 18, won: 5, drawn: 5, lost: 8, gf: 22, ga: 29 },
    { position: 18, team: 'Remo', points: 18, played: 18, won: 4, drawn: 6, lost: 8, gf: 21, ga: 29 },
    { position: 19, team: 'Mirassol', points: 16, played: 17, won: 4, drawn: 4, lost: 9, gf: 18, ga: 24 },
    { position: 20, team: 'Chapecoense', points: 9, played: 17, won: 1, drawn: 6, lost: 10, gf: 17, ga: 33 }
  ];
  const insertStanding = db.prepare('INSERT INTO standings (position, team, points, played, won, drawn, lost, gf, ga) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  standingsData.forEach(s => insertStanding.run(s.position, s.team, s.points, s.played, s.won, s.drawn, s.lost, s.gf, s.ga));
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Faça login para continuar' });
  next();
}

// --- Nova Rota de Autenticação Firebase ---
app.post('/api/auth/sync', async (req, res) => {
  try {
    const { token, email, username } = req.body;
    const decodedToken = await admin.auth().verifyIdToken(token);
    const firebaseUid = decodedToken.uid;

    let user = db.prepare('SELECT * FROM users WHERE firebase_uid = ?').get(firebaseUid);

    if (!user) {
      const result = db.prepare(`
        INSERT INTO users (firebase_uid, username, email, password, bio, avatar, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(firebaseUid, username, email, 'firebase_auth', '', '');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    } else {
      db.prepare('UPDATE users SET email = ?, username = ? WHERE firebase_uid = ?').run(email, username, firebaseUid);
      user.username = username;
      user.email = email;
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    const { password, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  } catch (error) {
    console.error('Firebase Auth Error:', error);
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
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

app.post('/api/profile/avatar', requireAuth, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
  
  const avatarUrl = '/avatars/' + req.file.filename;
  
  try {
    // Remove o avatar antigo do disco, se existir
    const user = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.session.userId);
    if (user.avatar && user.avatar.startsWith('/avatars/')) {
      const oldPath = path.join(__dirname, 'public', user.avatar);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    // Atualiza o banco de dados
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, req.session.userId);
    res.json({ success: true, avatar: avatarUrl });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao salvar avatar' });
  }
});

app.get('/api/news', (req, res) => {
  const news = db.prepare('SELECT * FROM news ORDER BY created_at DESC').all();
  res.json(news);
});

app.get('/api/news/:id', (req, res) => {
  const article = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
  if (!article) return res.status(404).json({ error: 'Notícia não encontrada' });
  res.json(article);
});

app.get('/api/news/:id/comments', (req, res) => {
  const comments = db.prepare(`
    SELECT c.*, u.username, u.avatar,
      (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) as likes
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.news_id = ? 
    ORDER BY likes DESC, c.created_at DESC
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

// Deletar comentário (só o dono pode)
app.delete('/api/comments/:id', requireAuth, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'Comentário não encontrado' });
  if (comment.user_id !== req.session.userId) return res.status(403).json({ error: 'Você não pode deletar este comentário' });
  
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Curtir comentário
app.post('/api/comments/:id/like', requireAuth, (req, res) => {
  try {
    db.prepare('INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)').run(req.params.id, req.session.userId);
    const likes = db.prepare('SELECT COUNT(*) as count FROM comment_likes WHERE comment_id = ?').get(req.params.id);
    res.json({ success: true, likes: likes.count });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Você já curtiu este comentário' });
    }
    res.status(500).json({ error: 'Erro ao curtir comentário' });
  }
});

// Remover like
app.delete('/api/comments/:id/like', requireAuth, (req, res) => {
  db.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  const likes = db.prepare('SELECT COUNT(*) as count FROM comment_likes WHERE comment_id = ?').get(req.params.id);
  res.json({ success: true, likes: likes.count });
});

// Verificar se usuário curtiu comentários (para uma notícia específica)
app.get('/api/comments/:newsId/liked', requireAuth, (req, res) => {
  const liked = db.prepare(`
    SELECT comment_id FROM comment_likes 
    WHERE user_id = ? AND comment_id IN (SELECT id FROM comments WHERE news_id = ?)
  `).all(req.session.userId, req.params.newsId).map(row => row.comment_id);
  res.json({ liked });
});

app.get('/api/matches', (req, res) => {
  const matches = db.prepare("SELECT * FROM matches WHERE match_date >= date('now') ORDER BY match_date ASC").all();
  res.json(matches);
});

app.get('/api/standings', (req, res) => {
  const standings = db.prepare('SELECT * FROM standings ORDER BY position ASC').all();
  res.json(standings);
});

app.post('/api/refresh', async (req, res) => {
  try {
    const result = await dataService.forceRefresh();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao atualizar dados: ' + e.message });
  }
});

app.get('/api/data-status', (req, res) => {
  res.json(dataService.getStatus());
});

app.get('/api/chat/history', (req, res) => {
  const messages = db.prepare(`
    SELECT cm.*, u.username, u.avatar FROM chat_messages cm
    JOIN users u ON cm.user_id = u.id
    ORDER BY cm.created_at DESC LIMIT 50
  `).all().reverse();
  res.json(messages);
});

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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Tricolor Digital rodando na porta ${PORT}`));