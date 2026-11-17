import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const cacheDir = process.env.RADIOTV_AUDIO_CACHE || '/var/cache/radiotv/audio';
const pending = new Map();
let queue = Promise.resolve();

// Original files are read only. Public streams use an atomically published remux.
export async function sanitizedAudioPath(source) {
  const stat = await fs.promises.stat(source);
  if (!stat.isFile()) throw new Error('Audio source unavailable');
  const ext = path.extname(source).toLowerCase();
  if (!['.m4a', '.mp3', '.flac', '.wav', '.aiff', '.ogg'].includes(ext)) throw new Error('Unsupported audio container');
  const key = crypto.createHash('sha256').update(JSON.stringify(['v1', source, stat.size, stat.mtimeMs, stat.ctimeMs])).digest('hex');
  const target = path.join(cacheDir, key + ext);
  if (fs.existsSync(target)) return target;
  if (pending.has(key)) return pending.get(key);
  const job = queue.catch(() => {}).then(async () => {
    await fs.promises.mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const temp = path.join(cacheDir, key + '-' + crypto.randomUUID() + ext);
    try {
      const args = ['-nostdin', '-v', 'error', '-i', source, '-map', '0:a:0',
        '-map_metadata', '-1', '-map_metadata:s:a', '-1', '-map_chapters', '-1',
        '-c:a', 'copy', '-fflags', '+bitexact', '-flags:a', '+bitexact'];
      if (ext === '.mp3') args.push('-id3v2_version', '0', '-write_id3v1', '0');
      if (ext === '.m4a') args.push('-movflags', '+faststart');
      await exec('ffmpeg', [...args, '-y', temp], { timeout: 300000, maxBuffer: 1024 * 1024 });
      const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', temp]);
      const info = JSON.parse(stdout);
      if (info.chapters?.length || info.streams?.length !== 1 || info.streams[0].codec_type !== 'audio') throw new Error('Unexpected media streams');
      const allowedTags = new Set(['major_brand', 'minor_version', 'compatible_brands', 'encoder', 'language', 'handler_name', 'vendor_id']);
      for (const tags of [info.format?.tags, ...info.streams.map((stream) => stream.tags)]) {
        for (const name of Object.keys(tags || {})) {
          if (!allowedTags.has(name.toLowerCase())) throw new Error('Unexpected media metadata');
        }
      }
      const after = await fs.promises.stat(source);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('Audio source changed during preparation');
      await fs.promises.rename(temp, target);
      return target;
    } finally { await fs.promises.rm(temp, { force: true }); }
  });
  queue = job;
  pending.set(key, job);
  try { return await job; } finally { pending.delete(key); }
}
