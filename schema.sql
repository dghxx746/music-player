-- AuraFlow Music Player - Cloudflare D1 Schema
-- Run with: wrangler d1 execute auraflow-music-db --file=schema.sql

CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  size INTEGER,
  duration REAL,
  r2_key TEXT NOT NULL,
  favorite INTEGER DEFAULT 0,
  play_count INTEGER DEFAULT 0,
  last_position REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_songs_user_id ON songs(user_id);
CREATE INDEX IF NOT EXISTS idx_songs_created_at ON songs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_songs_favorite ON songs(user_id, favorite);