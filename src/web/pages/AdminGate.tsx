import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { getContext } from "../lib/context";
import { AdminShell } from "./Admin";
import { ArtMark } from "../components/Media";

export function AdminGate() {
  const context = getContext();
  const [auth, setAuth] = useState(context.auth);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = window.location.pathname.replace(/^\/admin\/?/, "");
  const view = ["library", "upload", "repositories", "appearance", "logs"].includes(path) ? path as "library" : "overview";

  useEffect(() => {
    document.title = "工作台 · 拾光储藏室";
    if (!auth.authenticated) {
      context.refreshAuth().then(setAuth).catch(() => undefined);
    }
  }, []);

  if (auth.authenticated) return <AdminShell initialView={view} />;
  if (!auth.initialized) {
    window.location.replace("/setup");
    return <div className="app-loading"><span>正在前往首次设置…</span></div>;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      const next = await context.refreshAuth();
      setAuth(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败");
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="auth-panel__brand"><ArtMark /><span>拾光储藏室</span></div>
        <span className="eyebrow">CURATOR ACCESS</span>
        <h1>欢迎回来，<br />馆藏管理员。</h1>
        <p>输入密码进入工作台，管理影像、音乐与云端存储。</p>
        <form onSubmit={submit}>
          <label className="field"><span>管理员密码</span><div className="password-field"><LockKeyhole size={17} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required autoFocus /></div></label>
          {error && <p className="form-error">{error}</p>}
          <button className="button button--dark button--wide" type="submit" disabled={busy}>{busy ? "正在验证…" : "进入工作台"}</button>
        </form>
        <div className="auth-panel__security"><ShieldCheck size={16} /><span>会话使用 HttpOnly Cookie，连续输错会暂时锁定。</span></div>
        <div className="auth-panel__back"><a href="/"><ArrowLeft size={15} /> 返回展示站</a><a href="/">浏览公开馆藏 <ArrowRight size={15} /></a></div>
      </div>
      <div className="auth-art auth-art--login" aria-hidden="true">
        <div className="auth-art__number">S / 01</div>
        <div className="auth-art__frame" />
        <div className="auth-art__circle" />
        <span>光<br />声</span>
        <small>PRIVATE<br />ARCHIVE</small>
      </div>
    </div>
  );
}