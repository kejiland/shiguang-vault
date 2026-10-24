import { useEffect, useState } from "react";
import { Download, Image as ImageIcon, CloudUpload, Link2, MoreHorizontal, Music2, Pencil, Search, Trash2, X, Check, LoaderCircle } from "lucide-react";
import type { Asset, Repository } from "../../types";
import { api } from "../../lib/api";
import { downloadUrl, formatBytes, formatDate, formatDuration } from "../../lib/format";
import { Pagination } from "../../components/Pagination";
import { AssetLinkDialog } from "../../components/Media";

const PAGE_SIZE = 30;

type Props = {
  repositories: Repository[];
  onRefresh: () => Promise<void>;
};

export function AdminLibrary({ repositories, onRefresh }: Props) {
  const [kind, setKind] = useState<"all" | "image" | "music">("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [repoId, setRepoId] = useState("all");
  const [page, setPage] = useState(1);
  const [pageAssets, setPageAssets] = useState<Asset[]>([]);
  const [pageTotal, setPageTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const [editing, setEditing] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [linkAsset, setLinkAsset] = useState<Asset | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [kind, repoId, debouncedQuery]);

  useEffect(() => {
    const request = new AbortController();
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
    if (kind !== "all") params.set("kind", kind);
    if (repoId !== "all") params.set("repo", repoId);
    if (debouncedQuery) params.set("q", debouncedQuery);
    setLoading(true);
    setLoadError("");
    api<{ assets: Asset[]; total: number }>(`/api/admin/assets?${params.toString()}`, { signal: request.signal })
      .then((data) => {
        setPageAssets(data.assets);
        setPageTotal(data.total);
      })
      .catch((cause) => {
        if (cause instanceof Error && cause.name === "AbortError") return;
        setLoadError(cause instanceof Error ? cause.message : "内容库加载失败");
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [debouncedQuery, kind, page, reloadToken, repoId]);

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(pageTotal / PAGE_SIZE));
    if (page > lastPage) setPage(lastPage);
  }, [page, pageTotal]);

  async function mirror(asset: Asset) {
    setBusyId(asset.id);
    setNotice("");
    try {
      const result = await api<{ results: Array<{ ok: boolean; label: string; error?: string }> }>(`/api/admin/assets/${asset.id}/mirror`, { method: "POST" });
      const failed = result.results.filter((item) => !item.ok);
      setNotice(failed.length ? `${failed.length} 个备份仓库同步失败：${failed.map((item) => `${item.label} ${item.error ?? ""}`).join("；")}` : "已同步到全部 GitLab 备份仓库");
      await onRefresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "同步失败");
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      const result = await api<{ warnings?: string[] }>(`/api/admin/assets/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      setNotice(result.warnings?.length
        ? `主文件已删除，但部分备份未删除：${result.warnings.join("；")}`
        : "作品已从全部远端仓库与索引中移除");
      await onRefresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page__heading admin-page__heading--compact">
        <div><span className="eyebrow">YOUR COLLECTION</span><h1>内容库</h1><p>浏览、整理与维护所有已经收录的图片和音乐。</p></div>
        <div className="heading-count"><strong>{pageTotal}</strong><span>件馆藏</span></div>
      </div>

      <section className="panel library-panel">
        <div className="library-toolbar">
          <div className="segmented">
            <button className={kind === "all" ? "is-active" : ""} type="button" onClick={() => setKind("all")}>全部</button>
            <button className={kind === "image" ? "is-active" : ""} type="button" onClick={() => setKind("image")}><ImageIcon size={15} /> 图片</button>
            <button className={kind === "music" ? "is-active" : ""} type="button" onClick={() => setKind("music")}><Music2 size={15} /> 音乐</button>
          </div>
          <div className="library-toolbar__right">
            <label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、艺术家或标签" /></label>
            <select className="select" value={repoId} onChange={(event) => setRepoId(event.target.value)} aria-label="按仓库筛选">
              <option value="all">全部仓库</option>
              {repositories.map((repo) => <option value={repo.id} key={repo.id}>{repo.label}</option>)}
            </select>
          </div>
        </div>
        {notice && <div className="notice-bar"><Check size={16} /><span>{notice}</span><button type="button" onClick={() => setNotice("")}><X size={15} /></button></div>}
        {loadError && <div className="notice-bar notice-bar--error"><X size={16} /><span>{loadError}</span><button type="button" onClick={() => setReloadToken((value) => value + 1)}><X size={15} /></button></div>}
        {loading && !pageAssets.length ? (
          <div className="admin-empty admin-empty--large"><LoaderCircle className="spin" size={26} /><h3>正在读取内容库</h3><p>请稍候。</p></div>
        ) : pageAssets.length ? (
          <div className="library-table">
            <div className="library-table__head"><span>作品</span><span>类型</span><span>仓库</span><span>备份</span><span>收录日期</span><span /></div>
            {pageAssets.map((asset) => (
              <div className="library-row" key={asset.id}>
                <div className="library-row__asset">
                  <span className={`library-thumb ${asset.kind === "music" ? "is-music" : ""}`}>
                    {asset.kind === "image" ? <img src={asset.mediaUrl} alt="" loading="lazy" /> : <Music2 size={18} />}
                  </span>
                  <span><strong>{asset.title}</strong><small>{asset.kind === "music" ? `${asset.artist || "未知艺术家"} · ${formatDuration(asset.duration)}` : `${formatBytes(asset.size)}${asset.width ? ` · ${asset.width}×${asset.height}` : ""}`}</small></span>
                </div>
                <span><span className="tag">{asset.kind === "image" ? "图片" : "音乐"}</span></span>
                <span className="library-row__repo"><strong>{asset.repoLabel}</strong><small>{asset.path}</small></span>
                <span className={`mirror-state ${asset.mirrorTotal && asset.mirrorSynced >= asset.mirrorTotal ? "is-ok" : asset.mirrorTotal ? "is-wait" : ""}`}>
                  <span />{asset.mirrorTotal ? `${asset.mirrorSynced}/${asset.mirrorTotal}` : "无备份"}
                </span>
                <span className="library-row__date">{formatDate(asset.createdAt)}</span>
                <div className="row-actions">
                  <button className="row-action" type="button" onClick={() => setLinkAsset(asset)} aria-label="获取链接" title="获取链接"><Link2 size={16} /></button>
                  <a className="row-action" href={downloadUrl(asset)} download aria-label="下载" title="下载"><Download size={16} /></a>
                  <button className="row-action" type="button" onClick={() => mirror(asset)} disabled={busyId === asset.id} aria-label="同步备份">
                    {busyId === asset.id ? <LoaderCircle className="spin" size={16} /> : <CloudUpload size={16} />}
                  </button>
                  <button className="row-action" type="button" onClick={() => setEditing(asset)} aria-label="编辑"><Pencil size={16} /></button>
                  <button className="row-action row-action--danger" type="button" onClick={() => setDeleting(asset)} aria-label="删除"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-empty admin-empty--large">
            <MoreHorizontal size={28} />
            <h3>没有符合条件的作品</h3>
            <p>尝试更换筛选条件，或者前往「上传作品」添加新的收藏。</p>
          </div>
        )}
        <Pagination page={page} total={pageTotal} pageSize={PAGE_SIZE} onPageChange={setPage} label="内容库" disabled={loading} />
      </section>

      <AssetLinkDialog asset={linkAsset} manageShares onClose={() => setLinkAsset(null)} />
      {editing && <EditDialog asset={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setNotice("作品信息已更新"); await onRefresh(); }} />}
      {deleting && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleting(null); }}>
          <div className="dialog dialog--small" role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <span className="dialog__icon dialog__icon--danger"><Trash2 size={22} /></span>
            <h2 id="delete-title">移除「{deleting.title}」？</h2>
            <p>文件会从 GitHub 及 GitLab 备份仓库中删除，同时清除本地索引。此操作无法在后台撤销。</p>
            <div className="dialog__actions">
              <button className="button button--ghost" type="button" onClick={() => setDeleting(null)}>取消</button>
              <button className="button button--danger" type="button" onClick={remove} disabled={busyId === deleting.id}>{busyId === deleting.id ? "正在删除…" : "确认删除"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditDialog({ asset, onClose, onSaved }: { asset: Asset; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(asset.title);
  const [artist, setArtist] = useState(asset.artist ?? "");
  const [album, setAlbum] = useState(asset.album ?? "");
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/assets/${asset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, artist, album, tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })
      });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <div className="dialog__header"><div><span className="eyebrow">EDIT METADATA</span><h2 id="edit-title">编辑作品信息</h2></div><button type="button" onClick={onClose} aria-label="关闭"><X size={20} /></button></div>
        <label className="field"><span>标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
        {asset.kind === "music" && <div className="field-row"><label className="field"><span>艺术家</span><input value={artist} onChange={(event) => setArtist(event.target.value)} /></label><label className="field"><span>专辑</span><input value={album} onChange={(event) => setAlbum(event.target.value)} /></label></div>}
        <label className="field"><span>标签 <small>用逗号分隔</small></span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="旅行, 夜色, 爵士" /></label>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog__actions"><button className="button button--ghost" type="button" onClick={onClose}>取消</button><button className="button button--accent" type="submit" disabled={busy}>{busy ? "保存中…" : "保存修改"}</button></div>
      </form>
    </div>
  );
}
