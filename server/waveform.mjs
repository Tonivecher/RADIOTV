import fs from 'node:fs';
import { spawn } from 'node:child_process';

const FFMPEG_BINS = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'];

function resolveFfmpegBin() {
  for (const candidate of FFMPEG_BINS) {
    if (candidate === 'ffmpeg' || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'ffmpeg';
}

const FFMPEG_BIN = resolveFfmpegBin();

/**
 * Normalizes raw energy values into [0.08 .. 1.0] with subtle 3-point smoothing
 * and crisp dynamic contrast for SoundCloud/live-radio style rendering.
 */
export function normalizePeaks(rawValues, points = 240) {
  const n = rawValues.length;
  if (n === 0) return [];

  // Light smoothing combined with sharp transient preservation
  const blended = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const prev = rawValues[Math.max(0, i - 1)];
    const curr = rawValues[i];
    const next = rawValues[Math.min(n - 1, i + 1)];
    const smooth = prev * 0.2 + curr * 0.6 + next * 0.2;
    blended[i] = curr * 0.7 + smooth * 0.3;
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    if (blended[i] < min) min = blended[i];
    if (blended[i] > max) max = blended[i];
  }

  if (max === 0) return new Array(points).fill(0);
  const span = max - min || 1;
  const result = new Array(points);
  for (let i = 0; i < points; i++) {
    const idx = Math.min(n - 1, Math.floor((i / points) * n));
    const unit = Math.max(0, Math.min(1, (blended[idx] - min) / span));
    // Slight gamma curve (0.85) so mid-grooves and peaks look full and expressive
    const curved = Math.pow(unit, 0.85);
    const val = 0.08 + curved * 0.92;
    result[i] = Number(val.toFixed(3));
  }

  return result;
}

/**
 * Stage 2: Background ffmpeg PCM waveform refinement queue (-ac 1 -ar 100 -f s16le)
 */
const ffmpegQueue = [];
const inFlightSetIds = new Set();
let isWorkerBusy = false;

export function scheduleFfmpegWaveform(setId, filepath, onComplete, points = 240) {
  if (inFlightSetIds.has(setId)) return;
  inFlightSetIds.add(setId);
  ffmpegQueue.push({ setId, filepath, onComplete, points });
  processNextFfmpegJob();
}

function processNextFfmpegJob() {
  if (isWorkerBusy || ffmpegQueue.length === 0) return;
  isWorkerBusy = true;

  const job = ffmpegQueue.shift();
  extractFfmpegPeaks(job.filepath, job.points)
    .then((peaks) => {
      if (peaks && peaks.length === job.points) {
        job.onComplete(peaks);
      }
    })
    .catch(() => {
      // Failed decode leaves the cache unrefined and eligible for a later retry.
    })
    .finally(() => {
      inFlightSetIds.delete(job.setId);
      isWorkerBusy = false;
      if (ffmpegQueue.length > 0) {
        setTimeout(processNextFfmpegJob, 150);
      }
    });
}

export function extractFfmpegPeaks(filepath, points = 240) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    const maxBytes = 6 * 3600 * 100 * 2; // Cap at 6 hours of 100Hz s16le (~4.3MB)

    const proc = spawn(
      FFMPEG_BIN,
      [
        '-nostdin',
        '-v',
        'error',
        '-i',
        filepath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '100',
        '-f',
        's16le',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );

    let failed = false;
    const timer = setTimeout(() => {
      failed = true;
      proc.kill('SIGKILL');
      reject(new Error('ffmpeg waveform timeout'));
    }, 180000); // Long DJ sets need more than 25 seconds on the production CPU.

    proc.stdout.on('data', (chunk) => {
      if (totalBytes + chunk.length <= maxBytes) {
        chunks.push(chunk);
        totalBytes += chunk.length;
      } else {
        failed = true;
        proc.kill('SIGKILL');
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (failed || code !== 0 || totalBytes < points * 4) {
        return reject(new Error(`ffmpeg exited with ${code}`));
      }

      const pcm = Buffer.concat(chunks, totalBytes);
      const totalSamples = Math.floor(pcm.length / 2);
      const samplesPerBucket = Math.max(1, Math.floor(totalSamples / points));
      const raw = new Float64Array(points);

      for (let b = 0; b < points; b++) {
        const startSample = b * samplesPerBucket;
        const endSample =
          b === points - 1
            ? totalSamples
            : Math.min(totalSamples, startSample + samplesPerBucket);
        let sumSq = 0;
        let peak = 0;
        const count = Math.max(1, endSample - startSample);

        for (let s = startSample; s < endSample; s++) {
          const val = Math.abs(pcm.readInt16LE(s * 2)) / 32768.0;
          sumSq += val * val;
          if (val > peak) peak = val;
        }

        const rms = Math.sqrt(sumSq / count);
        raw[b] = rms * 0.65 + peak * 0.35;
      }

      resolve(normalizePeaks(raw, points));
    });
  });
}

/**
 * Computes a 60-segment reaction density heatmap (0.0 .. 1.0) across the set duration.
 */
export function computeHeatmap(moments, durationSec, segments = 60, peaks = null) {
  if (!(durationSec > 0)) return new Array(segments).fill(0);
  const safeDuration = Number(durationSec);
  const buckets = new Float64Array(segments);

  if (Array.isArray(moments)) {
    for (const m of moments) {
      const ts = Number(m.timestampSec ?? m.timestamp_sec ?? 0);
      const likes = Number(m.likesCount ?? m.likes_count ?? 0);
      const ratio = Math.max(0, Math.min(0.9999, ts / safeDuration));
      const idx = Math.floor(ratio * segments);
      const weight = 1.0 + Math.min(5, likes * 0.35);

      buckets[idx] += weight;
      if (idx > 0) buckets[idx - 1] += weight * 0.45;
      if (idx < segments - 1) buckets[idx + 1] += weight * 0.45;
      if (idx > 1) buckets[idx - 2] += weight * 0.15;
      if (idx < segments - 2) buckets[idx + 2] += weight * 0.15;
    }
  }

  let maxVal = 0;
  for (let i = 0; i < segments; i++) {
    if (buckets[i] > maxVal) maxVal = buckets[i];
  }

  const normalized = new Array(segments);
  const scale = maxVal > 0 ? maxVal : 1;
  for (let i = 0; i < segments; i++) {
    const val = Math.max(0, Math.min(1.0, buckets[i] / scale));
    normalized[i] = Number(val.toFixed(3));
  }

  return normalized;
}
