/**
 * Folder management hook — queries and mutates the local `folders` table.
 *
 * Also provides helper actions: createFolder, renameFolder, deleteFolder,
 * and moveAppToFolder. All operations are local-only (no PowerSync sync).
 */

import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';

import { useDatabase } from '@/hooks/useDatabase';
import type { Folder } from '@/types';

export type { Folder };

export interface UseFoldersResult {
  folders: Folder[];
  loading: boolean;
  refresh: () => Promise<void>;
  createFolder: (name: string, parentFolderId: string | null) => Promise<Folder>;
  renameFolder: (folderId: string, newName: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<'deleted' | 'has_apps' | 'has_subfolders'>;
  deleteFolderAndContents: (folderId: string) => Promise<void>;
  moveAppToFolder: (appId: string, targetFolderId: string | null) => Promise<void>;
}

export function useFolders(parentFolderId: string | null): UseFoldersResult {
  const db = useDatabase();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows =
        parentFolderId === null
          ? await db.getAllAsync<Folder>(
              'SELECT * FROM folders WHERE parent_folder_id IS NULL ORDER BY order_index ASC, name ASC'
            )
          : await db.getAllAsync<Folder>(
              'SELECT * FROM folders WHERE parent_folder_id = ? ORDER BY order_index ASC, name ASC',
              [parentFolderId]
            );
      setFolders(rows);
    } finally {
      setLoading(false);
    }
  }, [db, parentFolderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createFolder = useCallback(
    async (name: string, parent: string | null): Promise<Folder> => {
      const folderId = Crypto.randomUUID();
      const now = new Date().toISOString();
      await db.runAsync(
        `INSERT INTO folders (folder_id, parent_folder_id, name, icon_emoji, created_at, order_index)
         VALUES (?, ?, ?, '📁', ?, 0)`,
        [folderId, parent ?? null, name.trim(), now]
      );
      await refresh();
      return { folder_id: folderId, parent_folder_id: parent, name: name.trim(), icon_emoji: '📁', created_at: now, order_index: 0 };
    },
    [db, refresh]
  );

  const renameFolder = useCallback(
    async (folderId: string, newName: string): Promise<void> => {
      await db.runAsync('UPDATE folders SET name = ? WHERE folder_id = ?', [newName.trim(), folderId]);
      await refresh();
    },
    [db, refresh]
  );

  /**
   * Tries to delete a folder. Returns:
   *   'deleted'         — folder was empty and deleted
   *   'has_apps'        — folder contains apps; caller should confirm
   *   'has_subfolders'  — folder contains sub-folders; caller should confirm
   */
  const deleteFolder = useCallback(
    async (folderId: string): Promise<'deleted' | 'has_apps' | 'has_subfolders'> => {
      const [appRow, subRow] = await Promise.all([
        db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM apps WHERE folder_id = ?', [folderId]),
        db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM folders WHERE parent_folder_id = ?', [folderId]),
      ]);

      if ((subRow?.n ?? 0) > 0) return 'has_subfolders';
      if ((appRow?.n ?? 0) > 0) return 'has_apps';

      await db.runAsync('DELETE FROM folders WHERE folder_id = ?', [folderId]);
      await refresh();
      return 'deleted';
    },
    [db, refresh]
  );

  /** Hard-deletes folder and all apps inside it (used after user confirms). */
  const deleteFolderAndContents = useCallback(
    async (folderId: string): Promise<void> => {
      await db.runAsync('DELETE FROM app_data WHERE app_id IN (SELECT app_id FROM apps WHERE folder_id = ?)', [folderId]);
      await db.runAsync('DELETE FROM apps WHERE folder_id = ?', [folderId]);
      await db.runAsync('DELETE FROM folders WHERE folder_id = ?', [folderId]);
      await refresh();
    },
    [db, refresh]
  );

  const moveAppToFolder = useCallback(
    async (appId: string, targetFolderId: string | null): Promise<void> => {
      await db.runAsync('UPDATE apps SET folder_id = ? WHERE app_id = ?', [targetFolderId, appId]);
      // No need to call refresh here — caller controls when to refresh.
    },
    [db]
  );

  return { folders, loading, refresh, createFolder, renameFolder, deleteFolder, deleteFolderAndContents, moveAppToFolder };
}

/** Fetch a single folder by ID (one-shot, not reactive). */
export async function getFolderById(
  db: ReturnType<typeof useDatabase>,
  folderId: string
): Promise<Folder | null> {
  return db.getFirstAsync<Folder>('SELECT * FROM folders WHERE folder_id = ?', [folderId]);
}

/** Fetch all root-level folders (parent_folder_id IS NULL). */
export async function getAllFolders(
  db: ReturnType<typeof useDatabase>
): Promise<Folder[]> {
  return db.getAllAsync<Folder>('SELECT * FROM folders ORDER BY order_index ASC, name ASC');
}
