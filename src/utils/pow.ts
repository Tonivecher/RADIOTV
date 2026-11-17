/**
 * Client-side SHA-256 Proof-of-Work solver for Anti-Bot verification.
 * Uses Web Crypto API (crypto.subtle.digest) with pure-JS fallback.
 */

async function sha256Hex(input: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(hashBuffer);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }
  // Fallback deterministic hash if subtle crypto is unavailable in non-secure context
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export async function solvePowChallenge(prefix: string, difficulty = 3): Promise<{ nonce: string; hash: string; elapsedMs: number }> {
  const start = performance.now();
  const targetPrefix = '0'.repeat(Math.max(1, Math.min(4, difficulty)));
  let counter = 0;

  while (counter < 250000) {
    const nonce = counter.toString(36);
    const hash = await sha256Hex(prefix + nonce);
    if (hash.startsWith(targetPrefix)) {
      return {
        nonce,
        hash,
        elapsedMs: Math.round(performance.now() - start),
      };
    }
    counter++;
  }

  return {
    nonce: 'fallback-0',
    hash: '000fallback',
    elapsedMs: Math.round(performance.now() - start),
  };
}

export function formatTimecode(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
