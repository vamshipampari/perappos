/**
 * URL metadata fetching for the Add App screen.
 *
 * Handles platform detection, title/favicon extraction, and fetching
 * basic metadata (name, hash, size) from a remote URL.
 */

import * as Crypto from 'expo-crypto';

// ── Platform detection ────────────────────────────────────────────────────────

const PLATFORM_PATTERNS: Array<{ pattern: RegExp; label: string; color: string }> = [
  { pattern: /\.lovable\.(dev|app)(\/|$)/i, label: 'Lovable', color: '#7C3AED' },
  { pattern: /\.bolt\.host(\/|$)/i, label: 'Bolt', color: '#F97316' },
  { pattern: /\.vercel\.app(\/|$)/i, label: 'Vercel', color: '#000000' },
  { pattern: /\.netlify\.app(\/|$)/i, label: 'Netlify', color: '#00BFA5' },
  { pattern: /\.replit\.dev(\/|$)/i, label: 'Replit', color: '#0A6BEF' },
];

export function detectPlatform(url: string): { label: string; color: string } | null {
  for (const p of PLATFORM_PATTERNS) {
    if (p.pattern.test(url)) return { label: p.label, color: p.color };
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { label: 'Web App', color: '#8E8E93' };
  }
  return null;
}

// ── HTML parsing helpers ──────────────────────────────────────────────────────

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
}

/** Returns true for file types that should be written as Base64 (binary). */
export function isBinaryExt(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|otf|pdf|avif)(\?.*)?$/i.test(path);
}

export function extractFaviconUrl(html: string, baseUrl: string): string | null {
  const iconLinks: string[] = [];
  const linkRe = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1] ?? '';
    if (!/\bicon\b/i.test(rel)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (href) iconLinks.push(href);
  }

  const candidates = iconLinks.length > 0 ? iconLinks : ['/favicon.ico'];
  for (const href of candidates) {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      // keep trying fallback candidates
    }
  }
  return null;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

export async function fetchWithTimeout(url: string, ms = 30_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchUrlMetadata(
  pageUrl: string,
  onStatus: (s: string) => void
): Promise<{ name: string; faviconUrl: string | null; hash: string; size: number }> {
  onStatus('Fetching app metadata…');

  let res: Response;
  try {
    res = await fetchWithTimeout(pageUrl, 30_000);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Network error';
    throw new Error(
      msg.toLowerCase().includes('abort')
        ? 'Request timed out after 30 seconds'
        : `Cannot reach app: ${msg}`
    );
  }
  if (!res.ok) throw new Error(`Server returned ${res.status} ${res.statusText}`);

  onStatus('Extracting title and icon…');
  const rawHtml = await res.text();
  const name = extractTitle(rawHtml) || new URL(pageUrl).hostname;
  const faviconUrl = extractFaviconUrl(rawHtml, pageUrl);
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawHtml);

  return {
    name,
    faviconUrl,
    hash,
    size: rawHtml.length,
  };
}
