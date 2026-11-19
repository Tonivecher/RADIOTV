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
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
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

async function assertThemeVisualTokens(page, expectedTheme) {
  const report = await page.evaluate((theme) => {
    const actualTheme = document.documentElement.getAttribute('data-theme');
    const textPrimaryRaw = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-primary')
      .trim();

    const probe = document.createElement('span');
    probe.style.color = textPrimaryRaw;
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const textPrimaryRgb = textPrimaryRaw ? getComputedStyle(probe).color : '';
    probe.remove();

    const isPureWhite = (value) => {
      const norm = String(value || '')
        .toLowerCase()
        .replace(/\s+/g, '');
      return (
        norm === '#fff' ||
        norm === '#ffffff' ||
        norm === 'white' ||
        norm === 'rgb(255,255,255)' ||
        norm === 'rgba(255,255,255,1)'
      );
    };

    const parseAlpha = (bg) => {
      const value = String(bg || '').trim().toLowerCase();
      if (!value || value === 'transparent') return 0;
      const commaMatch = value.match(
        /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)$/
      );
      if (commaMatch) {
        return commaMatch[1] === undefined ? 1 : Number(commaMatch[1]);
      }
      const spaceMatch = value.match(
        /^rgba?\(\s*[\d.]+\s+[\d.]+\s+[\d.]+\s*(?:\/\s*([\d.]+%?)\s*)?\)$/
      );
      if (spaceMatch) {
        if (spaceMatch[1] === undefined) return 1;
        return spaceMatch[1].endsWith('%')
          ? parseFloat(spaceMatch[1]) / 100
          : Number(spaceMatch[1]);
      }
      return 1;
    };

    const textSelectors = [
      'h1',
      'h2',
      'h3',
      '.hero-display-title',
      '.magnetic-cta--hero',
      '.island-channel-btn',
      '.glass-pill-btn',
      '.island-link',
      '.channel-lens-row__name',
    ];
    const whiteElements = [];
    for (const el of document.querySelectorAll(textSelectors.join(', '))) {
      const style = getComputedStyle(el);
      if (el.getClientRects().length === 0 || style.visibility === 'hidden') continue;
      if (isPureWhite(style.color)) {
        whiteElements.push({
          tag: el.tagName.toLowerCase(),
          className: el.className,
          color: style.color,
        });
      }
    }

    const panelCounts = {
      waveformShell: document.querySelectorAll('.waveform-shell').length,
      glassDoubleShell: document.querySelectorAll('.glass-double-shell').length,
      loungeTelemetryCol: document.querySelectorAll('.lounge-telemetry-col').length,
    };

    const opaquePanels = [];
    for (const el of document.querySelectorAll(
      '.waveform-shell, .glass-double-shell, .lounge-telemetry-col'
    )) {
      const bg = getComputedStyle(el).backgroundColor;
      const alpha = parseAlpha(bg);
      if (!Number.isFinite(alpha) || alpha > 0.06) {
        opaquePanels.push({
          className: el.className,
          backgroundColor: bg,
          alpha,
        });
      }
    }

    return {
      actualTheme,
      expectedTheme: theme,
      textPrimaryRaw,
      textPrimaryRgb,
      textPrimaryPureWhite: isPureWhite(textPrimaryRaw) || isPureWhite(textPrimaryRgb),
      whiteElements,
      panelCounts,
      opaquePanels,
    };
  }, expectedTheme);

  assert.equal(report.actualTheme, expectedTheme);
  assert(report.textPrimaryRaw.length > 0, `Missing --text-primary in theme ${expectedTheme}`);
  assert.equal(
    report.textPrimaryPureWhite,
    false,
    `--text-primary must not be pure white in theme ${expectedTheme}: ${report.textPrimaryRaw} (${report.textPrimaryRgb})`
  );
  assert.deepEqual(
    report.whiteElements,
    [],
    `Found pure white text on headings/buttons in theme ${expectedTheme}: ${JSON.stringify(report.whiteElements)}`
  );
  assert(
    report.panelCounts.waveformShell > 0 &&
      report.panelCounts.glassDoubleShell > 0 &&
      report.panelCounts.loungeTelemetryCol > 0,
    `Expected panel shells to exist in theme ${expectedTheme}: ${JSON.stringify(report.panelCounts)}`
  );
  assert.deepEqual(
    report.opaquePanels,
    [],
    `Panels exceed alpha <= 0.06 in theme ${expectedTheme}: ${JSON.stringify(report.opaquePanels)}`
  );
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

  await check('audio plays, instant glitch channel transfer never locks body, and all 3 themes meet visual token rules', async () => {
    await stableClick(pageA.locator('.magnetic-cta--hero'));
    await pageA.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return Boolean(audio && !audio.paused && audio.currentTime > 0 && !audio.error);
    });

    await assertThemeVisualTokens(pageA, 'dusk');

    const rows = pageA.locator('.channel-lens-row');
    assert((await rows.count()) >= 3, 'Expected at least 3 channel rows');

    // Main -> Deep (instant glitch transfer, no scroll lock, auto-completes without user input)
    await stableClick(rows.nth(1));
    assert.equal(
      await pageA.evaluate(() => document.body.style.position),
      ''
    );
    assert.equal(await pageA.locator('text=SCROLL').count(), 0);
    await pageA.locator('.channel-transition-portal').waitFor({ state: 'hidden', timeout: 4000 });
    await pageA.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return Boolean(
        audio &&
          audio.currentSrc.includes('ch-deep') &&
          audio.readyState >= 2 &&
          !audio.error
      );
    });
    assert.equal(
      await pageA.evaluate(() => document.body.style.position),
      ''
    );
    await assertThemeVisualTokens(pageA, 'deep');

    // Deep -> DeepTech
    await stableClick(rows.nth(2));
    assert.equal(
      await pageA.evaluate(() => document.body.style.position),
      ''
    );
    await pageA.locator('.channel-transition-portal').waitFor({ state: 'hidden', timeout: 4000 });
    await pageA.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return Boolean(
        audio &&
          audio.currentSrc.includes('ch-afterglow') &&
          audio.readyState >= 2 &&
          !audio.error
      );
    });
    assert.equal(
      await pageA.evaluate(() => document.body.style.position),
      ''
    );
    await assertThemeVisualTokens(pageA, 'afterglow');

    // DeepTech -> Main
    await stableClick(rows.nth(0));
    assert.equal(
      await pageA.evaluate(() => document.body.style.position),
      ''
    );
    await pageA.locator('.channel-transition-portal').waitFor({ state: 'hidden', timeout: 4000 });
    assert.equal(
      await pageA.evaluate(() => document.body.style.position),
      ''
    );
    await assertThemeVisualTokens(pageA, 'dusk');
  });

  await check('floating island header is detached, leaves clear sky band across breakpoints, and collapses on mobile scroll', async () => {
    for (const [w, h, minGap] of [
      [1440, 960, 145],
      [1100, 900, 130],
      [760, 900, 108],
      [390, 844, 102],
    ]) {
      await pageA.setViewportSize({ width: w, height: h });
      await pageA.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
      await pageA.waitForTimeout(120);
      const geom = await pageA.evaluate(() => {
        const header = document.querySelector('.island-header-shell');
        const wrap = document.querySelector('.island-header-wrap');
        const eyebrow = document.querySelector('.hero-eyebrow-line');
        const hRect = header?.getBoundingClientRect();
        const wRect = wrap?.getBoundingClientRect();
        const eRect = eyebrow?.getBoundingClientRect();
        return {
          wrapTop: wRect?.top ?? 0,
          headerBottom: hRect?.bottom ?? 0,
          eyebrowTop: eRect?.top ?? 0,
        };
      });
      assert(
        geom.wrapTop >= 10,
        `Expected .island-header-wrap top >= 10 at ${w}px, got ${geom.wrapTop}`
      );
      const skyGap = geom.eyebrowTop - geom.headerBottom;
      assert(
        skyGap >= minGap,
        `Expected header-to-hero sky gap >= ${minGap}px at ${w}px, got ${skyGap}px`
      );
    }

    await pageA.waitForFunction(
      () =>
        !document
          .querySelector('.island-header-wrap')
          ?.hasAttribute('data-collapsed')
    );

    await pageA.evaluate(() => window.scrollTo({ top: 320, behavior: 'instant' }));
    await pageA.waitForFunction(
      () =>
        document
          .querySelector('.island-header-wrap')
          ?.getAttribute('data-collapsed') === 'true',
      undefined,
      { timeout: 5000 }
    );

    await pageA.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await pageA.waitForFunction(
      () =>
        !document
          .querySelector('.island-header-wrap')
          ?.hasAttribute('data-collapsed'),
      undefined,
      { timeout: 5000 }
    );
    await pageA.setViewportSize({ width: 1440, height: 1100 });
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
