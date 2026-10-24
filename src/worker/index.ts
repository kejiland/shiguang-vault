import { Hono } from "hono";
import type { AppEnv, AssetRow, RepositoryRow } from "./types";
import { getSettings, publicSettings } from "./lib/settings";
import { assetJson, readAssetFile } from "./lib/media";
import { currentSession } from "./lib/auth";

type AssetWithRepo = AssetRow & {
  repo_label: string;
  repo_provider: string;
  mirror_synced: number;
  mirror_total: number;
};

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "SAMEORIGIN");
});

app.get("/api/health", (c) => c.json({ ok: true, service: "shiguang-vault", time: new Date().toISOString() }));

app.get("/api/bootstrap", async (c) => {
  const settings = await getSettings(c);
  const initialized = Boolean(await c.env.DB.prepare("SELECT id FROM admin_credentials WHERE id = 1").first());
  return c.json({ initialized, settings: publicSettings(settings) });
});

app.get("/api/settings", async (c) => {
  const settings = await getSettings(c);
  return c.json({ settings: publicSettings(settings) });
});

app.get("/api/public/overview", async (c) => {
  const settings = await getSettings(c);
  const session = await currentSession(c);
  if (settings.site_visibility === "private" && !session) {
    return c.json({ error: "这是私人馆藏，请从工作台登录后查看。" }, 403);
  }
  const counts = await c.env.DB.prepare(
    "SELECT kind, COUNT(*) AS count FROM assets GROUP BY kind"
  ).all<{ kind: string; count: number }>();
  const repos = await c.env.DB.prepare(
    "SELECT id, provider, label, owner, repo, branch, root_path, is_default, last_synced_at, last_sync_error FROM repositories WHERE enabled = 1 ORDER BY is_default DESC, label ASC"
  ).all<Omit<RepositoryRow, "token_encrypted" | "backup_of" | "created_at" | "updated_at">>();
  return c.json({
    // An authenticated curator must see the real collection copy instead of
    // the private landing placeholder used for anonymous visitors.
    settings: settings.site_visibility === "private" && session ? settings : publicSettings(settings),
    counts: Object.fromEntries(counts.results.map((r) => [r.kind, r.count])),
    repositories: repos.results.map((repo) => ({ ...repo, is_default: Boolean(repo.is_default) }))
  });
});

app.get("/api/public/assets", async (c) => {
  const publicSettings = await getSettings(c);
  if (publicSettings.site_visibility === "private") {
    const session = await currentSession(c);
    if (!session) return c.json({ error: "这是私人馆藏，请从工作台登录后查看。" }, 403);
  }
  const kind = c.req.query("kind");
  const search = c.req.query("q")?.trim().toLowerCase();
  const tag = c.req.query("tag");
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 60), 1), 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (kind === "image" || kind === "music") { conditions.push("a.kind = ?"); bindings.push(kind); }
  if (search) {
    conditions.push("(lower(a.title) LIKE ? OR lower(a.filename) LIKE ? OR lower(coalesce(a.artist, '')) LIKE ?)");
    bindings.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (tag) { conditions.push("a.tags LIKE ?"); bindings.push(`%${tag}%`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await c.env.DB.prepare(
    `SELECT a.*, r.label AS repo_label, r.provider AS repo_provider,
      (SELECT COUNT(*) FROM asset_mirrors m WHERE m.asset_id = a.id AND m.status = 'synced') AS mirror_synced,
      (SELECT COUNT(*) FROM asset_mirrors m WHERE m.asset_id = a.id AND m.status IN ('synced','pending')) AS mirror_total
     FROM assets a JOIN repositories r ON r.id = a.repo_id
     ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...bindings, limit, offset).all<AssetWithRepo>();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM assets a ${where}`).bind(...bindings).first<{ count: number }>();
  return c.json({ assets: rows.results.map(assetJson), total: Number(total?.count ?? 0) });
});

app.get("/api/public/assets/:id", async (c) => {
  const accessSettings = await getSettings(c);
  if (accessSettings.site_visibility === "private" && !(await currentSession(c))) {
    return c.json({ error: "这是私人馆藏，请从工作台登录后查看。" }, 403);
  }
  const row = await c.env.DB.prepare(
    `SELECT a.*, r.label AS repo_label, r.provider AS repo_provider
     FROM assets a JOIN repositories r ON r.id = a.repo_id WHERE a.id = ?`
  ).bind(c.req.param("id")).first<AssetWithRepo>();
  if (!row) return c.json({ error: "作品不存在" }, 404);
  return c.json({ asset: assetJson(row) });
});

app.get("/media/:id", async (c) => {
  const accessSettings = await getSettings(c);
  if (accessSettings.site_visibility === "private" && !(await currentSession(c))) {
    return c.json({ error: "这是私人媒体，请先登录工作台。" }, 403);
  }
  const row = await c.env.DB.prepare("SELECT * FROM assets WHERE id = ?").bind(c.req.param("id")).first<AssetRow>();
  if (!row) return c.json({ error: "媒体不存在" }, 404);
  try {
    return await readAssetFile(c.env, row, c.req.header("range"));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "媒体读取失败" }, 502);
  }
});

app.all("/api/admin/*", async (c) => {
  const { adminRoutes } = await import("./routes/admin");
  return adminRoutes.fetch(c.req.raw, c.env, c.executionCtx);
});

app.all("/api/auth/*", async (c) => {
  const { adminRoutes } = await import("./routes/admin");
  return adminRoutes.fetch(c.req.raw, c.env, c.executionCtx);
});

app.all("/api/repos/*", async (c) => {
  const { adminRoutes } = await import("./routes/admin");
  return adminRoutes.fetch(c.req.raw, c.env, c.executionCtx);
});

app.all("/api/repos", async (c) => {
  const { adminRoutes } = await import("./routes/admin");
  return adminRoutes.fetch(c.req.raw, c.env, c.executionCtx);
});

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "接口不存在" }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  console.error(error);
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: error instanceof Error ? error.message : "服务器内部错误" }, 500);
  }
  return c.text("服务器内部错误", 500);
});

export default app;