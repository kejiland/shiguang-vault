import { ArrowRight, Database, Image, Link2, Music2, UploadCloud, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import type { Asset, AdminView, Repository } from "../../types";
import { formatDate } from "../../lib/format";

type Props = {
  assets: Asset[];
  counts: Record<string, number>;
  imageCount: number;
  musicCount: number;
  repositories: Repository[];
  onNavigate: (view: AdminView) => void;
  onGetLink: (asset: Asset) => void;
};

export function AdminOverview({ assets, counts, imageCount, musicCount, repositories, onNavigate, onGetLink }: Props) {
  const mirrorFailures = Number(counts.mirror_failures ?? 0);
  const recent = assets.slice(0, 5);
  const gitlabRepos = repositories.filter((repo) => repo.provider === "gitlab");
  return (
    <div className="admin-page">
      <div className="admin-page__heading">
        <div>
          <span className="eyebrow">GOOD DAY, CURATOR</span>
          <h1>今天，也收藏一点光。</h1>
          <p>管理你的私人影像与音乐馆藏，所有文件都安全地存放在你自己的 GitHub 仓库里。</p>
        </div>
        <button className="button button--accent" type="button" onClick={() => onNavigate("upload")}><UploadCloud size={18} /> 上传新作品</button>
      </div>

      <div className="stat-grid">
        <button className="stat-card" type="button" onClick={() => onNavigate("library")}>
          <span className="stat-card__icon"><Image size={20} /></span>
          <span className="stat-card__label">影像馆藏</span>
          <strong>{imageCount.toString().padStart(2, "0")}</strong>
          <span className="stat-card__meta">查看全部图片 <ArrowRight size={14} /></span>
        </button>
        <button className="stat-card stat-card--music" type="button" onClick={() => onNavigate("library")}>
          <span className="stat-card__icon"><Music2 size={20} /></span>
          <span className="stat-card__label">声音收藏</span>
          <strong>{musicCount.toString().padStart(2, "0")}</strong>
          <span className="stat-card__meta">查看全部音乐 <ArrowRight size={14} /></span>
        </button>
        <button className="stat-card stat-card--plain" type="button" onClick={() => onNavigate("repositories")}>
          <span className="stat-card__icon"><Database size={20} /></span>
          <span className="stat-card__label">已连接仓库</span>
          <strong>{repositories.filter((repo) => repo.enabled).length.toString().padStart(2, "0")}</strong>
          <span className="stat-card__meta">管理存储与备份 <ArrowRight size={14} /></span>
        </button>
        <div className={`stat-card stat-card--status ${mirrorFailures ? "has-warning" : ""}`}>
          <span className="stat-card__icon">{mirrorFailures ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}</span>
          <span className="stat-card__label">备份状态</span>
          <strong>{mirrorFailures ? mirrorFailures : "OK"}</strong>
          <span className="stat-card__meta">{mirrorFailures ? "项备份需要处理" : "GitLab 备份运行正常"}</span>
        </div>
      </div>

      <div className="admin-two-col">
        <section className="panel">
          <div className="panel__header">
            <div><span className="eyebrow">RECENTLY ADDED</span><h2>最近收藏</h2></div>
            <button className="text-button" type="button" onClick={() => onNavigate("library")}>全部内容 <ArrowRight size={15} /></button>
          </div>
          {recent.length ? (
            <div className="recent-list">
              {recent.map((asset) => (
                <div className="recent-item" key={asset.id}>
                  <div className={`recent-item__thumb ${asset.kind === "music" ? "is-music" : ""}`}>
                    {asset.kind === "image" ? <img src={asset.mediaUrl} alt="" loading="lazy" /> : <Music2 size={19} />}
                  </div>
                  <div className="recent-item__title">
                    <strong>{asset.title}</strong>
                    <span>{asset.kind === "image" ? "影像" : asset.artist || "音乐"} · {asset.repoLabel}</span>
                  </div>
                  <span className="recent-item__date">{formatDate(asset.createdAt)}</span>
                  <div className="recent-item__actions"><button type="button" className="row-action" onClick={() => onGetLink(asset)} aria-label="获取链接" title="获取链接"><Link2 size={15} /></button><span className="tag tag--muted">{asset.kind === "image" ? "IMAGE" : "AUDIO"}</span></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="admin-empty">
              <p>还没有作品。上传第一张图片或第一首歌，开始建立你的私人馆藏。</p>
              <button className="text-button" type="button" onClick={() => onNavigate("upload")}>去上传 <ArrowRight size={15} /></button>
            </div>
          )}
        </section>

        <section className="panel panel--dark">
          <div className="panel__header">
            <div><span className="eyebrow">STORAGE ROUTE</span><h2>存储路线</h2></div>
            <button className="panel-icon-button" type="button" onClick={() => onNavigate("repositories")} aria-label="管理存储库"><RefreshCw size={17} /></button>
          </div>
          <div className="storage-route">
            <div className="storage-route__node">
              <span className="storage-route__dot" />
              <div><strong>Cloudflare</strong><small>展示与反代入口</small></div>
            </div>
            <span className="storage-route__line" />
            <div className="storage-route__node">
              <span className="storage-route__dot storage-route__dot--primary" />
              <div><strong>GitHub</strong><small>{repositories.filter((repo) => repo.provider === "github" && repo.enabled).length} 个主仓库</small></div>
            </div>
            <span className="storage-route__line storage-route__line--dashed" />
            <div className="storage-route__node">
              <span className="storage-route__dot storage-route__dot--backup" />
              <div><strong>GitLab</strong><small>{gitlabRepos.filter((repo) => repo.enabled).length} 个备份仓库</small></div>
            </div>
          </div>
          {repositories.length === 0 ? (
            <button className="button button--outline-light" type="button" onClick={() => onNavigate("repositories")}>连接第一个存储库</button>
          ) : (
            <p className="panel-note">GitLab 备份不会自动高频同步。你可以随时在「存储库」中手动执行一次完整备份。</p>
          )}
        </section>
      </div>

      <section className="panel quote-panel">
        <span className="eyebrow">A NOTE FOR THE CURATOR</span>
        <blockquote>“好的收藏，不是拥有更多，而是让每一次回望都仍然心动。”</blockquote>
        <span className="quote-panel__mark">S</span>
      </section>
    </div>
  );
}