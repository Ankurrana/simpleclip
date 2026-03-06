export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function parseTime(str) {
  const match = str.match(/^(\d{1,2}):(\d{2})\.(\d{3})$/);
  if (!match) return null;
  return parseInt(match[1]) * 60 + parseInt(match[2]) + parseInt(match[3]) / 1000;
}

export function formatTimeFFmpeg(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = (seconds % 60).toFixed(3);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(6, '0')}`;
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function getExtension(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.substring(dot) : '';
}

export function getSourceFormat(filename) {
  const ext = getExtension(filename).toLowerCase().replace('.', '');
  const formatMap = { webm: 'webm', mp4: 'mp4', mov: 'mp4', avi: 'mp4', mkv: 'mp4' };
  return formatMap[ext] || 'mp4';
}

export function getOutputName(filename, format) {
  const dot = filename.lastIndexOf('.');
  const base = dot >= 0 ? filename.substring(0, dot) : filename;
  return base + '_edited.' + format;
}

export function loadScript(src) {
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
