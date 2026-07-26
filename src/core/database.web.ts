/**
 * Snack's web runtime cannot bundle expo-sqlite's WASM worker from a Git
 * repository. This lightweight adapter keeps the browser preview navigable.
 * Android and iOS resolve database.ts and retain the real SQLite database.
 */

type WebRunResult = {
  changes: number;
  lastInsertRowId: number;
};

const webDatabase = {
  async execAsync(_source: string): Promise<void> {},

  async runAsync(_source: string, ..._params: unknown[]): Promise<WebRunResult> {
    return { changes: 0, lastInsertRowId: 0 };
  },

  async getFirstAsync<T = unknown>(
    _source: string,
    ..._params: unknown[]
  ): Promise<T | null> {
    return null;
  },

  async getAllAsync<T = unknown>(
    _source: string,
    ..._params: unknown[]
  ): Promise<T[]> {
    return [];
  },

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    await task();
  },
};

export const getDb = async () => webDatabase;

export const initDatabase = async (): Promise<void> => {};

export const inheritCoordinatesFromParent = async (
  _childId: string,
  _parentId: string
): Promise<void> => {};
