import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  scheduleFfmpegWaveform,
  computeHeatmap,
} from './waveform.mjs';
import { hashPin } from './security.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.RADIOTV_DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'radiotv.sqlite');
const socialFilter = "user_id NOT GLOB 'u-seed-*'";
export const SETS_DIRS = process.env.RADIOTV_SETS_DIRS
  ? process.env.RADIOTV_SETS_DIRS.split(path.delimiter).filter(Boolean)
  : [path.join(DATA_DIR, 'sets')];

const MIN_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const AUDIO_EXT_MIME = {
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.aiff': 'audio/aiff',
  '.ogg': 'audio/ogg',
};

const FFPROBE_BINS = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', 'ffprobe'];
function resolveFfprobeBin() {
  for (const candidate of FFPROBE_BINS) {
    if (candidate === 'ffprobe' || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'ffprobe';
}
const FFPROBE_BIN = resolveFfprobeBin();

export const CHANNELS = {
  'ch-main': {
    id: 'ch-main',
    name: 'Основной',
    title: 'Основной эфир',
    subtitle: 'Deep-tech и tech',
    frequency: '',
    mhz: '',
    accent: '#E85D2A',
    epochOffsetSec: 0,
  },
  'ch-deep': {
    id: 'ch-deep',
    name: 'Deep',
    title: 'Deep',
    subtitle: 'Deep и мягкий бас',
    frequency: '',
    mhz: '',
    accent: '#38BDF8',
    epochOffsetSec: 19420,
  },
  'ch-afterglow': {
    id: 'ch-afterglow',
    name: 'Downtempo',
    title: 'Downtempo',
    subtitle: 'Downtempo',
    frequency: '',
    mhz: '',
    accent: '#A78BFA',
    epochOffsetSec: 41890,
  },
};

export const CHANNEL_IDS = Object.keys(CHANNELS);

// Fixed broadcast anchor: Jan 1, 2026 00:00:00 UTC
const BROADCAST_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS sets (
    id TEXT PRIMARY KEY,
    seq_num INTEGER NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    short_code TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    frequency TEXT NOT NULL,
    sonic_tag TEXT NOT NULL,
    filepath TEXT NOT NULL,
    original_name TEXT NOT NULL,
    dedup_key TEXT NOT NULL UNIQUE,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    ext TEXT NOT NULL,
    duration_sec INTEGER NOT NULL,
    waveform_json TEXT,
    waveform_refined INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    callsign TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pin_hash TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    is_guest INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS waveform_moments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    callsign TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    timestamp_sec INTEGER NOT NULL,
    reaction_type TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    likes_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_moments_set_id ON waveform_moments(set_id, timestamp_sec);

  CREATE TABLE IF NOT EXISTS moment_likes (
    moment_id INTEGER NOT NULL,
    user_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (moment_id, user_key)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL DEFAULT 'ch-main',
    user_id TEXT NOT NULL,
    callsign TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    text TEXT NOT NULL,
    set_id TEXT NOT NULL,
    set_code TEXT NOT NULL,
    set_timestamp_sec INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);

  CREATE TABLE IF NOT EXISTS chat_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    reaction_type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(message_id, user_id, reaction_type)
  );

  CREATE INDEX IF NOT EXISTS idx_chat_reactions_msg ON chat_reactions(message_id);
`);

/**
 * Normalizes a filename for deduplication by stripping track index prefixes (e.g. "01. ", "31. ")
 */
function buildDedupKey(filename, fileSize) {
  const ext = path.extname(filename).toLowerCase();
  const base = path
    .basename(filename, ext)
    .replace(/^\d+[\s._-]+/, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return `${fileSize}:${base}`;
}

/**
 * Probes exact audio duration in seconds via ffprobe.
 */
function probeDurationAsync(filepath) {
  return new Promise((resolve) => {
    execFile(
      FFPROBE_BIN,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filepath,
      ],
      { timeout: 6000 },
      (err, stdout) => {
        if (err || !stdout) {
          return resolve(0);
        }
        const parsed = parseFloat(stdout.trim());
        if (Number.isFinite(parsed) && parsed > 30) {
          resolve(Math.round(parsed));
        } else {
          resolve(0);
        }
      }
    );
  });
}

/**
 * Formats seconds into MM:SS or HH:MM:SS
 */
export function formatTimecode(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Scans SETS_DIRS, deduplicates audio files > 5MB, probes exact durations via ffprobe,
 * stores verified durations. Waveforms are decoded on demand for the active set.
 */
export async function scanAndSyncSets() {
  for (const dir of SETS_DIRS) {
    if (dir.startsWith(__dirname) && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const existingRows = db.prepare('SELECT * FROM sets ORDER BY seq_num ASC').all();
  const existingByKey = new Map(existingRows.map((r) => [r.dedup_key, r]));
  const seenDedupKeys = new Set(existingByKey.keys());
  const seenSizesAndBase = new Set(existingRows.map((r) => r.dedup_key));
  let maxSeq = existingRows.reduce((m, r) => Math.max(m, r.seq_num), 0);

  // Verify existing filepaths still exist or update if moved
  const candidates = [];

  for (const dir of SETS_DIRS) {
    if (!fs.existsSync(dir)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(dir).sort();
    } catch {
      continue;
    }

    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const ext = path.extname(name).toLowerCase();
      if (!AUDIO_EXT_MIME[ext]) continue;

      const fullPath = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size < MIN_FILE_SIZE_BYTES) continue;

      const dedupKey = buildDedupKey(name, stat.size);
      const existing = existingByKey.get(dedupKey);
      if (existing && !fs.existsSync(existing.filepath)) {
        db.prepare('UPDATE sets SET filepath = ?, original_name = ? WHERE id = ?')
          .run(fullPath, name, existing.id);
        existing.filepath = fullPath;
      }
      if (seenDedupKeys.has(dedupKey) || seenSizesAndBase.has(dedupKey)) {
        continue;
      }
      seenSizesAndBase.add(dedupKey);
      candidates.push({
        name,
        fullPath,
        ext,
        mimeType: AUDIO_EXT_MIME[ext],
        fileSize: stat.size,
        dedupKey,
      });
    }
  }

  if (candidates.length > 0) {
    // Probe durations in parallel batches for fast startup (< 900ms for 45 files)
    const durations = await Promise.all(
      candidates.map((c) =>
        probeDurationAsync(c.fullPath)
      )
    );

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO sets (
        id, seq_num, code, short_code, channel_id, frequency, sonic_tag,
        filepath, original_name, dedup_key, file_size, mime_type, ext,
        duration_sec, waveform_json, waveform_refined, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);

    const now = Date.now();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!durations[i]) continue; // Probe failure stays unavailable and may be retried on the next scan.
      maxSeq += 1;
      const numStr = String(maxSeq).padStart(3, '0');
      const id = `s-${numStr}`;
      const shortCode = `S-${numStr}`;
      const code = `Эфир S-${numStr}`;

      const chId = CHANNEL_IDS[(maxSeq - 1) % CHANNEL_IDS.length];
      const channelMeta = CHANNELS[chId];
      const sonicTag = channelMeta.subtitle;
      const durationSec = durations[i];

      insertStmt.run(
        id,
        maxSeq,
        code,
        shortCode,
        chId,
        channelMeta.frequency,
        sonicTag,
        c.fullPath,
        c.name,
        c.dedupKey,
        c.fileSize,
        c.mimeType,
        c.ext,
        durationSec,
        null,
        now
      );
    }
  }

  return db.prepare('SELECT COUNT(*) AS cnt FROM sets').get().cnt;
}

/**
 * Strips all internal file paths and original filenames before returning any set info.
 * CRITICAL: ZERO TRACK-ID LEAK.
 */
export function sanitizeSetRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    setId: row.id,
    seqNum: row.seq_num,
    code: row.code,
    shortCode: row.short_code,
    channelId: row.channel_id,
    frequency: '',
    sonicTag: CHANNELS[row.channel_id]?.subtitle || '',
    durationSec: row.duration_sec,
    durationFormatted: formatTimecode(row.duration_sec),
  };
}

/**
 * Resolves a set row (including internal filepath for streaming ONLY) by id, shortCode, code, or seq_num.
 */
export function getInternalSetById(rawId) {
  if (!rawId) return null;
  const val = String(rawId).trim();
  const lower = val.toLowerCase();

  let row = db
    .prepare(
      `SELECT * FROM sets WHERE lower(id) = ? OR lower(short_code) = ? OR lower(code) = ?`
    )
    .get(lower, lower, lower);

  if (!row && /^\d+$/.test(val)) {
    row = db.prepare(`SELECT * FROM sets WHERE seq_num = ?`).get(Number(val));
  }
  return row || null;
}

/**
 * Builds deterministic rotation lineup for a channel so each channel plays a distinct order
 * while covering the full archive without gaps.
 */
export function getAvailableSets() {
  return db.prepare('SELECT * FROM sets ORDER BY seq_num ASC').all().filter((row) => {
    try { return Number.isFinite(row.duration_sec) && row.duration_sec > 0 && fs.statSync(row.filepath).isFile(); } catch { return false; }
  });
}

function getChannelLineup(channelId) {
  const allSets = getAvailableSets();
  if (allSets.length === 0) return [];

  // Primary sets assigned to this channel first, followed by deterministic interleaved sets
  const primary = allSets.filter((s) => s.channel_id === channelId);
  const others = allSets.filter((s) => s.channel_id !== channelId);

  const lineup = [];
  const maxLen = Math.max(primary.length, others.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < primary.length) lineup.push(primary[i]);
    if (channelId === 'ch-deep' && i < others.length) {
      lineup.push(others[(i * 3) % others.length]);
    } else if (channelId === 'ch-afterglow' && i < others.length) {
      lineup.push(others[(i * 5 + 1) % others.length]);
    }
  }

  // Deduplicate within lineup while preserving order
  const seen = new Set();
  const uniqueLineup = [];
  for (const s of lineup) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      uniqueLineup.push(s);
    }
  }
  return uniqueLineup.length > 0 ? uniqueLineup : allSets;
}

/**
 * Deterministic Live Broadcast Clock for any of the 3 channels (`ch-main`, `ch-deep`, `ch-afterglow`).
 * Computes which anonymous set is on air right now and its exact playback second (`positionSec`).
 */
export function getCurrentBroadcast(channelId = 'ch-main', nowMs = Date.now()) {
  const normalizedChannel = CHANNELS[channelId] ? channelId : 'ch-main';
  const channelMeta = CHANNELS[normalizedChannel];
  const lineup = getChannelLineup(normalizedChannel);

  if (lineup.length === 0) {
    return {
      available: false, channelId: normalizedChannel, channelName: channelMeta.name,
      channelTitle: channelMeta.title, channelSubtitle: channelMeta.subtitle,
      setId: '', code: 'ЭФИР НЕДОСТУПЕН', shortCode: '', frequency: channelMeta.frequency,
      sonicTag: '', durationSec: 0, positionSec: 0, progress: 0, startsInSec: 0,
      startedAtMs: nowMs, nextSetId: '', nextCode: '', nextShortCode: '', nextSonicTag: '',
      streamUrl: '', schedule: [],
    };
  }

  const totalCycleSec = lineup.reduce((acc, s) => acc + s.duration_sec, 0);
  const elapsedSec =
    Math.floor((nowMs - BROADCAST_EPOCH_MS) / 1000) + channelMeta.epochOffsetSec;
  const cyclePosSec = ((elapsedSec % totalCycleSec) + totalCycleSec) % totalCycleSec;

  let cursor = 0;
  let activeIdx = 0;
  let positionSec = 0;

  for (let i = 0; i < lineup.length; i++) {
    const dur = lineup[i].duration_sec;
    if (cyclePosSec < cursor + dur) {
      activeIdx = i;
      positionSec = cyclePosSec - cursor;
      break;
    }
    cursor += dur;
  }

  const currentRow = lineup[activeIdx];
  const nextRow = lineup[(activeIdx + 1) % lineup.length];
  const durationSec = currentRow.duration_sec;
  const startsInSec = Math.max(1, durationSec - positionSec);
  const progress = Number((positionSec / durationSec).toFixed(4));

  const activeSonicTag = channelMeta.subtitle;
  const nextSonicTag = channelMeta.subtitle;

  // Build upcoming schedule (next 4 slots)
  const schedule = [];
  let accumStartsIn = startsInSec;
  for (let step = 1; step <= 4; step++) {
    const row = lineup[(activeIdx + step) % lineup.length];
    schedule.push({
      setId: row.id,
      code: row.code,
      shortCode: row.short_code,
      sonicTag: channelMeta.subtitle,
      frequency: channelMeta.frequency,
      durationSec: row.duration_sec,
      durationFormatted: formatTimecode(row.duration_sec),
      startsInSec: accumStartsIn,
      startsAtMs: nowMs + accumStartsIn * 1000,
    });
    accumStartsIn += row.duration_sec;
  }

  // Trigger Stage-2 background ffmpeg waveform refinement for the active set if not yet refined
  if (!currentRow.waveform_refined && currentRow.filepath) {
    scheduleFfmpegWaveform(currentRow.id, currentRow.filepath, (refinedPeaks) => {
      try {
        db.prepare(
          `UPDATE sets SET waveform_json = ?, waveform_refined = 1 WHERE id = ?`
        ).run(JSON.stringify(refinedPeaks), currentRow.id);
      } catch {
        // ignore update error
      }
    });
  }

  return {
    channelId: normalizedChannel,
    channelName: channelMeta.name,
    channelTitle: channelMeta.title,
    channelSubtitle: channelMeta.subtitle,
    accent: channelMeta.accent,
    setId: currentRow.id,
    code: currentRow.code,
    shortCode: currentRow.short_code,
    frequency: channelMeta.frequency,
    mhz: channelMeta.mhz,
    sonicTag: activeSonicTag,
    durationSec,
    durationFormatted: formatTimecode(durationSec),
    positionSec,
    positionFormatted: formatTimecode(positionSec),
    progress,
    startsInSec,
    startedAtMs: nowMs - positionSec * 1000,
    endsAtMs: nowMs + startsInSec * 1000,
    nextSetId: nextRow.id,
    nextCode: nextRow.code,
    nextShortCode: nextRow.short_code,
    nextSonicTag,
    streamUrl: `/api/radio/stream/${normalizedChannel}`,
    preloadNextUrl: `/api/radio/stream-set/${nextRow.id}`,
    schedule,
  };
}

/** Only verified ffmpeg peaks are public. Legacy byte envelopes remain private. */
export function getWaveformForSet(setId) {
  const row = getInternalSetById(setId);
  if (!row || row.waveform_refined !== 1 || !row.waveform_json) return [];
  try {
    const parsed = JSON.parse(row.waveform_json);
    if (Array.isArray(parsed) && parsed.length === 240 &&
        parsed.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return parsed;
  } catch { /* Unusable cache stays unavailable; never stamp fabricated peaks as refined. */ }
  return [];
}

/**
 * Returns waveform moments for a set ordered by timestamp_sec ASC
 */
export function getMomentsForSet(setId) {
  const rows = db
    .prepare(
      `SELECT m.*, COALESCE(l.real_likes_count, 0) AS real_likes_count
       FROM waveform_moments m
       LEFT JOIN (SELECT moment_id, COUNT(*) AS real_likes_count FROM moment_likes
         WHERE user_key NOT GLOB 'u-seed-*' GROUP BY moment_id) l ON l.moment_id = m.id
       WHERE set_id = ? AND ${socialFilter}
       ORDER BY timestamp_sec ASC, id ASC`
    )
    .all(setId);

  return rows.map(formatMomentRow);
}

export function formatMomentRow(r) {
  return {
    id: r.id,
    setId: r.set_id,
    userId: r.user_id,
    callsign: r.callsign,
    avatarColor: r.avatar_color,
    timestampSec: r.timestamp_sec,
    timecodeFormatted: formatTimecode(r.timestamp_sec),
    type: r.reaction_type,
    reactionType: r.reaction_type,
    comment: r.comment || '',
    likesCount: Number(r.real_likes_count ?? 0),
    createdAt: r.created_at,
  };
}

/**
 * Creates a new moment / reaction marker on the waveform
 */
export function createWaveformMoment({
  setId,
  userId,
  callsign,
  avatarColor,
  timestampSec,
  reactionType,
  comment = '',
}) {
  if (String(userId).startsWith('u-seed-')) return null;
  const setRow = getInternalSetById(setId);
  const resolvedSetId = setRow ? setRow.id : String(setId);
  const maxDur = setRow ? setRow.duration_sec : 0;
  const clampedTs = Math.max(0, Math.min(maxDur - 1, Math.floor(Number(timestampSec) || 0)));
  const now = Date.now();

  const res = db
    .prepare(
      `INSERT INTO waveform_moments (
        set_id, user_id, callsign, avatar_color, timestamp_sec,
        reaction_type, comment, likes_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    )
    .run(
      resolvedSetId,
      userId,
      callsign,
      avatarColor,
      clampedTs,
      reactionType,
      comment,
      now
    );

  const created = db
    .prepare(`SELECT * FROM waveform_moments WHERE id = ?`)
    .get(res.lastInsertRowid);

  const allMoments = getMomentsForSet(resolvedSetId);
  const peaks = getWaveformForSet(resolvedSetId);
  const heatmap = computeHeatmap(allMoments, maxDur, 60, peaks);

  return {
    moment: formatMomentRow(created),
    heatmap,
    momentsCount: allMoments.length,
  };
}

/**
 * Increments likes_count on a waveform moment
 */
export function likeWaveformMoment(momentId, userKey) {
  const existing = db
    .prepare(`SELECT * FROM waveform_moments WHERE id = ?`)
    .get(Number(momentId));
  if (!existing || existing.user_id.startsWith('u-seed-') || String(userKey).startsWith('u-seed-')) return null;

  const alreadyLiked = db
    .prepare(`SELECT 1 FROM moment_likes WHERE moment_id = ? AND user_key = ?`)
    .get(existing.id, userKey);

  if (!alreadyLiked) {
    db.prepare(
      `INSERT OR IGNORE INTO moment_likes (moment_id, user_key, created_at) VALUES (?, ?, ?)`
    ).run(existing.id, userKey, Date.now());
    db.prepare(
      `UPDATE waveform_moments SET likes_count = likes_count + 1 WHERE id = ?`
    ).run(existing.id);
  }

  const updated = db
    .prepare(`SELECT * FROM waveform_moments WHERE id = ?`)
    .get(existing.id);
  const setRow = getInternalSetById(updated.set_id);
  const allMoments = getMomentsForSet(updated.set_id);
  const peaks = getWaveformForSet(updated.set_id);
  const heatmap = computeHeatmap(
    allMoments,
    setRow ? setRow.duration_sec : 0,
    60,
    peaks
  );

  return {
    moment: allMoments.find((moment) => moment.id === updated.id),
    heatmap,
    alreadyLiked: Boolean(alreadyLiked),
  };
}

/**
 * Returns the latest 50 chat messages with aggregated reactions by type
 */
export function getRecentChatMessages(limit = 50, channelId = null) {
  const rows = channelId
    ? db
        .prepare(
          `SELECT * FROM chat_messages
           WHERE (channel_id = ? OR channel_id = 'all') AND ${socialFilter}
           ORDER BY id DESC LIMIT ?`
        )
        .all(channelId, limit)
    : db.prepare(`SELECT * FROM chat_messages WHERE ${socialFilter} ORDER BY id DESC LIMIT ?`).all(limit);

  rows.reverse();
  if (rows.length === 0) return [];

  const msgIds = rows.map((r) => r.id);
  const placeholders = msgIds.map(() => '?').join(',');
  const reactionRows = db
    .prepare(
      `SELECT message_id, reaction_type, COUNT(*) AS cnt
       FROM chat_reactions
       WHERE message_id IN (${placeholders}) AND ${socialFilter}
       GROUP BY message_id, reaction_type`
    )
    .all(...msgIds);

  const reactionsByMsg = new Map();
  for (const r of reactionRows) {
    if (!reactionsByMsg.has(r.message_id)) {
      reactionsByMsg.set(r.message_id, {});
    }
    reactionsByMsg.get(r.message_id)[r.reaction_type] = r.cnt;
  }

  return rows.map((r) => formatChatMessageRow(r, reactionsByMsg.get(r.id) || {}));
}

export function formatChatMessageRow(r, reactions = {}) {
  const timecode = formatTimecode(r.set_timestamp_sec);
  return {
    id: r.id,
    channelId: r.channel_id,
    userId: r.user_id,
    callsign: r.callsign,
    avatarColor: r.avatar_color,
    text: r.text,
    message: r.text,
    setId: r.set_id,
    setCode: r.set_code,
    setTimestampSec: r.set_timestamp_sec,
    timecodeFormatted: timecode,
    badge: `[${r.set_code} · ${timecode}]`,
    reactions,
    createdAt: r.created_at,
  };
}

/**
 * Inserts a new live chat message automatically stamped with current set code & second
 */
export function createChatMessage({
  channelId = 'ch-main',
  userId,
  callsign,
  avatarColor,
  text,
}) {
  if (String(userId).startsWith('u-seed-')) return null;
  const broadcast = getCurrentBroadcast(channelId);
  const now = Date.now();

  const res = db
    .prepare(
      `INSERT INTO chat_messages (
        channel_id, user_id, callsign, avatar_color, text,
        set_id, set_code, set_timestamp_sec, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      broadcast.channelId,
      userId,
      callsign,
      avatarColor,
      text,
      broadcast.setId,
      broadcast.shortCode,
      broadcast.positionSec,
      now
    );

  const created = db
    .prepare(`SELECT * FROM chat_messages WHERE id = ?`)
    .get(res.lastInsertRowid);

  return formatChatMessageRow(created, {});
}

/**
 * Adds or toggles a reaction on a chat message and returns aggregated counts
 */
export function reactToChatMessage({ messageId, userId, reactionType }) {
  const msg = db
    .prepare(`SELECT * FROM chat_messages WHERE id = ?`)
    .get(Number(messageId));
  if (!msg || msg.user_id.startsWith('u-seed-') || String(userId).startsWith('u-seed-')) return null;

  const existing = db
    .prepare(
      `SELECT id FROM chat_reactions
       WHERE message_id = ? AND user_id = ? AND reaction_type = ?`
    )
    .get(msg.id, userId, reactionType);

  let action = 'added';
  if (existing) {
    db.prepare(`DELETE FROM chat_reactions WHERE id = ?`).run(existing.id);
    action = 'removed';
  } else {
    db.prepare(
      `INSERT INTO chat_reactions (message_id, user_id, reaction_type, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(msg.id, userId, reactionType, Date.now());
  }

  const rows = db
    .prepare(
      `SELECT reaction_type, COUNT(*) AS cnt
       FROM chat_reactions
       WHERE message_id = ? AND ${socialFilter}
       GROUP BY reaction_type`
    )
    .all(msg.id);

  const reactions = {};
  for (const r of rows) {
    reactions[r.reaction_type] = r.cnt;
  }

  return {
    messageId: msg.id,
    action,
    reactionType,
    reactions,
    message: formatChatMessageRow(msg, reactions),
  };
}

