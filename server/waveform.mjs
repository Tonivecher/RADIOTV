import { spawn } from 'node:child_process';
import { FFMPEG_BIN } from './media.mjs';

const DEFAULT_WAVEFORM_POINTS = 240;
const DEFAULT_HEATMAP_SEGMENTS = 60;
const PCM_SAMPLE_RATE_HZ = 100;
const MAX_DURATION_HOURS = 6;
const BYTES_PER_SAMPLE = 2;
const MAX_PCM_BYTES =
  MAX_DURATION_HOURS * 3600 * PCM_SAMPLE_RATE_HZ * BYTES_PER_SAMPLE;
const MIN_BYTES_PER_POINT = 4;
const FFMPEG_TIMEOUT_MS = 180_000;
const QUEUE_STEP_DELAY_MS = 150;
const INT16_MAX_AMPLITUDE = 32768.0;
const PEAK_FLOOR = 0.08;
const PEAK_GAMMA = 0.85;

/**
 * Normalizes raw energy values into [0.08 .. 1.0] with subtle 3-point smoothing
 * and crisp dynamic contrast for live-radio waveform rendering.
 */
function normalizePeaks(rawValues, points = DEFAULT_WAVEFORM_POINTS) {
  const n = rawValues.length;
  if (n === 0) return [];

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
    const curved = Math.pow(unit, PEAK_GAMMA);
    const val = PEAK_FLOOR + curved * (1 - PEAK_FLOOR);
    result[i] = Number(val.toFixed(3));
  }

  return result;
}

function decodePcmToRawPeaks(pcm, points) {
  const totalSamples = Math.floor(pcm.length / BYTES_PER_SAMPLE);
  const samplesPerBucket = Math.max(1, Math.floor(totalSamples / points));
  const raw = new Float64Array(points);

  for (let b = 0; b < points; b++) {
    const startSample = b * samplesPerBucket;
    const endSample =
      b === points - 1
        ? totalSamples
        : Math.min(totalSamples, startSample + samplesPerBucket);
    const count = Math.max(1, endSample - startSample);
    let sumSq = 0;
    let peak = 0;

    for (let s = startSample; s < endSample; s++) {
      const val =
        Math.abs(pcm.readInt16LE(s * BYTES_PER_SAMPLE)) / INT16_MAX_AMPLITUDE;
      sumSq += val * val;
      if (val > peak) peak = val;
    }

    const rms = Math.sqrt(sumSq / count);
    raw[b] = rms * 0.65 + peak * 0.35;
  }

  return raw;
}

function extractFfmpegPeaks(filepath, points = DEFAULT_WAVEFORM_POINTS) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let failed = false;
    let settled = false;

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
        String(PCM_SAMPLE_RATE_HZ),
        '-f',
        's16le',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    const timer = setTimeout(() => {
      failed = true;
      proc.kill('SIGKILL');
      fail(new Error('ffmpeg waveform timeout'));
    }, FFMPEG_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => {
      if (totalBytes + chunk.length <= MAX_PCM_BYTES) {
        chunks.push(chunk);
        totalBytes += chunk.length;
      } else {
        failed = true;
        proc.kill('SIGKILL');
      }
    });

    proc.on('error', fail);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (failed || code !== 0 || totalBytes < points * MIN_BYTES_PER_POINT) {
        return fail(new Error(`ffmpeg exited with ${code}`));
      }

      settled = true;
      const pcm = Buffer.concat(chunks, totalBytes);
      const raw = decodePcmToRawPeaks(pcm, points);
      resolve(normalizePeaks(raw, points));
    });
  });
}

/**
 * Background ffmpeg PCM waveform refinement queue (-ac 1 -ar 100 -f s16le).
 */
const ffmpegQueue = [];
const inFlightSetIds = new Set();
let isWorkerBusy = false;

export function scheduleFfmpegWaveform(
  setId,
  filepath,
  onComplete,
  points = DEFAULT_WAVEFORM_POINTS
) {
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
        setTimeout(processNextFfmpegJob, QUEUE_STEP_DELAY_MS);
      }
    });
}

/**
 * Computes a reaction density heatmap (0.0 .. 1.0) across the set duration.
 */
export function computeHeatmap(
  moments,
  durationSec,
  segments = DEFAULT_HEATMAP_SEGMENTS
) {
  if (!(segments > 0)) return [];
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
