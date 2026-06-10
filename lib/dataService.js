const axios = require('axios');
const cheerio = require('cheerio');
const { execSync } = require('child_process');

/**
 * DataService — Atualização automática de dados do São Paulo FC
 *
 * Fontes:
 *   - Jogos:    ESPN API (schedule)
 *   - Tabela:   Wikipedia PT (scraping via MediaWiki API)
 *   - Notícias: Seed inicial + placeholder para integração futura
 *
 * Atualiza automaticamente a cada 2h (jogos) e 6h (tabela).
 * Também expõe endpoint manual de refresh.
 */

class DataService {
  constructor(db) {
    this.db = db;
    this.isRefreshing = false;
    this.lastRefresh = null;
    this.refreshInterval = null;

    // Cache TTLs
    this.CACHE_MATCHES   = 2  * 60 * 60 * 1000;  // 2 horas
    this.CACHE_STANDINGS = 6  * 60 * 60 * 1000;   // 6 horas
    this.CACHE_NEWS      = 24 * 60 * 60 * 1000;   // 24 horas

    this.cacheTimestamps = {
      matches: 0,
      standings: 0,
      news: 0
    };
  }

  /* ------------------------------------------------------------------ */
  /*  PUBLIC API                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Inicia atualização periódica automática
   */
  startAutoRefresh(intervalMs = 2 * 60 * 60 * 1000) {
    // Refresh imediato na inicialização
    this.refreshAll().catch(err =>
      console.error('[DataService] Erro no refresh inicial:', err.message)
    );

    // Refresh periódico
    this.refreshInterval = setInterval(() => {
      this.refreshAll().catch(err =>
        console.error('[DataService] Erro no refresh periódico:', err.message)
      );
    }, intervalMs);

    console.log('[DataService] Auto-refresh ativado (intervalo: %d min)', intervalMs / 60000);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Atualiza todos os dados
   */
  async refreshAll() {
    if (this.isRefreshing) {
      console.log('[DataService] Refresh já em andamento, pulando...');
      return { success: true, skipped: true };
    }

    this.isRefreshing = true;
    console.log('[DataService] Iniciando atualização...');

    const results = { matches: null, standings: null, news: null };

    // Jogos (ESPN API)
    try {
      results.matches = await this.refreshMatches();
    } catch (err) {
      console.error('[DataService] Erro em matches:', err.message);
      results.matches = { error: err.message };
    }

    // Tabela (Wikipedia)
    try {
      results.standings = await this.refreshStandings();
    } catch (err) {
      console.error('[DataService] Erro em standings:', err.message);
      results.standings = { error: err.message };
    }

    this.isRefreshing = false;
    this.lastRefresh = new Date().toISOString();
    console.log('[DataService] Atualização concluída em', this.lastRefresh);

    return { success: true, results, timestamp: this.lastRefresh };
  }

  /**
   * Força refresh ignorando cache
   */
  async forceRefresh() {
    Object.keys(this.cacheTimestamps).forEach(k => {
      this.cacheTimestamps[k] = 0;
    });
    return this.refreshAll();
  }

  /* ------------------------------------------------------------------ */
  /*  MATCHES — ESPN API                                                 */
  /* ------------------------------------------------------------------ */

  async refreshMatches() {
    if (this._cacheValid('matches')) {
      console.log('[DataService] Matches em cache');
      return { cached: true };
    }

    console.log('[DataService] Buscando jogos via ESPN API...');

    const response = await axios.get(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/teams/2026/schedule',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }
    );

    const events = response.data.events || [];
    const now = new Date();

    // Separa futuros e recentes
    const upcoming = events
      .filter(e => new Date(e.date) > now)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const recent = events
      .filter(e => new Date(e.date) <= now)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);

    // Atualiza apenas se houver jogos futuros
    if (upcoming.length > 0) {
      this.db.prepare('DELETE FROM matches').run();

      const insert = this.db.prepare(`
        INSERT INTO matches (opponent, match_date, match_time, stadium, competition, is_home)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      upcoming.slice(0, 8).forEach(event => {
        const comp = event.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const away = comp.competitors.find(c => c.homeAway === 'away');

        const isHome = home.team.id === '2026';
        const opponent = isHome ? away.team.displayName : home.team.displayName;
        const matchDate = event.date.split('T')[0];
        const matchTime = event.date.split('T')[1].substring(0, 5);
        const stadium = isHome ? 'MorumBIS' : home.team.displayName;

        insert.run(opponent, matchDate, matchTime, stadium, 'Brasileirão', isHome ? 1 : 0);
      });

      console.log('[DataService] %d jogos futuros salvos', Math.min(upcoming.length, 8));
    } else {
      console.log('[DataService] Sem jogos futuros na ESPN (temporada pode estar em pausa)');
    }

    this.cacheTimestamps.matches = Date.now();
    return { upcoming: upcoming.length, recent: recent.length };
  }

  /* ------------------------------------------------------------------ */
  /*  STANDINGS — Wikipedia PT (MediaWiki API)                           */
  /* ------------------------------------------------------------------ */

  async refreshStandings() {
    if (this._cacheValid('standings')) {
      console.log('[DataService] Standings em cache');
      return { cached: true };
    }

    console.log('[DataService] Buscando tabela via Wikipedia...');

    // Tenta buscar a página da temporada atual
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

    if (!standings || standings.length === 0) {
      throw new Error('Não foi possível obter dados de nenhuma temporada');
    }

    // Atualiza banco
    this.db.prepare('DELETE FROM standings').run();

    const insert = this.db.prepare(`
      INSERT INTO standings (position, team, points, played, won, drawn, lost, gf, ga)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    standings.forEach((s, i) => {
      insert.run(i + 1, s.team, s.points, s.played, s.won, s.drawn, s.lost, s.gf, s.ga);
    });

    console.log('[DataService] Tabela atualizada com %d equipes', standings.length);
    this.cacheTimestamps.standings = Date.now();
    return { teams: standings.length };
  }

  async _fetchWikipediaStandings(year) {
    const pageName = `Campeonato_Brasileiro_de_Futebol_de_${year}_-_${encodeURIComponent('Série A').replace(/%C3%A9/, '%C3%A9')}`;
    const url = `https://pt.wikipedia.org/w/api.php?action=parse&page=${pageName}&prop=text&format=json&formatversion=2`;

    // Usa curl como fallback pois axios pode ser bloqueado (403)
    let html;
    try {
      const r = await axios.get(url, {
        headers: { 'User-Agent': 'VamosSP/1.0 (educational fan site)' },
        timeout: 15000,
        transformResponse: [data => data]
      });
      const json = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      html = json.parse?.text || '';
    } catch (err) {
      console.log('[DataService] Axios falhou para Wikipedia, tentando curl...');
      const raw = execSync(
        `curl -s -A "VamosSP/1.0 (educational)" "${url}"`,
        { timeout: 15000, encoding: 'utf8' }
      );
      const json = JSON.parse(raw);
      html = json.parse?.text || '';
    }

    if (!html) return null;

    const $ = cheerio.load(html);
    const tables = $('table.wikitable');

    for (let i = 0; i < tables.length; i++) {
      const table = $(tables[i]);
      const rows = table.find('tr');

      if (rows.length < 15) continue;

      const standings = [];

      for (let j = 1; j < rows.length; j++) {
        const row = $(rows[j]);
        // Position is in <th>, data in <td>
        const allCells = row.find('th, td');
        if (allCells.length < 9) continue;

        const posText = $(allCells[0]).text().trim();
        const pos = parseInt(posText);
        if (isNaN(pos)) continue;

        const team = $(allCells[1]).find('a').first().text().trim()
                  || $(allCells[1]).text().trim();
        const pts    = parseInt($(allCells[2]).text().trim());
        const played = parseInt($(allCells[3]).text().trim());
        const won    = parseInt($(allCells[4]).text().trim());
        const drawn  = parseInt($(allCells[5]).text().trim());
        const lost   = parseInt($(allCells[6]).text().trim());
        const gf     = parseInt($(allCells[7]).text().trim());
        const ga     = parseInt($(allCells[8]).text().trim()) || 0;

        if (!isNaN(pts) && team) {
          standings.push({ position: pos, team, points: pts, played, won, drawn, lost, gf, ga });
        }
      }

      if (standings.length >= 10) return standings;
    }

    return null;
  }

  /* ------------------------------------------------------------------ */
  /*  HELPERS                                                            */
  /* ------------------------------------------------------------------ */

  _cacheValid(key) {
    const elapsed = Date.now() - this.cacheTimestamps[key];
    const ttl = key === 'matches' ? this.CACHE_MATCHES
            : key === 'standings' ? this.CACHE_STANDINGS
            : this.CACHE_NEWS;
    return elapsed < ttl && this.cacheTimestamps[key] > 0;
  }

  getStatus() {
    return {
      lastRefresh: this.lastRefresh,
      isRefreshing: this.isRefreshing,
      cache: {
        matches: {
          valid: this._cacheValid('matches'),
          age: this.cacheTimestamps.matches ? Date.now() - this.cacheTimestamps.matches : null
        },
        standings: {
          valid: this._cacheValid('standings'),
          age: this.cacheTimestamps.standings ? Date.now() - this.cacheTimestamps.standings : null
        }
      }
    };
  }
}

module.exports = DataService;
