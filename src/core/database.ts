import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;
let dbOpenPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Opens or re-opens the SQLite database, applying session-level PRAGMAs.
 * Uses a promise lock to prevent concurrent openDatabaseAsync calls (race condition).
 */
async function openFreshDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbOpenPromise) return dbOpenPromise;

  dbOpenPromise = (async () => {
    console.log('[Mnemosine DB] Opening fresh database connection...');
    const newDb = await SQLite.openDatabaseAsync('mnemosine.db');
    // Re-apply session-level PRAGMAs (these don't persist across connections)
    await newDb.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    db = newDb;
    return newDb;
  })();

  try {
    return await dbOpenPromise;
  } finally {
    dbOpenPromise = null;
  }
}

/**
 * Returns a validated SQLite connection. If the native handle has been
 * invalidated (NullPointerException on Android), automatically reopens.
 */
export const getDb = async (): Promise<SQLite.SQLiteDatabase> => {
  if (db) {
    try {
      // Lightweight ping — verifies the native handle is still alive
      // SELECT 1 on SQLite is < 1ms, negligible overhead
      await db.getFirstAsync('SELECT 1');
      return db;
    } catch (e) {
      console.warn('[Mnemosine DB] Native handle dead, will reopen.', e);
      db = null;
    }
  }
  return openFreshDb();
};

export const initDatabase = async () => {
  const database = await getDb();
  
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS user_profile (
      id TEXT PRIMARY KEY NOT NULL,
      birth_date TEXT,
      hometown TEXT,
      country TEXT,
      life_events TEXT
    );
    
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY NOT NULL,
      raw_text TEXT,
      audio_uri TEXT,
      fuzzy_date TEXT,
      start_date TEXT,
      end_date TEXT,
      timestamp_inferred INTEGER,
      sync_status TEXT DEFAULT 'DRAFT',
      sentiment_score REAL,
      time_context TEXT,
      space_context TEXT,
      created_at INTEGER DEFAULT (cast(strftime('%s','now') as int))
    );

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      metadata TEXT,
      parent_id TEXT,
      latitude REAL,
      longitude REAL,
      is_confirmed INTEGER DEFAULT 1,
      FOREIGN KEY (parent_id) REFERENCES entities(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS memory_entities (
      id TEXT PRIMARY KEY NOT NULL,
      memory_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      relationship_type TEXT,
      FOREIGN KEY (memory_id) REFERENCES memories (id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES entities (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inbox_tasks (
      id TEXT PRIMARY KEY NOT NULL,
      memory_id TEXT,
      entity_id TEXT,
      ambiguity_type TEXT,
      question TEXT,
      status TEXT DEFAULT 'PENDING',
      created_at INTEGER DEFAULT (cast(strftime('%s','now') as int)),
      FOREIGN KEY (memory_id) REFERENCES memories (id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES entities (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS entity_aliases (
      id TEXT PRIMARY KEY NOT NULL,
      alias TEXT NOT NULL COLLATE NOCASE,
      entity_id TEXT NOT NULL,
      FOREIGN KEY (entity_id) REFERENCES entities (id) ON DELETE CASCADE
    );
  `);

  // Migraciones seguras para bases de datos existentes en desarrollo
  const migrations = [
    'ALTER TABLE user_profile ADD COLUMN country TEXT;',
    'ALTER TABLE memories ADD COLUMN start_date TEXT;',
    'ALTER TABLE memories ADD COLUMN end_date TEXT;',
    'ALTER TABLE entities ADD COLUMN parent_id TEXT;',
    'ALTER TABLE entities ADD COLUMN latitude REAL;',
    'ALTER TABLE entities ADD COLUMN longitude REAL;',
    'ALTER TABLE entities ADD COLUMN is_confirmed INTEGER DEFAULT 1;',
    `CREATE TABLE IF NOT EXISTS entity_aliases (
      id TEXT PRIMARY KEY NOT NULL,
      alias TEXT NOT NULL COLLATE NOCASE,
      entity_id TEXT NOT NULL,
      FOREIGN KEY (entity_id) REFERENCES entities (id) ON DELETE CASCADE
    );`,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_alias_unique ON entity_aliases(alias);',
    'ALTER TABLE memories ADD COLUMN time_context TEXT;',
    'ALTER TABLE memories ADD COLUMN space_context TEXT;'
  ];

  for (const query of migrations) {
    try {
      await database.execAsync(query);
    } catch (e) {
      // Ignorar si la columna ya existe
    }
  }
};

export const inheritCoordinatesFromParent = async (childId: string, parentId: string) => {
  try {
    const database = await getDb();
    
    // Only inherit if child has no coordinates yet — never overwrite confirmed coordinates
    const child = await database.getFirstAsync<{latitude: number | null}>('SELECT latitude FROM entities WHERE id = ?', childId);
    if (child?.latitude !== null && child?.latitude !== undefined) {
      console.log(`Child ${childId} already has coordinates, skipping inheritance.`);
      return;
    }
    
    const parent = await database.getFirstAsync<{latitude: number | null, longitude: number | null}>(
      'SELECT latitude, longitude FROM entities WHERE id = ?', parentId
    );
    
    if (parent && parent.latitude !== null && parent.longitude !== null) {
      // Jitter aleatorio de +/- 0.0001 a 0.0003 (aprox 10-30 metros) para que no se superpongan
      const jitterLat = (Math.random() - 0.5) * 0.0004;
      const jitterLon = (Math.random() - 0.5) * 0.0004;
      
      await database.runAsync(
        'UPDATE entities SET latitude = ?, longitude = ? WHERE id = ?',
        parent.latitude + jitterLat, parent.longitude + jitterLon, childId
      );
      console.log(`Inherited coordinates for ${childId} from ${parentId} with jitter.`);
    }
  } catch (e) {
    console.error('Failed to inherit coordinates:', e);
  }
};
