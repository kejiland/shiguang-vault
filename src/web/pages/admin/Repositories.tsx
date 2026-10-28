import { useState } from "react";
import { ArchiveRestore, Check, CircleHelp, Database, GitBranch, Github, Gitlab, LoaderCircle, LockKeyhole, Pencil, Plus, RefreshCw, ServerCog, Trash2, X } from "lucide-react";
import type { Repository } from "../../types";
import { api } from "../../lib/api";
import { formatDate } from "../../lib/format";

type Props = { repositories: Repository[]; onRefresh: () => Promise<void> };

type RepoForm = {
  provider: "github" | "gitlab";
  label: string;
  owner: string;
  repo: string;
  branch: string;
  rootPath: string;
  token: string;
  backupOf: string;
  isDefault: boolean;
};

const blankForm = (provider: "github" | "gitlab" = "github"): RepoForm => ({
  provider, label: "", owner: "", repo: "", branch: "main", rootPath: "", token: "", backupOf: "", isDefault: false
});

function backupFreshness(repo: Repository): { label: string; overdue: boolean } {
  if (!repo.lastSyncedAt) return { label: "等待首次自动备份", overdue: true };
  return { label: `最近备份 ${formatDate(repo.lastSyncedAt)}`, overdue: false };
}

export function AdminRepositories({ repositories, onRefresh }: Props) {
  const [dialog, setDialog] = useState<"github" | "gitlab" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [deleting, setDeleting] = useState<Repository | null>(null);
  const [editing, setEditing] = useState<Repository | null>(null);

  async function action(repo: Repository, actionName: "test" | "sync" | "backup") {
    setBusyId(repo.id);
    setNotice(null);
    try {
      if (actionName === "test") {
        const response = await api<{ ok: boolean; defaultBranch: string }>(`/api/repos/${repo.id}/test`, { method: "POST" });
        setNotice({ type: "success", text: `连接成功，仓库默认分支为 ${response.defaultBranch}` });
      } else if (actionName === "sync") {
        const response = await api<{ scanned: number; imported: number }>(`/api/repos/${repo.id}/sync`, { method: "POST" });
        setNotice({ type: "success", text: `扫描 ${response.scanned} 个文件，更新 ${response.imported} 个媒体索引` });
      } else {
        let offset = 0;
        let synced = 0;
        let skipped = 0;
        let total = 0;
        let failed = 0;
        let done = false;
        while (!done) {
          const response = await api<{ total: number; synced: number; skipped: number; failures: unknown[]; nextOffset: number | null; done: boolean; processed: number; totalAssets: number }>(`/api/repos/${repo.id}/backup?offset=${offset}&limit=8`, { method: "POST" });
          synced += response.synced;
          skipped += response.skipped;
          total = response.total;
          failed += response.failures.length;
          done = response.done;
          offset = response.nextOffset ?? 0;
          if (response.totalAssets > 0) setNotice({ type: "success", text: `正在备份 ${response.processed}/${response.totalAssets} 件作品…` });
        }
        setNotice({ type: failed ? "error" : "success", text: `备份完成：新增 ${synced} 个，同名跳过 ${skipped} 个${failed ? `，${failed} 个失败` : ""}（共 ${total} 项）` });
      }
      await onRefresh();
    } catch (cause) {
      setNotice({ type: "error", text: cause instanceof Error ? cause.message : "操作失败" });
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await api(`/api/repos/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      setNotice({ type: "success", text: "存储库连接已移除" });
      await onRefresh();
    } catch (cause) {
      setNotice({ type: "error", text: cause instanceof Error ? cause.message : "移除失败" });
    } finally {
      setBusyId(null);
    }
  }

  async function setDefault(repo: Repository) {
    setBusyId(repo.id);
    try {
      await api(`/api/repos/${repo.id}`, { method: "PATCH", body: JSON.stringify({ isDefault: true, enabled: repo.enabled }) });
      setNotice({ type: "success", text: `${repo.label} 已设为默认上传仓库` });
      await onRefresh();
    } catch (cause) {
      setNotice({ type: "error", text: cause instanceof Error ? cause.message : "设置失败" });
    } finally { setBusyId(null); }
  }

  const github = repositories.filter((repo) => repo.provider === "github");
  const gitlab = repositories.filter((repo) => repo.provider === "gitlab");

  return (
    <div className="admin-page">
      <div className="admin-page__heading">
        <div><span className="eyebrow">STORAGE & BACKUP</span><h1>存储库</h1><p>连接多个 GitHub 主仓库与 GitLab 备份仓库。密钥只保存在云端服务端。</p></div>
        <div className="heading-actions">
          <button type="button" className="button button--ghost" onClick={() => setDialog("gitlab")}><Gitlab size={17} /> 连接 GitLab</button>
          <button type="button" className="button button--accent" onClick={() => setDialog("github")}><Github size={17} /> 连接 GitHub</button>
        </div>
      </div>

      {notice && <div className={`notice-bar ${notice.type === "error" ? "notice-bar--error" : ""}`}><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)}><X size={15} /></button></div>}

      <div className="repo-summary">
        <div><Github size={22} /><span>GitHub 主仓库</span><strong>{github.length}</strong></div>
        <div><Gitlab size={22} /><span>GitLab 备份库</span><strong>{gitlab.length}</strong></div>
        <div><LockKeyhole size={22} /><span>加密保存的令牌</span><strong>{repositories.filter((repo) => repo.hasToken).length}</strong></div>
      </div>

      <RepositorySection
        title="GitHub 主存储" subtitle="上传的图片与音乐优先写入这些仓库"
        icon={<Github size={19} />} repos={github} busyId={busyId}
        onTest={(repo) => action(repo, "test")} onSync={(repo) => action(repo, "sync")}
        onBackup={(repo) => action(repo, "backup")} onDefault={setDefault}
        onEdit={setEditing} onDelete={setDeleting} onAdd={() => setDialog("github")}
      />
      <RepositorySection
        title="GitLab 备份" subtitle="新上传会自动增量备份；按文件名跳过已有内容"
        icon={<Gitlab size={19} />} repos={gitlab} busyId={busyId}
        onTest={(repo) => action(repo, "test")} onSync={(repo) => action(repo, "sync")}
        onEdit={setEditing} onDelete={setDeleting} onAdd={() => setDialog("gitlab")}
      />

      <section className="panel guide-panel">
        <div className="panel__header"><div><span className="eyebrow">QUICK START</span><h2>连接前准备</h2></div><CircleHelp size={19} /></div>
        <div className="guide-grid">
          <div><span>01</span><h3>创建空仓库</h3><p>在 GitHub 或 GitLab 新建私有仓库，并勾选初始化 README。也可以使用已有仓库。</p></div>
          <div><span>02</span><h3>创建访问令牌</h3><p>GitHub Fine-grained Token 需要目标仓库 Contents 的读写权限；GitLab Token 需要 <code>api</code> 或 <code>write_repository</code> 权限。</p></div>
          <div><span>03</span><h3>填写连接信息</h3><p>将目标 GitLab 仓库设为某个 GitHub 仓库的备份。新文件上传后会自动备份，也可用「全量备份」补齐历史内容。</p></div>
        </div>
      </section>

      {dialog && <RepoDialog provider={dialog} repositories={repositories} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); setNotice({ type: "success", text: "存储库已连接，建议先测试连接再同步" }); await onRefresh(); }} />}
      {editing && <EditRepoDialog repo={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setNotice({ type: "success", text: "存储库连接已更新" }); await onRefresh(); }} />}
      {deleting && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleting(null); }}>
          <div className="dialog dialog--small" role="dialog" aria-modal="true">
            <span className="dialog__icon dialog__icon--danger"><Trash2 size={22} /></span>
            <h2>移除「{deleting.label}」？</h2>
            <p>只会移除后台的仓库连接和加密令牌，不会删除 GitHub 或 GitLab 上的任何文件。</p>
            <div className="dialog__actions"><button className="button button--ghost" type="button" onClick={() => setDeleting(null)}>取消</button><button className="button button--danger" type="button" onClick={remove}>确认移除</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function RepositorySection({
  title, subtitle, icon, repos, busyId, onTest, onSync, onBackup, onDefault, onEdit, onDelete, onAdd
}: {
  title: string; subtitle: string; icon: React.ReactNode; repos: Repository[]; busyId: string | null;
  onTest: (repo: Repository) => void; onSync: (repo: Repository) => void; onBackup?: (repo: Repository) => void;
  onDefault?: (repo: Repository) => void; onEdit: (repo: Repository) => void; onDelete: (repo: Repository) => void; onAdd: () => void;
}) {
  return (
    <section className="panel repo-section">
      <div className="panel__header">
        <div className="repo-section__title"><span className="repo-section__icon">{icon}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>
        <button className="text-button" type="button" onClick={onAdd}><Plus size={15} /> 添加</button>
      </div>
      {repos.length ? (
        <div className="repo-cards">
          {repos.map((repo) => (
            <article className={`repo-card ${repo.isDefault ? "is-default" : ""}`} key={repo.id}>
              <div className="repo-card__head">
                <div><span className={`status-dot ${repo.enabled ? "is-online" : ""}`} /><strong>{repo.label}</strong>{repo.isDefault && <span className="tag tag--accent">默认</span>}</div>
                <span className="repo-card__provider">{repo.provider === "github" ? <Github size={16} /> : <Gitlab size={16} />}{repo.provider === "github" ? "GitHub" : "GitLab"}</span>
              </div>
              <dl className="repo-card__facts">
                <div><dt>仓库</dt><dd>{repo.owner}/{repo.repo}</dd></div>
                <div><dt>分支</dt><dd><GitBranch size={13} /> {repo.branch}</dd></div>
                <div><dt>目录</dt><dd>{repo.rootPath || "仓库根目录"}</dd></div>
                <div><dt>上次同步</dt><dd>{formatDate(repo.lastSyncedAt)}</dd></div>
              </dl>
              {repo.backupOf && (
                <p className={`repo-card__backup ${backupFreshness(repo).overdue ? "is-overdue" : ""}`}>
                  <ArchiveRestore size={14} /> 备份自 {repo.backupLabel || "主仓库"} · {backupFreshness(repo).label}
                </p>
              )}
              {repo.lastSyncError && <p className="repo-card__error">{repo.lastSyncError}</p>}
              <div className="repo-card__actions">
                <button type="button" onClick={() => onTest(repo)} disabled={busyId === repo.id}>{busyId === repo.id ? <LoaderCircle className="spin" size={15} /> : <ServerCog size={15} />} 测试</button>
                <button type="button" onClick={() => onSync(repo)} disabled={busyId === repo.id}><RefreshCw className={busyId === repo.id ? "spin" : ""} size={15} /> 扫描</button>
                {onBackup && <button type="button" onClick={() => onBackup(repo)} disabled={busyId === repo.id}><Database size={15} /> 全量备份</button>}
                {onDefault && !repo.isDefault && <button type="button" onClick={() => onDefault(repo)} disabled={busyId === repo.id}><Check size={15} /> 设为默认</button>}
                <button type="button" onClick={() => onEdit(repo)} disabled={busyId === repo.id}><Pencil size={15} /> 编辑</button>
                <button className="repo-card__delete" type="button" onClick={() => onDelete(repo)} aria-label="移除"><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <button className="repo-add-card" type="button" onClick={onAdd}><Plus size={20} /><span>连接第一个{title.replace("主存储", "")}仓库</span><small>令牌将被加密后保存</small></button>
      )}
    </section>
  );
}

function EditRepoDialog({ repo, onClose, onSaved }: { repo: Repository; onClose: () => void; onSaved: () => Promise<void> }) {
  const [label, setLabel] = useState(repo.label);
  const [branch, setBranch] = useState(repo.branch);
  const [rootPath, setRootPath] = useState(repo.rootPath);
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(repo.enabled);
  const [isDefault, setIsDefault] = useState(repo.isDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/repos/${repo.id}`, {
        method: "PATCH",
        body: JSON.stringify({ label, branch, rootPath, token, enabled, isDefault })
      });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="edit-repo-title">
        <div className="dialog__header"><div><span className="eyebrow">EDIT CONNECTION</span><h2 id="edit-repo-title">编辑存储库</h2></div><button type="button" onClick={onClose} aria-label="关闭"><X size={20} /></button></div>
        <div className="provider-note">{repo.provider === "github" ? <Github size={19} /> : <Gitlab size={19} />}<p>{repo.owner}/{repo.repo} · 修改分支或目录后，请重新扫描仓库以核对文件。</p></div>
        <label className="field"><span>显示名称</span><input value={label} onChange={(event) => setLabel(event.target.value)} required /></label>
        <div className="field-row">
          <label className="field"><span>分支</span><input value={branch} onChange={(event) => setBranch(event.target.value)} required /></label>
          <label className="field"><span>存储目录 <small>可选，图片默认 images，填写后直接存入该目录</small></span><input value={rootPath} onChange={(event) => setRootPath(event.target.value)} placeholder="images" /></label>
        </div>
        <label className="field"><span>更新访问令牌 <small>留空则保持原令牌</small></span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="仅在需要更换 Token 时填写" autoComplete="new-password" /></label>
        <div className="settings-switches">
          <label className="switch-field switch-field--box"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span /><div><strong>启用这个存储库</strong><small>停用后不会参与扫描或备份。</small></div></label>
          {repo.provider === "github" && !repo.backupOf && <label className="switch-field switch-field--box"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} /><span /><div><strong>设为默认上传仓库</strong><small>上传页会优先选中这个仓库。</small></div></label>}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog__actions"><button className="button button--ghost" type="button" onClick={onClose}>取消</button><button className="button button--accent" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17} /> 保存中</> : "保存修改"}</button></div>
      </form>
    </div>
  );
}

function RepoDialog({ provider, repositories, onClose, onSaved }: { provider: "github" | "gitlab"; repositories: Repository[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<RepoForm>(blankForm(provider));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parentRepos = repositories.filter((repo) => repo.provider === "github" && !repo.backupOf);

  function set<K extends keyof RepoForm>(key: K, value: RepoForm[K]) { setForm((previous) => ({ ...previous, [key]: value })); }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await api<{ warning?: string | null }>("/api/repos", { method: "POST", body: JSON.stringify(form) });
      if (response.warning) setError(`已保存，但连接测试未通过：${response.warning}`);
      setTimeout(onSaved, response.warning ? 1800 : 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="dialog dialog--wide" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="repo-dialog-title">
        <div className="dialog__header"><div><span className="eyebrow">CONNECT {provider.toUpperCase()}</span><h2 id="repo-dialog-title">{provider === "github" ? "连接 GitHub 主仓库" : "连接 GitLab 备份库"}</h2></div><button type="button" onClick={onClose} aria-label="关闭"><X size={20} /></button></div>
        <div className="provider-note">{provider === "github" ? <Github size={19} /> : <Gitlab size={19} />}<p>{provider === "github" ? "将图片与音乐写入该仓库。建议为每个主题创建独立仓库，例如 life-photos、favorite-music。" : "GitLab 仓库作为某个 GitHub 仓库的备份。主仓库有新文件时会自动写入这里，同名文件不会重复上传。"}</p></div>
        <div className="field-row">
          <label className="field"><span>显示名称</span><input value={form.label} onChange={(event) => set("label", event.target.value)} placeholder={provider === "github" ? "生活影像" : "GitLab 备份"} /></label>
          <label className="field"><span>{provider === "github" ? "默认上传仓库" : "备份来源"}</span>
            {provider === "github" ? (
              <label className="switch-field"><input type="checkbox" checked={form.isDefault} onChange={(event) => set("isDefault", event.target.checked)} /><span />设为默认仓库</label>
            ) : (
              <select value={form.backupOf} onChange={(event) => set("backupOf", event.target.value)} required><option value="">选择要备份的 GitHub 仓库</option>{parentRepos.map((repo) => <option value={repo.id} key={repo.id}>{repo.label} · {repo.owner}/{repo.repo}</option>)}</select>
            )}
          </label>
        </div>
        <div className="field-row">
          <label className="field"><span>所有者 / 用户名</span><input value={form.owner} onChange={(event) => set("owner", event.target.value)} placeholder={provider === "github" ? "your-github-name" : "your-gitlab-name"} required /></label>
          <label className="field"><span>仓库名</span><input value={form.repo} onChange={(event) => set("repo", event.target.value)} placeholder="photos-and-music" required /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>分支</span><input value={form.branch} onChange={(event) => set("branch", event.target.value)} placeholder="main" required /></label>
          <label className="field"><span>存储目录 <small>可选，图片默认 images，填写后直接存入该目录</small></span><input value={form.rootPath} onChange={(event) => set("rootPath", event.target.value)} placeholder="images" /></label>
        </div>
        <label className="field"><span>{provider === "github" ? "Fine-grained Personal Access Token" : "Private Access Token"}</span><input type="password" value={form.token} onChange={(event) => set("token", event.target.value)} placeholder="只在服务端加密保存，不会返回前端" required autoComplete="new-password" /></label>
        <div className="token-hint"><LockKeyhole size={14} /> 令牌使用 AES-GCM 加密后存入 D1。创建令牌时请只授予该仓库所需的最小权限。</div>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog__actions"><button className="button button--ghost" type="button" onClick={onClose}>取消</button><button className="button button--accent" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17} /> 正在连接</> : "保存并测试连接"}</button></div>
      </form>
    </div>
  );
}
