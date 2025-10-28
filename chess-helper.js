(async () => {
  const log = (...args) => console.log('[CHESS]', ...args);

  const STOCKFISH_FAILURE_STORAGE_KEY = '__chess_helper_stockfish_failures__';
  const STOCKFISH_FAILURE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days
  const STOCKFISH_DISABLE_STORAGE_KEY = '__chess_helper_stockfish_disabled__';
  const STOCKFISH_INLINE_STORAGE_KEY = '__chess_helper_stockfish_inline_base64__';

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

  function createChessInstance(fen) {
    const globalObj = (typeof window !== 'undefined' && window) || (typeof self !== 'undefined' ? self : null);
    const ChessCtor = globalObj && globalObj.Chess ? globalObj.Chess : null;
    if (!ChessCtor) {
      throw new Error('Chess.js library is not available');
    }
    return typeof fen === 'string' && fen ? new ChessCtor(fen) : new ChessCtor();
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

  let inlineStockfishSessionBase64 = null;
  let inlineStockfishPersistedBase64 = null;
  let inlineStockfishPersistedLoaded = false;

  function normalizeBase64(text) {
    return (text || '').replace(/\s+/g, '').trim();
  }

  function estimateBase64DecodedSize(base64Text) {
    const normalized = normalizeBase64(base64Text);
    if (!normalized) return 0;
    const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
  }

  function loadPersistedInlineStockfishBase64() {
    if (inlineStockfishPersistedLoaded) {
      return inlineStockfishPersistedBase64;
    }
    inlineStockfishPersistedLoaded = true;
    const store = safeLocalStorage();
    if (!store) return null;
    try {
      const value = store.getItem(STOCKFISH_INLINE_STORAGE_KEY);
      inlineStockfishPersistedBase64 = value ? normalizeBase64(value) : null;
    } catch (err) {
      inlineStockfishPersistedBase64 = null;
    }
    return inlineStockfishPersistedBase64;
  }

  function setPersistedInlineStockfishBase64(base64Text) {
    inlineStockfishPersistedBase64 = base64Text ? normalizeBase64(base64Text) : null;
    inlineStockfishPersistedLoaded = true;
    const store = safeLocalStorage();
    if (!store) return;
    try {
      if (inlineStockfishPersistedBase64) {
        store.setItem(STOCKFISH_INLINE_STORAGE_KEY, inlineStockfishPersistedBase64);
      } else {
        store.removeItem(STOCKFISH_INLINE_STORAGE_KEY);
      }
    } catch (err) {
      if (inlineStockfishPersistedBase64) {
        console.warn('[CHESS] Failed to persist Stockfish payload.', err);
      }
    }
  }

  function clearPersistedInlineStockfishBase64() {
    setPersistedInlineStockfishBase64(null);
  }

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
  if (stockfishDisabled) {
    stockfishDisabled = false;
    persistStockfishDisabledFlag(false);
    log('Cleared stored Stockfish disable flag to allow fresh engine attempts.');
  }

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
    const normalized = normalizeBase64(encoded);
    if (!normalized) return null;
    try {
      const binary = atob(normalized);
      if (typeof TextDecoder === 'undefined') {
        return binary;
      }
      const length = binary.length;
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    } catch (err) {
      console.warn('[CHESS] Failed to decode base64 Stockfish payload.', err);
      return null;
    }
  }

  function encodeTextToBase64(text) {
    if (typeof text !== 'string') return null;
    try {
      if (typeof TextEncoder === 'undefined') {
        return btoa(text);
      }
      const encoder = new TextEncoder();
      const bytes = encoder.encode(text);
      const chunk = 0x8000;
      let binary = '';
      for (let i = 0; i < bytes.length; i += chunk) {
        const slice = bytes.subarray(i, i + chunk);
        binary += String.fromCharCode.apply(null, slice);
      }
      return btoa(binary);
    } catch (err) {
      console.warn('[CHESS] Failed to encode Stockfish payload to base64.', err);
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

  function setSessionInlineStockfishBase64(base64Text) {
    inlineStockfishSessionBase64 = base64Text ? normalizeBase64(base64Text) : null;
  }

  function clearSessionInlineStockfishBase64() {
    inlineStockfishSessionBase64 = null;
  }

  function storeInlineStockfishBase64(base64Text, options = {}) {
    const persist = options.persist !== false;
    const normalized = normalizeBase64(base64Text);
    if (!normalized) {
      throw new Error('Empty base64 payload');
    }
    const decoded = decodeBase64ToText(normalized);
    if (!decoded) {
      throw new Error('Invalid base64 payload');
    }
    if (persist) {
      setPersistedInlineStockfishBase64(normalized);
      clearSessionInlineStockfishBase64();
    } else {
      setSessionInlineStockfishBase64(normalized);
    }
    return { persisted: persist, decodedBytes: decoded.length };
  }

  async function storeInlineStockfishFromUrl(url, options = {}) {
    if (!url || typeof url !== 'string') {
      throw new Error('URL is required');
    }
    const script = await fetchText(url.trim());
    const base64 = encodeTextToBase64(script);
    if (!base64) {
      throw new Error('Failed to encode fetched Stockfish script to base64');
    }
    const result = storeInlineStockfishBase64(base64, options);
    return { ...result, url: url.trim() };
  }

  async function createStockfishWorker(url) {
    const script = await fetchText(url);
    if (/^\s*</.test(script)) {
      throw new Error('Unexpected HTML response');
    }
    return createWorkerFromSource(script);
  }

  let stockfishPromise = window.__STOCKFISH_PROMISE || null;

  let BUILTIN_ENGINE_SOURCE = null;

  async function ensureStockfishEngine() {
    if (window.__STOCKFISH_ENGINE_INSTANCE) return window.__STOCKFISH_ENGINE_INSTANCE;
    if (stockfishPromise) return stockfishPromise;

    const defaultEngineUrls = [];

    const overrideUrls = Array.isArray(window.__CHESS_STOCKFISH_URLS)
      ? window.__CHESS_STOCKFISH_URLS.filter(url => typeof url === 'string' && url.trim().length > 0)
      : [];

    const inlinePayloads = [];
    const inlineBase64Seen = new Set();
    const pushInline = (code, label) => {
      if (!code || typeof code !== 'string' || !code.trim()) return;
      inlinePayloads.push({ code, label });
    };

    const persistedBase64 = loadPersistedInlineStockfishBase64();
    const base64Candidates = [];
    if (inlineStockfishSessionBase64) {
      base64Candidates.push({
        base64: inlineStockfishSessionBase64,
        label: 'inline:session',
        persisted: false
      });
    }
    if (persistedBase64) {
      base64Candidates.push({
        base64: persistedBase64,
        label: 'inline:stored',
        persisted: true
      });
    }

    for (const candidate of base64Candidates) {
      const normalized = normalizeBase64(candidate.base64);
      if (!normalized || inlineBase64Seen.has(normalized)) continue;
      inlineBase64Seen.add(normalized);
      const decoded = decodeBase64ToText(normalized);
      if (decoded) {
        log(`Using ${candidate.label} Stockfish payload (≈${estimateBase64DecodedSize(normalized)} bytes decoded).`);
        pushInline(decoded, candidate.label);
      } else if (candidate.persisted) {
        console.warn('[CHESS] Stored Stockfish payload could not be decoded and was removed.');
        clearPersistedInlineStockfishBase64();
      } else {
        console.warn('[CHESS] Session Stockfish payload could not be decoded and was ignored.');
        clearSessionInlineStockfishBase64();
      }
    }

    if (typeof window.__CHESS_STOCKFISH_INLINE === 'string') {
      pushInline(window.__CHESS_STOCKFISH_INLINE, 'inline:custom');
    } else if (Array.isArray(window.__CHESS_STOCKFISH_INLINE)) {
      window.__CHESS_STOCKFISH_INLINE.forEach((item, index) => {
        if (typeof item === 'string' && item.trim().length > 0) {
          pushInline(item, `inline:custom#${index + 1}`);
        }
      });
    }

    if (typeof window.__CHESS_STOCKFISH_INLINE_BASE64 === 'string') {
      const decoded = decodeBase64ToText(window.__CHESS_STOCKFISH_INLINE_BASE64.trim());
      if (decoded) pushInline(decoded, 'inline:custom-base64');
    }

    if (Array.isArray(window.__CHESS_STOCKFISH_INLINE_BASE64)) {
      window.__CHESS_STOCKFISH_INLINE_BASE64.forEach((item, index) => {
        if (typeof item === 'string' && item.trim().length > 0) {
          const decoded = decodeBase64ToText(item.trim());
          if (decoded) pushInline(decoded, `inline:custom-base64#${index + 1}`);
        }
      });
    }

    const builtinDisabled = window.__CHESS_DISABLE_BUILTIN_ENGINE === true;
    if (!builtinDisabled) {
      pushInline(getBuiltinEngineSource(), 'inline:builtin');
    }

    const stockfishForced = window.__CHESS_STOCKFISH_FORCE === true;
    const disableForSession = isStockfishDisabled() && !stockfishForced;

    const candidateUrls = Array.from(new Set([...overrideUrls, ...defaultEngineUrls]));

    const retryCachedFailures = window.__CHESS_STOCKFISH_RETRY !== false;
    const filteredCandidateUrls = retryCachedFailures
      ? candidateUrls
      : candidateUrls.filter(url => !stockfishFailureCache[url]);

    if (!retryCachedFailures) {
      const skipped = candidateUrls.filter(url => stockfishFailureCache[url]);
      if (skipped.length) {
        log('Skipping Stockfish URLs with cached failures:', skipped);
      }
    } else {
      const retried = candidateUrls.filter(url => stockfishFailureCache[url]);
      if (retried.length) {
        log('Retrying Stockfish URLs despite previous failures:', retried);
      }
    }

    if (disableForSession && !inlinePayloads.length && overrideUrls.length === 0) {
      log('Stockfish disabled after repeated failures. Call __CHESS.enableStockfish() or set window.__CHESS_STOCKFISH_FORCE = true to retry.');
      const error = new Error('Stockfish disabled after repeated failures');
      error.silent = true;
      throw error;
    }

    if (!filteredCandidateUrls.length && !inlinePayloads.length) {
      const error = new Error('All Stockfish URLs previously failed. Run __CHESS.clearStockfishFailures() or set window.__CHESS_STOCKFISH_RETRY = true to retry.');
      error.silent = true;
      throw error;
    }

    stockfishPromise = window.__STOCKFISH_PROMISE = (async () => {
      if (!window.Worker) throw new Error('Web Workers not supported in this browser');

      for (const payload of inlinePayloads) {
        const { code, label } = typeof payload === 'string'
          ? { code: payload, label: 'inline:custom' }
          : { code: payload.code, label: payload.label || 'inline:custom' };
        let worker;
        let blobUrl;
        try {
          ({ worker, blobUrl } = createWorkerFromSource(code));
          const engine = new StockfishEngine(worker, label);
          await engine.init();
          engine.blobUrl = blobUrl;
          window.__STOCKFISH_ENGINE_INSTANCE = engine;
          window.__STOCKFISH_ENGINE_URL = label;
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

      if (!stockfishForced && !inlinePayloads.length && attemptedUrls.length && !isStockfishDisabled()) {
        log('Stockfish URL attempts failed; continuing with fallback search. Use __CHESS.disableStockfish() to skip future external tries.');
      }

      const failure = new Error('Unable to load Stockfish engine from provided URLs');
      failure.silent = filteredCandidateUrls.length === 0;
      throw failure;
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
      const chess = createChessInstance(fen);
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
      const chess = createChessInstance(fen);
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
    const game = createChessInstance();
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
  const KING_VALUE = 100;

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
        const whiteGame = createChessInstance(segments.join(' '));
        whiteMobility = whiteGame.moves().length;
      } catch (err) {
        whiteMobility = 0;
      }
      segments[1] = 'b';
      try {
        const blackGame = createChessInstance(segments.join(' '));
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

  function simpleMoveKey(move) {
    return `${move.from}-${move.to}-${move.promotion || ''}`;
  }

  function createSearchMeta() {
    return {
      killerMoves: new Map(),
      historyScores: new Map(),
      orderingScores: new Map()
    };
  }

  function killerMoveScore(searchMeta, ply, move) {
    if (!searchMeta) return 0;
    const list = searchMeta.killerMoves.get(ply);
    if (!list) return 0;
    const key = simpleMoveKey(move);
    for (let i = 0; i < list.length; i++) {
      if (list[i] === key) {
        return 3 - i;
      }
    }
    return 0;
  }

  function recordKillerMove(searchMeta, ply, move) {
    if (!searchMeta) return;
    if (move.captured || move.flags.includes('p')) return;
    const key = simpleMoveKey(move);
    let list = searchMeta.killerMoves.get(ply);
    if (!list) {
      list = [];
      searchMeta.killerMoves.set(ply, list);
    }
    if (list.includes(key)) return;
    list.unshift(key);
    if (list.length > 2) list.length = 2;
  }

  function updateHistoryScore(searchMeta, move, depth) {
    if (!searchMeta) return;
    if (move.captured || move.flags.includes('p')) return;
    const key = simpleMoveKey(move);
    const current = searchMeta.historyScores.get(key) || 0;
    searchMeta.historyScores.set(key, current + depth * depth);
  }

  function historyScore(searchMeta, move) {
    if (!searchMeta) return 0;
    const key = simpleMoveKey(move);
    const value = searchMeta.historyScores.get(key) || 0;
    return Math.min(3.5, value / 220);
  }

  function orderingMapFor(searchMeta, ply) {
    if (!searchMeta) return null;
    let map = searchMeta.orderingScores.get(ply);
    if (!map) {
      map = new Map();
      searchMeta.orderingScores.set(ply, map);
    } else {
      map.clear();
    }
    return map;
  }

  function storeOrderingScore(orderMap, move, score) {
    if (!orderMap) return;
    orderMap.set(moveKey(move), score);
  }

  function lookupOrderingScore(searchMeta, ply, move) {
    if (!searchMeta) return 0;
    const map = searchMeta.orderingScores.get(ply);
    if (!map) return 0;
    return map.get(moveKey(move)) || 0;
  }

  function isForcingMove(move) {
    return !!(move.captured || move.flags.includes('p') || /[+#]/.test(move.san));
  }

  function findKingSquare(game, color) {
    const board = typeof game.board === 'function' ? game.board() : null;
    if (!board) return null;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row]?.[col];
        if (piece && piece.type === 'k' && piece.color === color) {
          const file = String.fromCharCode(97 + col);
          const rank = 8 - row;
          return `${file}${rank}`;
        }
      }
    }
    return null;
  }

  function evaluateMoveConsequences(game, move) {
    let penalty = 0;
    let checkBonus = 0;
    game.move(move);
    try {
      if (game.in_check()) {
        checkBonus += 0.6;
      }

      const opponentMoves = game.moves({ verbose: true });
      let minAttacker = Infinity;
      let pawnThreat = false;
      for (const reply of opponentMoves) {
        if (reply.to === move.to) {
          const value = pieceValues[reply.piece] ?? (reply.piece === 'k' ? KING_VALUE : 0);
          if (value < minAttacker) minAttacker = value;
          if (reply.piece === 'p') pawnThreat = true;
        }
      }

      if (minAttacker !== Infinity) {
        let defenders = 0;
        try {
          const fenParts = game.fen().split(' ');
          fenParts[1] = move.color;
          const defenderGame = createChessInstance(fenParts.join(' '));
          defenders = defenderGame.moves({ verbose: true }).filter(m => m.to === move.to).length;
        } catch (err) {
          defenders = 0;
        }

        const movedValue = pieceValues[move.piece] ?? (move.piece === 'k' ? KING_VALUE : 0);
        const attackValue = minAttacker;
        if (attackValue < movedValue - 0.05) {
          const diff = movedValue - attackValue;
          const modifier = defenders > 0 ? 0.55 : 1.15;
          penalty += diff * modifier;
        }
        if (pawnThreat && movedValue > 1.5) {
          penalty += defenders > 0 ? 0.25 : 0.6;
        }
      }

      const kingSquare = findKingSquare(game, move.color);
      if (kingSquare) {
        const underAttack = opponentMoves.some(reply => reply.to === kingSquare);
        if (underAttack) penalty += 0.9;
      }
    } finally {
      game.undo();
    }
    return { penalty, checkBonus };
  }

  function movePriority(game, move, context, preferenceMap, searchMeta, ply) {
    let score = 0;
    if (preferenceMap) {
      const pref = preferenceMap.get(moveKey(move));
      if (pref !== undefined) {
        score += 60 - pref;
      }
    }

    if (searchMeta) {
      score += killerMoveScore(searchMeta, ply, move);
      score += historyScore(searchMeta, move);
    }

    if (move.captured) {
      const captureWeights = { p: 1, n: 2, b: 2, r: 3, q: 4, k: 6 };
      score += 4 + (captureWeights[move.captured] || 0);
    }
    if (move.flags.includes('c')) score += 1.5;
    if (/[+#]/.test(move.san)) score += move.san.includes('#') ? 5 : 2.5;
    if (move.flags.includes('p')) score += 6;
    if (move.flags.includes('k') || move.flags.includes('q')) score += 3.2;

    const openingPhase = context ? context.moveCount < 16 : false;
    const veryEarly = context ? context.moveCount < 8 : false;

    if ((move.piece === 'n' || move.piece === 'b') && minorPieceStartSquares.has(move.from)) {
      score += openingPhase ? 1.6 : 0.5;
      if (coreCenterSquares.has(move.to)) score += 0.65;
      else if (extendedCenterSquares.has(move.to)) score += 0.45;
    }

    if (move.piece === 'p') {
      if (coreCenterSquares.has(move.to)) score += 0.7;
      else if (extendedCenterSquares.has(move.to)) score += 0.35;

      if (flankFiles.has(move.from[0])) {
        score -= openingPhase ? 1.1 : 0.3;
        if (veryEarly) score -= 0.7;
      }
    } else if (coreCenterSquares.has(move.to)) {
      score += 0.45;
    } else if (extendedCenterSquares.has(move.to)) {
      score += 0.27;
    }

    if (move.san === 'O-O' || move.san === 'O-O-O') {
      score += 3.8;
    }

    const consequence = evaluateMoveConsequences(game, move);
    score += consequence.checkBonus;
    score -= consequence.penalty;

    return score;
  }

  function orderedMoves(game, context, preferenceMap, searchMeta, ply = 0, captureOnly = false) {
    const moves = game.moves({ verbose: true });
    const orderMap = orderingMapFor(searchMeta, ply);
    const scored = [];
    for (const move of moves) {
      if (captureOnly && !isForcingMove(move)) continue;
      const value = movePriority(game, move, context, preferenceMap, searchMeta, ply);
      storeOrderingScore(orderMap, move, value);
      scored.push({ move, value });
    }
    scored.sort((a, b) => b.value - a.value);
    return scored.map(entry => entry.move);
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

  function quiescence(game, alpha, beta, perspective, plyCount, stats, context, deadline, nowFn, searchMeta, limit = 6, shouldStop) {
    if ((shouldStop && shouldStop()) || (deadline && nowFn && nowFn() > deadline)) {
      stats.timeouts = (stats.timeouts || 0) + 1;
      return evaluateForPerspective(game, perspective, context);
    }
    stats.nodes += 1;
    const standPat = evaluateTerminalState(game, perspective, plyCount, context);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (limit <= 0) return standPat;

    const captureMoves = orderedMoves(game, context, null, searchMeta, plyCount, true);
    for (const move of captureMoves) {
      game.move(move);
      const score = -quiescence(game, -beta, -alpha, perspective, plyCount + 1, stats, context, deadline, nowFn, searchMeta, limit - 1, shouldStop);
      game.undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(game, depth, alpha, beta, perspective, table, plyCount, stats, context, deadline, nowFn, searchMeta, shouldStop) {
    if ((shouldStop && shouldStop()) || (deadline && nowFn && nowFn() > deadline)) {
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
      return quiescence(game, alpha, beta, perspective, plyCount, stats, context, deadline, nowFn, searchMeta, 6, shouldStop);
    }

    const moves = orderedMoves(game, context, null, searchMeta, plyCount);
    const limit = depth >= 3 ? Math.min(moves.length, 14) : Math.min(moves.length, 18);
    let bestValue = -Infinity;
    let bestFlag = 'upper';
    let bestChild = null;

    for (let i = 0; i < limit; i++) {
      const move = moves[i];
      game.move(move);
      let nextDepth = depth - 1;
      const givesCheck = game.in_check();
      if (givesCheck && nextDepth >= 0) {
        nextDepth = Math.min(depth, nextDepth + 1);
      }
      if (!isForcingMove(move) && depth >= 3 && i > 5 && nextDepth > 1) {
        nextDepth -= 1;
      }

      let score;
      if (game.in_checkmate()) {
        score = evaluateTerminalState(game, perspective, plyCount + 1, context);
      } else {
        score = -negamax(game, nextDepth, -beta, -alpha, perspective, table, plyCount + 1, stats, context, deadline, nowFn, searchMeta, shouldStop);
      }
      game.undo();

      if (score > bestValue) {
        bestValue = score;
        bestChild = { from: move.from, to: move.to, promotion: move.promotion || null };
      }
      if (score > alpha) {
        alpha = score;
        bestFlag = 'exact';
        updateHistoryScore(searchMeta, move, depth);
      }
      if (alpha >= beta) {
        recordKillerMove(searchMeta, plyCount, move);
        updateHistoryScore(searchMeta, move, depth);
        bestFlag = 'lower';
        break;
      }
    }

    if (!moves.length) {
      bestValue = evaluateTerminalState(game, perspective, plyCount, context);
      bestFlag = 'exact';
    }

    table.set(key, { depth, value: bestValue, flag: bestFlag, best: bestChild });
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

  function principalVariationFromTable(fen, table, maxLength = 12) {
    const pv = [];
    if (!fen) return pv;
    let chess;
    try {
      chess = createChessInstance(fen);
    } catch (err) {
      return pv;
    }
    const seen = new Set();
    for (let depth = 0; depth < maxLength; depth++) {
      const key = chess.fen();
      if (seen.has(key)) break;
      seen.add(key);
      const entry = table.get(key);
      if (!entry || !entry.best) break;
      const move = chess.move({
        from: entry.best.from,
        to: entry.best.to,
        promotion: entry.best.promotion || undefined
      });
      if (!move) break;
      pv.push(move);
      if (chess.game_over()) break;
    }
    return pv;
  }

  function analyzeFallback(game, options = {}) {
    const evalContext = createEvaluationContext(game);
    const searchMeta = createSearchMeta();
    const initialMoves = orderedMoves(game, evalContext, null, searchMeta, 0);
    if (!initialMoves.length) {
      return { best: null, details: [], depth: 0, considered: 0, elapsed: 0, aborted: false };
    }

    const perspective = game.turn();
    const moveCount = evalContext.moveCount;
    const preferredDepth = typeof options.depth === 'number' ? Math.max(1, Math.floor(options.depth)) : null;
    const depthCap = typeof options.maxDepth === 'number' ? Math.max(1, Math.floor(options.maxDepth)) : null;
    const depthFloor = typeof options.minDepth === 'number' ? Math.max(1, Math.floor(options.minDepth)) : null;
    let targetDepth = preferredDepth ?? chooseFallbackDepth(moveCount, initialMoves.length);
    if (depthCap !== null) targetDepth = Math.min(targetDepth, depthCap);
    if (depthFloor !== null) targetDepth = Math.max(targetDepth, depthFloor);

    const table = new Map();
    const stats = { nodes: 0, timeouts: 0 };
    const preferenceMap = new Map();

    const nowFn = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? () => performance.now()
      : () => Date.now();
    const timeBudget = typeof options.timeBudget === 'number'
      ? Math.max(0, options.timeBudget)
      : (typeof window !== 'undefined' && typeof window.__CHESS_FALLBACK_TIME === 'number'
        ? Math.max(250, window.__CHESS_FALLBACK_TIME)
        : 1700);
    const startTime = nowFn();
    const deadline = Number.isFinite(timeBudget) && timeBudget > 0 ? startTime + timeBudget : null;
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : null;

    let reachedDepth = 0;
    let aborted = false;
    let finalResults = initialMoves.map(move => ({ move, score: 0 }));
    let bestSummary = null;

    for (let depth = 1; depth <= targetDepth; depth++) {
      if (shouldStop && shouldStop()) {
        aborted = true;
        break;
      }
      const candidateMoves = orderedMoves(game, evalContext, preferenceMap, searchMeta, 0);
      const limit = Math.min(candidateMoves.length, depth >= 4 ? 20 : 24);
      const iteration = [];
      let alpha = -Infinity;
      let beta = Infinity;

      for (let i = 0; i < limit; i++) {
        if ((shouldStop && shouldStop()) || (deadline && nowFn() > deadline)) {
          aborted = true;
          break;
        }
        const move = candidateMoves[i];
        game.move(move);
        let score;
        if (game.in_checkmate()) {
          score = evaluateTerminalState(game, perspective, 1, evalContext);
        } else {
          score = -negamax(game, depth - 1, -beta, -alpha, perspective, table, 1, stats, evalContext, deadline, nowFn, searchMeta, shouldStop);
        }
        const checkBonus = game.in_check() ? 0.25 : 0;
        game.undo();

        const orderBoost = lookupOrderingScore(searchMeta, 0, move) * 0.02;
        const normalized = score + checkBonus + orderBoost;
        iteration.push({ move, rawScore: score, score: normalized });
        if (score > alpha) alpha = score;
        if ((shouldStop && shouldStop()) || (deadline && nowFn() > deadline)) {
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

    const rootFen = game.fen();
    const detailedResults = finalResults.map(entry => {
      const clone = createChessInstance(rootFen);
      const pvMoves = [];
      const first = clone.move({ from: entry.move.from, to: entry.move.to, promotion: entry.move.promotion });
      if (first) {
        pvMoves.push(first);
        const continuation = principalVariationFromTable(clone.fen(), table, targetDepth + 4);
        pvMoves.push(...continuation);
      }
      return {
        move: entry.move,
        score: entry.score,
        pv: pvMoves,
        pvSan: pvMoves.map(m => m.san)
      };
    });

    finalResults = detailedResults;
    bestSummary = finalResults[0] || null;

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

  function sanitizeFunctionForWorker(fn) {
    return fn
      .toString()
      .replace(/window\./g, '')
      .replace(/\bcreateChessInstance\(/g, 'createChessInstance(');
  }

  function buildBuiltinEngineSource() {
    const jsonPieceValues = JSON.stringify(pieceValues);
    const jsonPieceSquareTables = JSON.stringify(pieceSquareTables);
    const jsonKingSquareTables = JSON.stringify(kingSquareTables);
    const jsonCoreCenter = JSON.stringify(Array.from(coreCenterSquares));
    const jsonExtendedCenter = JSON.stringify(Array.from(extendedCenterSquares));
    const jsonMinorStarts = JSON.stringify(Array.from(minorPieceStartSquares));
    const jsonFlankFiles = JSON.stringify(Array.from(flankFiles));

    const functionSources = [
      createEvaluationContext,
      pieceSquareValue,
      evaluatePosition,
      evaluateForPerspective,
      moveKey,
      simpleMoveKey,
      createSearchMeta,
      killerMoveScore,
      recordKillerMove,
      updateHistoryScore,
      historyScore,
      orderingMapFor,
      storeOrderingScore,
      lookupOrderingScore,
      isForcingMove,
      findKingSquare,
      evaluateMoveConsequences,
      movePriority,
      orderedMoves,
      evaluateTerminalState,
      quiescence,
      negamax,
      chooseFallbackDepth,
      principalVariationFromTable,
      analyzeFallback
    ].map(sanitizeFunctionForWorker);

    return String.raw`(function() {
      'use strict';
      const ctx = self;
      function send(line) { ctx.postMessage(line); }
      try {
        importScripts('https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.2/chess.min.js');
      } catch (err) {
        send('info string Failed to load chess.js: ' + (err && err.message ? err.message : err));
        send('uciok');
        send('readyok');
        return;
      }
      const Chess = self.Chess;
      if (!Chess) {
        send('info string Chess.js unavailable in worker');
        send('uciok');
        send('readyok');
        return;
      }

      const pieceValues = ${jsonPieceValues};
      const pieceSquareTables = ${jsonPieceSquareTables};
      const kingSquareTables = ${jsonKingSquareTables};
      const coreCenterSquares = new Set(${jsonCoreCenter});
      const extendedCenterSquares = new Set(${jsonExtendedCenter});
      const minorPieceStartSquares = new Set(${jsonMinorStarts});
      const flankFiles = new Set(${jsonFlankFiles});

      function createChessInstance(fen) {
        return typeof fen === 'string' && fen ? new Chess(fen) : new Chess();
      }

${functionSources.join('\n\n')}

      function movesToUci(list) {
        return list.map(move => move.from + move.to + (move.promotion ? move.promotion : ''));
      }

      function analyzeFen(fen, options) {
        const game = createChessInstance(fen);
        return analyzeFallback(game, options);
      }

      let currentFen = createChessInstance().fen();
      let multiPv = 3;
      let defaultMoveTime = 1500;
      let forcedDepth = null;
      let searchId = 0;
      let stopRequested = false;

      function applyPosition(tokens) {
        if (tokens.length < 2) {
          currentFen = createChessInstance().fen();
          return;
        }
        let fen = null;
        let movesIndex = tokens.indexOf('moves');
        if (tokens[1] === 'startpos') {
          fen = createChessInstance().fen();
        } else if (tokens[1] === 'fen') {
          const fenTokens = movesIndex === -1 ? tokens.slice(2) : tokens.slice(2, movesIndex);
          fen = fenTokens.join(' ');
        }
        if (!fen) {
          fen = createChessInstance().fen();
        }
        let chess;
        try {
          chess = createChessInstance(fen);
        } catch (err) {
          send('info string Invalid FEN supplied to built-in engine');
          chess = createChessInstance();
        }
        if (movesIndex !== -1) {
          const moveTokens = tokens.slice(movesIndex + 1);
          for (const token of moveTokens) {
            if (!token) continue;
            const from = token.slice(0, 2);
            const to = token.slice(2, 4);
            const promotion = token.length > 4 ? token.slice(4, 5) : undefined;
            const result = chess.move({ from, to, promotion });
            if (!result) break;
          }
        }
        currentFen = chess.fen();
      }

      function parseGo(tokens) {
        const result = {};
        for (let i = 1; i < tokens.length; i++) {
          const token = tokens[i];
          if (token === 'depth' && i + 1 < tokens.length) {
            const value = parseInt(tokens[++i], 10);
            if (Number.isFinite(value)) result.depth = value;
          } else if (token === 'movetime' && i + 1 < tokens.length) {
            const value = parseInt(tokens[++i], 10);
            if (Number.isFinite(value)) result.movetime = value;
          } else if (token === 'wtime' && i + 1 < tokens.length) {
            const value = parseInt(tokens[++i], 10);
            if (Number.isFinite(value)) result.wtime = value;
          } else if (token === 'btime' && i + 1 < tokens.length) {
            const value = parseInt(tokens[++i], 10);
            if (Number.isFinite(value)) result.btime = value;
          }
        }
        return result;
      }

      function effectiveMoveTime(params, activeColor) {
        if (Number.isFinite(params.movetime) && params.movetime > 0) return params.movetime;
        if (activeColor === 'w' && Number.isFinite(params.wtime)) return Math.max(100, params.wtime / 30);
        if (activeColor === 'b' && Number.isFinite(params.btime)) return Math.max(100, params.btime / 30);
        return defaultMoveTime;
      }

      function startSearch(params) {
        const id = ++searchId;
        stopRequested = false;
        const fen = currentFen;
        const activeColor = fen.split(' ')[1] || 'w';
        const timeBudget = effectiveMoveTime(params, activeColor);
        const depth = Number.isFinite(params.depth) ? params.depth : forcedDepth;

        const analysis = analyzeFen(fen, {
          timeBudget,
          depth,
          maxDepth: depth,
          shouldStop: () => stopRequested
        });

        if (id !== searchId || stopRequested) {
          return;
        }

        const lines = analysis.details.slice(0, Math.max(1, multiPv));
        if (!lines.length) {
          send('bestmove 0000');
          return;
        }

        lines.forEach((entry, index) => {
          const pvList = entry.pv && entry.pv.length ? entry.pv : [entry.move];
          const uciPv = movesToUci(pvList);
          const cpScore = Math.round((entry.score || 0) * 100);
          send(
            'info depth ' + analysis.depth +
            ' multipv ' + (index + 1) +
            ' score cp ' + cpScore +
            ' nodes ' + (analysis.considered || 0) +
            ' pv ' + uciPv.join(' ')
          );
        });

        const best = lines[0];
        const bestMove = best.move.from + best.move.to + (best.move.promotion ? best.move.promotion : '');
        const ponderMove = best.pv && best.pv.length > 1
          ? best.pv[1].from + best.pv[1].to + (best.pv[1].promotion ? best.pv[1].promotion : '')
          : null;
        send('bestmove ' + bestMove + (ponderMove ? ' ponder ' + ponderMove : ''));
      }

      self.onmessage = function(event) {
        const raw = event && event.data;
        if (typeof raw !== 'string') return;
        const line = raw.trim();
        if (!line) return;
        const tokens = line.split(/\s+/);
        const command = tokens[0];

        if (command === 'uci') {
          send('id name ChessHelper Built-in Engine');
          send('id author SanFen Helper');
          send('uciok');
          return;
        }
        if (command === 'isready') {
          send('readyok');
          return;
        }
        if (command === 'ucinewgame') {
          currentFen = createChessInstance().fen();
          stopRequested = false;
          return;
        }
        if (command === 'position') {
          applyPosition(tokens);
          return;
        }
        if (command === 'setoption') {
          const nameIndex = tokens.indexOf('name');
          const valueIndex = tokens.indexOf('value');
          if (nameIndex !== -1) {
            const name = tokens.slice(nameIndex + 1, valueIndex === -1 ? undefined : valueIndex).join(' ').toLowerCase();
            const value = valueIndex !== -1 ? tokens.slice(valueIndex + 1).join(' ') : '';
            if (name === 'multipv') {
              const numeric = parseInt(value, 10);
              if (Number.isFinite(numeric) && numeric >= 1) multiPv = Math.max(1, numeric);
            } else if (name === 'movetime' || name === 'builtintime') {
              const numeric = parseInt(value, 10);
              if (Number.isFinite(numeric) && numeric > 0) defaultMoveTime = numeric;
            } else if (name === 'depth' || name === 'builtindepth') {
              const numeric = parseInt(value, 10);
              forcedDepth = Number.isFinite(numeric) && numeric > 0 ? numeric : null;
            }
          }
          return;
        }
        if (command === 'go') {
          startSearch(parseGo(tokens));
          return;
        }
        if (command === 'stop') {
          stopRequested = true;
          return;
        }
        if (command === 'quit') {
          try { self.close(); } catch (err) { /* ignore */ }
        }
      };
    })();`;
  }

  function getBuiltinEngineSource() {
    if (!BUILTIN_ENGINE_SOURCE) {
      BUILTIN_ENGINE_SOURCE = buildBuiltinEngineSource();
    }
    return BUILTIN_ENGINE_SOURCE;
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
      if (!err || !err.silent) {
        console.warn('[CHESS] Stockfish analysis unavailable.', err);
      }
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
      const continuation = Array.isArray(entry.pvSan) ? entry.pvSan.slice(1) : [];
      const pvTail = continuation.length ? ` → ${continuation.join(' ')}` : '';
      return `${entry.move.san}  ${entry.move.from.toUpperCase()}->${entry.move.to.toUpperCase()} (score≈${scoreValue.toFixed(2)})${pvTail}`;
    });
    fallbackDetails = topMoves.map(entry => {
      const scoreValue = typeof entry.score === 'number' ? entry.score : 0;
      const continuation = Array.isArray(entry.pvSan) ? entry.pvSan.slice(1) : [];
      const pvTail = continuation.length ? ` → ${continuation.join(' ')}` : '';
      return {
        san: entry.move.san,
        from: entry.move.from.toUpperCase(),
        to: entry.move.to.toUpperCase(),
        score: scoreValue,
        detail: `${entry.move.san}  ${entry.move.from.toUpperCase()}->${entry.move.to.toUpperCase()} (score≈${scoreValue.toFixed(2)})${pvTail}`,
        pvSan: Array.isArray(entry.pvSan) ? entry.pvSan.slice() : []
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
      const { move, score, pvSan } = fallback.best;
      const scoreValue = typeof score === 'number' ? score : 0;
      const continuation = Array.isArray(pvSan) ? pvSan.slice(1) : [];
      const pvTail = continuation.length ? ` → ${continuation.join(' ')}` : '';
      bestRecommendation = `${move.san} (${move.from.toUpperCase()}->${move.to.toUpperCase()})`;
      log('RECOMMENDATION:', `${move.san}  ${move.from.toUpperCase()}->${move.to.toUpperCase()} (score≈${scoreValue.toFixed(2)})${pvTail}`);
    } else {
      log('RECOMMENDATION: (no legal moves found)');
    }
  }

  if (engineError) {
    if (engineError.silent) {
      log('ENGINE STATUS: Stockfish unavailable, using built-in search. (__CHESS.enableStockfish() to retry)');
    } else {
      log('ENGINE ERROR:', engineError.message || engineError);
    }
  }

  window.__CHESS = {
    version: 'helper-18',
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
    stockfishInfo: () => {
      const persisted = loadPersistedInlineStockfishBase64();
      return {
        engineUrl: window.__STOCKFISH_ENGINE_URL || null,
        storedInline: !!persisted,
        storedInlineBytes: estimateBase64DecodedSize(persisted),
        sessionInline: !!inlineStockfishSessionBase64,
        sessionInlineBytes: estimateBase64DecodedSize(inlineStockfishSessionBase64),
        disabled: isStockfishDisabled(),
        failures: stockfishFailureEntries().map(entry => ({ ...entry }))
      };
    },
    storeStockfishInline: (base64, options) => {
      try {
        const result = storeInlineStockfishBase64(base64, options || {});
        log(`Stored inline Stockfish payload (${result.persisted ? 'persisted' : 'session-only'}; decoded≈${result.decodedBytes} bytes).`);
        return result;
      } catch (err) {
        console.error('[CHESS] Failed to store inline Stockfish payload.', err);
        throw err;
      }
    },
    storeStockfishFromUrl: async (url, options) => {
      try {
        const result = await storeInlineStockfishFromUrl(url, options || {});
        log(`Fetched and stored Stockfish from ${result.url} (${result.persisted ? 'persisted' : 'session-only'}; decoded≈${result.decodedBytes} bytes).`);
        return result;
      } catch (err) {
        console.error('[CHESS] Failed to fetch or store Stockfish from URL.', err);
        throw err;
      }
    },
    clearStoredStockfishInline: () => {
      clearSessionInlineStockfishBase64();
      clearPersistedInlineStockfishBase64();
      log('Cleared stored inline Stockfish payloads.');
    },
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
        const clone = createChessInstance(game.fen());
        const mv = clone.move(san, { sloppy: true });
        if (!mv) return console.warn('[CHESS] illegal SAN', san);
        console.log('[CHESS] after', san, 'FEN=', clone.fen());
      } catch (err) {
        console.warn('[CHESS] illegal SAN', san);
      }
    },
    tryFromTo: (from, to, promotion) => {
      try {
        const clone = createChessInstance(game.fen());
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
