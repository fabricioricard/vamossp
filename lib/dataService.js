const axios = require('axios');
const cheerio = require('cheerio');

class DataService {
  constructor(db) {
    this.db = db;
    this.isRefreshing = false;
    this.lastRefresh = null;
    this.refreshInterval = null;

    this.CACHE_MATCHES   = 2  * 60 * 60 * 1000;
    this.CACHE_STANDINGS = 6  * 60 * 60 * 1000;
    this.CACHE_NEWS      = 24 * 60 * 60 * 1000;

    this.cacheTimestamps = { matches: 0, standings: 0, news: 0 };
  }

  startAutoRefresh(intervalMs = 2 * 60 * 60 * 1000) {
    this.refreshAll().catch(err => console.error('[DataService] Erro no refresh inicial:', err.message));
    this.refreshInterval = setInterval(() => {
      this.refreshAll().catch(err => console.error('[DataService] Erro no refresh periódico:', err.message));
    }, intervalMs);
    console.log('[DataService] Auto-refresh ativado (intervalo: %d min)', intervalMs / 60000);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  async refreshAll() {
    if (this.isRefreshing) return { success: true, skipped: true };
    this.isRefreshing = true;
    console.log('[DataService] Iniciando atualização...');

    try {
      await this.refreshMatches();
      await this.refreshStandings();
      await this.refreshNews();
    } catch (err) {
      console.error('[DataService] Erro na atualização:', err.message);
    }

    this.isRefreshing = false;
    this.lastRefresh = new Date().toISOString();
    console.log('[DataService] Atualização concluída em', this.lastRefresh);
    return { success: true, timestamp: this.lastRefresh };
  }

  async forceRefresh() {
    Object.keys(this.cacheTimestamps).forEach(k => { this.cacheTimestamps[k] = 0; });
    return this.refreshAll();
  }

  async refreshMatches() {
    if (this._cacheValid('matches')) return { cached: true };
    console.log('[DataService] Buscando jogos via ESPN API...');

    // Helper: format Date as YYYYMMDD for ESPN scoreboard API
    const fmtDate = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}${m}${dd}`;
    };

    // Helper: save events to DB
    const saveEvents = (events, label) => {
      this.db.prepare('DELETE FROM matches').run();
      const insert = this.db.prepare(`INSERT INTO matches (opponent, match_date, match_time, stadium, competition, is_home) VALUES (?, ?, ?, ?, ?, ?)`);
      
      // Mapeamento de nomes de estádios para versões informais (case-insensitive)
      const normalizeName = (name) => {
        if (!name) return '';
        const lower = name.toLowerCase();
        if (lower.includes('cícero pompeu') || lower.includes('cicero pompeu') || lower.includes('morumbi')) return 'MorumBIS';
        if (lower.includes('maracanã') || lower.includes('maracana')) return 'Maracanã';
        if (lower.includes('allianz parque')) return 'Allianz Parque';
        if (lower.includes('neo química') || lower.includes('neo quimica') || lower.includes('arena corinthians')) return 'Neo Química Arena';
        if (lower.includes('beira-rio') || lower.includes('beira rio')) return 'Beira-Rio';
        if (lower.includes('mineirão') || lower.includes('mineirao')) return 'Mineirão';
        if (lower.includes('mané garrincha') || lower.includes('mane garrincha')) return 'Mané Garrincha';
        if (lower.includes('arena da baixada')) return 'Arena da Baixada';
        if (lower.includes('castelão') || lower.includes('castelao')) return 'Castelão';
        if (lower.includes('barradão') || lower.includes('barradao')) return 'Barradão';
        if (lower.includes('serrinha')) return 'Serrinha';
        if (lower.includes('arena condá') || lower.includes('arena conda')) return 'Arena Condá';
        if (lower.includes('herculano')) return 'Herculano';
        if (lower.includes('mangueirão') || lower.includes('mangueirao')) return 'Mangueirão';
        if (lower.includes('kleber andrade')) return 'Kleber Andrade';
        if (lower.includes('coaracy')) return 'Coaracy da Mata';
        if (lower.includes('alfredo jaconi')) return 'Alfredo Jaconi';
        if (lower.includes('santa cruz')) return 'Santa Cruz';
        return name; // Retorna o nome original se não estiver no mapeamento
      };
      
      events.forEach(event => {
        const comp = event.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');
        if (!home || !away) return;
        const isHome = home.team.id === '2026';
        const opponent = isHome ? away.team.displayName : home.team.displayName;
        
        // Converte UTC para horário de Brasília (UTC-3)
        const utcDate = new Date(event.date);
        const brasiliaDate = new Date(utcDate.getTime() - 3 * 60 * 60 * 1000);
        const matchDate = brasiliaDate.toISOString().split('T')[0];
        const matchTime = brasiliaDate.toISOString().split('T')[1].substring(0, 5);
        
        // Usa nome informal do estádio se disponível
        const originalStadium = comp.venue?.fullName || (isHome ? 'MorumBIS' : home.team.displayName);
        const stadium = normalizeName(originalStadium);
        
        insert.run(opponent, matchDate, matchTime, stadium, 'Brasileirão', isHome ? 1 : 0);
      });
      console.log('[DataService] %d jogos %s salvos', events.length, label);
    };

    try {
      // 1) Tenta scoreboard com range futuro (fonte principal de jogos futuros)
      const now = new Date();
      const futureEnd = new Date(now);
      futureEnd.setMonth(futureEnd.getMonth() + 3);
      const dateRange = `${fmtDate(now)}-${fmtDate(futureEnd)}`;

      const response = await axios.get(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard?dates=${dateRange}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }
      );
      const events = response.data.events || [];
      const spEvents = events
        .filter(e => (e.competitions || []).some(c =>
          (c.competitors || []).some(t => t.team && t.team.id === '2026')
        ))
        .filter(e => new Date(e.date) > now)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      if (spEvents.length > 0) {
        saveEvents(spEvents.slice(0, 8), 'futuros (scoreboard)');
        this.cacheTimestamps.matches = Date.now();
        return;
      }

      // 2) Fallback: /schedule para jogos recentes quando não há futuros
      console.log('[DataService] Sem jogos futuros no scoreboard, tentando schedule...');
      const scheduleRes = await axios.get(
        'https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/teams/2026/schedule',
        { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }
      );
      const pastEvents = (scheduleRes.data.events || [])
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 8);

      if (pastEvents.length > 0) {
        saveEvents(pastEvents, 'recentes (schedule fallback)');
      }
    } catch (err) {
      console.log('[DataService] Jogos da ESPN indisponíveis:', err.message);
    }
    this.cacheTimestamps.matches = Date.now();
  }

  async refreshStandings() {
    if (this._cacheValid('standings')) return { cached: true };
    console.log('[DataService] Buscando tabela via Wikipedia...');
    try {
      const years = [2026, 2025, 2024];
      let standings = null;
      for (const year of years) {
        try {
          standings = await this._fetchWikipediaStandings(year);
          if (standings && standings.length >= 10) break;
        } catch (err) {
          console.log('[DataService] Wikipedia %d falhou: %s', year, err.message);
        }
      }
      if (standings && standings.length > 0) {
        this.db.prepare('DELETE FROM standings').run();
        const insert = this.db.prepare(`INSERT INTO standings (position, team, points, played, won, drawn, lost, gf, ga) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        standings.forEach((s, i) => {
          insert.run(i + 1, s.team, s.points, s.played, s.won, s.drawn, s.lost, s.gf, s.ga);
        });
        console.log('[DataService] Tabela atualizada com %d equipes', standings.length);
      }
    } catch (err) {
      console.log('[DataService] Erro ao buscar tabela, mantendo dados locais.');
    }
    this.cacheTimestamps.standings = Date.now();
  }

  async _fetchWikipediaStandings(year) {
    const pageName = `Campeonato_Brasileiro_de_Futebol_de_${year}_-_Série_A`;
    const url = `https://pt.wikipedia.org/w/api.php?action=parse&page=${pageName}&prop=text&format=json&formatversion=2`;
    let html;
    try {
      const r = await axios.get(url, { headers: { 'User-Agent': 'VamosSP/1.0 (educational)' }, timeout: 15000, transformResponse: [data => data] });
      const json = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      html = json.parse?.text || '';
    } catch (err) {
      const { execSync } = require('child_process');
      const raw = execSync(`curl -s -A "VamosSP/1.0 (educational)" "${url}"`, { timeout: 15000, encoding: 'utf8' });
      html = JSON.parse(raw).parse?.text || '';
    }
    if (!html) return null;
    const $ = cheerio.load(html);
    
    let targetTable = null;
    $('table.wikitable').each((i, table) => {
      const caption = $(table).find('caption').text().toLowerCase();
      const prevText = $(table).prev().text().toLowerCase();
      if (caption.includes('classificação') || prevText.includes('classificação')) {
        targetTable = $(table);
        return false;
      }
    });
    
    if (!targetTable) {
      let maxRows = 0;
      $('table.wikitable').each((i, table) => {
        const rows = $(table).find('tbody tr').length;
        if (rows > maxRows && rows >= 15) {
          maxRows = rows;
          targetTable = $(table);
        }
      });
    }
    
    if (!targetTable) return null;
    
    const rows = targetTable.find('tbody tr');
    const standings = [];
    
    for (let j = 1; j < rows.length; j++) {
      const row = $(rows[j]);
      const cells = row.find('td');
      
      if (cells.length < 8) continue;
      
      const pos = parseInt($(cells[0]).text().trim());
      if (isNaN(pos) || pos < 1 || pos > 20) continue;
      
      const team = $(cells[1]).find('a').first().text().trim() || $(cells[1]).text().trim();
      if (!team || team.length < 2) continue;
      
      const pts = parseInt($(cells[2]).text().trim());
      if (isNaN(pts)) continue;
      
      standings.push({
        position: pos,
        team,
        points: pts,
        played: parseInt($(cells[3]).text().trim()) || 0,
        won: parseInt($(cells[4]).text().trim()) || 0,
        drawn: parseInt($(cells[5]).text().trim()) || 0,
        lost: parseInt($(cells[6]).text().trim()) || 0,
        gf: parseInt($(cells[7]).text().trim()) || 0,
        ga: parseInt($(cells[8])?.text().trim() || '0')
      });
    }
    
    return standings.length >= 10 ? standings : null;
  }

  async refreshNews() {
    if (this._cacheValid('news')) {
      console.log('[DataService] Notícias em cache, pulando atualização');
      return;
    }

    console.log('[DataService] Buscando notícias (Institucional -> GE -> SAO PAULO FC -> SPFC.NET)...');
    try {
      // Buscar notícias institucionais ANTES de deletar
      const existingInstitucional = this.db.prepare(`SELECT * FROM news WHERE category = 'institucional'`).all();
      console.log(`[DataService] ${existingInstitucional.length} notícias institucionais existentes`);
      
      // Deletar apenas notícias NÃO institucionais
      this.db.prepare(`DELETE FROM news WHERE category != 'institucional'`).run();
      
      const news = await this.scrapeNews(existingInstitucional);
      
      if (news && news.length > 0) {
        const insertNews = this.db.prepare(`INSERT INTO news (title, summary, body, image, category) VALUES (?, ?, ?, ?, ?)`);
        
        // Inserir notícias das outras fontes (não institucionais)
        const outras = news.filter(n => n.category !== 'institucional');
        outras.slice(0, 10).forEach(item => {
          insertNews.run(item.title, item.summary, item.body || item.summary, item.image || '', item.category || 'ge');
        });
        
        this.cacheTimestamps.news = Date.now();
        console.log(`[DataService] ${outras.length} notícias atualizadas + ${existingInstitucional.length} institucionais mantidas`);
      }
    } catch (error) {
      console.error('[DataService] Erro crítico ao buscar notícias:', error.message);
    }
  }

  async scrapeNews(existingInstitucional = []) {
    // Função para limpar créditos de foto e textos indesejados do conteúdo
    const cleanContent = (content) => {
      const lines = content.split('\n');
      const cleanedLines = lines.filter(line => {
        const l = line.trim().toLowerCase();
        if (l.includes('— foto:') || l.includes('- foto:') || l.includes('foto:')) return false;
        if (l.includes('foto/') && l.match(/foto:?\s*\w/)) return false;
        if (l.startsWith('assista:') || l.startsWith('+ assista:')) return false;
        if (l.startsWith('veja também') || l.startsWith('+ veja também')) return false;
        if (l.startsWith('mais do ') || l.startsWith('+ mais do ')) return false;
        if (l.startsWith('mais são paulo') || l.startsWith('+ mais são paulo')) return false;
        if (l.startsWith('+ ') && l.length < 150) return false;
        if (l.includes('confira a matéria completa no site')) return false;
        if (l.length > 0 && l.length < 20 && !l.match(/^\d/)) return false;
        if (l.startsWith('leia também') || l.startsWith('+ leia também')) return false;
        if (l.startsWith('veja mais') || l.startsWith('+ veja mais')) return false;
        return true;
      });
      return cleanedLines.join('\n').trim();
    };

    const allNews = [];
    const maxNews = 10;

    // ============================================================
    // 1. NOTÍCIAS INSTITUCIONAIS (do próprio site - sempre primeiro)
    // ============================================================
    if (existingInstitucional && existingInstitucional.length > 0) {
      console.log(`[DataService] Mantendo ${existingInstitucional.length} notícias institucionais`);
      existingInstitucional.forEach(news => {
        allNews.push({
          title: news.title,
          summary: news.summary,
          body: news.body,
          image: news.image || '',
          category: 'institucional'
        });
      });
    }

    // ============================================================
    // 2. GE.GLOBO - Página exclusiva do São Paulo (prioridade máxima)
    // ============================================================
    try {
      console.log('[DataService] Buscando notícias do ge.globo (página exclusiva SPFC)...');
      
      const listResponse = await axios.get('https://ge.globo.com/futebol/times/sao-paulo/', {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 10000
      });
      
      const $list = cheerio.load(listResponse.data);
      const newsLinks = [];
      const seenUrls = new Set();
      
      // Pega todos os links da página
      $list('a').each((i, el) => {
        let href = $list(el).attr('href');
        if (!href) return;
        
        // Normaliza URL
        if (href.startsWith('/')) {
          href = 'https://ge.globo.com' + href;
        }
        
        // Duplicata?
        if (seenUrls.has(href)) return;
        
        // Filtra: deve ser matéria do ge.globo sobre futebol
        // URLs de matéria do ge têm formato: ge.globo.com/futebol/.../noticia/YYYY/MM/DD/titulo.ghtml
        if (!href.includes('ge.globo.com/futebol/')) return;
        if (href.includes('/videos/')) return;      // Não é vídeo
        if (href.includes('/g1/')) return;          // Não é G1
        if (href.includes('/globoplay/')) return;   // Não é globoplay
        if (href.includes('/tabela/')) return;      // Não é tabela
        if (href.endsWith('/')) return;             // Não é página de seção
        
        // Deve ser uma matéria (contém /noticia/ e termina em .ghtml ou tem ID numérico)
        if (!href.includes('/noticia/')) return;
        if (!href.match(/\.ghtml$/) && !href.match(/\.\w+--\d+$/)) return;
        
        seenUrls.add(href);
        
        // Pega o título do link
        const title = $list(el).text().trim();
        if (title && title.length > 10) {
          newsLinks.push({ href, title });
        }
      });
      
      console.log(`[DataService] Encontrados ${newsLinks.length} links de matérias no ge.globo`);
      
      // Processa cada link (busca conteúdo completo)
      for (const link of newsLinks) {
        if (allNews.length >= maxNews) break;
        
        try {
          const articleResponse = await axios.get(link.href, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 10000
          });
          
          const $article = cheerio.load(articleResponse.data);
          
          // Extrai imagem principal (og:image)
          let image = $article('meta[property="og:image"]').attr('content');
          if (!image) {
            image = $article('article img').first().attr('src');
          }
          
          // Extrai título (og:title)
          let title = $article('meta[property="og:title"]').attr('content') || link.title;
          
          // Extrai conteúdo completo (todos os parágrafos)
          let content = '';
          $article('article p, .mc-article-body p, .content-text__container p, .matter__content p').each((i, p) => {
            const text = $article(p).text().trim();
            if (text && text.length > 50 && !text.includes('Veja também') && !text.includes('Leia mais')) {
              content += text + '\n\n';
            }
          });
          
          // Limpa créditos de foto e textos indesejados
          content = cleanContent(content);
          
          // Se não conseguiu extrair conteúdo, usa fallback
          if (!content || content.length < 100) {
            content = title + '\n\nConfira a matéria completa no site do ge.globo.';
          }
          
          // Adiciona créditos
            content += `\n\n---\n📰 Fonte: ge.globo.com\n🔗 Link original: ${link.href}`;
            
            // Cria resumo
            const summary = content.substring(0, 150).replace(/\n/g, ' ') + '...';
            
            allNews.push({ title, summary, body: content, image: image || '', category: 'ge' });
          
          // Delay para não sobrecarregar o servidor
          await new Promise(resolve => setTimeout(resolve, 300));
          
        } catch (err) {
          console.log(`[DataService] Erro ao processar ${link.href}: ${err.message}`);
        }
      }
      
      console.log(`[DataService] ${allNews.length} notícias após ge.globo`);
      
    } catch (error) {
      console.log('[DataService] Falha no ge.globo. Tentando SAO PAULO FC...');
    }

    // ============================================================
    // 3. SAOPAULOFC.NET - Site oficial do São Paulo FC
    // ============================================================
    if (allNews.length < maxNews) {
      try {
        console.log(`[DataService] Buscando notícias do saopaulofc.net...`);
        
        const listResponse = await axios.get('https://www.saopaulofc.net/noticias/', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          timeout: 10000
        });
        
        // Extrair links das notícias (botões "Leia agora")
        const linkRegex = /href="(https:\/\/www\.saopaulofc\.net\/[^"]+)"[^>]*>Leia agora<\/a>/g;
        const newsLinks = [];
        let match;
        const seenUrls = new Set();
        
        while ((match = linkRegex.exec(listResponse.data)) !== null) {
          const href = match[1];
          if (!seenUrls.has(href) && newsLinks.length < 10) {
            seenUrls.add(href);
            newsLinks.push(href);
          }
        }
        
        console.log(`[DataService] saopaulofc.net retornou ${newsLinks.length} links`);
        
        for (const link of newsLinks) {
          if (allNews.length >= maxNews) break;
          
          try {
            const articleResponse = await axios.get(link, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
              timeout: 10000
            });
            
            const html = articleResponse.data;
            
            // Extrair título (h1)
            const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
            const title = titleMatch ? titleMatch[1].trim() : '';
            
            if (!title) continue;
            
            // Extrair imagem (og:image)
            const imgMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
            const image = imgMatch ? imgMatch[1] : '';
            
            // Extrair conteúdo (parágrafos entre h1 e "Deixe seu comentário")
            const h1Pos = html.indexOf('</h1>');
            if (h1Pos === -1) continue;
            
            const afterH1 = html.substring(h1Pos);
            const commentPos = afterH1.indexOf('Deixe seu comentário');
            const contentSection = commentPos > -1 ? afterH1.substring(0, commentPos) : afterH1.substring(0, 5000);
            
            // Extrair parágrafos
            const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
            const paragraphs = [];
            
            while ((match = pRegex.exec(contentSection)) !== null) {
              let text = match[1].replace(/<[^>]+>/g, '').trim();
              // Remover parágrafos muito curtos ou com datas
              if (text.length > 30 && !text.match(/^\d+ de \w+ de \d{4}/) && !text.includes('Compartilhe')) {
                paragraphs.push(text);
              }
            }
            
            let content = paragraphs.join('\n\n');
            
            if (content.length < 100) {
              console.log(`[DataService] Conteúdo muito curto para ${link}`);
              continue;
            }
            
            content += `\n\n---\n📰 Fonte: Site Oficial do São Paulo FC\n🔗 Link original: ${link}`;
            
            const summary = content.substring(0, 150).replace(/\n/g, ' ') + '...';
            
            allNews.push({ title, summary, body: content, image, category: 'saopaulofc' });
            
            console.log(`[DataService] saopaulofc.net: ${title.substring(0, 60)}...`);
            
            await new Promise(resolve => setTimeout(resolve, 300));
            
          } catch (err) {
            console.log(`[DataService] Erro ao processar saopaulofc.net ${link}: ${err.message}`);
          }
        }
        
        console.log(`[DataService] Total após saopaulofc.net: ${allNews.length} notícias`);
        
      } catch (error) {
        console.log('[DataService] Falha no saopaulofc.net:', error.message);
      }
    }

    // ============================================================
    // 4. SPFC.NET - Garantir pelo menos 1 notícia (sempre busca, mesmo que já tenha 10)
    // ============================================================
    try {
      console.log(`[DataService] Buscando pelo menos 1 notícia do SPFC.NET...`);
      
      const listResponse = await axios.get('https://www.spfc.net/noticias.html', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 10000
      });
      
      // Extrair links de notícias
      const linkRegex = /href='(https:\/\/spfc\.net\/news\/[^']+)'[^>]*aria-label='([^']+)'/g;
      const newsLinks = [];
      let match;
      
      while ((match = linkRegex.exec(listResponse.data)) !== null) {
        newsLinks.push({ href: match[1], title: match[2] });
      }
      
      console.log(`[DataService] SPFC.NET retornou ${newsLinks.length} links`);
      
      // Pegar apenas a primeira notícia
      const firstLink = newsLinks[0];
      
      if (firstLink) {
        // Verificar se já existe essa notícia
        const alreadyExists = allNews.some(n => n.title === firstLink.title);
        
        if (!alreadyExists) {
          try {
            const articleResponse = await axios.get(firstLink.href, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
              timeout: 10000
            });
            
            const html = articleResponse.data;
            
            // Extrair imagem
            const imgMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
            const image = imgMatch ? imgMatch[1] : '';
            
            // Extrair conteúdo do artigo
            const contentMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
            let content = '';
            
            if (contentMatch) {
              let articleContent = contentMatch[1];
              
              // Remover scripts
              articleContent = articleContent.replace(/<script[\s\S]*?<\/script>/gi, '');
              
              // Remover estilos
              articleContent = articleContent.replace(/<style[\s\S]*?<\/style>/gi, '');
              
              // Remover formulários
              articleContent = articleContent.replace(/<form[\s\S]*?<\/form>/gi, '');
              
              // Remover botões e elementos interativos
              articleContent = articleContent.replace(/<button[\s\S]*?<\/button>/gi, '');
              articleContent = articleContent.replace(/<input[^>]*>/gi, '');
              articleContent = articleContent.replace(/<select[\s\S]*?<\/select>/gi, '');
              
              // Remover divs com classes específicas (avaliações, comentários, etc)
              articleContent = articleContent.replace(/<div[^>]*class="[^"]*avalia[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
              articleContent = articleContent.replace(/<div[^>]*class="[^"]*coment[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
              articleContent = articleContent.replace(/<div[^>]*class="[^"]*resultado[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
              
              // Extrair parágrafos
              const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
              const paragraphs = [];
              let pMatch;
              
              while ((pMatch = pRegex.exec(articleContent)) !== null) {
                let text = pMatch[1].replace(/<[^>]+>/g, '').trim();
                
                // Filtrar textos muito curtos ou que parecem ser código
                if (text.length > 30 && 
                    !text.includes('document.addEventListener') && 
                    !text.includes('function') && 
                    !text.includes('var ') && 
                    !text.includes('addEventListener') && 
                    !text.includes('token =') &&
                    !text.includes('document.querySelector') &&
                    !text.includes('URLSearchParams') &&
                    !text.includes('fetch(') &&
                    !text.includes('.then(') &&
                    !text.includes('getElementById') &&
                    !text.includes('innerHTML') &&
                    !text.includes('textContent') &&
                    !text.includes('btLDN') &&
                    !text.includes('get_avalianews') &&
                    !text.toLowerCase().includes('aplicativo') &&
                    !text.toLowerCase().includes('aplicação gratuita') &&
                    !text.includes('Aplicativo SPFC.net')) {
                  paragraphs.push(text);
                }
              }
              
              content = paragraphs.join('\n\n');
            }
            
            if (!content || content.length < 100) {
              content = firstLink.title + '\n\nConfira a matéria completa no site do SPFC.NET.';
            }
            
            content += `\n\n---\n📰 Fonte: SPFC.NET\n🔗 Link original: ${firstLink.href}`;
            
            const summary = content.substring(0, 150).replace(/\n/g, ' ') + '...';
            
            // Inserir no início se já tem 10 notícias, para garantir que apareça
            if (allNews.length >= maxNews) {
              allNews[allNews.length - 1] = { title: firstLink.title, summary, body: content, image, category: 'spfcnet' };
            } else {
              allNews.push({ title: firstLink.title, summary, body: content, image, category: 'spfcnet' });
            }
            
            console.log(`[DataService] SPFC.NET: ${firstLink.title.substring(0, 60)}...`);
            
          } catch (err) {
            console.log(`[DataService] Erro ao processar SPFC.NET ${firstLink.href}: ${err.message}`);
          }
        } else {
          console.log(`[DataService] SPFC.NET: Notícia "${firstLink.title}" já existe, pulando`);
        }
      }
      
      console.log(`[DataService] Total após SPFC.NET: ${allNews.length} notícias`);
      
    } catch (error) {
      console.log('[DataService] Falha no SPFC.NET:', error.message);
    }

    console.log(`[DataService] Total final: ${allNews.length} notícias`);
    return allNews;
  }

  _cacheValid(key) {
    const elapsed = Date.now() - this.cacheTimestamps[key];
    const ttl = key === 'matches' ? this.CACHE_MATCHES : key === 'standings' ? this.CACHE_STANDINGS : this.CACHE_NEWS;
    return elapsed < ttl && this.cacheTimestamps[key] > 0;
  }

  getStatus() {
    return {
      lastRefresh: this.lastRefresh,
      isRefreshing: this.isRefreshing,
      cache: {
        matches: { valid: this._cacheValid('matches'), age: this.cacheTimestamps.matches ? Date.now() - this.cacheTimestamps.matches : null },
        standings: { valid: this._cacheValid('standings'), age: this.cacheTimestamps.standings ? Date.now() - this.cacheTimestamps.standings : null },
        news: { valid: this._cacheValid('news'), age: this.cacheTimestamps.news ? Date.now() - this.cacheTimestamps.news : null }
      }
    };
  }
}

module.exports = DataService;