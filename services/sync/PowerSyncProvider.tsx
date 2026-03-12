import React, { createContext, useContext, useEffect, useState } from 'react';
import { PowerSyncDatabase } from '@powersync/react-native';
import { PowerSyncSchema } from './schema';
import { SupabaseConnector } from './SupabaseConnector';
import { supabase } from '../supabase';
import '@azure/core-asynciterator-polyfill';

const powerSyncDb = new PowerSyncDatabase({
  schema: PowerSyncSchema,
  database: { dbFilename: 'powersync.db' },
});

const connector = new SupabaseConnector();

interface SyncContextType {
  db: PowerSyncDatabase;
  isConnected: boolean;
  isSyncing: boolean;
}

const SyncContext = createContext<SyncContextType>({
  db: powerSyncDb,
  isConnected: false,
  isSyncing: false,
});

export const usePowerSync = () => useContext(SyncContext);

export function PowerSyncProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session) {
          try {
            console.log('[PowerSync] connecting...');
            await powerSyncDb.connect(connector);
            setIsConnected(true);
            console.log('[PowerSync] connected');
            // ── QUEUE FLUSH ───────────────────────────────────────────────
            // Clears stuck CRUD entries with invalid compound-string IDs
            // written by the merge handler. These can't be matched to
            // Supabase UUID rows and block the upload queue.
            try {
              const batch = await powerSyncDb.getCrudBatch(200);
              if (batch && batch.crud.length > 0) {
                console.log('[PowerSync] clearing', batch.crud.length, 'stuck queue entries');
                await batch.complete();
                console.log('[PowerSync] queue cleared');
              }
            } catch (flushErr) {
              console.warn('[PowerSync] queue flush error:', flushErr);
            }
            // ── END QUEUE FLUSH ───────────────────────────────────────────
          } catch (error) {
            console.error('[PowerSync] error:', error);
          }
        } else {
          await powerSyncDb.disconnect();
          setIsConnected(false);
          console.log('[PowerSync] disconnected');
        }
      }
    );

    // Check existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        console.log('[PowerSync] connecting (existing session)...');
        powerSyncDb.connect(connector)
          .then(async () => {
            setIsConnected(true);
            console.log('[PowerSync] connected (existing session)');
            // ── QUEUE FLUSH ───────────────────────────────────────────────
            try {
              const batch = await powerSyncDb.getCrudBatch(200);
              if (batch && batch.crud.length > 0) {
                console.log('[PowerSync] clearing', batch.crud.length, 'stuck queue entries');
                await batch.complete();
                console.log('[PowerSync] queue cleared');
              }
            } catch (flushErr) {
              console.warn('[PowerSync] queue flush error:', flushErr);
            }
            // ── END QUEUE FLUSH ───────────────────────────────────────────
          })
          .catch((error) => {
            console.error('[PowerSync] error (existing session):', error);
          });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <SyncContext.Provider value={{ db: powerSyncDb, isConnected, isSyncing }}>
      {children}
    </SyncContext.Provider>
  );
}
