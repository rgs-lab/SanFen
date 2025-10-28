# SanFen Chess Helper

This repository contains a single-file helper (`chess-helper.js`) that you can paste into the browser console while playing against the chess.com computer. The helper rebuilds the live position from the move list, prints a concise snapshot of the game, and now lets you **embed a permanent Stockfish build locally**. Provide a base64 copy of the official Stockfish WASM worker (the JavaScript file that loads the accompanying `stockfish.wasm`, often named `stockfish.wasm.js`) once, and the helper will launch that engine directly from `localStorage` on every run—no more flaky CDN lookups or CORS surprises. When no stored payload is available, the script still falls back to its self-contained search engine so you always receive principled suggestions. You can inspect or explore the position further through the exposed helper utilities.

## Prerequisites
- Use Google Chrome, Firefox, or another modern browser that exposes the developer console (F12 or Ctrl/Cmd+Shift+I).
- Open a game against the chess.com computer at <https://www.chess.com/play/computer>.
- (Optional) Enable the move list panel in the UI. The helper now copes with the very first move even if the list is hidden, but opening it ensures consistent parsing.
- Permit outbound network requests to whichever Stockfish URLs you configure (if any). If you rely solely on the embedded worker or an inline payload, no external access is required.

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
- **ENGINE SOURCE** – Indicates which engine produced the current analysis. `inline:builtin` means the embedded worker handled the search locally, `inline:custom` refers to your own inline payload, and full URLs identify external Stockfish bundles. If no external engine is available the helper automatically relies on the built-in worker.
- **ENGINE SUGGESTIONS** – MultiPV lines reported by the active engine (built-in worker or Stockfish) with evaluation scores and search depth.
- **ENGINE RECOMMENDATION** – The best move returned by the active engine, including the analyzed depth. When no external engine is running the helper still prints the heuristic **SIMPLE SUGGESTIONS** and **RECOMMENDATION** logs so you continue to receive guidance. The fallback output now appends the continuation it expects after the first move (for example `→ Nf3 Qe7 …`) so you can see the principal variation the built-in search prefers.
- **FALLBACK SEARCH** – When Stockfish cannot be reached, this line reports the built-in search depth, how many candidate moves were evaluated, and roughly how long the search took (with a “time cutoff” tag if the helper stopped due to the time limit).

## Offline Stockfish quickstart (recommended)

The one-time workflow for storing Stockfish inside your browser now lives in a dedicated guide: [Offline Stockfish Quickstart](docs/offline-stockfish-quickstart.md). Follow it to capture a WebAssembly worker (or the `nmrugg/stockfish.js` asm.js build), encode it to base64, and persist it with `__CHESS.storeStockfishInline(...)` so the helper always boots a genuine Stockfish engine without touching the network.

## Permanent Stockfish setup (other options)

Prefer to host the worker yourself? The [Offline Stockfish Quickstart](docs/offline-stockfish-quickstart.md#appendix-a--hosting-the-worker-locally-optional) appendix now covers the full macOS hosting walkthrough, including the ready-to-run Python CORS server and the `window.__CHESS_STOCKFISH_URLS` override. Appendix B in the same document explains how to integrate the [`nmrugg/stockfish.js`](https://github.com/nmrugg/stockfish.js/) worker—specifically the current `src/stockfish-17.1-8e4d048.js` script—if you cannot obtain the official WASM build.

## Engine selection

- **Stored Stockfish (recommended):** When you keep a base64 payload in `localStorage` via `__CHESS.storeStockfishInline(...)`, the helper launches that worker first (`ENGINE SOURCE=inline:stored`). This guarantees genuine Stockfish analysis without network access.
- **Session-only Stockfish:** Call `__CHESS.storeStockfishInline(base64, { persist: false })` to load a payload for the current tab only. It behaves like the stored version but is cleared when you refresh or close the page.
- **Custom inline or hosted URLs:** You can still set `window.__CHESS_STOCKFISH_INLINE`, `window.__CHESS_STOCKFISH_INLINE_BASE64`, or `window.__CHESS_STOCKFISH_URLS` before running the helper to try bespoke builds or remote hosts. These sources run after your stored/session payloads but before the fallback engine.
- **Built-in worker fallback:** If no Stockfish payload succeeds (or you clear the stored copy), the helper spins up its embedded worker (`ENGINE SOURCE=inline:builtin`) so you continue to receive analysed recommendations with no external dependencies.

## Using the `__CHESS` helpers
The script exposes a convenience object on `window.__CHESS` after it runs:

| Helper | Description |
| --- | --- |
| `__CHESS.version` | Returns the helper version tag (`helper-18`). |
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
| `__CHESS.suggestions()` | Either the engine’s MultiPV lines (including SAN, UCI, depth, and score) or the fallback heuristic scores with their principal-variation SAN (`pvSan`). |
| `__CHESS.engine()` | Details about the connected engine (built-in worker or Stockfish) including source label, depth, best move, and raw lines, or `null` when no engine is active. |
| `__CHESS.fallback()` | When Stockfish is unavailable, returns the fallback search depth, number of nodes evaluated, elapsed time (milliseconds), whether the search hit its time cap, and how many recursive calls ended early due to the limit. |
| `__CHESS.stockfishFailures()` | Lists recorded URL failures (address, reason, and timestamp) from recent attempts. |
| `__CHESS.stockfishInfo()` | Summarises the active engine source, stored/session payload sizes, disable flag, and cached failures. |
| `__CHESS.storeStockfishInline(base64, options)` | Validates and stores a base64 Stockfish worker (`persist: true` by default, use `{ persist: false }` for session-only). |
| `__CHESS.storeStockfishFromUrl(url, options)` | Fetches a worker script from a CORS-friendly URL, converts it to base64, and stores it using the same options as above. |
| `__CHESS.clearStoredStockfishInline()` | Removes both stored and session inline payloads so the helper falls back to other sources. |
| `__CHESS.stockfishDisabled()` | Indicates whether Stockfish attempts have been disabled manually for the current session. |
| `__CHESS.disableStockfish()` | Manually disable future Stockfish attempts (useful when you always want to rely on the built-in engine). |
| `__CHESS.enableStockfish()` | Re-enable external Stockfish attempts (they are retried automatically unless you explicitly disable them). |
| `__CHESS.clearStockfishFailures()` | Clears the cached failure list so the default URLs are retried on the next run. |
| `__CHESS.trySan(san)` | Try a SAN move against the reconstructed position (without mutating the live state). |
| `__CHESS.tryFromTo(from, to, promotion)` | Try a coordinate move with optional promotion piece. |

You can call these utilities directly from the console to double-check the helper’s output or to experiment with candidate moves.

## Troubleshooting tips
- **Stockfish keeps falling back to the built-in engine** – Run `__CHESS.stockfishInfo()` to confirm whether a stored payload is available. If `storedInline` is `false`, re-run `__CHESS.storeStockfishInline(...)`. If it shows an old failure reason, clear the cache via `__CHESS.clearStoredStockfishInline()` and store a fresh copy.
- **Token source is `text` with many ignored tokens** – Ensure the move list is visible and scrolled into view. chess.com occasionally virtualizes older moves; scrolling to the top helps the helper read the full history.
- **Recommendation feels off** – The built-in worker already performs iterative deepening with quiescence, transposition tables, killer/history move ordering, move-safety checks, and positional evaluation. If you want to compare its output with Stockfish, disable the built-in worker for a run (`window.__CHESS_DISABLE_BUILTIN_ENGINE = true`) and provide working Stockfish URLs or inline payloads as described below.
- **Engine script returns HTML** – Some hosts respond with an HTML error page. The helper now detects this situation, skips the bad response, caches the failure, and continues trying the remaining URLs automatically.
- **Need to rerun automatically** – Save the helper as a bookmarklet or snippet so you can execute it with a single click whenever you want a fresh evaluation.

## Resolving merge conflicts for this helper
When you merge updates to `chess-helper.js`, Git may display conflict markers that offer three choices in your editor:

- **Accept current change** – keeps the code that already exists on the branch you have checked out locally.
- **Accept incoming change** – keeps the code that is coming from the branch you are merging in (typically the newer code from the remote).
- **Accept both changes** – keeps both variants, which often requires additional manual editing.

If you simply want to keep the newest version of the helper that you are pulling in from another branch or remote, choose **Accept incoming change**. That option discards the older local section and preserves the updated code so you can continue with the merge using the latest helper logic.

## Customizing the engine source

The embedded worker is used by default. To force the helper to skip it and try external engines only, set `window.__CHESS_DISABLE_BUILTIN_ENGINE = true` before running the helper. External engines are **not** fetched automatically anymore; provide explicit URLs when you have a hosted copy of the Stockfish WASM worker you trust:

```js
window.__CHESS_STOCKFISH_URLS = [
  'https://example.com/path/to/stockfish.wasm.js',
  'https://fallback.example.org/another-worker.js'
];
```

Paste that snippet into the console first (or save it as a bookmarklet), then run the helper. Each URL is tried in order until one succeeds. This makes it easy to host a vetted build on your own domain or local network when public hosts are unavailable.

If you would rather provide the engine source directly, you can inline the worker script or a base64-encoded copy before running the helper:

```js
window.__CHESS_STOCKFISH_INLINE = `/* contents of stockfish.wasm.js */`;
// or
window.__CHESS_STOCKFISH_INLINE_BASE64 = 'LyogYmFzZTY0LWVuY29kZWQgc3RvY2tmaXNoLmpzICov';
```

When either variable is set, the helper spawns Stockfish locally without fetching from the network, which avoids CORS issues entirely.

### Tuning the fallback search

When Stockfish remains unavailable, the helper now spends up to roughly 1.7 seconds on an iterative deepening search. You can shorten or extend that budget (in milliseconds) by defining `window.__CHESS_FALLBACK_TIME` before running the helper:

```js
window.__CHESS_FALLBACK_TIME = 2500; // allow up to 2.5 seconds for the built-in search
```

Larger values explore deeper trees at the cost of additional computation time. If you prefer near-instant suggestions, set the value closer to `500`.

### Cached URL failures and retries

To help with debugging remote-host issues, the helper records recent Stockfish URL failures (reason and timestamp) in `localStorage`. By default it still retries every URL on the next run, but you can inspect the recorded entries via:

```js
__CHESS.stockfishFailures();
```

To clear the recorded failures (useful if you want a clean log) call:

```js
__CHESS.clearStockfishFailures();
```

If you prefer to **skip** retrying previously failed URLs (for example when a firewall blocks them and you do not want to see the repeated network errors), set this before running the helper:

```js
window.__CHESS_STOCKFISH_RETRY = false;
```

With the flag set to `false`, cached failures are skipped until you clear them or reload the page.

Because retries are now automatic, the helper no longer disables Stockfish on its own. Use `__CHESS.disableStockfish()` or `__CHESS.enableStockfish()` when you want to opt out or opt back in manually.
