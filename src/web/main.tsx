import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { api } from "./lib/api";
import { configureContext } from "./lib/context";
import { DEFAULT_SETTINGS } from "./lib/format";
import type { AuthState, BootstrapData, SiteSettings } from "./types";
import { PublicSite } from "./pages/Home";
import { AdminGate } from "./pages/AdminGate";

export function App() {
  const [state, setState] = useState<{ loading: boolean; error: string; settings: SiteSettings; auth: AuthState }>({
    loading: true, error: "", settings: DEFAULT_SETTINGS,
    auth: { authenticated: false, initialized: false, mustChangePassword: false, csrfToken: null, expiresAt: null }
  });

  useEffect(() => {
    Promise.all([
      api<BootstrapData>("/api/bootstrap"),
      api<AuthState>("/api/auth/me")
    ]).then(([bootstrap, auth]) => {
      configureContext(bootstrap.settings, auth);
      document.documentElement.style.setProperty("--accent", bootstrap.settings.accent_color);
      setState({ loading: false, error: "", settings: bootstrap.settings, auth });
    }).catch((cause) => {
      setState((previous) => ({ ...previous, loading: false, error: cause instanceof Error ? cause.message : "初始化失败" }));
    });
  }, []);

  if (state.loading) {
    return <div className="app-loading"><div className="app-loading__mark"><span /><span /><span /><span /></div><span>拾光储藏室</span><small>正在整理馆藏</small></div>;
  }

  if (state.error) {
    return (
      <div className="app-error">
        <h1>储藏室暂时无法打开</h1>
        <p>{state.error}</p>
        <p className="app-error__hint">如果是首次本地运行，请先执行 <code>npm run db:migrate:local</code>，并创建 <code>.dev.vars</code> 文件。</p>
        <button className="button button--dark" type="button" onClick={() => window.location.reload()}>重新连接</button>
      </div>
    );
  }

  const path = window.location.pathname;
  if (path === "/setup") {
    if (state.auth.initialized) {
      window.location.replace("/admin");
      return <div className="app-loading"><span>正在前往工作台…</span></div>;
    }
    return <PublicSite setupMode />;
  }
  if (path.startsWith("/admin")) return <AdminGate />;
  return <PublicSite />;
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Application root element is missing");
createRoot(rootElement).render(<App />);
