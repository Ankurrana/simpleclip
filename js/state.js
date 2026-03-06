// Centralized reactive state with event emitter.
// Modules subscribe to state changes instead of reaching into each other.

const listeners = new Map();

export const state = {
  sourceFile: null,
  sourceFileName: '',
  videoDuration: 0,
  videoObjectUrl: null,
  cuts: [],
  selectedCutId: null,
  selectedSegmentIndex: -1,
  selectionStart: -1,
  selectionEnd: -1,
  nextCutId: 1,
  zoomLevel: 1,
  draggingCutId: null,
};

export function resetState() {
  state.sourceFile = null;
  state.sourceFileName = '';
  state.videoDuration = 0;
  state.videoObjectUrl = null;
  state.cuts = [];
  state.selectedCutId = null;
  state.selectedSegmentIndex = -1;
  state.selectionStart = -1;
  state.selectionEnd = -1;
  state.nextCutId = 1;
  state.zoomLevel = 1;
  state.draggingCutId = null;
}

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(fn);
}

export function emit(event, data) {
  const fns = listeners.get(event);
  if (fns) fns.forEach(fn => fn(data));
}
