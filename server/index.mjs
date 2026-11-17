import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  db,
  getAvailableSets,
  CHANNELS,
  CHANNEL_IDS,
  scanAndSyncSets,
  getCurrentBroadcast,
  getInternalSetById,
  getWaveformForSet,
  getMomentsForSet,
  createWaveformMoment,
  likeWaveformMoment,
  getRecentChatMessages,
  createChatMessage,
  reactToChatMessage,
  sanitizeSetRow,
} from './db.mjs';
import { computeHeatmap } from './waveform.mjs';
import { sanitizedAudioPath } from './media.mjs';
import { resolvePublicFile } from './static.mjs';
import {
  REACTION_META,
  AVATAR_PALETTE,
  createChallenge,
  verifyChallenge,
  hashPin,
  verifyPin,
  signToken,
  extractAuthUser as readAuthToken,
  isStrongPin,
  sanitizeCallsign,
  sanitizeText,
  sanitizeReactionType,
  sanitizeAvatarColor,
  checkRateLimit,
  checkChatSpam,
  getClientIp,
} from './security.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.RADIOTV_HOST || '127.0.0.1';
const DEFAULT_CHANNEL_ID = 'ch-main';

const POW_DIFFICULTY = 3;
const HEATMAP_SEGMENTS = 60;
const RECENT_CHAT_LIMIT = 50;
const MAX_JSON_BODY_BYTES = 32_768;
const STREAM_HIGH_WATER_MARK_BYTES = 64 * 1024;
const SSE_SYNC_INTERVAL_MS = 8000;
const SHUTDOWN_FORCE_EXIT_MS = 5000;
const MAX_MOMENT_COMMENT_LENGTH = 140;
const MAX_CHAT_TEXT_LENGTH = 280;
const GUEST_CALLSIGN_PREFIXES = ['SELECTOR', 'ETHER', 'SUB', 'VINYL', 'DUB'];

const STATIC_MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const sseClients = new Set();
let socialRevision = Date.now() * 1000;
let isShuttingDown = false;

function normalizeChannelId(channelId) {
  return CHANNELS[channelId] ? channelId : DEFAULT_CHANNEL_ID;
}

function getChannelQueryParam(urlObj) {
  return (
    urlObj.searchParams.get('channel') ||
    urlObj.searchParams.get('channelId') ||
    DEFAULT_CHANNEL_ID
  );
}

// Seed identities cannot authenticate. Guest identities are session-only.
function extractAuthUser(req, body = null) {
  const token = readAuthToken(req, body);
  if (!token || token.uid.startsWith('u-seed-')) return null;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(token.uid);
  if (!user || (!user.is_guest && verifyPin('0000', user.pin_hash, user.pin_salt))) {
    return null;
  }

  return {
    ...token,
    callsign: user.callsign,
    avatarColor: user.avatar_color,
    isGuest: Boolean(user.is_guest),
  };
}

function getListenersCount(channelId = DEFAULT_CHANNEL_ID) {
  let count = 0;
  for (const client of sseClients) {
    if (client.channelId === channelId) count += 1;
  }
  return count;
}

function getTotalListenersCount() {
  return sseClients.size;
}

/**
 * Broadcasts an event to all connected SSE clients.
 * Sends one named event; clients resync a snapshot after reconnecting.
 */
function broadcastSse(type, payload) {
  if (payload.moment) payload.moment.revision = ++socialRevision;
  if (payload.message) payload.message.revision = ++socialRevision;

  const eventId = crypto.randomBytes(6).toString('hex');
  const dataStr = JSON.stringify({
    eventId,
    type,
    event: type,
    serverTime: Date.now(),
    ...payload,
  });
  const namedFrame = `id: ${eventId}\nevent: ${type}\ndata: ${dataStr}\n\n`;

  for (const client of sseClients) {
    try {
      client.res.write(namedFrame);
    } catch {
      sseClients.delete(client);
    }
  }
}

function broadcastListenersUpdate(channelId) {
  broadcastSse('listeners:update', {
    channelId,
    listenersCount: getListenersCount(channelId),
    totalListenersCount: getTotalListenersCount(),
  });
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Auth-Token, X-Session-Token, Range'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Range, Accept-Ranges, Content-Length, Content-Type'
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function createBodyError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function readJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        fail(createBodyError(413, 'Слишком большой размер запроса'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const body = Buffer.concat(chunks, bytes).toString('utf8');
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(createBodyError(400, 'Некорректный формат JSON'));
      }
    });

    req.on('error', fail);
  });
}

function generateUniqueGuestCallsign() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const pfx = GUEST_CALLSIGN_PREFIXES[attempt % GUEST_CALLSIGN_PREFIXES.length];
    const num = Math.floor(100 + Math.random() * 900);
    const candidate = `${pfx}-${num}`;
    const exists = db
      .prepare(`SELECT 1 FROM users WHERE lower(callsign) = lower(?)`)
      .get(candidate);
    if (!exists) return candidate;
  }
  return `SELECTOR-${Date.now().toString().slice(-4)}`;
}

function parseByteRange(rangeHeader, totalSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match || (!match[1] && !match[2])) {
    return { valid: false };
  }

  let start = match[1] ? parseInt(match[1], 10) : 0;
  let end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

  if (!match[1] && match[2]) {
    const suffixLength = parseInt(match[2], 10);
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  }

  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start >= totalSize ||
    start < 0 ||
    start > end
  ) {
    return { valid: false };
  }

  return { valid: true, start, end: Math.min(end, totalSize - 1) };
}

function pipeAudioStream(req, res, audioPath, streamOptions = {}) {
  if (req.method === 'HEAD') {
    return res.end();
  }

  const stream = fs.createReadStream(audioPath, {
    ...streamOptions,
    highWaterMark: STREAM_HIGH_WATER_MARK_BYTES,
  });

  res.on('close', () => stream.destroy());
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end();
  });
  stream.pipe(res);
}

/**
 * Streams an audio file with full HTTP 206 Partial Content Range support
 * and strict filename anonymization (`radiotv-live.<ext>`).
 */
async function streamAudioFile(req, res, setRow) {
  if (!setRow || !setRow.filepath || !fs.existsSync(setRow.filepath)) {
    return sendJson(res, 404, {
      ok: false,
      error: 'Аудиопоток временно недоступен',
    });
  }

  let stat;
  let audioPath;
  try {
    audioPath = await sanitizedAudioPath(setRow.filepath);
    stat = fs.statSync(audioPath);
  } catch {
    return sendJson(res, 404, {
      ok: false,
      error: 'Подготовка аудиопотока не удалась',
    });
  }

  const totalSize = stat.size;
  const mimeType = setRow.mime_type || 'audio/mp4';
  const ext = setRow.ext || '.m4a';
  const safeFilename = `radiotv-live${ext}`;
  const etag = `"${path.basename(audioPath)}"`;

  setCorsHeaders(res);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Radio-Transmission', setRow.short_code); // ASCII station id; localized copy belongs in JSON.
  res.setHeader('ETag', etag);

  const rangeHeader =
    req.headers['if-range'] && req.headers['if-range'] !== etag
      ? undefined
      : req.headers['range'];

  if (rangeHeader && typeof rangeHeader === 'string') {
    const parsedRange = parseByteRange(rangeHeader, totalSize);
    if (!parsedRange.valid) {
      res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
      return res.end();
    }

    const { start, end } = parsedRange;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Content-Length': end - start + 1,
    });
    return pipeAudioStream(req, res, audioPath, { start, end });
  }

  res.writeHead(200, { 'Content-Length': totalSize });
  return pipeAudioStream(req, res, audioPath);
}

function buildChannelSummary(id, broadcast) {
  const meta = CHANNELS[id];
  return {
    id,
    name: meta.name,
    title: meta.title,
    subtitle: meta.subtitle,
    frequency: meta.frequency,
    mhz: meta.mhz,
    accent: meta.accent,
    listenersCount: getListenersCount(id),
    setId: broadcast.setId,
    code: broadcast.code,
    shortCode: broadcast.shortCode,
    sonicTag: broadcast.sonicTag,
    durationSec: broadcast.durationSec,
    durationFormatted: broadcast.durationFormatted,
    positionSec: broadcast.positionSec,
    positionFormatted: broadcast.positionFormatted,
    progress: broadcast.progress,
    startsInSec: broadcast.startsInSec,
    nextSetId: broadcast.nextSetId,
    nextCode: broadcast.nextCode,
    nextShortCode: broadcast.nextShortCode,
    nextSonicTag: broadcast.nextSonicTag,
    streamUrl: broadcast.streamUrl,
  };
}

/**
 * Builds the complete state payload for `GET /api/radio/state`.
 */
function buildRadioStatePayload(channelId = DEFAULT_CHANNEL_ID) {
  const now = Date.now();
  const normalizedChannel = normalizeChannelId(channelId);
  const availableSets = getAvailableSets();
  const broadcastsByChannel = new Map(
    CHANNEL_IDS.map((id) => [id, getCurrentBroadcast(id, now, availableSets)])
  );

  const broadcast = broadcastsByChannel.get(normalizedChannel);
  const peaks = getWaveformForSet(broadcast.setId);
  const moments = getMomentsForSet(broadcast.setId);
  const heatmap = computeHeatmap(moments, broadcast.durationSec, HEATMAP_SEGMENTS);
  const messages = getRecentChatMessages(RECENT_CHAT_LIMIT);
  const listenersCount = getListenersCount(normalizedChannel);
  const totalListenersCount = getTotalListenersCount();
  const channels = CHANNEL_IDS.map((id) =>
    buildChannelSummary(id, broadcastsByChannel.get(id))
  );

  return {
    ok: true,
    demoMode: false,
    socialRevision,
    audienceMetric: 'connections',
    serverTime: now,
    channelId: normalizedChannel,
    channel: channels.find((c) => c.id === normalizedChannel),
    broadcast,
    // Top-level aliases for direct destructuring
    setId: broadcast.setId,
    code: broadcast.code,
    shortCode: broadcast.shortCode,
    frequency: broadcast.frequency,
    mhz: broadcast.mhz,
    sonicTag: broadcast.sonicTag,
    durationSec: broadcast.durationSec,
    durationFormatted: broadcast.durationFormatted,
    positionSec: broadcast.positionSec,
    positionFormatted: broadcast.positionFormatted,
    progress: broadcast.progress,
    startsInSec: broadcast.startsInSec,
    startedAtMs: broadcast.startedAtMs,
    endsAtMs: broadcast.endsAtMs,
    nextSetId: broadcast.nextSetId,
    nextCode: broadcast.nextCode,
    nextShortCode: broadcast.nextShortCode,
    nextSonicTag: broadcast.nextSonicTag,
    streamUrl: broadcast.streamUrl,
    preloadNextUrl: broadcast.preloadNextUrl,
    schedule: broadcast.schedule,
    peaks,
    heatmap,
    moments,
    messages,
    listenersCount,
    totalListenersCount,
    channels,
    reactionTypes: Object.values(REACTION_META),
  };
}

function buildAuthSuccessPayload(user, isNew) {
  const token = signToken(user);
  const session = {
    id: user.id,
    callsign: user.callsign,
    avatarColor: user.avatarColor,
    token,
    powVerified: true,
  };

  return {
    ok: true,
    isNew,
    isGuest: user.isGuest,
    token,
    user,
    session,
  };
}

function loginAsGuest(res, rawAvatarColor) {
  const callsign = generateUniqueGuestCallsign();
  const generatedPin = crypto.randomBytes(32).toString('hex');
  const avatarColor = sanitizeAvatarColor(rawAvatarColor);
  const { hash, salt } = hashPin(generatedPin);
  const id = `u-${crypto.randomBytes(8).toString('hex')}`;
  const now = Date.now();

  db.prepare(
    `INSERT INTO users (
      id, callsign, pin_hash, pin_salt, avatar_color, is_guest, created_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(id, callsign, hash, salt, avatarColor, now, now);

  const user = { id, callsign, avatarColor, isGuest: true };
  return sendJson(res, 200, buildAuthSuccessPayload(user, true));
}

function registerNewUser(res, callsign, rawPin, rawAvatarColor) {
  const avatarColor = sanitizeAvatarColor(rawAvatarColor);
  const { hash, salt } = hashPin(rawPin);
  const id = `u-${crypto.randomBytes(8).toString('hex')}`;
  const now = Date.now();

  db.prepare(
    `INSERT INTO users (
      id, callsign, pin_hash, pin_salt, avatar_color, is_guest, created_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(id, callsign, hash, salt, avatarColor, now, now);

  const user = { id, callsign, avatarColor, isGuest: false };
  return sendJson(res, 200, buildAuthSuccessPayload(user, true));
}

function authenticateExistingUser(res, existing, rawPin, rawAvatarColor) {
  if (!verifyPin(rawPin, existing.pin_hash, existing.pin_salt)) {
    return sendJson(res, 401, {
      ok: false,
      error: 'Имя занято или PIN-код не подходит.',
    });
  }

  const nextColor =
    typeof rawAvatarColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(rawAvatarColor)
      ? rawAvatarColor
      : existing.avatar_color;

  db.prepare(`UPDATE users SET last_seen_at = ?, avatar_color = ? WHERE id = ?`).run(
    Date.now(),
    nextColor,
    existing.id
  );

  const user = {
    id: existing.id,
    callsign: existing.callsign,
    avatarColor: nextColor,
    isGuest: Boolean(existing.is_guest),
  };
  return sendJson(res, 200, buildAuthSuccessPayload(user, false));
}

/**
 * Handles Auth Login (both custom callsign + PIN and 1-click fast guest login).
 */
function handleLoginRequest(req, res, body, forceGuest = false) {
  const ip = getClientIp(req);
  const rl = checkRateLimit('login', ip);
  if (!rl.allowed) {
    return sendJson(res, 429, { ok: false, error: rl.error });
  }

  const honeypot =
    body.websiteHoneypot ?? body.website ?? body.honeypot ?? body.companyUrl ?? '';
  if (typeof honeypot === 'string' && honeypot.trim().length > 0) {
    return sendJson(res, 403, {
      ok: false,
      error: 'Не удалось пройти проверку входа. Попробуйте ещё раз.',
    });
  }

  const powCheck = verifyChallenge(body.challengeId, body.nonce);
  if (!powCheck.ok) {
    return sendJson(res, 403, {
      ok: false,
      error: 'Не удалось проверить вход. Попробуйте ещё раз.',
    });
  }

  const isGuestMode =
    forceGuest ||
    Boolean(body.guest) ||
    Boolean(body.isGuest) ||
    body.mode === 'guest';

  if (isGuestMode) {
    return loginAsGuest(res, body.avatarColor);
  }

  const callsignCheck = sanitizeCallsign(body.callsign);
  if (!callsignCheck.ok) {
    return sendJson(res, 400, { ok: false, error: callsignCheck.error });
  }

  const callsign = callsignCheck.value;
  const rawPin = String(body.pin ?? '').trim();
  if (!isStrongPin(rawPin)) {
    return sendJson(res, 400, {
      ok: false,
      error: 'PIN: 6–16 цифр без повторяющихся или последовательных комбинаций',
    });
  }

  const existing = db
    .prepare(`SELECT * FROM users WHERE lower(callsign) = lower(?)`)
    .get(callsign);

  const accountLimit = checkRateLimit('loginAccount', callsign.toLowerCase());
  if (!accountLimit.allowed) {
    return sendJson(res, 429, { ok: false, ...accountLimit });
  }

  if (existing && (existing.is_guest || existing.id.startsWith('u-seed-'))) {
    return sendJson(res, 401, {
      ok: false,
      error: 'Это имя недоступно. Выберите другое или войдите гостем.',
    });
  }

  if (!existing) {
    return registerNewUser(res, callsign, rawPin, body.avatarColor);
  }

  return authenticateExistingUser(res, existing, rawPin, body.avatarColor);
}

function handleHealth(_req, res) {
  const setsCount = db.prepare(`SELECT COUNT(*) AS cnt FROM sets`).get().cnt;
  return sendJson(res, 200, {
    ok: true,
    service: 'RADIOTV Live Broadcast Server',
    setsCount,
    channels: CHANNEL_IDS,
    serverTime: Date.now(),
  });
}

function handleAuthChallenge(_req, res) {
  const challenge = createChallenge(POW_DIFFICULTY);
  return sendJson(res, 200, {
    ok: true,
    ...challenge,
    avatarPalette: AVATAR_PALETTE,
  });
}

async function handleAuthLogin(req, res, forceGuest) {
  const body = await readJsonBody(req);
  return handleLoginRequest(req, res, body, forceGuest);
}

function handleAuthMe(req, res) {
  const authUser = extractAuthUser(req);
  if (!authUser) {
    return sendJson(res, 401, { ok: false, error: 'Сессия недействительна' });
  }
  return sendJson(res, 200, {
    ok: true,
    user: {
      id: authUser.uid,
      callsign: authUser.callsign,
      avatarColor: authUser.avatarColor,
      isGuest: authUser.isGuest,
    },
  });
}

function handleRadioState(_req, res, urlObj) {
  const channelId = getChannelQueryParam(urlObj);
  return sendJson(res, 200, buildRadioStatePayload(channelId));
}

function handleRadioChannels(_req, res) {
  const payload = buildRadioStatePayload(DEFAULT_CHANNEL_ID);
  return sendJson(res, 200, {
    ok: true,
    serverTime: payload.serverTime,
    channels: payload.channels,
    totalListenersCount: payload.totalListenersCount,
  });
}

function handleRadioEvents(req, res, urlObj, ip) {
  if (isShuttingDown) {
    return sendJson(res, 503, { ok: false, error: 'Сервер завершает работу' });
  }

  const channelId = normalizeChannelId(getChannelQueryParam(urlObj));

  setCorsHeaders(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const client = {
    id: crypto.randomUUID(),
    res,
    channelId,
    ip,
    connectedAt: Date.now(),
  };
  sseClients.add(client);

  const initPayload = JSON.stringify({
    type: 'connected',
    event: 'connected',
    serverTime: Date.now(),
    channelId: client.channelId,
    listenersCount: getListenersCount(client.channelId),
    totalListenersCount: getTotalListenersCount(),
  });
  res.write(`event: connected\ndata: ${initPayload}\n\n`);

  broadcastListenersUpdate(client.channelId);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    sseClients.delete(client);
    if (!isShuttingDown) {
      broadcastListenersUpdate(client.channelId);
    }
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

async function handleRadioStreamByChannel(req, res, urlObj, channelMatch) {
  const rawChannel = channelMatch
    ? decodeURIComponent(channelMatch[1])
    : urlObj.searchParams.get('channel') || DEFAULT_CHANNEL_ID;

  let setRow = null;
  if (CHANNELS[rawChannel]) {
    const broadcast = getCurrentBroadcast(rawChannel);
    setRow = getInternalSetById(broadcast.setId);
  } else {
    setRow = getInternalSetById(rawChannel);
    if (!setRow) {
      const broadcast = getCurrentBroadcast(DEFAULT_CHANNEL_ID);
      setRow = getInternalSetById(broadcast.setId);
    }
  }

  return streamAudioFile(req, res, setRow);
}

async function handleRadioStreamBySet(req, res, setMatch) {
  const rawSetId = decodeURIComponent(setMatch[1]);
  const setRow = getInternalSetById(rawSetId);
  return streamAudioFile(req, res, setRow);
}

async function handleCreateMoment(req, res, ip) {
  const body = await readJsonBody(req);
  const authUser = extractAuthUser(req, body);
  if (!authUser) {
    return sendJson(res, 401, {
      ok: false,
      error: 'Войдите, чтобы оставить отметку на волне.',
    });
  }

  const rl = checkRateLimit('moment', `${authUser.uid}:${ip}`);
  if (!rl.allowed) {
    return sendJson(res, 429, { ok: false, error: rl.error });
  }

  const reactionType = sanitizeReactionType(body.type || body.reactionType) || 'fire';
  const comment = sanitizeText(
    body.comment ?? body.text ?? '',
    MAX_MOMENT_COMMENT_LENGTH
  );
  const channelId = normalizeChannelId(body.channelId || body.channel);

  const needsBroadcast =
    !body.setId || body.timestampSec === undefined || body.timestampSec === null;
  const broadcast = needsBroadcast ? getCurrentBroadcast(channelId) : null;
  const setId = body.setId || broadcast.setId;

  if (!getInternalSetById(setId)) {
    return sendJson(res, 404, { ok: false, error: 'Сет не найден' });
  }

  const timestampSec =
    body.timestampSec !== undefined && body.timestampSec !== null
      ? Number(body.timestampSec)
      : broadcast.positionSec;

  const result = createWaveformMoment({
    setId,
    userId: authUser.uid,
    callsign: authUser.callsign,
    avatarColor: authUser.avatarColor,
    timestampSec,
    reactionType,
    comment,
  });

  if (!result) {
    return sendJson(res, 403, { ok: false, error: 'Сессия недействительна' });
  }

  broadcastSse('moment:created', {
    setId: result.moment.setId,
    channelId,
    moment: result.moment,
    heatmap: result.heatmap,
  });

  return sendJson(res, 201, {
    ok: true,
    moment: result.moment,
    heatmap: result.heatmap,
  });
}

async function handleLikeMoment(req, res, momentMatch) {
  const momentId = Number(momentMatch[1]);
  if (!Number.isSafeInteger(momentId)) {
    return sendJson(res, 404, { ok: false, error: 'Момент не найден' });
  }
  const body = await readJsonBody(req);
  const authUser = extractAuthUser(req, body);
  if (!authUser) {
    return sendJson(res, 401, { ok: false, error: 'Сессия недействительна' });
  }

  const userKey = authUser.uid;
  const rl = checkRateLimit('reaction', userKey);
  if (!rl.allowed) {
    return sendJson(res, 429, { ok: false, error: rl.error });
  }

  const result = likeWaveformMoment(momentId, userKey);
  if (!result) {
    return sendJson(res, 404, { ok: false, error: 'Момент не найден' });
  }

  broadcastSse('moment:liked', {
    setId: result.moment.setId,
    moment: result.moment,
    heatmap: result.heatmap,
  });

  return sendJson(res, 200, {
    ok: true,
    moment: result.moment,
    heatmap: result.heatmap,
    alreadyLiked: result.alreadyLiked,
  });
}

async function handleCreateChatMessage(req, res) {
  const body = await readJsonBody(req);
  const authUser = extractAuthUser(req, body);
  if (!authUser) {
    return sendJson(res, 401, {
      ok: false,
      error: 'Войдите, чтобы написать в чат.',
    });
  }

  const rl = checkRateLimit('chat', authUser.uid);
  if (!rl.allowed) {
    return sendJson(res, 429, {
      ok: false,
      error: rl.error,
      retryAfterMs: rl.retryAfterMs,
    });
  }

  const text = sanitizeText(
    body.text ?? body.message ?? body.content ?? '',
    MAX_CHAT_TEXT_LENGTH
  );
  if (!text) {
    return sendJson(res, 400, {
      ok: false,
      error: 'Сообщение не может быть пустым',
    });
  }

  const spamCheck = checkChatSpam(authUser.uid, text);
  if (!spamCheck.allowed) {
    return sendJson(res, 429, { ok: false, error: spamCheck.error });
  }

  const channelId = normalizeChannelId(body.channelId || body.channel);
  const message = createChatMessage({
    channelId,
    userId: authUser.uid,
    callsign: authUser.callsign,
    avatarColor: authUser.avatarColor,
    text,
  });

  if (!message) {
    return sendJson(res, 403, { ok: false, error: 'Сессия недействительна' });
  }

  broadcastSse('chat:message', { channelId, message });

  return sendJson(res, 201, { ok: true, message });
}

async function handleReactToChatMessage(req, res, chatMatch) {
  const messageId = Number(chatMatch[1]);
  if (!Number.isSafeInteger(messageId)) {
    return sendJson(res, 404, { ok: false, error: 'Сообщение не найдено' });
  }
  const body = await readJsonBody(req);
  const authUser = extractAuthUser(req, body);
  if (!authUser) {
    return sendJson(res, 401, { ok: false, error: 'Сессия недействительна' });
  }

  const userId = authUser.uid;
  const rl = checkRateLimit('reaction', userId);
  if (!rl.allowed) {
    return sendJson(res, 429, { ok: false, error: rl.error });
  }

  const reactionType = sanitizeReactionType(body.type || body.reactionType);
  if (!reactionType) {
    return sendJson(res, 400, {
      ok: false,
      error: 'Выберите реакцию из списка.',
    });
  }

  const result = reactToChatMessage({ messageId, userId, reactionType });
  if (!result) {
    return sendJson(res, 404, { ok: false, error: 'Сообщение не найдено' });
  }

  broadcastSse('chat:reaction', {
    messageId: result.messageId,
    action: result.action,
    reactionType: result.reactionType,
    reactions: result.reactions,
    message: result.message,
  });

  return sendJson(res, 200, { ok: true, ...result });
}

function handleRadioArchive(_req, res) {
  const rows = getAvailableSets();
  return sendJson(res, 200, {
    ok: true,
    total: rows.length,
    sets: rows.map(sanitizeSetRow),
  });
}

async function handleStaticFile(req, res, pathname) {
  const resolved = resolvePublicFile(PROJECT_ROOT, pathname);
  if (!resolved) {
    return false;
  }

  const content = await fs.promises.readFile(resolved);
  const ext = path.extname(resolved).toLowerCase();
  setCorsHeaders(res);
  res.writeHead(200, {
    'Content-Type': STATIC_MIME_TYPES[ext] || 'application/octet-stream',
    'Content-Length': content.length,
  });
  res.end(req.method === 'HEAD' ? undefined : content);
  return true;
}

async function dispatchRequest(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    return res.end();
  }

  const rawUrl = req.url || '/';
  const safeUrl = rawUrl.startsWith('//')
    ? `/${rawUrl.replace(/^\/+/, '')}`
    : rawUrl;
  const urlObj = new URL(safeUrl, 'http://localhost');
  const { pathname } = urlObj;
  const method = req.method;
  const ip = getClientIp(req);

  if (method === 'GET') {
    if (pathname === '/api/health') return handleHealth(req, res);
    if (pathname === '/api/auth/challenge') return handleAuthChallenge(req, res);
    if (pathname === '/api/auth/me') return handleAuthMe(req, res);
    if (pathname === '/api/radio/state') return handleRadioState(req, res, urlObj);
    if (pathname === '/api/radio/channels') return handleRadioChannels(req, res);
    if (pathname === '/api/radio/events') return handleRadioEvents(req, res, urlObj, ip);
    if (pathname === '/api/radio/archive') return handleRadioArchive(req, res);
  }

  if (method === 'POST') {
    if (pathname === '/api/auth/login') return handleAuthLogin(req, res, false);
    if (pathname === '/api/auth/guest') return handleAuthLogin(req, res, true);
    if (pathname === '/api/radio/moments') return handleCreateMoment(req, res, ip);
    if (pathname === '/api/radio/chat') return handleCreateChatMessage(req, res);

    const momentReactMatch = /^\/api\/radio\/moments\/(\d+)\/react$/.exec(pathname);
    if (momentReactMatch) {
      return handleLikeMoment(req, res, momentReactMatch);
    }

    const chatReactMatch = /^\/api\/radio\/chat\/(\d+)\/react$/.exec(pathname);
    if (chatReactMatch) {
      return handleReactToChatMessage(req, res, chatReactMatch);
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    const streamChMatch = /^\/api\/radio\/stream\/([^/]+)$/.exec(pathname);
    if (streamChMatch || pathname === '/api/radio/stream') {
      return handleRadioStreamByChannel(req, res, urlObj, streamChMatch);
    }

    const streamSetMatch = /^\/api\/radio\/stream-set\/([^/]+)$/.exec(pathname);
    if (streamSetMatch) {
      return handleRadioStreamBySet(req, res, streamSetMatch);
    }

    if (await handleStaticFile(req, res, pathname)) {
      return;
    }
  }

  return sendJson(res, 404, {
    ok: false,
    error: 'Запрошенный адрес не найден.',
  });
}

const server = http.createServer(async (req, res) => {
  try {
    await dispatchRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      const statusCode =
        err && Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 500
          ? err.statusCode
          : 500;
      const message =
        statusCode < 500 && err.message
          ? err.message
          : 'Не удалось выполнить действие. Попробуйте ещё раз.';
      sendJson(res, statusCode, { ok: false, error: message });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

// Periodic broadcast sync tick over SSE every 8 seconds
const syncInterval = setInterval(() => {
  if (sseClients.size === 0 || isShuttingDown) return;

  const now = Date.now();
  const availableSets = getAvailableSets();
  const channelsSummary = CHANNEL_IDS.map((id) => {
    const b = getCurrentBroadcast(id, now, availableSets);
    return {
      id,
      setId: b.setId,
      code: b.code,
      shortCode: b.shortCode,
      sonicTag: b.sonicTag,
      positionSec: b.positionSec,
      durationSec: b.durationSec,
      progress: b.progress,
      startsInSec: b.startsInSec,
      nextCode: b.nextCode,
      listenersCount: getListenersCount(id),
    };
  });

  broadcastSse('broadcast:tick', {
    channels: channelsSummary,
    totalListenersCount: getTotalListenersCount(),
  });
}, SSE_SYNC_INTERVAL_MS);
syncInterval.unref();

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  clearInterval(syncInterval);
  for (const client of sseClients) {
    try {
      client.res.end();
    } catch {
      // ignore already closed socket
    }
  }
  sseClients.clear();

  const finishExit = (code) => {
    try {
      db.close();
    } catch {
      // ignore db close error
    }
    process.exit(code);
  };

  if (!server.listening) {
    finishExit(0);
    return;
  }

  const forceTimer = setTimeout(() => {
    server.closeAllConnections?.();
    finishExit(1);
  }, SHUTDOWN_FORCE_EXIT_MS);
  forceTimer.unref();

  server.close((err) => {
    clearTimeout(forceTimer);
    finishExit(err ? 1 : 0);
  });
  server.closeIdleConnections?.();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function bootstrap() {
  const t0 = Date.now();
  const totalSets = await scanAndSyncSets();
  const elapsed = Date.now() - t0;

  server.listen(PORT, HOST, () => {
    console.log(
      `[RADIOTV] Live Broadcast Server listening on http://localhost:${PORT} (${totalSets} anonymized sets indexed in ${elapsed}ms)`
    );
  });
}

bootstrap().catch((err) => {
  console.error('[RADIOTV] Failed to start server:', err);
  process.exit(1);
});
