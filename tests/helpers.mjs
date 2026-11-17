import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Resolves Playwright either from `PLAYWRIGHT_MODULE_PATH` (file or package dir)
 * or from standard ESM module resolution (`import('playwright')`).
 */
export async function loadPlaywright({ optional = false } = {}) {
  const configuredPath = process.env.PLAYWRIGHT_MODULE_PATH?.trim();
  if (configuredPath) {
    const resolved = path.resolve(configuredPath);
    let entryPath = resolved;
    try {
      if (fs.statSync(resolved).isDirectory()) {
        const mjsEntry = path.join(resolved, 'index.mjs');
        const jsEntry = path.join(resolved, 'index.js');
        entryPath = fs.existsSync(mjsEntry) ? mjsEntry : jsEntry;
      }
      return await import(pathToFileURL(entryPath).href);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load Playwright from PLAYWRIGHT_MODULE_PATH="${configuredPath}": ${reason}`
      );
    }
  }

  try {
    return await import('playwright');
  } catch (error) {
    const code = (error && typeof error === 'object' && 'code' in error) ? error.code : '';
    if (
      optional &&
      (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND')
    ) {
      return null;
    }
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'Playwright is not installed. Install "playwright" or set PLAYWRIGHT_MODULE_PATH.'
      );
    }
    throw error;
  }
}

export function resolveEvidenceDir() {
  const raw = process.env.RADIOTV_EVIDENCE_DIR?.trim();
  if (!raw) {
    return null;
  }
  const dir = path.resolve(raw);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getEvidenceFilePath(filename) {
  const dir = resolveEvidenceDir();
  return dir ? path.join(dir, filename) : null;
}

export function writeEvidenceJson(filename, payload) {
  const targetPath = getEvidenceFilePath(filename);
  if (!targetPath) {
    return null;
  }
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2));
  return targetPath;
}

export function solvePow(prefix, difficulty = 3) {
  const target = '0'.repeat(difficulty);
  let nonce = 0;
  while (
    !crypto
      .createHash('sha256')
      .update(prefix + nonce)
      .digest('hex')
      .startsWith(target)
  ) {
    nonce += 1;
  }
  return nonce;
}
