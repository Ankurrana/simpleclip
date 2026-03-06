import { state } from './state.js';

let WebMMuxer = null;
let MP4Muxer = null;

async function loadMuxers() {
  if (!WebMMuxer) WebMMuxer = await import(new URL('../vendor/muxer/webm-muxer.mjs', import.meta.url).href);
  if (!MP4Muxer) MP4Muxer = await import(new URL('../vendor/muxer/mp4-muxer.mjs', import.meta.url).href);
}

export function isWebCodecsSupported() {
  return typeof VideoEncoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined';
}

function seekVideo(video, time) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.01) {
      resolve();
      return;
    }
    video.addEventListener('seeked', resolve, { once: true });
    video.currentTime = time;
  });
}

async function resolveVideoElement() {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = state.videoObjectUrl;

  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = () => reject(new Error('Failed to load video'));
    setTimeout(() => reject(new Error('Video load timed out')), 15000);
  });

  // Resolve duration for WebM files
  if (!isFinite(video.duration)) {
    video.currentTime = 1e10;
    await new Promise(r => video.addEventListener('seeked', r, { once: true }));
    video.currentTime = 0;
    await new Promise(r => video.addEventListener('seeked', r, { once: true }));
  }

  return video;
}

async function getAudioSegments(keptSegments) {
  try {
    const audioCtx = new AudioContext();
    const arrayBuffer = await state.sourceFile.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    audioCtx.close();

    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    const segments = [];

    for (const seg of keptSegments) {
      const startSample = Math.floor(seg.start * sampleRate);
      const endSample = Math.min(Math.floor(seg.end * sampleRate), audioBuffer.length);
      const length = endSample - startSample;
      if (length <= 0) continue;

      const channels = [];
      for (let ch = 0; ch < numChannels; ch++) {
        channels.push(audioBuffer.getChannelData(ch).slice(startSample, endSample));
      }
      segments.push({ channels, length, sampleRate, numChannels });
    }
    return segments;
  } catch (e) {
    console.warn('Audio extraction failed:', e.message);
    return [];
  }
}

export async function exportWithWebCodecs(keptSegments, format, onProgress) {
  await loadMuxers();

  const video = await resolveVideoElement();
  const width = video.videoWidth;
  const height = video.videoHeight;
  const isWebM = format === 'webm';

  // Detect source FPS (default 30)
  let fps = 30;

  // --- Setup muxer ---
  const muxerModule = isWebM ? WebMMuxer : MP4Muxer;
  const muxerConfig = {
    target: new muxerModule.ArrayBufferTarget(),
    video: {
      codec: isWebM ? 'V_VP8' : 'avc',
      width,
      height,
    },
    firstTimestampBehavior: 'offset',
    ...(isWebM ? {} : { fastStart: 'in-memory' }),
  };

  // Check if source has audio
  const audioSegments = await getAudioSegments(keptSegments);
  const hasAudio = audioSegments.length > 0 && audioSegments.some(s => s.length > 0);

  if (hasAudio) {
    muxerConfig.audio = {
      codec: isWebM ? 'A_OPUS' : 'aac',
      sampleRate: 48000,
      numberOfChannels: 2,
    };
  }

  const muxer = new muxerModule.Muxer(muxerConfig);

  // --- Setup video encoder ---
  // Pick AVC level based on resolution
  let avcLevel = '42001E'; // level 3.0 (up to 480p)
  const pixels = width * height;
  if (pixels > 414720) avcLevel = '420028';  // level 4.0 (up to 1080p)
  if (pixels > 2088960) avcLevel = '420033'; // level 5.1 (up to 4K)

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw new Error('VideoEncoder: ' + e.message); },
  });

  videoEncoder.configure({
    codec: isWebM ? 'vp8' : `avc1.${avcLevel}`,
    width,
    height,
    bitrate: pixels > 2088960 ? 8_000_000 : pixels > 414720 ? 4_000_000 : 2_000_000,
    framerate: fps,
  });

  // --- Setup audio encoder (if audio present) ---
  let audioEncoder = null;
  if (hasAudio) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => { throw new Error('AudioEncoder: ' + e.message); },
    });

    audioEncoder.configure({
      codec: isWebM ? 'opus' : 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 128000,
    });
  }

  // --- Encode video frames ---
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const frameDurationUs = Math.round(1_000_000 / fps);

  // Pre-calculate exact frame count per segment using integer math
  const segmentFrameCounts = keptSegments.map(seg =>
    Math.floor((seg.end - seg.start) * fps)
  );
  const totalFrames = segmentFrameCounts.reduce((a, b) => a + b, 0);

  let encodedFrames = 0;
  let outputTimestampUs = 0;
  const encodeStartTime = performance.now();

  for (let si = 0; si < keptSegments.length; si++) {
    const seg = keptSegments[si];
    const numFrames = segmentFrameCounts[si];

    for (let f = 0; f < numFrames; f++) {
      const targetTime = seg.start + (f / fps);

      await seekVideo(video, targetTime);
      ctx.drawImage(video, 0, 0, width, height);

      const frame = new VideoFrame(canvas, {
        timestamp: outputTimestampUs,
        duration: frameDurationUs,
      });

      videoEncoder.encode(frame, { keyFrame: encodedFrames % (fps * 2) === 0 });
      frame.close();

      outputTimestampUs += frameDurationUs;
      encodedFrames++;

      if (encodedFrames % 30 === 0) {
        await videoEncoder.flush();
      }

      if (onProgress && encodedFrames % 3 === 0) {
        const progress = encodedFrames / totalFrames;
        const elapsed = (performance.now() - encodeStartTime) / 1000;
        const eta = progress > 0.01 ? (elapsed / progress) * (1 - progress) : -1;
        onProgress(progress, eta);
      }
    }
  }

  console.log(`[WebCodecs] ${encodedFrames} frames, expected duration: ${(encodedFrames / fps).toFixed(2)}s`);

  // --- Encode audio (capped to video duration) ---
  const maxAudioUs = outputTimestampUs; // don't let audio exceed video duration
  if (audioEncoder && hasAudio) {
    const targetSR = 48000;
    let audioTimestampUs = 0;

    for (const seg of audioSegments) {
      const outLength = Math.round(seg.length * targetSR / seg.sampleRate);
      const numCh = Math.min(seg.numChannels, 2);

      const planar = new Float32Array(outLength * 2);
      for (let i = 0; i < outLength; i++) {
        const srcIdx = Math.min(Math.floor(i * seg.sampleRate / targetSR), seg.length - 1);
        planar[i] = seg.channels[0][srcIdx] || 0;
        planar[outLength + i] = numCh > 1 ? (seg.channels[1][srcIdx] || 0) : planar[i];
      }

      const chunkSize = 960;
      for (let offset = 0; offset + chunkSize <= outLength; offset += chunkSize) {
        // Stop audio if it would exceed video duration
        if (audioTimestampUs >= maxAudioUs) break;

        const chunkData = new Float32Array(chunkSize * 2);
        chunkData.set(planar.subarray(offset, offset + chunkSize));
        chunkData.set(planar.subarray(outLength + offset, outLength + offset + chunkSize), chunkSize);

        const audioFrame = new AudioData({
          format: 'f32-planar',
          sampleRate: targetSR,
          numberOfFrames: chunkSize,
          numberOfChannels: 2,
          timestamp: audioTimestampUs,
          data: chunkData,
        });

        audioEncoder.encode(audioFrame);
        audioFrame.close();
        audioTimestampUs += Math.round(chunkSize / targetSR * 1_000_000);
      }
    }

    await audioEncoder.flush();
    audioEncoder.close();
  }

  // --- Finalize ---
  await videoEncoder.flush();
  videoEncoder.close();
  muxer.finalize();

  video.src = '';
  video.remove();

  if (onProgress) onProgress(1);

  const { buffer } = muxer.target;
  return new Blob([buffer], { type: isWebM ? 'video/webm' : 'video/mp4' });
}
