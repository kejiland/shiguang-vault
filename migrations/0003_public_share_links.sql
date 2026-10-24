-- Capability links allow selected media to be previewed outside the private vault.
-- The raw token is encrypted for curator retrieval; only its hash is used for lookup.
CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_encrypted TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_share_links_asset ON share_links(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_share_links_expiry ON share_links(expires_at);
