export const DEFAULT_SETTINGS = {
  site_title: "拾光储藏室",
  site_subtitle: "把喜欢的光影与声音，收纳成一座私人博物馆。",
  site_description: "私人图片与音乐云端收藏",
  site_visibility: "private" as const,
  hero_eyebrow: "PRIVATE COLLECTION",
  accent_color: "#b45f3f",
  allow_download: true,
  default_repo_id: "",
  footer_text: "拾光储藏室 · 收藏那些值得反复看见与听见的瞬间"
};

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "从未";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(value));
}

export function formatDuration(seconds: number | null): string {
  if (!seconds) return "--:--";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function colorWithAlpha(hex: string, alpha: number): string {
  const cleaned = hex.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(cleaned)) return `rgba(180,95,63,${alpha})`;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function downloadUrl(asset: { mediaUrl: string; filename: string }): string {
  return `${asset.mediaUrl}?download=${encodeURIComponent(asset.filename)}`;
}