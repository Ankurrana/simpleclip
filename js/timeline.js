import { state, emit, on } from './state.js';
import { formatTime, parseTime, clamp } from './utils.js';
import {
  getOutputDuration, getKeptSegments, selectCut, deselectAll, deleteCut,
  selectSegment, removeSegment, getSegmentAtTime, clearSelection,
  hasSelection, removeSelection, keepSelection,
  beginDrag, endDrag, updateCutStart, updateCutEnd, snapTime,
  setCutStartFromInput, setCutEndFromInput
} from './cuts.js';

const timelineWrapper = document.getElementById('timeline-wrapper');
const timeline = document.getElementById('timeline');
const thumbnailCanvas = document.getElementById('thumbnail-canvas');
const waveformCanvas = document.getElementById('waveform-canvas');
const cutsContainer = document.getElementById('cuts-container');
const zoomLabel = document.getElementById('zoom-label');
const timelineTooltip = document.getElementById('timeline-tooltip');
const outputDuration = document.getElementById('output-duration');
const cutsList = document.getElementById('cuts-list');

export function initTimeline(video) {
  // Click-and-drag to select a range, or click to seek
  let isDraggingSelection = false;
  let dragStartTime = -1;

  timeline.addEventListener('mousedown', (e) => {
    if (e.target.closest('.cut-handle') || e.target.closest('.cut-overlay')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = timeline.getBoundingClientRect();
    const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    dragStartTime = pct * state.videoDuration;
    isDraggingSelection = false;
  });

  document.addEventListener('mousemove', (e) => {
    if (dragStartTime < 0) return;
    const rect = timeline.getBoundingClientRect();
    const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const time = pct * state.videoDuration;

    const pxDist = Math.abs(pct * rect.width - (dragStartTime / state.videoDuration) * rect.width);
    if (!isDraggingSelection && pxDist > 5) {
      isDraggingSelection = true;
      state.selectedCutId = null;
      state.selectedSegmentIndex = -1;
    }

    if (isDraggingSelection) {
      state.selectionStart = Math.min(dragStartTime, time);
      state.selectionEnd = Math.max(dragStartTime, time);
      updateSelectionHighlight();
      renderSegmentsList();
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (dragStartTime < 0) return;
    if (!isDraggingSelection) {
      // Simple click — seek and select segment
      const rect = timeline.getBoundingClientRect();
      const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const time = pct * state.videoDuration;
      video.currentTime = time;
      clearSelection();
      const segIdx = getSegmentAtTime(time);
      if (segIdx >= 0) selectSegment(segIdx);
      else deselectAll();
    } else {
      emit('cutsChanged');
    }
    dragStartTime = -1;
    isDraggingSelection = false;
  });

  // Tooltip
  timeline.addEventListener('mousemove', (e) => {
    const rect = timeline.getBoundingClientRect();
    const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    timelineTooltip.textContent = formatTime(pct * state.videoDuration);
    timelineTooltip.style.left = (e.clientX - timelineWrapper.getBoundingClientRect().left) + 'px';
    timelineTooltip.classList.add('visible');
  });

  timeline.addEventListener('mouseleave', () => {
    timelineTooltip.classList.remove('visible');
  });

  // Zoom
  timelineWrapper.addEventListener('wheel', (e) => {
    if (!state.videoDuration) return;
    e.preventDefault();
    const rect = timelineWrapper.getBoundingClientRect();
    const mouseX = e.clientX - rect.left + timelineWrapper.scrollLeft;
    const mousePct = mouseX / timeline.offsetWidth;

    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    state.zoomLevel = clamp(state.zoomLevel + delta, 1, 20);
    updateZoom();

    const newMouseX = mousePct * timeline.offsetWidth;
    timelineWrapper.scrollLeft = newMouseX - (e.clientX - rect.left);
  });

  on('cutsChanged', renderAll);
}

let zoomRedrawTimer = null;

function updateZoom() {
  timeline.style.width = (100 * state.zoomLevel) + '%';
  zoomLabel.textContent = state.zoomLevel.toFixed(1) + 'x';
  // Debounce waveform redraw since it's expensive
  clearTimeout(zoomRedrawTimer);
  zoomRedrawTimer = setTimeout(() => drawWaveform(), 150);
}

// --- Rendering ---

function renderAll() {
  updateCutOverlays();
  updateSegmentHighlights();
  updateSelectionHighlight();
  renderSegmentsList();
  outputDuration.textContent = 'Output: ' + formatTime(getOutputDuration());
}

export function updateCutPositions() {
  for (const cut of state.cuts) {
    const el = cutsContainer.querySelector(`[data-cut-id="${cut.id}"]`);
    if (!el) continue;
    const startPct = (cut.start / state.videoDuration) * 100;
    const endPct = (cut.end / state.videoDuration) * 100;
    el.style.left = startPct + '%';
    el.style.width = (endPct - startPct) + '%';
  }
  outputDuration.textContent = 'Output: ' + formatTime(getOutputDuration());
  updateSegmentHighlights();
}

function updateCutOverlays() {
  const existingIds = new Set(state.cuts.map(c => String(c.id)));
  cutsContainer.querySelectorAll('.cut-overlay').forEach(el => {
    if (!existingIds.has(el.dataset.cutId)) el.remove();
  });

  for (const cut of state.cuts) {
    const startPct = (cut.start / state.videoDuration) * 100;
    const endPct = (cut.end / state.videoDuration) * 100;
    let overlay = cutsContainer.querySelector(`[data-cut-id="${cut.id}"]`);

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'cut-overlay';
      overlay.dataset.cutId = String(cut.id);

      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        selectCut(cut.id);
      });

      const handleStart = createHandle(cut, true);
      const handleEnd = createHandle(cut, false);
      overlay.appendChild(handleStart);
      overlay.appendChild(handleEnd);
      cutsContainer.appendChild(overlay);
    }

    overlay.style.left = startPct + '%';
    overlay.style.width = (endPct - startPct) + '%';
    overlay.classList.toggle('selected', cut.id === state.selectedCutId);
  }
}

function createHandle(cut, isStart) {
  const handle = document.createElement('div');
  handle.className = 'cut-handle ' + (isStart ? 'start' : 'end');
  handle.innerHTML = '<div class="handle-grip"></div>';

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    beginDrag(cut.id);
    handle.setPointerCapture(e.pointerId);
    renderSegmentsList();
  });

  handle.addEventListener('pointermove', (e) => {
    if (state.draggingCutId !== cut.id) return;
    const rect = timeline.getBoundingClientRect();
    const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    let time = pct * state.videoDuration;
    time = snapTime(time, cut.id, rect.width);

    if (isStart) updateCutStart(cut, time);
    else updateCutEnd(cut, time);
    updateCutPositions();
  });

  handle.addEventListener('pointerup', () => {
    if (state.draggingCutId === cut.id) endDrag();
  });

  return handle;
}

// --- Selection highlight (drag-to-select range) ---

function updateSelectionHighlight() {
  let el = cutsContainer.querySelector('.selection-highlight');
  if (state.selectionStart < 0 || state.selectionEnd < 0 ||
      Math.abs(state.selectionEnd - state.selectionStart) < 0.05) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'selection-highlight';
    cutsContainer.appendChild(el);
  }
  const startPct = (Math.min(state.selectionStart, state.selectionEnd) / state.videoDuration) * 100;
  const endPct = (Math.max(state.selectionStart, state.selectionEnd) / state.videoDuration) * 100;
  el.style.left = startPct + '%';
  el.style.width = (endPct - startPct) + '%';
}

// --- Segment highlights on timeline ---

function updateSegmentHighlights() {
  // Remove old highlights
  cutsContainer.querySelectorAll('.segment-highlight').forEach(el => el.remove());

  if (state.selectedSegmentIndex < 0) return;
  const kept = getKeptSegments();
  const seg = kept[state.selectedSegmentIndex];
  if (!seg) return;

  const startPct = (seg.start / state.videoDuration) * 100;
  const endPct = (seg.end / state.videoDuration) * 100;
  const highlight = document.createElement('div');
  highlight.className = 'segment-highlight';
  highlight.style.left = startPct + '%';
  highlight.style.width = (endPct - startPct) + '%';
  cutsContainer.appendChild(highlight);
}

// --- Cuts list + selection info ---

function renderSegmentsList() {
  cutsList.innerHTML = '';

  // Show selection info if a range is selected
  if (hasSelection()) {
    const start = Math.min(state.selectionStart, state.selectionEnd);
    const end = Math.max(state.selectionStart, state.selectionEnd);
    const item = document.createElement('div');
    item.className = 'segment-item selection-info';

    const label = document.createElement('span');
    label.className = 'selection-info-label';
    label.textContent = 'Selected';

    const times = document.createElement('span');
    times.className = 'segment-item-times';
    times.textContent = `${formatTime(start)} - ${formatTime(end)} (${formatTime(end - start)})`;

    const btnGroup = document.createElement('div');
    btnGroup.className = 'selection-btn-group';

    const keepBtn = document.createElement('button');
    keepBtn.className = 'btn btn-small btn-keep-selection';
    keepBtn.textContent = 'Keep';
    keepBtn.title = 'Keep only this section, remove everything else';
    keepBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      keepSelection();
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-small btn-remove-selection';
    removeBtn.textContent = 'Remove';
    removeBtn.title = 'Remove this section from the video';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeSelection();
    });

    btnGroup.appendChild(keepBtn);
    btnGroup.appendChild(removeBtn);

    item.appendChild(label);
    item.appendChild(times);
    item.appendChild(btnGroup);
    cutsList.appendChild(item);
  }

  // Show cuts (removed sections)
  const sorted = [...state.cuts].sort((a, b) => a.start - b.start);
  if (sorted.length === 0 && !hasSelection()) {
    const empty = document.createElement('div');
    empty.className = 'cuts-empty';
    empty.textContent = 'No cuts yet';
    cutsList.appendChild(empty);
    return;
  }

  for (const cut of sorted) {
    const isSelected = cut.id === state.selectedCutId;

    const item = document.createElement('div');
    item.className = 'cut-item' + (isSelected ? ' selected' : '');

    const label = document.createElement('span');
    label.className = 'cut-item-label';
    label.textContent = 'Cut';

    const times = document.createElement('span');
    times.className = 'cut-item-times';
    times.textContent = `${formatTime(cut.start)} - ${formatTime(cut.end)}`;

    const dur = document.createElement('span');
    dur.className = 'cut-item-duration';
    dur.textContent = formatTime(cut.end - cut.start);

    const del = document.createElement('button');
    del.className = 'cut-item-delete';
    del.textContent = '\u00d7';
    del.title = 'Restore this section';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCut(cut.id);
    });

    item.addEventListener('click', () => {
      selectCut(cut.id);
    });

    item.appendChild(label);
    item.appendChild(times);
    item.appendChild(dur);
    item.appendChild(del);
    cutsList.appendChild(item);
  }
}

// --- Thumbnails ---

export function generateThumbnails() {
  const ctx = thumbnailCanvas.getContext('2d');
  const rect = timeline.getBoundingClientRect();
  thumbnailCanvas.width = rect.width * window.devicePixelRatio;
  thumbnailCanvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const numThumbs = Math.min(20, Math.ceil(rect.width / 80));
  const thumbWidth = rect.width / numThumbs;
  const thumbHeight = rect.height;
  let generated = 0;

  const tempVideo = document.createElement('video');
  tempVideo.src = state.videoObjectUrl;
  tempVideo.muted = true;
  tempVideo.preload = 'auto';

  tempVideo.addEventListener('loadedmetadata', () => {
    function captureNext() {
      if (generated >= numThumbs) { tempVideo.remove(); return; }
      tempVideo.currentTime = (generated + 0.5) * (state.videoDuration / numThumbs);
    }
    tempVideo.addEventListener('seeked', () => {
      ctx.drawImage(tempVideo, generated * thumbWidth, 0, thumbWidth, thumbHeight);
      generated++;
      captureNext();
    });
    captureNext();
  });
}

// --- Waveform ---

let cachedChannelData = null;

export async function generateWaveform() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await state.sourceFile.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    cachedChannelData = audioBuffer.getChannelData(0);
    audioCtx.close();
    drawWaveform();
  } catch (e) {
    console.warn('Waveform generation failed:', e.message);
  }
}

function drawWaveform() {
  if (!cachedChannelData) return;
  const rect = timeline.getBoundingClientRect();
  const dpr = window.devicePixelRatio;
  waveformCanvas.width = rect.width * dpr;
  waveformCanvas.height = rect.height * dpr;
  const ctx = waveformCanvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const samplesPerPixel = Math.floor(cachedChannelData.length / w);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0, 206, 201, 0.6)';

  for (let x = 0; x < w; x++) {
    const offset = x * samplesPerPixel;
    let min = 0, max = 0;
    for (let j = 0; j < samplesPerPixel; j++) {
      const val = cachedChannelData[offset + j] || 0;
      if (val < min) min = val;
      if (val > max) max = val;
    }
    const y1 = (1 - max) * h / 2;
    const y2 = (1 - min) * h / 2;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}

// --- Silence Detection ---

export function detectSilence({ threshold = 0.02, minDuration = 0.5 } = {}) {
  if (!cachedChannelData || !state.videoDuration) return [];

  const sampleRate = cachedChannelData.length / state.videoDuration;
  const windowSize = Math.floor(sampleRate * 0.05); // 50ms windows
  const totalWindows = Math.floor(cachedChannelData.length / windowSize);
  const silentRegions = [];
  let silenceStart = -1;

  for (let i = 0; i < totalWindows; i++) {
    const offset = i * windowSize;
    let sumSq = 0;
    for (let j = 0; j < windowSize; j++) {
      const val = cachedChannelData[offset + j] || 0;
      sumSq += val * val;
    }
    const rms = Math.sqrt(sumSq / windowSize);
    const time = (i * windowSize) / sampleRate;

    if (rms < threshold) {
      if (silenceStart < 0) silenceStart = time;
    } else {
      if (silenceStart >= 0) {
        const duration = time - silenceStart;
        if (duration >= minDuration) {
          silentRegions.push({ start: silenceStart, end: time });
        }
        silenceStart = -1;
      }
    }
  }

  // Handle silence at the end
  if (silenceStart >= 0) {
    const endTime = state.videoDuration;
    if (endTime - silenceStart >= minDuration) {
      silentRegions.push({ start: silenceStart, end: endTime });
    }
  }

  return silentRegions;
}

export function hasAudioData() {
  return cachedChannelData != null;
}

export function resetZoom() {
  state.zoomLevel = 1;
  updateZoom();
}

export { renderAll as renderCuts };
