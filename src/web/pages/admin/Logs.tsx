import { useEffect, useState } from "react";
import { ScrollText, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { ArtMark } from "../../components/Media";

type LogRow = { id: number; action: string; target: string | null; detail: string | null; created_at: string };

export function AdminLogs() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await api<{ logs: LogRow[] }>("/api/admin/logs");
      setLogs(response.logs);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="admin-page">
      <div className="admin-page__heading"><div><span className="eyebrow">AUDIT TRAIL</span><h1>操作记录</h1><p>这里记录后台的关键操作，方便核对仓库与内容变化。</p></div><button className="button button--ghost" type="button" onClick={load}><RefreshCw size={16} /> 刷新</button></div>
      <section className="panel">
        {loading ? <div className="loading-panel"><ArtMark /><span>读取记录中…</span></div> : error ? <p className="form-error">{error}</p> : logs.length ? (
          <div className="log-list">
            {logs.map((log) => (
              <div className="log-row" key={log.id}>
                <span className="log-row__icon"><ScrollText size={16} /></span>
                <span><strong>{log.action}</strong><small>{log.detail || log.target || "系统操作"}</small></span>
                <time>{new Date(log.created_at).toLocaleString("zh-CN")}</time>
              </div>
            ))}
          </div>
        ) : <div className="admin-empty"><p>目前还没有记录。上传、修改或备份内容后，操作会显示在这里。</p></div>}
      </section>
    </div>
  );
}