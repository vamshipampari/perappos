/**
 * lib/vaultShimSync.ts
 *
 * Generates an UPGRADED vault shim with base-state tracking, write queue,
 * and debouncing for shared (collaborative) apps.
 *
 * This does NOT replace lib/vaultShim.ts.
 * Use this generator specifically when opening a shared app (instance_id is set).
 * For local-only apps, keep using buildVaultShim from lib/vaultShim.ts.
 *
 * Pattern matches the working shim exactly:
 *   - Replaces window.localStorage entirely via Object.defineProperty(window, "localStorage")
 *   - Uses __vaultRespond callback for Promise-based bridge responses
 *   - ES5 throughout (no const/let/arrow functions in emitted code)
 *   - Fire-and-forget _post() for non-response messages
 *
 * Usage in app/app/[id].tsx:
 *
 *   import { buildSyncShim } from '@/lib/vaultShimSync';
 *   import { buildVaultShim } from '@/lib/vaultShim';
 *
 *   const isShared = !!app.instance_id;
 *   const shimJS = isShared
 *     ? buildSyncShim(app.app_id, preloadedData, preloadedVersions)
 *     : buildVaultShim(app.app_id, preloadedData);
 */

export function buildSyncShim(
  appId: string,
  preloadedData: Record<string, string>,
  preloadedVersions: Record<string, number>,
): string {
  const safeId = JSON.stringify(appId);
  const safeData = JSON.stringify(preloadedData);
  const safeVersions = JSON.stringify(preloadedVersions);

  return `
(function() {
  "use strict";

  /* ── State ───────────────────────────────────────────────────────────── */
  // Check if we have saved state from a _VaultSyncPush reload.
  // window.name survives location.reload() — we use it to carry updated
  // cache/versions across the reload so the app re-mounts with fresh data.
  var _savedState = null;
  try {
    if (window.name && window.name.charAt(0) === '{') {
      _savedState = JSON.parse(window.name);
      if (_savedState && _savedState.__vault) {
        window.name = '';
      } else {
        _savedState = null;
      }
    }
  } catch(e) { _savedState = null; }

  var _cache = (_savedState && _savedState.cache) || ${safeData};
  var _baseState = (_savedState && _savedState.base) || ${safeData};
  var _keyVersions = (_savedState && _savedState.versions) || ${safeVersions};
  var _appId = ${safeId};

  var _pageLoadedAt = Date.now();
  var _firstInteractionAt = null;

  /* ── Write queue ─────────────────────────────────────────────────────── */
  var _writeQueue = [];
  var _queueProcessing = false;
  var _pendingDebounce = {};
  var DEBOUNCE_MS = 150;
  var BASE_SIZE_LIMIT = 32768;

  /* ── Promise registry (same pattern as working shim) ─────────────────── */
  var _pending = {};
  var _seq = 0;

  function _post(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  /**
   * Called by native side to resolve/reject pending calls.
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
      setTimeout(function() {
        if (_pending[id]) {
          delete _pending[id];
          reject(new Error("VaultAPI timeout: " + type));
        }
      }, 10000);
    });
  }

  /* ── Interaction tracking ────────────────────────────────────────────── */
  var _interactionEvents = ["touchstart", "click", "keydown"];
  function _onInteraction() {
    if (!_firstInteractionAt) _firstInteractionAt = Date.now();
    for (var i = 0; i < _interactionEvents.length; i++) {
      document.removeEventListener(_interactionEvents[i], _onInteraction, true);
    }
  }
  for (var _ie = 0; _ie < _interactionEvents.length; _ie++) {
    document.addEventListener(_interactionEvents[_ie], _onInteraction, true);
  }

  /* ── Quick hash (DJB2, for no-op detection) ──────────────────────────── */
  function _quickHash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) & 0xFFFFFFFF;
    }
    return h.toString(36);
  }

  function _genWriteId() {
    return "w_" + Date.now().toString(36) + "_" + Math.random().toString(36).substr(2, 8);
  }

  /* ── Write queue + debouncing ────────────────────────────────────────── */

  function _enqueueWrite(key) {
    if (_pendingDebounce[key]) clearTimeout(_pendingDebounce[key]);

    _pendingDebounce[key] = setTimeout(function() {
      delete _pendingDebounce[key];

      var currentValue = _cache[key];
      if (currentValue === undefined) return;

      var baseVal = Object.prototype.hasOwnProperty.call(_baseState, key) ? _baseState[key] : null;

      var payload = {
        type: "ls_set_sync",
        id: String(++_seq),
        appId: _appId,
        key: key,
        value: currentValue,
        baseVersion: _keyVersions[key] || 0,
        baseHash: baseVal !== null ? _quickHash(baseVal) : null,
        baseValue: (baseVal !== null && baseVal.length < BASE_SIZE_LIMIT) ? baseVal : null,
        clientWriteId: _genWriteId(),
        pageAge: Date.now() - _pageLoadedAt,
        hadInteraction: _firstInteractionAt !== null,
        timestamp: Date.now()
      };

      _writeQueue.push(payload);
      _processQueue();
    }, DEBOUNCE_MS);
  }

  function _processQueue() {
    if (_queueProcessing || _writeQueue.length === 0) return;
    _queueProcessing = true;

    var payload = _writeQueue.shift();

    /* Use the __vaultRespond pattern for ack */
    new Promise(function(resolve, reject) {
      _pending[payload.id] = { resolve: resolve, reject: reject };
      _post(payload);
      setTimeout(function() {
        if (_pending[payload.id]) {
          delete _pending[payload.id];
          reject(new Error("sync write timeout"));
        }
      }, 10000);
    }).then(function(result) {
      if (result) {
        _keyVersions[payload.key] = result.newVersion || ((_keyVersions[payload.key] || 0) + 1);

        if (result.newValue) {
          /* Bridge merged the value — update cache and base */
          _cache[payload.key] = result.newValue;
          _baseState[payload.key] = result.newValue;
        } else {
          /* Bridge accepted our value as-is */
          _baseState[payload.key] = _cache[payload.key];
        }
      }
      _queueProcessing = false;
      _processQueue();
    })["catch"](function() {
      _queueProcessing = false;
      _processQueue();
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
      _enqueueWrite(k);
    },

    removeItem: function(key) {
      var k = String(key);
      delete _cache[k];
      delete _baseState[k];
      delete _keyVersions[k];
      _post({ type: "ls_delete", appId: _appId, key: k });
    },

    clear: function() {
      var keys = Object.keys(_cache);
      for (var i = 0; i < keys.length; i++) {
        delete _cache[keys[i]];
      }
      _baseState = {};
      _keyVersions = {};
      _post({ type: "ls_clear", appId: _appId });
    }
  };

  try {
    Object.defineProperty(window, "localStorage", {
      configurable: false,
      enumerable: true,
      get: function() { return _lsShim; }
    });
  } catch (e) {
    try { window.localStorage = _lsShim; } catch (_) {}
  }

  /* ── sessionStorage shim ─────────────────────────────────────────────── */
  var _session = {};
  var _ssShim = {
    get length() { return Object.keys(_session).length; },
    key: function(n) { var k = Object.keys(_session)[n]; return k !== undefined ? k : null; },
    getItem: function(key) { return Object.prototype.hasOwnProperty.call(_session, String(key)) ? _session[String(key)] : null; },
    setItem: function(key, value) { _session[String(key)] = String(value); },
    removeItem: function(key) { delete _session[String(key)]; },
    clear: function() { _session = {}; }
  };
  try {
    Object.defineProperty(window, "sessionStorage", {
      configurable: false, enumerable: true,
      get: function() { return _ssShim; }
    });
  } catch (e) {
    try { window.sessionStorage = _ssShim; } catch (_) {}
  }

  /* ── VaultAPI (identical shape to local shim) ────────────────────────── */

  window.VaultAPI = {
    db: {
      get: function(key) { return _bridge("db_get", { key: String(key) }); },
      set: function(key, value) { return _bridge("db_set", { key: String(key), value: String(value) }); },
      delete: function(key) { return _bridge("db_delete", { key: String(key) }); },
      getAll: function() { return _bridge("db_get_all", {}); }
    },
    device: {
      haptic: function(style) { return _bridge("device_haptic", { style: style || "medium" }); },
      notify: function(opts) { return _bridge("device_notify", opts || {}); },
      share: function(opts) { return _bridge("device_share", opts || {}); }
    },
    auth: {
      getUser: function() { return _bridge("auth_get_user", {}); }
    },
    app: {
      getInfo: function() { return _bridge("app_get_info", {}); }
    }
  };

  /* ── Live sync push: receive remote updates from native ───────────── */

  var _reloadTimer = null;
  var RELOAD_DEBOUNCE_MS = 800;

  window._VaultSyncPush = function(updates) {
    // updates = [{ key: "...", value: "...", version: N }, ...]
    if (!updates || !updates.length) return;
    var changedKeys = [];
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      var currentVersion = _keyVersions[u.key] || 0;
      // Only apply if remote version is strictly newer
      if (u.version > currentVersion) {
        _cache[u.key] = u.value;
        _baseState[u.key] = u.value;
        _keyVersions[u.key] = u.version;
        changedKeys.push(u.key);
      }
    }
    if (changedKeys.length === 0) return;

    // 1. Dispatch StorageEvent per key (apps with storage listeners / useLocalStorage hooks)
    try {
      for (var j = 0; j < changedKeys.length; j++) {
        var se = new StorageEvent('storage', {
          key: changedKeys[j],
          newValue: _cache[changedKeys[j]],
          storageArea: window.localStorage
        });
        window.dispatchEvent(se);
      }
    } catch(e) {}

    // 2. Dispatch custom event for VaultAPI-aware apps
    try {
      window.dispatchEvent(new CustomEvent('vaultSyncUpdate', {
        detail: { keys: changedKeys }
      }));
    } catch(e) {}

    // 3. Save state to window.name (survives location.reload) and reload.
    //    This is the only universal approach that works across ALL frameworks —
    //    React useState initializers, Vue refs, Svelte stores, vanilla JS —
    //    because a full reload forces component remount and re-reads localStorage.
    //    Debounced to 800ms to batch rapid successive updates.
    if (_reloadTimer) clearTimeout(_reloadTimer);
    _reloadTimer = setTimeout(function() {
      try {
        window.name = JSON.stringify({
          __vault: true,
          cache: _cache,
          base: _baseState,
          versions: _keyVersions
        });
        location.reload();
      } catch(e) {}
    }, RELOAD_DEBOUNCE_MS);
  };

})();
true;
`;
}
