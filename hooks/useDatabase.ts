import { useSQLiteContext } from 'expo-sqlite';

export function useDatabase() {
  return useSQLiteContext();
}
