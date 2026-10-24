import { ArrowDown, ArrowUpRight, Image as ImageIcon, Link2, Music2, Play, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { getContext } from "../lib/context";
import type { Asset, OverviewData, SiteSettings } from "../types";
import { ArtMark, AudioController, EmptyState, ImageGrid, Lightbox } from "../components/Media";

type Tab = "images" | "music" | "about";

export function PublicSite({ setupMode = false }: { setupMode?: boolean }) {
  const context = getContext();
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [authState, setAuthState] = useState(context.auth);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tab, setTab] = useState<Tab>("images");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const settings = overview?.settings ?? context.settings;

  useEffect(() => {
    document.title = settings.site_title;
    document.documentElement.style.setProperty("--accent", settings.accent_color);
  }, [settings.site_title, settings.accent_color]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api<OverviewData>("/api/public/overview"),
      api<{ assets: Asset[]; total: number }>(`/api/public/assets?kind=${tab === "images" ? "image" : "music"}&limit=200`)
    ]).then(([overviewData, assetData]) => {
      if (cancelled) return;
      setOverview(overviewData);
      setAssets(assetData.assets);
      setError("");
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tab, authState.authenticated]);

  const filtered = useMemo(() => assets.filter((asset) => {
    if (tag && !asset.tags.includes(tag)) return false;
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return `${asset.title} ${asset.artist ?? ""} ${asset.album ?? ""} ${asset.tags.join(" ")}`.toLowerCase().includes(needle);
  }), [assets, query, tag]);

  const allTags = useMemo(() => [...new Set(assets.flatMap((asset) => asset.tags))].slice(0, 12), [assets]);
  const imageCount = overview?.counts.image ?? 0;
  const musicCount = overview?.counts.music ?? 0;

  function go(tabName: Tab) {
    setTab(tabName);
    setTag(null);
    setQuery("");
    document.getElementById("collection")?.scrollIntoView({ behavior: "smooth" });
  }

  if (setupMode) return <SetupScreen />;

  if (settings.site_visibility === "private" && !authState.authenticated) {
    return <PrivateLanding settings={settings} onUnlock={async () => {
      const next = await context.refreshAuth();
      if (next.authenticated) setAuthState(next);
    }} />;
  }

  return (
    <div className="public-site">
      <div className="paper-grain" aria-hidden="true" />
      <header className="site-header">
        <a href="#" className="site-brand" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
          <ArtMark compact />
          <span>{settings.site_title}</span>
        </a>
        <nav className="site-nav">
          <button type="button" className={tab === "images" ? "is-active" : ""} onClick={() => go("images")}>影像</button>
          <button type="button" className={tab === "music" ? "is-active" : ""} onClick={() => go("music")}>声音</button>
          <button type="button" className={tab === "about" ? "is-active" : ""} onClick={() => go("about")}>关于</button>
        </nav>
        <div className="site-header__right">
          <span className="site-status"><span /> {settings.site_visibility === "private" ? "PRIVATE ARCHIVE" : "PUBLIC ARCHIVE"}</span>
          <a href="/admin" className="site-admin-link">管理入口 <ArrowUpRight size={14} /></a>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero__copy">
            <span className="eyebrow"><Sparkles size={14} /> {settings.hero_eyebrow}</span>
            <h1>{settings.site_title}</h1>
            <p>{settings.site_subtitle}</p>
            <div className="hero__actions">
              <button type="button" className="button button--dark" onClick={() => go("images")}>浏览影像 <ArrowDown size={16} /></button>
              <button type="button" className="button button--text" onClick={() => go("music")}><Music2 size={17} /> 进入聆听室</button>
            </div>
          </div>
          <div className="hero__composition" aria-hidden="true">
            <div className="hero__image hero__image--main">
              {assets.find((asset) => asset.kind === "image") ? <img src={assets.find((asset) => asset.kind === "image")!.mediaUrl} alt="" /> : <div className="hero__placeholder"><ImageIcon size={40} /></div>}
              <span className="hero__caption">FRAGMENT / 01</span>
            </div>
            <div className="hero__image hero__image--secondary">
              {assets.filter((asset) => asset.kind === "image")[1] ? <img src={assets.filter((asset) => asset.kind === "image")[1].mediaUrl} alt="" /> : <div className="hero__placeholder hero__placeholder--warm" />}
            </div>
            <div className="hero__stamp"><span>COLLECTED</span><strong>光<br />与<br />声</strong><span>EST. 2026</span></div>
            <div className="hero__vertical">A PRIVATE MUSEUM OF LIGHT &amp; SOUND · {settings.hero_eyebrow}</div>
          </div>
          <div className="hero__numbers">
            <div><strong>{String(imageCount).padStart(2, "0")}</strong><span>影像收藏</span></div>
            <span className="hero__numbers-rule" />
            <div><strong>{String(musicCount).padStart(2, "0")}</strong><span>声音收藏</span></div>
            <span className="hero__numbers-rule" />
            <div><strong>{String(overview?.repositories.length ?? 0).padStart(2, "0")}</strong><span>云端仓库</span></div>
          </div>
        </section>

        <span className="marquee" aria-hidden="true">LIGHT · SOUND · MEMORY · LIGHT · SOUND · MEMORY · LIGHT · SOUND · MEMORY ·&nbsp;</span>

        <section className="collection" id="collection">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{tab === "images" ? "THE IMAGE ARCHIVE" : tab === "music" ? "THE LISTENING ROOM" : "ABOUT THIS PLACE"}</span>
              <h2>{tab === "images" ? "影像馆" : tab === "music" ? "聆听室" : "关于拾光"}</h2>
            </div>
            {tab !== "about" && (
              <div className="section-heading__side">
                <span className="collection-count">{filtered.length} 件{tab === "images" ? "影像" : "声音"}收藏</span>
                <label className="search-field search-field--public"><SearchIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "images" ? "搜索影像" : "搜索曲目或艺术家"} /></label>
              </div>
            )}
          </div>

          {tab !== "about" && allTags.length > 0 && (
            <div className="tag-filter"><button className={!tag ? "is-active" : ""} type="button" onClick={() => setTag(null)}>全部</button>{allTags.map((item) => <button className={tag === item ? "is-active" : ""} type="button" key={item} onClick={() => setTag(item)}>{item}</button>)}</div>
          )}

          {loading ? (
            <div className="public-loading"><ArtMark /><span>正在打开藏品柜…</span></div>
          ) : error ? (
            <div className="public-error"><h3>暂时无法读取馆藏</h3><p>{error}</p></div>
          ) : tab === "about" ? (
            <AboutSection settings={settings} images={imageCount} music={musicCount} />
          ) : filtered.length === 0 ? (
            <EmptyState kind={tab === "images" ? "image" : "music"} title={tab === "images" ? "影像墙还空着" : "聆听室还很安静"} subtitle={tab === "images" ? "登录工作台，上传第一张值得被记住的照片。" : "把最近反复播放的旋律收藏进来，让这里拥有自己的声音。"} />
          ) : tab === "images" ? (
            <ImageGrid assets={filtered} allowDownload={settings.allow_download} onOpen={setLightbox} />
          ) : (
            <AudioController assets={filtered} allowDownload={settings.allow_download} selectionKey={`${tag ?? "all"}:${query}`} />
          )}
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer__brand"><ArtMark compact /><span>{settings.site_title}</span></div>
        <p>{settings.footer_text}</p>
        <div className="site-footer__meta"><span>IMAGES &amp; SOUND BY <a href="/admin">CURATOR</a></span><a href="/admin">进入工作台 <ArrowUpRight size={13} /></a></div>
      </footer>
      <Lightbox asset={lightbox} onClose={() => setLightbox(null)} allowDownload={settings.allow_download} />
    </div>
  );
}

function PrivateLanding({ settings, onUnlock }: { settings: SiteSettings; onUnlock: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function enter() {
    setBusy(true);
    try {
      await onUnlock();
      window.location.assign("/admin");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="private-landing">
      <div className="paper-grain" aria-hidden="true" />
      <header className="site-header">
        <a href="/" className="site-brand"><ArtMark compact /><span>{settings.site_title}</span></a>
        <nav className="site-nav"><span>私人收藏</span><span>光与声</span></nav>
        <div className="site-header__right"><span className="site-status"><span /> PRIVATE ONLY</span><a href="/admin" className="site-admin-link">管理入口 <ArrowUpRight size={14} /></a></div>
      </header>
      <main className="private-landing__body">
        <div className="private-landing__copy">
          <span className="eyebrow"><Sparkles size={14} /> {settings.hero_eyebrow}</span>
          <h1>{settings.site_title}</h1>
          <p>{settings.site_subtitle}</p>
          <div className="private-landing__rule" />
          <span className="private-landing__note">这是一个私人馆藏。馆藏内容仅对已登录的管理员开放。</span>
          <button className="button button--dark" type="button" onClick={enter} disabled={busy}>{busy ? "正在验证…" : "登录后进入"} <ArrowUpRight size={16} /></button>
        </div>
        <div className="private-landing__art" aria-hidden="true">
          <div className="private-landing__frame" />
          <div className="private-landing__sun" />
          <div className="private-landing__photo" />
          <span>光<br />声</span>
          <small>PRIVATE<br />ARCHIVE</small>
        </div>
      </main>
      <footer className="site-footer"><div className="site-footer__brand"><ArtMark compact /><span>{settings.site_title}</span></div><p>{settings.footer_text}</p><div className="site-footer__meta"><span>PRIVATE COLLECTION</span><a href="/admin">进入工作台 <ArrowUpRight size={13} /></a></div></footer>
    </div>
  );
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
}

function AboutSection({ settings, images, music }: { settings: SiteSettings; images: number; music: number }) {
  return (
    <div className="about-section">
      <div className="about-section__intro">
        <span className="about-section__number">01</span>
        <h3>一个不追逐流量的<br />私人收藏空间。</h3>
        <p>{settings.site_description}。这里没有算法推荐，没有信息流，只有你亲手挑选、愿意反复看见与听见的东西。</p>
      </div>
      <div className="about-section__stack">
        <div className="about-card about-card--stat"><span className="eyebrow">THE COLLECTION</span><strong>{String(images + music).padStart(2, "0")}</strong><p>件被认真收藏的光影与声音</p><div><span>{images} 张影像</span><span>{music} 首音乐</span></div></div>
        <div className="about-card about-card--tech"><span className="eyebrow">HOW IT WORKS</span><div className="about-route"><span>Cloudflare</span><i /><span>GitHub</span><i /><span>GitLab</span></div><p>页面部署在 Cloudflare Workers，原始文件安全存放在你自己的 GitHub 私有仓库，并可按年手动镜像到 GitLab。</p></div>
      </div>
      <div className="about-quote"><span>“</span><blockquote>收藏不是囤积，<br />是对抗遗忘的一种温柔方式。</blockquote><span className="about-quote__mark">S</span></div>
    </div>
  );
}

function SetupScreen() {
  const context = getContext();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) { setError("两次输入的密码不一致"); return; }
    setBusy(true);
    setError("");
    try {
      const response = await api<{ ok: boolean; csrfToken: string }>("/api/auth/setup", { method: "POST", body: JSON.stringify({ password }) });
      await context.refreshAuth();
      window.location.href = "/admin";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "初始化失败");
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-panel auth-panel--setup">
        <div className="auth-panel__brand"><ArtMark /><span>拾光储藏室</span></div>
        <span className="eyebrow">FIRST TIME SETUP</span>
        <h1>为你的储藏室<br />设置一把钥匙。</h1>
        <p>第一次使用需要创建管理员密码。它只用于进入后台，密码会经过 PBKDF2 哈希后保存。</p>
        <form onSubmit={submit}>
          <label className="field"><span>管理员密码 <small>至少 8 位</small></span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} autoComplete="new-password" required autoFocus /></label>
          <label className="field"><span>再次输入密码</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
          {error && <p className="form-error">{error}</p>}
          <button className="button button--dark button--wide" type="submit" disabled={busy}>{busy ? "正在创建…" : "创建并进入工作台"}</button>
        </form>
        <small className="auth-panel__note">无需云账号。后续可在「存储库」中连接 GitHub 与 GitLab。</small>
      </div>
      <div className="auth-art" aria-hidden="true"><div className="auth-art__circle" /><div className="auth-art__frame" /><span>光<br />声</span><small>PRIVATE<br />ARCHIVE</small></div>
    </div>
  );
}