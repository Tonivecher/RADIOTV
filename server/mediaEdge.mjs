import fs from 'node:fs';
import crypto from 'node:crypto';
import { getCachedAudioInfo } from './media.mjs';

const DEFAULT_TTL_SEC = 7200;
const MIN_TTL_SEC = 60;
const MAX_TTL_SEC = 86400;
const HEALTH_INTERVAL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 3_000;
const MANIFEST_RECHECK_MS = 5_000;

const edgeHealthState = new Map();
const manifestCache = new Map();
let healthTimer = null;

function getSignSecret() {
  return (process.env.RADIOTV_MEDIA_SIGN_SECRET || '').trim();
}

export function getMediaUrlTtlSec() {
  const raw = Number(process.env.RADIOTV_MEDIA_URL_TTL_SEC);
  if (Number.isFinite(raw) && raw >= MIN_TTL_SEC && raw <= MAX_TTL_SEC) {
    return Math.floor(raw);
  }
  return DEFAULT_TTL_SEC;
}

export function getConfiguredEdges() {
  const raw = (process.env.RADIOTV_MEDIA_EDGES || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const primaryOverride = (process.env.RADIOTV_MEDIA_PRIMARY_EDGE || '').trim().toLowerCase();
    return parsed
      .filter((e) => e && typeof e.id === 'string' && typeof e.baseUrl === 'string' && e.baseUrl)
      .map((e, idx) => ({
        id: String(e.id),
        region: String(e.region || e.id).toUpperCase(),
        baseUrl: String(e.baseUrl).replace(/\/+$/, ''),
        healthUrl: typeof e.healthUrl === 'string' ? e.healthUrl.trim() : '',
        priority:
          primaryOverride && String(e.id).toLowerCase() === primaryOverride
            ? -1000
            : Number.isFinite(Number(e.priority))
              ? Number(e.priority)
              : idx + 1,
        local: Boolean(e.local),
        manifestPath: typeof e.manifestPath === 'string' ? e.manifestPath.trim() : '',
      }));
  } catch {
    return [];
  }
}

export function isEdgeDeliveryEnabled() {
  return Boolean(getSignSecret() && getConfiguredEdges().length > 0);
}

/**
 * Generates an Nginx `ngx_http_secure_link_module` compatible signed URL.
 * Matches:
 *   secure_link $arg_md5,$arg_expires;
 *   secure_link_md5 "$secure_link_expires$uri <SECRET>";
 */
export function signNginxSecureLink(baseUrl, filename, secret, expiresUnixSec) {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const url = new URL(`${cleanBase}/${encodeURIComponent(filename)}`);
  const md5 = crypto
    .createHash('md5')
    .update(`${expiresUnixSec}${url.pathname} ${secret}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  url.searchParams.set('md5', md5);
  url.searchParams.set('expires', String(expiresUnixSec));
  return url.toString();
}

function edgeHasFile(edge, filename) {
  if (!edge.manifestPath) {
    return true;
  }

  const now = Date.now();
  const cached = manifestCache.get(edge.manifestPath);
  if (cached && now - cached.checkedAt < MANIFEST_RECHECK_MS) {
    return cached.files.has(filename);
  }

  try {
    const stat = fs.statSync(edge.manifestPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      cached.checkedAt = now;
      return cached.files.has(filename);
    }
    const raw = JSON.parse(fs.readFileSync(edge.manifestPath, 'utf8'));
    const list = Array.isArray(raw?.files) ? raw.files : Array.isArray(raw) ? raw : [];
    const files = new Set(list.filter((item) => typeof item === 'string'));
    manifestCache.set(edge.manifestPath, {
      mtimeMs: stat.mtimeMs,
      checkedAt: now,
      files,
    });
    return files.has(filename);
  } catch {
    manifestCache.set(edge.manifestPath, {
      mtimeMs: -1,
      checkedAt: now,
      files: new Set(),
    });
    return false;
  }
}

function getEdgeHealth(edgeId) {
  return edgeHealthState.get(edgeId) || { healthy: true, consecutiveFailures: 0, lastCheckedAt: 0 };
}

async function probeSingleEdge(edge) {
  if (!edge.healthUrl) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  timer.unref?.();

  const prev = getEdgeHealth(edge.id);
  try {
    const res = await fetch(edge.healthUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'RADIOTV-HealthCheck/1.0' },
    });
    if (res.ok) {
      edgeHealthState.set(edge.id, {
        healthy: true,
        consecutiveFailures: 0,
        lastCheckedAt: Date.now(),
      });
    } else {
      const fails = prev.consecutiveFailures + 1;
      edgeHealthState.set(edge.id, {
        healthy: fails < 2,
        consecutiveFailures: fails,
        lastCheckedAt: Date.now(),
      });
    }
  } catch {
    const fails = prev.consecutiveFailures + 1;
    edgeHealthState.set(edge.id, {
      healthy: fails < 2,
      consecutiveFailures: fails,
      lastCheckedAt: Date.now(),
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function runEdgeHealthChecks() {
  const edges = getConfiguredEdges();
  if (edges.length === 0) return;
  await Promise.all(edges.map((edge) => probeSingleEdge(edge)));
}

export function startEdgeHealthMonitor() {
  if (healthTimer || !isEdgeDeliveryEnabled()) return;
  void runEdgeHealthChecks();
  healthTimer = setInterval(() => {
    void runEdgeHealthChecks();
  }, HEALTH_INTERVAL_MS);
  healthTimer.unref?.();
}

export function stopEdgeHealthMonitor() {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

export function getEdgesStatusSummary() {
  return getConfiguredEdges().map((edge) => {
    const health = getEdgeHealth(edge.id);
    return {
      id: edge.id,
      region: edge.region,
      priority: edge.priority,
      healthy: health.healthy,
      lastCheckedAt: health.lastCheckedAt,
    };
  });
}

/**
 * Builds an ordered list of signed media URLs for a set (primary -> fallback).
 * Falls back to local Node.js route when edges are not configured or file is not baked yet.
 */
export function buildStreamUrlsForSet(setRow, fallbackPath, nowMs = Date.now()) {
  const secret = getSignSecret();
  const edges = getConfiguredEdges();

  if (!secret || edges.length === 0 || !setRow?.filepath) {
    return [{ id: 'origin', region: 'LOCAL', url: fallbackPath }];
  }

  const cached = getCachedAudioInfo(setRow.filepath);
  if (!cached || !cached.ready) {
    return [{ id: 'origin', region: 'LOCAL', url: fallbackPath }];
  }

  const expires = Math.floor(nowMs / 1000) + getMediaUrlTtlSec();
  const candidates = edges
    .filter((edge) => edge.local || edgeHasFile(edge, cached.filename))
    .map((edge) => {
      const health = getEdgeHealth(edge.id);
      return {
        edge,
        healthy: health.healthy,
      };
    })
    .sort((a, b) => {
      if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
      return a.edge.priority - b.edge.priority;
    });

  if (candidates.length === 0) {
    return [{ id: 'origin', region: 'LOCAL', url: fallbackPath }];
  }

  return candidates.map(({ edge }) => ({
    id: edge.id,
    region: edge.region,
    url: signNginxSecureLink(edge.baseUrl, cached.filename, secret, expires),
  }));
}
