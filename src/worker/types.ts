export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENCRYPTION_KEY?: string;
}

export interface RepositoryRow {
  id: string;
  provider: "github" | "gitlab";
  label: string;
  owner: string;
  repo: string;
  branch: string;
  root_path: string;
  token_encrypted: string | null;
  backup_of: string | null;
  enabled: number;
  is_default: number;
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetRow {
  id: string;
  kind: "image" | "music";
  repo_id: string;
  path: string;
  filename: string;
  mime_type: string;
  size: number;
  remote_sha: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  tags: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  cover_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShareLinkRow {
  id: string;
  asset_id: string;
  token_hash: string;
  token_encrypted: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface SessionRow {
  id: string;
  token_hash: string;
  csrf_token: string;
  expires_at: string;
  created_at: string;
  user_agent: string | null;
}

export interface AppVariables {
  session: SessionRow | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: AppVariables;
};

export const DEFAULT_SETTINGS = {
  site_title: "拾光储藏室",
  site_subtitle: "把喜欢的光影与声音，收纳成一座私人博物馆。",
  site_description: "私人图片与音乐云端收藏",
  site_visibility: "private",
  hero_eyebrow: "PRIVATE COLLECTION",
  accent_color: "#b45f3f",
  default_repo_id: "",
  allow_download: true,
  footer_text: "拾光储藏室 · 收藏那些值得反复看见与听见的瞬间"
} as const;

export type SiteSettings = {
  site_title: string;
  site_subtitle: string;
  site_description: string;
  site_visibility: "public" | "private";
  hero_eyebrow: string;
  accent_color: string;
  default_repo_id: string;
  allow_download: boolean;
  footer_text: string;
};
