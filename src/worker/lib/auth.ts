import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, SessionRow } from "../types";
import { constantTimeEqual, hashPassword, nowIso, randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "sv_session";
export const SESSION_DAYS = 30;

function cookieOptions(c: Context<AppEnv>) {
  const url = new URL(c.req.url);
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: url.protocol === "https:",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60
  };
}

export async function currentSession(c: Context<AppEnv>): Promise<SessionRow | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await c.env.DB.prepare(
    "SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?"
  ).bind(tokenHash, nowIso()).first<SessionRow>();
  return row ?? null;
}

export async function requireSession(c: Context<AppEnv>): Promise<SessionRow | null> {
  const session = c.get("session") ?? (await currentSession(c));
  if (session) c.set("session", session);
  return session;
}

export async function createSession(c: Context<AppEnv>): Promise<SessionRow> {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const session: SessionRow = {
    id: crypto.randomUUID(),
    token_hash: tokenHash,
    csrf_token: randomToken(24),
    expires_at: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString(),
    created_at: nowIso(),
    user_agent: c.req.header("user-agent")?.slice(0, 250) ?? null
  };
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, token_hash, csrf_token, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(session.id, session.token_hash, session.csrf_token, session.expires_at, session.created_at, session.user_agent).run();
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c));
  return session;
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function verifyPassword(c: Context<AppEnv>, password: string): Promise<boolean> {
  const row = await c.env.DB.prepare(
    "SELECT password_hash, salt, iterations FROM admin_credentials WHERE id = 1"
  ).first<{ password_hash: string; salt: string; iterations: number }>();
  if (!row) return false;
  const candidate = await hashPassword(password, row.salt, row.iterations);
  return constantTimeEqual(candidate, row.password_hash);
}

export async function createAdmin(c: Context<AppEnv>, password: string): Promise<boolean> {
  const salt = randomToken(24);
  const iterations = 50_000;
  const passwordHash = await hashPassword(password, salt, iterations);
  const result = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO admin_credentials (id, password_hash, salt, iterations, updated_at) VALUES (1, ?, ?, ?, ?)"
  ).bind(passwordHash, salt, iterations, nowIso()).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function isInitialized(c: Context<AppEnv>): Promise<boolean> {
  const row = await c.env.DB.prepare("SELECT id FROM admin_credentials WHERE id = 1").first();
  return Boolean(row);
}

export function sameOrigin(c: Context<AppEnv>): boolean {
  const origin = c.req.header("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

export async function throttleLogin(c: Context<AppEnv>): Promise<{ blocked: boolean; retryAfter: number }> {
  const key = c.req.header("cf-connecting-ip") ?? "local";
  const now = nowIso();
  const row = await c.env.DB.prepare("SELECT * FROM auth_throttle WHERE key = ?").bind(key).first<{
    key: string; failures: number; first_failure_at: string; blocked_until: string | null;
  }>();
  if (!row) return { blocked: false, retryAfter: 0 };
  if (row.blocked_until && row.blocked_until > now) {
    return { blocked: true, retryAfter: Math.max(1, Math.ceil((Date.parse(row.blocked_until) - Date.now()) / 1000)) };
  }
  return { blocked: false, retryAfter: 0 };
}

export async function registerLoginFailure(c: Context<AppEnv>): Promise<void> {
  const key = c.req.header("cf-connecting-ip") ?? "local";
  const now = new Date();
  const row = await c.env.DB.prepare("SELECT * FROM auth_throttle WHERE key = ?").bind(key).first<{
    key: string; failures: number; first_failure_at: string; blocked_until: string | null;
  }>();
  if (!row) {
    await c.env.DB.prepare("INSERT INTO auth_throttle (key, failures, first_failure_at) VALUES (?, 1, ?)").bind(key, now.toISOString()).run();
    return;
  }
  const windowOpen = Date.now() - Date.parse(row.first_failure_at) < 15 * 60_000;
  const failures = windowOpen ? row.failures + 1 : 1;
  const firstFailure = windowOpen ? row.first_failure_at : now.toISOString();
  const blockedUntil = failures >= 5 ? new Date(now.getTime() + 15 * 60_000).toISOString() : null;
  await c.env.DB.prepare(
    "UPDATE auth_throttle SET failures = ?, first_failure_at = ?, blocked_until = ? WHERE key = ?"
  ).bind(failures, firstFailure, blockedUntil, key).run();
}

export async function clearLoginFailures(c: Context<AppEnv>): Promise<void> {
  const key = c.req.header("cf-connecting-ip") ?? "local";
  await c.env.DB.prepare("DELETE FROM auth_throttle WHERE key = ?").bind(key).run();
}