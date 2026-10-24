import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Download, Heart, Maximize2, Pause, Play, Repeat2, Shuffle, SkipBack, SkipForward, Volume2, X } from "lucide-react";
import type { Asset, AssetKind } from "../types";
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

type ImageGridProps = {
  assets: Asset[];
  allowDownload: boolean;
  onOpen: (asset: Asset) => void;
};

export function ImageGrid({ assets, allowDownload, onOpen }: ImageGridProps) {
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
            {allowDownload && (
              <a href={downloadUrl(asset)} className="icon-link" download aria-label="下载图片">
                <ArrowUpRight size={17} />
              </a>
            )}
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
};

export function Lightbox({ asset, onClose, allowDownload }: LightboxProps) {
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
        {allowDownload && (
          <a className="button button--light" href={downloadUrl(asset)} download>
            <Download size={17} /> 下载原图
          </a>
        )}
      </aside>
    </div>
  );
}

type MusicShelfProps = {
  assets: Asset[];
  currentId: string | null;
  playing: boolean;
  onPlay: (asset: Asset) => void;
  allowDownload: boolean;
};

export function MusicShelf({ assets, currentId, playing, onPlay, allowDownload }: MusicShelfProps) {
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
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="track-list">
          <div className="track-list__head"><span>#</span><span>曲目</span><span>专辑</span><span>时长</span><span /></div>
          {assets.map((asset, index) => (
            <button type="button" className={`track-row ${currentId === asset.id ? "is-current" : ""}`} key={asset.id} onClick={() => onPlay(asset)}>
              <span className="track-row__index">{currentId === asset.id && playing ? <Volume2 size={15} /> : String(index + 1).padStart(2, "0")}</span>
              <span className="track-row__title"><strong>{asset.title}</strong><small>{asset.artist || "未知艺术家"}</small></span>
              <span>{asset.album || "未归类"}</span>
              <span>{formatDuration(asset.duration)}</span>
              <span>{allowDownload && <a href={downloadUrl(asset)} download onClick={(event) => event.stopPropagation()} aria-label="下载"><Download size={16} /></a>}</span>
            </button>
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
};

export function PlayerBar({ asset, playing, onToggle, onNext, onPrevious, audioRef, allowDownload }: PlayerBarProps) {
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
        {allowDownload && <a href={downloadUrl(asset)} download aria-label="下载音乐"><Download size={18} /></a>}
      </div>
    </div>
  );
}

export function AudioController({
  assets,
  allowDownload,
  selectionKey
}: {
  assets: Asset[];
  allowDownload: boolean;
  selectionKey: string;
}) {
  const audioRef = useMemo(() => ({ current: null as HTMLAudioElement | null }), [selectionKey]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const current = assets.find((asset) => asset.id === currentId) ?? null;

  useEffect(() => {
    setCurrentId(null);
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
    setPlaying(true);
  }

  function move(direction: 1 | -1) {
    if (!assets.length) return;
    const index = assets.findIndex((asset) => asset.id === currentId);
    const nextIndex = index === -1 ? 0 : (index + direction + assets.length) % assets.length;
    setCurrentId(assets[nextIndex].id);
    setPlaying(true);
  }

  return (
    <>
      <MusicShelf assets={assets} currentId={currentId} playing={playing} onPlay={select} allowDownload={allowDownload} />
      <PlayerBar
        asset={current}
        playing={playing}
        onToggle={() => setPlaying((value) => !value)}
        onNext={() => move(1)}
        onPrevious={() => move(-1)}
        audioRef={audioRef as React.RefObject<HTMLAudioElement | null>}
        allowDownload={allowDownload}
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