import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, Clipboard, Copy, Download, ExternalLink, Globe2, Heart, Link2, Maximize2, Music2, Pause, Play, Repeat2, Shuffle, SkipBack, SkipForward, Trash2, Volume2, X } from "lucide-react";
import type { Asset, AssetKind } from "../types";
import { api } from "../lib/api";
import { downloadUrl, formatBytes, formatDate, formatDuration } from "../lib/format";

export function ArtMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`art-mark ${compact ? "art-mark--compact" : ""}`} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function absoluteMediaUrl(asset: Asset): string {
  return new URL(asset.mediaUrl, window.location.origin).toString();
}

function escapedMarkdownTitle(title: string): string {
  return title.replace(/\r?\n/g, " ").replace(/([\\\[\]])/g, "\\$1");
}

function markdownFor(asset: Asset, url: string): string {
  const title = escapedMarkdownTitle(asset.title);
  return asset.kind === "image" ? `![${title}](${url})` : `[${title}](${url})`;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("浏览器未允许复制，请手动选择链接");
}

type AssetLinkDialogProps = {
  asset: Asset | null;
  privateArchive?: boolean;
  manageShares?: boolean;
  onClose: () => void;
};

type ShareDuration = "permanent" | "7d" | "30d" | "1y";

type ShareLink = {
  id: string;
  url: string;
  expiresAt: string | null;
  createdAt: string;
};

function shareExpiryLabel(expiresAt: string | null): string {
  return expiresAt ? `有效期至 ${formatDate(expiresAt)}` : "永久有效";
}

export function AssetLinkDialog({ asset, privateArchive = false, manageShares = false, onClose }: AssetLinkDialogProps) {
  const [copied, setCopied] = useState<"url" | "markdown" | null>(null);
  const [error, setError] = useState("");
  const [duration, setDuration] = useState<ShareDuration>("permanent");
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [selectedShareId, setSelectedShareId] = useState<string | null>(null);
  const [loadingShares, setLoadingShares] = useState(false);
  const [creatingShare, setCreatingShare] = useState(false);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);

  useEffect(() => {
    if (!asset) return;
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    document.body.classList.add("overlay-open");
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.classList.remove("overlay-open");
    };
  }, [asset, onClose]);

  useEffect(() => {
    setCopied(null);
    setError("");
    setDuration("permanent");
    setShares([]);
    setSelectedShareId(null);
    if (!asset || !manageShares) return;
    const request = new AbortController();
    setLoadingShares(true);
    api<{ shares: ShareLink[] }>(`/api/admin/assets/${encodeURIComponent(asset.id)}/shares`, { signal: request.signal })
      .then((data) => {
        setShares(data.shares);
        setSelectedShareId(data.shares[0]?.id ?? null);
      })
      .catch((cause) => {
        if (cause instanceof Error && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "分享链接读取失败");
      })
      .finally(() => {
        if (!request.signal.aborted) setLoadingShares(false);
      });
    return () => request.abort();
  }, [asset?.id, manageShares]);

  if (!asset) return null;
  const currentAsset = asset;
  const selectedShare = shares.find((share) => share.id === selectedShareId) ?? shares[0] ?? null;
  const url = selectedShare?.url ?? absoluteMediaUrl(currentAsset);
  const markdown = markdownFor(currentAsset, url);
  const showLinkFields = !manageShares || Boolean(selectedShare);

  async function copy(kind: "url" | "markdown") {
    setError("");
    try {
      await copyText(kind === "url" ? url : markdown);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "复制失败，请手动选择链接");
    }
  }

  async function createShare() {
    setCreatingShare(true);
    setError("");
    setCopied(null);
    try {
      const data = await api<{ share: ShareLink }>(`/api/admin/assets/${encodeURIComponent(currentAsset.id)}/shares`, {
        method: "POST",
        body: JSON.stringify({ duration })
      });
      setShares((current) => [data.share, ...current]);
      setSelectedShareId(data.share.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "公开链接生成失败");
    } finally {
      setCreatingShare(false);
    }
  }

  async function revokeShare(shareId: string) {
    setRevokingShareId(shareId);
    setError("");
    try {
      await api(`/api/admin/assets/${encodeURIComponent(currentAsset.id)}/shares/${encodeURIComponent(shareId)}`, { method: "DELETE" });
      const remaining = shares.filter((share) => share.id !== shareId);
      setShares(remaining);
      if (selectedShareId === shareId) setSelectedShareId(remaining[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "撤销分享链接失败");
    } finally {
      setRevokingShareId(null);
    }
  }

  return (
    <div className="dialog-backdrop link-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog link-dialog" role="dialog" aria-modal="true" aria-labelledby="link-dialog-title">
        <div className="dialog__header">
          <div><span className="eyebrow">{asset.kind === "image" ? "IMAGE LINK" : "AUDIO LINK"}</span><h2 id="link-dialog-title">获取作品链接</h2></div>
          <button type="button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="link-dialog__asset">
          <span>{asset.kind === "image" ? <ImageLinkMark /> : <Music2 size={19} />}</span>
          <div><strong>{asset.title}</strong><small>{asset.filename}</small></div>
        </div>
        {privateArchive && !manageShares && (
          <div className="link-dialog__private"><LockIcon /><span>当前是私人馆藏。链接可复制，但访客需要先登录工作台才能打开媒体。</span></div>
        )}
        {manageShares && (
          <>
            <div className="link-dialog__private link-dialog__private--public"><Globe2 size={17} /><span>公开分享链接无需登录，持有链接即可预览。可设置有效期，也可随时撤销。</span></div>
            <div className="share-create">
              <label><span>链接有效期</span><select value={duration} onChange={(event) => setDuration(event.target.value as ShareDuration)}><option value="permanent">永久（默认）</option><option value="7d">7 天</option><option value="30d">30 天</option><option value="1y">1 年</option></select></label>
              <button className="button button--accent" type="button" onClick={createShare} disabled={creatingShare || loadingShares}>{creatingShare ? "正在生成…" : "生成公开链接"}</button>
            </div>
            {loadingShares ? (
              <p className="link-dialog__hint">正在读取已有分享链接…</p>
            ) : shares.length > 0 ? (
              <div className="share-list" aria-label="有效分享链接">
                {shares.map((share) => (
                  <div className={`share-list__item ${share.id === selectedShare?.id ? "is-active" : ""}`} key={share.id}>
                    <button type="button" className="share-list__select" onClick={() => { setSelectedShareId(share.id); setCopied(null); }}>
                      <span>{shareExpiryLabel(share.expiresAt)}</span>
                      <small>创建于 {formatDate(share.createdAt)}</small>
                    </button>
                    <button type="button" className="share-list__revoke" onClick={() => revokeShare(share.id)} disabled={revokingShareId === share.id} aria-label="撤销此分享链接" title="撤销此分享链接"><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="link-dialog__hint">还没有公开分享链接。选择有效期后生成一个即可。</p>
            )}
          </>
        )}
        {showLinkFields && (
          <>
            <label className="link-field">
              <span>{manageShares ? "公开访问链接" : "可访问链接"}</span>
              <div><input value={url} readOnly onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={() => copy("url")} aria-label="复制可访问链接">{copied === "url" ? <Check size={16} /> : <Copy size={16} />}<span>{copied === "url" ? "已复制" : "复制"}</span></button></div>
            </label>
            <label className="link-field">
              <span>Markdown {asset.kind === "image" ? "图片嵌入" : "音乐链接"}</span>
              <div><textarea value={markdown} readOnly rows={3} onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={() => copy("markdown")} aria-label="复制 Markdown 链接">{copied === "markdown" ? <Check size={16} /> : <Clipboard size={16} />}<span>{copied === "markdown" ? "已复制" : "复制"}</span></button></div>
            </label>
            <p className="link-dialog__hint">{asset.kind === "image" ? "图片使用 Markdown 图片语法，粘贴到支持 Markdown 的编辑器即可显示。" : "音乐使用 Markdown 普通链接语法，粘贴后可直接打开播放。"}</p>
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        {showLinkFields && (
          <div className="dialog__actions">
            <a className="button button--ghost" href={url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> 打开原文件</a>
            <button className="button button--accent" type="button" onClick={() => copy("markdown")}>{copied === "markdown" ? <Check size={16} /> : <Link2 size={16} />} {copied === "markdown" ? "已复制 Markdown" : "复制 Markdown"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ImageLinkMark() {
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="9" cy="10" r="2" /><path d="m4 18 5-5 4 4 2-2 5 4" /></svg>;
}

function LockIcon() {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="1" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
}

type ImageGridProps = {
  assets: Asset[];
  allowDownload: boolean;
  onOpen: (asset: Asset) => void;
  onGetLink: (asset: Asset) => void;
};

export function ImageGrid({ assets, allowDownload, onOpen, onGetLink }: ImageGridProps) {
  return (
    <div className="image-grid">
      {assets.map((asset, index) => (
        <article className={`image-card image-card--${index % 6}`} key={asset.id}>
          <button className="image-card__frame" type="button" onClick={() => onOpen(asset)} aria-label={`查看 ${asset.title}`}>
            <img src={asset.mediaUrl} alt={asset.title} loading={index < 6 ? "eager" : "lazy"} />
            <span className="image-card__index">{String(index + 1).padStart(2, "0")}</span>
            <span className="image-card__hover">
              <Maximize2 size={18} strokeWidth={1.5} />
              查看原图
            </span>
          </button>
          <div className="image-card__meta">
            <div>
              <h3>{asset.title}</h3>
              <p>{formatDate(asset.createdAt)} · {formatBytes(asset.size)}</p>
            </div>
            <div className="image-card__actions">
              <button type="button" className="icon-link" onClick={() => onGetLink(asset)} aria-label={`获取 ${asset.title} 的链接`} title="获取链接"><Link2 size={17} /></button>
              {allowDownload && (
                <a href={downloadUrl(asset)} className="icon-link" download aria-label="下载图片" title="下载原图">
                  <ArrowUpRight size={17} />
                </a>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

type LightboxProps = {
  asset: Asset | null;
  onClose: () => void;
  allowDownload: boolean;
  onGetLink: (asset: Asset) => void;
};

export function Lightbox({ asset, onClose, allowDownload, onGetLink }: LightboxProps) {
  useEffect(() => {
    if (!asset) return;
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    document.body.classList.add("overlay-open");
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.classList.remove("overlay-open");
    };
  }, [asset, onClose]);

  if (!asset) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={asset.title}>
      <button className="lightbox__close" type="button" onClick={onClose} aria-label="关闭"><X size={22} /></button>
      <div className="lightbox__stage">
        <img src={asset.mediaUrl} alt={asset.title} />
      </div>
      <aside className="lightbox__aside">
        <span className="eyebrow">IMAGE / {asset.repoLabel ?? "COLLECTION"}</span>
        <h2>{asset.title}</h2>
        <div className="detail-rule" />
        <dl>
          <div><dt>尺寸</dt><dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "原始尺寸"}</dd></div>
          <div><dt>文件</dt><dd>{formatBytes(asset.size)}</dd></div>
          <div><dt>收录</dt><dd>{formatDate(asset.createdAt)}</dd></div>
          <div><dt>路径</dt><dd className="detail-path">{asset.path}</dd></div>
        </dl>
        {asset.tags.length > 0 && (
          <div className="tag-list">{asset.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        )}
        <div className="lightbox__actions">
          <button className="button button--light" type="button" onClick={() => onGetLink(asset)}><Link2 size={17} /> 获取链接</button>
          {allowDownload && (
            <a className="button button--light" href={downloadUrl(asset)} download>
              <Download size={17} /> 下载原图
            </a>
          )}
        </div>
      </aside>
    </div>
  );
}

type MusicShelfProps = {
  assets: Asset[];
  currentId: string | null;
  playing: boolean;
  onPlay: (asset: Asset) => void;
  onGetLink: (asset: Asset) => void;
  allowDownload: boolean;
};

export function MusicShelf({ assets, currentId, playing, onPlay, onGetLink, allowDownload }: MusicShelfProps) {
  const [view, setView] = useState<"shelf" | "list">("shelf");
  return (
    <>
      <div className="section-controls">
        <div className="segmented segmented--small">
          <button className={view === "shelf" ? "is-active" : ""} type="button" onClick={() => setView("shelf")}>唱片架</button>
          <button className={view === "list" ? "is-active" : ""} type="button" onClick={() => setView("list")}>曲目表</button>
        </div>
      </div>
      {view === "shelf" ? (
        <div className="music-grid">
          {assets.map((asset, index) => (
            <article className={`music-card ${currentId === asset.id ? "is-current" : ""}`} key={asset.id}>
              <button type="button" className="music-card__cover" onClick={() => onPlay(asset)} aria-label={`播放 ${asset.title}`}>
                <span className={`record ${playing && currentId === asset.id ? "is-spinning" : ""}`}>
                  <span className="record__label">{String(index + 1).padStart(2, "0")}</span>
                </span>
                <span className="music-card__play">
                  {playing && currentId === asset.id ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                </span>
              </button>
              <div className="music-card__text">
                <span className="music-card__number">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{asset.title}</h3>
                  <p>{asset.artist || "未知艺术家"}</p>
                </div>
              </div>
              <div className="music-card__foot">
                <span>{asset.album || "未归类专辑"}</span>
                <span>{formatDuration(asset.duration)}</span>
                <button type="button" onClick={() => onGetLink(asset)} aria-label={`获取 ${asset.title} 的链接`} title="获取链接"><Link2 size={14} /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="track-list">
          <div className="track-list__head"><span>#</span><span>曲目</span><span>专辑</span><span>时长</span><span>操作</span></div>
          {assets.map((asset, index) => (
            <div className={`track-row ${currentId === asset.id ? "is-current" : ""}`} key={asset.id} onClick={() => onPlay(asset)}>
              <button type="button" className="track-row__index" onClick={(event) => { event.stopPropagation(); onPlay(asset); }} aria-label={`播放 ${asset.title}`}>{currentId === asset.id && playing ? <Volume2 size={15} /> : String(index + 1).padStart(2, "0")}</button>
              <span className="track-row__title"><strong>{asset.title}</strong><small>{asset.artist || "未知艺术家"}</small></span>
              <span>{asset.album || "未归类"}</span>
              <span>{formatDuration(asset.duration)}</span>
              <span className="track-row__actions">
                <button type="button" onClick={(event) => { event.stopPropagation(); onGetLink(asset); }} aria-label="获取链接" title="获取链接"><Link2 size={15} /></button>
                {allowDownload && <a href={downloadUrl(asset)} download onClick={(event) => event.stopPropagation()} aria-label="下载"><Download size={16} /></a>}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

type PlayerBarProps = {
  asset: Asset | null;
  playing: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrevious: () => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  allowDownload: boolean;
  onGetLink: (asset: Asset) => void;
};

export function PlayerBar({ asset, playing, onToggle, onNext, onPrevious, audioRef, allowDownload, onGetLink }: PlayerBarProps) {
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(asset?.duration ?? 0);
  const [volume, setVolume] = useState(0.8);

  useEffect(() => {
    setProgress(0);
    setDuration(asset?.duration ?? 0);
  }, [asset?.id]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume, audioRef]);

  if (!asset) return null;

  function seek(value: number) {
    if (!audioRef.current || !Number.isFinite(value)) return;
    audioRef.current.currentTime = value;
    setProgress(value);
  }

  return (
    <div className="player-bar">
      <audio
        ref={audioRef}
        src={asset.mediaUrl}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onEnded={onNext}
      />
      <div className="player-bar__track">
        <span className={`player-bar__disc ${playing ? "is-spinning" : ""}`}><span /></span>
        <div>
          <strong>{asset.title}</strong>
          <span>{asset.artist || "未知艺术家"} · {asset.album || "未归类专辑"}</span>
        </div>
      </div>
      <div className="player-bar__center">
        <div className="player-bar__controls">
          <button type="button" aria-label="上一首" onClick={onPrevious}><SkipBack size={18} fill="currentColor" /></button>
          <button type="button" className="player-bar__toggle" aria-label={playing ? "暂停" : "播放"} onClick={onToggle}>
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button type="button" aria-label="下一首" onClick={onNext}><SkipForward size={18} fill="currentColor" /></button>
        </div>
        <div className="player-bar__timeline">
          <span>{formatDuration(progress)}</span>
          <input
            type="range" min={0} max={Number.isFinite(duration) ? duration : 0} step={0.1} value={progress}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="播放进度" style={{ "--progress": `${duration ? (progress / duration) * 100 : 0}%` } as React.CSSProperties}
          />
          <span>{formatDuration(duration)}</span>
        </div>
      </div>
      <div className="player-bar__actions">
        <button type="button" aria-label="随机播放"><Shuffle size={17} /></button>
        <button type="button" aria-label="循环播放"><Repeat2 size={17} /></button>
        <Volume2 size={17} />
        <input
          className="volume" type="range" min={0} max={1} step={0.01} value={volume}
          onChange={(event) => setVolume(Number(event.target.value))} aria-label="音量"
        />
        <button type="button" onClick={() => onGetLink(asset)} aria-label="获取音乐链接" title="获取链接"><Link2 size={17} /></button>
        {allowDownload && <a href={downloadUrl(asset)} download aria-label="下载音乐" title="下载音乐"><Download size={18} /></a>}
      </div>
    </div>
  );
}

export function AudioController({
  assets,
  allowDownload,
  selectionKey,
  onGetLink
}: {
  assets: Asset[];
  allowDownload: boolean;
  selectionKey: string;
  onGetLink: (asset: Asset) => void;
}) {
  const audioRef = useMemo(() => ({ current: null as HTMLAudioElement | null }), [selectionKey]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentAsset, setCurrentAsset] = useState<Asset | null>(null);
  const [playing, setPlaying] = useState(false);
  const current = assets.find((asset) => asset.id === currentId) ?? currentAsset;

  useEffect(() => {
    setCurrentId(null);
    setCurrentAsset(null);
    setPlaying(false);
  }, [selectionKey]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, [playing, currentId, audioRef]);

  function select(asset: Asset) {
    if (currentId === asset.id) {
      setPlaying((value) => !value);
      return;
    }
    setCurrentId(asset.id);
    setCurrentAsset(asset);
    setPlaying(true);
  }

  function move(direction: 1 | -1) {
    if (!assets.length) return;
    const index = assets.findIndex((asset) => asset.id === currentId);
    const nextIndex = index === -1 ? 0 : (index + direction + assets.length) % assets.length;
    setCurrentId(assets[nextIndex].id);
    setCurrentAsset(assets[nextIndex]);
    setPlaying(true);
  }

  return (
    <>
      <MusicShelf assets={assets} currentId={currentId} playing={playing} onPlay={select} onGetLink={onGetLink} allowDownload={allowDownload} />
      <PlayerBar
        asset={current}
        playing={playing}
        onToggle={() => setPlaying((value) => !value)}
        onNext={() => move(1)}
        onPrevious={() => move(-1)}
        audioRef={audioRef as React.RefObject<HTMLAudioElement | null>}
        allowDownload={allowDownload}
        onGetLink={onGetLink}
      />
    </>
  );
}

export function EmptyState({ kind, title, subtitle }: { kind: AssetKind; title: string; subtitle: string }) {
  return (
    <div className="empty-state">
      <ArtMark />
      <span className="eyebrow">{kind === "image" ? "IMAGE ARCHIVE" : "LISTENING ROOM"}</span>
      <h3>{title}</h3>
      <p>{subtitle}</p>
    </div>
  );
}

export function AssetMeta({ asset }: { asset: Asset }) {
  return (
    <div className="asset-meta">
      {asset.kind === "image" && <Heart size={16} />}
      <span>{asset.repoLabel}</span>
      <span>·</span>
      <span>{formatDate(asset.createdAt)}</span>
    </div>
  );
}
