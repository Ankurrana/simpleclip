import { state, emit } from './state.js';
import { formatTime, clamp } from './utils.js';

const video = document.getElementById('video-player');
const playPauseBtn = document.getElementById('play-pause-btn');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const muteBtn = document.getElementById('mute-btn');
const volumeSlider = document.getElementById('volume-slider');
const volumeWaves = document.getElementById('volume-waves');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const playhead = document.getElementById('playhead');

export function getVideo() {
  return video;
}

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

export function initVideo() {
  playPauseBtn.addEventListener('click', () => {
    if (video.paused) video.play();
    else video.pause();
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

  video.addEventListener('loadedmetadata', async () => {
    state.videoDuration = await resolveVideoDuration();
    totalTimeEl.textContent = formatTime(state.videoDuration);
    emit('videoLoaded');
  });

  video.addEventListener('timeupdate', () => {
    const t = video.currentTime;
    currentTimeEl.textContent = formatTime(t);

    if (state.videoDuration > 0) {
      playhead.style.left = (t / state.videoDuration) * 100 + '%';
    }

    // Always skip over cut regions during playback
    if (!video.paused && state.cuts.length > 0) {
      for (const cut of state.cuts) {
        if (t >= cut.start && t < cut.end - 0.05) {
          video.currentTime = cut.end;
          return;
        }
      }
    }
  });
}

export function loadVideoFile(file) {
  state.sourceFile = file;
  state.sourceFileName = file.name;

  if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
  state.videoObjectUrl = URL.createObjectURL(file);
  video.src = state.videoObjectUrl;
  video.load();
}

export function unloadVideo() {
  video.pause();
  video.removeAttribute('src');
  video.load();
  if (state.videoObjectUrl) {
    URL.revokeObjectURL(state.videoObjectUrl);
    state.videoObjectUrl = null;
  }
}

export function seekTo(time) {
  video.currentTime = clamp(time, 0, state.videoDuration);
}

export function seekRelative(delta) {
  video.currentTime = clamp(video.currentTime + delta, 0, state.videoDuration);
}

export function togglePlayPause() {
  if (video.paused) video.play();
  else video.pause();
}

export function startPreview(keptSegments) {
  if (keptSegments.length === 0) return;
  // Seek to start of first kept segment and play — cuts auto-skip during playback
  video.currentTime = keptSegments[0].start;
  video.play();
}
