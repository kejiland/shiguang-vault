export type AssetKind = "image" | "music";

export interface SiteSettings {
  site_title: string;
  site_subtitle: string;
  site_description: string;
  site_visibility: "public" | "private";
  hero_eyebrow: string;
  accent_color: string;
  allow_download: boolean;
  default_repo_id: string;
  footer_text: string;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  repoId: string;
  repoLabel: string | null;
  repoProvider: string | null;
  path: string;
  filename: string;
  mimeType: string;
  size: number;
  title: string;
  artist: string | null;
  album: string | null;
  tags: string[];
  width: number | null;
  height: number | null;
  duration: number | null;
  coverUrl: string | null;
  mirrorTotal: number;
  mirrorSynced: number;
  mediaUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface Repository {
  id: string;
  provider: "github" | "gitlab";
  label: string;
  owner: string;
  repo: string;
  branch: string;
  rootPath: string;
  backupOf: string | null;
  enabled: boolean;
  isDefault: boolean;
  hasToken: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  assetCount?: number;
  backupLabel?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BootstrapData {
  initialized: boolean;
  settings: SiteSettings;
}

export interface OverviewData {
  settings: SiteSettings;
  counts: Record<string, number>;
  repositories: Array<Pick<Repository, "id" | "provider" | "label" | "owner" | "repo" | "branch" | "rootPath" | "isDefault" | "lastSyncedAt" | "lastSyncError">>;
}

export interface AuthState {
  authenticated: boolean;
  initialized: boolean;
  mustChangePassword: boolean;
  csrfToken: string | null;
  expiresAt: string | null;
}

export type AdminView = "overview" | "library" | "upload" | "repositories" | "appearance" | "logs";