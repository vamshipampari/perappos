export interface Env {
  APPS: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/' || path === '/health') {
      return new Response('Cottix Apps Host', { status: 200 });
    }

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
