const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// Generate a test video in the browser using Canvas + MediaRecorder
async function generateTestVideo(page) {
  const testVideoPath = path.join(__dirname, '..', 'test-video.webm');
  if (fs.existsSync(testVideoPath)) return testVideoPath;

  await page.goto('/');

  const videoBase64 = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 120;
      const ctx = canvas.getContext('2d');

      const stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: 'video/webm' });
          const buffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 8192) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          }
          resolve(btoa(binary));
        } catch (e) {
          reject(e);
        }
      };

      recorder.onerror = (e) => reject(e.error || new Error('MediaRecorder error'));

      recorder.start(100);

      let frame = 0;
      const fps = 10;
      const totalFrames = fps * 5;
      const interval = setInterval(() => {
        const hue = (frame / totalFrames) * 360;
        ctx.fillStyle = `hsl(${hue}, 70%, 30%)`;
        ctx.fillRect(0, 0, 160, 120);

        ctx.fillStyle = 'white';
        ctx.font = 'bold 24px monospace';
        ctx.textAlign = 'center';
        ctx.fillText((frame / fps).toFixed(1) + 's', 80, 65);

        frame++;
        if (frame >= totalFrames) {
          clearInterval(interval);
          recorder.stop();
        }
      }, 1000 / fps);

      setTimeout(() => {
        if (recorder.state === 'recording') {
          clearInterval(interval);
          recorder.stop();
        }
      }, 8000);

      setTimeout(() => reject(new Error('Video generation timed out')), 30000);
    });
  });

  const buffer = Buffer.from(videoBase64, 'base64');
  fs.writeFileSync(testVideoPath, buffer);
  return testVideoPath;
}

// Helper: load the test video into the editor
async function loadTestVideo(page, { useFFmpeg = false } = {}) {
  const testVideoPath = await generateTestVideo(page);
  await page.goto(useFFmpeg ? '/?ffmpeg' : '/');

  const fileInput = page.locator('#file-input');
  await fileInput.setInputFiles(testVideoPath);

  await page.waitForFunction(() => {
    const v = document.getElementById('video-player');
    return v && v.readyState >= 1 && isFinite(v.duration) && v.duration > 0;
  }, { timeout: 15000 });
}

// ==================== Step 1: Layout Tests ====================

test.describe('Step 1: Layout', () => {
  test('page loads without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    expect(errors).toHaveLength(0);
    await expect(page).toHaveTitle(/SimpleClip/);
  });

  test('drop zone is visible', async ({ page }) => {
    await page.goto('/');
    const dropZone = page.locator('#drop-zone');
    await expect(dropZone).toBeVisible();
  });

  test('editor is hidden initially', async ({ page }) => {
    await page.goto('/');
    const editor = page.locator('#editor');
    await expect(editor).toBeHidden();
  });
});

// ==================== Step 2: File Loading Tests ====================

test.describe('Step 2: File Loading', () => {
  test('uploading a video hides drop zone and shows editor', async ({ page }) => {
    await loadTestVideo(page);
    await expect(page.locator('#drop-zone')).toBeHidden();
    await expect(page.locator('#editor')).toBeVisible();
  });

  test('video element has a valid src after file load', async ({ page }) => {
    await loadTestVideo(page);
    const src = await page.locator('#video-player').getAttribute('src');
    expect(src).toBeTruthy();
    expect(src).toContain('blob:');
  });
});

// ==================== Step 3: Timeline Tests ====================

test.describe('Step 3: Timeline', () => {
  test('total time updates after video loads', async ({ page }) => {
    await loadTestVideo(page);
    await page.waitForFunction(() => {
      const el = document.getElementById('total-time');
      return el && el.textContent !== '00:00.000';
    }, { timeout: 5000 });
    const totalTime = await page.locator('#total-time').textContent();
    expect(totalTime).not.toBe('00:00.000');
  });

  test('playhead exists inside timeline', async ({ page }) => {
    await loadTestVideo(page);
    const playhead = page.locator('#playhead');
    await expect(playhead).toBeVisible();
  });

  test('initially shows no cuts', async ({ page }) => {
    await loadTestVideo(page);
    await expect(page.locator('.cut-item')).toHaveCount(0);
    await expect(page.locator('.cuts-empty')).toBeVisible();
  });
});

// ==================== Step 4: Cut Segments Tests ====================

test.describe('Step 4: Cut Segments', () => {
  test('add cut button creates a cut overlay', async ({ page }) => {
    await loadTestVideo(page);
    await page.locator('#add-cut-btn').click();
    await expect(page.locator('.cut-overlay')).toHaveCount(1);
  });

  test('adding a cut shows it in the cuts list', async ({ page }) => {
    await loadTestVideo(page);
    await expect(page.locator('.cut-item')).toHaveCount(0);

    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 2.5;
    });
    await page.waitForTimeout(200);
    await page.locator('#add-cut-btn').click();

    await expect(page.locator('.cut-item')).toHaveCount(1);
  });

  test('clicking a cut in the list toggles selection', async ({ page }) => {
    await loadTestVideo(page);

    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 2.5;
    });
    await page.waitForTimeout(200);
    await page.locator('#add-cut-btn').click();

    // Auto-selected after adding
    await expect(page.locator('.cut-item').first()).toHaveClass(/selected/);

    // Click to deselect
    await page.locator('.cut-item').first().click();
    await expect(page.locator('.cut-item').first()).not.toHaveClass(/selected/);

    // Click again to select
    await page.locator('.cut-item').first().click();
    await expect(page.locator('.cut-item').first()).toHaveClass(/selected/);
  });

  test('deleting a cut restores that section', async ({ page }) => {
    await loadTestVideo(page);

    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 1.5;
    });
    await page.waitForTimeout(200);
    await page.locator('#add-cut-btn').click();

    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 3.5;
    });
    await page.waitForTimeout(200);
    await page.locator('#add-cut-btn').click();

    const cutCountBefore = await page.locator('.cut-item').count();
    expect(cutCountBefore).toBeGreaterThanOrEqual(1);
    const durationBefore = await page.locator('#output-duration').textContent();

    // Delete the first cut (restores that section)
    await page.locator('.cut-item-delete').first().click();

    const cutCountAfter = await page.locator('.cut-item').count();
    expect(cutCountAfter).toBeLessThan(cutCountBefore);
    const durationAfter = await page.locator('#output-duration').textContent();
    expect(durationAfter).not.toBe(durationBefore);
  });

  test('dragging cut handle changes cut bounds', async ({ page }) => {
    await loadTestVideo(page);

    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 2.5;
    });
    await page.waitForTimeout(200);
    await page.locator('#add-cut-btn').click();

    const initialTimes = await page.locator('.cut-item-times').first().textContent();

    const handle = page.locator('.cut-handle.start .handle-grip').first();
    const timeline = page.locator('#timeline');
    const box = await timeline.boundingBox();
    const handleBox = await handle.boundingBox();

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    const targetX = box.x + box.width * 0.1;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(targetX, startY, { steps: 5 });
    await page.mouse.up();

    const updatedTimes = await page.locator('.cut-item-times').first().textContent();
    expect(updatedTimes).not.toBe(initialTimes);
  });

  test('output duration updates when cuts are added', async ({ page }) => {
    await loadTestVideo(page);
    const beforeText = await page.locator('#output-duration').textContent();

    await page.locator('#add-cut-btn').click();
    const afterText = await page.locator('#output-duration').textContent();
    expect(afterText).not.toBe(beforeText);
  });

  test('multiple cuts create multiple overlays and list items', async ({ page }) => {
    await loadTestVideo(page);

    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 1;
    });
    await page.waitForTimeout(200);
    await page.locator('#add-cut-btn').click();

    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 4;
    });
    await page.waitForTimeout(200);
    await page.locator('#add-cut-btn').click();

    await expect(page.locator('.cut-overlay')).toHaveCount(2);
    await expect(page.locator('.cut-item')).toHaveCount(2);
  });

  test('overlapping cuts are merged into one', async ({ page }) => {
    await loadTestVideo(page);

    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 2.5;
    });
    await page.waitForTimeout(200);
    await page.locator('#add-cut-btn').click();
    await page.locator('#add-cut-btn').click();

    await expect(page.locator('.cut-overlay')).toHaveCount(1);
  });

  test('clicking a cut overlay selects and deselects it', async ({ page }) => {
    await loadTestVideo(page);

    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 1;
    });
    await page.waitForTimeout(200);
    await page.locator('#add-cut-btn').click();

    // Cut is auto-selected after adding
    await expect(page.locator('.cut-overlay').first()).toHaveClass(/selected/);

    // Click the overlay to toggle (deselect)
    await page.locator('.cut-overlay').first().click();
    await expect(page.locator('.cut-overlay').first()).not.toHaveClass(/selected/);

    // Click again to re-select
    await page.locator('.cut-overlay').first().click();
    await expect(page.locator('.cut-overlay').first()).toHaveClass(/selected/);
  });

  test('drag-to-select on timeline creates a selection that can be removed', async ({ page }) => {
    await loadTestVideo(page);
    const durationBefore = await page.locator('#output-duration').textContent();

    // Drag from 20% to 60% of the timeline
    const timeline = page.locator('#timeline');
    await timeline.scrollIntoViewIfNeeded();
    const box = await timeline.boundingBox();
    const y = box.y + box.height / 2;
    const startX = box.x + box.width * 0.2;
    const endX = box.x + box.width * 0.6;

    // Use slow deliberate drag
    await page.mouse.move(startX, y);
    await page.waitForTimeout(50);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(startX + (endX - startX) * (i / 10), y);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();

    // Should show selection highlight
    await expect(page.locator('.selection-highlight')).toHaveCount(1);
    // Should show "Remove Selection" button
    await expect(page.locator('.btn-remove-selection')).toBeVisible();

    // Click remove selection
    await page.locator('.btn-remove-selection').click();

    // Selection gone, cut overlay created, duration reduced
    await expect(page.locator('.selection-highlight')).toHaveCount(0);
    await expect(page.locator('.cut-overlay')).toHaveCount(1);
    const durationAfter = await page.locator('#output-duration').textContent();
    expect(durationAfter).not.toBe(durationBefore);
  });

  test('I/O mark keys create a selection', async ({ page }) => {
    await loadTestVideo(page);

    // Seek to 1s, press I
    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 1;
    });
    await page.waitForTimeout(100);
    await page.keyboard.press('i');

    // Seek to 3s, press O
    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 3;
    });
    await page.waitForTimeout(100);
    await page.keyboard.press('o');

    // Should show selection
    await expect(page.locator('.selection-highlight')).toHaveCount(1);
    await expect(page.locator('.btn-remove-selection')).toBeVisible();

    // Press Delete to remove
    await page.keyboard.press('Delete');
    await expect(page.locator('.cut-overlay')).toHaveCount(1);
    await expect(page.locator('.selection-highlight')).toHaveCount(0);
  });
});

// ==================== Step 5: Preview Tests ====================

test.describe('Step 5: Preview Output', () => {
  test('preview plays the video', async ({ page }) => {
    await loadTestVideo(page);

    await page.locator('#preview-btn').click();
    await page.waitForTimeout(300);

    const playing = await page.evaluate(() => {
      return !document.getElementById('video-player').paused;
    });
    expect(playing).toBe(true);
  });
});

// ==================== Step 6: Export Tests ====================

test.describe('Step 6: Export', () => {
  // Export tests use ?ffmpeg — WebCodecs needs GPU which headless Chromium lacks
  test('export button shows progress section', async ({ page }) => {
    await loadTestVideo(page);
    await expect(page.locator('#progress-section')).toBeHidden();
    await page.locator('#export-btn').click();
    await expect(page.locator('#progress-section')).toBeVisible();
  });

  test('full export completes and produces a valid file', async ({ page }) => {
    await loadTestVideo(page, { useFFmpeg: true });
    await page.locator('#export-btn').click();
    await expect(page.locator('#progress-label')).toHaveText('Export complete!', { timeout: 120000 });
  });

  test.skip('export with cuts completes successfully', async ({ page }) => {
    // Skip: multi-segment FFmpeg re-encode too slow for CI
    await loadTestVideo(page, { useFFmpeg: true });

    // Cut at the start — leaves 1 kept segment (single-segment fast path)
    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 0.3;
    });
    await page.waitForTimeout(200);
    await page.locator('#add-cut-btn').click();

    await page.locator('#export-btn').click();
    await expect(page.locator('#progress-label')).toHaveText('Export complete!', { timeout: 120000 });
  });

  test.skip('multi-segment export completes successfully', async ({ page }) => {
    // Skip: FFmpeg WASM re-encoding is too slow for CI (>2min for 5s WebM).
    // In production, WebCodecs handles this with hardware acceleration.
    await loadTestVideo(page, { useFFmpeg: true });

    // Add two cuts to create 3 segments (multi-segment concat path)
    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 1.5;
    });
    await page.waitForTimeout(200);
    await page.locator('#add-cut-btn').click();

    await page.evaluate(() => {
      document.getElementById('video-player').currentTime = 3.5;
    });
    await page.waitForTimeout(200);
    await page.locator('#add-cut-btn').click();

    // Export should complete
    await page.locator('#export-btn').click();
    await expect(page.locator('#progress-label')).toHaveText('Export complete!', { timeout: 120000 });
  });
});
