/**
 * Generates the JavaScript shim injected into the WebView via
 * `injectedJavaScriptBeforeContentLoaded`, so it runs BEFORE any page script.
 *
 * Key design choices:
 *  - Initial KV data is serialized as a JSON literal embedded in the script,
 *    making `localStorage.getItem` fully synchronous (no round-trip to native).
 *  - `localStorage` writes are fire-and-forget postMessages; the in-memory
 *    cache is always the source of truth for reads.
 *  - `VaultAPI.*` calls return Promises and wait for a native response via
 *    `window.__vaultRespond({ id, result, error })`.
 *  - The entire shim is an IIFE written in ES5 to be safe across all WebView
 *    versions (no template literals, no arrow functions, no const/let in the
 *    emitted string to avoid strict-mode edge cases in old WebViews).
 */
export function buildVaultShim(
  appId: string,
  initialData: Record<string, string>
): string {
  // JSON.stringify handles all escaping — safe to embed directly.
  const safeId = JSON.stringify(appId);
  const safeData = JSON.stringify(initialData);

  return `
(function() {
  "use strict";

  /* ── In-memory cache, pre-populated from SQLite ──────────────────────── */
  var _cache = ${safeData};
  var _appId = ${safeId};

  /* ── Promise registry for async bridge calls ─────────────────────────── */
  var _pending = {};
  var _seq = 0;

  function _post(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  /**
   * Called by the native side to resolve / reject a pending VaultAPI call.
   * Invoked via webViewRef.current.injectJavaScript(...).
   */
  window.__vaultRespond = function(resp) {
    var entry = _pending[resp.id];
    if (!entry) return;
    delete _pending[resp.id];
    if (resp.error) {
      entry.reject(new Error(resp.error));
    } else {
      entry.resolve(resp.result);
    }
  };

  /** Send a message to native and return a Promise for its response. */
  function _bridge(type, extra) {
    var id = String(++_seq);
    var payload = { type: type, id: id, appId: _appId };
    if (extra) {
      var keys = Object.keys(extra);
      for (var i = 0; i < keys.length; i++) {
        payload[keys[i]] = extra[keys[i]];
      }
    }
    return new Promise(function(resolve, reject) {
      _pending[id] = { resolve: resolve, reject: reject };
      _post(payload);
      /* Guard against native never responding (e.g. device sleeping). */
      setTimeout(function() {
        if (_pending[id]) {
          delete _pending[id];
          reject(new Error("VaultAPI timeout: " + type));
        }
      }, 10000);
    });
  }

  /* ── localStorage shim ───────────────────────────────────────────────── */

  var _lsShim = {
    get length() {
      return Object.keys(_cache).length;
    },

    key: function(n) {
      var k = Object.keys(_cache)[n];
      return k !== undefined ? k : null;
    },

    getItem: function(key) {
      var k = String(key);
      return Object.prototype.hasOwnProperty.call(_cache, k) ? _cache[k] : null;
    },

    setItem: function(key, value) {
      var k = String(key);
      var v = String(value);
      _cache[k] = v;
      /* Fire-and-forget — no id, native will not send a response. */
      _post({ type: "ls_set", appId: _appId, key: k, value: v });
    },

    removeItem: function(key) {
      var k = String(key);
      delete _cache[k];
      _post({ type: "ls_delete", appId: _appId, key: k });
    },

    clear: function() {
      var keys = Object.keys(_cache);
      for (var i = 0; i < keys.length; i++) {
        delete _cache[keys[i]];
      }
      _post({ type: "ls_clear", appId: _appId });
    },
  };

  try {
    Object.defineProperty(window, "localStorage", {
      configurable: false,
      enumerable: true,
      get: function() { return _lsShim; },
    });
  } catch (e) {
    /* Some WebView builds already define localStorage non-configurable.
       Fall back to a best-effort assignment. */
    try { window.localStorage = _lsShim; } catch (_) {}
  }

  /* ── sessionStorage shim (mirrors localStorage for single-session apps) */
  var _session = {};
  var _ssShim = {
    get length() { return Object.keys(_session).length; },
    key: function(n) { var k = Object.keys(_session)[n]; return k !== undefined ? k : null; },
    getItem: function(key) { return Object.prototype.hasOwnProperty.call(_session, String(key)) ? _session[String(key)] : null; },
    setItem: function(key, value) { _session[String(key)] = String(value); },
    removeItem: function(key) { delete _session[String(key)]; },
    clear: function() { _session = {}; },
  };
  try {
    Object.defineProperty(window, "sessionStorage", {
      configurable: false, enumerable: true,
      get: function() { return _ssShim; },
    });
  } catch (e) {
    try { window.sessionStorage = _ssShim; } catch (_) {}
  }

  /* ── VaultAPI ────────────────────────────────────────────────────────── */

  window.VaultAPI = {
    /**
     * Persistent key-value store, backed by SQLite app_data table.
     * Data survives app restarts and is namespaced to this app_id.
     */
    db: {
      get: function(key) {
        return _bridge("db_get", { key: String(key) });
      },
      set: function(key, value) {
        return _bridge("db_set", { key: String(key), value: String(value) });
      },
      delete: function(key) {
        return _bridge("db_delete", { key: String(key) });
      },
      getAll: function() {
        return _bridge("db_get_all", {});
      },
    },

    /**
     * Native device capabilities.
     */
    device: {
      /** Trigger haptic feedback. style: "light" | "medium" | "heavy" | "success" | "warning" | "error" */
      haptic: function(style) {
        return _bridge("device_haptic", { style: style || "medium" });
      },
      /** Schedule an immediate local notification. */
      notify: function(opts) {
        return _bridge("device_notify", opts || {});
      },
      /** Open the native share sheet for a URL or text. */
      share: function(opts) {
        return _bridge("device_share", opts || {});
      },
    },

    /** Auth — Phase 2: cloud identity. Returns null until implemented. */
    auth: {
      getUser: function() {
        return _bridge("auth_get_user", {});
      },
    },

    /** Returns the app manifest (name, source_url, installed_at, etc.) */
    app: {
      getInfo: function() {
        return _bridge("app_get_info", {});
      },
    },

    /**
     * Secrets — secure per-app key store backed by native SecureStore.
     * Secret values are never exposed to WebView JS; only the native layer
     * can read them and inject them into outgoing HTTP requests.
     */
    secrets: {
      /** Persist a named secret for this app (e.g. an API key). */
      set: function(name, value) {
        return _bridge("secrets_set", { name: String(name), value: String(value) });
      },
      /**
       * Make an HTTP request with a stored secret injected into the headers.
       * Use the literal string "{{secret}}" as the value of any header —
       * the native layer will replace it with the actual secret before sending.
       * Returns { status, body } where body is the raw response text.
       */
      fetch: function(name, opts) {
        return _bridge("secrets_fetch", {
          name:    String(name),
          url:     opts.url,
          method:  opts.method  || "POST",
          headers: opts.headers || {},
          body:    opts.body    || null,
        });
      },
    },

    /**
     * Storage — native file picker + Supabase Storage upload.
     * Images are stored server-side; the WebView never holds raw binary data.
     */
    storage: {
      /**
       * Open a native file picker, upload the chosen image to cloud storage,
       * and return { uri, cancelled }.
       * "uri" is the Supabase Storage path; pass it to getUrl() for a preview URL.
       */
      upload: function(opts) {
        return _bridge("storage_upload", { source: (opts && opts.source) || "gallery" });
      },
      /**
       * Create a short-lived signed URL for a storage path returned by upload().
       * Returns { url }.
       */
      getUrl: function(uri) {
        return _bridge("storage_get_url", { uri: String(uri) });
      },
    },
  };

})();
true;
`;
}

/** Type declaration for the VaultAPI available inside mini-apps. */
export interface VaultAPI {
  db: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<boolean>;
    delete(key: string): Promise<boolean>;
    getAll(): Promise<Record<string, string>>;
  };
  device: {
    haptic(style?: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'): Promise<boolean>;
    notify(opts: { title?: string; body?: string }): Promise<boolean>;
    share(opts: { url?: string; title?: string; message?: string }): Promise<boolean>;
  };
  auth: {
    getUser(): Promise<null>;
  };
  app: {
    getInfo(): Promise<{
      app_id: string;
      name: string;
      source_url: string | null;
      installed_at: string;
      open_count: number;
    }>;
  };
  secrets: {
    /** Store a named secret in native SecureStore for this app. */
    set(name: string, value: string): Promise<boolean>;
    /**
     * Make an HTTP request natively with the stored secret injected
     * into any header value containing "{{secret}}".
     * Returns { status: number; body: string } or { error: string } if the
     * secret is not found.
     */
    fetch(
      name: string,
      opts: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string | null;
      }
    ): Promise<{ status: number; body: string } | { error: string }>;
  };
  storage: {
    /** Open native file picker and upload to Supabase Storage. Returns { uri, cancelled }. */
    upload(opts?: { source?: 'gallery' | 'files' }): Promise<{ uri: string; cancelled: false } | { cancelled: true }>;
    /** Create a 1-hour signed URL for a storage path from upload(). Returns { url }. */
    getUrl(uri: string): Promise<{ url: string }>;
  };
}

declare global {
  interface Window {
    VaultAPI: VaultAPI;
    __vaultRespond: (resp: { id: string; result: unknown; error: string | null }) => void;
    ReactNativeWebView?: { postMessage: (msg: string) => void };
  }
}
