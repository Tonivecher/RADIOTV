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
  ALLOWED_REACTIONS,
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
const PORT = Number(process.env.PORT) || 4321;

// Seed identities cannot authenticate. Guest identities are session-only.
function extractAuthUser(req, body = null) {
  const token = readAuthToken(req, body);
  if (!token || token.uid.startsWith('u-seed-')) return null;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(token.uid);
  if (!user || (!user.is_guest && verifyPin('0000', user.pin_hash, user.pin_salt))) return null;
  return { ...token, callsign: user.callsign, avatarColor: user.avatar_color, isGuest: Boolean(user.is_guest) };
}

// Active SSE connections: Set of { id, res, channelId, ip, connectedAt }
const sseClients = new Set();
let socialRevision = Date.now() * 1000;

function getListenersCount(channelId = 'ch-main') {
  return [...sseClients].filter((client) => client.channelId === channelId).length;
}

function getTotalListenersCount() {
  return CHANNEL_IDS.reduce((sum, id) => sum + getListenersCount(id), 0);
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

function readJsonBody(req, maxBytes = 32768) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Generates an unused guest callsign such as SELECTOR-704
 */
function generateUniqueGuestCallsign() {
  const prefixes = ['SELECTOR', 'ETHER', 'SUB', 'VINYL', 'DUB'];
  for (let attempt = 0; attempt < 30; attempt++) {
    const pfx = prefixes[attempt % prefixes.length];
    const num = Math.floor(100 + Math.random() * 900);
    const candidate = `${pfx}-${num}`;
    const exists = db
      .prepare(`SELECT 1 FROM users WHERE lower(callsign) = lower(?)`)
      .get(candidate);
    if (!exists) return candidate;
  }
  return `SELECTOR-${Date.now().toString().slice(-4)}`;
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

  setCorsHeaders(res);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Radio-Transmission', setRow.short_code); // ASCII station id; localized copy belongs in JSON.

  const etag = '"' + path.basename(audioPath) + '"';
  res.setHeader('ETag', etag);
  const rangeHeader = req.headers['if-range'] && req.headers['if-range'] !== etag
    ? undefined : req.headers['range'];

  if (rangeHeader && typeof rangeHeader === 'string') {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
      return res.end();
    }

    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

    if (!match[1] && match[2]) {
      // Suffix byte range: bytes=-500
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
      res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
      return res.end();
    }

    end = Math.min(end, totalSize - 1);
    const chunkLength = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Content-Length': chunkLength,
    });

    if (req.method === 'HEAD') {
      return res.end();
    }

    const stream = fs.createReadStream(audioPath, {
      start,
      end,
      highWaterMark: 64 * 1024,
    });
    res.on('close', () => stream.destroy());
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
    return;
  }

  // Full stream response (200 OK)
  res.writeHead(200, {
    'Content-Length': totalSize,
  });

  if (req.method === 'HEAD') {
    return res.end();
  }

  const stream = fs.createReadStream(audioPath, {
    highWaterMark: 64 * 1024,
  });
  res.on('close', () => stream.destroy());
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
}

/**
 * Builds the complete state payload for `GET /api/radio/state`
 */
function buildRadioStatePayload(channelId = 'ch-main') {
  const now = Date.now();
  const normalizedChannel = CHANNELS[channelId] ? channelId : 'ch-main';
  const broadcast = getCurrentBroadcast(normalizedChannel, now);
  const peaks = getWaveformForSet(broadcast.setId);
  const moments = getMomentsForSet(broadcast.setId);
  const heatmap = computeHeatmap(moments, broadcast.durationSec, 60, peaks);
  const messages = getRecentChatMessages(50);
  const listenersCount = getListenersCount(normalizedChannel);
  const totalListenersCount = getTotalListenersCount();

  const channels = CHANNEL_IDS.map((id) => {
    const b = getCurrentBroadcast(id, now);
    return {
      id,
      name: CHANNELS[id].name,
      title: CHANNELS[id].title,
      subtitle: CHANNELS[id].subtitle,
      frequency: CHANNELS[id].frequency,
      mhz: CHANNELS[id].mhz,
      accent: CHANNELS[id].accent,
      listenersCount: getListenersCount(id),
      setId: b.setId,
      code: b.code,
      shortCode: b.shortCode,
      sonicTag: b.sonicTag,
      durationSec: b.durationSec,
      durationFormatted: b.durationFormatted,
      positionSec: b.positionSec,
      positionFormatted: b.positionFormatted,
      progress: b.progress,
      startsInSec: b.startsInSec,
      nextSetId: b.nextSetId,
      nextCode: b.nextCode,
      nextShortCode: b.nextShortCode,
      nextSonicTag: b.nextSonicTag,
      streamUrl: b.streamUrl,
    };
  });

  return {
    ok: true,
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

/**
 * Handles Auth Login (both custom callsign + PIN and 1-click fast guest login)
 */
function handleLoginRequest(req, res, body, forceGuest = false) {
  const ip = getClientIp(req);
  const rl = checkRateLimit('login', ip);
  if (!rl.allowed) {
    return sendJson(res, 429, { ok: false, error: rl.error });
  }

  // Honeypot anti-bot verification
  const honeypot =
    body.websiteHoneypot ?? body.website ?? body.honeypot ?? body.companyUrl ?? '';
  if (typeof honeypot === 'string' && honeypot.trim().length > 0) {
    return sendJson(res, 403, { ok: false, error: 'Не удалось пройти проверку входа. Попробуйте ещё раз.' });
  }

  // Verify PoW challenge
  const powCheck = verifyChallenge(body.challengeId, body.nonce);
  if (!powCheck.ok) {
    return sendJson(res, 403, { ok: false, error: 'Не удалось проверить вход. Попробуйте ещё раз.' });
  }

  const isGuestMode =
    forceGuest ||
    Boolean(body.guest) ||
    Boolean(body.isGuest) ||
    body.mode === 'guest';

  if (isGuestMode) {
    const callsign = generateUniqueGuestCallsign();
    const generatedPin = crypto.randomBytes(32).toString('hex');
    const avatarColor = sanitizeAvatarColor(body.avatarColor);
    const { hash, salt } = hashPin(generatedPin);
    const id = `u-${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();

    db.prepare(
      `INSERT INTO users (
        id, callsign, pin_hash, pin_salt, avatar_color, is_guest, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(id, callsign, hash, salt, avatarColor, now, now);

    const user = { id, callsign, avatarColor, isGuest: true };
    const token = signToken(user);
    const session = { id, callsign, avatarColor, token, powVerified: true };
    return sendJson(res, 200, {
      ok: true,
      isNew: true,
      isGuest: true,
      token,
      user,
      session,
    });
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
  if (!accountLimit.allowed) return sendJson(res, 429, { ok: false, ...accountLimit });
  if (existing && (existing.is_guest || existing.id.startsWith('u-seed-'))) {
    return sendJson(res, 401, { ok: false, error: 'Это имя недоступно. Выберите другое или войдите гостем.' });
  }

  const now = Date.now();

  if (!existing) {
    const avatarColor = sanitizeAvatarColor(body.avatarColor);
    const { hash, salt } = hashPin(rawPin);
    const id = `u-${crypto.randomBytes(8).toString('hex')}`;

    db.prepare(
      `INSERT INTO users (
        id, callsign, pin_hash, pin_salt, avatar_color, is_guest, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(id, callsign, hash, salt, avatarColor, now, now);

    const user = { id, callsign, avatarColor, isGuest: false };
    const token = signToken(user);
    const session = { id, callsign, avatarColor, token, powVerified: true };
    return sendJson(res, 200, {
      ok: true,
      isNew: true,
      isGuest: false,
      token,
      user,
      session,
    });
  }

  // Existing user -> check PIN
  if (!verifyPin(rawPin, existing.pin_hash, existing.pin_salt)) {
    return sendJson(res, 401, {
      ok: false,
      error: 'Имя занято или PIN-код не подходит.',
    });
  }

  const nextColor =
    typeof body.avatarColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.avatarColor)
      ? body.avatarColor
      : existing.avatar_color;

  db.prepare(`UPDATE users SET last_seen_at = ?, avatar_color = ? WHERE id = ?`).run(
    now,
    nextColor,
    existing.id
  );

  const user = {
    id: existing.id,
    callsign: existing.callsign,
    avatarColor: nextColor,
    isGuest: Boolean(existing.is_guest),
  };
  const token = signToken(user);
  const session = {
    id: user.id,
    callsign: user.callsign,
    avatarColor: user.avatarColor,
    token,
    powVerified: true,
  };

  return sendJson(res, 200, {
    ok: true,
    isNew: false,
    isGuest: user.isGuest,
    token,
    user,
    session,
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      return res.end();
    }

    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const ip = getClientIp(req);

    // 1. Health & status
    if (pathname === '/api/health' && req.method === 'GET') {
      const setsCount = db.prepare(`SELECT COUNT(*) AS cnt FROM sets`).get().cnt;
      return sendJson(res, 200, {
        ok: true,
        service: 'RADIOTV Live Broadcast Server',
        setsCount,
        channels: CHANNEL_IDS,
        serverTime: Date.now(),
      });
    }

    // 2. GET /api/auth/challenge
    if (pathname === '/api/auth/challenge' && req.method === 'GET') {
      const challenge = createChallenge(3);
      return sendJson(res, 200, {
        ok: true,
        ...challenge,
        avatarPalette: AVATAR_PALETTE,
      });
    }

    // 3. POST /api/auth/login & POST /api/auth/guest
    if (
      (pathname === '/api/auth/login' || pathname === '/api/auth/guest') &&
      req.method === 'POST'
    ) {
      const body = await readJsonBody(req);
      return handleLoginRequest(req, res, body, pathname === '/api/auth/guest');
    }

    // 4. GET /api/auth/me
    if (pathname === '/api/auth/me' && req.method === 'GET') {
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

    // 5. GET /api/radio/state
    if (pathname === '/api/radio/state' && req.method === 'GET') {
      const channelId =
        urlObj.searchParams.get('channel') ||
        urlObj.searchParams.get('channelId') ||
        'ch-main';
      const payload = buildRadioStatePayload(channelId);
      return sendJson(res, 200, payload);
    }

    // 6. GET /api/radio/channels
    if (pathname === '/api/radio/channels' && req.method === 'GET') {
      const payload = buildRadioStatePayload('ch-main');
      return sendJson(res, 200, {
        ok: true,
        serverTime: payload.serverTime,
        channels: payload.channels,
        totalListenersCount: payload.totalListenersCount,
      });
    }

    // 7. GET /api/radio/events (SSE stream)
    if (pathname === '/api/radio/events' && req.method === 'GET') {
      const channelId =
        urlObj.searchParams.get('channel') ||
        urlObj.searchParams.get('channelId') ||
        'ch-main';

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
        channelId: CHANNELS[channelId] ? channelId : 'ch-main',
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

      broadcastSse('listeners:update', {
          channelId: client.channelId,
        listenersCount: getListenersCount(client.channelId),
        totalListenersCount: getTotalListenersCount(),
      });

      req.on('close', () => {
        sseClients.delete(client);
        broadcastSse('listeners:update', {
          channelId: client.channelId,
          listenersCount: getListenersCount(client.channelId),
          totalListenersCount: getTotalListenersCount(),
        });
      });
      return;
    }

    // 8. GET /api/radio/stream/:channelId
    const streamChMatch = /^\/api\/radio\/stream\/([^/]+)$/.exec(pathname);
    if (
      (streamChMatch || pathname === '/api/radio/stream') &&
      (req.method === 'GET' || req.method === 'HEAD')
    ) {
      const rawCh = streamChMatch
        ? decodeURIComponent(streamChMatch[1])
        : urlObj.searchParams.get('channel') || 'ch-main';

      // Support passing either a channelId (`ch-main`) or a setId (`s-001`)
      let setRow = null;
      if (CHANNELS[rawCh]) {
        const broadcast = getCurrentBroadcast(rawCh);
        setRow = getInternalSetById(broadcast.setId);
      } else {
        setRow = getInternalSetById(rawCh);
        if (!setRow) {
          const broadcast = getCurrentBroadcast('ch-main');
          setRow = getInternalSetById(broadcast.setId);
        }
      }
      return await streamAudioFile(req, res, setRow);
    }

    // 9. GET /api/radio/stream-set/:setId
    const streamSetMatch = /^\/api\/radio\/stream-set\/([^/]+)$/.exec(pathname);
    if (streamSetMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const rawSetId = decodeURIComponent(streamSetMatch[1]);
      const setRow = getInternalSetById(rawSetId);
      return await streamAudioFile(req, res, setRow);
    }

    // 10. POST /api/radio/moments (Add reaction / comment marker on waveform)
    if (pathname === '/api/radio/moments' && req.method === 'POST') {
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

      const reactionType =
        sanitizeReactionType(body.type || body.reactionType) || 'fire';
      const comment = sanitizeText(body.comment ?? body.text ?? '', 140);
      const channelId = CHANNELS[body.channelId || body.channel]
        ? body.channelId || body.channel
        : 'ch-main';
      const broadcast = getCurrentBroadcast(channelId);
      const setId = body.setId || broadcast.setId;
      if (!getInternalSetById(setId)) return sendJson(res, 404, { ok: false, error: 'Сет не найден' });
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

    // 11. POST /api/radio/moments/:id/react (Plus/support a waveform moment)
    const momentReactMatch = /^\/api\/radio\/moments\/(\d+)\/react$/.exec(pathname);
    if (momentReactMatch && req.method === 'POST') {
      const momentId = Number(momentReactMatch[1]);
      const body = await readJsonBody(req);
      const authUser = extractAuthUser(req, body);
      if (!authUser) return sendJson(res, 401, { ok: false, error: 'Сессия недействительна' });
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

    // 12. POST /api/radio/chat (Send message in live chat)
    if (pathname === '/api/radio/chat' && req.method === 'POST') {
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

      const text = sanitizeText(body.text ?? body.message ?? body.content ?? '', 280);
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

      const channelId = CHANNELS[body.channelId || body.channel]
        ? body.channelId || body.channel
        : 'ch-main';

      const message = createChatMessage({
        channelId,
        userId: authUser.uid,
        callsign: authUser.callsign,
        avatarColor: authUser.avatarColor,
        text,
      });

      broadcastSse('chat:message', {
        channelId,
        message,
      });

      return sendJson(res, 201, {
        ok: true,
        message,
      });
    }

    // 13. POST /api/radio/chat/:id/react (React to a chat message)
    const chatReactMatch = /^\/api\/radio\/chat\/(\d+)\/react$/.exec(pathname);
    if (chatReactMatch && req.method === 'POST') {
      const messageId = Number(chatReactMatch[1]);
      const body = await readJsonBody(req);
      const authUser = extractAuthUser(req, body);
      if (!authUser) return sendJson(res, 401, { ok: false, error: 'Сессия недействительна' });
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

      const result = reactToChatMessage({
        messageId,
        userId,
        reactionType,
      });

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

      return sendJson(res, 200, {
        ok: true,
        ...result,
      });
    }

    // 14. GET /api/radio/archive (Anonymous list of indexed sets, zero track-id leak)
    if (pathname === '/api/radio/archive' && req.method === 'GET') {
      const rows = getAvailableSets();
      return sendJson(res, 200, {
        ok: true,
        total: rows.length,
        sets: rows.map(sanitizeSetRow),
      });
    }

    // 15. Static file serving for the published dist/ and public/ roots.
    if (req.method === 'GET' || req.method === 'HEAD') {
      const projectRoot = path.resolve(__dirname, '..');
      const mimeMap = {
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

      const resolved = resolvePublicFile(projectRoot, pathname);
      if (resolved) {
        const content = fs.readFileSync(resolved);
        setCorsHeaders(res);
        res.writeHead(200, {
          'Content-Type': mimeMap[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
          'Content-Length': content.length,
        });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
    }

    return sendJson(res, 404, {
      ok: false,
      error: 'Запрошенный адрес не найден.',
    });
  } catch (err) {
    return sendJson(res, 500, {
      ok: false,
      error: 'Не удалось выполнить действие. Попробуйте ещё раз.',
    });
  }
});

// Periodic broadcast sync tick over SSE every 8 seconds
const syncInterval = setInterval(() => {
  if (sseClients.size === 0) return;
  const now = Date.now();
  const channelsSummary = CHANNEL_IDS.map((id) => {
    const b = getCurrentBroadcast(id, now);
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
}, 8000);
syncInterval.unref();

async function bootstrap() {
  const t0 = Date.now();
  const totalSets = await scanAndSyncSets();
  const elapsed = Date.now() - t0;

  server.listen(PORT, process.env.RADIOTV_HOST || '127.0.0.1', () => {
    console.log(
      `[RADIOTV] Live Broadcast Server listening on http://localhost:${PORT} (${totalSets} anonymized sets indexed in ${elapsed}ms)`
    );
  });
}

bootstrap().catch((err) => {
  console.error('[RADIOTV] Failed to start server:', err);
  process.exit(1);
});
