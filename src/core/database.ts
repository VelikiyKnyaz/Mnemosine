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
      longitude REAL
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
  `);

  // Migraciones seguras para bases de datos existentes en desarrollo
  const migrations = [
    'ALTER TABLE memories ADD COLUMN start_date TEXT;',
    'ALTER TABLE memories ADD COLUMN end_date TEXT;',
    'ALTER TABLE entities ADD COLUMN parent_id TEXT;',
    'ALTER TABLE entities ADD COLUMN latitude REAL;',
    'ALTER TABLE entities ADD COLUMN longitude REAL;'
  ];

  for (const query of migrations) {
    try {
      await database.execAsync(query);
    } catch (e) {
      // Ignorar si la columna ya existe
    }
  }
};
