/**
 * Client-side HTML deployer.
 *
 * Parses metadata from raw HTML and deploys to Cloudflare Workers KV via
 * the deploy-html Supabase edge function.
 */

import { supabase } from '@/services/supabase';

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
  const htmlBytes = new TextEncoder().encode(html).length;
  if (htmlBytes > HTML_SIZE_LIMIT) {
    throw new Error(
      `HTML is too large (${(htmlBytes / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`
    );
  }

  // supabase.functions.invoke() handles auth (JWT + auto-refresh) internally —
  // no manual token fetching, no PowerSync side-effects from refreshSession().
  const { data, error } = await supabase.functions.invoke<{ url: string }>('deploy-html', {
    body: { appId, html },
  });

  if (error) {
    // FunctionsHttpError carries the raw Response in `.context` — try to extract
    // the JSON body for a human-readable reason, fall back to error.message.
    let message = error.message || 'Deploy failed';
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx) {
        const body = await ctx.json() as { error?: string; message?: string };
        message = body.error ?? body.message ?? message;
      }
    } catch {
      // ignore — use the message we already have
    }
    throw new Error(message);
  }

  if (!data?.url) {
    throw new Error('Deploy succeeded but returned no URL');
  }

  return { url: data.url };
}
