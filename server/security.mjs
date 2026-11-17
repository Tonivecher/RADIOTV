import crypto from 'node:crypto';
import { isIP } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRET_FILE = path.join(__dirname, '.secret');
const MIN_SECRET_LENGTH = 32;

const DEFAULT_POW_DIFFICULTY = 3;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_SIG_LENGTH = 24;
const MAX_USED_CHALLENGES = 5000;
const MAX_NONCE_LENGTH = 64;

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PIN_SALT_BYTES = 16;
const PIN_SCRYPT_KEYLEN = 64;

const RATE_LIMIT_TTL_MS = 600_000;
const RATE_LIMIT_PRUNE_THRESHOLD = 10_000;
const CHAT_SPAM_WINDOW_MS = 60_000;
const CHAT_SPAM_PRUNE_THRESHOLD = 1000;
const CHAT_SPAM_PRUNE_INTERVAL_MS = 600_000;
const MAX_XFF_HOPS = 10;

function loadOrCreateSecret() {
  if (process.env.RADIOTV_SECRET) {
    return process.env.RADIOTV_SECRET;
  }
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const val = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (val.length >= MIN_SECRET_LENGTH) {
        return val;
      }
    }
  } catch {
    // ignore read error
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  } catch {
    // ignore write error
  }
  return generated;
}

const SERVER_SECRET = loadOrCreateSecret();

const ALLOWED_REACTIONS = [
  'fire',
  'hypnotic',
  'subbass',
  'goosebumps',
  'acid',
  'heart',
];

export const REACTION_META = {
  fire: { id: 'fire', label: 'PEAK', symbol: '🔥', color: '#ff5a26' },
  hypnotic: { id: 'hypnotic', label: 'HYPNOTIC', symbol: '🌀', color: '#a78bfa' },
  subbass: { id: 'subbass', label: 'SUB-BASS', symbol: '🔊', color: '#38bdf8' },
  goosebumps: { id: 'goosebumps', label: 'CHILLS', symbol: '⚡', color: '#facc15' },
  acid: { id: 'acid', label: '303 / ACID', symbol: '🧪', color: '#4ade80' },
  heart: { id: 'heart', label: 'DEEP LOVE', symbol: '❤️', color: '#f43f5e' },
};

export const AVATAR_PALETTE = [
  '#E85D2A',
  '#38BDF8',
  '#A78BFA',
  '#4ADE80',
  '#FACC15',
  '#F43F5E',
  '#2DD4BF',
  '#FB923C',
  '#818CF8',
  '#E879F9',
];

// Active PoW challenges and used challenge IDs mapped to expiration timestamp
const activeChallenges = new Map();
const usedChallenges = new Map();

function cleanupChallenges(now = Date.now()) {
  for (const [id, data] of activeChallenges.entries()) {
    if (data.expiresAt < now) {
      activeChallenges.delete(id);
    }
  }
  for (const [id, expiresAt] of usedChallenges.entries()) {
    if (expiresAt < now) {
      usedChallenges.delete(id);
    }
  }
  while (usedChallenges.size > MAX_USED_CHALLENGES) {
    const oldestKey = usedChallenges.keys().next().value;
    usedChallenges.delete(oldestKey);
  }
}

function hmacDigest(payload, encoding = 'hex') {
  return crypto.createHmac('sha256', SERVER_SECRET).update(payload).digest(encoding);
}

function timingSafeEqualStrings(aStr, bStr, encoding = 'utf8') {
  if (typeof aStr !== 'string' || typeof bStr !== 'string') {
    return false;
  }
  try {
    const a = Buffer.from(aStr, encoding);
    const b = Buffer.from(bStr, encoding);
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Generates a cryptographic PoW challenge with difficulty 3 ('000' hex prefix)
 * and a signed HMAC timestamp token embedded in challengeId.
 */
export function createChallenge(difficulty = DEFAULT_POW_DIFFICULTY) {
  const now = Date.now();
  cleanupChallenges(now);

  const nonceId = crypto.randomBytes(6).toString('hex');
  const prefix = crypto.randomBytes(12).toString('hex');
  const expiresAt = now + CHALLENGE_TTL_MS;
  const rawData = `${nonceId}.${prefix}.${difficulty}.${expiresAt}`;
  const sig = hmacDigest(rawData, 'hex').slice(0, CHALLENGE_SIG_LENGTH);
  const challengeId = `${rawData}.${sig}`;

  activeChallenges.set(challengeId, {
    prefix,
    difficulty,
    expiresAt,
    used: false,
  });

  return {
    challengeId,
    prefix,
    difficulty,
    target: '0'.repeat(difficulty),
    expiresAt,
  };
}

/**
 * Verifies a PoW challenge solution: sha256(prefix + nonce).startsWith('0'.repeat(difficulty))
 */
export function verifyChallenge(challengeId, nonce) {
  if (!challengeId || typeof challengeId !== 'string') {
    return { ok: false, error: 'Отсутствует идентификатор PoW-челленджа' };
  }
  if (
    nonce === undefined ||
    nonce === null ||
    String(nonce).length > MAX_NONCE_LENGTH
  ) {
    return { ok: false, error: 'Некорректный nonce PoW-челленджа' };
  }
  if (usedChallenges.has(challengeId)) {
    return { ok: false, error: 'Челлендж уже использован, запросите новый' };
  }

  let prefix = '';
  let difficulty = DEFAULT_POW_DIFFICULTY;
  let expiresAt = 0;

  const stored = activeChallenges.get(challengeId);
  if (stored) {
    if (stored.used) {
      return { ok: false, error: 'Челлендж уже использован' };
    }
    prefix = stored.prefix;
    difficulty = stored.difficulty;
    expiresAt = stored.expiresAt;
  } else {
    const parts = challengeId.split('.');
    if (parts.length !== 5) {
      return { ok: false, error: 'Недействительный формат челленджа' };
    }
    const [nonceId, pfx, diffStr, expStr, sig] = parts;
    const rawData = `${nonceId}.${pfx}.${diffStr}.${expStr}`;
    const expectedSig = hmacDigest(rawData, 'hex').slice(0, CHALLENGE_SIG_LENGTH);
    if (!timingSafeEqualStrings(sig, expectedSig, 'utf8')) {
      return { ok: false, error: 'Неверная подпись челленджа' };
    }
    prefix = pfx;
    difficulty = Number(diffStr) || DEFAULT_POW_DIFFICULTY;
    expiresAt = Number(expStr) || 0;
  }

  if (Date.now() > expiresAt) {
    activeChallenges.delete(challengeId);
    return { ok: false, error: 'Время челленджа истекло, обновите подключение' };
  }

  const target = '0'.repeat(difficulty);
  const hash = crypto
    .createHash('sha256')
    .update(prefix + String(nonce))
    .digest('hex');

  if (!hash.startsWith(target)) {
    return { ok: false, error: 'PoW-проверка не пройдена' };
  }

  if (stored) {
    stored.used = true;
    activeChallenges.delete(challengeId);
  }
  usedChallenges.set(challengeId, expiresAt);

  return { ok: true, hash };
}

/**
 * PIN hashing & verification via node:crypto scryptSync
 */
export function hashPin(pin, existingSalt = null) {
  const salt = existingSalt || crypto.randomBytes(PIN_SALT_BYTES).toString('hex');
  const hash = crypto
    .scryptSync(String(pin), salt, PIN_SCRYPT_KEYLEN)
    .toString('hex');
  return { hash, salt };
}

export function verifyPin(pin, storedHash, storedSalt) {
  try {
    const { hash } = hashPin(pin, storedSalt);
    return timingSafeEqualStrings(hash, storedHash, 'hex');
  } catch {
    return false;
  }
}

/**
 * HMAC-signed stateless session token
 */
export function signToken(user) {
  const now = Date.now();
  const payload = {
    uid: user.id,
    callsign: user.callsign,
    avatarColor: user.avatarColor || user.avatar_color || '#E85D2A',
    isGuest: Boolean(user.isGuest || user.is_guest),
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = hmacDigest(encoded, 'base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;
  const expectedSig = hmacDigest(encoded, 'base64url');
  if (!timingSafeEqualStrings(sig, expectedSig, 'utf8')) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    );
    if (
      !payload.uid ||
      !payload.callsign ||
      (payload.exp && Date.now() > payload.exp)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function extractAuthUser(req, body = null) {
  let rawToken = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawToken = authHeader.slice(7).trim();
  } else if (req.headers['x-auth-token']) {
    rawToken = String(req.headers['x-auth-token']).trim();
  } else if (req.headers['x-session-token']) {
    rawToken = String(req.headers['x-session-token']).trim();
  } else if (body && typeof body.token === 'string') {
    rawToken = body.token.trim();
  }
  if (!rawToken) return null;
  return verifyToken(rawToken);
}

/**
 * Sanitizers
 */
export function sanitizeCallsign(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Укажите позывной' };
  }
  const cleaned = raw.trim().replace(/\s+/g, '_');
  if (cleaned.length < 2 || cleaned.length > 20) {
    return {
      ok: false,
      error: 'Позывной должен содержать от 2 до 20 символов',
    };
  }
  if (!/^[a-zA-Zа-яА-ЯёЁ0-9_.\-]+$/.test(cleaned)) {
    return {
      ok: false,
      error: 'Допустимы буквы, цифры, дефис, точка и подчеркивание',
    };
  }
  return { ok: true, value: cleaned };
}

export function sanitizeText(raw, maxLen = 280) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function sanitizeReactionType(raw) {
  if (typeof raw !== 'string') return null;
  const val = raw.trim().toLowerCase();
  return ALLOWED_REACTIONS.includes(val) ? val : null;
}

export function sanitizeAvatarColor(raw) {
  if (typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.trim())) {
    return raw.trim();
  }
  return AVATAR_PALETTE[Math.floor(Math.random() * AVATAR_PALETTE.length)];
}

/**
 * In-memory Token Bucket Rate Limiter + Anti-Spam
 */
const buckets = new Map();
const lastChatByUser = new Map();
let lastChatPruneAt = 0;

const BUCKET_CONFIGS = {
  api: { capacity: 120, refillPerSec: 25, minIntervalMs: 0 },
  login: { capacity: 15, refillPerSec: 1.0, minIntervalMs: 0 },
  loginAccount: { capacity: 5, refillPerSec: 1 / 300, minIntervalMs: 0 },
  chat: { capacity: 5, refillPerSec: 0.67, minIntervalMs: 1500 },
  moment: { capacity: 15, refillPerSec: 2.0, minIntervalMs: 0 },
  reaction: { capacity: 30, refillPerSec: 5.0, minIntervalMs: 0 },
};

function pruneExpiredEntries(map, now, ttlMs, getTimestamp) {
  for (const [key, entry] of map.entries()) {
    if (now - getTimestamp(entry) >= ttlMs) {
      map.delete(key);
    }
  }
}

export function checkRateLimit(type, key) {
  const cfg = BUCKET_CONFIGS[type] || BUCKET_CONFIGS.api;
  const bucketKey = `${type}:${key}`;
  const now = Date.now();

  let state = buckets.get(bucketKey);
  if (!state) {
    state = { tokens: cfg.capacity, lastRefill: now, lastAction: 0 };
    buckets.set(bucketKey, state);
  }

  const elapsedSec = Math.max(0, (now - state.lastRefill) / 1000);
  state.tokens = Math.min(cfg.capacity, state.tokens + elapsedSec * cfg.refillPerSec);
  state.lastRefill = now;

  if (cfg.minIntervalMs > 0 && now - state.lastAction < cfg.minIntervalMs) {
    const retryAfterMs = cfg.minIntervalMs - (now - state.lastAction);
    return {
      allowed: false,
      retryAfterMs,
      error: 'Слишком часто. Выдержите паузу полторы секунды.',
    };
  }

  if (state.tokens < 1) {
    const retryAfterMs = Math.ceil(((1 - state.tokens) / cfg.refillPerSec) * 1000);
    return {
      allowed: false,
      retryAfterMs,
      error: 'Превышен лимит запросов. Подождите пару секунд.',
    };
  }

  state.tokens -= 1;
  state.lastAction = now;

  if (buckets.size > RATE_LIMIT_PRUNE_THRESHOLD) {
    pruneExpiredEntries(buckets, now, RATE_LIMIT_TTL_MS, (entry) => entry.lastRefill);
  }

  return { allowed: true };
}

export function checkChatSpam(userKey, text) {
  const normalized = text.toLowerCase().trim();
  const now = Date.now();
  const prev = lastChatByUser.get(userKey);

  if (
    lastChatByUser.size > CHAT_SPAM_PRUNE_THRESHOLD ||
    now - lastChatPruneAt >= CHAT_SPAM_PRUNE_INTERVAL_MS
  ) {
    lastChatPruneAt = now;
    pruneExpiredEntries(
      lastChatByUser,
      now,
      CHAT_SPAM_WINDOW_MS,
      (entry) => entry.time
    );
  }

  if (prev && prev.text === normalized && now - prev.time < CHAT_SPAM_WINDOW_MS) {
    return {
      allowed: false,
      error: 'Не дублируйте одно и то же сообщение подряд.',
    };
  }

  lastChatByUser.set(userKey, { text: normalized, time: now });
  return { allowed: true };
}

function normalizeIp(ip) {
  return String(ip || '').trim().replace(/^::ffff:/, '');
}

// Only explicitly configured proxies can supply forwarded addresses.
export function getClientIp(req) {
  const peer = normalizeIp(req.socket?.remoteAddress);
  const trusted = new Set(
    (process.env.RADIOTV_TRUSTED_PROXIES || '')
      .split(',')
      .map(normalizeIp)
      .filter(Boolean)
  );
  if (!peer || !trusted.has(peer)) {
    return peer || 'unknown';
  }

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded !== 'string') return peer;

  const hops = forwarded.split(',').map((ip) => normalizeIp(ip));
  if (hops.length > MAX_XFF_HOPS || hops.some((ip) => !isIP(ip))) {
    return peer;
  }

  for (let i = hops.length - 1; i >= 0; i--) {
    if (!trusted.has(hops[i])) {
      return hops[i];
    }
  }
  return peer;
}

export function isStrongPin(pin) {
  return (
    typeof pin === 'string' &&
    /^[0-9]{6,16}$/.test(pin) &&
    !/^(.)\1+$/.test(pin) &&
    !'01234567890123456789'.includes(pin) &&
    !'98765432109876543210'.includes(pin)
  );
}
