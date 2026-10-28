import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, AssetRow, RepositoryRow, ShareLinkRow } from "../types";
import { getSettings, saveSettings } from "../lib/settings";
import { assetJson, indexRepositoryFilenames, inferKind, mimeFor, removeAsset, safeFilename, syncAssetMirror, syncRepository, timestampFilename, type FilenameIndex } from "../lib/media";
import { parseBuffer } from "music-metadata";
import { testRepository, uploadFile } from "../lib/storage";
import { decryptSecret, encryptSecret, nowIso, randomToken, sha256, uuid } from "../lib/crypto";
import {
  changeAdminPassword, clearLoginFailures, clearSessionCookie, createAdmin, createSession, currentSession,
  isInitialized, mustChangePassword, registerLoginFailure, sameOrigin, throttleLogin, verifyPassword
} from "../lib/auth";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", async (c, next) => {
  c.set("session", await currentSession(c));
  await next();
});

adminRoutes.get("/api/auth/me", async (c) => {
  const session = c.get("session");
  return c.json({
    authenticated: Boolean(session),
    initialized: await isInitialized(c),
    mustChangePassword: Boolean(session && await mustChangePassword(c)),
    csrfToken: session?.csrf_token ?? null,
    expiresAt: session?.expires_at ?? null
  });
});

adminRoutes.post("/api/auth/setup", async (c) => {
  if (await isInitialized(c)) return c.json({ error: "管理员已经初始化" }, 409);
  if (!sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
  const password = String(body.password ?? "");
  if (password.length < 8) return c.json({ error: "密码至少需要 8 个字符" }, 400);
  if (!(await createAdmin(c, password))) return c.json({ error: "管理员已经初始化" }, 409);
  const session = await createSession(c);
  return c.json({ ok: true, csrfToken: session.csrf_token });
});

adminRoutes.post("/api/auth/login", async (c) => {
  if (!sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  const throttle = await throttleLogin(c);
  if (throttle.blocked) {
    c.header("Retry-After", String(throttle.retryAfter));
    return c.json({ error: "尝试次数过多，请稍后再试" }, 429);
  }
  const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
  const password = String(body.password ?? "");
  if (!(await verifyPassword(c, password))) {
    await registerLoginFailure(c);
    return c.json({ error: "密码错误" }, 401);
  }
  await clearLoginFailures(c);
  const session = await createSession(c);
  return c.json({ ok: true, csrfToken: session.csrf_token });
});

adminRoutes.post("/api/auth/change-password", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "请先登录" }, 401);
  if (!sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const body = await c.req.json<{ currentPassword?: string; newPassword?: string }>().catch(() => ({} as { currentPassword?: string; newPassword?: string }));
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (newPassword.length < 12) return c.json({ error: "新密码至少需要 12 个字符" }, 400);
  if (newPassword === currentPassword) return c.json({ error: "新密码不能与当前密码相同" }, 400);
  if (!(await verifyPassword(c, currentPassword))) return c.json({ error: "当前密码错误" }, 401);
  await changeAdminPassword(c, newPassword);
  // Invalidate every existing session, then issue one fresh session to this client.
  await c.env.DB.prepare("DELETE FROM sessions").run();
  clearSessionCookie(c);
  const nextSession = await createSession(c);
  await audit(c, "admin.password_change", "admin", { forced: true });
  return c.json({ ok: true, csrfToken: nextSession.csrf_token });
});

adminRoutes.post("/api/auth/logout", async (c) => {
  const session = c.get("session");
  if (session) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(session.id).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});

async function requireReadySession(c: Context<AppEnv>): Promise<Response | null> {
  if (!c.get("session")) return c.json({ error: "请先登录" }, 401);
  if (await mustChangePassword(c)) return c.json({ error: "首次登录必须先修改密码", code: "PASSWORD_CHANGE_REQUIRED" }, 403);
  return null;
}

adminRoutes.use("/api/admin/*", async (c, next) => {
  const denied = await requireReadySession(c);
  if (denied) return denied;
  await next();
});

adminRoutes.use("/api/repos/*", async (c, next) => {
  const denied = await requireReadySession(c);
  if (denied) return denied;
  await next();
});

adminRoutes.use("/api/repos", async (c, next) => {
  const denied = await requireReadySession(c);
  if (denied) return denied;
  await next();
});

type ParsedAudioMetadata = {
  title: string | null;
  artist: string | null;
  album: string | null;
  duration: number | null;
};

async function parseAudioMetadata(bytes: Uint8Array, filename: string): Promise<ParsedAudioMetadata> {
  try {
    const metadata = await parseBuffer(bytes, { path: filename, mimeType: mimeFor(filename) }, { duration: true, skipCovers: true });
    const duration = Number(metadata.format.duration);
    return {
      title: cleanMetadataText(metadata.common.title),
      artist: cleanMetadataText(metadata.common.artist ?? metadata.common.artists?.join(" / ")),
      album: cleanMetadataText(metadata.common.album),
      duration: Number.isFinite(duration) && duration > 0 && duration < 86_400 ? duration : null
    };
  } catch {
    return { title: null, artist: null, album: null, duration: null };
  }
}

function cleanMetadataText(value: unknown): string | null {
  const text = String(value ?? "").replace(/\0/g, "").trim().slice(0, 160);
  return text || null;
}

async function audit(c: Context<AppEnv>, action: string, target: string | null, detail: unknown) {
  try {
    await c.env.DB.prepare("INSERT INTO audit_logs (action, target, detail, created_at) VALUES (?, ?, ?, ?)")
      .bind(action, target, JSON.stringify(detail).slice(0, 2000), nowIso()).run();
  } catch {
    // Audit failures must not break a successful content operation.
  }
}

adminRoutes.get("/api/admin/dashboard", async (c) => {
  const counts = await c.env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM assets) AS assets,
      (SELECT COUNT(*) FROM assets WHERE kind = 'image') AS images,
      (SELECT COUNT(*) FROM assets WHERE kind = 'music') AS music,
      (SELECT COUNT(*) FROM repositories WHERE enabled = 1) AS repositories,
      (SELECT COUNT(*) FROM asset_mirrors WHERE status = 'failed') AS mirror_failures`
  ).first();
  const recent = await c.env.DB.prepare(
    `SELECT a.*, r.label AS repo_label, r.provider AS repo_provider FROM assets a
     JOIN repositories r ON r.id = a.repo_id ORDER BY a.created_at DESC LIMIT 8`
  ).all<AssetRow & { repo_label: string; repo_provider: string }>();
  const repos = await c.env.DB.prepare(
    `SELECT r.*, (SELECT COUNT(*) FROM assets a WHERE a.repo_id = r.id) AS asset_count
     FROM repositories r ORDER BY r.is_default DESC, r.label ASC`
  ).all<RepositoryRow & { asset_count: number }>();
  return c.json({
    counts: counts ?? {},
    recent: recent.results.map((row) => assetJson(row)),
    repositories: repos.results.map(publicRepo)
  });
});

adminRoutes.get("/api/admin/assets", async (c) => {
  const kind = c.req.query("kind");
  const search = c.req.query("q")?.trim().toLowerCase();
  const repoId = c.req.query("repo");
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (kind === "image" || kind === "music") { conditions.push("a.kind = ?"); bindings.push(kind); }
  if (repoId) { conditions.push("a.repo_id = ?"); bindings.push(repoId); }
  if (search) {
    conditions.push("(lower(a.title) LIKE ? OR lower(a.filename) LIKE ? OR lower(coalesce(a.artist,'')) LIKE ?)");
    bindings.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await c.env.DB.prepare(
    `SELECT a.*, r.label AS repo_label, r.provider AS repo_provider,
      (SELECT COUNT(*) FROM asset_mirrors m WHERE m.asset_id = a.id AND m.status = 'synced') AS mirror_synced,
      (SELECT COUNT(*) FROM asset_mirrors m WHERE m.asset_id = a.id AND m.status IN ('synced','pending')) AS mirror_total
     FROM assets a JOIN repositories r ON r.id = a.repo_id
     ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...bindings, limit, offset).all<AssetRow & { repo_label: string; repo_provider: string; mirror_synced: number; mirror_total: number }>();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM assets a ${where}`).bind(...bindings).first<{ count: number }>();
  return c.json({ assets: rows.results.map((row) => assetJson(row)), total: Number(total?.count ?? 0) });
});

adminRoutes.get("/api/admin/assets/:id/mirrors", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT m.*, r.label AS repo_label, r.provider AS repo_provider
     FROM asset_mirrors m JOIN repositories r ON r.id = m.repo_id WHERE m.asset_id = ?`
  ).bind(c.req.param("id")).all();
  return c.json({ mirrors: rows.results });
});

const SHARE_DURATIONS: Record<string, number | null> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
  permanent: null
};

function shareJson(link: ShareLinkRow, origin: string, filename: string) {
  // Root file links are the public-facing format. The token is deliberately
  // not embedded: private sites authorize the filename while any active share
  // exists, and revoking the final share disables anonymous access again.
  const directUrl = new URL(`/${encodeURIComponent(filename)}`, origin).toString();
  return {
    id: link.id,
    expiresAt: link.expires_at,
    revokedAt: link.revoked_at,
    createdAt: link.created_at,
    url: directUrl,
    directUrl
  };
}

adminRoutes.get("/api/admin/assets/:id/shares", async (c) => {
  const asset = await c.env.DB.prepare("SELECT id, filename FROM assets WHERE id = ?").bind(c.req.param("id")).first<{ id: string; filename: string }>();
  if (!asset) return c.json({ error: "作品不存在" }, 404);
  const rows = await c.env.DB.prepare(
    "SELECT * FROM share_links WHERE asset_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 20"
  ).bind(c.req.param("id"), nowIso()).all<ShareLinkRow>();
  const origin = new URL(c.req.url).origin;
  const shares = [];
  for (const row of rows.results) {
    const token = await decryptSecret(row.token_encrypted, c.env.ENCRYPTION_KEY);
    if (token) shares.push(shareJson(row, origin, asset.filename));
  }
  return c.json({ shares });
});

adminRoutes.post("/api/admin/assets/:id/shares", async (c) => {
  const session = c.get("session");
  if (!session || !sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const asset = await c.env.DB.prepare("SELECT id, filename FROM assets WHERE id = ?").bind(c.req.param("id")).first<{ id: string; filename: string }>();
  if (!asset) return c.json({ error: "作品不存在" }, 404);
  const body = await c.req.json<{ duration?: unknown }>().catch(() => ({} as { duration?: unknown }));
  const durationKey = String(body.duration ?? "permanent");
  if (!(durationKey in SHARE_DURATIONS)) return c.json({ error: "分享有效期无效" }, 400);
  const duration = SHARE_DURATIONS[durationKey];
  const token = randomToken(32);
  const now = nowIso();
  const row: ShareLinkRow = {
    id: uuid(),
    asset_id: c.req.param("id"),
    token_hash: await sha256(token),
    token_encrypted: await encryptSecret(token, c.env.ENCRYPTION_KEY ?? ""),
    expires_at: duration === null ? null : new Date(Date.now() + duration).toISOString(),
    revoked_at: null,
    created_at: now
  };
  await c.env.DB.prepare(
    "INSERT INTO share_links (id, asset_id, token_hash, token_encrypted, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)"
  ).bind(row.id, row.asset_id, row.token_hash, row.token_encrypted, row.expires_at, row.created_at).run();
  await audit(c, "asset.share_create", row.asset_id, { shareId: row.id, expiresAt: row.expires_at });
  return c.json({ share: shareJson(row, new URL(c.req.url).origin, asset.filename) }, 201);
});

adminRoutes.delete("/api/admin/assets/:id/shares/:shareId", async (c) => {
  const session = c.get("session");
  if (!session || !sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const result = await c.env.DB.prepare(
    "UPDATE share_links SET revoked_at = ? WHERE id = ? AND asset_id = ? AND revoked_at IS NULL"
  ).bind(nowIso(), c.req.param("shareId"), c.req.param("id")).run();
  if (!Number(result.meta.changes ?? 0)) return c.json({ error: "分享链接不存在或已撤销" }, 404);
  await audit(c, "asset.share_revoke", c.req.param("id"), { shareId: c.req.param("shareId") });
  return c.json({ ok: true });
});

adminRoutes.post("/api/admin/assets", async (c) => {
  const session = c.get("session");
  if (!session || !sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "请选择要上传的文件" }, 400);
  const repoId = String(form.get("repoId") ?? "");
  const repo = await c.env.DB.prepare("SELECT * FROM repositories WHERE id = ? AND enabled = 1").bind(repoId).first<RepositoryRow>();
  if (!repo) return c.json({ error: "请选择有效的目标仓库" }, 400);
  if (repo.provider === "gitlab" && repo.backup_of) return c.json({ error: "GitLab 备份仓库不能作为上传目标" }, 400);

  const originalFilename = safeFilename(file.name);
  const kind = inferKind(originalFilename);
  if (!kind) return c.json({ error: "仅支持常见图片与音乐格式" }, 415);
  const maxSize = kind === "image" ? 20 * 1024 * 1024 : 50 * 1024 * 1024;
  if (file.size > maxSize) return c.json({ error: `单个文件不能超过 ${kind === "image" ? "20" : "50"} MB` }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const audio = kind === "music" ? await parseAudioMetadata(bytes, originalFilename) : null;

  // Generate the timestamp once so the D1 filename and repository path always match.
  const filename = timestampFilename(originalFilename);
  const path = `${kind === "image" ? "images" : "music"}/${filename}`;
  const uploadedSize = bytes.length;
  const sourceSize = Number(form.get("sourceSize") ?? 0);
  const originalSize = kind === "image" && sourceSize > uploadedSize && sourceSize <= 20 * 1024 * 1024 ? sourceSize : uploadedSize;
  const fallbackTitle = originalFilename.replace(/\.[^.]+$/, "");
  const submittedTitle = String(form.get("title") ?? "").trim().slice(0, 160);
  const submittedArtist = String(form.get("artist") ?? "").trim().slice(0, 120);
  const submittedAlbum = String(form.get("album") ?? "").trim().slice(0, 120);
  const title = submittedTitle || audio?.title || fallbackTitle;
  const artist = submittedArtist || audio?.artist || null;
  const album = submittedAlbum || audio?.album || null;
  const tagsInput = String(form.get("tags") ?? "");
  const tags = [...new Set(tagsInput.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12);
  const result = await uploadFile(repo, c.env, path, bytes, `Upload ${filename}`);
  const id = uuid();
  const now = nowIso();
  const rawWidth = Number(form.get("width") ?? 0);
  const rawHeight = Number(form.get("height") ?? 0);
  const rawDuration = Number(form.get("duration") ?? 0);
  const width = kind === "image" && rawWidth > 0 && rawWidth < 100_000 ? Math.round(rawWidth) : null;
  const height = kind === "image" && rawHeight > 0 && rawHeight < 100_000 ? Math.round(rawHeight) : null;
  const duration = kind === "music" ? (rawDuration > 0 && Number.isFinite(rawDuration) && rawDuration < 86_400 ? rawDuration : audio?.duration ?? null) : null;
  await c.env.DB.prepare(
    `INSERT INTO assets (id, kind, repo_id, path, filename, mime_type, size, remote_sha, title, artist, album, tags, width, height, duration_seconds, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, kind, repo.id, path, filename, mimeFor(filename, file.type), uploadedSize, result.sha, title, artist, album, JSON.stringify(tags), width, height, duration, now, now).run();
  const asset = await c.env.DB.prepare(
    `SELECT a.*, r.label AS repo_label, r.provider AS repo_provider FROM assets a JOIN repositories r ON r.id = a.repo_id WHERE a.id = ?`
  ).bind(id).first<AssetRow & { repo_label: string; repo_provider: string }>();
  const backups = await c.env.DB.prepare("SELECT * FROM repositories WHERE backup_of = ? AND enabled = 1").bind(repo.id).all<RepositoryRow>();
  const backupResults: { repoId: string; label: string; ok: boolean; skipped?: boolean; error?: string }[] = [];
  if (asset) {
    for (const backup of backups.results) {
      await c.env.DB.prepare("INSERT OR IGNORE INTO asset_mirrors (asset_id, repo_id, status) VALUES (?, ?, 'pending')").bind(id, backup.id).run();
      const mirror = await syncAssetMirror(c.env, asset, backup, { bytes });
      backupResults.push({ repoId: backup.id, label: backup.label, ...mirror });
    }
  }
  const backupSummary = {
    synced: backupResults.filter((item) => item.ok && !item.skipped).length,
    skipped: backupResults.filter((item) => item.ok && item.skipped).length,
    failures: backupResults.filter((item) => !item.ok).map((item) => ({ label: item.label, error: item.error ?? "备份失败" }))
  };
  const responseAsset = asset
    ? await c.env.DB.prepare(
        `SELECT a.*, r.label AS repo_label, r.provider AS repo_provider,
           (SELECT COUNT(*) FROM asset_mirrors m WHERE m.asset_id = a.id AND m.status = 'synced') AS mirror_synced,
           (SELECT COUNT(*) FROM asset_mirrors m WHERE m.asset_id = a.id AND m.status IN ('synced','pending')) AS mirror_total
         FROM assets a JOIN repositories r ON r.id = a.repo_id WHERE a.id = ?`
      ).bind(id).first<AssetRow & { repo_label: string; repo_provider: string; mirror_synced: number; mirror_total: number }>()
    : null;
  await audit(c, "asset.upload", id, { title, kind, repoId: repo.id, size: uploadedSize, sourceSize: originalSize, optimizedFormat: kind === "image" && bytes.length < originalSize ? "webp" : null, backups: backupResults.map((item) => ({ repoId: item.repoId, ok: item.ok, skipped: Boolean(item.skipped) })) });
  return c.json({ asset: responseAsset ? assetJson(responseAsset) : null, backups: backupSummary }, 201);
});

adminRoutes.patch("/api/admin/assets/:id", async (c) => {
  const session = c.get("session");
  if (!session || !sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const existing = await c.env.DB.prepare("SELECT * FROM assets WHERE id = ?").bind(c.req.param("id")).first<AssetRow>();
  if (!existing) return c.json({ error: "作品不存在" }, 404);
  const body = await c.req.json<{ title?: string; artist?: string; album?: string; tags?: string[] }>().catch(() => ({} as { title?: string; artist?: string; album?: string; tags?: string[] }));
  const title = body.title === undefined ? existing.title : String(body.title).trim().slice(0, 160) || existing.title;
  const artist = body.artist === undefined ? existing.artist : String(body.artist).trim().slice(0, 120) || null;
  const album = body.album === undefined ? existing.album : String(body.album).trim().slice(0, 120) || null;
  const tags = body.tags === undefined ? existing.tags : JSON.stringify([...new Set(body.tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 12));
  await c.env.DB.prepare(
    "UPDATE assets SET title = ?, artist = ?, album = ?, tags = ?, updated_at = ? WHERE id = ?"
  ).bind(title, artist, album, tags, nowIso(), existing.id).run();
  await audit(c, "asset.edit", existing.id, { title });
  return c.json({ ok: true });
});

adminRoutes.delete("/api/admin/assets/:id", async (c) => {
  const session = c.get("session");
  if (!session || !sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const asset = await c.env.DB.prepare("SELECT * FROM assets WHERE id = ?").bind(c.req.param("id")).first<AssetRow>();
  if (!asset) return c.json({ error: "作品不存在" }, 404);
  const repo = await c.env.DB.prepare("SELECT * FROM repositories WHERE id = ?").bind(asset.repo_id).first<RepositoryRow>();
  if (!repo) return c.json({ error: "源仓库不存在" }, 409);
  const result = await removeAsset(c.env, asset, repo, true);
  if (!result.failures.length) await audit(c, "asset.delete", asset.id, { title: asset.title, path: asset.path });
  return c.json({ ok: true, warnings: result.failures });
});

adminRoutes.post("/api/admin/assets/:id/mirror", async (c) => {
  const session = c.get("session");
  if (!session || !sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const asset = await c.env.DB.prepare("SELECT * FROM assets WHERE id = ?").bind(c.req.param("id")).first<AssetRow>();
  if (!asset) return c.json({ error: "作品不存在" }, 404);
  const backups = await c.env.DB.prepare("SELECT * FROM repositories WHERE backup_of = ? AND enabled = 1").bind(asset.repo_id).all<RepositoryRow>();
  if (!backups.results.length) return c.json({ error: "该作品所在仓库还没有启用备份库" }, 409);
  const results = [];
  for (const backup of backups.results) results.push({ repoId: backup.id, label: backup.label, ...(await syncAssetMirror(c.env, asset, backup)) });
  await audit(c, "asset.mirror", asset.id, { results: results.map((item) => ({ repoId: item.repoId, ok: item.ok })) });
  return c.json({ results });
});

adminRoutes.get("/api/admin/settings", async (c) => {
  const settings = await getSettings(c);
  const repos = await c.env.DB.prepare("SELECT * FROM repositories ORDER BY is_default DESC, label ASC").all<RepositoryRow>();
  return c.json({ settings, repositories: repos.results.map(publicRepo) });
});

adminRoutes.put("/api/admin/settings", async (c) => {
  const session = c.get("session");
  if (!session || !sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const settings = await saveSettings(c, body);
  await audit(c, "settings.update", "site", { changed: Object.keys(body) });
  return c.json({ settings });
});

adminRoutes.get("/api/admin/logs", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100").all();
  return c.json({ logs: rows.results });
});

adminRoutes.get("/api/repos", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT r.*, (SELECT COUNT(*) FROM assets a WHERE a.repo_id = r.id) AS asset_count,
      (SELECT label FROM repositories p WHERE p.id = r.backup_of) AS backup_label
     FROM repositories r ORDER BY r.is_default DESC, r.label ASC`
  ).all<RepositoryRow & { asset_count: number; backup_label: string | null }>();
  return c.json({ repositories: rows.results.map((repo) => ({ ...publicRepo(repo), backupLabel: repo.backup_label })) });
});

adminRoutes.post("/api/repos", async (c) => {
  const session = c.get("session");
  if (!session || !sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const provider = body.provider === "gitlab" ? "gitlab" : "github";
  const owner = String(body.owner ?? "").trim();
  const repo = String(body.repo ?? "").trim();
  const token = String(body.token ?? "").trim();
  if (!owner || !repo) return c.json({ error: "请填写仓库所有者与仓库名" }, 400);
  if (!token) return c.json({ error: "请填写访问令牌" }, 400);
  const label = String(body.label ?? `${owner}/${repo}`).trim().slice(0, 80) || `${owner}/${repo}`;
  const branch = String(body.branch ?? "main").trim() || "main";
  const rootPath = String(body.rootPath ?? "").replace(/^\/+|\/+$/g, "").slice(0, 200);
  const backupOf = body.backupOf ? String(body.backupOf) : null;
  if (backupOf) {
    const parent = await c.env.DB.prepare("SELECT * FROM repositories WHERE id = ?").bind(backupOf).first<RepositoryRow>();
    if (!parent) return c.json({ error: "备份源仓库不存在" }, 400);
    if (parent.backup_of) return c.json({ error: "备份仓库不能再设置备份源" }, 400);
  }
  const id = uuid();
  const now = nowIso();
  const tokenEncrypted = await encryptSecret(token, c.env.ENCRYPTION_KEY ?? "");
  await c.env.DB.prepare(
    `INSERT INTO repositories (id, provider, label, owner, repo, branch, root_path, token_encrypted, backup_of, enabled, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
  ).bind(id, provider, label, owner, repo, branch, rootPath, tokenEncrypted, backupOf, now, now).run();
  const created = await c.env.DB.prepare("SELECT * FROM repositories WHERE id = ?").bind(id).first<RepositoryRow>();
  let warning: string | null = null;
  try {
    if (created) await testRepository(created, c.env);
  } catch (error) {
    warning = error instanceof Error ? error.message : "连接测试失败";
    await c.env.DB.prepare("UPDATE repositories SET last_sync_error = ? WHERE id = ?").bind(warning, id).run();
  }
  await audit(c, "repository.create", id, { provider, owner, repo, backupOf });
  return c.json({ repository: created ? publicRepo(created) : null, warning }, 201);
});

adminRoutes.patch("/api/repos/:id", async (c) => {
  const session = c.get("session");
  if (!session || !sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const existing = await c.env.DB.prepare("SELECT * FROM repositories WHERE id = ?").bind(c.req.param("id")).first<RepositoryRow>();
  if (!existing) return c.json({ error: "仓库不存在" }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const label = body.label === undefined ? existing.label : String(body.label).trim().slice(0, 80) || existing.label;
  const branch = body.branch === undefined ? existing.branch : String(body.branch).trim() || existing.branch;
  const rootPath = body.rootPath === undefined ? existing.root_path : String(body.rootPath).replace(/^\/+|\/+$/g, "").slice(0, 200);
  const enabled = body.enabled === undefined ? existing.enabled : body.enabled ? 1 : 0;
  let tokenEncrypted = existing.token_encrypted;
  if (typeof body.token === "string" && body.token.trim()) tokenEncrypted = await encryptSecret(body.token.trim(), c.env.ENCRYPTION_KEY ?? "");
  const isDefault = body.isDefault ? 1 : 0;
  await c.env.DB.prepare(
    "UPDATE repositories SET label = ?, branch = ?, root_path = ?, enabled = ?, token_encrypted = ?, is_default = ?, updated_at = ? WHERE id = ?"
  ).bind(label, branch, rootPath, enabled, tokenEncrypted, isDefault, nowIso(), existing.id).run();
  if (isDefault) {
    await c.env.DB.prepare("UPDATE repositories SET is_default = 0 WHERE id <> ? AND provider = 'github'").bind(existing.id).run();
  }
  const updated = await c.env.DB.prepare("SELECT * FROM repositories WHERE id = ?").bind(existing.id).first<RepositoryRow>();
  await audit(c, "repository.update", existing.id, { label, branch, rootPath, enabled, isDefault });
  return c.json({ repository: updated ? publicRepo(updated) : null });
});

adminRoutes.delete("/api/repos/:id", async (c) => {
  const session = c.get("session");
  if (!session || !sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const id = c.req.param("id");
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM assets WHERE repo_id = ?").bind(id).first<{ count: number }>();
  if (Number(count?.count ?? 0) > 0) return c.json({ error: "该仓库仍有作品，不能删除" }, 409);
  await c.env.DB.prepare("DELETE FROM repositories WHERE id = ?").bind(id).run();
  await audit(c, "repository.delete", id, null);
  return c.json({ ok: true });
});

adminRoutes.post("/api/repos/:id/test", async (c) => {
  const session = c.get("session");
  if (!session || !sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const repo = await c.env.DB.prepare("SELECT * FROM repositories WHERE id = ?").bind(c.req.param("id")).first<RepositoryRow>();
  if (!repo) return c.json({ error: "仓库不存在" }, 404);
  try {
    const result = await testRepository(repo, c.env);
    await c.env.DB.prepare("UPDATE repositories SET last_sync_error = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), repo.id).run();
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接失败";
    await c.env.DB.prepare("UPDATE repositories SET last_sync_error = ?, updated_at = ? WHERE id = ?").bind(message, nowIso(), repo.id).run();
    return c.json({ error: message }, 502);
  }
});

adminRoutes.post("/api/repos/:id/sync", async (c) => {
  const session = c.get("session");
  if (!session || !sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const repo = await c.env.DB.prepare("SELECT * FROM repositories WHERE id = ?").bind(c.req.param("id")).first<RepositoryRow>();
  if (!repo) return c.json({ error: "仓库不存在" }, 404);
  try {
    const result = await syncRepository(c.env, repo);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步失败";
    await c.env.DB.prepare("UPDATE repositories SET last_sync_error = ?, updated_at = ? WHERE id = ?").bind(message, nowIso(), repo.id).run();
    return c.json({ error: message }, 502);
  }
});

adminRoutes.post("/api/repos/:id/backup", async (c) => {
  const session = c.get("session");
  if (!session || !sameOrigin(c)) return c.json({ error: "请求来源无效" }, 403);
  if (c.req.header("x-csrf-token") !== session.csrf_token) return c.json({ error: "CSRF 校验失败" }, 403);
  const source = await c.env.DB.prepare("SELECT * FROM repositories WHERE id = ?").bind(c.req.param("id")).first<RepositoryRow>();
  if (!source) return c.json({ error: "仓库不存在" }, 404);
  if (source.backup_of) return c.json({ error: "备份仓库不能作为备份源" }, 400);
  const backups = await c.env.DB.prepare("SELECT * FROM repositories WHERE backup_of = ? AND enabled = 1").bind(source.id).all<RepositoryRow>();
  if (!backups.results.length) return c.json({ error: "还没有配置备份仓库" }, 409);

  const batchSize = Math.min(Math.max(Number(c.req.query("limit") ?? 8), 1), 20);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  const assets = await c.env.DB.prepare(
    "SELECT * FROM assets WHERE repo_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?"
  ).bind(source.id, batchSize, offset).all<AssetRow>();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM assets WHERE repo_id = ?")
    .bind(source.id).first<{ count: number }>();
  const totalAssets = Number(total?.count ?? 0);
  let synced = 0;
  let skipped = 0;
  const filenameIndexes = new Map<string, FilenameIndex>();
  for (const backup of backups.results) {
    try {
      filenameIndexes.set(backup.id, await indexRepositoryFilenames(backup, c.env, { scanWholeRepository: true }));
    } catch {
      // Fall back to loading the index on demand so a transient tree error does not skip deduplication.
    }
  }
  const failures: { id: string; title: string; error: string }[] = [];
  for (const asset of assets.results) {
    for (const backup of backups.results) {
      const result = await syncAssetMirror(c.env, asset, backup, { filenames: filenameIndexes.get(backup.id) });
      if (result.ok && result.skipped) skipped += 1;
      else if (result.ok) synced += 1;
      else failures.push({ id: asset.id, title: asset.title, error: result.error ?? "同步失败" });
    }
  }
  const processed = offset + assets.results.length;
  const done = processed >= totalAssets;
  if (done) {
    await c.env.DB.prepare("UPDATE repositories SET last_synced_at = ?, last_sync_error = NULL, updated_at = ? WHERE id = ?")
      .bind(nowIso(), nowIso(), source.id).run();
    await audit(c, "repository.backup", source.id, { totalAssets, failures: failures.length });
  }
  return c.json({
    total: totalAssets * backups.results.length,
    synced,
    skipped,
    failures,
    processedAssets: assets.results.length,
    processed,
    totalAssets,
    done,
    nextOffset: done ? null : processed
  });
});

function publicRepo(repo: RepositoryRow) {
  return {
    id: repo.id,
    provider: repo.provider,
    label: repo.label,
    owner: repo.owner,
    repo: repo.repo,
    branch: repo.branch,
    rootPath: repo.root_path,
    backupOf: repo.backup_of,
    enabled: Boolean(repo.enabled),
    isDefault: Boolean(repo.is_default),
    hasToken: Boolean(repo.token_encrypted),
    lastSyncedAt: repo.last_synced_at,
    lastSyncError: repo.last_sync_error,
    createdAt: repo.created_at,
    updatedAt: repo.updated_at
  };
}
