# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SimpleClip is a browser-based video editor/trimmer. It runs entirely client-side using vanilla HTML/CSS/JS with FFmpeg.wasm for video processing. No build step or bundler is used.

## Commands

### Dev Server
```bash
node serve.js
```
Starts at http://localhost:3000. The server sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers required by FFmpeg.wasm's SharedArrayBuffer usage.

### Tests
```bash
npx playwright test              # run all tests
npx playwright test --headed     # run with visible browser
npx playwright test -g "pattern" # run tests matching pattern
```
Playwright auto-starts the dev server on port 3000 via the `webServer` config. Tests run on Chromium only.

## Architecture

- **`index.html`** - Single-page app shell, all UI markup
- **`app.js`** - All application logic in a single IIFE: file loading, video playback, timeline/thumbnail generation, trim handle dragging, and FFmpeg.wasm export
- **`styles.css`** - Dark theme with CSS custom properties (prefixed `--`)
- **`serve.js`** - Minimal Node.js static file server (no Express) with COOP/COEP headers
- **`tests/editor.spec.js`** - Playwright e2e tests organized by feature step (Layout, File Loading, Timeline, Trim Handles, Preview, Export)

### Key Patterns

- FFmpeg.wasm is loaded dynamically from unpkg CDN at export time (not at page load). The `loadScript()` helper handles deduplication.
- Test video files are generated in-browser via Canvas + MediaRecorder, cached to disk as `test-video.webm`.
- Trim state is managed by module-scoped variables (`trimStart`, `trimEnd`, `videoDuration`), not a framework.
- Pointer events with `setPointerCapture` are used for trim handle dragging.
- The `hidden` CSS class (`display: none !important`) toggles between drop zone and editor views.
