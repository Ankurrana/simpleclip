import { state, emit } from './state.js';
import { clamp } from './utils.js';

const MAX_UNDO = 50;
let undoStack = [];
let redoStack = [];

// --- Kept Segments (inverse of cuts) ---

export function getKeptSegments() {
  const sorted = [...state.cuts].sort((a, b) => a.start - b.start);
  const kept = [];
  let pos = 0;
  for (const cut of sorted) {
    if (cut.start > pos) {
      kept.push({ start: pos, end: cut.start });
    }
    pos = Math.max(pos, cut.end);
  }
  if (pos < state.videoDuration) {
    kept.push({ start: pos, end: state.videoDuration });
  }
  return kept;
}

export function getOutputDuration() {
  return getKeptSegments().reduce((sum, s) => sum + (s.end - s.start), 0);
}

// --- Undo / Redo ---

function pushUndo() {
  undoStack.push(JSON.stringify(state.cuts));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
  emit('undoStateChanged');
}

export function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(JSON.stringify(state.cuts));
  state.cuts = JSON.parse(undoStack.pop());
  state.selectedCutId = null;
  emit('cutsChanged');
  emit('undoStateChanged');
}

export function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(JSON.stringify(state.cuts));
  state.cuts = JSON.parse(redoStack.pop());
  state.selectedCutId = null;
  emit('cutsChanged');
  emit('undoStateChanged');
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

export function resetUndoRedo() {
  undoStack = [];
  redoStack = [];
  emit('undoStateChanged');
}

// --- Merge overlapping cuts ---

function mergeCuts() {
  if (state.cuts.length < 2) return;
  state.cuts.sort((a, b) => a.start - b.start);
  const merged = [state.cuts[0]];
  for (let i = 1; i < state.cuts.length; i++) {
    const prev = merged[merged.length - 1];
    if (state.cuts[i].start <= prev.end) {
      prev.end = Math.max(prev.end, state.cuts[i].end);
    } else {
      merged.push(state.cuts[i]);
    }
  }
  state.cuts = merged;
}

// --- Cut CRUD ---

export function addCut(currentTime) {
  pushUndo();
  const dur = state.videoDuration;
  const cutDuration = Math.min(2, dur * 0.1);
  const start = clamp(currentTime - cutDuration / 2, 0, dur - 0.2);
  const end = clamp(start + cutDuration, 0.2, dur);

  const cut = { id: state.nextCutId++, start, end };
  state.cuts.push(cut);
  mergeCuts();
  state.selectedCutId = cut.id;
  emit('cutsChanged');
}

export function deleteSelectedCut() {
  if (state.selectedCutId == null) return;
  pushUndo();
  state.cuts = state.cuts.filter(c => c.id !== state.selectedCutId);
  state.selectedCutId = null;
  emit('cutsChanged');
}

export function deleteCut(id) {
  pushUndo();
  state.cuts = state.cuts.filter(c => c.id !== id);
  if (state.selectedCutId === id) state.selectedCutId = null;
  emit('cutsChanged');
}

export function updateCutStart(cut, newStart) {
  cut.start = clamp(newStart, 0, cut.end - 0.1);
}

export function updateCutEnd(cut, newEnd) {
  cut.end = clamp(newEnd, cut.start + 0.1, state.videoDuration);
}

export function setCutStartFromInput(cut, time) {
  pushUndo();
  cut.start = clamp(time, 0, cut.end - 0.1);
  mergeCuts();
  emit('cutsChanged');
}

export function setCutEndFromInput(cut, time) {
  pushUndo();
  cut.end = clamp(time, cut.start + 0.1, state.videoDuration);
  mergeCuts();
  emit('cutsChanged');
}

export function beginDrag(cutId) {
  pushUndo();
  state.draggingCutId = cutId;
  state.selectedCutId = cutId;
}

export function endDrag() {
  state.draggingCutId = null;
  mergeCuts();
  emit('cutsChanged');
}

export function selectCut(id) {
  state.selectedCutId = id === state.selectedCutId ? null : id;
  state.selectedSegmentIndex = -1;
  emit('cutsChanged');
}

export function deselectAll() {
  state.selectedCutId = null;
  state.selectedSegmentIndex = -1;
  emit('cutsChanged');
}

export function selectSegment(index) {
  state.selectedSegmentIndex = index === state.selectedSegmentIndex ? -1 : index;
  state.selectedCutId = null;
  emit('cutsChanged');
}

export function removeSegment(index) {
  const kept = getKeptSegments();
  const seg = kept[index];
  if (!seg) return;
  pushUndo();
  const cut = { id: state.nextCutId++, start: seg.start, end: seg.end };
  state.cuts.push(cut);
  mergeCuts();
  state.selectedSegmentIndex = -1;
  state.selectedCutId = null;
  emit('cutsChanged');
}

export function removeSelection() {
  if (state.selectionStart < 0 || state.selectionEnd < 0) return;
  const start = Math.min(state.selectionStart, state.selectionEnd);
  const end = Math.max(state.selectionStart, state.selectionEnd);
  if (end - start < 0.05) return;
  pushUndo();
  state.cuts.push({ id: state.nextCutId++, start, end });
  mergeCuts();
  clearSelection();
  emit('cutsChanged');
}

export function keepSelection() {
  if (state.selectionStart < 0 || state.selectionEnd < 0) return;
  const start = Math.min(state.selectionStart, state.selectionEnd);
  const end = Math.max(state.selectionStart, state.selectionEnd);
  if (end - start < 0.05) return;
  pushUndo();
  // Cut everything outside the selection
  if (start > 0.01) {
    state.cuts.push({ id: state.nextCutId++, start: 0, end: start });
  }
  if (end < state.videoDuration - 0.01) {
    state.cuts.push({ id: state.nextCutId++, start: end, end: state.videoDuration });
  }
  mergeCuts();
  clearSelection();
  emit('cutsChanged');
}

export function clearSelection() {
  state.selectionStart = -1;
  state.selectionEnd = -1;
  state.selectedSegmentIndex = -1;
  state.selectedCutId = null;
}

export function hasSelection() {
  return state.selectionStart >= 0 && state.selectionEnd >= 0 &&
    Math.abs(state.selectionEnd - state.selectionStart) >= 0.05;
}

export function setMarkIn(time) {
  state.selectionStart = clamp(time, 0, state.videoDuration);
  if (state.selectionEnd < 0) state.selectionEnd = state.videoDuration;
  emit('cutsChanged');
}

export function setMarkOut(time) {
  state.selectionEnd = clamp(time, 0, state.videoDuration);
  if (state.selectionStart < 0) state.selectionStart = 0;
  emit('cutsChanged');
}

export function deleteSelected() {
  if (hasSelection()) {
    removeSelection();
  } else if (state.selectedSegmentIndex >= 0) {
    removeSegment(state.selectedSegmentIndex);
  } else if (state.selectedCutId != null) {
    deleteSelectedCut();
  }
}

export function getSegmentAtTime(time) {
  const kept = getKeptSegments();
  for (let i = 0; i < kept.length; i++) {
    if (time >= kept[i].start && time <= kept[i].end) return i;
  }
  return -1;
}

// --- Auto-remove silent regions ---

export function addSilenceCuts(silentRegions) {
  if (silentRegions.length === 0) return;
  pushUndo();
  for (const region of silentRegions) {
    state.cuts.push({ id: state.nextCutId++, start: region.start, end: region.end });
  }
  mergeCuts();
  state.selectedCutId = null;
  state.selectedSegmentIndex = -1;
  emit('cutsChanged');
}

// --- Snap ---

const SNAP_THRESHOLD_PX = 8;

export function snapTime(time, excludeCutId, timelineWidth) {
  const pxPerSec = timelineWidth / state.videoDuration;
  const thresholdSec = SNAP_THRESHOLD_PX / pxPerSec;

  const targets = [0, state.videoDuration];
  for (const cut of state.cuts) {
    if (cut.id === excludeCutId) continue;
    targets.push(cut.start, cut.end);
  }

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
