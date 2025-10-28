# Offline Stockfish Quickstart (Recommended)

This guide walks through the most reliable way to guarantee Stockfish analysis inside the chess.com browser helper: **store a browser-ready Stockfish worker directly in your browser**. Once the worker script lives in `localStorage`, the helper launches it instantly on every run with no network calls, CDN outages, or CORS headaches. The process only needs to be completed once per browser profile.

## 1. Download a browser worker build

1. Visit the [official Stockfish releases](https://github.com/official-stockfish/Stockfish/releases) page.
2. In the **Assets** list choose a package that explicitly mentions **WASM/WebAssembly**, for example `stockfish-wasm-nnue-16.zip` (version numbers may vary). Avoid the automatically generated **Source code** archives and the platform-specific `.tar` files (such as `stockfish-macos-m1-apple-silicon.tar`); they only contain native executables and Git metadata, not the browser worker.
3. Extract the archive. Inside you should see at least these files:
   - `stockfish.wasm.js` – JavaScript “glue” code that bootstraps the engine inside a web worker.
   - `stockfish.wasm` – The compiled NNUE binary the glue code loads.

   > **Tip:** The files may live inside a nested folder such as `stockfish-wasm-nnue-16/`. Run `ls` inside the extracted directory to confirm both files are present. You may rename `stockfish.wasm.js` (for example to `stockfish.js`); the helper only needs the JavaScript content.

### What if I cannot find `stockfish.wasm.js`?

If the release you downloaded does not include a browser worker, either:

- Grab a different Stockfish release that ships the WASM build, or
- Use a community-maintained worker such as [`nmrugg/stockfish.js`](https://github.com/nmrugg/stockfish.js/), which provides an asm.js/wasm hybrid worker compatible with this helper.

Regardless of the source, you need the JavaScript worker file that spins up the engine inside a web worker.

## 2. Convert the worker to base64 text

Open a terminal and run the commands below, substituting the actual path to your worker file.

```bash
cd ~/Downloads
base64 -w0 stockfish.wasm.js > stockfish.b64
```

- `-w0` disables line wrapping so the output is a single long string.
- Prefer `base64` because it preserves the raw JavaScript exactly. If you do not have GNU `base64`, you can run this Node.js snippet instead:

  ```bash
  node -e "const fs=require('fs');const src=process.argv[1];const data=fs.readFileSync(src).toString('base64');fs.writeFileSync('stockfish.b64', data);" stockfish.wasm.js
  ```

The result is a text file (`stockfish.b64`) that contains the worker encoded as base64.

## 3. Store the payload in the browser

1. Open <https://www.chess.com/play/computer>.
2. Open the browser console (`Cmd+Option+J` on macOS, `Ctrl+Shift+J` on Windows/Linux).
3. Copy the entire contents of `stockfish.b64` and run the command below. Paste the string between the quotes exactly as-is (the string is long, so consider storing it in a temporary variable first).

```js
__CHESS.storeStockfishInline('PASTE_BASE64_STRING_HERE');
```

If the string exceeds the console’s line length limit, use a temporary variable:

```js
window.MY_STOCKFISH = '...long base64 string...';
__CHESS.storeStockfishInline(window.MY_STOCKFISH);
```

The helper validates the payload, stores it in `localStorage`, and reports success in the console. The copy persists across page reloads and browser restarts.

## 4. Verify that Stockfish is active

Run `chess-helper.js` once. You should see output similar to:

```
[CHESS] ENGINE SOURCE: inline:stored (Stockfish)
```

At any time you can inspect the stored payload and engine status:

```js
__CHESS.stockfishInfo();
```

## 5. Maintain or replace the stored engine

- **Upgrade Stockfish:** Repeat steps 1–4 with a newer worker. The helper overwrites the old copy automatically.
- **Temporarily disable Stockfish:** Run `__CHESS.clearStoredStockfishInline()` to remove the persisted worker. The helper will fall back to session payloads, remote URLs, or the built-in engine.
- **Troubleshoot a bad paste:** If you pasted an incomplete base64 string, rerun Step 3 with the full string; the helper keeps the previous valid payload until a new one is stored successfully.

Once the worker lives in `localStorage`, the helper uses it for every future run without touching the network—perfect for offline play or unreliable connections.

---

## Appendix A – Hosting the worker locally (optional)

If you prefer not to keep the payload in storage, you can serve the worker from your laptop and point the helper at that URL.

1. **Download a browser worker** (see Step 1 above).
2. **Serve the directory with CORS headers**:

   ```bash
   cd ~/stockfish-host
   python3 - <<'PY'
   from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

   class CORSHandler(SimpleHTTPRequestHandler):
       def end_headers(self):
           self.send_header("Access-Control-Allow-Origin", "*")
           super().end_headers()

   ThreadingHTTPServer(("0.0.0.0", 8000), CORSHandler).serve_forever()
   PY
   ```

3. **Point the helper at your server**:

   ```js
   window.__CHESS_STOCKFISH_URLS = [
     'http://127.0.0.1:8000/stockfish.wasm.js'
   ];
   ```

   Set the array before running `chess-helper.js`. The helper will fetch your hosted worker first and only fall back to other sources if the request fails.

4. **Confirm success** by running the helper and checking the `ENGINE SOURCE` log—it should display the URL you supplied.

This approach keeps the worker outside `localStorage` while remaining fully offline. You can share the same local server with other devices on your network by replacing `127.0.0.1` with your LAN IP address.

---

## Appendix B – Using `nmrugg/stockfish.js`

The [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js/) project bundles Stockfish for browsers as a standalone worker script. To integrate it:

1. Clone or download the repository and locate the worker script. At the time of writing the project ships `src/stockfish-17.1-8e4d048.js`; this is the file you want. You may rename it to `stockfish.js` for convenience—the helper only cares about the contents.
2. Treat the worker like any other: encode it to base64 and store it with `__CHESS.storeStockfishInline(...)`, or host it locally and add its URL to `window.__CHESS_STOCKFISH_URLS`.
3. The helper detects the worker automatically and reports `ENGINE SOURCE: inline:stored (Stockfish)` or the custom URL you supplied.

The asm.js build is slower than the official NNUE WASM worker but remains fully compatible and provides accurate analysis when the official binaries are unavailable.
