import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export const getDb = async () => {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('mnemosine.db');
  return db;
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
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_alias_unique ON entity_aliases(alias);'
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
