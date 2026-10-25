import type { AssetRow, Env, RepositoryRow } from "../types";
import { deleteFile, encodePath, listRepositoryFiles, normalizeRoot, readFile, uploadFile } from "./storage";
import { nowIso, uuid } from "./crypto";

export type AssetRecord = AssetRow & {
  repo_label?: string;
  repo_provider?: string;
  cover_url?: string | null;
  mirror_total?: number;
  mirror_synced?: number;
};

export function assetJson(row: AssetRecord, origin?: string | null) {
  let tags: string[] = [];
  try { tags = JSON.parse(row.tags) as string[]; } catch { tags = []; }
  return {
    id: row.id,
    kind: row.kind,
    repoId: row.repo_id,
    repoLabel: row.repo_label ?? null,
    repoProvider: row.repo_provider ?? null,
    path: row.path,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    title: row.title,
    artist: row.artist,
    album: row.album,
    tags,
    width: row.width,
    height: row.height,
    duration: row.duration_seconds,
    coverUrl: row.cover_asset_id ? `/media/${row.cover_asset_id}` : row.cover_url ?? null,
    mirrorTotal: Number(row.mirror_total ?? 0),
    mirrorSynced: Number(row.mirror_synced ?? 0),
    mediaUrl: origin ? new URL(`/media/${row.id}`, origin).toString() : `/media/${row.id}`,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function safeFilename(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\-]+|[.\-]+$/g, "")
    .slice(-90);
  return cleaned || "file";
}

export function inferKind(filename: string): "image" | "music" | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp", "heic"].includes(ext)) return "image";
  if (["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"].includes(ext)) return "music";
  return null;
}

export function mimeFor(filename: string, fallback = "application/octet-stream"): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const types: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp",
    heic: "image/heic", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac",
    wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg"
  };
  return types[ext] ?? fallback;
}

export function assetPath(kind: "image" | "music", filename: string): string {
  return `${kind === "image" ? "images" : "music"}/${uuid().slice(0, 8)}-${safeFilename(filename)}`;
}

export async function upsertDiscoveredAsset(
  env: Env,
  repo: RepositoryRow,
  file: { path: string; sha: string; size: number }
): Promise<boolean> {
  const filename = file.path.split("/").pop() ?? file.path;
  const kind = inferKind(filename);
  if (!kind) return false;
  const now = nowIso();
  const title = filename.replace(/\.[^.]+$/, "").replace(/^[a-f0-9]{8}-/i, "");
  await env.DB.prepare(
    `INSERT INTO assets
      (id, kind, repo_id, path, filename, mime_type, size, remote_sha, title, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
     ON CONFLICT(repo_id, path) DO UPDATE SET
       remote_sha = excluded.remote_sha,
       size = CASE WHEN excluded.size > 0 THEN excluded.size ELSE assets.size END,
       filename = excluded.filename,
       updated_at = excluded.updated_at`
  ).bind(uuid(), kind, repo.id, file.path, filename, mimeFor(filename), file.size, file.sha, title, now, now).run();
  return true;
}

export async function buildMirrorFile(
  env: Env,
  source: RepositoryRow,
  target: RepositoryRow,
  asset: AssetRow
): Promise<{ sha: string }> {
  const response = await readFile(source, env, asset.path, null, asset.remote_sha);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const existing = await env.DB.prepare(
    "SELECT remote_sha FROM asset_mirrors WHERE asset_id = ? AND repo_id = ?"
  ).bind(asset.id, target.id).first<{ remote_sha: string | null }>();
  const result = await uploadFile(
    target,
    env,
    asset.path,
    bytes,
    `Mirror ${asset.filename}`,
    existing?.remote_sha
  );
  await env.DB.prepare(
    `INSERT INTO asset_mirrors (asset_id, repo_id, status, remote_sha, synced_at, error)
     VALUES (?, ?, 'synced', ?, ?, NULL)
     ON CONFLICT(asset_id, repo_id) DO UPDATE SET status = 'synced', remote_sha = excluded.remote_sha,
       synced_at = excluded.synced_at, error = NULL`
  ).bind(asset.id, target.id, result.sha, nowIso()).run();
  return result;
}

export async function syncAssetMirror(
  env: Env,
  asset: AssetRow,
  target: RepositoryRow
): Promise<{ ok: boolean; sha?: string; error?: string }> {
  const source = await env.DB.prepare("SELECT * FROM repositories WHERE id = ?").bind(asset.repo_id).first<RepositoryRow>();
  if (!source) return { ok: false, error: "源仓库不存在" };
  try {
    const result = await buildMirrorFile(env, source, target, asset);
    return { ok: true, sha: result.sha };
  } catch (error) {
    const message = error instanceof Error ? error.message : "镜像失败";
    await env.DB.prepare(
      `INSERT INTO asset_mirrors (asset_id, repo_id, status, error)
       VALUES (?, ?, 'failed', ?)
       ON CONFLICT(asset_id, repo_id) DO UPDATE SET status = 'failed', error = excluded.error`
    ).bind(asset.id, target.id, message).run();
    return { ok: false, error: message };
  }
}

export async function removeAsset(
  env: Env,
  asset: AssetRow,
  source: RepositoryRow,
  removeMirrors = true
): Promise<{ failures: string[] }> {
  const failures: string[] = [];
  try {
    await deleteFile(source, env, asset.path, asset.remote_sha, `Delete ${asset.filename}`);
  } catch (error) {
    // Keep the index entry when the canonical source could not be deleted.
    // Otherwise the remote file becomes an orphan with no way to manage it.
    return { failures: [error instanceof Error ? error.message : "源文件删除失败"] };
  }
  if (removeMirrors) {
    const mirrors = await env.DB.prepare(
      `SELECT m.*, r.provider, r.owner, r.repo, r.branch, r.root_path, r.label, r.token_encrypted
       FROM asset_mirrors m JOIN repositories r ON r.id = m.repo_id
       WHERE m.asset_id = ? AND m.status IN ('synced', 'failed')`
    ).bind(asset.id).all<RepositoryRow & { remote_sha: string | null }>();
    for (const mirror of mirrors.results) {
      try {
        await deleteFile(mirror, env, asset.path, mirror.remote_sha, `Delete mirrored ${asset.filename}`);
      } catch (error) {
        failures.push(`${mirror.label}: ${error instanceof Error ? error.message : "删除失败"}`);
      }
    }
  }
  await env.DB.prepare("DELETE FROM assets WHERE id = ?").bind(asset.id).run();
  return { failures };
}

export async function syncRepository(
  env: Env,
  repo: RepositoryRow
): Promise<{ scanned: number; imported: number; mainRepo: boolean; removed: number }> {
  const files = await listRepositoryFiles(repo, env);
  const now = nowIso();
  const paths = new Set(files.map((file) => file.path));

  // A backup repository is only an inventory check. Its files must never be
  // inserted into assets, otherwise the public collection shows each work twice.
  if (repo.backup_of) {
    const assets = await env.DB.prepare("SELECT * FROM assets WHERE repo_id = ?")
      .bind(repo.backup_of).all<AssetRow>();
    for (const asset of assets.results) {
      const exists = paths.has(asset.path);
      await env.DB.prepare(
        `INSERT INTO asset_mirrors (asset_id, repo_id, status, synced_at, error)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(asset_id, repo_id) DO UPDATE SET
           status = excluded.status,
           synced_at = CASE WHEN excluded.status = 'synced' THEN excluded.synced_at ELSE asset_mirrors.synced_at END,
           error = NULL`
      ).bind(asset.id, repo.id, exists ? "synced" : "pending", exists ? now : null).run();
    }
    await env.DB.prepare(
      "UPDATE repositories SET last_synced_at = ?, last_sync_error = NULL, updated_at = ? WHERE id = ?"
    ).bind(now, now, repo.id).run();
    return { scanned: files.length, imported: 0, mainRepo: false, removed: 0 };
  }

  const existingAssets = await env.DB.prepare("SELECT * FROM assets WHERE repo_id = ?")
    .bind(repo.id).all<AssetRow>();
  const existingPaths = new Set(existingAssets.results.map((asset) => asset.path));
  let imported = 0;
  for (const file of files) {
    if (await upsertDiscoveredAsset(env, repo, file)) {
      if (!existingPaths.has(file.path)) imported += 1;
    }
  }

  // Do not silently drop an indexed work because a remote tree was incomplete.
  // Deleting is an explicit admin action; scanning is only reconciliation.
  const removed = 0;
  const allAssets = await env.DB.prepare("SELECT * FROM assets WHERE repo_id = ?")
    .bind(repo.id).all<AssetRow>();
  const backups = await env.DB.prepare(
    "SELECT * FROM repositories WHERE backup_of = ? AND enabled = 1"
  ).bind(repo.id).all<RepositoryRow>();
  for (const backup of backups.results) {
    let backupPaths = new Set<string>();
    try {
      backupPaths = new Set((await listRepositoryFiles(backup, env)).map((file) => file.path));
    } catch {
      // Keep the previous status when the backup cannot be inspected.
      continue;
    }
    for (const asset of allAssets.results) {
      const exists = backupPaths.has(asset.path);
      await env.DB.prepare(
        `INSERT INTO asset_mirrors (asset_id, repo_id, status, synced_at, error)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(asset_id, repo_id) DO UPDATE SET
           status = excluded.status,
           synced_at = CASE WHEN excluded.status = 'synced' THEN excluded.synced_at ELSE asset_mirrors.synced_at END,
           error = NULL`
      ).bind(asset.id, backup.id, exists ? "synced" : "pending", exists ? now : null).run();
    }
  }
  await env.DB.prepare(
    "UPDATE repositories SET last_synced_at = ?, last_sync_error = NULL, updated_at = ? WHERE id = ?"
  ).bind(now, now, repo.id).run();
  return { scanned: files.length, imported, mainRepo: true, removed };
}

export async function readAssetFile(
  env: Env,
  asset: AssetRow,
  range?: string | null,
  options: { publicShare?: boolean } = {}
): Promise<Response> {
  const repo = await env.DB.prepare("SELECT * FROM repositories WHERE id = ?").bind(asset.repo_id).first<RepositoryRow>();
  if (!repo) throw new Error("媒体所在仓库不存在");
  const response = await readFile(repo, env, asset.path, range, asset.remote_sha);
  return mediaResponse(response, asset, range, options);
}


async function mediaResponse(
  response: Response,
  asset: Pick<AssetRow, "filename" | "mime_type">,
  range?: string | null,
  options: { publicShare?: boolean } = {}
): Promise<Response> {
  const contentType = asset.mime_type || response.headers.get("content-type") || "application/octet-stream";
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", options.publicShare ? "public, max-age=60, must-revalidate" : "private, max-age=3600");
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`);
  if (options.publicShare) {
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  }

  if (range) {
    const upstreamRange = response.headers.get("content-range");
    if (response.status === 206 && upstreamRange) {
      headers.set("Content-Range", upstreamRange);
      const length = response.headers.get("content-length");
      if (length) headers.set("Content-Length", length);
      return new Response(response.body, { status: 206, headers });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
    if (!match) {
      headers.set("Content-Range", `bytes */${bytes.length}`);
      return new Response(null, { status: 416, headers });
    }
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : bytes.length - 1;
    if (!match[1] && match[2]) {
      const suffix = Number(match[2]);
      start = Math.max(0, bytes.length - suffix);
      end = bytes.length - 1;
    }
    if (start >= bytes.length || start > end) {
      headers.set("Content-Range", `bytes */${bytes.length}`);
      return new Response(null, { status: 416, headers });
    }
    end = Math.min(end, bytes.length - 1);
    headers.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(bytes.slice(start, end + 1), { status: 206, headers });
  }

  const length = response.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  return new Response(response.body, { status: 200, headers });
}
