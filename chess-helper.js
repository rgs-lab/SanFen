(async () => {
  const log = (...args) => console.log('[CHESS]', ...args);

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
      .replace(/[!?]+/g, '')
      .replace(/[…]+/g, '')
      .replace(/[†‡]/g, '')
      .trim();
  }

  function tryApplyToken(game, token) {
    if (!token || token === '...') return null;
    const normalized = token
      .replace(/^0-0-0$/i, 'O-O-O')
      .replace(/^0-0$/i, 'O-O');

    const directCandidates = [normalized];
    for (const candidate of directCandidates) {
      if (!candidate) continue;
      try {
        const move = game.move(candidate, { sloppy: true });
        if (move) return move;
      } catch (err) {
        // try fallbacks below
      }
    }

    const legalMoves = game.moves({ verbose: true });
    const canonicalToken = canonicalSan(normalized);
    const tokenTarget = canonicalToken.slice(-2);

    const matchingMoves = [];
    for (const legal of legalMoves) {
      const canonicalLegal = canonicalSan(legal.san);
      if (canonicalLegal === canonicalToken) {
        matchingMoves.push({ legal, weight: 3 + (legal.flags.includes('c') ? 0.5 : 0) });
        continue;
      }
      if (canonicalToken && canonicalLegal.endsWith(canonicalToken)) {
        matchingMoves.push({ legal, weight: 2 + (legal.flags.includes('c') ? 0.5 : 0) });
        continue;
      }
      if (canonicalToken && canonicalToken.length <= 3 && tokenTarget && canonicalLegal.endsWith(tokenTarget)) {
        matchingMoves.push({ legal, weight: 1 + (legal.flags.includes('c') ? 0.5 : 0) });
      }
    }

    let matched = null;
    if (matchingMoves.length) {
      matchingMoves.sort((a, b) => b.weight - a.weight);
      matched = matchingMoves[0].legal;
    }

    if (!matched && /^[a-h][1-8]$/.test(tokenTarget)) {
      const byTarget = legalMoves.filter(m => m.to === tokenTarget);
      if (byTarget.length === 1) {
        matched = byTarget[0];
      }
    }

    if (matched) {
      return game.move({ from: matched.from, to: matched.to, promotion: matched.promotion });
    }

    return null;
  }

  function extractSanMoves(rawText) {
    const cleaned = normalizeFigurines(rawText)
      .replace(/\r?\n/g, ' ')
      .replace(/…/g, ' ')
      .replace(/\d+\.(?:\s*\.{3})?/g, ' ')
      .replace(/\b(?:1-0|0-1|1\/2-1\/2|\*)\b/g, ' ')
      .replace(/[\u00A0\t]+/g, ' ')
      .replace(/\s+/g, ' ');

    const tentativeTokens = cleaned.split(' ').map(t => cleanToken(t)).filter(Boolean);
    const parsingGame = new window.Chess();
    const appliedMoves = [];
    const ignored = [];

    for (const token of tentativeTokens) {
      const move = tryApplyToken(parsingGame, token);
      if (move) {
        appliedMoves.push(move);
      } else {
        ignored.push(token);
      }
    }

    return { moves: appliedMoves, ignored };
  }

  function evaluateMaterial(chess) {
    const values = { p: 1, n: 3.2, b: 3.3, r: 5.1, q: 9.5, k: 0 };
    let total = 0;
    const board = chess.board();
    for (const row of board) {
      for (const piece of row) {
        if (!piece) continue;
        const value = values[piece.type] || 0;
        total += piece.color === 'w' ? value : -value;
      }
    }
    return total;
  }

  function scoreMove(currentGame, move, baseEval) {
    const clone = new window.Chess(currentGame.fen());
    clone.move({ from: move.from, to: move.to, promotion: move.promotion });
    let score = evaluateMaterial(clone) - baseEval;
    if (move.captured) {
      const captureValues = { p: 0.5, n: 0.4, b: 0.4, r: 0.3, q: 0.2, k: 0 };
      score += captureValues[move.captured] || 0;
    }
    if (/[+#]/.test(move.san)) score += 0.15;
    if (move.flags.includes('p')) score += 0.25; // promotions
    if (move.flags.includes('k') || move.flags.includes('q')) score += 0.1; // castling
    return score;
  }

  const chessLoaded = await ensureChessJS();
  if (!chessLoaded) return;

  const container = findMovesContainer();
  if (!container) {
    console.error('[CHESS] move list element not found');
    return;
  }

  const rawMovesText = container.innerText || '';
  log('READ MOVES len=', rawMovesText.length);

  const { moves: appliedMoves, ignored: ignoredTokens } = extractSanMoves(rawMovesText);
  const game = new window.Chess();
  for (const move of appliedMoves) {
    game.move(move.san, { sloppy: true });
  }

  const sanHistory = appliedMoves.map(m => m.san);
  log('SAN COUNT=', sanHistory.length, sanHistory);

  if (ignoredTokens.length) {
    log('IGNORED TOKENS=', ignoredTokens);
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

  const baseEval = evaluateMaterial(game);
  const scoredMoves = legalVerbose.map(move => ({
    move,
    score: scoreMove(game, move, baseEval)
  })).sort((a, b) => b.score - a.score);

  const topMoves = scoredMoves.slice(0, 10);
  const suggestionsSan = topMoves.map(entry => entry.move.san);
  const suggestionsDetail = topMoves.map(entry => `${entry.move.san}  ${entry.move.from.toUpperCase()}->${entry.move.to.toUpperCase()} (score≈${entry.score.toFixed(2)})`);
  log('SIMPLE SUGGESTIONS (SAN):', suggestionsSan);
  log('SIMPLE SUGGESTIONS (scored):', suggestionsDetail);

  const best = scoredMoves[0];
  if (best) {
    log('RECOMMENDATION:', `${best.move.san}  ${best.move.from.toUpperCase()}->${best.move.to.toUpperCase()} (score≈${best.score.toFixed(2)})`);
  } else {
    log('RECOMMENDATION: (no legal moves found)');
  }

  window.__CHESS = {
    version: 'helper-3',
    fen: () => game.fen(),
    turn: () => game.turn(),
    legalSAN: () => game.moves(),
    legalPairs: () => game.moves({ verbose: true }).map(m => `${m.from.toUpperCase()}->${m.to.toUpperCase()} (${m.san})`),
    last: () => lastMove,
    ignored: () => ignoredTokens.slice(),
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
