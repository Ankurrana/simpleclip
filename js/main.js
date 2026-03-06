import { state, on, resetState } from './state.js';
import { clamp, getSourceFormat } from './utils.js';
import { initVideo, loadVideoFile, unloadVideo, getVideo, seekRelative, togglePlayPause, startPreview } from './video.js';
import { initTimeline, generateThumbnails, generateWaveform, renderCuts, resetZoom, detectSilence, hasAudioData } from './timeline.js';
import { addCut, deleteSelected, setMarkIn, setMarkOut, addSilenceCuts, undo, redo, canUndo, canRedo, resetUndoRedo, getKeptSegments } from './cuts.js';
import { initExport, resetExport } from './export.js';

// --- DOM Elements ---
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const editor = document.getElementById('editor');
const addCutBtn = document.getElementById('add-cut-btn');
const autoSilenceBtn = document.getElementById('auto-silence-btn');
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const previewBtn = document.getElementById('preview-btn');
const resetBtn = document.getElementById('reset-btn');
const exportFormatLabel = document.getElementById('export-format-label');

// --- Init modules ---
const video = getVideo();
initVideo();
initTimeline(video);
initExport();

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
    openFile(file);
  }
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) openFile(file);
});

function openFile(file) {
  loadVideoFile(file);
  dropZone.classList.add('hidden');
  editor.classList.remove('hidden');
  exportFormatLabel.textContent = 'Format: ' + getSourceFormat(file.name).toUpperCase();
}

// --- Video loaded event ---
on('videoLoaded', () => {
  state.cuts = [];
  state.selectedCutId = null;
  state.nextCutId = 1;
  resetZoom();
  resetUndoRedo();
  renderCuts();
  generateThumbnails();
  generateWaveform();
});

// --- Undo/Redo button state ---
on('undoStateChanged', () => {
  undoBtn.disabled = !canUndo();
  redoBtn.disabled = !canRedo();
});

// --- Toolbar Buttons ---
addCutBtn.addEventListener('click', () => addCut(video.currentTime));
autoSilenceBtn.addEventListener('click', () => {
  if (!hasAudioData()) {
    autoSilenceBtn.textContent = 'No audio data';
    setTimeout(() => { autoSilenceBtn.textContent = 'Remove Silence'; }, 2000);
    return;
  }
  const regions = detectSilence({ threshold: 0.02, minDuration: 0.5 });
  if (regions.length === 0) {
    autoSilenceBtn.textContent = 'No silence found';
    setTimeout(() => { autoSilenceBtn.textContent = 'Remove Silence'; }, 2000);
    return;
  }
  addSilenceCuts(regions);
  autoSilenceBtn.textContent = `Removed ${regions.length} silent section${regions.length > 1 ? 's' : ''}`;
  setTimeout(() => { autoSilenceBtn.textContent = 'Remove Silence'; }, 2000);
});
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

previewBtn.addEventListener('click', () => {
  startPreview(getKeptSegments());
});

// --- Reset ---
resetBtn.addEventListener('click', () => {
  unloadVideo();
  resetState();
  resetUndoRedo();
  resetExport();
  resetZoom();
  fileInput.value = '';
  editor.classList.add('hidden');
  dropZone.classList.remove('hidden');
});

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (!state.sourceFile) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlayPause();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      seekRelative(e.shiftKey ? -1 / 30 : -1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      seekRelative(e.shiftKey ? 1 / 30 : 1);
      break;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      deleteSelected();
      break;
    case 'i':
    case 'I':
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setMarkIn(video.currentTime);
      }
      break;
    case 'o':
    case 'O':
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setMarkOut(video.currentTime);
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
