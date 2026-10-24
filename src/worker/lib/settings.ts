import type { AppEnv, SiteSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import type { Context } from "hono";

export async function getSettings(c: Context<AppEnv>): Promise<SiteSettings> {
  const rows = await c.env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const stored: Record<string, unknown> = {};
  for (const row of rows.results) {
    try { stored[row.key] = JSON.parse(row.value); } catch { stored[row.key] = row.value; }
  }
  return { ...DEFAULT_SETTINGS, ...stored } as SiteSettings;
}

export async function saveSettings(c: Context<AppEnv>, values: Record<string, unknown>): Promise<SiteSettings> {
  const current = await getSettings(c);
  const allowed = Object.keys(DEFAULT_SETTINGS) as (keyof SiteSettings)[];
  const statements: D1PreparedStatement[] = [];
  const now = new Date().toISOString();
  for (const key of allowed) {
    if (!(key in values)) continue;
    let value = values[key];
    if (key === "site_visibility" && value !== "public" && value !== "private") value = current[key];
    if (typeof DEFAULT_SETTINGS[key] === "boolean") value = Boolean(value);
    if (typeof DEFAULT_SETTINGS[key] === "string") value = String(value ?? "").slice(0, key.includes("subtitle") || key.includes("footer") ? 500 : 160);
    statements.push(
      c.env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .bind(key, JSON.stringify(value), now)
    );
  }
  if (statements.length) await c.env.DB.batch(statements);
  return getSettings(c);
}

export function publicSettings(settings: SiteSettings) {
  // Bootstrap is intentionally public so the shell can render before login.
  // Keep private-mode metadata out of that response; only the display switch
  // and safe visual fields are exposed until a session exists.
  if (settings.site_visibility === "private") {
    return {
      site_title: settings.site_title,
      site_subtitle: "这是一座私人馆藏，请登录后继续。",
      site_description: "私人图片与音乐云端收藏",
      site_visibility: settings.site_visibility,
      hero_eyebrow: "PRIVATE COLLECTION",
      accent_color: settings.accent_color,
      allow_download: settings.allow_download,
      footer_text: settings.footer_text
    };
  }
  return {
    site_title: settings.site_title,
    site_subtitle: settings.site_subtitle,
    site_description: settings.site_description,
    site_visibility: settings.site_visibility,
    hero_eyebrow: settings.hero_eyebrow,
    accent_color: settings.accent_color,
    allow_download: settings.allow_download,
    footer_text: settings.footer_text
  };
}