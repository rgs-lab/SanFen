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
      .replace(/[\u202f\u00a0]/g, ' ')
      .replace(/[\u2000-\u200f\u206f\ufeff]/g, '')
      .replace(/[!?]+$/g, '')
      .replace(/[†‡…]/g, '')
      .trim();
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
    ],
    k: [
      -0.3, -0.4, -0.4, -0.5, -0.5, -0.4, -0.4, -0.3,
      -0.3, -0.4, -0.4, -0.5, -0.5, -0.4, -0.4, -0.3,
      -0.3, -0.4, -0.4, -0.5, -0.5, -0.4, -0.4, -0.3,
      -0.2, -0.3, -0.3, -0.4, -0.4, -0.3, -0.3, -0.2,
      -0.1, -0.2, -0.2, -0.2, -0.2, -0.2, -0.2, -0.1,
      0, 0.1, 0.1, 0, 0, 0.1, 0.1, 0,
      0.1, 0.2, 0.2, 0.1, 0.1, 0.2, 0.2, 0.1,
      0.2, 0.3, 0.2, 0, 0, 0.2, 0.3, 0.2
    ]
  };

  const coreCenterSquares = new Set(['d4', 'd5', 'e4', 'e5']);
  const extendedCenterSquares = new Set(['c3', 'c4', 'c5', 'c6', 'd3', 'e3', 'f3', 'f4', 'f5', 'f6', 'd6', 'e6']);
  const minorPieceStartSquares = new Set(['b1', 'g1', 'c1', 'f1', 'b8', 'g8', 'c8', 'f8']);
  const flankFiles = new Set(['a', 'h']);

  function pieceSquareValue(piece, rowIndex, colIndex) {
    const table = pieceSquareTables[piece.type];
    if (!table) return 0;
    const directIndex = rowIndex * 8 + colIndex;
    if (piece.color === 'w') {
      return table[directIndex] || 0;
    }
    const mirroredIndex = (7 - rowIndex) * 8 + colIndex;
    return table[mirroredIndex] || 0;
  }

  function evaluatePosition(position) {
    const board = typeof position.board === 'function' ? position.board() : null;
    if (!board) return 0;
    let total = 0;
    for (let row = 0; row < board.length; row++) {
      const rank = board[row] || [];
      for (let col = 0; col < rank.length; col++) {
        const piece = rank[col];
        if (!piece) continue;
        const base = pieceValues[piece.type] || 0;
        const placement = pieceSquareValue(piece, row, col);
        const contribution = base + placement;
        total += piece.color === 'w' ? contribution : -contribution;
      }
    }
    return total;
  }

  function scoreMove(currentGame, move, baseEval) {
    const clone = new window.Chess(currentGame.fen());
    clone.move({ from: move.from, to: move.to, promotion: move.promotion });
    let score = evaluatePosition(clone) - baseEval;
    if (move.captured) {
      const captureValues = { p: 0.5, n: 0.4, b: 0.4, r: 0.3, q: 0.2, k: 0 };
      score += captureValues[move.captured] || 0;
    }
    if (/[+#]/.test(move.san)) score += move.san.includes('#') ? 0.4 : 0.18;
    if (move.flags.includes('p')) score += 0.35; // promotions
    if (move.flags.includes('k') || move.flags.includes('q')) score += 0.18; // castling

    if (coreCenterSquares.has(move.to)) {
      score += 0.08;
    } else if (extendedCenterSquares.has(move.to)) {
      score += 0.04;
    }

    if ((move.piece === 'n' || move.piece === 'b') && minorPieceStartSquares.has(move.from)) {
      score += 0.05;
    }

    if (move.piece === 'p') {
      const toRank = parseInt(move.to[1], 10);
      const fromRank = parseInt(move.from[1], 10);
      if (flankFiles.has(move.to[0])) {
        score -= 0.04;
        if (!Number.isNaN(toRank)) {
          const advancing = move.color === 'w' ? toRank >= 5 : toRank <= 4;
          if (advancing) score -= 0.03;
        }
      }
      if (!Number.isNaN(toRank) && !Number.isNaN(fromRank) && Math.abs(toRank - fromRank) === 2) {
        score += 0.02; // space gain for pawn leaps
      }
    }

    const currentMobility = currentGame.moves().length;
    const newMobility = clone.moves().length;
    score += (newMobility - currentMobility) * 0.005;

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

  const { tokens: tokenStrings, source: tokenSource } = readMoveTokens(container);
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

  const baseEval = evaluatePosition(game);
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
    version: 'helper-8',
    fen: () => game.fen(),
    turn: () => game.turn(),
    legalSAN: () => game.moves(),
    legalPairs: () => game.moves({ verbose: true }).map(m => `${m.from.toUpperCase()}->${m.to.toUpperCase()} (${m.san})`),
    last: () => lastMove,
    ignored: () => ignoredTokens.slice(),
    tokens: () => tokenStrings.slice(),
    tokenSource: () => tokenSource,
    suggestions: () => suggestionsDetail.slice(),
    inferred: () => inferredMoves.map(m => ({ san: m.san, matched: m.matched })),
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
