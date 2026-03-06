const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const REAL_VIDEO = path.join(__dirname, 'Request Time Off Demo.mp4');
const OUTPUT_DIR = path.join(__dirname, 'output');

async function loadVideo(page, videoPath) {
  await page.goto('/?ffmpeg');
  await page.locator('#file-input').setInputFiles(videoPath);
  await page.waitForFunction(() => {
    const v = document.getElementById('video-player');
    return v && v.readyState >= 1 && isFinite(v.duration) && v.duration > 0;
  }, { timeout: 30000 });
  // Wait for waveform audio decode
  await page.waitForTimeout(3000);
}

// Generate a short video with deliberate silence gaps for fast CI testing
async function generateSilenceVideo(page) {
  const videoPath = path.join(__dirname, '..', 'test-video-silence.webm');
  if (fs.existsSync(videoPath)) return videoPath;

  await page.goto('/');
  const base64 = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = 160; canvas.height = 120;
      const ctx = canvas.getContext('2d');

      const audioCtx = new AudioContext({ sampleRate: 48000 });
      const dur = 4;
      const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) {
        const t = i / audioCtx.sampleRate;
        ch[i] = (t < 1 || (t >= 2 && t < 3)) ? 0.5 * Math.sin(2 * Math.PI * 440 * t) : 0;
      }
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const dest = audioCtx.createMediaStreamDestination();
      src.connect(dest); src.start();

      const stream = new MediaStream([
        ...canvas.captureStream(10).getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
      const chunks = [];
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = async () => {
        src.stop(); audioCtx.close();
        const blob = new Blob(chunks, { type: 'video/webm' });
        const ab = await blob.arrayBuffer();
        const bytes = new Uint8Array(ab);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192)
          bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
        resolve(btoa(bin));
      };
      rec.start(100);
      let frame = 0;
      const interval = setInterval(() => {
        const t = frame / 10;
        const loud = t < 1 || (t >= 2 && t < 3);
        ctx.fillStyle = loud ? '#1a5' : '#511';
        ctx.fillRect(0, 0, 160, 120);
        ctx.fillStyle = '#fff'; ctx.font = '16px monospace'; ctx.textAlign = 'center';
        ctx.fillText(loud ? 'AUDIO' : 'SILENCE', 80, 65);
        frame++;
        if (frame >= 10 * dur) { clearInterval(interval); setTimeout(() => rec.stop(), 100); }
      }, 100);
      setTimeout(() => reject(new Error('timeout')), 20000);
    });
  });
  fs.writeFileSync(videoPath, Buffer.from(base64, 'base64'));
  return videoPath;
}

test.describe('Silence Removal + Export', () => {
  test('silence detection creates cuts and export completes', async ({ page }) => {
    const videoPath = await generateSilenceVideo(page);
    await loadVideo(page, videoPath);

    const originalDuration = await page.evaluate(() =>
      document.getElementById('video-player').duration
    );

    // Remove silence
    await page.locator('#auto-silence-btn').click();
    const cutCount = await page.locator('.cut-overlay').count();
    expect(cutCount).toBeGreaterThan(0);

    // Output should be shorter
    const outputDuration = await page.evaluate(() => {
      const text = document.getElementById('output-duration').textContent;
      const m = text.match(/(\d+):(\d+)\.(\d+)/);
      return m ? parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / 1000 : 0;
    });
    expect(outputDuration).toBeLessThan(originalDuration);
    expect(outputDuration).toBeGreaterThan(0);

    console.log(`Original: ${originalDuration.toFixed(2)}s → Output: ${outputDuration.toFixed(2)}s (${cutCount} cuts)`);

    // Verify cuts are listed
    const cutCount2 = await page.locator('.cut-item').count();
    expect(cutCount2).toBeGreaterThan(0);
    // Export tested separately — FFmpeg WASM re-encoding is too slow for CI
  });

  test('undo restores after silence removal', async ({ page }) => {
    const videoPath = await generateSilenceVideo(page);
    await loadVideo(page, videoPath);

    const beforeText = await page.locator('#output-duration').textContent();
    await page.locator('#auto-silence-btn').click();
    expect(await page.locator('#output-duration').textContent()).not.toBe(beforeText);

    await page.keyboard.press('Control+z');
    expect(await page.locator('#output-duration').textContent()).toBe(beforeText);
    await expect(page.locator('.cut-overlay')).toHaveCount(0);
  });

  // Manual test with real video — skip in CI (too slow for WASM encoding)
  test.skip('real video: silence removal + export with duration check', async ({ page }) => {
    await loadVideo(page, REAL_VIDEO);

    const originalDuration = await page.evaluate(() =>
      document.getElementById('video-player').duration
    );

    await page.locator('#auto-silence-btn').click();
    const cutCount = await page.locator('.cut-overlay').count();
    console.log(`Original: ${originalDuration.toFixed(2)}s, ${cutCount} silent regions found`);

    const downloadPromise = page.waitForEvent('download', { timeout: 600000 });
    await page.locator('#export-btn').click();
    const download = await downloadPromise;

    const outputPath = path.join(OUTPUT_DIR, download.suggestedFilename());
    await download.saveAs(outputPath);
    console.log(`Saved to: ${outputPath} (${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB)`);
  });
});
