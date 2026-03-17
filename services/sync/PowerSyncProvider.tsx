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

/**
 * Force PowerSync to reconnect and re-evaluate sync rules buckets.
 * Call this after joining a shared instance so the new member
 * immediately receives other members' shared_app_data rows.
 */
export async function reconnectPowerSync(): Promise<void> {
  try {
    console.log('[PowerSync] reconnecting to refresh sync buckets...');
    await powerSyncDb.disconnect();
    await powerSyncDb.connect(connector);
    console.log('[PowerSync] reconnected');
  } catch (err) {
    console.error('[PowerSync] reconnect error:', err);
  }
}

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
