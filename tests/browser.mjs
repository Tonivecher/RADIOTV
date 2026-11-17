import assert from 'node:assert/strict';
import {
  getEvidenceFilePath,
  loadPlaywright,
  writeEvidenceJson,
} from './helpers.mjs';

const { chromium } = await loadPlaywright();
const base = process.env.RADIOTV_TEST_URL || 'http://127.0.0.1:44321';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
});

const results = [];
const errors = [];

async function check(name, fn) {
  await fn();
  results.push(name);
  console.log('PASS', name);
}

// FloatPanel pauses continuous CSS drift when focus enters the panel.
async function stableClick(locator) {
  await locator.focus();
  await locator.click();
}

async function enterEther(page) {
  await page.goto(base + '/');
  const enterQuietBtn = page.locator('.moscow-intro__secondary');
  await enterQuietBtn.waitFor({ state: 'visible', timeout: 30000 });
  await enterQuietBtn.click();
  await page.locator('.moscow-intro').waitFor({ state: 'detached', timeout: 15000 });
  await page.waitForSelector('.chat-composer__input');
}

const contextA = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const contextB = await browser.newContext({ viewport: { width: 1440, height: 1100 } });

for (const context of [contextA, contextB]) {
  await context.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(...args) {
        super(...args);
        window.__radioEvents = this;
      }
    };
  });
}

const pageA = await contextA.newPage();
const pageB = await contextB.newPage();

for (const page of [pageA, pageB]) {
  page.on('pageerror', (error) => errors.push(error.message));
}

try {
  await Promise.all([enterEther(pageA), enterEther(pageB)]);

  const chatInput = pageA.locator('.chat-composer__input');
  const sendButton = pageA.locator('.chat-composer button[type=submit]');
  const messageText = `Browser message ${Date.now()}`;

  await check('new guest + chat reaches both browsers once with database ID', async () => {
    await chatInput.fill(messageText);
    await sendButton.click();
    await pageA.waitForFunction(
      (target) =>
        [...document.querySelectorAll('.chat-entry__body')].some(
          (node) => node.textContent === target
        ),
      messageText
    );
    await pageB.waitForFunction(
      (target) =>
        [...document.querySelectorAll('.chat-entry__body')].some(
          (node) => node.textContent === target
        ),
      messageText
    );
    assert.equal(
      await pageA.locator('.chat-entry__body').filter({ hasText: messageText }).count(),
      1
    );
    assert.equal(await chatInput.inputValue(), '');
  });

  await check('reaction toggles in both browser sessions', async () => {
    const entry = pageA.locator('.chat-entry').filter({ hasText: messageText });
    await stableClick(entry.locator('.chat-react-trigger'));
    await stableClick(entry.locator('.chat-react-popover__item').first());

    await pageB
      .locator('.chat-entry')
      .filter({ hasText: messageText })
      .locator('.chat-react-chip')
      .waitFor();
    assert.equal(await entry.locator('.chat-react-chip').innerText(), '1');

    await stableClick(entry.locator('.chat-react-chip'));
    await pageB.waitForFunction(
      (target) =>
        [...document.querySelectorAll('.chat-entry')]
          .find((node) => node.textContent?.includes(target))
          ?.querySelectorAll('.chat-react-chip').length === 0,
      messageText
    );
  });

  await check('POST 429 preserves draft and adds no phantom message', async () => {
    await pageA.route('**/api/radio/chat', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Тест: лимит запросов' }),
      })
    );
    await chatInput.fill('draft-429');
    await sendButton.click();
    await pageA.getByRole('alert').filter({ hasText: 'Тест: лимит' }).waitFor();
    assert.equal(await chatInput.inputValue(), 'draft-429');
    assert.equal(
      await pageB.locator('.chat-entry__body').filter({ hasText: 'draft-429' }).count(),
      0
    );
    await pageA.unroute('**/api/radio/chat');
  });

  await check('POST 500 preserves draft and no success UI', async () => {
    await pageA.route('**/api/radio/chat', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"ok":false,"error":"Тест: сервер недоступен"}',
      })
    );
    await chatInput.fill('draft-500');
    await sendButton.click();
    await pageA.getByRole('alert').filter({ hasText: 'Тест: сервер' }).waitFor();
    assert.equal(await chatInput.inputValue(), 'draft-500');
    await pageA.unroute('**/api/radio/chat');
  });

  await check('network failure preserves draft', async () => {
    await pageA.route('**/api/radio/chat', (route) => route.abort('failed'));
    await chatInput.fill('draft-offline');
    await sendButton.click();
    await pageA.getByRole('alert').filter({ hasText: 'Нет связи' }).waitFor();
    assert.equal(await chatInput.inputValue(), 'draft-offline');
    await pageA.unroute('**/api/radio/chat');
  });

  await check('moment 500 preserves comment and does not animate success', async () => {
    await pageA.route('**/api/radio/moments', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"ok":false,"error":"Тест: отметка не сохранена"}',
      })
    );
    const input = pageA.locator('.waveform-stamp-form__input');
    await input.fill('moment-draft');
    await pageA.locator('.waveform-stamp-form button').click();
    await pageA.getByRole('alert').filter({ hasText: 'отметка не сохранена' }).waitFor();
    assert.equal(await input.inputValue(), 'moment-draft');
    await pageA.unroute('**/api/radio/moments');
  });

  await check('moment success gets stable ID and updates the second client', async () => {
    await pageA.locator('.waveform-stamp-form__input').fill('Browser marker');
    await pageA.locator('.waveform-stamp-form button').click();
    await pageA.waitForFunction(() => {
      const input = document.querySelector('.waveform-stamp-form__input');
      return input instanceof HTMLInputElement && input.value === '';
    });

    const state = await (await fetch(`${base}/api/radio/state`)).json();
    assert(state.moments.some((m) => m.comment === 'Browser marker' && m.id < 1e10));
    await pageB.locator('.waveform-stem-btn[title*="Browser marker"]').waitFor();
  });

  await check('expired session is cleared and draft remains for retry', async () => {
    await pageA.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"ok":false,"error":"Сессия истекла"}',
      })
    );
    await chatInput.fill('draft-expired');
    await sendButton.click();
    await pageA.getByRole('dialog').waitFor();
    assert.equal(await chatInput.inputValue(), 'draft-expired');
    assert.equal(
      await pageA.evaluate(() => localStorage.getItem('radiotv_session')),
      null
    );
    await pageA.unroute('**/api/auth/me');
    await stableClick(pageA.locator('.auth-modal__close'));
  });

  await check('named account requires PIN; quick login creates a separate guest', async () => {
    await stableClick(pageA.locator('.chat-header__right .glass-pill-btn'));
    const pin = pageA.locator('input[type=password]');
    assert.equal(await pin.getAttribute('required'), '');
    assert.equal(await pin.getAttribute('minlength'), '6');

    await stableClick(pageA.locator('.auth-guest-btn'));
    await pageA.getByRole('dialog').waitFor({ state: 'hidden' });
    const session = JSON.parse(
      await pageA.evaluate(() => localStorage.getItem('radiotv_session'))
    );
    assert(session.token);
    assert(!session.callsign.startsWith('selector_'));
  });

  await check('SSE reconnect refreshes messages missed while offline', async () => {
    await contextB.setOffline(true);
    const reconnectText = `Reconnect ${messageText}`;
    await chatInput.fill(reconnectText);
    await sendButton.click();
    await pageA.waitForFunction(
      (target) =>
        [...document.querySelectorAll('.chat-entry__body')].some(
          (node) => node.textContent === target
        ),
      reconnectText
    );
    await contextB.setOffline(false);
    await pageB.waitForFunction(
      (target) =>
        [...document.querySelectorAll('.chat-entry__body')].some(
          (node) => node.textContent === target
        ),
      reconnectText,
      { timeout: 20000 }
    );
  });

  await check('delayed reconnect snapshot cannot erase a newer SSE message', async () => {
    let held;
    let release;
    const captured = new Promise((resolve) => {
      held = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    await pageB.route('**/api/radio/state?*', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      held();
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    });

    await pageB.evaluate(() =>
      window.__radioEvents.dispatchEvent(new MessageEvent('connected', { data: '{}' }))
    );
    await Promise.race([
      captured,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Snapshot not requested')), 15000)
      ),
    ]);

    // Use the active session in pageA after clearing the 1.5s per-user chat interval
    const lateText = `Late snapshot ${Date.now()}`;
    await new Promise((resolve) => setTimeout(resolve, 1600));
    await chatInput.fill(lateText);
    await sendButton.click();
    await pageB.waitForFunction(
      (target) =>
        [...document.querySelectorAll('.chat-entry__body')].some(
          (node) => node.textContent === target
        ),
      lateText
    );

    const marker = `Snapshot marker ${Date.now()}`;
    const token = JSON.parse(
      await pageA.evaluate(() => localStorage.getItem('radiotv_session'))
    ).token;
    const live = await (await fetch(`${base}/api/radio/state`)).json();
    const posted = await fetch(`${base}/api/radio/moments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        setId: live.setId,
        timestampSec: 20,
        reactionType: 'fire',
        comment: marker,
      }),
    });
    assert.equal(posted.status, 201);
    const postedData = await posted.json();

    await pageB.locator('.waveform-stem-btn').filter({ has: pageB.locator('span') }).first().waitFor();
    await pageB.waitForFunction(
      (target) =>
        [...document.querySelectorAll('.waveform-stem-btn')].some((node) =>
          node.getAttribute('title')?.includes(target)
        ),
      marker
    );

    const renderedHeatmap = () =>
      pageB.evaluate(() => {
        const node = document.querySelector('.waveform-stems-layer');
        const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
        let activeFiber = node[key];
        let rootFiber = activeFiber;
        while (rootFiber?.return) {
          rootFiber = rootFiber.return;
        }
        if (
          rootFiber?.stateNode?.current &&
          rootFiber.stateNode.current !== rootFiber &&
          activeFiber?.alternate
        ) {
          activeFiber = activeFiber.alternate;
        }
        for (let fiber = activeFiber; fiber; fiber = fiber.return) {
          const props = fiber.memoizedProps;
          if (Array.isArray(props?.heatmap) && Array.isArray(props?.moments)) {
            return props.heatmap;
          }
        }
        throw new Error('Rendered waveform props not found');
      });

    assert.deepEqual(await renderedHeatmap(), postedData.heatmap);
    release();
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(await renderedHeatmap(), postedData.heatmap);
    assert.equal(
      await pageB.locator('.chat-entry__body').filter({ hasText: lateText }).count(),
      1
    );
    await pageB.unroute('**/api/radio/state?*');
  });

  await check('audio plays and channel switching reloads a decodable stream', async () => {
    await stableClick(pageA.locator('.magnetic-cta--hero'));
    await pageA.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return Boolean(audio && !audio.paused && audio.currentTime > 0 && !audio.error);
    });

    const rows = pageA.locator('.channel-lens-row');
    if ((await rows.count()) > 1) {
      await stableClick(rows.nth(1));
      await pageA.waitForFunction(() => {
        const audio = document.querySelector('audio');
        return Boolean(
          audio &&
            audio.currentSrc.includes('ch-deep') &&
            audio.readyState >= 2 &&
            !audio.error
        );
      });
    }
  });

  await check('audience label describes connections; no fabricated base count', async () => {
    const label = await pageA.locator('.chat-online-pill').innerText();
    assert(label.includes('Подключения:'), `Unexpected audience label: ${label}`);
    const state = await (await fetch(`${base}/api/radio/state`)).json();
    assert.equal(state.totalListenersCount, 2);
  });

  const desktopShot = getEvidenceFilePath('browser-desktop.png');
  if (desktopShot) {
    await pageA.screenshot({ path: desktopShot, fullPage: true });
  }
  const mobileShot = getEvidenceFilePath('browser-mobile.png');
  if (mobileShot) {
    await pageA.setViewportSize({ width: 390, height: 844 });
    await pageA.screenshot({ path: mobileShot, fullPage: true });
  }

  assert.deepEqual(errors, []);
  console.log('BROWSER_CHECKS', results.length, 'UNHANDLED_ERRORS', errors.length);
  writeEvidenceJson('browser-results.json', {
    checks: results,
    errors,
  });
} finally {
  await browser.close();
}
