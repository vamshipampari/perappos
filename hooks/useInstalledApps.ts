import { useEffect, useState, useCallback } from 'react';
import { useDatabase } from './useDatabase';

export interface InstalledApp {
  app_id: string;
  name: string;
  icon_emoji: string;
  icon_bg_color: string;
  bundle_path: string;
  source_type: string;
  source_url: string | null;
  bundle_hash: string | null;
  auto_update: number;
  permissions: string;
  bundle_size: number;
  installed_at: string;
  updated_at: string;
  last_opened: string | null;
  open_count: number;
}

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
