#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CHANNEL_IDS, getAvailableSets, getCurrentBroadcast } from './db.mjs';
import { getAudioCacheDir, getCachedAudioInfo } from './media.mjs';

const execFileAsync = promisify(execFile);

const CACHE_DIR = getAudioCacheDir();
const REMOTE_HOST = (process.env.RADIOTV_SYNC_HOST || '').trim();
const REMOTE_DIR = (process.env.RADIOTV_SYNC_DIR || '/var/cache/radiotv/audio').trim();
const SSH_KEY = (process.env.RADIOTV_SYNC_SSH_KEY || '').trim();
const KNOWN_HOSTS = (process.env.RADIOTV_SYNC_KNOWN_HOSTS || '/etc/radiotv/known_hosts').trim();
const MANIFEST_PATH = (
  process.env.RADIOTV_SYNC_MANIFEST || path.join(path.dirname(CACHE_DIR), 'edge-pl-manifest.json')
).trim();
const BWLIMIT_KBPS = Number(process.env.RADIOTV_SYNC_BWLIMIT_KBPS) || 6000;
const MIN_FREE_GB = Number(process.env.RADIOTV_EDGE_MIN_FREE_GB) || 12;
const MIN_FREE_BYTES = MIN_FREE_GB * 1024 * 1024 * 1024;
const PRUNE_LEGACY = process.argv.includes('--prune-legacy');

function buildSshArgs() {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'StrictHostKeyChecking=yes',
  ];
  if (KNOWN_HOSTS) {
    args.push('-o', `UserKnownHostsFile=${KNOWN_HOSTS}`);
  }
  if (SSH_KEY) {
    args.push('-i', SSH_KEY, '-o', 'IdentitiesOnly=yes');
  }
  return args;
}

function getPrioritizedReadyFiles() {
  const now = Date.now();
  const availableSets = getAvailableSets();
  const byId = new Map(availableSets.map((row) => [row.id, row]));
  const ordered = [];
  const seen = new Set();

  const pushId = (id) => {
    if (!id || seen.has(id)) return;
    const row = byId.get(id);
    if (row) {
      seen.add(id);
      ordered.push(row);
    }
  };

  for (const chId of CHANNEL_IDS) {
    const b = getCurrentBroadcast(chId, now, availableSets);
    pushId(b.setId);
    for (const slot of b.schedule || []) {
      pushId(slot.setId);
    }
  }
  for (const row of availableSets) {
    pushId(row.id);
  }

  const ready = [];
  const validV2Names = new Set();
  for (const row of ordered) {
    const info = getCachedAudioInfo(row.filepath);
    if (!info) continue;
    validV2Names.add(info.filename);
    if (info.ready) {
      try {
        const stat = fs.statSync(info.targetPath);
        ready.push({
          setId: row.id,
          filename: info.filename,
          size: stat.size,
        });
      } catch {
        // skip disappearing file
      }
    }
  }
  return { ready, validV2Names };
}

function pruneLocalLegacyCache(validV2Names) {
  let removedCount = 0;
  let removedBytes = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(CACHE_DIR);
  } catch {
    return { removedCount, removedBytes };
  }

  for (const name of entries) {
    if (name.startsWith('.tmp-') || name.startsWith('.fast-')) continue;
    if (validV2Names.has(name)) continue;
    const fullPath = path.join(CACHE_DIR, name);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      fs.unlinkSync(fullPath);
      removedCount += 1;
      removedBytes += stat.size;
    } catch {
      // ignore
    }
  }
  return { removedCount, removedBytes };
}

async function runRemote(command) {
  const args = [...buildSshArgs(), REMOTE_HOST, command];
  const { stdout } = await execFileAsync('ssh', args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function getRemoteState() {
  const cmd = `mkdir -p ${REMOTE_DIR} && df -B1 --output=avail ${REMOTE_DIR} | tail -n 1 && echo "---FILES---" && find ${REMOTE_DIR} -maxdepth 1 -type f -name '*.m4a' -printf '%f %s\\n'`;
  const out = await runRemote(cmd);
  const [availPart, filesPart = ''] = out.split('---FILES---');
  const availBytes = Number(availPart.trim()) || 0;
  const remoteFiles = new Map();
  for (const line of filesPart.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [name, sizeStr] = trimmed.split(/\s+/);
    if (name && name.endsWith('.m4a')) {
      remoteFiles.set(name, Number(sizeStr) || 0);
    }
  }
  return { availBytes, remoteFiles };
}

async function syncToEdge() {
  const { ready, validV2Names } = getPrioritizedReadyFiles();

  if (PRUNE_LEGACY && ready.length > 0) {
    const pruned = pruneLocalLegacyCache(validV2Names);
    if (pruned.removedCount > 0) {
      console.log(
        `[SYNC] Pruned ${pruned.removedCount} legacy local cache files (${(pruned.removedBytes / 1e9).toFixed(2)} GB)`
      );
    }
  }

  if (!REMOTE_HOST) {
    console.log(`[SYNC] RADIOTV_SYNC_HOST not set; local ready=${ready.length}`);
    return;
  }

  const { availBytes, remoteFiles } = await getRemoteState();
  const remoteUsedByCache = [...remoteFiles.values()].reduce((acc, n) => acc + n, 0);
  const totalBudgetBytes = Math.max(0, availBytes + remoteUsedByCache - MIN_FREE_BYTES);

  const desired = [];
  const desiredSet = new Set();
  let plannedBytes = 0;
  for (const item of ready) {
    if (plannedBytes + item.size > totalBudgetBytes) {
      break;
    }
    desired.push(item);
    desiredSet.add(item.filename);
    plannedBytes += item.size;
  }

  const toDelete = [...remoteFiles.keys()].filter((name) => !desiredSet.has(name));
  if (toDelete.length > 0) {
    const delList = toDelete.map((n) => `'${REMOTE_DIR}/${n.replace(/'/g, '')}'`).join(' ');
    await runRemote(`rm -f ${delList}`);
    console.log(`[SYNC] Removed ${toDelete.length} stale/out-of-window files on edge`);
  }

  const toUpload = desired
    .filter((item) => remoteFiles.get(item.filename) !== item.size)
    .map((item) => item.filename);

  if (toUpload.length > 0) {
    const listFile = path.join(os.tmpdir(), `radiotv-rsync-${process.pid}.txt`);
    fs.writeFileSync(listFile, `${toUpload.join('\n')}\n`, 'utf8');
    try {
      const sshCmd = ['ssh', ...buildSshArgs()].join(' ');
      const rsyncArgs = [
        '-a',
        '--chmod=F640',
        `--bwlimit=${BWLIMIT_KBPS}`,
        '--files-from',
        listFile,
        '-e',
        sshCmd,
        `${CACHE_DIR}/`,
        `${REMOTE_HOST}:${REMOTE_DIR}/`,
      ];
      const useNice = process.platform === 'linux' && fs.existsSync('/usr/bin/nice');
      const useIonice = process.platform === 'linux' && fs.existsSync('/usr/bin/ionice');
      if (useNice && useIonice) {
        await execFileAsync('/usr/bin/nice', ['-n', '19', '/usr/bin/ionice', '-c', '3', 'rsync', ...rsyncArgs], {
          maxBuffer: 8 * 1024 * 1024,
        });
      } else {
        await execFileAsync('rsync', rsyncArgs, { maxBuffer: 8 * 1024 * 1024 });
      }
      console.log(`[SYNC] Uploaded ${toUpload.length} files to ${REMOTE_HOST}:${REMOTE_DIR}`);
    } finally {
      fs.rmSync(listFile, { force: true });
    }
  }

  const after = await getRemoteState();
  const manifestData = {
    updatedAt: Date.now(),
    host: REMOTE_HOST,
    availBytes: after.availBytes,
    files: [...after.remoteFiles.keys()].sort(),
  };
  const tmpManifest = `${MANIFEST_PATH}.tmp.${process.pid}`;
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(tmpManifest, JSON.stringify(manifestData), { mode: 0o640 });
  fs.renameSync(tmpManifest, MANIFEST_PATH);
  console.log(
    `[SYNC] Manifest updated: ${manifestData.files.length} files on edge, free ${(after.availBytes / 1024 ** 3).toFixed(2)} GiB`
  );
}

syncToEdge().catch((err) => {
  console.error('[SYNC] Edge sync failed:', err?.message || err);
  process.exit(1);
});
