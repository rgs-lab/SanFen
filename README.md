# SanFen Chess Helper

This repository contains a single-file helper (`chess-helper.js`) that you can paste into the browser console while playing against the chess.com computer. The helper rebuilds the live position from the move list, prints a concise snapshot of the game, and now drives its move recommendation with the Stockfish engine for significantly stronger suggestions. When Stockfish cannot be reached, the helper falls back to a substantially upgraded built-in search that performs iterative deepening (up to seven plies when the position allows), adds quiescence for tactical stability, and scores positions with development, king-safety, pawn-structure, and mobility heuristics so the suggestions remain principled. You can inspect or explore the position further through the exposed helper utilities.

## Prerequisites
- Use Google Chrome, Firefox, or another modern browser that exposes the developer console (F12 or Ctrl/Cmd+Shift+I).
- Open a game against the chess.com computer at <https://www.chess.com/play/computer>.
- (Optional) Enable the move list panel in the UI. The helper now copes with the very first move even if the list is hidden, but opening it ensures consistent parsing.
- Permit outbound network requests to CDN providers (jsDelivr, stockfish.online, stockfishchess.org, cdnjs, or any custom mirror you supply). When a URL fails, the helper caches that result and skips it for the next seven days to avoid spamming the console; you can override or clear the cache at any time (see “Cached CDN failures and retries”).

## Running the helper
1. Start or resume your game against the computer. If you have not yet moved, the helper will assume the starting position and log a reminder that the move list is not yet available.
2. Open the browser console and paste the contents of `chess-helper.js`.
3. Press Enter to run the script. The helper automatically loads `chess.js` if it is not already present on the page.
4. Review the console output. After each of your moves you can re-run the helper (for example by repeating the paste or using a bookmarklet) to update the evaluation. When the engine finishes thinking you will see fresh recommendations without needing to refresh the page.

### When no moves have been played yet
If you run the helper before either side has moved, chess.com does not render a move list. The helper now logs:

```
[CHESS] move list element not found; assuming starting position. Make your first move to populate the move list or open the analysis panel, then rerun the helper.
```

The script still reports the starting position, generates legal moves for the side to move, and prints a recommendation. After you play the first move, run the helper again so it can read the populated move list and continue from the live game.

## Console output reference
The helper prints several diagnostic sections in order:

- **READ MOVES len** – The number of characters pulled from the move list text (0 when the list is hidden or empty).
- **MOVE LIST FOUND** – `true` when a move list container was located, `false` otherwise.
- **TOKEN SOURCE** – `dom` when SAN strings are taken directly from chess.com’s move elements; `text` when the helper falls back to the element’s text; `none` when no move list was found.
- **PARSED TOKENS** – Raw SAN entries the helper will attempt to apply.
- **SAN COUNT / IGNORED TOKENS / INFERRED TOKENS** – How many moves were reconstructed, which tokens were skipped, and any tokens that required heuristic matching.
- **LAST MOVE / FEN / RECENT** – Snapshot of the reconstructed game state.
- **LEGAL (SAN) / LEGAL (from->to)** – All legal moves in SAN and algebraic coordinate form for the side to move.
- **ENGINE SOURCE** – The CDN URL that successfully loaded Stockfish (or `inline:custom` when you provide the worker code). If loading fails, the helper falls back to its built-in multi-ply search heuristics.
- **ENGINE SUGGESTIONS** – MultiPV lines reported by Stockfish with evaluation scores and search depth.
- **ENGINE RECOMMENDATION** – The best move returned by Stockfish, including the analyzed depth. When the engine is unavailable the helper falls back to the heuristic **SIMPLE SUGGESTIONS** and **RECOMMENDATION** logs so you still receive guidance.
- **FALLBACK SEARCH** – When Stockfish cannot be reached, this line reports the built-in search depth, how many candidate moves were evaluated, and roughly how long the search took (with a “time cutoff” tag if the helper stopped due to the time limit).

## Using the `__CHESS` helpers
The script exposes a convenience object on `window.__CHESS` after it runs:

| Helper | Description |
| --- | --- |
| `__CHESS.version` | Returns the helper version tag (`helper-15`). |
| `__CHESS.fen()` | Current FEN string for the reconstructed position. |
| `__CHESS.turn()` | Side to move (`'w'` or `'b'`). |
| `__CHESS.legalSAN()` | Legal moves in SAN format. |
| `__CHESS.legalPairs()` | Legal moves in `FROM->TO (SAN)` format. |
| `__CHESS.last()` | Details for the last applied move, or `null` at the starting position. |
| `__CHESS.tokens()` | Copy of the parsed SAN tokens. |
| `__CHESS.tokenSource()` | Returns the token source identifier (`'dom'`, `'text'`, or `'none'`). |
| `__CHESS.moveListFound()` | Indicates whether a move list element was detected when the helper ran. |
| `__CHESS.ignored()` | Any tokens the helper could not reconcile with the legal history. |
| `__CHESS.inferred()` | Tokens that required heuristic disambiguation. |
| `__CHESS.best()` | The current textual recommendation (engine SAN and UCI when available; heuristic SAN otherwise). |
| `__CHESS.suggestions()` | Either the engine’s MultiPV lines (including SAN, UCI, depth, and score) or the fallback heuristic scores. |
| `__CHESS.engine()` | Details about the connected Stockfish instance (source URL, depth, best move, and raw lines) or `null` when unavailable. |
| `__CHESS.fallback()` | When Stockfish is unavailable, returns the fallback search depth, number of nodes evaluated, elapsed time (milliseconds), whether the search hit its time cap, and how many recursive calls ended early due to the limit. |
| `__CHESS.stockfishFailures()` | Lists cached CDN failures (URL, reason, and timestamp) that the helper will currently skip. |
| `__CHESS.stockfishDisabled()` | Indicates whether Stockfish attempts are currently disabled after repeated failures. |
| `__CHESS.disableStockfish()` | Manually disable future Stockfish attempts (useful when you always want to rely on the built-in engine). |
| `__CHESS.enableStockfish()` | Re-enable CDN Stockfish attempts (clear cached failures or set `window.__CHESS_STOCKFISH_RETRY = true` before rerunning if needed). |
| `__CHESS.clearStockfishFailures()` | Clears the cached failure list so the default URLs are retried on the next run. |
| `__CHESS.trySan(san)` | Try a SAN move against the reconstructed position (without mutating the live state). |
| `__CHESS.tryFromTo(from, to, promotion)` | Try a coordinate move with optional promotion piece. |

You can call these utilities directly from the console to double-check the helper’s output or to experiment with candidate moves.

## Troubleshooting tips
- **Token source is `text` with many ignored tokens** – Ensure the move list is visible and scrolled into view. chess.com occasionally virtualizes older moves; scrolling to the top helps the helper read the full history.
- **Recommendation feels off** – The helper first tries to load Stockfish. If the engine cannot be reached (you will see an `ENGINE ERROR` message), the script now performs a deeper alpha-beta search with quiescence, transposition tables, and positional evaluation. Ensure your browser permits cross-origin requests to the listed CDN URLs or manually provide the engine bundle using one of the customization options below.
- **Engine script returns HTML** – Some CDNs respond with an HTML error page. The helper now detects this situation, skips the bad response, caches the failure, and continues trying the remaining URLs automatically.
- **Need to rerun automatically** – Save the helper as a bookmarklet or snippet so you can execute it with a single click whenever you want a fresh evaluation.

## Resolving merge conflicts for this helper
When you merge updates to `chess-helper.js`, Git may display conflict markers that offer three choices in your editor:

- **Accept current change** – keeps the code that already exists on the branch you have checked out locally.
- **Accept incoming change** – keeps the code that is coming from the branch you are merging in (typically the newer code from the remote).
- **Accept both changes** – keeps both variants, which often requires additional manual editing.

If you simply want to keep the newest version of the helper that you are pulling in from another branch or remote, choose **Accept incoming change**. That option discards the older local section and preserves the updated code so you can continue with the merge using the latest helper logic.

## Customizing the engine source

The helper tries a sequence of Stockfish builds hosted on jsDelivr, stockfish.online, stockfishchess.org, and cdnjs. If all of them fail in your environment (for example due to a firewall), you can supply your own list before running the helper:

```js
window.__CHESS_STOCKFISH_URLS = [
  'https://example.com/path/to/stockfish.js',
  'https://fallback.example.org/another-stockfish.js'
];
```

Paste that snippet into the console first (or save it as a bookmarklet), then run the helper. Your URLs will be tried before the defaults, and any duplicates are ignored. This makes it easy to host a vetted build on your own domain or local network when public CDNs are unavailable.

If you would rather provide the engine source directly, you can inline the worker script or a base64-encoded copy before running the helper:

```js
window.__CHESS_STOCKFISH_INLINE = `/* contents of stockfish.js */`;
// or
window.__CHESS_STOCKFISH_INLINE_BASE64 = 'LyogYmFzZTY0LWVuY29kZWQgc3RvY2tmaXNoLmpzICov';
```

When either variable is set, the helper spawns Stockfish locally without fetching from a CDN, which avoids CORS issues entirely.

### Tuning the fallback search

When Stockfish remains unavailable, the helper now spends up to roughly 1.7 seconds on an iterative deepening search. You can shorten or extend that budget (in milliseconds) by defining `window.__CHESS_FALLBACK_TIME` before running the helper:

```js
window.__CHESS_FALLBACK_TIME = 2500; // allow up to 2.5 seconds for the built-in search
```

Larger values explore deeper trees at the cost of additional computation time. If you prefer near-instant suggestions, set the value closer to `500`.

### Cached CDN failures and retries

To reduce repeated 404 errors or CORS violations in the console, the helper now remembers which Stockfish URLs failed most recently and skips them on subsequent runs. The cache is stored in `localStorage` for seven days. You can inspect the skipped entries via:

```js
__CHESS.stockfishFailures();
```

To retry the default CDN list immediately, either clear the cache:

```js
__CHESS.clearStockfishFailures();
```

or set a one-time override before running the helper:

```js
window.__CHESS_STOCKFISH_RETRY = true;
```

Both options cause the helper to re-attempt every URL on the next run, which is useful after network conditions change or you add a new CDN mirror.

### Automatic Stockfish disablement after repeated failures

If every Stockfish URL fails during a run (for example due to firewalls, offline access, or strict CORS policies), the helper now disables further CDN attempts automatically. Subsequent runs fall back to the built-in search immediately instead of retrying URLs that are likely to fail, eliminating repeated console noise. When you are ready to try again, call:

```js
__CHESS.enableStockfish();
```

You can also disable attempts pre-emptively with `__CHESS.disableStockfish()` if you prefer to rely solely on the built-in engine. Clearing the cached failures and re-enabling Stockfish allows the helper to test the default URL list again on the next run.
