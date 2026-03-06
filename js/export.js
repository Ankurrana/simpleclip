import { state } from './state.js';
import { clamp, formatTimeFFmpeg, getExtension, getSourceFormat, getOutputName, loadScript } from './utils.js';
import { getKeptSegments } from './cuts.js';
import { isWebCodecsSupported, exportWithWebCodecs } from './webcodecs-export.js';

let ffmpegInstance = null;
let ffmpegLoading = false;

const progressSection = document.getElementById('progress-section');
const progressLabel = document.getElementById('progress-label');
const progressPercent = document.getElementById('progress-percent');
const progressBar = document.getElementById('progress-bar');
const exportBtn = document.getElementById('export-btn');
const cancelBtn = document.getElementById('cancel-btn');

async function loadFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoading) return null;

  ffmpegLoading = true;
  progressSection.classList.remove('hidden');
  progressLabel.textContent = 'Loading FFmpeg...';
  progressPercent.textContent = '';
  progressBar.style.width = '0%';
  progressBar.classList.add('indeterminate');

  try {
    await loadScript('vendor/ffmpeg/ffmpeg.js');

    if (typeof FFmpegWASM === 'undefined') {
      throw new Error('FFmpegWASM global not found after script load');
    }

    const { FFmpeg } = FFmpegWASM;
    const ffmpeg = new FFmpeg();

    ffmpeg.on('progress', ({ progress }) => {
      const pct = clamp(Math.round(progress * 100), 0, 100);
      progressPercent.textContent = pct + '%';
      progressBar.style.width = pct + '%';
    });

    ffmpeg.on('log', ({ message }) => {
      console.log('[ffmpeg]', message);
    });

    await ffmpeg.load({
      coreURL: new URL('vendor/ffmpeg/ffmpeg-core.js', window.location.href).href,
      wasmURL: new URL('vendor/ffmpeg/ffmpeg-core.wasm', window.location.href).href,
    });

    progressBar.classList.remove('indeterminate');
    ffmpegInstance = ffmpeg;
    ffmpegLoading = false;
    return ffmpeg;
  } catch (err) {
    progressBar.classList.remove('indeterminate');
    ffmpegLoading = false;
    const msg = err instanceof Error ? err.message : String(err);
    progressLabel.textContent = 'Failed to load FFmpeg: ' + msg;
    console.error('FFmpeg load error:', err);
    return null;
  }
}

function getCodecArgs(format, canCopy) {
  if (canCopy) return ['-c', 'copy'];
  return getEncodeArgs(format);
}

function getEncodeArgs(format) {
  if (format === 'webm') return ['-c:v', 'libvpx', '-cpu-used', '8', '-deadline', 'realtime', '-c:a', 'libvorbis', '-b:v', '1M'];
  return ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac'];
}

// --- WebCodecs export (hardware-accelerated) ---
function formatEta(seconds) {
  if (seconds < 0 || !isFinite(seconds)) return '';
  if (seconds < 60) return Math.ceil(seconds) + 's left';
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${mins}m ${secs}s left`;
}

const quips = [
  'Trimming the fat...',
  'Teaching pixels to behave...',
  'Convincing frames to line up...',
  'Polishing every pixel...',
  'Herding keyframes...',
  'Doing the video math...',
  'Stitching it together...',
  'Almost like real editing software...',
  'Your GPU is earning its keep...',
  'Frame by frame by frame...',
  'Making your video shorter, not worse...',
  'Removing the boring parts...',
  'Cutting out the silence...',
  'This is faster than After Effects...',
  'No cloud needed, just your browser...',
  'Crunching numbers at light speed...',
  'Assembling the final cut...',
  'Bytes going in, video coming out...',
];

let quipInterval = null;

function startQuips() {
  let lastIdx = -1;
  function pickRandom() {
    let idx;
    do { idx = Math.floor(Math.random() * quips.length); } while (idx === lastIdx);
    lastIdx = idx;
    progressLabel.textContent = quips[idx];
  }
  pickRandom();
  quipInterval = setInterval(pickRandom, 3500);
}

function stopQuips() {
  if (quipInterval) {
    clearInterval(quipInterval);
    quipInterval = null;
  }
}

async function tryWebCodecsExport(kept, format) {
  progressSection.classList.remove('hidden');
  progressPercent.textContent = '0%';
  progressBar.style.width = '0%';
  startQuips();

  const blob = await exportWithWebCodecs(kept, format, (progress, eta) => {
    const pct = clamp(Math.round(progress * 100), 0, 100);
    const etaText = eta > 0 ? ' \u00b7 ' + formatEta(eta) : '';
    progressPercent.textContent = pct + '%' + etaText;
    progressBar.style.width = pct + '%';
  });

  stopQuips();
  return blob;
}

// --- FFmpeg export (WASM software fallback) ---
async function ffmpegExport(kept, format) {
  const ffmpeg = await loadFFmpeg();
  if (!ffmpeg) return null;

  progressSection.classList.remove('hidden');
  progressLabel.textContent = 'Processing video...';
  progressPercent.textContent = '0%';
  progressBar.style.width = '0%';

  const inputName = 'input' + getExtension(state.sourceFileName);
  const outputName = 'output.' + format;

  // If no cuts (full video), just return the source file directly
  if (kept.length === 1 && kept[0].start < 0.01 && kept[0].end >= state.videoDuration - 0.01) {
    const mimeType = format === 'webm' ? 'video/webm' : 'video/mp4';
    return new Blob([await state.sourceFile.arrayBuffer()], { type: mimeType });
  }

  const fileData = await state.sourceFile.arrayBuffer();
  await ffmpeg.writeFile(inputName, new Uint8Array(fileData));

  if (kept.length === 1) {
    const seg = kept[0];
    progressLabel.textContent = 'Processing video...';
    await ffmpeg.exec(['-i', inputName,
      '-ss', formatTimeFFmpeg(seg.start), '-to', formatTimeFFmpeg(seg.end),
      '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-y', outputName]);
  } else {
    // Extract each segment with -c copy, resetting timestamps per segment
    const segFiles = [];
    for (let i = 0; i < kept.length; i++) {
      const seg = kept[i];
      const segName = `seg${i}.${format}`;
      segFiles.push(segName);

      progressLabel.textContent = `Extracting segment ${i + 1} of ${kept.length}...`;
      await ffmpeg.exec(['-i', inputName,
        '-ss', formatTimeFFmpeg(seg.start), '-t', formatTimeFFmpeg(seg.end - seg.start),
        '-c', 'copy', '-y', segName]);
    }

    const concatList = segFiles.map(f => `file '${f}'`).join('\n');
    await ffmpeg.writeFile('concat.txt', concatList);

    progressLabel.textContent = 'Joining segments...';
    // Re-encode the concat to fix timestamps (fast for short segments)
    const encodeArgs = getEncodeArgs(format);
    await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt',
      ...encodeArgs, '-movflags', '+faststart', '-y', outputName]);

    for (const f of segFiles) await ffmpeg.deleteFile(f);
    await ffmpeg.deleteFile('concat.txt');
  }

  const data = await ffmpeg.readFile(outputName);
  const mimeType = format === 'webm' ? 'video/webm' : 'video/mp4';
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);
  return new Blob([data.buffer], { type: mimeType });
}

export function initExport() {
  exportBtn.addEventListener('click', async () => {
    if (!state.sourceFile) return;

    const kept = getKeptSegments();
    if (kept.length === 0) return;

    exportBtn.disabled = true;

    try {
      const format = getSourceFormat(state.sourceFileName);
      let blob;

      // WebCodecs (hardware GPU encoder) is the default — much faster than FFmpeg WASM
      // Fall back to FFmpeg for unsupported browsers (Firefox) or via ?ffmpeg param
      const forceFFmpeg = new URLSearchParams(location.search).has('ffmpeg');
      if (isWebCodecsSupported() && !forceFFmpeg) {
        try {
          console.log('Using WebCodecs (hardware encoder)');
          blob = await tryWebCodecsExport(kept, format);
        } catch (e) {
          console.warn('WebCodecs export failed, falling back to FFmpeg:', e);
          progressLabel.textContent = 'WebCodecs failed, using FFmpeg...';
          blob = await ffmpegExport(kept, format);
        }
      } else {
        blob = await ffmpegExport(kept, format);
      }

      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = getOutputName(state.sourceFileName, format);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      stopQuips();
      progressLabel.textContent = 'Export complete!';
      progressPercent.textContent = '100%';
      progressBar.style.width = '100%';
    } catch (err) {
      stopQuips();
      if (err.message?.includes('abort')) {
        progressLabel.textContent = 'Export cancelled.';
      } else {
        progressLabel.textContent = 'Export failed: ' + (err.message || String(err));
        console.error('Export error:', err);
      }
    } finally {
      exportBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener('click', () => {
    if (ffmpegInstance) {
      ffmpegInstance.terminate();
      ffmpegInstance = null;
    }
    progressSection.classList.add('hidden');
  });
}

export function resetExport() {
  if (ffmpegInstance) {
    ffmpegInstance.terminate();
    ffmpegInstance = null;
  }
  progressSection.classList.add('hidden');
}
