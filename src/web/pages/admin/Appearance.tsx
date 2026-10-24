import { useEffect, useState } from "react";
import { ArchiveRestore, Check, Eye, Image, LoaderCircle, Music2, Palette, ShieldCheck } from "lucide-react";
import type { Repository, SiteSettings } from "../../types";
import { api } from "../../lib/api";
import { getContext } from "../../lib/context";
import { colorWithAlpha } from "../../lib/format";

export function AdminAppearance({ repositories }: { repositories: Repository[] }) {
  const context = getContext();
  const [settings, setSettings] = useState<SiteSettings>(context.settings);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api<{ settings: SiteSettings }>("/api/admin/settings")
      .then((response) => {
        if (!active) return;
        setSettings(response.settings);
        setReady(true);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "站点配置读取失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  function set<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await api<{ settings: SiteSettings }>("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings) });
      setSettings(response.settings);
      context.updateSettings(response.settings);
      setNotice("站点配置已保存，刷新展示页即可看到变化。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page__heading"><div><span className="eyebrow">SITE CHARACTER</span><h1>站点外观</h1><p>调整展示站的语气、色彩和访问方式。</p></div><a className="button button--ghost" href="/" target="_blank"><Eye size={17} /> 预览站点</a></div>
      <div className="appearance-layout">
        <form className="panel settings-form" onSubmit={save}>
          <div className="panel__header"><div><span className="eyebrow">GENERAL</span><h2>基本信息</h2></div><Palette size={19} /></div>
          <label className="field"><span>站点标题</span><input value={settings.site_title} onChange={(event) => set("site_title", event.target.value)} required /></label>
          <label className="field"><span>小标题</span><input value={settings.site_subtitle} onChange={(event) => set("site_subtitle", event.target.value)} /></label>
          <label className="field"><span>页眉短句</span><input value={settings.hero_eyebrow} onChange={(event) => set("hero_eyebrow", event.target.value)} /></label>
          <label className="field"><span>站点描述 <small>用于浏览器与分享</small></span><textarea value={settings.site_description} onChange={(event) => set("site_description", event.target.value)} rows={3} /></label>
          <div className="field-row">
            <label className="field"><span>主色调</span><div className="color-field"><input type="color" value={settings.accent_color} onChange={(event) => set("accent_color", event.target.value)} /><input value={settings.accent_color} onChange={(event) => set("accent_color", event.target.value)} /></div></label>
            <label className="field"><span>访问方式</span><select value={settings.site_visibility} onChange={(event) => set("site_visibility", event.target.value as SiteSettings["site_visibility"])}><option value="private">仅管理员可见</option><option value="public">公开可访问</option></select></label>
          </div>
          <label className="field"><span>页脚文字</span><input value={settings.footer_text} onChange={(event) => set("footer_text", event.target.value)} /></label>
          <div className="settings-switches">
            <label className="switch-field switch-field--box"><input type="checkbox" checked={settings.allow_download} onChange={(event) => set("allow_download", event.target.checked)} /><span /><div><strong>允许访客下载原文件</strong><small>关闭后，访客仍可查看与播放，但不能直接下载。</small></div></label>
            <div className="manual-backup-note"><ArchiveRestore size={17} /><div><strong>GitLab 备份按需执行</strong><small>为避免触发 Cloudflare 请求限制，备份统一在「存储库」中手动执行，适合按年维护。</small></div></div>
          </div>
          {notice && <div className="form-result is-success"><Check size={17} /><span>{notice}</span></div>}
          {error && <p className="form-error">{error}</p>}
          <button className="button button--accent" type="submit" disabled={busy || loading || !ready}>{busy ? <><LoaderCircle className="spin" size={17} /> 保存中</> : loading ? "正在读取配置…" : "保存站点设置"}</button>
        </form>

        <aside className="appearance-preview" style={{ "--site-accent": settings.accent_color } as React.CSSProperties}>
          <div className="appearance-preview__label"><span>LIVE PREVIEW</span><small>展示页缩略预览</small></div>
          <div className="preview-browser">
            <div className="preview-browser__bar"><span /><span /><span /><small>your-domain.com</small></div>
            <div className="preview-page">
              <div className="preview-nav"><strong>{settings.site_title}</strong><span>影像　声音　关于</span></div>
              <div className="preview-hero">
                <span>{settings.hero_eyebrow}</span>
                <h2>{settings.site_title}</h2>
                <p>{settings.site_subtitle}</p>
              </div>
              <div className="preview-tiles"><span><Image size={16} /></span><span /><span><Music2 size={16} /></span></div>
              <footer>{settings.footer_text}</footer>
            </div>
          </div>
          <div className="appearance-preview__swatches">
            <div><span style={{ background: settings.accent_color }} /><small>主色</small></div>
            <div><span style={{ background: "#f4f0e8" }} /><small>纸白</small></div>
            <div><span style={{ background: "#171916" }} /><small>墨黑</small></div>
            <div><span style={{ background: colorWithAlpha(settings.accent_color, 0.18) }} /><small>柔光</small></div>
          </div>
          <div className="privacy-note"><ShieldCheck size={17} /><p>当前访问策略：<strong>{settings.site_visibility === "public" ? "公开可访问" : "仅管理员可见"}</strong>。仓库始终为私有，媒体读取由 Worker 鉴权代理。</p></div>
        </aside>
      </div>
    </div>
  );
}