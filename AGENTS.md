# SanFen Repo Agent Instructions

## Overview
This repository contains a single browser helper script `chess-helper.js` and supporting documentation in `README.md`. The helper reconstructs chess.com computer games, surfaces legal moves, and integrates with Stockfish via inline workers, CDN URLs, or a built-in fallback engine.

## Workflow expectations
- Treat the helper as **browser-only JavaScript**. It is meant to be pasted into the chess.com console, so keep dependencies self-contained and avoid build steps.
- Always update documentation (`README.md`) when behavior, helper APIs, or setup procedures change.
- Preserve the `window.__CHESS` helper surface and Stockfish integration utilities unless updates are explicitly required.
- Do not introduce bundlers or transpilers. Keep the script as a single file that can be copy-pasted.

## Code style
- Use modern ES2015+ JavaScript (const/let, arrow functions where appropriate) while keeping compatibility with Chromium-based browsers.
- Avoid try/catch around import statements (system-level rule).
- Keep console log prefixes consistent (`[CHESS] ...`).
- Place helper metadata near the top of the script (`const HELPER_VERSION = 'helper-XX'`).

## Stockfish integration notes
- The helper prefers inline Stockfish payloads stored in `localStorage`, then session-provided inline strings, then CDN URLs, and finally the built-in fallback engine.
- When adjusting engine-loading logic, ensure `__CHESS.stockfishInfo()`, `__CHESS.storeStockfishInline()`, and related helpers remain backward compatible.
- Document any new setup or hosting instructions in `README.md`, especially workflows for providing custom Stockfish URLs or payloads.

## Testing
- Automated tests are not available in this repository. Validate changes by explaining expected console output or manual testing steps in the README when relevant.

## PR / documentation requirements
- Summaries in commit messages and PR bodies should mention significant changes to the helper or documentation.
- After commits, run `make_pr` with an appropriate summary.

