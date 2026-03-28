---
name: test-writing
description: Write tests for new Cottix functions, hooks, bridge handlers, or components. Auto-activates when new code is written — especially for VaultAPI bridge, PowerSync sync logic, merge handlers, WebView shim, and custom hooks.
---

## Testing in Cottix

### What to test (priority order)

1. bridge-merge-handler.ts — each merge strategy separately (noop, fast_path, array_merge, object_merge, lww)
2. vaultShimSync.ts — localStorage interception, message format
3. Custom hooks — useInstalledApps, useDatabase, useGatekeeper
4. Collaboration service — shared instance creation, member join

### Test patterns

**Hooks:**

```typescript
import { renderHook } from '@testing-library/react-native';
import { useInstalledApps } from '../hooks/useInstalledApps';

it('returns empty array when no apps installed', async () => {
  const { result } = renderHook(() => useInstalledApps());
  expect(result.current).toEqual([]);
});
```

**Merge strategies:**
Test each strategy independently with known inputs and expected outputs.
Don't test them combined — isolation catches regressions faster.

**Bridge handlers:**
Test message round-trips, not just one direction.
Mock the WebView ref for injectJavaScript calls.

### What NOT to test

- UI snapshots (they break constantly and add no value here)
- PowerSync internals (integration concern, not unit test)
- Supabase auth flows (integration, use Supabase testing tools)

### Run tests

```bash
npx jest path/to/file.test.ts    # single file
npx jest --testPathPattern merge  # pattern match
```
