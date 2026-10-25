import type { Env, RepositoryRow } from "../types";
import { decryptSecret } from "./crypto";

export type RemoteFile = {
  path: string;
  sha: string;
  size: number;
};

type GitHubContent = {
  type?: string;
  name?: string;
  path?: string;
  sha?: string;
  size?: number;
  content?: string;
  encoding?: string;
  download_url?: string;
};

type GitLabTreeItem = {
  id: string;
  name: string;
  type: "blob" | "tree";
  path: string;
  mode: string;
};

export class StorageError extends Error {
  status: number;
  provider: string;
  constructor(message: string, status = 502, provider = "remote") {
    super(message);
    this.status = status;
    this.provider = provider;
  }
}

export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function normalizeRoot(root: string): string {
  return root.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

async function tokenFor(repo: RepositoryRow, env: Env): Promise<string> {
  const token = await decryptSecret(repo.token_encrypted, env.ENCRYPTION_KEY);
  if (!token) throw new StorageError(`${repo.label} 尚未配置访问令牌`, 409, repo.provider);
  return token;
}

function repoPath(repo: RepositoryRow, path: string): string {
  const root = normalizeRoot(repo.root_path);
  return root ? `${root}/${path.replace(/^\/+/, "")}` : path.replace(/^\/+/, "");
}

function cleanPath(path: string): string {
  return path.replace(/^\/+/, "");
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { message: text.slice(0, 500) }; }
}

function remoteError(repo: RepositoryRow, status: number, body: Record<string, unknown>): StorageError {
  const message = String(body.message ?? body.error ?? `远程存储返回 ${status}`);
  const friendly = status === 401 || status === 403
    ? `${repo.label} 鉴权失败，请检查 Token 与仓库权限`
    : status === 404
      ? `${repo.label} 找不到仓库或文件，请检查 owner/repo/分支`
      : status === 409
        ? `${repo.label} 文件版本冲突，请先同步后重试`
        : `${repo.label} 请求失败：${message}`;
  return new StorageError(friendly, status >= 400 && status < 500 ? 409 : 502, repo.provider);
}

async function githubFetch(repo: RepositoryRow, env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await tokenFor(repo, env);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", "Shiguang-Vault");
  return fetch(path, { ...init, headers });
}

async function githubBlobFetch(repo: RepositoryRow, env: Env, sha: string, range?: string | null): Promise<Response> {
  const token = await tokenFor(repo, env);
  const headers = new Headers({ Accept: "application/vnd.github.raw" });
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", "Shiguang-Vault");
  if (range) headers.set("Range", range);
  return fetch(githubApi(repo, `/git/blobs/${encodeURIComponent(sha)}`), { headers });
}

async function gitlabFetch(repo: RepositoryRow, env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await tokenFor(repo, env);
  const headers = new Headers(init.headers);
  headers.set("PRIVATE-TOKEN", token);
  headers.set("User-Agent", "Shiguang-Vault");
  return fetch(path, { ...init, headers });
}

function githubApi(repo: RepositoryRow, suffix: string): string {
  const project = encodeURIComponent(repo.owner);
  const name = encodeURIComponent(repo.repo);
  return `https://api.github.com/repos/${project}/${name}${suffix}`;
}

function gitlabApi(repo: RepositoryRow, suffix: string): string {
  const project = encodeURIComponent(`${repo.owner}/${repo.repo}`);
  return `https://gitlab.com/api/v4/projects/${project}${suffix}`;
}

export async function testRepository(repo: RepositoryRow, env: Env): Promise<{ ok: true; defaultBranch: string }> {
  if (repo.provider === "github") {
    const response = await githubFetch(repo, env, githubApi(repo, ""));
    if (!response.ok) throw remoteError(repo, response.status, await safeJson(response));
    const data = await safeJson(response);
    return { ok: true, defaultBranch: String(data.default_branch ?? repo.branch) };
  }
  const response = await gitlabFetch(repo, env, gitlabApi(repo, ""));
  if (!response.ok) throw remoteError(repo, response.status, await safeJson(response));
  const data = await safeJson(response);
  return { ok: true, defaultBranch: String(data.default_branch ?? repo.branch) };
}

export async function listRepositoryFiles(repo: RepositoryRow, env: Env): Promise<RemoteFile[]> {
  const root = normalizeRoot(repo.root_path);
  if (repo.provider === "github") {
    const treeRef = encodeURIComponent(repo.branch);
    const response = await githubFetch(
      repo,
      env,
      githubApi(repo, `/git/trees/${treeRef}?recursive=1`)
    );
    if (!response.ok) throw remoteError(repo, response.status, await safeJson(response));
    const data = await safeJson(response);
    if (data.truncated === true) {
      throw new StorageError(`${repo.label} 文件数量超过 GitHub 单次目录树上限，请把存储子目录拆分为多个仓库`, 409, "github");
    }
    const tree = Array.isArray(data.tree) ? data.tree as GitHubContent[] : [];
    return tree
      .filter((item) => item.type === "blob" && item.path && item.sha)
      .filter((item) => !root || item.path === root || item.path!.startsWith(`${root}/`))
      .map((item) => ({
        path: cleanPath(root && item.path!.startsWith(`${root}/`) ? item.path!.slice(root.length + 1) : item.path!),
        sha: item.sha!,
        size: Number(item.size ?? 0)
      }));
  }

  const files: RemoteFile[] = [];
  let page = 1;
  while (page <= 100) {
    const query = new URLSearchParams({
      ref: repo.branch,
      recursive: "true",
      per_page: "100",
      page: String(page)
    });
    if (root) query.set("path", root);
    const response = await gitlabFetch(repo, env, gitlabApi(repo, `/repository/tree?${query}`));
    if (!response.ok) throw remoteError(repo, response.status, await safeJson(response));
    const items = await response.json() as GitLabTreeItem[];
    for (const item of items) {
      if (item.type !== "blob") continue;
      let path = item.path;
      if (root && path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
      files.push({ path, sha: item.id, size: 0 });
    }
    const nextPage = response.headers.get("x-next-page");
    if (!nextPage) break;
    page = Number(nextPage);
  }
  return files;
}

export async function uploadFile(
  repo: RepositoryRow,
  env: Env,
  path: string,
  bytes: Uint8Array,
  message: string,
  existingSha?: string | null
): Promise<{ sha: string; size: number }> {
  const fullPath = repoPath(repo, path);
  const content = bytesToBase64(bytes);
  if (repo.provider === "github") {
    const body: Record<string, unknown> = {
      message,
      content,
      branch: repo.branch
    };
    if (existingSha) body.sha = existingSha;
    const response = await githubFetch(repo, env, githubApi(repo, `/contents/${encodePath(fullPath)}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw remoteError(repo, response.status, await safeJson(response));
    const data = await safeJson(response);
    const file = (data.content ?? {}) as GitHubContent;
    return { sha: String(file.sha ?? ""), size: Number(file.size ?? bytes.length) };
  }

  const encodedPath = encodeURIComponent(fullPath);
  const response = await gitlabFetch(repo, env, gitlabApi(repo, `/repository/files/${encodedPath}`), {
    method: existingSha ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      branch: repo.branch,
      content,
      encoding: "base64",
      commit_message: message
    })
  });
  if (!response.ok) throw remoteError(repo, response.status, await safeJson(response));
  const data = await safeJson(response);
  return { sha: String(data.content_sha256 ?? data.last_commit_id ?? ""), size: bytes.length };
}

export async function readFile(repo: RepositoryRow, env: Env, path: string, range?: string | null, sha?: string | null): Promise<Response> {
  const fullPath = repoPath(repo, path);
  if (repo.provider === "github") {
    if (!sha) throw new StorageError(`${repo.label} 缺少文件版本信息，请先同步仓库后再读取`, 409, "github");
    const response = await githubBlobFetch(repo, env, sha, range);
    if (!response.ok) throw remoteError(repo, response.status, await safeJson(response));
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      throw new StorageError(`${repo.label} 返回了文件信息而不是文件内容，请检查 GitHub Token 权限`, 502, "github");
    }
    return response;
  }
  const encodedPath = encodeURIComponent(fullPath);
  const response = await gitlabFetch(
    repo,
    env,
    gitlabApi(repo, `/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(repo.branch)}`)
  );
  if (!response.ok) throw remoteError(repo, response.status, await safeJson(response));
  return response;
}


export async function deleteFile(repo: RepositoryRow, env: Env, path: string, sha?: string | null, message = "Delete media"): Promise<void> {
  const fullPath = repoPath(repo, path);
  if (repo.provider === "github") {
    if (!sha) throw new StorageError("缺少文件版本信息，无法安全删除", 409, "github");
    const response = await githubFetch(repo, env, githubApi(repo, `/contents/${encodePath(fullPath)}`), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sha, branch: repo.branch })
    });
    if (!response.ok && response.status !== 404) throw remoteError(repo, response.status, await safeJson(response));
    return;
  }
  const encodedPath = encodeURIComponent(fullPath);
  const response = await gitlabFetch(repo, env, gitlabApi(repo, `/repository/files/${encodedPath}`), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch: repo.branch, commit_message: message })
  });
  if (!response.ok && response.status !== 404) throw remoteError(repo, response.status, await safeJson(response));
}

export async function mirrorAsset(
  env: Env,
  source: RepositoryRow,
  target: RepositoryRow,
  path: string,
  bytes: Uint8Array,
  existingSha?: string | null
): Promise<{ sha: string }> {
  const result = await uploadFile(target, env, path, bytes, `Mirror ${path}`, existingSha);
  return { sha: result.sha };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}