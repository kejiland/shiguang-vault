PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_throttle (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  first_failure_at TEXT NOT NULL,
  blocked_until TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'gitlab')),
  label TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  root_path TEXT NOT NULL DEFAULT '',
  token_encrypted TEXT,
  backup_of TEXT REFERENCES repositories(id) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  last_sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_repositories_identity
  ON repositories(provider, owner, repo, branch, root_path);
CREATE INDEX IF NOT EXISTS idx_repositories_backup ON repositories(backup_of);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'music')),
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE RESTRICT,
  path TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  remote_sha TEXT,
  title TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  width INTEGER,
  height INTEGER,
  duration_seconds REAL,
  cover_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_repo_path ON assets(repo_id, path);
CREATE INDEX IF NOT EXISTS idx_assets_kind_created ON assets(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_repo ON assets(repo_id);

CREATE TABLE IF NOT EXISTS asset_mirrors (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed', 'deleted')),
  remote_sha TEXT,
  synced_at TEXT,
  error TEXT,
  PRIMARY KEY (asset_id, repo_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_mirrors_repo_status ON asset_mirrors(repo_id, status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);