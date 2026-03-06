# SimpleClip

A video editor that runs entirely in your browser. No uploads, no servers, no installs — just open and edit.

**Live:** [ankurrana.com/simpleclip](https://ankurrana.com/simpleclip/)

## What it does

- **Cut sections** — drag on the timeline to select a range, then remove or keep it
- **Remove silence** — one click auto-detects and removes silent sections
- **Undo/Redo** — full history with Ctrl+Z / Ctrl+Y
- **Timeline zoom** — scroll to zoom in for precise edits
- **Waveform** — audio waveform overlaid on the timeline
- **Keyboard shortcuts** — Space, arrow keys, I/O marks, Delete
- **Export** — hardware-accelerated via WebCodecs (Chrome/Edge), FFmpeg WASM fallback for other browsers

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `← →` | Seek ±1 second |
| `Shift + ← →` | Frame step |
| `I` / `O` | Mark in / out points |
| `Delete` | Remove selected cut or selection |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Scroll` | Zoom timeline |

## Run locally

```bash
npm install
node serve.js
# Open http://localhost:3000
```

## Run tests

```bash
npx playwright test
```

## Tech

Vanilla HTML/CSS/JS. No build step, no frameworks, no bundlers.

- [FFmpeg.wasm](https://github.com/nicx-io/ffmpeg.wasm) — video processing fallback
- [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) — hardware-accelerated encoding
- [webm-muxer](https://github.com/Vanilagy/webm-muxer) / [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) — container muxing
- [Playwright](https://playwright.dev) — e2e tests
- [coi-serviceworker](https://github.com/nicx-io/nicx-coi-serviceworker) — COOP/COEP headers for static hosting

## License

MIT
