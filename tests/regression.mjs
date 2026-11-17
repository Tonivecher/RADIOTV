import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { solvePow } from './helpers.mjs';

const root =
  process.env.RADIOTV_TEST_DATA_DIR ||
  fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'radiotv-regression-')));

Object.assign(process.env, {
  RADIOTV_DATA_DIR: root,
  RADIOTV_SETS_DIRS: `${root}/sets:${root}/moved`,
  RADIOTV_AUDIO_CACHE: `${root}/cache`,
  RADIOTV_SECRET: 'isolated-regression-test-secret-not-production',
});

const {
  getClientIp,
  checkRateLimit,
  checkChatSpam,
  isStrongPin,
  signToken,
  hashPin,
  createChallenge,
  verifyChallenge,
} = await import('../server/security.mjs');
const {
  db,
  scanAndSyncSets,
  getAvailableSets,
  getCurrentBroadcast,
  getMomentsForSet,
  getRecentChatMessages,
  sanitizeSetRow,
} = await import('../server/db.mjs');
const { resolvePublicFile } = await import('../server/static.mjs');
const { sanitizedAudioPath, FFMPEG_BIN, FFPROBE_BIN } = await import('../server/media.mjs');
const { computeHeatmap } = await import('../server/waveform.mjs');

const base = process.env.RADIOTV_TEST_URL || 'http://127.0.0.1:44321';

async function fetchJson(url, init) {
  const response = await fetch(base + url, init);
  return { status: response.status, data: await response.json() };
}

async function login(body = {}, endpoint = 'guest') {
  const { data: challenge } = await fetchJson('/api/auth/challenge');
  const nonce = solvePow(challenge.prefix, challenge.difficulty);
  return fetchJson(`/api/auth/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      challengeId: challenge.challengeId,
      nonce,
    }),
  });
}

function postJson(url, body, token) {
  return fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

let guest;
let second;
let message;
let moment;

test('PIN defaults and weak combinations are rejected', () => {
  for (const pin of ['', '0000', '9090', '111111', '123456', '654321']) {
    assert.equal(isStrongPin(pin), false);
  }
  assert.equal(isStrongPin('372918'), true);
});

test('untrusted XFF is ignored; configured proxies are traversed from the socket', () => {
  delete process.env.RADIOTV_TRUSTED_PROXIES;
  assert.equal(
    getClientIp({
      socket: { remoteAddress: '::ffff:203.0.113.7' },
      headers: { 'x-forwarded-for': '1.2.3.4' },
    }),
    '203.0.113.7'
  );

  process.env.RADIOTV_TRUSTED_PROXIES = '127.0.0.1';
  assert.equal(
    getClientIp({
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' },
    }),
    '203.0.113.9'
  );
  assert.equal(
    getClientIp({
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-for': 'garbage' },
    }),
    '127.0.0.1'
  );
  delete process.env.RADIOTV_TRUSTED_PROXIES;
});

test('account limiter is independent of changing IP', () => {
  for (let i = 0; i < 5; i += 1) {
    assert.equal(checkRateLimit('loginAccount', 'same-account').allowed, true);
  }
  assert.equal(checkRateLimit('loginAccount', 'same-account').allowed, false);
  assert.equal(checkRateLimit('loginAccount', 'another-account').allowed, true);
});

test('static roots, hidden names, traversal and escaping symlinks', () => {
  const dir = path.join(root, 'static-check');
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'), 'ok');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'private');
  fs.writeFileSync(path.join(dir, 'public', '.env'), 'private');
  try {
    fs.symlinkSync('../secret.txt', path.join(dir, 'public', 'escape'));
  } catch {
    // Symlink creation may require elevated privileges on some filesystems
  }

  assert.equal(
    resolvePublicFile(dir, '/'),
    path.join(fs.realpathSync(dir), 'dist', 'index.html')
  );
  const blockedUrls = [
    '/secret.txt',
    '/.env',
    '/%2eenv',
    '/../secret.txt',
    '/escape',
    '/src/App.tsx',
    '/package.json',
  ];
  for (const url of blockedUrls) {
    assert.equal(resolvePublicFile(dir, url), null, url);
  }
});

test('all supported containers lose title/artist; decoded audio and original bytes survive', async () => {
  const formatsDir = path.join(root, 'formats');
  fs.mkdirSync(formatsDir, { recursive: true });

  const fileHash = (filePath) =>
    crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  const audioHash = (filePath) =>
    execFileSync(
      FFMPEG_BIN,
      ['-v', 'error', '-i', filePath, '-map', '0:a:0', '-f', 'hash', '-hash', 'sha256', '-'],
      { encoding: 'utf8' }
    ).trim();

  for (const ext of ['wav', 'mp3', 'm4a', 'flac', 'aiff', 'ogg']) {
    const src = path.join(formatsDir, `private-name.${ext}`);
    execFileSync(FFMPEG_BIN, [
      '-nostdin',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=333:duration=1',
      '-metadata',
      'title=RADIOTV_CANARY_TITLE',
      '-metadata',
      'artist=RADIOTV_CANARY_ARTIST',
      '-y',
      src,
    ]);

    const before = fileHash(src);
    const clean = await sanitizedAudioPath(src);
    assert.notEqual(clean, src);
    assert.equal(fileHash(src), before);

    const info = execFileSync(
      FFPROBE_BIN,
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', clean],
      { encoding: 'utf8' }
    );
    assert(!info.includes('RADIOTV_CANARY_'), ext);
    assert(!fs.readFileSync(clean).includes(Buffer.from('RADIOTV_CANARY_')), ext);
    assert.equal(audioHash(clean), audioHash(src), ext);
  }
});

test('new database has no fabricated users, moments, messages or listeners', async () => {
  const { data } = await fetchJson('/api/radio/state');
  assert.equal(data.demoMode, false);
  assert.equal(data.audienceMetric, 'connections');
  assert.equal(data.listenersCount, 0);
  assert.equal(data.messages.length, 0);
  assert.equal(data.moments.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('API contracts expose demoMode=false, audienceMetric=connections, and consistent archive counts', async () => {
  const [{ status: healthStatus, data: health }, { status: archiveStatus, data: archive }, { status: chStatus, data: channels }] =
    await Promise.all([
      fetchJson('/api/health'),
      fetchJson('/api/radio/archive'),
      fetchJson('/api/radio/channels'),
    ]);

  assert.equal(healthStatus, 200);
  assert.equal(health.ok, true);
  assert.equal(health.setsCount, 3);

  assert.equal(archiveStatus, 200);
  assert.equal(archive.ok, true);
  assert.equal(archive.total, health.setsCount);
  assert.equal(archive.sets.length, health.setsCount);
  for (const setItem of archive.sets) {
    assert.equal(setItem.filepath, undefined);
    assert.equal(setItem.original_name, undefined);
  }

  assert.equal(chStatus, 200);
  assert.equal(channels.ok, true);
  assert.equal(channels.channels.length, 3);
});

test('verifyChallenge rejects tampered HMAC signatures, invalid formats, bad nonces, and replays', () => {
  const ch = createChallenge(3);
  const nonce = solvePow(ch.prefix, ch.difficulty);

  // Tampering with the trailing HMAC signature forces stateless validation and must fail
  const parts = ch.challengeId.split('.');
  assert.equal(parts.length, 5);
  const badSig = (parts[4][0] === 'a' ? 'b' : 'a') + parts[4].slice(1);
  const tamperedSigId = [...parts.slice(0, 4), badSig].join('.');
  assert.equal(verifyChallenge(tamperedSigId, nonce).ok, false);

  // Tampering with signed payload (expiry) also fails signature verification
  const tamperedPayloadId = [
    parts[0],
    parts[1],
    parts[2],
    String(Number(parts[3]) + 60_000),
    parts[4],
  ].join('.');
  assert.equal(verifyChallenge(tamperedPayloadId, nonce).ok, false);

  // Missing / malformed challengeId or oversized nonce is rejected
  assert.equal(verifyChallenge('', nonce).ok, false);
  assert.equal(verifyChallenge('malformed.id', nonce).ok, false);
  assert.equal(verifyChallenge(ch.challengeId, 'x'.repeat(65)).ok, false);
  assert.equal(verifyChallenge(ch.challengeId, 'definitely-wrong-nonce').ok, false);

  // Valid solution succeeds once and replay is rejected
  assert.equal(verifyChallenge(ch.challengeId, nonce).ok, true);
  assert.equal(verifyChallenge(ch.challengeId, nonce).ok, false);
});

test('computeHeatmap normalizes reaction density and handles edge cases', () => {
  assert.deepEqual(computeHeatmap([], 100, 0), []);
  assert.deepEqual(computeHeatmap([], 0, 5), [0, 0, 0, 0, 0]);
  assert.deepEqual(computeHeatmap([], 120, 4), [0, 0, 0, 0]);

  const single = computeHeatmap([{ timestampSec: 60, likesCount: 0 }], 120, 12);
  assert.equal(single.length, 12);
  assert.equal(single[6], 1);
  assert.equal(single[5], 0.45);
  assert.equal(single[7], 0.45);
  assert.equal(single[4], 0.15);
  assert.equal(single[8], 0.15);
  assert.equal(single[0], 0);

  const weighted = computeHeatmap(
    [
      { timestampSec: 10, likesCount: 0 },
      { timestampSec: 90, likesCount: 10 },
    ],
    100,
    10
  );
  assert.equal(weighted[9], 1);
  assert(weighted[1] < weighted[9]);
});

test('sanitizeSetRow strips internal paths and original filenames', () => {
  assert.equal(sanitizeSetRow(null), null);

  const sanitized = sanitizeSetRow({
    id: 's-001',
    seq_num: 1,
    code: 'Эфир S-001',
    short_code: 'S-001',
    channel_id: 'ch-main',
    filepath: '/secret/server/sets/01. Secret Artist - Track.wav',
    original_name: '01. Secret Artist - Track.wav',
    dedup_key: '123456:secret artist - track',
    file_size: 123456,
    mime_type: 'audio/wav',
    ext: '.wav',
    duration_sec: 3665,
    waveform_json: '[0.1,0.2]',
  });

  assert.deepEqual(sanitized, {
    id: 's-001',
    setId: 's-001',
    seqNum: 1,
    code: 'Эфир S-001',
    shortCode: 'S-001',
    channelId: 'ch-main',
    frequency: '',
    sonicTag: 'Deep-tech и tech',
    durationSec: 3665,
    durationFormatted: '1:01:05',
  });
  assert.equal('filepath' in sanitized, false);
  assert.equal('original_name' in sanitized, false);
  assert.equal('dedup_key' in sanitized, false);
});

test('checkChatSpam blocks immediate duplicate messages per user', () => {
  assert.equal(checkChatSpam('u-spam-1', 'Hello Ether').allowed, true);
  assert.equal(checkChatSpam('u-spam-1', '  hello ether  ').allowed, false);
  assert.equal(checkChatSpam('u-spam-2', 'Hello Ether').allowed, true);
  assert.equal(checkChatSpam('u-spam-1', 'Next track hits').allowed, true);
});

test('guest is unique session-only; missing PIN and seeded identities cannot log in', async () => {
  guest = (await login()).data;
  second = (await login()).data;
  assert(guest.session.token);
  assert(guest.user.isGuest);
  assert.notEqual(guest.user.id, second.user.id);
  assert.equal(guest.generatedPin, undefined);

  assert.equal((await login({ callsign: 'no_pin' }, 'login')).status, 400);
  assert.equal(
    (await login({ callsign: guest.user.callsign, pin: '372918' }, 'login')).status,
    401
  );

  const pin = hashPin('372918');
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,0,?,?)').run(
    'u-seed-test',
    'seed_test',
    pin.hash,
    pin.salt,
    '#123456',
    Date.now(),
    Date.now()
  );
  assert.equal(
    (await login({ callsign: 'seed_test', pin: '372918' }, 'login')).status,
    401
  );

  const token = signToken({ id: 'u-seed-test', callsign: 'seed_test' });
  const meResponse = await fetchJson('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(meResponse.status, 401);

  const normal = await login({ callsign: 'normal_test', pin: '372918' }, 'login');
  assert.equal(normal.status, 200);
  assert.equal(
    (await login({ callsign: 'normal_test', pin: '372918' }, 'login')).data.user.id,
    normal.data.user.id
  );
});

test('API stores server IDs; unauthorized writes fail; reactions toggle and likes deduplicate', async () => {
  const tok = guest.token;
  const state = (await fetchJson('/api/radio/state')).data;
  assert.equal((await postJson('/api/radio/chat', { text: 'unauthorized' }, 'bad')).status, 401);

  let response = await postJson(
    '/api/radio/chat',
    { text: 'Server integration message' },
    tok
  );
  assert.equal(response.status, 201);
  message = response.data.message;
  assert(message.id > 0 && message.id < 1e10);

  response = await postJson(
    '/api/radio/moments',
    {
      setId: state.setId,
      timestampSec: 12,
      reactionType: 'heart',
      comment: 'Integration moment',
    },
    tok
  );
  assert.equal(response.status, 201);
  moment = response.data.moment;

  response = await postJson(
    `/api/radio/chat/${message.id}/react`,
    { reactionType: 'heart' },
    tok
  );
  assert.equal(response.data.reactions.heart, 1);

  response = await postJson(
    `/api/radio/chat/${message.id}/react`,
    { reactionType: 'heart' },
    tok
  );
  assert.equal(response.data.reactions.heart, undefined);

  response = await postJson(`/api/radio/moments/${moment.id}/react`, {}, second.token);
  const initialLikes = response.data.moment.likesCount;

  response = await postJson(`/api/radio/moments/${moment.id}/react`, {}, second.token);
  assert.equal(response.data.alreadyLiked, true);
  assert.equal(response.data.moment.likesCount, initialLikes);

  assert.equal((await postJson('/api/radio/moments', { setId: 'missing' }, tok)).status, 404);
});

test('SSE emits one canonical named frame and truthful connection counts', async () => {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/radio/events?channel=ch-deep`, {
    signal: controller.signal,
  });
  const reader = res.body.getReader();
  let frames = '';

  const consume = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        frames += new TextDecoder().decode(value);
      }
    } catch {
      // Expected AbortError when controller aborts in finally
    }
  })();

  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await fetchJson('/api/radio/state?channel=ch-deep')).data.listenersCount, 1);
    assert.equal((await fetchJson('/api/radio/state?channel=ch-main')).data.listenersCount, 0);

    await postJson(
      `/api/radio/chat/${message.id}/react`,
      { reactionType: 'fire' },
      second.token
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const social = frames
      .split('\n\n')
      .filter((frame) => frame.includes('"type":"chat:reaction"'));
    assert.equal(social.length, 1);
    assert(social[0].includes('event: chat:reaction'));
  } finally {
    controller.abort();
    await consume;
  }
});

test('stream GET/HEAD/Range serve sanitized bytes; missing original never falls back', async () => {
  const set = db.prepare('SELECT * FROM sets ORDER BY seq_num LIMIT 1').get();
  const url = `${base}/api/radio/stream-set/${set.id}`;

  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert(head.headers.get('content-disposition').includes('radiotv-live.wav'));
  assert(head.headers.get('etag'));

  const staleIfRange = await fetch(url, {
    method: 'HEAD',
    headers: { Range: 'bytes=0-99', 'If-Range': '"old-audio"' },
  });
  assert.equal(staleIfRange.status, 200);

  const invalidRangeHead = await fetch(url, {
    method: 'HEAD',
    headers: { Range: 'bytes=-' },
  });
  assert.equal(invalidRangeHead.status, 416);

  const range = await fetch(url, { headers: { Range: 'bytes=0-4095' } });
  assert.equal(range.status, 206);
  const bytes = Buffer.from(await range.arrayBuffer());
  assert.equal(bytes.length, 4096);
  assert(!bytes.includes(Buffer.from('RADIOTV_CANARY')));

  const outOfRange = await fetch(url, { headers: { Range: 'bytes=999999999-' } });
  assert.equal(outOfRange.status, 416);

  const removed = `${set.filepath}.offline`;
  fs.renameSync(set.filepath, removed);
  try {
    assert.equal((await fetch(url)).status, 404);
  } finally {
    fs.renameSync(removed, set.filepath);
  }
});

test('rescan repairs moved paths without changing IDs or social records; missing sets leave rotation', async () => {
  const rows = getAvailableSets();
  const set = rows[0];
  const target = path.join(root, 'moved', path.basename(set.filepath));
  const beforeMoments = db.prepare('SELECT COUNT(*) AS n FROM waveform_moments').get().n;

  fs.renameSync(set.filepath, target);
  await scanAndSyncSets();

  assert.equal(
    db.prepare('SELECT filepath FROM sets WHERE id = ?').get(set.id).filepath,
    target
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sets').get().n, 3);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM waveform_moments').get().n,
    beforeMoments
  );

  const offlineTarget = `${target}.offline`;
  fs.renameSync(target, offlineTarget);
  try {
    assert(!getAvailableSets().some((item) => item.id === set.id));
    for (const ch of ['ch-main', 'ch-deep', 'ch-afterglow']) {
      assert.notEqual(getCurrentBroadcast(ch).setId, set.id);
    }
  } finally {
    fs.renameSync(offlineTarget, target);
  }
});

test('legacy demo rows survive but are hidden from normal API reads', () => {
  const now = Date.now();
  const set = getAvailableSets()[0];

  db.prepare(
    `INSERT INTO waveform_moments(
      set_id, user_id, callsign, avatar_color, timestamp_sec,
      reaction_type, comment, likes_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(set.id, 'u-seed-test', 'seed_test', '#123456', 1, 'fire', 'demo', 90, now);

  db.prepare(
    `INSERT INTO chat_messages(
      channel_id, user_id, callsign, avatar_color, text,
      set_id, set_code, set_timestamp_sec, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('ch-main', 'u-seed-test', 'seed_test', '#123456', 'demo', set.id, set.code, 1, now);

  assert(!getMomentsForSet(set.id).some((item) => item.userId === 'u-seed-test'));
  assert(!getRecentChatMessages().some((item) => item.userId === 'u-seed-test'));
  assert(
    db.prepare("SELECT COUNT(*) AS n FROM waveform_moments WHERE user_id = 'u-seed-test'").get()
      .n > 0
  );
});

test('changing forged XFF does not reset HTTP login limit', async () => {
  let limited = false;
  for (let i = 0; i < 18; i += 1) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `198.51.100.${i + 1}`,
      },
      body: '{}',
    });
    if (res.status === 429) {
      limited = true;
    }
    if (limited) {
      assert.equal(res.status, 429);
    }
  }
  assert(limited);
});
