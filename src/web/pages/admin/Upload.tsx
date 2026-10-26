import { useRef, useState } from "react";
import { Check, FileImage, FileMusic, Image as ImageIcon, LoaderCircle, Music2, UploadCloud, X } from "lucide-react";
import type { Repository } from "../../types";
import { api, uploadAsset } from "../../lib/api";
import { parseBlob } from "music-metadata";
import { formatBytes, formatDuration } from "../../lib/format";

type ImageOptimizationState = "idle" | "processing" | "optimized" | "kept" | "failed";

export function AdminUpload({ repositories, onUploaded }: { repositories: Repository[]; onUploaded: () => Promise<void> }) {
  const eligible = repositories.filter((repo) => repo.enabled && !(repo.provider === "gitlab" && repo.backupOf));
  const defaultRepo = eligible.find((repo) => repo.isDefault) ?? eligible.find((repo) => repo.provider === "github") ?? eligible[0];
  const [repoId, setRepoId] = useState(defaultRepo?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [tags, setTags] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);
  const [message, setMessage] = useState("");
  const [metadataStatus, setMetadataStatus] = useState("");
  const [originalImageSize, setOriginalImageSize] = useState<number | null>(null);
  const [optimizedImageSize, setOptimizedImageSize] = useState<number | null>(null);
  const [imageOptimizationState, setImageOptimizationState] = useState<ImageOptimizationState>("idle");

  const [detectedImageWidth, setDetectedImageWidth] = useState<number | null>(null);
  const [detectedImageHeight, setDetectedImageHeight] = useState<number | null>(null);
  const optimizationRequest = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const isMusic = file ? /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(file.name) : false;
  const isImage = Boolean(file && (file.type.startsWith("image/") || /\.(jpe?g|png|bmp|webp|gif|avif|svg|heic)$/i.test(file.name)));
  const canConvertToWebp = Boolean(file && /\.(jpe?g|png|bmp)$/i.test(file.name));
  const optimizingImage = imageOptimizationState === "processing";
  const imageOptimizationLabel = imageOptimizationState === "processing"
    ? "正在优化为 WebP…"
    : imageOptimizationState === "optimized" && optimizedImageSize !== null && originalImageSize !== null
      ? `已优化为 WebP：${formatBytes(originalImageSize)} → ${formatBytes(optimizedImageSize)}，节省 ${Math.max(1, Math.round((1 - optimizedImageSize / originalImageSize) * 100))}%`
      : imageOptimizationState === "kept"
        ? "WebP 没有变得更小，已保留原图。"
        : imageOptimizationState === "failed"
          ? "WebP 转换失败，已保留原图。"
          : canConvertToWebp
            ? "静态图片会优先转换为 WebP；GIF、SVG 与 WebP 保留原格式。"
            : "";

  function acceptFiles(files: FileList | null) {
    const next = files?.[0];
    if (next) choose(next);
  }

  function handleDragEnter(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current += 1;
    if (event.dataTransfer.types.includes("Files")) setDragging(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.types.includes("Files")) {
      event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    }
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    acceptFiles(event.dataTransfer.files);
  }

  function handleDragEnd() {
    dragDepth.current = 0;
    setDragging(false);
  }

  async function optimizeImage(next: File, request: number): Promise<File> {
    if (!/\.(jpe?g|png|bmp)$/i.test(next.name)) return next;
    setImageOptimizationState("processing");
    setOriginalImageSize(next.size);
    setOptimizedImageSize(null);
    try {
      const bitmap = await createImageBitmap(next);
      if (request !== optimizationRequest.current) {
        bitmap.close();
        return next;
      }
      const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器不支持图片优化");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error("WebP 编码失败")), "image/webp", 0.86);
      });
      if (request !== optimizationRequest.current) return next;
      if (blob.type !== "image/webp") throw new Error("浏览器未返回 WebP");
      const optimized = new File([blob], next.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp", lastModified: next.lastModified });
      if (optimized.size >= next.size) {
        setImageOptimizationState("kept");
        setOptimizedImageSize(null);
        return next;
      }
      setOptimizedImageSize(optimized.size);
      setImageOptimizationState("optimized");
      return optimized;
    } catch {
      if (request === optimizationRequest.current) setImageOptimizationState("failed");
      setOptimizedImageSize(null);
      return next;
    }
  }

  async function choose(next: File) {
    if (preview) URL.revokeObjectURL(preview);
    const request = optimizationRequest.current + 1;
    optimizationRequest.current = request;
    const sourceIsImage = next.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|avif|svg|bmp|heic)$/i.test(next.name);
    setFile(next);
    setTitle(next.name.replace(/\.[^.]+$/, ""));
    setResult(null);
    setMessage("");
    setWidth(null);
    setHeight(null);
    setDetectedImageWidth(null);
    setDetectedImageHeight(null);
    setDuration(null);
    setArtist("");
    setAlbum("");
    setMetadataStatus("");
    setOriginalImageSize(null);
    setOptimizedImageSize(null);
    setImageOptimizationState("idle");

    if (sourceIsImage) {
      const objectUrl = URL.createObjectURL(next);
      setPreview(objectUrl);
      const image = new Image();
      image.onload = () => {
        if (request === optimizationRequest.current) {
          setDetectedImageWidth(image.naturalWidth);
          setDetectedImageHeight(image.naturalHeight);
          setWidth(image.naturalWidth);
          setHeight(image.naturalHeight);
        }
      };
      image.src = objectUrl;
      void optimizeImage(next, request).then((optimized) => {
        if (request !== optimizationRequest.current) return;
        setFile(optimized);
      });
    } else {
      setPreview("");
      const objectUrl = URL.createObjectURL(next);
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        if (Number.isFinite(audio.duration)) setDuration(audio.duration);
        URL.revokeObjectURL(objectUrl);
      };
      audio.onerror = () => URL.revokeObjectURL(objectUrl);
      audio.src = objectUrl;

      if (next.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(next.name)) {
        setMetadataStatus("正在识别音乐信息…");
        void parseBlob(next, { duration: true, skipCovers: true })
          .then((metadata) => {
            const detectedTitle = metadata.common.title?.trim();
            const detectedArtist = (metadata.common.artist ?? metadata.common.artists?.join(" / "))?.trim();
            const detectedAlbum = metadata.common.album?.trim();
            if (detectedTitle) setTitle(detectedTitle);
            if (detectedArtist) setArtist(detectedArtist);
            if (detectedAlbum) setAlbum(detectedAlbum);
            if (Number.isFinite(metadata.format.duration)) setDuration(metadata.format.duration ?? null);
            setMetadataStatus(detectedTitle || detectedArtist ? "已自动识别歌名和作者，可在下方修改。" : "没有找到音乐标签，将使用原文件名。");
          })
          .catch(() => setMetadataStatus("没有找到音乐标签，将使用原文件名。"));
      }
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setResult(null);
    setProgress(0);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("sourceSize", String(imageOptimizationState === "optimized" && originalImageSize !== null ? originalImageSize : file.size));
      form.set("repoId", repoId);
      form.set("title", title);
      form.set("artist", artist);
      form.set("album", album);
      form.set("tags", tags);
      if (detectedImageWidth) form.set("width", String(detectedImageWidth));
      if (detectedImageHeight) form.set("height", String(detectedImageHeight));
      if (duration) form.set("duration", String(duration));
      await uploadAsset(form, setProgress);
      setResult("success");
      setMessage("作品已存入仓库，并出现在展示站中。");
      setMetadataStatus("");
      setFile(null);
      setPreview("");
      setTitle(""); setArtist(""); setAlbum(""); setTags("");
      setOriginalImageSize(null); setOptimizedImageSize(null); setImageOptimizationState("idle"); setDetectedImageWidth(null); setDetectedImageHeight(null);
      if (inputRef.current) inputRef.current.value = "";
      await onUploaded();
    } catch (cause) {
      setResult("error");
      setMessage(cause instanceof Error ? cause.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  if (!eligible.length) {
    return (
      <div className="admin-page">
        <div className="admin-page__heading"><div><span className="eyebrow">INGEST</span><h1>上传作品</h1><p>把新的光影和声音放进储藏室。</p></div></div>
        <div className="panel empty-gate">
          <ImageIcon size={30} />
          <h2>先连接一个 GitHub 仓库</h2>
          <p>图片与音乐会直接写入你的 GitHub 仓库。配置好存储库后，就可以从这里上传。</p>
          <a className="button button--accent" href="/admin/repositories">前往存储库设置</a>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-page__heading">
        <div><span className="eyebrow">INGEST NEW MEMORY</span><h1>上传作品</h1><p>选择图片或音乐，补充信息后直接写入你的 GitHub 仓库。</p></div>
        <div className="upload-repo-badge"><span>目标仓库</span><strong>{eligible.find((repo) => repo.id === repoId)?.label ?? "未选择"}</strong></div>
      </div>

      <form className="upload-layout" onSubmit={submit}>
        <section
          className={`panel upload-drop-panel ${dragging ? "is-dragging" : ""}`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        >
          <input
            ref={inputRef} type="file" hidden accept="image/jpeg,image/png,image/bmp,image/gif,image/webp,image/avif,image/svg+xml,image/heic,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/flac,audio/ogg,audio/opus"
            onChange={(event) => { acceptFiles(event.target.files); event.currentTarget.value = ""; }}
          />
          {dragging && (
            <div className="upload-drop-overlay" aria-hidden="true">
              <span className="upload-dropzone__icon"><UploadCloud size={28} /></span>
              <span className="eyebrow">DROP TO REPLACE</span>
              <strong>{file ? "松开即可替换当前文件" : "松开即可选择文件"}</strong>
              <p>支持图片与音乐，单次拖入一个文件</p>
            </div>
          )}
          {file ? (
            <div className="upload-selected">
              <button type="button" className="upload-selected__preview" onClick={() => inputRef.current?.click()}>
                {preview ? <img src={preview} alt="上传预览" /> : <span className="upload-selected__music"><Music2 size={40} /><small>AUDIO FILE</small></span>}
                <span className="upload-selected__replace">更换文件</span>
              </button>
              <div className="upload-selected__info">
                <span className="file-kind">{isMusic ? <FileMusic size={18} /> : <FileImage size={18} />} {isMusic ? "音乐" : "图片"}</span>
                <h3>{file ? file.name : ""}</h3>
                <p>{formatBytes(originalImageSize ?? file.size)} · {file.type || "未知格式"}{detectedImageWidth && detectedImageHeight ? ` · ${detectedImageWidth} × ${detectedImageHeight}` : ""}{duration ? ` · ${formatDuration(duration)}` : ""}</p>
                <button type="button" className="text-button text-button--danger" onClick={() => { optimizationRequest.current += 1; setFile(null); setPreview(""); setImageOptimizationState("idle"); setOriginalImageSize(null); setOptimizedImageSize(null); setDetectedImageWidth(null); setDetectedImageHeight(null); if (inputRef.current) inputRef.current.value = ""; }}><X size={15} /> 移除</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="upload-dropzone"
              onClick={() => inputRef.current?.click()}
            >
              <span className="upload-dropzone__icon"><UploadCloud size={28} /></span>
              <span className="eyebrow">DROP YOUR MEMORY HERE</span>
              <strong>拖拽文件到这里，或点击选择</strong>
              <p>支持 JPG、PNG、WebP、GIF、AVIF、MP3、M4A、WAV、FLAC 等格式<br />图片不超过 20 MB，音乐不超过 50 MB</p>
              <span className="upload-dropzone__types"><ImageIcon size={16} /> 图片 <span>·</span> <Music2 size={16} /> 音乐</span>
            </button>
          )}
        </section>

        <section className="panel upload-form-panel">
          <div className="panel__header"><div><span className="eyebrow">DETAILS</span><h2>作品信息</h2></div><span className="step-number">02</span></div>
          <label className="field"><span>保存到仓库</span><select value={repoId} onChange={(event) => setRepoId(event.target.value)} required>{eligible.map((repo) => <option key={repo.id} value={repo.id}>{repo.label} · {repo.provider === "github" ? "GitHub" : "GitLab"}{repo.isDefault ? " · 默认" : ""}</option>)}</select></label>
          <label className="field"><span>标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="给这件作品一个名字" required /></label>
          {isMusic && <div className="field-row"><label className="field"><span>艺术家</span><input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="艺术家或演唱者" /></label><label className="field"><span>专辑</span><input value={album} onChange={(event) => setAlbum(event.target.value)} placeholder="所属专辑" /></label></div>}
          {isMusic && metadataStatus && <p className="form-footnote upload-metadata-status">{metadataStatus}</p>}
          {isImage && imageOptimizationLabel && <p className="form-footnote upload-metadata-status">{imageOptimizationLabel}{optimizedImageSize !== null ? ` · 保存文件 ${formatBytes(optimizedImageSize)}` : ""}</p>}
          <label className="field"><span>标签 <small>用逗号分隔，便于检索</small></span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="例如：夜色, 城市, 安静" /></label>
          {busy && <div className="upload-progress"><div><span>正在写入远程仓库…</span><strong>{progress}%</strong></div><span className="progress-track"><span style={{ width: `${progress}%` }} /></span></div>}
          {result && <div className={`form-result ${result === "success" ? "is-success" : "is-error"}`}>{result === "success" ? <Check size={17} /> : <X size={17} />}<span>{message}</span></div>}
          <button className="button button--accent button--wide" type="submit" disabled={busy || optimizingImage || !file || !repoId}>
            {busy ? <><LoaderCircle className="spin" size={18} /> 正在上传 {progress}%</> : <><UploadCloud size={18} /> 上传到仓库</>}
          </button>
          <p className="form-footnote">文件会统一以时间戳命名；静态图片会优先转换为 WebP，音乐会自动读取歌名、作者和专辑。GitLab 备份可在内容库中手动同步。</p>
        </section>
      </form>
    </div>
  );
}
