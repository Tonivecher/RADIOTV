import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { loadPlaywright, writeEvidenceJson } from './helpers.mjs';
import { FFMPEG_BIN } from '../server/media.mjs';

const withBrowserFlag = process.argv.includes('--with-browser');

function newestSourceMtimeMs(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }
  let newest = stat.mtimeMs;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const childPath = path.join(targetPath, entry.name);
    newest = Math.max(newest, newestSourceMtimeMs(childPath));
  }
  return newest;
}

function ensureFreshDistBuild() {
  const distIndex = path.resolve('dist', 'index.html');
  const distMtime = fs.existsSync(distIndex) ? fs.statSync(distIndex).mtimeMs : 0;
  const sourceTargets = ['index.html', 'vite.config.ts', 'tsconfig.json', 'package.json', 'src', 'public'];
  const latestSourceMtime = sourceTargets.reduce(
    (max, item) => Math.max(max, newestSourceMtimeMs(path.resolve(item))),
    0
  );

  if (!distMtime || latestSourceMtime > distMtime) {
    console.log('[tests] Building dist/ before test run...');
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
  }
}

async function getAvailablePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

function createSyntheticSets(setsDir) {
  for (const name of ['alpha', 'beta', 'gamma']) {
    execFileSync(FFMPEG_BIN, [
      '-nostdin',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100',
      '-t',
      '180',
      '-ac',
      '2',
      '-metadata',
      'title=RADIOTV_CANARY_TITLE',
      '-metadata',
      'artist=RADIOTV_CANARY_ARTIST',
      '-y',
      path.join(setsDir, `${name}.wav`),
    ]);
  }
}

async function runNodeCommand(args, env) {
  const child = spawn('node', args, { env, stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(`Test failed: node ${args.join(' ')} (exit ${code})`);
  }
}

ensureFreshDistBuild();

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'radiotv-test-')));
const setsDir = path.join(root, 'sets');
const movedDir = path.join(root, 'moved');
const browserDataDir = path.join(root, 'browser-data');
const cacheDir = path.join(root, 'cache');

fs.mkdirSync(setsDir, { recursive: true });
fs.mkdirSync(movedDir, { recursive: true });
fs.mkdirSync(browserDataDir, { recursive: true });
createSyntheticSets(setsDir);

const port = await getAvailablePort();
const baseEnv = {
  ...process.env,
  PORT: String(port),
  RADIOTV_TEST_URL: `http://127.0.0.1:${port}`,
  RADIOTV_SETS_DIRS: `${setsDir}${path.delimiter}${movedDir}`,
  RADIOTV_AUDIO_CACHE: cacheDir,
  RADIOTV_SECRET: 'isolated-regression-test-secret-not-production',
};

let server = null;

async function startServer(dataDir) {
  const serverEnv = {
    ...baseEnv,
    RADIOTV_TEST_DATA_DIR: dataDir,
    RADIOTV_DATA_DIR: dataDir,
  };
  const logPath = path.join(dataDir, 'server.log');
  const fd = fs.openSync(logPath, 'a');
  server = spawn('node', ['server/index.mjs'], { env: serverEnv, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);

  for (let i = 0; i < 100; i += 1) {
    if (server.exitCode !== null) {
      const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
      throw new Error(`Test server exited early (${server.exitCode}):\n${log}`);
    }
    try {
      const health = await fetch(`${serverEnv.RADIOTV_TEST_URL}/api/health`);
      if (health.ok) {
        return serverEnv;
      }
    } catch {
      // Server still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Test server did not start within 10s');
}

async function stopServer() {
  if (!server || server.exitCode !== null) {
    server = null;
    return;
  }
  const active = server;
  server = null;
  active.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (active.exitCode === null) {
      active.kill('SIGKILL');
    }
  }, 5000);
  try {
    await once(active, 'exit');
  } finally {
    clearTimeout(timer);
  }
}

try {
  const regressionEnv = await startServer(root);
  await runNodeCommand(['--test', 'tests/regression.mjs'], regressionEnv);
  await stopServer();

  const playwright = await loadPlaywright({ optional: true });
  let browserRan = false;

  if (!playwright) {
    if (withBrowserFlag) {
      throw new Error(
        '--with-browser was specified, but Playwright is not installed. Install "playwright" or set PLAYWRIGHT_MODULE_PATH.'
      );
    }
    console.log(
      '[tests] Playwright not found; skipping browser suite (set PLAYWRIGHT_MODULE_PATH or install playwright to enable).'
    );
  } else {
    const browserEnv = await startServer(browserDataDir);
    await runNodeCommand(['tests/browser.mjs'], browserEnv);
    browserRan = true;
  }

  writeEvidenceJson('verification-result.json', {
    ok: true,
    regressionRan: true,
    browserRan,
    completedAt: new Date().toISOString(),
  });
} finally {
  await stopServer();
  fs.rmSync(root, { recursive: true, force: true });
}
