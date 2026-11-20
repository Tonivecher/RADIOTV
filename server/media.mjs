import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_CACHE_DIR = '/var/cache/radiotv/audio';
const CACHE_DIR_MODE = 0o750;
const CACHE_FILE_MODE = 0o640;
const MEDIA_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];
const SUPPORTED_EXTENSIONS = new Set(['.m4a', '.mp3', '.flac', '.wav', '.aiff', '.ogg']);
const ALLOWED_CONTAINER_TAGS = new Set([
  'major_brand',
  'minor_version',
  'compatible_brands',
  'encoder',
  'language',
  'handler_name',
  'vendor_id',
]);
const CACHE_PROFILE_VERSION = 'v2-aac160-loudnorm';
const TARGET_BITRATE = process.env.RADIOTV_AUDIO_BITRATE || '160k';
const TARGET_SAMPLE_RATE = '44100';
const TARGET_CHANNELS = '2';
const LOUDNORM_FILTER = 'loudnorm=I=-14:TP=-1.5:LRA=11';
const ENCODE_TIMEOUT_MS = 1_800_000; // up to 30 min for very long sets under nice/ionice
const PROBE_TIMEOUT_MS = 30_000;
const EXEC_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

function resolveMediaBinary(binaryName) {
  for (const dir of MEDIA_BIN_DIRS) {
    const candidate = path.join(dir, binaryName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return binaryName;
}

export const FFMPEG_BIN = resolveMediaBinary('ffmpeg');
export const FFPROBE_BIN = resolveMediaBinary('ffprobe');

const HAS_NICE = process.platform === 'linux' && fs.existsSync('/usr/bin/nice');
const HAS_IONICE = process.platform === 'linux' && fs.existsSync('/usr/bin/ionice');

const pendingJobs = new Map();
const pendingFastJobs = new Map();
let encodeQueue = Promise.resolve();
let prebakeStopped = false;
let prebakeRunning = false;

export function getAudioCacheDir() {
  return process.env.RADIOTV_AUDIO_CACHE || DEFAULT_CACHE_DIR;
}

function getFfmpegThreads() {
  const raw = Number(process.env.RADIOTV_FFMPEG_THREADS);
  if (Number.isInteger(raw) && raw >= 1 && raw <= 4) {
    return String(raw);
  }
  return '1';
}

function getPrebakeDelayMs() {
  const raw = Number(process.env.RADIOTV_PREBAKE_DELAY_MS);
  if (Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  return process.env.NODE_ENV === 'production' ? 1500 : 0;
}

export function buildCacheKey(source, stat) {
  const fingerprint = JSON.stringify([
    CACHE_PROFILE_VERSION,
    TARGET_BITRATE,
    source,
    stat.size,
    stat.mtimeMs,
    stat.ctimeMs,
  ]);
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
}

function buildEncodeArgs(source, outputPath) {
  return [
    '-nostdin',
    '-v',
    'error',
    '-threads',
    getFfmpegThreads(),
    '-i',
    source,
    '-vn',
    '-sn',
    '-dn',
    '-map',
    '0:a:0',
    '-map_metadata',
    '-1',
    '-map_metadata:s:a',
    '-1',
    '-map_chapters',
    '-1',
    '-af',
    LOUDNORM_FILTER,
    '-c:a',
    'aac',
    '-profile:a',
    'aac_low',
    '-b:a',
    TARGET_BITRATE,
    '-ar',
    TARGET_SAMPLE_RATE,
    '-ac',
    TARGET_CHANNELS,
    '-movflags',
    '+faststart',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-y',
    outputPath,
  ];
}

function wrapLowPriorityCommand(bin, args) {
  if (HAS_NICE && HAS_IONICE) {
    return { bin: '/usr/bin/nice', args: ['-n', '19', '/usr/bin/ionice', '-c', '3', bin, ...args] };
  }
  if (HAS_NICE) {
    return { bin: '/usr/bin/nice', args: ['-n', '19', bin, ...args] };
  }
  return { bin, args };
}

/**
 * Verifies MP4 box layout so `moov` appears before `mdat` (+faststart).
 */
export async function hasFaststartMoovBeforeMdat(filePath) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const stat = await fh.stat();
    let offset = 0;
    const header = Buffer.alloc(16);
    let moovOffset = -1;
    let mdatOffset = -1;

    while (offset + 8 <= stat.size) {
      const { bytesRead } = await fh.read(header, 0, 16, offset);
      if (bytesRead < 8) break;

      let size = header.readUInt32BE(0);
      const type = header.subarray(4, 8).toString('ascii');
      if (size === 1) {
        if (bytesRead < 16) break;
        const bigSize = header.readBigUInt64BE(8);
        size = Number(bigSize);
      } else if (size === 0) {
        size = stat.size - offset;
      }

      if (type === 'moov' && moovOffset === -1) moovOffset = offset;
      if (type === 'mdat' && mdatOffset === -1) mdatOffset = offset;
      if (moovOffset !== -1 && mdatOffset !== -1) break;

      if (!Number.isFinite(size) || size < 8) break;
      offset += size;
    }

    return moovOffset !== -1 && (mdatOffset === -1 || moovOffset < mdatOffset);
  } finally {
    await fh.close();
  }
}

export async function verifySanitizedAudio(filePath) {
  const { stdout } = await execFileAsync(
    FFPROBE_BIN,
    ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', filePath],
    { timeout: PROBE_TIMEOUT_MS, maxBuffer: EXEC_MAX_BUFFER_BYTES }
  );

  const info = JSON.parse(stdout);
  if (
    info.chapters?.length ||
    info.streams?.length !== 1 ||
    info.streams[0].codec_type !== 'audio'
  ) {
    throw new Error('Unexpected media streams');
  }

  const audioStream = info.streams[0];
  if (audioStream.codec_name !== 'aac') {
    throw new Error(`Unexpected audio codec: ${audioStream.codec_name}`);
  }
  const profile = String(audioStream.profile || '').toUpperCase();
  if (profile && !profile.includes('LC')) {
    throw new Error(`Unexpected AAC profile: ${audioStream.profile}`);
  }

  const tagContainers = [info.format?.tags, ...info.streams.map((stream) => stream.tags)];
  for (const tags of tagContainers) {
    for (const tagName of Object.keys(tags || {})) {
      if (!ALLOWED_CONTAINER_TAGS.has(tagName.toLowerCase())) {
        throw new Error(`Unexpected media metadata: ${tagName}`);
      }
    }
  }

  const faststartOk = await hasFaststartMoovBeforeMdat(filePath);
  if (!faststartOk) {
    throw new Error('Missing +faststart (moov must precede mdat)');
  }

  return info;
}

async function encodeToCache(source, key, targetPath, initialStat) {
  const cacheDir = getAudioCacheDir();
  await fs.promises.mkdir(cacheDir, { recursive: true, mode: CACHE_DIR_MODE });
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }

  const tempPath = path.join(cacheDir, `.tmp-${key}-${crypto.randomUUID()}.m4a`);
  try {
    const encodeArgs = buildEncodeArgs(source, tempPath);
    const cmd = wrapLowPriorityCommand(FFMPEG_BIN, encodeArgs);
    await execFileAsync(cmd.bin, cmd.args, {
      timeout: ENCODE_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER_BYTES,
    });

    await verifySanitizedAudio(tempPath);

    const currentStat = await fs.promises.stat(source);
    if (
      currentStat.size !== initialStat.size ||
      currentStat.mtimeMs !== initialStat.mtimeMs ||
      currentStat.ctimeMs !== initialStat.ctimeMs
    ) {
      throw new Error('Audio source changed during preparation');
    }

    await fs.promises.chmod(tempPath, CACHE_FILE_MODE).catch(() => {});
    await fs.promises.rename(tempPath, targetPath);
    return targetPath;
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
  }
}

/**
 * Synchronously checks whether a source file already has a baked v2 `.m4a` in cache.
 */
export function getCachedAudioInfo(source) {
  if (!source) return null;
  let stat;
  try {
    stat = fs.statSync(source);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const ext = path.extname(source).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) return null;

  const key = buildCacheKey(source, stat);
  const filename = `${key}.m4a`;
  const targetPath = path.join(getAudioCacheDir(), filename);
  return {
    key,
    filename,
    targetPath,
    ready: fs.existsSync(targetPath),
  };
}

/**
 * Original files are read-only. Public streams use an atomically published AAC-LC .m4a
 * with +faststart, loudnorm, and zero source metadata/chapters.
 */
export async function sanitizedAudioPath(source) {
  const stat = await fs.promises.stat(source);
  if (!stat.isFile()) {
    throw new Error('Audio source unavailable');
  }

  const ext = path.extname(source).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error('Unsupported audio container');
  }

  const key = buildCacheKey(source, stat);
  const targetPath = path.join(getAudioCacheDir(), `${key}.m4a`);
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }
  if (pendingJobs.has(key)) {
    return pendingJobs.get(key);
  }

  const job = encodeQueue
    .catch(() => {})
    .then(() => encodeToCache(source, key, targetPath, stat));

  encodeQueue = job;
  pendingJobs.set(key, job);
  try {
    return await job;
  } finally {
    pendingJobs.delete(key);
  }
}

async function verifyFastRemuxedAudio(filePath) {
  const { stdout } = await execFileAsync(
    FFPROBE_BIN,
    ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', filePath],
    { timeout: PROBE_TIMEOUT_MS, maxBuffer: EXEC_MAX_BUFFER_BYTES }
  );

  const info = JSON.parse(stdout);
  if (
    info.chapters?.length ||
    info.streams?.length !== 1 ||
    info.streams[0].codec_type !== 'audio'
  ) {
    throw new Error('Unexpected media streams');
  }

  const tagContainers = [info.format?.tags, ...info.streams.map((stream) => stream.tags)];
  for (const tags of tagContainers) {
    for (const tagName of Object.keys(tags || {})) {
      if (!ALLOWED_CONTAINER_TAGS.has(tagName.toLowerCase())) {
        throw new Error(`Unexpected media metadata: ${tagName}`);
      }
    }
  }
}

/**
 * Fast (~1-2s) metadata-stripped copy fallback used ONLY when a listener hits a set
 * whose full AAC-LC + loudnorm v2 pre-bake hasn't completed yet. Never blocks on encodeQueue.
 */
export async function fastFallbackAudioPath(source) {
  const stat = await fs.promises.stat(source);
  if (!stat.isFile()) {
    throw new Error('Audio source unavailable');
  }

  const ext = path.extname(source).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error('Unsupported audio container');
  }

  const key = buildCacheKey(source, stat);
  const v2Path = path.join(getAudioCacheDir(), `${key}.m4a`);
  if (fs.existsSync(v2Path)) {
    return { path: v2Path, ext: '.m4a', isV2: true };
  }

  const cacheDir = getAudioCacheDir();
  const fastPath = path.join(cacheDir, `.fast-${key}${ext}`);
  if (fs.existsSync(fastPath)) {
    return { path: fastPath, ext, isV2: false };
  }

  if (pendingFastJobs.has(key)) {
    return pendingFastJobs.get(key);
  }

  const job = (async () => {
    await fs.promises.mkdir(cacheDir, { recursive: true, mode: CACHE_DIR_MODE });
    if (fs.existsSync(fastPath)) {
      return { path: fastPath, ext, isV2: false };
    }
    const tempPath = path.join(cacheDir, `.tmp-fast-${key}-${crypto.randomUUID()}${ext}`);
    try {
      const args = [
        '-nostdin',
        '-v',
        'error',
        '-i',
        source,
        '-vn',
        '-sn',
        '-dn',
        '-map',
        '0:a:0',
        '-map_metadata',
        '-1',
        '-map_metadata:s:a',
        '-1',
        '-map_chapters',
        '-1',
        '-c:a',
        'copy',
        '-fflags',
        '+bitexact',
        '-flags:a',
        '+bitexact',
      ];
      if (ext === '.mp3') {
        args.push('-id3v2_version', '0', '-write_id3v1', '0');
      } else if (ext === '.m4a') {
        args.push('-movflags', '+faststart');
      }
      args.push('-y', tempPath);

      await execFileAsync(FFMPEG_BIN, args, {
        timeout: 120_000,
        maxBuffer: EXEC_MAX_BUFFER_BYTES,
      });
      await verifyFastRemuxedAudio(tempPath);
      await fs.promises.chmod(tempPath, CACHE_FILE_MODE).catch(() => {});
      await fs.promises.rename(tempPath, fastPath);
      return { path: fastPath, ext, isV2: false };
    } finally {
      await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    }
  })();

  pendingFastJobs.set(key, job);
  try {
    return await job;
  } finally {
    pendingFastJobs.delete(key);
  }
}

/**
 * Sequentially pre-bakes all sets in the background (1 file at a time, low CPU/IO priority).
 * Re-evaluates schedule priority before every single file so on-air & upcoming slots always go first.
 */
export function startBackgroundPrebake(getPrioritizedSources, onBaked = null) {
  if (prebakeRunning || process.env.RADIOTV_DISABLE_PREBAKE === '1') {
    return;
  }
  prebakeStopped = false;
  prebakeRunning = true;

  const run = async () => {
    const failedRecently = new Map();
    const RETRY_COOLDOWN_MS = 10 * 60_000;
    try {
      const delayMs = getPrebakeDelayMs();
      while (!prebakeStopped) {
        const now = Date.now();
        const sources = getPrioritizedSources();
        const nextItem = sources.find((item) => {
          const failedAt = failedRecently.get(item.id);
          if (failedAt && now - failedAt < RETRY_COOLDOWN_MS) return false;
          const info = getCachedAudioInfo(item.filepath);
          return Boolean(info && !info.ready);
        });

        if (!nextItem) {
          break;
        }

        try {
          const outPath = await sanitizedAudioPath(nextItem.filepath);
          failedRecently.delete(nextItem.id);
          // Clean up any temporary .fast- fallback for this key once v2 is ready.
          const baseKey = path.basename(outPath, '.m4a');
          const origExt = path.extname(nextItem.filepath).toLowerCase();
          await fs.promises
            .rm(path.join(getAudioCacheDir(), `.fast-${baseKey}${origExt}`), { force: true })
            .catch(() => {});
          if (typeof onBaked === 'function') {
            onBaked(nextItem, outPath);
          }
        } catch (err) {
          failedRecently.set(nextItem.id, Date.now());
          console.error(
            `[RADIOTV] Pre-bake failed for ${nextItem.id || 'set'}:`,
            err?.message || err
          );
        }

        if (delayMs > 0 && !prebakeStopped) {
          await new Promise((resolve) => {
            const t = setTimeout(resolve, delayMs);
            t.unref?.();
          });
        }
      }
    } finally {
      prebakeRunning = false;
    }
  };

  setImmediate(() => {
    void run();
  });
}

export function stopBackgroundPrebake() {
  prebakeStopped = true;
}
