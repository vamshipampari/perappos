export interface Env {
  APPS: KVNamespace;
  /** Bearer token for the PUT /api/update-html endpoint. Set via `wrangler secret put UPDATE_API_KEY`. */
  UPDATE_API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/' || path === '/health') {
      return new Response('Cottix Apps Host', { status: 200 });
    }

    // ── PUT /api/update-html — update an existing app's HTML in KV ──────────
    if (path === '/api/update-html' && request.method === 'PUT') {
      // Verify Bearer token
      const authHeader = request.headers.get('Authorization') ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!env.UPDATE_API_KEY || token !== env.UPDATE_API_KEY) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let body: { appId?: string; html?: string };
      try {
        body = await request.json() as { appId?: string; html?: string };
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const { appId, html } = body;
      if (!appId || typeof appId !== 'string' || !html || typeof html !== 'string') {
        return new Response(JSON.stringify({ error: 'appId and html are required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!html.includes('<html') && !html.includes('<!DOCTYPE')) {
        return new Response(JSON.stringify({ error: 'Content does not appear to be valid HTML' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (new TextEncoder().encode(html).length > 5 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'HTML exceeds 5 MB limit' }), {
          status: 413,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      await env.APPS.put(`app:${appId}`, html);

      return new Response(
        JSON.stringify({ success: true, url: `https://apps.cottix.co/${appId}` }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── GET /<appId> — serve app HTML ────────────────────────────────────────

    // Extract app ID: /abc123  or  /abc123/  or  /abc123/index.html
    const match = path.match(/^\/([a-zA-Z0-9_-]+)(\/index\.html)?\/?\s*$/);
    if (!match) {
      return new Response('Not Found', { status: 404 });
    }

    const appId = match[1];
    const html = await env.APPS.get(`app:${appId}`, 'text');

    if (!html) {
      return new Response('App not found', { status: 404 });
    }

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        'X-Cottix-App': appId,
        // Allow embedding in WebView
        'X-Frame-Options': 'ALLOWALL',
      },
    });
  },
} satisfies ExportedHandler<Env>;
