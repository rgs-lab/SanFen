(async () => {
  const log = (...args) => console.log('[CHESS]', ...args);

  const STOCKFISH_FAILURE_STORAGE_KEY = '__chess_helper_stockfish_failures__';
  const STOCKFISH_FAILURE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days
  const STOCKFISH_DISABLE_STORAGE_KEY = '__chess_helper_stockfish_disabled__';

  function now() {
    return Date.now();
  }

  function safeLocalStorage() {
    try {
      if (typeof window.localStorage === 'undefined') return null;
      return window.localStorage;
    } catch (err) {
      return null;
    }
  }

  function loadStockfishFailureCache() {
    const store = safeLocalStorage();
    if (!store) return {};
    try {
      const raw = store.getItem(STOCKFISH_FAILURE_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      const result = {};
      const cutoff = now() - STOCKFISH_FAILURE_TTL;
      for (const [url, entry] of Object.entries(parsed)) {
        if (!entry || typeof entry !== 'object') continue;
        const timestamp = typeof entry.timestamp === 'number' ? entry.timestamp : 0;
        if (timestamp && timestamp < cutoff) continue;
        const reason = typeof entry.reason === 'string' ? entry.reason : 'unknown error';
        result[url] = { timestamp: timestamp || now(), reason };
      }
      return result;
    } catch (err) {
      return {};
    }
  }

  function persistStockfishFailureCache(cache) {
    const store = safeLocalStorage();
    if (!store) return;
    try {
      store.setItem(STOCKFISH_FAILURE_STORAGE_KEY, JSON.stringify(cache));
    } catch (err) {
      // ignore persistence errors
    }
  }

  const stockfishFailureCache = loadStockfishFailureCache();

  function loadStockfishDisabledFlag() {
    const store = safeLocalStorage();
    if (!store) return false;
    try {
      return store.getItem(STOCKFISH_DISABLE_STORAGE_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function persistStockfishDisabledFlag(flag) {
    const store = safeLocalStorage();
    if (!store) return;
    try {
      if (flag) {
        store.setItem(STOCKFISH_DISABLE_STORAGE_KEY, '1');
      } else {
        store.removeItem(STOCKFISH_DISABLE_STORAGE_KEY);
      }
    } catch (err) {
      // ignore persistence errors
    }
  }

  let stockfishDisabled = loadStockfishDisabledFlag();

  function isStockfishDisabled() {
    return stockfishDisabled === true;
  }

  function setStockfishDisabled(value) {
    const next = value === true;
    if (stockfishDisabled === next) return;
    stockfishDisabled = next;
    persistStockfishDisabledFlag(next);
  }

  function recordStockfishFailure(url, error) {
    if (!url) return;
    const reason = (error && error.message) ? error.message : String(error || 'unknown error');
    stockfishFailureCache[url] = { timestamp: now(), reason };
    persistStockfishFailureCache(stockfishFailureCache);
  }

  function clearStockfishFailureCache() {
    for (const key of Object.keys(stockfishFailureCache)) {
      delete stockfishFailureCache[key];
    }
    const store = safeLocalStorage();
    if (store) {
      try {
        store.removeItem(STOCKFISH_FAILURE_STORAGE_KEY);
      } catch (err) {
        // ignore removal issues and fall back to persisting an empty object
        persistStockfishFailureCache(stockfishFailureCache);
      }
    } else {
      persistStockfishFailureCache(stockfishFailureCache);
    }
  }

  function stockfishFailureEntries() {
    return Object.entries(stockfishFailureCache).map(([url, data]) => ({
      url,
      reason: data?.reason || 'unknown error',
      timestamp: data?.timestamp || 0
    }));
  }

  async function ensureChessJS() {
    if (window.Chess) return true;
    const url = 'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.2/chess.min.js';
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error('script load failed'));
        document.head.appendChild(script);
      });
      return !!window.Chess;
    } catch (err) {
      console.error('[CHESS] chess.js not loaded.', err);
      return false;
    }
  }

  function findMovesContainer() {
    const primary = document.querySelector([
      '#scroll-container',
      '[data-test-element="move-list"]',
      '.vertical-move-list-component',
      '.move-list-vertical',
      '#move-list',
      '[data-qa="vertical-move-list"]',
      '[data-qa="move-list"]'
    ].join(','));
    if (primary) return primary;

    const selectors = ['#scroll-container', '.moves', '[data-test-element="move-list"]', '[data-qa="vertical-move-list"]', '[data-qa="move-list"]'];
    const visited = new Set();
    function walk(node) {
      if (!node || visited.has(node)) return null;
      visited.add(node);
      for (const selector of selectors) {
        try {
          const hit = node.querySelector?.(selector);
          if (hit) return hit;
        } catch (err) {
          // ignore shadow-root access errors
        }
      }
      if (node.shadowRoot) {
        const inside = walk(node.shadowRoot);
        if (inside) return inside;
      }
      for (const child of node.childNodes || []) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }

    const deep = walk(document.documentElement);
    if (deep) return deep;

    const candidates = Array.from(document.querySelectorAll('div,section,aside'))
      .filter(el => (el.scrollHeight > 300 || el.clientHeight > 300) && /move|list|scroll|game/i.test(el.className + ' ' + el.id));
    for (const el of candidates) {
      const text = (el.innerText || '').slice(0, 2000);
      if (/(O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)/.test(text)) return el;
    }
    return null;
  }

  function normalizeFigurines(text) {
    const map = {
      '♔': 'K', // white king
      '♕': 'Q',
      '♖': 'R',
      '♗': 'B',
      '♘': 'N',
      '♙': '',  // white pawn -> no prefix
      '♚': 'K', // black king
      '♛': 'Q',
      '♜': 'R',
      '♝': 'B',
      '♞': 'N',
      '♟': ''   // black pawn
    };
    return text.replace(/[\u2654-\u265F]/g, ch => map[ch] ?? '');
  }

  function canonicalSan(text) {
    return text
      .replace(/0-0-0/gi, 'o-o-o')
      .replace(/0-0/gi, 'o-o')
      .replace(/[+#?!]/g, '')
      .replace(/=/g, '')
      .replace(/[^a-z0-9xo-]/gi, '')
      .toLowerCase();
  }

  function cleanToken(token) {
    return token
      .replace(/[\u202f\u00a0]/g, ' ')
      .replace(/[\u2000-\u200f\u206f\ufeff]/g, '')
      .replace(/[!?]+$/g, '')
      .replace(/[†‡…]/g, '')
      .trim();
  }

  async function fetchText(url) {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  }

  function createWorkerFromSource(script) {
    const blob = new Blob([script], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      const worker = new Worker(blobUrl);
      return { worker, blobUrl };
    } catch (err) {
      URL.revokeObjectURL(blobUrl);
      throw err;
    }
  }

  function decodeBase64ToText(encoded) {
    try {
      return atob(encoded);
    } catch (err) {
      console.warn('[CHESS] Failed to decode base64 Stockfish payload.', err);
      return null;
    }
  }

  class StockfishEngine {
    constructor(worker, sourceUrl) {
      this.worker = worker;
      this.sourceUrl = sourceUrl;
      this.handlers = new Set();
      this.waiters = [];
      this.isInitialized = false;
      this.worker.onmessage = (event) => this.handleMessage(event.data);
    }

    handleMessage(payload) {
      const line = typeof payload === 'string' ? payload : (payload?.data ?? String(payload ?? ''));
      if (!line) return;

      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const waiter = this.waiters[i];
        let match = false;
        try {
          match = waiter.predicate(line);
        } catch (err) {
          console.error('[CHESS] engine waiter error:', err);
        }
        if (match) {
          this.waiters.splice(i, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(line);
        }
      }

      for (const handler of this.handlers) {
        try {
          handler(line);
        } catch (err) {
          console.error('[CHESS] engine handler error:', err);
        }
      }
    }

    waitFor(predicate, timeout = 10000) {
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            const index = this.waiters.indexOf(waiter);
            if (index !== -1) this.waiters.splice(index, 1);
            reject(new Error('timeout waiting for engine response'));
          }, timeout)
        };
        this.waiters.push(waiter);
      });
    }

    send(command) {
      this.worker.postMessage(command);
    }

    onMessage(handler) {
      this.handlers.add(handler);
      return () => this.handlers.delete(handler);
    }

    async init() {
      if (this.isInitialized) return;
      this.send('uci');
      await this.waitFor(line => line.trim() === 'uciok', 10000);
      this.send('setoption name Threads value 1');
      this.send('setoption name Hash value 32');
      this.send('setoption name MultiPV value 5');
      this.send('isready');
      await this.waitFor(line => line.trim() === 'readyok', 10000);
      this.isInitialized = true;
    }

    async isReady() {
      this.send('isready');
      await this.waitFor(line => line.trim() === 'readyok', 10000);
    }

    async setMultiPv(count) {
      this.send(`setoption name MultiPV value ${count}`);
      await this.isReady();
    }
  }

  async function createStockfishWorker(url) {
    const script = await fetchText(url);
    if (/^\s*</.test(script)) {
      throw new Error('Unexpected HTML response');
    }
    return createWorkerFromSource(script);
  }

  let stockfishPromise = window.__STOCKFISH_PROMISE || null;

  async function ensureStockfishEngine() {
    if (window.__STOCKFISH_ENGINE_INSTANCE) return window.__STOCKFISH_ENGINE_INSTANCE;
    if (stockfishPromise) return stockfishPromise;

    const defaultEngineUrls = [
      'https://cdn.jsdelivr.net/npm/stockfish@16.1.1/dist/stockfish-nnue-16.js',
      'https://cdn.jsdelivr.net/npm/stockfish@16/stockfish.js',
      'https://cdn.jsdelivr.net/gh/official-stockfish/Stockfish/wasm/stockfish.js',
      'https://cdn.jsdelivr.net/gh/niklasf/stockfish.wasm/stockfish.js',
      'https://stockfish.online/stockfish.js',
      'https://stockfish.online/js/stockfish.js',
      'https://stockfishchess.org/js/stockfish.js',
      'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js'
    ];

    const overrideUrls = Array.isArray(window.__CHESS_STOCKFISH_URLS)
      ? window.__CHESS_STOCKFISH_URLS.filter(url => typeof url === 'string' && url.trim().length > 0)
      : [];

    const inlinePayloads = [];
    if (typeof window.__CHESS_STOCKFISH_INLINE === 'string') {
      inlinePayloads.push(window.__CHESS_STOCKFISH_INLINE);
    } else if (Array.isArray(window.__CHESS_STOCKFISH_INLINE)) {
      for (const item of window.__CHESS_STOCKFISH_INLINE) {
        if (typeof item === 'string' && item.trim().length > 0) inlinePayloads.push(item);
      }
    }

    if (typeof window.__CHESS_STOCKFISH_INLINE_BASE64 === 'string') {
      const decoded = decodeBase64ToText(window.__CHESS_STOCKFISH_INLINE_BASE64.trim());
      if (decoded) inlinePayloads.push(decoded);
    }

    const stockfishForced = window.__CHESS_STOCKFISH_FORCE === true;
    const disableForSession = isStockfishDisabled() && !stockfishForced;

    const candidateUrls = Array.from(new Set([...overrideUrls, ...defaultEngineUrls]));

    const retryCachedFailures = window.__CHESS_STOCKFISH_RETRY === true;
    const filteredCandidateUrls = retryCachedFailures
      ? candidateUrls
      : candidateUrls.filter(url => !stockfishFailureCache[url]);

    if (!retryCachedFailures) {
      const skipped = candidateUrls.filter(url => stockfishFailureCache[url]);
      if (skipped.length) {
        log('Skipping Stockfish URLs with cached failures:', skipped);
      }
    }

    if (disableForSession && !inlinePayloads.length && overrideUrls.length === 0) {
      log('Stockfish disabled after repeated failures. Call __CHESS.enableStockfish() or set window.__CHESS_STOCKFISH_FORCE = true to retry.');
      throw new Error('Stockfish disabled after repeated failures');
    }

    if (!filteredCandidateUrls.length && !inlinePayloads.length) {
      throw new Error('All Stockfish URLs previously failed. Run __CHESS.clearStockfishFailures() or set window.__CHESS_STOCKFISH_RETRY = true to retry.');
    }

    stockfishPromise = window.__STOCKFISH_PROMISE = (async () => {
      if (!window.Worker) throw new Error('Web Workers not supported in this browser');

      for (const payload of inlinePayloads) {
        let worker;
        let blobUrl;
        try {
          ({ worker, blobUrl } = createWorkerFromSource(payload));
          const engine = new StockfishEngine(worker, 'inline:custom');
          await engine.init();
          engine.blobUrl = blobUrl;
          window.__STOCKFISH_ENGINE_INSTANCE = engine;
          window.__STOCKFISH_ENGINE_URL = 'inline:custom';
          setStockfishDisabled(false);
          return engine;
        } catch (err) {
          if (worker) worker.terminate();
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          console.warn('[CHESS] Failed to start inline Stockfish worker.', err);
        }
      }

      const attemptedUrls = [];

      for (const url of filteredCandidateUrls) {
        try {
          attemptedUrls.push(url);
          const { worker, blobUrl } = await createStockfishWorker(url);
          try {
            const engine = new StockfishEngine(worker, url);
            await engine.init();
            // Keep blob URL alive while worker runs
            engine.blobUrl = blobUrl;
            window.__STOCKFISH_ENGINE_INSTANCE = engine;
            window.__STOCKFISH_ENGINE_URL = url;
            setStockfishDisabled(false);
            return engine;
          } catch (engineErr) {
            worker.terminate();
            URL.revokeObjectURL(blobUrl);
            throw engineErr;
          }
        } catch (err) {
          recordStockfishFailure(url, err);
          console.warn('[CHESS] Failed to load Stockfish from', url, err);
        }
      }

      if (!stockfishForced && !inlinePayloads.length && attemptedUrls.length) {
        setStockfishDisabled(true);
        log('Disabled Stockfish attempts after repeated CDN failures. Use __CHESS.enableStockfish() to re-enable later.');
      }

      throw new Error('Unable to load Stockfish engine from CDN');
    })();

    stockfishPromise.catch(() => {
      stockfishPromise = null;
      window.__STOCKFISH_PROMISE = null;
      window.__STOCKFISH_ENGINE_INSTANCE = null;
    });

    return stockfishPromise;
  }

  function uciToSan(fen, uciMove) {
    if (!uciMove) return null;
    try {
      const chess = new window.Chess(fen);
      const from = uciMove.slice(0, 2);
      const to = uciMove.slice(2, 4);
      const promotion = uciMove.length > 4 ? uciMove.slice(4) : undefined;
      const move = chess.move({ from, to, promotion });
      return move ? move.san : uciMove;
    } catch (err) {
      return uciMove;
    }
  }

  function parseScore(scoreType, rawScore) {
    if (scoreType === 'mate') {
      const ply = parseInt(rawScore, 10);
      if (Number.isNaN(ply)) return '#?';
      return `#${ply}`;
    }
    const centipawns = parseInt(rawScore, 10);
    if (Number.isNaN(centipawns)) return '??';
    return (centipawns / 100).toFixed(2);
  }

  function pvToSanSequence(fen, pvMoves) {
    try {
      const chess = new window.Chess(fen);
      const sanMoves = [];
      for (const uci of pvMoves) {
        const from = uci.slice(0, 2);
        const to = uci.slice(2, 4);
        const promotion = uci.length > 4 ? uci.slice(4) : undefined;
        const move = chess.move({ from, to, promotion });
        if (!move) break;
        sanMoves.push(move.san);
      }
      return sanMoves;
    } catch (err) {
      return pvMoves.slice();
    }
  }

  async function analyzeWithStockfish(engine, game) {
    const fen = game.fen();
    const legalMoves = game.moves({ verbose: true });
    if (!legalMoves.length) return null;

    const multiPv = Math.min(5, Math.max(1, legalMoves.length));
    try {
      await engine.setMultiPv(multiPv);
    } catch (err) {
      console.warn('[CHESS] Unable to update MultiPV setting, continuing with defaults.', err);
    }

    const suggestions = new Map();
    const infoHandler = (line) => {
      if (!line.startsWith('info ')) return;
      const depthMatch = line.match(/depth\s+(\d+)/);
      const multipvMatch = line.match(/multipv\s+(\d+)/);
      const scoreMatch = line.match(/score\s+(cp|mate)\s+(-?\d+)/);
      const pvIndex = line.indexOf(' pv ');
      if (pvIndex === -1) return;
      const pvMoves = line.slice(pvIndex + 4).trim().split(/\s+/).filter(Boolean);
      if (!pvMoves.length) return;

      const multipv = multipvMatch ? parseInt(multipvMatch[1], 10) : 1;
      const depth = depthMatch ? parseInt(depthMatch[1], 10) : null;
      const scoreType = scoreMatch ? scoreMatch[1] : null;
      const rawScore = scoreMatch ? scoreMatch[2] : null;
      const displayScore = scoreType ? parseScore(scoreType, rawScore) : null;
      const primaryMove = pvMoves[0];
      const san = uciToSan(fen, primaryMove);
      const pvSan = pvToSanSequence(fen, pvMoves);

      suggestions.set(multipv, {
        multipv,
        san,
        uci: primaryMove,
        scoreType,
        rawScore,
        displayScore,
        depth,
        pv: pvMoves,
        pvSan
      });
    };

    const removeListener = engine.onMessage(infoHandler);

    await engine.isReady();
    engine.send('ucinewgame');
    await engine.isReady();
    engine.send(`position fen ${fen}`);

    const totalMoves = game.history().length;
    const desiredDepth = Math.min(18, 12 + Math.floor(totalMoves / 6));
    engine.send(`go depth ${desiredDepth}`);

    let bestLine = null;
    try {
      bestLine = await engine.waitFor(line => line.startsWith('bestmove '), 15000);
    } catch (err) {
      console.warn('[CHESS] Engine analysis timed out.', err);
    }

    engine.send('stop');
    removeListener();
    try {
      await engine.isReady();
    } catch (err) {
      console.warn('[CHESS] Engine did not confirm readiness after stop.', err);
    }

    if (!bestLine) return null;

    const bestParts = bestLine.split(/\s+/);
    const bestUci = bestParts[1] || '';
    const validBest = bestUci && bestUci !== '(none)';
    const bestSan = validBest ? uciToSan(fen, bestUci) : null;

    const lines = Array.from(suggestions.values())
      .sort((a, b) => a.multipv - b.multipv)
      .map(entry => ({
        multipv: entry.multipv,
        san: entry.san,
        uci: entry.uci,
        depth: entry.depth,
        displayScore: entry.displayScore,
        pv: entry.pv.slice(),
        pvSan: entry.pvSan.slice()
      }));

    return {
      source: engine.sourceUrl,
      depth: desiredDepth,
      best: validBest ? { san: bestSan, uci: bestUci } : null,
      lines
    };
  }

  function stripMoveDecorations(value) {
    return (value || '').replace(/[+#?!]/g, '');
  }

  function extractTokensFromText(rawText) {
    const cleaned = normalizeFigurines(rawText)
      .replace(/\r?\n/g, ' ')
      .replace(/\.{3}/g, ' ')
      .replace(/\d+\.(?:\s*\.{3})?/g, ' ')
      .replace(/\b(?:1-0|0-1|1\/2-1\/2|\*)\b/g, ' ')
      .replace(/[\u00A0\t]+/g, ' ')
      .replace(/\s+/g, ' ');

    const sanPattern = /(O-O(?:-O)?[+#]?|[KQRBN]?[a-h]?[1-8]?(?:x|:)?[a-h][1-8](?:=[QRBN])?[+#]?)/gi;
    return (cleaned.match(sanPattern) || [])
      .map(raw => cleanToken(raw))
      .filter(Boolean);
  }

  function readMoveTokens(container) {
    const domNodes = Array.from(container.querySelectorAll('[data-ply]'));
    const domTokens = domNodes
      .map(node => node.getAttribute('data-san') || node.textContent || '')
      .map(value => cleanToken(normalizeFigurines(value)))
      .filter(Boolean);

    if (domTokens.length) {
      return { tokens: domTokens, source: 'dom' };
    }

    const fallback = extractTokensFromText(container.innerText || '');
    return { tokens: fallback, source: 'text' };
  }

  function parseTokenHints(token) {
    const info = {
      raw: token,
      normalized: token
        .replace(/:/g, 'x')
        .replace(/^0-0-0$/i, 'O-O-O')
        .replace(/^0-0$/i, 'O-O'),
      capture: false,
      piece: null,
      originFile: null,
      originRank: null,
      target: null,
      promotion: null,
      castle: null,
      hasCheck: false,
      hasMate: false
    };

    if (!info.normalized) return info;

    info.hasCheck = /\+/.test(info.normalized);
    info.hasMate = /#/.test(info.normalized);

    const castle = info.normalized.match(/^(O-O(-O)?)/i);
    if (castle) {
      info.castle = castle[1].toUpperCase();
      return info;
    }

    let working = info.normalized;

    const promo = working.match(/=([QRBN])$/i);
    if (promo) {
      info.promotion = promo[1].toLowerCase();
      working = working.slice(0, -promo[0].length);
    }

    if (/[x]/i.test(working)) {
      info.capture = true;
      working = working.replace(/x/i, '');
    }

    working = stripMoveDecorations(working);

    if (/^[KQRBN]/i.test(working)) {
      info.piece = working[0].toLowerCase();
      working = working.slice(1);
    }

    if (working.length > 2) {
      const hint = working.slice(0, -2);
      let rest = hint;
      if (rest && /[a-h]/i.test(rest[0])) {
        info.originFile = rest[0].toLowerCase();
        rest = rest.slice(1);
      }
      if (rest && /[1-8]/.test(rest[0])) {
        info.originRank = rest[0];
      }
    }

    const target = working.slice(-2);
    if (/^[a-h][1-8]$/i.test(target)) {
      info.target = target.toLowerCase();
    }

    return info;
  }

  function buildCandidateList(game, tokenInfo) {
    const { normalized } = tokenInfo;
    if (!normalized) return [];

    const canonicalToken = canonicalSan(normalized);
    const legalMoves = game.moves({ verbose: true });
    const candidates = [];

    for (const legal of legalMoves) {
      const canonicalLegal = canonicalSan(legal.san);
      let weight = 0;

      if (canonicalToken && canonicalLegal === canonicalToken) {
        weight = 100;
      } else if (canonicalToken && canonicalLegal.endsWith(canonicalToken)) {
        weight = 90;
      } else if (tokenInfo.target && legal.to === tokenInfo.target) {
        weight = tokenInfo.capture ? 80 : 70;
      } else if (canonicalToken && canonicalLegal.includes(canonicalToken)) {
        weight = 60;
      }

      if (!weight) continue;

      if (tokenInfo.piece) {
        if (legal.piece === tokenInfo.piece) {
          weight += 12;
        } else {
          weight -= 8;
        }
      }

      if (tokenInfo.originFile) {
        if (legal.from[0] === tokenInfo.originFile) {
          weight += 6;
        } else {
          weight -= 4;
        }
      }

      if (tokenInfo.originRank) {
        if (legal.from[1] === tokenInfo.originRank) {
          weight += 6;
        } else {
          weight -= 4;
        }
      }

      if (tokenInfo.capture) {
        if (legal.flags.includes('c')) {
          weight += 3;
        } else {
          weight -= 6;
        }
      } else if (legal.flags.includes('c')) {
        weight -= 5;
      }

      const legalHasMate = /#/.test(legal.san);
      const legalHasCheck = /\+/.test(legal.san);
      if (tokenInfo.hasMate) {
        weight += legalHasMate ? 25 : -20;
      } else if (tokenInfo.hasCheck) {
        weight += legalHasCheck ? 12 : -10;
      } else if (legalHasMate) {
        weight -= 6;
      } else if (legalHasCheck) {
        weight -= 3;
      }

      if (tokenInfo.promotion) {
        if (legal.promotion === tokenInfo.promotion) {
          weight += 10;
        } else {
          weight -= 6;
        }
      }

      const sanDelta = Math.abs(stripMoveDecorations(legal.san).length - stripMoveDecorations(normalized).length);
      weight -= sanDelta * 2;

      const piecePriority = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
      weight += piecePriority[legal.piece] || 0;

      candidates.push({ move: legal, weight });
    }

    candidates.sort((a, b) => {
      const diff = b.weight - a.weight;
      if (diff !== 0) return diff;
      if (a.move.piece !== b.move.piece) {
        const order = ['p', 'n', 'b', 'r', 'q', 'k'];
        return order.indexOf(a.move.piece) - order.indexOf(b.move.piece);
      }
      return stripMoveDecorations(b.move.san).length - stripMoveDecorations(a.move.san).length;
    });

    return candidates;
  }

  function collectAttemptStrings(tokenInfo) {
    const attempts = new Set();
    if (tokenInfo.raw) attempts.add(tokenInfo.raw);
    if (tokenInfo.normalized && tokenInfo.normalized !== tokenInfo.raw) attempts.add(tokenInfo.normalized);

    const strippedRaw = stripMoveDecorations(tokenInfo.raw);
    if (strippedRaw && strippedRaw !== tokenInfo.raw) attempts.add(strippedRaw);

    const strippedNormalized = stripMoveDecorations(tokenInfo.normalized);
    if (strippedNormalized && strippedNormalized !== tokenInfo.normalized) attempts.add(strippedNormalized);

    return Array.from(attempts).filter(Boolean);
  }

  function applyToken(game, tokenInfo) {
    const attempts = collectAttemptStrings(tokenInfo);
    for (const attempt of attempts) {
      try {
        const moved = game.move(attempt, { sloppy: true });
        if (moved) {
          return { move: moved, matched: attempt };
        }
      } catch (err) {
        // ignore invalid SAN attempt
      }
    }

    const candidates = buildCandidateList(game, tokenInfo);
    for (const entry of candidates) {
      if (entry.weight < 40) continue;
      const candidate = entry.move;
      try {
        const moved = game.move({ from: candidate.from, to: candidate.to, promotion: candidate.promotion });
        if (moved) {
          return { move: moved, matched: candidate.san, inferred: true };
        }
      } catch (err) {
        // ignore invalid heuristic candidate
      }
    }

    return null;
  }

  function rebuildGameFromTokens(tokenInfos) {
    const game = new window.Chess();
    const applied = [];
    const ignored = [];

    for (const info of tokenInfos) {
      const outcome = applyToken(game, info);
      if (outcome && outcome.move) {
        applied.push({ ...outcome.move, matched: outcome.matched, inferred: outcome.inferred || false });
      } else {
        const skippedToken = info.raw || info.normalized || '(unknown)';
        ignored.push(skippedToken);
      }
    }

    return { game, moves: applied, ignored };
  }

  const pieceValues = { p: 1, n: 3.2, b: 3.3, r: 5.1, q: 9.5, k: 0 };

  const pieceSquareTables = {
    p: [
      0, 0, 0, 0, 0, 0, 0, 0,
      0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05,
      0.01, 0.01, 0.02, 0.03, 0.03, 0.02, 0.01, 0.01,
      0.005, 0.005, 0.01, 0.025, 0.025, 0.01, 0.005, 0.005,
      0, 0, 0, 0.02, 0.02, 0, 0, 0,
      0.005, -0.005, -0.01, 0, 0, -0.01, -0.005, 0.005,
      0.05, 0.1, 0.1, -0.2, -0.2, 0.1, 0.1, 0.05,
      0, 0, 0, 0, 0, 0, 0, 0
    ],
    n: [
      -0.5, -0.4, -0.3, -0.3, -0.3, -0.3, -0.4, -0.5,
      -0.4, -0.2, 0, 0.05, 0.05, 0, -0.2, -0.4,
      -0.3, 0.05, 0.1, 0.15, 0.15, 0.1, 0.05, -0.3,
      -0.3, 0, 0.15, 0.2, 0.2, 0.15, 0, -0.3,
      -0.3, 0.05, 0.15, 0.2, 0.2, 0.15, 0.05, -0.3,
      -0.3, 0, 0.1, 0.15, 0.15, 0.1, 0, -0.3,
      -0.4, -0.2, 0, 0, 0, 0, -0.2, -0.4,
      -0.5, -0.4, -0.3, -0.3, -0.3, -0.3, -0.4, -0.5
    ],
    b: [
      -0.2, -0.1, -0.1, -0.1, -0.1, -0.1, -0.1, -0.2,
      -0.1, 0, 0, 0, 0, 0, 0, -0.1,
      -0.1, 0, 0.05, 0.1, 0.1, 0.05, 0, -0.1,
      -0.1, 0.05, 0.05, 0.1, 0.1, 0.05, 0.05, -0.1,
      -0.1, 0, 0.1, 0.1, 0.1, 0.1, 0, -0.1,
      -0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, -0.1,
      -0.1, 0.05, 0, 0, 0, 0, 0.05, -0.1,
      -0.2, -0.1, -0.1, -0.1, -0.1, -0.1, -0.1, -0.2
    ],
    r: [
      0, 0, 0, 0, 0, 0, 0, 0,
      0.05, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.05,
      -0.05, 0, 0, 0, 0, 0, 0, -0.05,
      -0.05, 0, 0, 0, 0, 0, 0, -0.05,
      -0.05, 0, 0, 0, 0, 0, 0, -0.05,
      -0.05, 0, 0, 0, 0, 0, 0, -0.05,
      -0.05, 0, 0, 0, 0, 0, 0, -0.05,
      0, 0, 0.05, 0.1, 0.1, 0.05, 0, 0
    ],
    q: [
      -0.2, -0.1, -0.1, -0.05, -0.05, -0.1, -0.1, -0.2,
      -0.1, 0, 0, 0, 0, 0, 0, -0.1,
      -0.1, 0, 0.05, 0.05, 0.05, 0.05, 0, -0.1,
      -0.05, 0, 0.05, 0.05, 0.05, 0.05, 0, -0.05,
      0, 0, 0.05, 0.05, 0.05, 0.05, 0, -0.05,
      -0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0, -0.1,
      -0.1, 0, 0.05, 0, 0, 0, 0, -0.1,
      -0.2, -0.1, -0.1, -0.05, -0.05, -0.1, -0.1, -0.2
    ]
  };

  const kingSquareTables = {
    midgame: [
      -0.3, -0.4, -0.4, -0.5, -0.5, -0.4, -0.4, -0.3,
      -0.3, -0.4, -0.4, -0.5, -0.5, -0.4, -0.4, -0.3,
      -0.3, -0.4, -0.4, -0.5, -0.5, -0.4, -0.4, -0.3,
      -0.2, -0.3, -0.3, -0.4, -0.4, -0.3, -0.3, -0.2,
      -0.1, -0.2, -0.2, -0.2, -0.2, -0.2, -0.2, -0.1,
      0, 0.1, 0.1, 0, 0, 0.1, 0.1, 0,
      0.1, 0.2, 0.2, 0.1, 0.1, 0.2, 0.2, 0.1,
      0.2, 0.3, 0.2, 0, 0, 0.2, 0.3, 0.2
    ],
    endgame: [
      -0.05, -0.02, 0, 0, 0, 0, -0.02, -0.05,
      -0.02, 0.05, 0.1, 0.1, 0.1, 0.1, 0.05, -0.02,
      0, 0.1, 0.15, 0.2, 0.2, 0.15, 0.1, 0,
      0, 0.1, 0.2, 0.25, 0.25, 0.2, 0.1, 0,
      0, 0.1, 0.2, 0.25, 0.25, 0.2, 0.1, 0,
      0, 0.1, 0.15, 0.2, 0.2, 0.15, 0.1, 0,
      -0.02, 0, 0.05, 0.1, 0.1, 0.05, 0, -0.02,
      -0.05, -0.02, 0, 0, 0, 0, -0.02, -0.05
    ]
  };

  const coreCenterSquares = new Set(['d4', 'd5', 'e4', 'e5']);
  const extendedCenterSquares = new Set(['c3', 'c4', 'c5', 'c6', 'd3', 'e3', 'f3', 'f4', 'f5', 'f6', 'd6', 'e6']);
  const minorPieceStartSquares = new Set(['b1', 'g1', 'c1', 'f1', 'b8', 'g8', 'c8', 'f8']);
  const flankFiles = new Set(['a', 'h']);

  function createEvaluationContext(game) {
    const history = game.history({ verbose: true });
    const moveCount = history.length;
    const flankCounts = { w: Object.create(null), b: Object.create(null) };
    const repeatedFlankMoves = { w: 0, b: 0 };
    let whiteCastled = false;
    let blackCastled = false;
    let whiteKingMoved = false;
    let blackKingMoved = false;

    history.forEach((move, index) => {
      if (move.piece === 'k') {
        if (move.color === 'w') whiteKingMoved = true;
        else blackKingMoved = true;
        if (move.san === 'O-O' || move.san === 'O-O-O') {
          if (move.color === 'w') whiteCastled = true;
          else blackCastled = true;
        }
      }

      if (index < 20 && move.piece === 'p' && flankFiles.has(move.from[0])) {
        const map = flankCounts[move.color];
        const file = move.from[0];
        map[file] = (map[file] || 0) + 1;
        if (map[file] > 1) {
          repeatedFlankMoves[move.color] += 1;
        }
      }
    });

    return {
      moveCount,
      history,
      repeatedFlankMoves,
      castled: { w: whiteCastled, b: blackCastled },
      kingMoved: { w: whiteKingMoved, b: blackKingMoved }
    };
  }

  function pieceSquareValue(piece, rowIndex, colIndex, kingPhaseWeight) {
    if (piece.type === 'k') {
      const index = rowIndex * 8 + colIndex;
      const mirrored = (7 - rowIndex) * 8 + colIndex;
      const mid = kingSquareTables.midgame[piece.color === 'w' ? index : mirrored] || 0;
      const end = kingSquareTables.endgame[piece.color === 'w' ? index : mirrored] || 0;
      return mid * kingPhaseWeight + end * (1 - kingPhaseWeight);
    }

    const table = pieceSquareTables[piece.type];
    if (!table) return 0;
    const directIndex = rowIndex * 8 + colIndex;
    if (piece.color === 'w') {
      return table[directIndex] || 0;
    }
    const mirroredIndex = (7 - rowIndex) * 8 + colIndex;
    return table[mirroredIndex] || 0;
  }

  function evaluatePosition(game, context) {
    const board = typeof game.board === 'function' ? game.board() : null;
    if (!board) return 0;

    const evalContext = context || createEvaluationContext(game);

    const phaseWeights = { p: 0, n: 1, b: 1, r: 2, q: 4, k: 0 };
    let phaseScore = 0;
    const maxPhase = 24;

    const fileCounts = {
      w: Array(8).fill(0),
      b: Array(8).fill(0)
    };
    const pawns = { w: [], b: [] };
    const rooks = { w: [], b: [] };
    const pieceTally = {
      w: { bishops: 0, knights: 0, rooks: 0, queen: 0 },
      b: { bishops: 0, knights: 0, rooks: 0, queen: 0 }
    };

    let total = 0;
    let whiteKing = null;
    let blackKing = null;
    let whiteKingSquare = null;
    let blackKingSquare = null;
    const pieces = [];
    const minorsOnHome = { w: 0, b: 0 };

    for (let row = 0; row < board.length; row++) {
      const rank = board[row] || [];
      for (let col = 0; col < rank.length; col++) {
        const piece = rank[col];
        if (!piece) continue;

        phaseScore += phaseWeights[piece.type] || 0;
        pieces.push({ piece, row, col });

        const square = String.fromCharCode(97 + col) + (8 - row);
        if ((piece.type === 'n' || piece.type === 'b') && minorPieceStartSquares.has(square)) {
          minorsOnHome[piece.color] += 1;
        }

        if (coreCenterSquares.has(square)) {
          total += piece.color === 'w' ? 0.08 : -0.08;
        } else if (extendedCenterSquares.has(square)) {
          total += piece.color === 'w' ? 0.05 : -0.05;
        }

        const fileIndex = col;
        if (piece.type === 'p') {
          fileCounts[piece.color][fileIndex] += 1;
          const rankIndex = 8 - row;
          pawns[piece.color].push({ file: fileIndex, rank: rankIndex, square });
        } else if (piece.type === 'r') {
          rooks[piece.color].push({ file: fileIndex, row, square });
          pieceTally[piece.color].rooks += 1;
        } else if (piece.type === 'b') {
          pieceTally[piece.color].bishops += 1;
        } else if (piece.type === 'n') {
          pieceTally[piece.color].knights += 1;
        } else if (piece.type === 'q') {
          pieceTally[piece.color].queen += 1;
        } else if (piece.type === 'k') {
          if (piece.color === 'w') {
            whiteKing = { row, col, square };
            whiteKingSquare = square;
          } else {
            blackKing = { row, col, square };
            blackKingSquare = square;
          }
        }
      }
    }

    const kingPhaseWeight = Math.min(1, phaseScore / maxPhase);
    for (const info of pieces) {
      const base = pieceValues[info.piece.type] || 0;
      const placement = pieceSquareValue(info.piece, info.row, info.col, kingPhaseWeight);
      const contribution = base + placement;
      total += info.piece.color === 'w' ? contribution : -contribution;
    }

    const bishopPairBonus = 0.35;
    if (pieceTally.w.bishops >= 2) total += bishopPairBonus;
    if (pieceTally.b.bishops >= 2) total -= bishopPairBonus;

    const rookOpenBonus = 0.18;
    for (const color of ['w', 'b']) {
      for (const rook of rooks[color]) {
        const fileIndex = rook.file;
        const friendlyPawns = fileCounts[color][fileIndex];
        const enemyPawns = fileCounts[color === 'w' ? 'b' : 'w'][fileIndex];
        let bonus = 0;
        if (enemyPawns === 0) {
          bonus += friendlyPawns === 0 ? rookOpenBonus * 1.6 : rookOpenBonus;
        }
        if (extendedCenterSquares.has(rook.square)) {
          bonus += 0.05;
        }
        total += color === 'w' ? bonus : -bonus;
      }
    }

    const doubledPenalty = 0.12;
    const isolatedPenalty = 0.1;
    const passedBonus = 0.2;

    for (const color of ['w', 'b']) {
      const enemy = color === 'w' ? 'b' : 'w';
      for (let file = 0; file < 8; file++) {
        const count = fileCounts[color][file];
        if (count > 1) {
          total += (color === 'w' ? -1 : 1) * doubledPenalty * (count - 1);
        }
        if (count > 0) {
          const hasLeft = file > 0 ? fileCounts[color][file - 1] > 0 : false;
          const hasRight = file < 7 ? fileCounts[color][file + 1] > 0 : false;
          if (!hasLeft && !hasRight) {
            total += (color === 'w' ? -1 : 1) * isolatedPenalty;
          }
        }
      }

      for (const pawn of pawns[color]) {
        let blocked = false;
        for (const enemyPawn of pawns[enemy]) {
          const sameFile = Math.abs(enemyPawn.file - pawn.file) <= 1;
          if (!sameFile) continue;
          if (color === 'w' && enemyPawn.rank >= pawn.rank) {
            blocked = true;
            break;
          }
          if (color === 'b' && enemyPawn.rank <= pawn.rank) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          const advancement = color === 'w' ? pawn.rank - 2 : 7 - pawn.rank;
          const bonus = passedBonus + Math.max(0, advancement) * 0.025;
          total += color === 'w' ? bonus : -bonus;
        }
      }
    }

    function kingShieldContribution(color, kingInfo) {
      if (!kingInfo) return 0;
      const dir = color === 'w' ? -1 : 1;
      const row = kingInfo.row;
      const shieldRow = row + dir;
      if (shieldRow < 0 || shieldRow > 7) return 0;
      let shield = 0;
      for (let offset = -1; offset <= 1; offset++) {
        const col = kingInfo.col + offset;
        if (col < 0 || col > 7) continue;
        const piece = board[shieldRow]?.[col];
        if (piece && piece.type === 'p' && piece.color === color) shield += 1;
      }
      return shield * 0.07;
    }

    total += kingShieldContribution('w', whiteKing);
    total -= kingShieldContribution('b', blackKing);

    function openKingPenalty(color, kingInfo) {
      if (!kingInfo) return 0;
      const adjacentSquares = [
        [0, -1], [0, 1],
        [1, 0], [-1, 0]
      ];
      let exposed = 0;
      for (const [dr, dc] of adjacentSquares) {
        const r = kingInfo.row + dr;
        const c = kingInfo.col + dc;
        if (r < 0 || r > 7 || c < 0 || c > 7) continue;
        const piece = board[r]?.[c];
        if (!piece) exposed += 1;
      }
      return exposed * 0.05;
    }

    total -= openKingPenalty('w', whiteKing);
    total += openKingPenalty('b', blackKing);

    const moveCount = evalContext.moveCount;
    const openingPhase = moveCount < 20;
    const earlyPhase = moveCount < 30;

    if (openingPhase) {
      const minorPenaltyBase = 0.11 + Math.max(0, 18 - moveCount) * 0.004;
      total -= minorsOnHome.w * minorPenaltyBase;
      total += minorsOnHome.b * minorPenaltyBase;
    }

    const flankPenalty = 0.24;
    total -= evalContext.repeatedFlankMoves.w * flankPenalty;
    total += evalContext.repeatedFlankMoves.b * flankPenalty;

    if (!evalContext.castled.w && earlyPhase && whiteKingSquare && ['e1', 'd1'].includes(whiteKingSquare)) {
      const penalty = 0.2 + Math.max(0, moveCount - 12) * 0.016;
      total -= penalty;
    }
    if (!evalContext.castled.b && earlyPhase && blackKingSquare && ['e8', 'd8'].includes(blackKingSquare)) {
      const penalty = 0.2 + Math.max(0, moveCount - 12) * 0.016;
      total += penalty;
    }

    if (evalContext.castled.w) total += 0.05;
    if (evalContext.castled.b) total -= 0.05;

    const fen = game.fen();
    const segments = fen.split(' ');
    let whiteMobility = 0;
    let blackMobility = 0;
    if (segments.length >= 2) {
      const originalTurn = segments[1];
      segments[1] = 'w';
      try {
        const whiteGame = new window.Chess(segments.join(' '));
        whiteMobility = whiteGame.moves().length;
      } catch (err) {
        whiteMobility = 0;
      }
      segments[1] = 'b';
      try {
        const blackGame = new window.Chess(segments.join(' '));
        blackMobility = blackGame.moves().length;
      } catch (err) {
        blackMobility = 0;
      }
      segments[1] = originalTurn;
    }
    const mobilityScale = 0.016;
    total += (whiteMobility - blackMobility) * mobilityScale;

    const tempoBonus = 0.015;
    total += game.turn && game.turn() === 'w' ? tempoBonus : -tempoBonus;

    return total;
  }

  function evaluateForPerspective(position, perspective, context) {
    const value = evaluatePosition(position, context);
    return perspective === 'w' ? value : -value;
  }

  function moveKey(move) {
    return `${move.from}-${move.to}-${move.promotion || ''}-${move.san}`;
  }

  function movePriority(move, context, preferenceMap) {
    let score = 0;
    if (preferenceMap) {
      const pref = preferenceMap.get(moveKey(move));
      if (pref !== undefined) {
        score += 60 - pref;
      }
    }
    if (move.captured) {
      const captureWeights = { p: 1, n: 2, b: 2, r: 3, q: 4, k: 6 };
      score += 4 + (captureWeights[move.captured] || 0);
    }
    if (move.flags.includes('c')) score += 1.5;
    if (/[+#]/.test(move.san)) score += move.san.includes('#') ? 5 : 2.5;
    if (move.flags.includes('p')) score += 6;
    if (move.flags.includes('k') || move.flags.includes('q')) score += 3;

    const openingPhase = context ? context.moveCount < 16 : false;
    const veryEarly = context ? context.moveCount < 8 : false;

    if ((move.piece === 'n' || move.piece === 'b') && minorPieceStartSquares.has(move.from)) {
      score += openingPhase ? 1.4 : 0.4;
      if (coreCenterSquares.has(move.to)) score += 0.6;
      else if (extendedCenterSquares.has(move.to)) score += 0.4;
    }

    if (move.piece === 'p') {
      if (coreCenterSquares.has(move.to)) score += 0.6;
      else if (extendedCenterSquares.has(move.to)) score += 0.3;

      if (flankFiles.has(move.from[0])) {
        score -= openingPhase ? 0.9 : 0.2;
        if (veryEarly) score -= 0.6;
      }
    } else if (coreCenterSquares.has(move.to)) {
      score += 0.4;
    } else if (extendedCenterSquares.has(move.to)) {
      score += 0.25;
    }

    if (move.san === 'O-O' || move.san === 'O-O-O') {
      score += 3.5;
    }

    return score;
  }

  function orderedMoves(game, context, preferenceMap) {
    return game
      .moves({ verbose: true })
      .sort((a, b) => movePriority(b, context, preferenceMap) - movePriority(a, context, preferenceMap));
  }

  function evaluateTerminalState(game, perspective, plyCount, context) {
    if (game.in_checkmate()) {
      const mateScore = 1000 - plyCount;
      return game.turn() === perspective ? -mateScore : mateScore;
    }
    if (game.in_stalemate()) {
      return 0;
    }
    return evaluateForPerspective(game, perspective, context);
  }

  function quiescence(game, alpha, beta, perspective, plyCount, stats, context, deadline, nowFn, limit = 6) {
    if (deadline && nowFn && nowFn() > deadline) {
      stats.timeouts = (stats.timeouts || 0) + 1;
      return evaluateForPerspective(game, perspective, context);
    }
    stats.nodes += 1;
    const standPat = evaluateTerminalState(game, perspective, plyCount, context);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (limit <= 0) return standPat;

    const captureMoves = orderedMoves(game, context).filter(move => move.captured || move.flags.includes('p') || /[+#]/.test(move.san));
    for (const move of captureMoves) {
      game.move(move);
      const score = -quiescence(game, -beta, -alpha, perspective, plyCount + 1, stats, context, deadline, nowFn, limit - 1);
      game.undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(game, depth, alpha, beta, perspective, table, plyCount, stats, context, deadline, nowFn) {
    if (deadline && nowFn && nowFn() > deadline) {
      stats.timeouts = (stats.timeouts || 0) + 1;
      return evaluateForPerspective(game, perspective, context);
    }
    stats.nodes += 1;
    const terminal = game.game_over();
    const key = game.fen();
    const cached = table.get(key);
    if (!terminal && cached && cached.depth >= depth) {
      if (cached.flag === 'exact') {
        return cached.value;
      }
      if (cached.flag === 'lower' && cached.value > alpha) {
        alpha = cached.value;
      } else if (cached.flag === 'upper' && cached.value < beta) {
        beta = cached.value;
      }
      if (alpha >= beta) {
        return cached.value;
      }
    }

    if (terminal) {
      const result = evaluateTerminalState(game, perspective, plyCount, context);
      if (!cached || cached.depth < depth) {
        table.set(key, { depth, value: result, flag: 'exact' });
      }
      return result;
    }

    if (depth <= 0) {
      return quiescence(game, alpha, beta, perspective, plyCount, stats, context, deadline, nowFn);
    }

    const moves = orderedMoves(game, context);
    const limit = depth >= 3 ? Math.min(moves.length, 14) : Math.min(moves.length, 18);
    let bestValue = -Infinity;
    let bestFlag = 'upper';

    for (let i = 0; i < limit; i++) {
      const move = moves[i];
      game.move(move);
      const score = -negamax(game, depth - 1, -beta, -alpha, perspective, table, plyCount + 1, stats, context, deadline, nowFn);
      game.undo();

      if (score > bestValue) {
        bestValue = score;
      }
      if (score > alpha) {
        alpha = score;
        bestFlag = 'exact';
      }
      if (alpha >= beta) {
        bestFlag = 'lower';
        break;
      }
    }

    if (!moves.length) {
      bestValue = evaluateTerminalState(game, perspective, plyCount, context);
      bestFlag = 'exact';
    }

    table.set(key, { depth, value: bestValue, flag: bestFlag });
    return bestValue;
  }

  function chooseFallbackDepth(moveCount, legalCount) {
    let depth = 4;
    if (moveCount < 10) depth += 2;
    else if (moveCount < 20) depth += 1;
    if (legalCount <= 12) depth += 1;
    if (legalCount <= 8) depth += 1;
    if (legalCount >= 28) depth -= 1;
    if (legalCount >= 36) depth -= 1;
    if (moveCount > 60) depth = Math.max(3, depth - 1);
    return Math.max(3, Math.min(depth, 7));
  }

  function analyzeFallback(game) {
    const evalContext = createEvaluationContext(game);
    const initialMoves = orderedMoves(game, evalContext);
    if (!initialMoves.length) {
      return { best: null, details: [], depth: 0, considered: 0, elapsed: 0, aborted: false };
    }

    const perspective = game.turn();
    const moveCount = evalContext.moveCount;
    const targetDepth = chooseFallbackDepth(moveCount, initialMoves.length);
    const table = new Map();
    const stats = { nodes: 0, timeouts: 0 };
    const preferenceMap = new Map();

    const nowFn = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? () => performance.now()
      : () => Date.now();
    const timeBudget = typeof window.__CHESS_FALLBACK_TIME === 'number'
      ? Math.max(250, window.__CHESS_FALLBACK_TIME)
      : 1700;
    const startTime = nowFn();
    const deadline = startTime + timeBudget;

    let reachedDepth = 0;
    let aborted = false;
    let finalResults = initialMoves.map(move => ({ move, score: 0 }));
    let bestSummary = null;

    for (let depth = 1; depth <= targetDepth; depth++) {
      const candidateMoves = orderedMoves(game, evalContext, preferenceMap);
      const limit = Math.min(candidateMoves.length, depth >= 4 ? 20 : 24);
      const iteration = [];
      let alpha = -Infinity;
      let beta = Infinity;

      for (let i = 0; i < limit; i++) {
        if (nowFn() > deadline) {
          aborted = true;
          break;
        }
        const move = candidateMoves[i];
        game.move(move);
        let score;
        if (game.in_checkmate()) {
          score = evaluateTerminalState(game, perspective, 1, evalContext);
        } else {
          score = -negamax(game, depth - 1, -beta, -alpha, perspective, table, 1, stats, evalContext, deadline, nowFn);
        }
        const checkBonus = game.in_check() ? 0.2 : 0;
        game.undo();

        const priorityBoost = movePriority(move, evalContext) * 0.04;
        const normalized = score + checkBonus + priorityBoost;
        iteration.push({ move, rawScore: score, score: normalized });
        if (score > alpha) alpha = score;
        if (nowFn() > deadline) {
          aborted = true;
          break;
        }
      }

      if (!iteration.length) {
        break;
      }

      iteration.sort((a, b) => b.score - a.score);
      finalResults = iteration.map(entry => ({ move: entry.move, score: entry.rawScore }));
      bestSummary = finalResults[0] || null;
      reachedDepth = depth;

      preferenceMap.clear();
      iteration.forEach((entry, index) => {
        preferenceMap.set(moveKey(entry.move), index);
      });

      if (aborted) {
        break;
      }
    }

    const elapsed = nowFn() - startTime;

    return {
      best: bestSummary,
      details: finalResults,
      depth: reachedDepth,
      considered: stats.nodes,
      aborted,
      elapsed,
      timeouts: stats.timeouts || 0
    };
  }

  const chessLoaded = await ensureChessJS();
  if (!chessLoaded) return;

  const container = findMovesContainer();
  const moveListFound = !!container;
  let rawMovesText = '';
  let tokenStrings = [];
  let tokenSource = 'none';

  if (!container) {
    console.warn('[CHESS] move list element not found; assuming starting position. Make your first move to populate the move list or open the analysis panel, then rerun the helper.');
  } else {
    rawMovesText = container.innerText || '';
    const tokenResult = readMoveTokens(container);
    tokenStrings = tokenResult.tokens;
    tokenSource = tokenResult.source;
  }

  log('READ MOVES len=', rawMovesText.length);
  log('MOVE LIST FOUND=', moveListFound);
  log('TOKEN SOURCE=', tokenSource);
  log('PARSED TOKENS=', tokenStrings.length, tokenStrings);

  const tokenInfos = tokenStrings.map(token => parseTokenHints(token));
  const { game, moves: appliedMoves, ignored: ignoredTokens } = rebuildGameFromTokens(tokenInfos);

  const inferredMoves = appliedMoves.filter(m => m.inferred);

  const sanHistory = appliedMoves.map(m => m.san);
  log('SAN COUNT=', sanHistory.length, sanHistory);

  log('IGNORED TOKENS=', ignoredTokens.length, ignoredTokens);
  if (inferredMoves.length) {
    const inferredList = inferredMoves.map(m => `${m.san}⇐${m.matched}`);
    log('INFERRED TOKENS=', inferredMoves.length, inferredList);
  }

  const verboseHistory = game.history({ verbose: true });
  const lastMove = verboseHistory[verboseHistory.length - 1] || null;
  if (lastMove) {
    log('LAST MOVE =', `${lastMove.san}  ${lastMove.from.toUpperCase()}->${lastMove.to.toUpperCase()}`);
  } else {
    log('LAST MOVE = (none)');
  }

  const fen = game.fen();
  log('FEN =', fen);

  const recentMoves = verboseHistory.slice(-10).map(m => `${m.san}  ${m.from.toUpperCase()}->${m.to.toUpperCase()}`);
  log('RECENT (up to 10):', recentMoves);

  const legalVerbose = game.moves({ verbose: true });
  const legalSAN = legalVerbose.map(m => m.san);
  const legalFromTo = legalVerbose.map(m => `${m.from.toUpperCase()}->${m.to.toUpperCase()} (${m.san})`);
  log('LEGAL (SAN):', legalSAN);
  log('LEGAL (from->to):', legalFromTo);

  let engineAnalysis = null;
  let engineError = null;
  if (legalVerbose.length) {
    try {
      const engine = await ensureStockfishEngine();
      engineAnalysis = await analyzeWithStockfish(engine, game);
    } catch (err) {
      engineError = err;
      console.warn('[CHESS] Stockfish analysis unavailable.', err);
    }
  }

  let recommendationDetail = [];
  let bestRecommendation = null;

  if (engineAnalysis && (engineAnalysis.lines.length || engineAnalysis.best)) {
    const formatted = engineAnalysis.lines.map(line => {
      const san = line.san || uciToSan(game.fen(), line.uci);
      const info = line.displayScore ? `score=${line.displayScore}` : 'score=?';
      const depth = line.depth ? `depth=${line.depth}` : null;
      const extras = [info, depth].filter(Boolean).join(', ');
      return `${san} (${extras})`;
    });
    log('ENGINE SOURCE=', engineAnalysis.source);
    if (formatted.length) {
      log('ENGINE SUGGESTIONS:', formatted);
    }
    if (engineAnalysis.best?.san) {
      bestRecommendation = `${engineAnalysis.best.san} (${engineAnalysis.best.uci})`;
      log('ENGINE RECOMMENDATION:', `${engineAnalysis.best.san}  ${engineAnalysis.best.uci.toUpperCase()} (depth≈${engineAnalysis.depth})`);
    } else if (engineAnalysis.lines.length) {
      const firstLine = engineAnalysis.lines[0];
      if (firstLine?.san && firstLine?.uci) {
        bestRecommendation = `${firstLine.san} (${firstLine.uci})`;
        log('ENGINE RECOMMENDATION:', `${firstLine.san}  ${firstLine.uci.toUpperCase()} (depth≈${firstLine.depth ?? engineAnalysis.depth})`);
      }
    }
    recommendationDetail = engineAnalysis.lines.map(line => ({
      san: line.san || uciToSan(game.fen(), line.uci),
      uci: line.uci,
      score: line.displayScore,
      depth: line.depth,
      pv: line.pv,
      pvSan: line.pvSan
    }));
    if (!recommendationDetail.length && engineAnalysis.best?.san) {
      recommendationDetail = [{
        san: engineAnalysis.best.san,
        uci: engineAnalysis.best.uci,
        score: null,
        depth: engineAnalysis.depth,
        pv: [engineAnalysis.best.uci],
        pvSan: [engineAnalysis.best.san]
      }];
    }
  }

  let fallbackDetails = [];
  let fallbackMeta = null;
  if (!engineAnalysis) {
    const fallback = analyzeFallback(game);
    fallbackMeta = {
      depth: fallback.depth,
      considered: fallback.considered,
      elapsed: fallback.elapsed,
      aborted: !!fallback.aborted,
      timeouts: fallback.timeouts || 0
    };
    const topMoves = fallback.details.slice(0, 10);
    const suggestionsSan = topMoves.map(entry => entry.move.san);
    const suggestionsDetail = topMoves.map(entry => {
      const scoreValue = typeof entry.score === 'number' ? entry.score : 0;
      return `${entry.move.san}  ${entry.move.from.toUpperCase()}->${entry.move.to.toUpperCase()} (score≈${scoreValue.toFixed(2)})`;
    });
    fallbackDetails = topMoves.map(entry => {
      const scoreValue = typeof entry.score === 'number' ? entry.score : 0;
      return {
        san: entry.move.san,
        from: entry.move.from.toUpperCase(),
        to: entry.move.to.toUpperCase(),
        score: scoreValue,
        detail: `${entry.move.san}  ${entry.move.from.toUpperCase()}->${entry.move.to.toUpperCase()} (score≈${scoreValue.toFixed(2)})`
      };
    });

    log('SIMPLE SUGGESTIONS (SAN):', suggestionsSan);
    log('SIMPLE SUGGESTIONS (scored):', suggestionsDetail);
    const fallbackLog = [];
    const depthLabel = typeof fallback.depth === 'number' ? `depth=${fallback.depth}` : 'depth=0';
    fallbackLog.push(fallback.aborted ? `${depthLabel} (time cutoff)` : depthLabel);
    fallbackLog.push(`nodes evaluated=${fallback.considered}`);
    if (Number.isFinite(fallback.elapsed)) {
      fallbackLog.push(`elapsed≈${fallback.elapsed.toFixed(0)}ms`);
    }
    log('FALLBACK SEARCH:', ...fallbackLog);

    if (fallback.best) {
      const { move, score } = fallback.best;
      const scoreValue = typeof score === 'number' ? score : 0;
      bestRecommendation = `${move.san} (${move.from.toUpperCase()}->${move.to.toUpperCase()})`;
      log('RECOMMENDATION:', `${move.san}  ${move.from.toUpperCase()}->${move.to.toUpperCase()} (score≈${scoreValue.toFixed(2)})`);
    } else {
      log('RECOMMENDATION: (no legal moves found)');
    }
  }

  if (engineError) {
    log('ENGINE ERROR:', engineError.message || engineError);
  }

  window.__CHESS = {
    version: 'helper-15',
    moveListFound: () => moveListFound,
    fen: () => game.fen(),
    turn: () => game.turn(),
    legalSAN: () => game.moves(),
    legalPairs: () => game.moves({ verbose: true }).map(m => `${m.from.toUpperCase()}->${m.to.toUpperCase()} (${m.san})`),
    last: () => lastMove,
    ignored: () => ignoredTokens.slice(),
    tokens: () => tokenStrings.slice(),
    tokenSource: () => tokenSource,
    best: () => bestRecommendation,
    suggestions: () => (engineAnalysis
      ? recommendationDetail.map(item => ({
          ...item,
          pv: item.pv ? item.pv.slice() : [],
          pvSan: item.pvSan ? item.pvSan.slice() : []
        }))
      : fallbackDetails.map(item => ({ ...item }))),
    engine: () => engineAnalysis ? {
      source: engineAnalysis.source,
      depth: engineAnalysis.depth,
      best: engineAnalysis.best ? { ...engineAnalysis.best } : null,
      lines: engineAnalysis.lines.map(line => ({
        ...line,
        pv: line.pv.slice(),
        pvSan: Array.isArray(line.pvSan) ? line.pvSan.slice() : []
      }))
    } : null,
    fallback: () => (!engineAnalysis && fallbackMeta) ? { ...fallbackMeta } : null,
    inferred: () => inferredMoves.map(m => ({ san: m.san, matched: m.matched })),
    stockfishFailures: () => stockfishFailureEntries().map(entry => ({ ...entry })),
    stockfishDisabled: () => isStockfishDisabled(),
    disableStockfish: () => {
      setStockfishDisabled(true);
      log('Stockfish attempts disabled. Future runs will use the built-in engine unless you re-enable it.');
    },
    enableStockfish: () => {
      setStockfishDisabled(false);
      log('Re-enabled Stockfish attempts. Clear cached failures or set window.__CHESS_STOCKFISH_RETRY = true before rerunning if needed.');
    },
    clearStockfishFailures: () => {
      clearStockfishFailureCache();
      log('Cleared cached Stockfish failures. Future runs will retry default URLs.');
    },
    trySan: (san) => {
      try {
        const clone = new window.Chess(game.fen());
        const mv = clone.move(san, { sloppy: true });
        if (!mv) return console.warn('[CHESS] illegal SAN', san);
        console.log('[CHESS] after', san, 'FEN=', clone.fen());
      } catch (err) {
        console.warn('[CHESS] illegal SAN', san);
      }
    },
    tryFromTo: (from, to, promotion) => {
      try {
        const clone = new window.Chess(game.fen());
        const mv = clone.move({ from: from.toLowerCase(), to: to.toLowerCase(), promotion: promotion || 'q' });
        if (!mv) return console.warn('[CHESS] illegal from->to', from, to);
        console.log('[CHESS] after', `${from.toUpperCase()}->${to.toUpperCase()} (${mv.san})`, 'FEN=', clone.fen());
      } catch (err) {
        console.warn('[CHESS] illegal from->to', from, to);
      }
    }
  };

  log('Helpers ready: __CHESS. Try __CHESS.legalSAN(), __CHESS.legalPairs(), or __CHESS.trySan("Nf3").');
})();
