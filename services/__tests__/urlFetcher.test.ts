/**
 * services/__tests__/urlFetcher.test.ts
 *
 * Tests for pure helper functions in urlFetcher.ts.
 * fetchUrlMetadata is excluded — it requires network + expo-crypto (native).
 */

// expo-crypto is a native module; stub it so the import doesn't crash
jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

import {
  detectPlatform,
  extractTitle,
  isBinaryExt,
  extractFaviconUrl,
} from '@/services/urlFetcher';

// ── detectPlatform ────────────────────────────────────────────────────────────

describe('detectPlatform', () => {
  test('recognises Lovable URLs', () => {
    expect(detectPlatform('https://myapp.lovable.dev')?.label).toBe('Lovable');
    expect(detectPlatform('https://myapp.lovable.app/')?.label).toBe('Lovable');
  });

  test('recognises Bolt URLs', () => {
    expect(detectPlatform('https://myapp.bolt.host')?.label).toBe('Bolt');
  });

  test('recognises Vercel URLs', () => {
    const p = detectPlatform('https://my-site.vercel.app');
    expect(p?.label).toBe('Vercel');
    expect(p?.color).toBe('#000000');
  });

  test('recognises Netlify URLs', () => {
    expect(detectPlatform('https://site.netlify.app')?.label).toBe('Netlify');
  });

  test('recognises Replit URLs', () => {
    expect(detectPlatform('https://app.replit.dev')?.label).toBe('Replit');
  });

  test('falls back to Web App for generic https URLs', () => {
    const p = detectPlatform('https://example.com/myapp');
    expect(p?.label).toBe('Web App');
    expect(p?.color).toBe('#8E8E93');
  });

  test('returns null for non-http input', () => {
    expect(detectPlatform('not-a-url')).toBeNull();
    expect(detectPlatform('')).toBeNull();
  });

  test('is case-insensitive for platform patterns', () => {
    expect(detectPlatform('https://foo.LOVABLE.DEV')?.label).toBe('Lovable');
  });
});

// ── extractTitle ──────────────────────────────────────────────────────────────

describe('extractTitle', () => {
  test('extracts plain text title', () => {
    expect(extractTitle('<html><head><title>My App</title></head></html>')).toBe('My App');
  });

  test('trims whitespace', () => {
    expect(extractTitle('<title>  Trimmed  </title>')).toBe('Trimmed');
  });

  test('strips inner tags', () => {
    expect(extractTitle('<title><b>Bold</b> Title</title>')).toBe('Bold Title');
  });

  test('returns empty string when no title tag', () => {
    expect(extractTitle('<html><body>No title</body></html>')).toBe('');
  });

  test('is case-insensitive for title tag', () => {
    expect(extractTitle('<TITLE>Upper</TITLE>')).toBe('Upper');
  });

  test('handles title with attributes', () => {
    expect(extractTitle('<title lang="en">Attr App</title>')).toBe('Attr App');
  });
});

// ── isBinaryExt ───────────────────────────────────────────────────────────────

describe('isBinaryExt', () => {
  test.each([
    'image.png',
    'photo.jpg',
    'photo.jpeg',
    'img.gif',
    'img.webp',
    'icon.ico',
    'font.woff',
    'font.woff2',
    'font.ttf',
    'font.eot',
    'font.otf',
    'doc.pdf',
    'img.avif',
  ])('returns true for %s', (path) => {
    expect(isBinaryExt(path)).toBe(true);
  });

  test.each([
    'index.html',
    'style.css',
    'app.js',
    'bundle.ts',
    'data.json',
    'README.md',
  ])('returns false for %s', (path) => {
    expect(isBinaryExt(path)).toBe(false);
  });

  test('ignores query strings', () => {
    expect(isBinaryExt('image.png?v=3')).toBe(true);
    expect(isBinaryExt('style.css?hash=abc')).toBe(false);
  });
});

// ── extractFaviconUrl ─────────────────────────────────────────────────────────

describe('extractFaviconUrl', () => {
  const base = 'https://example.com';

  test('extracts rel="icon" href', () => {
    const html = '<link rel="icon" href="/favicon.ico">';
    expect(extractFaviconUrl(html, base)).toBe('https://example.com/favicon.ico');
  });

  test('extracts rel="shortcut icon"', () => {
    const html = '<link rel="shortcut icon" href="/logo.png">';
    expect(extractFaviconUrl(html, base)).toBe('https://example.com/logo.png');
  });

  test('resolves relative URLs against base', () => {
    const html = '<link rel="icon" href="assets/icon.png">';
    expect(extractFaviconUrl(html, base)).toBe('https://example.com/assets/icon.png');
  });

  test('handles absolute href', () => {
    const html = '<link rel="icon" href="https://cdn.example.com/icon.svg">';
    expect(extractFaviconUrl(html, base)).toBe('https://cdn.example.com/icon.svg');
  });

  test('falls back to /favicon.ico when no link tags', () => {
    expect(extractFaviconUrl('<html></html>', base)).toBe('https://example.com/favicon.ico');
  });

  test('ignores non-icon link tags', () => {
    const html = '<link rel="stylesheet" href="/style.css"><link rel="icon" href="/fav.png">';
    expect(extractFaviconUrl(html, base)).toBe('https://example.com/fav.png');
  });
});
