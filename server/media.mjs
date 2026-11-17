import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_CACHE_DIR = '/var/cache/radiotv/audio';
const CACHE_DIR_MODE = 0o700;
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
const REMUX_TIMEOUT_MS = 300_000;
const PROBE_TIMEOUT_MS = 30_000;
const EXEC_MAX_BUFFER_BYTES = 1024 * 1024;

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

const pendingJobs = new Map();
let remuxQueue = Promise.resolve();

function getAudioCacheDir() {
  return process.env.RADIOTV_AUDIO_CACHE || DEFAULT_CACHE_DIR;
}

function buildCacheKey(source, stat) {
  const fingerprint = JSON.stringify(['v1', source, stat.size, stat.mtimeMs, stat.ctimeMs]);
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
}

function buildRemuxArgs(source, ext, outputPath) {
  const args = [
    '-nostdin',
    '-v',
    'error',
    '-i',
    source,
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

  args.push('-y', outputPath);
  return args;
}

async function verifySanitizedAudio(filePath) {
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
        throw new Error('Unexpected media metadata');
      }
    }
  }
}

async function remuxToCache(source, ext, key, targetPath, initialStat) {
  const cacheDir = getAudioCacheDir();
  await fs.promises.mkdir(cacheDir, { recursive: true, mode: CACHE_DIR_MODE });
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }

  const tempPath = path.join(cacheDir, `${key}-${crypto.randomUUID()}${ext}`);
  try {
    const remuxArgs = buildRemuxArgs(source, ext, tempPath);
    await execFileAsync(FFMPEG_BIN, remuxArgs, {
      timeout: REMUX_TIMEOUT_MS,
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

    await fs.promises.rename(tempPath, targetPath);
    return targetPath;
  } finally {
    await fs.promises.rm(tempPath, { force: true });
  }
}

/**
 * Original files are read only. Public streams use an atomically published remux
 * stripped of source container metadata and chapters.
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
  const targetPath = path.join(getAudioCacheDir(), `${key}${ext}`);
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }
  if (pendingJobs.has(key)) {
    return pendingJobs.get(key);
  }

  const job = remuxQueue
    .catch(() => {})
    .then(() => remuxToCache(source, ext, key, targetPath, stat));

  remuxQueue = job;
  pendingJobs.set(key, job);
  try {
    return await job;
  } finally {
    pendingJobs.delete(key);
  }
}
