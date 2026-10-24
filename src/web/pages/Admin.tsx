import { useEffect, useMemo, useState } from "react";
import { LayoutDashboard, Library, UploadCloud, Database, Palette, ScrollText, LogOut, ExternalLink, Menu, X, ShieldCheck } from "lucide-react";
import { api, setCsrfToken } from "../lib/api";
import { getContext } from "../lib/context";
import type { AdminView, Asset, Repository } from "../types";
import { ArtMark, AssetLinkDialog } from "../components/Media";
import { AdminOverview } from "./admin/Overview";
import { AdminLibrary } from "./admin/Library";
import { AdminUpload } from "./admin/Upload";
import { AdminRepositories } from "./admin/Repositories";
import { AdminAppearance } from "./admin/Appearance";
import { AdminLogs } from "./admin/Logs";

const navItems: Array<{ id: AdminView; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "library", label: "内容库", icon: Library },
  { id: "upload", label: "上传作品", icon: UploadCloud },
  { id: "repositories", label: "存储库", icon: Database },
  { id: "appearance", label: "站点外观", icon: Palette },
  { id: "logs", label: "操作记录", icon: ScrollText }
];

export function AdminShell({ initialView = "overview" }: { initialView?: AdminView }) {
  const context = getContext();
  const [view, setView] = useState<AdminView>(initialView);
  const [menuOpen, setMenuOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [imageCount, setImageCount] = useState(0);
  const [musicCount, setMusicCount] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [linkAsset, setLinkAsset] = useState<Asset | null>(null);

  useEffect(() => {
    document.title = "工作台 · 拾光储藏室";
    load();
  }, []);

  useEffect(() => {
    const path = view === "overview" ? "/admin" : `/admin/${view}`;
    window.history.replaceState(null, "", path);
    setMenuOpen(false);
  }, [view]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [assetData, repoData, dashboardData, imageData, musicData] = await Promise.all([
        api<{ assets: Asset[]; total: number }>("/api/admin/assets?limit=30"),
        api<{ repositories: Repository[] }>("/api/repos"),
        api<{ counts: Record<string, number> }>("/api/admin/dashboard"),
        api<{ assets: Asset[]; total: number }>("/api/admin/assets?kind=image&limit=1"),
        api<{ assets: Asset[]; total: number }>("/api/admin/assets?kind=music&limit=1")
      ]);
      setAssets(assetData.assets);
      setRepositories(repoData.repositories);
      setCounts(dashboardData.counts);
      setImageCount(imageData.total);
      setMusicCount(musicData.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "数据加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* session may already be gone */ }
    setCsrfToken(null);
    window.location.href = "/";
  }

  const content = useMemo(() => {
    if (loading) return <div className="loading-panel"><ArtMark /><span>正在整理你的储藏室…</span></div>;
    if (error) return <div className="error-panel"><h3>暂时无法打开工作台</h3><p>{error}</p><button type="button" className="button" onClick={load}>重新加载</button></div>;
    switch (view) {
      case "overview": return <AdminOverview assets={assets} counts={counts} imageCount={imageCount} musicCount={musicCount} repositories={repositories} onNavigate={setView} onGetLink={setLinkAsset} />;
      case "library": return <AdminLibrary repositories={repositories} onRefresh={load} />;
      case "upload": return <AdminUpload repositories={repositories} onUploaded={load} />;
      case "repositories": return <AdminRepositories repositories={repositories} onRefresh={load} />;
      case "appearance": return <AdminAppearance repositories={repositories} />;
      case "logs": return <AdminLogs />;
    }
  }, [view, loading, error, assets, counts, imageCount, musicCount, repositories]);

  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="admin-sidebar__brand">
          <ArtMark compact />
          <div><strong>拾光</strong><span>储藏室工作台</span></div>
          <button className="admin-sidebar__close" type="button" onClick={() => setMenuOpen(false)} aria-label="关闭菜单"><X size={19} /></button>
        </div>
        <nav>
          <span className="nav-caption">工作区</span>
          {navItems.slice(0, 4).map((item) => <NavButton key={item.id} item={item} active={view === item.id} onClick={() => setView(item.id)} />)}
          <span className="nav-caption">站点</span>
          {navItems.slice(4).map((item) => <NavButton key={item.id} item={item} active={view === item.id} onClick={() => setView(item.id)} />)}
        </nav>
        <div className="admin-sidebar__bottom">
          <a className="admin-sidebar__site-link" href="/" target="_blank" rel="noreferrer"><ExternalLink size={16} /> 查看站点</a>
          <div className="admin-user">
            <span className="admin-user__avatar"><ShieldCheck size={17} /></span>
            <div><strong>管理员</strong><span>安全会话已启用</span></div>
            <button type="button" onClick={logout} aria-label="退出登录"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>
      {menuOpen && <button type="button" className="sidebar-scrim" onClick={() => setMenuOpen(false)} aria-label="关闭菜单" />}
      <main className="admin-main">
        <header className="admin-topbar">
          <button type="button" className="admin-menu-button" onClick={() => setMenuOpen(true)} aria-label="打开菜单"><Menu size={21} /></button>
          <div>
            <span className="eyebrow">{navItems.find((item) => item.id === view)?.label}</span>
            <strong>{context.settings.site_title}</strong>
          </div>
          <div className="admin-topbar__right">
            <span className="status-pill"><span /> 云端已连接</span>
          </div>
        </header>
        <div className="admin-content">{content}</div>
      </main>
      <AssetLinkDialog asset={linkAsset} manageShares onClose={() => setLinkAsset(null)} />
    </div>
  );
}

function NavButton({ item, active, onClick }: { item: { id: AdminView; label: string; icon: typeof LayoutDashboard }; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button type="button" className={`admin-nav ${active ? "is-active" : ""}`} onClick={onClick}>
      <Icon size={18} strokeWidth={1.8} />
      <span>{item.label}</span>
      {item.id === "upload" && <span className="admin-nav__hint">NEW</span>}
    </button>
  );
}
