(() => {
  'use strict';

  // --- DOM Elements ---
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const editor = document.getElementById('editor');
  const video = document.getElementById('video-player');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const playIcon = document.getElementById('play-icon');
  const pauseIcon = document.getElementById('pause-icon');
  const muteBtn = document.getElementById('mute-btn');
  const volumeSlider = document.getElementById('volume-slider');
  const volumeWaves = document.getElementById('volume-waves');
  const currentTimeEl = document.getElementById('current-time');
  const totalTimeEl = document.getElementById('total-time');
  const timelineWrapper = document.getElementById('timeline-wrapper');
  const timeline = document.getElementById('timeline');
  const thumbnailCanvas = document.getElementById('thumbnail-canvas');
  const waveformCanvas = document.getElementById('waveform-canvas');
  const cutsContainer = document.getElementById('cuts-container');
  const playhead = document.getElementById('playhead');
  const addCutBtn = document.getElementById('add-cut-btn');
  const splitBtn = document.getElementById('split-btn');
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const outputDuration = document.getElementById('output-duration');
  const cutsList = document.getElementById('cuts-list');
  const zoomLabel = document.getElementById('zoom-label');
  const timelineTooltip = document.getElementById('timeline-tooltip');
  const previewBtn = document.getElementById('preview-btn');
  const exportBtn = document.getElementById('export-btn');
  const resetBtn = document.getElementById('reset-btn');
  const exportFormatLabel = document.getElementById('export-format-label');
  const progressSection = document.getElementById('progress-section');
  const progressLabel = document.getElementById('progress-label');
  const progressPercent = document.getElementById('progress-percent');
  const progressBar = document.getElementById('progress-bar');
  const cancelBtn = document.getElementById('cancel-btn');

  // --- State ---
  let sourceFile = null;
  let sourceFileName = '';
  let videoDuration = 0;
  let videoObjectUrl = null;
  let ffmpegInstance = null;
  let ffmpegLoading = false;
  let cuts = [];
  let selectedCutId = null;
  let nextCutId = 1;
  let previewSegments = null;
  let previewIndex = 0;
  let draggingCutId = null;
  let zoomLevel = 1;

  // Undo/Redo
  let undoStack = [];
  let redoStack = [];
  const MAX_UNDO = 50;

  // Snap
  const SNAP_THRESHOLD_PX = 8;

  // --- Utility Functions ---
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function parseTime(str) {
    const match = str.match(/^(\d{1,2}):(\d{2})\.(\d{3})$/);
    if (!match) return null;
    return parseInt(match[1]) * 60 + parseInt(match[2]) + parseInt(match[3]) / 1000;
  }

  function formatTimeFFmpeg(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = (seconds % 60).toFixed(3);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(6, '0')}`;
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function getKeptSegments() {
    const sorted = [...cuts].sort((a, b) => a.start - b.start);
    const kept = [];
    let pos = 0;
    for (const cut of sorted) {
      if (cut.start > pos) {
        kept.push({ start: pos, end: cut.start });
      }
      pos = Math.max(pos, cut.end);
    }
    if (pos < videoDuration) {
      kept.push({ start: pos, end: videoDuration });
    }
    return kept;
  }

  function getOutputDuration() {
    const kept = getKeptSegments();
    return kept.reduce((sum, s) => sum + (s.end - s.start), 0);
  }

  // --- Undo/Redo ---
  function pushUndo() {
    undoStack.push(JSON.stringify(cuts));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.stringify(cuts));
    cuts = JSON.parse(undoStack.pop());
    selectedCutId = null;
    renderCuts();
    updateUndoRedoButtons();
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.stringify(cuts));
    cuts = JSON.parse(redoStack.pop());
    selectedCutId = null;
    renderCuts();
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  // --- Snap Logic ---
  function getSnapTargets(excludeCutId, isStart) {
    const targets = [0, videoDuration, video.currentTime];
    for (const cut of cuts) {
      if (cut.id === excludeCutId) continue;
      targets.push(cut.start, cut.end);
    }
    return targets;
  }

  function snapTime(time, excludeCutId, isStart) {
    const rect = timeline.getBoundingClientRect();
    const pxPerSec = rect.width / videoDuration;
    const thresholdSec = SNAP_THRESHOLD_PX / pxPerSec;
    const targets = getSnapTargets(excludeCutId, isStart);
    let closest = time;
    let minDist = thresholdSec;
    for (const t of targets) {
      const dist = Math.abs(time - t);
      if (dist < minDist) {
        minDist = dist;
        closest = t;
      }
    }
    return closest;
  }

  // --- File Loading ---
  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      loadVideo(file);
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) loadVideo(file);
  });

  function loadVideo(file) {
    sourceFile = file;
    sourceFileName = file.name;

    if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
    videoObjectUrl = URL.createObjectURL(file);
    video.src = videoObjectUrl;
    video.load();

    dropZone.classList.add('hidden');
    editor.classList.remove('hidden');
    exportFormatLabel.textContent = 'Format: ' + getSourceFormat().toUpperCase();
  }

  // --- Video Player Controls ---
  playPauseBtn.addEventListener('click', () => {
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  });

  video.addEventListener('play', () => {
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
  });

  video.addEventListener('pause', () => {
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
  });

  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    volumeWaves.style.display = video.muted ? 'none' : '';
  });

  volumeSlider.addEventListener('input', () => {
    video.volume = parseFloat(volumeSlider.value);
  });

  // --- Video Metadata ---
  function resolveVideoDuration() {
    return new Promise((resolve) => {
      if (isFinite(video.duration)) {
        resolve(video.duration);
        return;
      }
      video.currentTime = 1e10;
      video.addEventListener('seeked', function onSeeked() {
        video.removeEventListener('seeked', onSeeked);
        video.currentTime = 0;
        video.addEventListener('seeked', function onReset() {
          video.removeEventListener('seeked', onReset);
          resolve(video.duration);
        }, { once: true });
      }, { once: true });
    });
  }

  video.addEventListener('loadedmetadata', async () => {
    videoDuration = await resolveVideoDuration();
    totalTimeEl.textContent = formatTime(videoDuration);
    cuts = [];
    selectedCutId = null;
    nextCutId = 1;
    zoomLevel = 1;
    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();
    updateZoom();
    renderCuts();
    generateThumbnails();
    generateWaveform();
  });

  // --- Time Update & Playhead ---
  video.addEventListener('timeupdate', () => {
    const t = video.currentTime;
    currentTimeEl.textContent = formatTime(t);

    if (videoDuration > 0) {
      const pct = (t / videoDuration) * 100;
      playhead.style.left = pct + '%';
    }

    if (previewSegments) {
      const seg = previewSegments[previewIndex];
      if (!seg) {
        video.pause();
        previewSegments = null;
        return;
      }
      if (t >= seg.end - 0.05) {
        previewIndex++;
        const next = previewSegments[previewIndex];
        if (next) {
          video.currentTime = next.start;
        } else {
          video.pause();
          previewSegments = null;
        }
      }
    }
  });

  // --- Timeline Click to Seek ---
  timeline.addEventListener('click', (e) => {
    if (e.target.closest('.cut-handle') || e.target.closest('.cut-overlay')) return;
    const rect = timeline.getBoundingClientRect();
    const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    video.currentTime = pct * videoDuration;
    selectedCutId = null;
    renderCutsList();
    updateCutOverlaySelections();
  });

  // --- Timeline Tooltip ---
  timeline.addEventListener('mousemove', (e) => {
    const rect = timeline.getBoundingClientRect();
    const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const time = pct * videoDuration;
    timelineTooltip.textContent = formatTime(time);
    timelineTooltip.style.left = (e.clientX - timelineWrapper.getBoundingClientRect().left) + 'px';
    timelineTooltip.classList.add('visible');
  });

  timeline.addEventListener('mouseleave', () => {
    timelineTooltip.classList.remove('visible');
  });

  // --- Timeline Zoom ---
  timelineWrapper.addEventListener('wheel', (e) => {
    if (!videoDuration) return;
    e.preventDefault();
    const rect = timelineWrapper.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + timelineWrapper.scrollLeft;
    const mousePct = mouseX / timeline.offsetWidth;

    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    const newZoom = clamp(zoomLevel + delta, 1, 20);
    if (newZoom === zoomLevel) return;
    zoomLevel = newZoom;
    updateZoom();

    // Keep the point under the cursor stable
    const newMouseX = mousePct * timeline.offsetWidth;
    timelineWrapper.scrollLeft = newMouseX - (e.clientX - rect.left);
  });

  function updateZoom() {
    timeline.style.width = (100 * zoomLevel) + '%';
    zoomLabel.textContent = zoomLevel.toFixed(1) + 'x';
  }

  // --- Thumbnail Generation ---
  function generateThumbnails() {
    const canvas = thumbnailCanvas;
    const ctx = canvas.getContext('2d');
    const rect = timeline.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const numThumbs = Math.min(20, Math.ceil(rect.width / 80));
    const thumbWidth = rect.width / numThumbs;
    const thumbHeight = rect.height;
    let generated = 0;

    const tempVideo = document.createElement('video');
    tempVideo.src = videoObjectUrl;
    tempVideo.muted = true;
    tempVideo.preload = 'auto';

    tempVideo.addEventListener('loadedmetadata', () => {
      function captureNext() {
        if (generated >= numThumbs) {
          tempVideo.remove();
          return;
        }
        const time = (generated + 0.5) * (videoDuration / numThumbs);
        tempVideo.currentTime = time;
      }

      tempVideo.addEventListener('seeked', () => {
        const x = generated * thumbWidth;
        ctx.drawImage(tempVideo, x, 0, thumbWidth, thumbHeight);
        generated++;
        captureNext();
      });

      captureNext();
    });
  }

  // --- Waveform Generation ---
  async function generateWaveform() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await sourceFile.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const channelData = audioBuffer.getChannelData(0);

      const canvas = waveformCanvas;
      const rect = timeline.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      const ctx = canvas.getContext('2d');
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      const w = rect.width;
      const h = rect.height;
      const samplesPerPixel = Math.floor(channelData.length / w);

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0, 206, 201, 0.6)';

      for (let x = 0; x < w; x++) {
        const offset = x * samplesPerPixel;
        let min = 0, max = 0;
        for (let j = 0; j < samplesPerPixel; j++) {
          const val = channelData[offset + j] || 0;
          if (val < min) min = val;
          if (val > max) max = val;
        }
        const y1 = (1 - max) * h / 2;
        const y2 = (1 - min) * h / 2;
        ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
      }

      audioCtx.close();
    } catch (e) {
      // Waveform is optional — don't block on errors
      console.warn('Waveform generation failed:', e.message);
    }
  }

  // --- Cut Segments ---
  addCutBtn.addEventListener('click', () => {
    addCutAtPlayhead();
  });

  function addCutAtPlayhead() {
    pushUndo();
    const t = video.currentTime;
    const cutDuration = Math.min(2, videoDuration * 0.1);
    const start = clamp(t - cutDuration / 2, 0, videoDuration - 0.2);
    const end = clamp(start + cutDuration, 0.2, videoDuration);

    const cut = { id: nextCutId++, start, end };
    cuts.push(cut);
    mergeCuts();
    selectedCutId = cut.id;
    renderCuts();
  }

  // --- Split at Playhead ---
  splitBtn.addEventListener('click', () => {
    splitAtPlayhead();
  });

  function splitAtPlayhead() {
    const t = video.currentTime;
    if (t <= 0.05 || t >= videoDuration - 0.05) return;

    // Check if playhead is inside an existing cut — split it into two
    const insideCut = cuts.find(c => t > c.start + 0.05 && t < c.end - 0.05);
    if (insideCut) {
      pushUndo();
      const newCut = { id: nextCutId++, start: t, end: insideCut.end };
      insideCut.end = t;
      cuts.push(newCut);
      renderCuts();
      return;
    }

    // Otherwise, create a zero-width cut marker that the user can drag open
    pushUndo();
    const cut = { id: nextCutId++, start: clamp(t - 0.05, 0, videoDuration), end: clamp(t + 0.05, 0, videoDuration) };
    cuts.push(cut);
    mergeCuts();
    selectedCutId = cut.id;
    renderCuts();
  }

  function mergeCuts() {
    if (cuts.length < 2) return;
    cuts.sort((a, b) => a.start - b.start);
    const merged = [cuts[0]];
    for (let i = 1; i < cuts.length; i++) {
      const prev = merged[merged.length - 1];
      if (cuts[i].start <= prev.end) {
        prev.end = Math.max(prev.end, cuts[i].end);
      } else {
        merged.push(cuts[i]);
      }
    }
    cuts = merged;
  }

  function deleteSelectedCut() {
    if (selectedCutId == null) return;
    pushUndo();
    cuts = cuts.filter(c => c.id !== selectedCutId);
    selectedCutId = null;
    renderCuts();
  }

  function renderCuts() {
    updateCutOverlays();
    renderCutsList();
    outputDuration.textContent = 'Output: ' + formatTime(getOutputDuration());
  }

  function updateCutPositions() {
    for (const cut of cuts) {
      const el = cutsContainer.querySelector(`[data-cut-id="${cut.id}"]`);
      if (!el) continue;
      const startPct = (cut.start / videoDuration) * 100;
      const endPct = (cut.end / videoDuration) * 100;
      el.style.left = startPct + '%';
      el.style.width = (endPct - startPct) + '%';
    }
    outputDuration.textContent = 'Output: ' + formatTime(getOutputDuration());
    const listItems = cutsList.querySelectorAll('.cut-item');
    const sorted = [...cuts].sort((a, b) => a.start - b.start);
    listItems.forEach((item, i) => {
      if (sorted[i]) {
        const cut = sorted[i];
        const startIn = item.querySelector('.cut-start-input');
        const endIn = item.querySelector('.cut-end-input');
        const dur = item.querySelector('.cut-item-duration');
        if (startIn && document.activeElement !== startIn) startIn.value = formatTime(cut.start);
        if (endIn && document.activeElement !== endIn) endIn.value = formatTime(cut.end);
        if (dur) dur.textContent = formatTime(cut.end - cut.start);
      }
    });
  }

  function updateCutOverlays() {
    const existingIds = new Set(cuts.map(c => String(c.id)));
    cutsContainer.querySelectorAll('.cut-overlay').forEach(el => {
      if (!existingIds.has(el.dataset.cutId)) el.remove();
    });

    for (const cut of cuts) {
      const startPct = (cut.start / videoDuration) * 100;
      const endPct = (cut.end / videoDuration) * 100;
      let overlay = cutsContainer.querySelector(`[data-cut-id="${cut.id}"]`);

      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'cut-overlay';
        overlay.dataset.cutId = String(cut.id);

        overlay.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedCutId = cut.id === selectedCutId ? null : cut.id;
          renderCuts();
        });

        const handleStart = document.createElement('div');
        handleStart.className = 'cut-handle start';
        handleStart.innerHTML = '<div class="handle-grip"></div>';
        setupCutHandleDrag(handleStart, cut, true);
        overlay.appendChild(handleStart);

        const handleEnd = document.createElement('div');
        handleEnd.className = 'cut-handle end';
        handleEnd.innerHTML = '<div class="handle-grip"></div>';
        setupCutHandleDrag(handleEnd, cut, false);
        overlay.appendChild(handleEnd);

        cutsContainer.appendChild(overlay);
      }

      overlay.style.left = startPct + '%';
      overlay.style.width = (endPct - startPct) + '%';

      if (cut.id === selectedCutId) {
        overlay.classList.add('selected');
      } else {
        overlay.classList.remove('selected');
      }
    }
  }

  function updateCutOverlaySelections() {
    cutsContainer.querySelectorAll('.cut-overlay').forEach(el => {
      if (el.dataset.cutId === String(selectedCutId)) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });
  }

  function renderCutsList() {
    cutsList.innerHTML = '';
    const sorted = [...cuts].sort((a, b) => a.start - b.start);
    for (const cut of sorted) {
      const item = document.createElement('div');
      item.className = 'cut-item' + (cut.id === selectedCutId ? ' selected' : '');

      const label = document.createElement('span');
      label.className = 'cut-item-label';
      label.textContent = 'Cut';

      const startInput = document.createElement('input');
      startInput.type = 'text';
      startInput.className = 'cut-item-time-input cut-start-input';
      startInput.value = formatTime(cut.start);
      startInput.addEventListener('change', () => {
        const t = parseTime(startInput.value);
        if (t != null) {
          pushUndo();
          cut.start = clamp(t, 0, cut.end - 0.1);
          mergeCuts();
          renderCuts();
        } else {
          startInput.value = formatTime(cut.start);
        }
      });

      const sep = document.createElement('span');
      sep.className = 'cut-item-separator';
      sep.textContent = '-';

      const endInput = document.createElement('input');
      endInput.type = 'text';
      endInput.className = 'cut-item-time-input cut-end-input';
      endInput.value = formatTime(cut.end);
      endInput.addEventListener('change', () => {
        const t = parseTime(endInput.value);
        if (t != null) {
          pushUndo();
          cut.end = clamp(t, cut.start + 0.1, videoDuration);
          mergeCuts();
          renderCuts();
        } else {
          endInput.value = formatTime(cut.end);
        }
      });

      const dur = document.createElement('span');
      dur.className = 'cut-item-duration';
      dur.textContent = formatTime(cut.end - cut.start);

      const del = document.createElement('button');
      del.className = 'cut-item-delete';
      del.textContent = '\u00d7';
      del.title = 'Remove this cut';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        pushUndo();
        cuts = cuts.filter(c => c.id !== cut.id);
        if (selectedCutId === cut.id) selectedCutId = null;
        renderCuts();
      });

      item.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        selectedCutId = cut.id === selectedCutId ? null : cut.id;
        renderCuts();
      });

      item.appendChild(label);
      item.appendChild(startInput);
      item.appendChild(sep);
      item.appendChild(endInput);
      item.appendChild(dur);
      item.appendChild(del);
      cutsList.appendChild(item);
    }
  }

  function setupCutHandleDrag(handle, cut, isStart) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pushUndo();
      draggingCutId = cut.id;
      handle.setPointerCapture(e.pointerId);
      selectedCutId = cut.id;
      renderCutsList();
    });

    handle.addEventListener('pointermove', (e) => {
      if (draggingCutId !== cut.id) return;
      const rect = timeline.getBoundingClientRect();
      const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      let time = pct * videoDuration;

      // Snap
      time = snapTime(time, cut.id, isStart);

      if (isStart) {
        cut.start = clamp(time, 0, cut.end - 0.1);
      } else {
        cut.end = clamp(time, cut.start + 0.1, videoDuration);
      }
      updateCutPositions();
    });

    handle.addEventListener('pointerup', () => {
      if (draggingCutId === cut.id) {
        draggingCutId = null;
        mergeCuts();
        renderCuts();
      }
    });
  }

  // --- Preview Output ---
  previewBtn.addEventListener('click', () => {
    const kept = getKeptSegments();
    if (kept.length === 0) return;
    previewSegments = kept;
    previewIndex = 0;
    video.currentTime = kept[0].start;
    video.play();
  });

  // --- Keyboard Shortcuts ---
  document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (!sourceFile) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (video.paused) video.play();
        else video.pause();
        break;

      case 'ArrowLeft':
        e.preventDefault();
        video.currentTime = clamp(video.currentTime - (e.shiftKey ? 1 / 30 : 1), 0, videoDuration);
        break;

      case 'ArrowRight':
        e.preventDefault();
        video.currentTime = clamp(video.currentTime + (e.shiftKey ? 1 / 30 : 1), 0, videoDuration);
        break;

      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        deleteSelectedCut();
        break;

      case 's':
      case 'S':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          splitAtPlayhead();
        }
        break;

      case 'z':
      case 'Z':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        }
        break;

      case 'y':
      case 'Y':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          redo();
        }
        break;
    }
  });

  // --- Reset / Load Another ---
  resetBtn.addEventListener('click', () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (videoObjectUrl) {
      URL.revokeObjectURL(videoObjectUrl);
      videoObjectUrl = null;
    }
    sourceFile = null;
    sourceFileName = '';
    videoDuration = 0;
    cuts = [];
    selectedCutId = null;
    nextCutId = 1;
    previewSegments = null;
    zoomLevel = 1;
    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();
    fileInput.value = '';

    editor.classList.add('hidden');
    dropZone.classList.remove('hidden');
    progressSection.classList.add('hidden');
  });

  // --- FFmpeg Export ---
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
        coreURL: '/vendor/ffmpeg/ffmpeg-core.js',
        wasmURL: '/vendor/ffmpeg/ffmpeg-core.wasm',
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

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.crossOrigin = 'anonymous';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load script: ' + src));
      document.head.appendChild(script);
    });
  }

  exportBtn.addEventListener('click', async () => {
    if (!sourceFile) return;

    const kept = getKeptSegments();
    if (kept.length === 0) return;

    const ffmpeg = await loadFFmpeg();
    if (!ffmpeg) return;

    progressSection.classList.remove('hidden');
    progressLabel.textContent = 'Processing video...';
    progressPercent.textContent = '0%';
    progressBar.style.width = '0%';
    exportBtn.disabled = true;

    try {
      const inputName = 'input' + getExtension(sourceFileName);
      const format = getSourceFormat();
      const outputName = 'output.' + format;

      const fileData = await sourceFile.arrayBuffer();
      await ffmpeg.writeFile(inputName, new Uint8Array(fileData));

      if (kept.length === 1) {
        const seg = kept[0];
        const args = ['-i', inputName, '-ss', formatTimeFFmpeg(seg.start), '-to', formatTimeFFmpeg(seg.end)];
        if (format === 'mp4' && sourceFileName.toLowerCase().endsWith('.mp4')) {
          args.push('-c', 'copy');
        } else if (format === 'webm') {
          args.push('-c:v', 'libvpx-vp9', '-c:a', 'libvorbis', '-b:v', '1M');
        } else {
          args.push('-c:v', 'libx264', '-c:a', 'aac');
        }
        args.push('-y', outputName);
        await ffmpeg.exec(args);
      } else {
        const canCopy = format === 'mp4' && sourceFileName.toLowerCase().endsWith('.mp4');
        const segFiles = [];
        for (let i = 0; i < kept.length; i++) {
          const seg = kept[i];
          const segName = `seg${i}.${format}`;
          segFiles.push(segName);

          const args = ['-i', inputName, '-ss', formatTimeFFmpeg(seg.start), '-to', formatTimeFFmpeg(seg.end)];
          if (canCopy) {
            args.push('-c', 'copy');
          } else if (format === 'webm') {
            args.push('-c:v', 'libvpx-vp9', '-c:a', 'libvorbis', '-b:v', '1M');
          } else {
            args.push('-c:v', 'libx264', '-c:a', 'aac');
          }
          args.push('-y', segName);

          progressLabel.textContent = `Processing segment ${i + 1} of ${kept.length}...`;
          await ffmpeg.exec(args);
        }

        const concatList = segFiles.map(f => `file '${f}'`).join('\n');
        await ffmpeg.writeFile('concat.txt', concatList);

        progressLabel.textContent = 'Joining segments...';
        await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', '-y', outputName]);

        for (const f of segFiles) {
          await ffmpeg.deleteFile(f);
        }
        await ffmpeg.deleteFile('concat.txt');
      }

      const data = await ffmpeg.readFile(outputName);
      const mimeType = format === 'webm' ? 'video/webm' : 'video/mp4';
      const blob = new Blob([data.buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = getOutputName(sourceFileName, format);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(url), 5000);

      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);

      progressLabel.textContent = 'Export complete!';
      progressPercent.textContent = '100%';
      progressBar.style.width = '100%';
    } catch (err) {
      if (err.message?.includes('abort')) {
        progressLabel.textContent = 'Export cancelled.';
      } else {
        progressLabel.textContent = 'Export failed: ' + err.message;
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

  function getExtension(filename) {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.substring(dot) : '';
  }

  function getSourceFormat() {
    const ext = getExtension(sourceFileName).toLowerCase().replace('.', '');
    const formatMap = { webm: 'webm', mp4: 'mp4', mov: 'mp4', avi: 'mp4', mkv: 'mp4' };
    return formatMap[ext] || 'mp4';
  }

  function getOutputName(filename, format) {
    const dot = filename.lastIndexOf('.');
    const base = dot >= 0 ? filename.substring(0, dot) : filename;
    return base + '_edited.' + format;
  }
})();
