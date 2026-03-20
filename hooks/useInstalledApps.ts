import { useEffect, useState, useCallback } from 'react';
import { useDatabase } from './useDatabase';
import type { InstalledApp } from '@/types';

export type { InstalledApp };

export function useInstalledApps() {
  const db = useDatabase();
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await db.getAllAsync<InstalledApp>(
        'SELECT * FROM apps ORDER BY installed_at DESC'
      );
      setApps(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const recordOpen = useCallback(
    async (appId: string) => {
      await db.runAsync(
        `UPDATE apps SET last_opened = datetime('now'), open_count = open_count + 1 WHERE app_id = ?`,
        appId
      );
    },
    [db]
  );

  return { apps, loading, error, refresh, recordOpen };
}
