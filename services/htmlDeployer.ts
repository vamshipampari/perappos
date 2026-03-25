/**
 * Client-side HTML deployer.
 *
 * Parses metadata from raw HTML and deploys to Cloudflare Workers KV via
 * the deploy-html Supabase edge function.
 */

import { supabase } from '@/services/supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

/** 5 MB limit — matches the edge function */
export const HTML_SIZE_LIMIT = 5 * 1024 * 1024;

// ── Metadata extraction ────────────────────────────────────────────────────────
// Mirrors extractMetadata() in supabase/functions/generate-app/index.ts.
// Client-side parse avoids a network round-trip just for display metadata.

export interface HtmlMeta {
  title: string;
  icon: string;
  color: string;
  description: string;
}

export function parseHtmlMeta(html: string): HtmlMeta {
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim() || 'My App';

  // Support both cottix-meta and legacy perappos-meta tags
  const metaMatch = html.match(
    /<meta\s+name="(?:cottix|perappos)-meta"\s+content='(\{.*?\})'/i
  );

  let icon = '✨';
  let color = '#E0E7FF';
  let description = '';

  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1]) as {
        icon?: string;
        color?: string;
        description?: string;
      };
      icon = meta.icon || icon;
      color = meta.color || color;
      description = meta.description || description;
    } catch {
      // ignore parse errors — defaults are fine
    }
  }

  return { title, icon, color, description };
}

// ── Deploy ─────────────────────────────────────────────────────────────────────

export interface DeployResult {
  url: string;
}

/**
 * Uploads HTML to Cloudflare KV via the deploy-html edge function.
 * Requires an active Supabase session. Throws on auth error or network failure.
 */
export async function deployHtml(appId: string, html: string): Promise<DeployResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error('You must be signed in to deploy an app');
  }

  const htmlBytes = new TextEncoder().encode(html).length;
  if (htmlBytes > HTML_SIZE_LIMIT) {
    throw new Error(
      `HTML is too large (${(htmlBytes / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`
    );
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/deploy-html`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ appId, html }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const parsed = JSON.parse(errorText) as { error?: string };
      errorMessage = parsed.error ?? `Deploy failed (${response.status})`;
    } catch {
      errorMessage = `Deploy failed (${response.status})`;
    }
    throw new Error(errorMessage);
  }

  const result = (await response.json()) as { url?: string };
  if (!result.url) {
    throw new Error('Deploy succeeded but returned no URL');
  }

  return { url: result.url };
}
