import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  getEvidenceFilePath,
  loadPlaywright,
  solvePow,
  writeEvidenceJson,
} from './helpers.mjs';

const { chromium } = await loadPlaywright();
const origin = process.env.RADIOTV_PUBLIC_URL || 'https://radio.tonivecher.online';
const checks = [];

const health = await (await fetch(`${origin}/api/health`)).json();
assert.equal(health.ok, true);
assert(Number.isInteger(health.setsCount) && health.setsCount > 0);
checks.push('public-health');

const blockedPaths = [
  '/src/App.tsx',
  '/package.json',
  '/server/radiotv.sqlite',
  '/server/.secret',
  '/.env',
];
for (const file of blockedPaths) {
  const response = await fetch(`${origin}${file}`, { method: 'HEAD' });
  assert.equal(response.status, 404, file);
}
checks.push('private-static-paths-blocked');

const state = await (await fetch(`${origin}/api/radio/state`)).json();
assert.equal(state.demoMode, false);
assert.equal(state.audienceMetric, 'connections');
assert(state.channels.every((channel) => Boolean(channel.setId)));

const archive = await (await fetch(`${origin}/api/radio/archive`)).json();
assert.equal(archive.total, health.setsCount);
checks.push('all-sets-available');

const allowedTags = new Set([
  'major_brand',
  'minor_version',
  'compatible_brands',
  'encoder',
  'language',
  'handler_name',
  'vendor_id',
]);

for (const channel of state.channels) {
  const url = `${origin}/api/radio/stream-set/${channel.setId}`;
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert(head.headers.get('etag'));
  assert(head.headers.get('content-disposition')?.includes('radiotv-live'));

  const range = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 1024);

  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', url],
      { encoding: 'utf8', timeout: 60000 }
    )
  );
  assert.equal(probe.streams.length, 1);
  assert.equal(probe.streams[0].codec_type, 'audio');
  assert.equal(probe.chapters?.length || 0, 0);

  for (const tags of [probe.format?.tags, ...probe.streams.map((stream) => stream.tags)]) {
    for (const key of Object.keys(tags || {})) {
      assert(allowedTags.has(key.toLowerCase()), key);
    }
  }
}
checks.push('three-public-streams-range-and-metadata');

const challenge = await (await fetch(`${origin}/api/auth/challenge`)).json();
const nonce = solvePow(challenge.prefix, challenge.difficulty);
const badLogin = await fetch(`${origin}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    callsign: 'smoke_no_create',
    pin: '0000',
    challengeId: challenge.challengeId,
    nonce,
  }),
});
assert.equal(badLogin.status, 400);
assert((await badLogin.json()).error.includes('PIN'));
checks.push('default-pin-rejected-without-writing-user');

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
});
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${origin}/`);
  const enterQuietBtn = page.locator('.moscow-intro__secondary');
  await enterQuietBtn.waitFor({ state: 'visible', timeout: 30000 });
  await enterQuietBtn.click();
  await page.locator('.moscow-intro').waitFor({ state: 'detached', timeout: 15000 });

  await page.locator('.chat-online-pill').waitFor();
  const label = await page.locator('.chat-online-pill').innerText();
  assert(label.includes('Подключения:'), `Unexpected audience label: ${label}`);

  if (fs.existsSync('dist/index.html')) {
    const scripts = await page
      .locator('script[src]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src')));
    const html = fs.readFileSync('dist/index.html', 'utf8');
    assert(scripts.some((src) => src && html.includes(src)));
  }

  await page.locator('.magnetic-cta--hero').focus();
  await page.locator('.magnetic-cta--hero').click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio');
    return Boolean(audio && !audio.paused && audio.currentTime > 0 && !audio.error);
  });

  await page.locator('.channel-lens-row').nth(1).focus();
  await page.locator('.channel-lens-row').nth(1).click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio');
    return Boolean(
      audio &&
        audio.currentSrc.includes('ch-deep') &&
        audio.readyState >= 2 &&
        !audio.error
    );
  });

  const desktopShot = getEvidenceFilePath('production-desktop.png');
  if (desktopShot) {
    await page.screenshot({ path: desktopShot, fullPage: true });
  }
  const mobileShot = getEvidenceFilePath('production-mobile.png');
  if (mobileShot) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: mobileShot, fullPage: true });
  }

  assert.deepEqual(errors, []);
  checks.push('public-browser-playback-channel-switch-and-new-bundle');
} finally {
  await browser.close();
}

const summary = {
  ok: true,
  checks,
  errors,
  completedAt: new Date().toISOString(),
};
writeEvidenceJson('public-smoke.json', summary);
console.log(JSON.stringify({ ok: true, checks, errors }));
