import { useCallback, useEffect, useState } from "react";
import {
  cancelCleanupJob,
  cancelCleanupRuntime,
  cleanupPreviewUrl,
  createCleanupJob,
  fetchCleanupJob,
  fetchCleanupRuntime,
  inspectCleanupVideo,
  prepareCleanupRuntime,
  type CleanupJob,
  type CleanupKind,
  type CleanupLanguage,
  type CleanupRegion,
  type CleanupRegionMode,
  type CleanupRuntime,
  type CleanupVariant,
  type DesktopMediaFile,
  type VideoInspection,
} from "./api";
import { CheckIcon, DownloadIcon, FolderIcon, PlayIcon, RefreshIcon, UploadIcon } from "./icons";

const formatBytes = (bytes: number) => `${(bytes / 1_000_000_000).toFixed(1)} GB`;
const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
};

function messageFor(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    docker_not_ready: "Docker Desktop 尚未就绪，请先在“模型与运行”完成 Windows GPU 环境配置。",
    cleanup_runtime_not_prepared: "请先预下载视频清理运行资源。",
    ffmpeg_runtime_not_ready: "FFmpeg/FFprobe 运行时未就绪，请重新安装桌面版。",
    source_video_missing: "源视频不存在或已被移动。",
    unsupported_video_format: "不支持该视频格式。",
    video_probe_failed: "无法读取视频分辨率或时长。",
    preview_generation_failed: "无法生成选区预览帧。",
    watermark_requires_manual_region: "文字水印必须手动框选区域。",
    cleanup_job_already_active: "已有一个视频清理任务正在运行。",
  };
  const match = Object.keys(messages).find((key) => value.includes(key));
  return match ? messages[match] : value;
}

export function VideoCleanupView({
  onConnectionChange,
  onOpenModels,
}: {
  onConnectionChange: (online: boolean) => void;
  onOpenModels: () => void;
}) {
  const [runtime, setRuntime] = useState<CleanupRuntime | null>(null);
  const [variant, setVariant] = useState<CleanupVariant>("auto");
  const [media, setMedia] = useState<DesktopMediaFile | null>(null);
  const [inspection, setInspection] = useState<VideoInspection | null>(null);
  const [kind, setKind] = useState<CleanupKind>("subtitle");
  const [language, setLanguage] = useState<CleanupLanguage>("auto");
  const [regionMode, setRegionMode] = useState<CleanupRegionMode>("manual");
  const [regions, setRegions] = useState<CleanupRegion[]>([]);
  const [draft, setDraft] = useState<CleanupRegion | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [job, setJob] = useState<CleanupJob | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshRuntime = useCallback(async () => {
    try {
      const next = await fetchCleanupRuntime(variant);
      setRuntime(next);
      onConnectionChange(true);
    } catch (error) {
      onConnectionChange(false);
      setNotice(messageFor(error));
    }
  }, [onConnectionChange, variant]);

  useEffect(() => {
    void refreshRuntime();
  }, [refreshRuntime]);

  useEffect(() => {
    if (runtime?.state !== "preparing") return;
    const timer = window.setInterval(() => void refreshRuntime(), 1600);
    return () => window.clearInterval(timer);
  }, [refreshRuntime, runtime?.state]);

  useEffect(() => {
    if (!job || !["queued", "processing", "remuxing"].includes(job.state)) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      fetchCleanupJob(job.id, controller.signal).then(setJob).catch(() => undefined);
    }, 1400);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [job]);

  async function prepareRuntime() {
    setBusy(true);
    setNotice("");
    try {
      setRuntime(await prepareCleanupRuntime(variant));
      setNotice("已开始预下载；Docker 会保留已完成的层，重新开始可断点续传。");
    } catch (error) {
      setNotice(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function chooseVideo() {
    if (!window.voiceBridge) {
      setNotice("视频清理需要在 Windows GUI 中选择本地视频。");
      return;
    }
    const selected = await window.voiceBridge.chooseVideoFile();
    if (!selected) return;
    setBusy(true);
    setMedia(selected);
    setInspection(null);
    setRegions([]);
    setJob(null);
    setNotice("");
    try {
      setInspection(await inspectCleanupVideo(selected.path));
    } catch (error) {
      setNotice(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  function pointInPreview(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function beginRegion(event: React.PointerEvent<HTMLDivElement>) {
    if (regionMode !== "manual" || regions.length >= 8) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointInPreview(event);
    setDragStart(point);
    setDraft({ ...point, width: 0, height: 0 });
  }

  function updateRegion(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart) return;
    const point = pointInPreview(event);
    setDraft({
      x: Math.min(dragStart.x, point.x),
      y: Math.min(dragStart.y, point.y),
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y),
    });
  }

  function finishRegion() {
    if (draft && draft.width >= 0.015 && draft.height >= 0.015) {
      setRegions((items) => [...items, draft].slice(0, 8));
    }
    setDraft(null);
    setDragStart(null);
  }

  function chooseKind(next: CleanupKind) {
    setKind(next);
    setJob(null);
    if (next === "watermark") {
      setRegionMode("manual");
    } else if (next === "all_text") {
      setRegionMode("auto");
      setRegions([]);
    }
  }

  function chooseRegionMode(next: CleanupRegionMode) {
    setRegionMode(next);
    if (next === "auto") setRegions([]);
  }

  function addBottomPreset() {
    setRegionMode("manual");
    setRegions([{ x: 0.08, y: 0.72, width: 0.84, height: 0.22 }]);
  }

  function addWatermarkPreset() {
    setKind("watermark");
    setRegionMode("manual");
    setRegions([{ x: 0.72, y: 0.05, width: 0.23, height: 0.16 }]);
  }

  async function startJob() {
    if (!inspection) return;
    setBusy(true);
    setNotice("");
    try {
      setJob(await createCleanupJob({
        inspection_id: inspection.id,
        cleanup_kind: kind,
        language,
        region_mode: regionMode,
        regions,
        variant,
      }));
    } catch (error) {
      setNotice(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  const requiresRegion = regionMode === "manual";
  const canStart = Boolean(
    runtime?.state === "ready"
      && inspection
      && (!requiresRegion || regions.length)
      && !busy
      && (!job || !["queued", "processing", "remuxing"].includes(job.state)),
  );

  return (
    <section className="cleanup-view">
      <div className="cleanup-runtime">
        <div>
          <span className="section-index">VIDEO CLEANUP / 运行资源</span>
          <strong>VSR 1.4.0 · {runtime?.variant ?? "自动选择 CUDA"}</strong>
          <p>模型和运行库约 {formatBytes(runtime?.estimated_size_bytes ?? 6_096_492_803)}，只在点击后下载。支持中英文文字检测。</p>
        </div>
        <div className="cleanup-runtime-state" aria-live="polite">
          <span className={runtime?.state === "ready" ? "ready" : ""}><i />{
            runtime?.state === "ready" ? "已准备"
              : runtime?.state === "preparing" ? "正在下载"
                : runtime?.state === "failed" ? "下载失败"
                  : runtime?.docker_ready ? "尚未下载" : "Docker 未就绪"
          }</span>
          <select aria-label="CUDA 运行版本" value={variant} onChange={(event) => setVariant(event.target.value as CleanupVariant)} disabled={runtime?.state === "preparing"}>
            <option value="auto">自动匹配显卡</option>
            <option value="cuda11.8">CUDA 11.8 · RTX 10/20/30</option>
            <option value="cuda12.6">CUDA 12.6 · RTX 40</option>
            <option value="cuda12.8">CUDA 12.8 · RTX 50</option>
          </select>
          {runtime?.state === "preparing" ? (
            <button className="secondary" onClick={() => void cancelCleanupRuntime().then(setRuntime)}>取消下载</button>
          ) : runtime?.state !== "ready" ? (
            <button className="primary" onClick={() => void prepareRuntime()} disabled={busy || !runtime?.docker_ready}><DownloadIcon />预下载运行资源</button>
          ) : (
            <button className="secondary" onClick={() => void refreshRuntime()}><RefreshIcon />校验本地镜像</button>
          )}
          {!runtime?.docker_ready && <button className="text-button" onClick={onOpenModels}>打开环境设置</button>}
        </div>
      </div>

      {notice && <button className="inline-notice" onClick={() => setNotice("")}>{notice}<span>×</span></button>}

      <div className="cleanup-workbench">
        <div className="cleanup-canvas-column">
          <div className="cleanup-heading">
            <div><span className="section-index">01 / SOURCE FRAME</span><h2>在真实画面上框选文字</h2></div>
            <button className="secondary" onClick={() => void chooseVideo()} disabled={busy}><UploadIcon />{media ? "更换视频" : "选择视频"}</button>
          </div>
          <div
            className={`cleanup-preview ${inspection ? "has-frame" : ""} ${regionMode === "manual" ? "selecting" : ""}`}
            style={{ aspectRatio: inspection ? `${inspection.width} / ${inspection.height}` : "16 / 9" }}
            onPointerDown={beginRegion}
            onPointerMove={updateRegion}
            onPointerUp={finishRegion}
            onPointerCancel={finishRegion}
          >
            {inspection ? (
              <>
                <img src={cleanupPreviewUrl(inspection)} alt={`${inspection.source_name} 选区预览`} draggable={false} />
                {[...regions, ...(draft ? [draft] : [])].map((region, index) => (
                  <span
                    className={index === regions.length && draft ? "region draft" : "region"}
                    key={`${region.x}-${region.y}-${index}`}
                    style={{
                      left: `${region.x * 100}%`,
                      top: `${region.y * 100}%`,
                      width: `${region.width * 100}%`,
                      height: `${region.height * 100}%`,
                    }}
                  ><b>{index + 1}</b></span>
                ))}
              </>
            ) : (
              <div className="cleanup-empty">
                <span>16:9</span>
                <strong>{busy ? "正在读取视频…" : "选择一个本地视频"}</strong>
                <p>读取一帧作为选区预览，不会上传媒体。</p>
              </div>
            )}
          </div>
          {inspection && (
            <div className="cleanup-media-meta">
              <strong>{inspection.source_name}</strong>
              <span>{inspection.width}×{inspection.height}</span>
              <span>{formatDuration(inspection.duration_seconds)}</span>
              <span>{(inspection.size_bytes / 1024 ** 2).toFixed(1)} MB</span>
            </div>
          )}
          <div className="region-tools">
            <span>{regionMode === "manual" ? `已选 ${regions.length}/8 个区域` : "自动扫描整幅画面中的文字"}</span>
            <button onClick={addBottomPreset} disabled={!inspection}>底部字幕预设</button>
            <button onClick={addWatermarkPreset} disabled={!inspection}>右上水印预设</button>
            <button onClick={() => setRegions([])} disabled={!regions.length}>清空选区</button>
          </div>
        </div>

        <aside className="cleanup-controls">
          <span className="section-index">02 / REMOVAL SETUP</span>
          <fieldset>
            <legend>清理内容</legend>
            {([
              ["subtitle", "硬字幕", "检测选区内逐帧出现的文字"],
              ["watermark", "文字水印", "持续修复固定区域，必须手动框选"],
              ["all_text", "全画面文字", "自动检测字幕、标题和标牌"],
            ] as const).map(([value, label, detail]) => (
              <button className={kind === value ? "active" : ""} key={value} type="button" onClick={() => chooseKind(value)}>
                <i /> <span><strong>{label}</strong><small>{detail}</small></span>
              </button>
            ))}
          </fieldset>
          <label className="cleanup-select">
            <span>文字语言</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as CleanupLanguage)}>
              <option value="auto">自动 · 中文与英文</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
            <small>检测器按文字形状工作，中英文共用同一套模型。</small>
          </label>
          <div className="cleanup-mode">
            <span>检测范围</span>
            <div>
              <button className={regionMode === "manual" ? "active" : ""} onClick={() => chooseRegionMode("manual")}>手动选区</button>
              <button className={regionMode === "auto" ? "active" : ""} disabled={kind === "watermark"} onClick={() => chooseRegionMode("auto")}>全画面自动</button>
            </div>
          </div>
          {regionMode === "auto" && <p className="cleanup-warning">自动模式可能同时移除路牌、片头文字和演职员表。需要精确控制时请使用手动选区。</p>}

          <div className="cleanup-submit">
            {job ? (
              <div className={`cleanup-job-state ${job.state}`} aria-live="polite">
                <span>{job.state === "completed" ? <CheckIcon /> : <i />}{
                  job.state === "queued" ? "等待 GPU"
                    : job.state === "processing" ? "正在检测并修复"
                      : job.state === "remuxing" ? "正在恢复原音轨"
                        : job.state === "completed" ? "清理完成"
                          : job.state === "cancelled" ? "任务已取消" : "清理失败"
                }</span>
                <strong>{job.progress}%</strong>
                <div><i style={{ width: `${job.progress}%` }} /></div>
                {job.error && <small>{messageFor(job.error)}</small>}
                {["queued", "processing", "remuxing"].includes(job.state) && <button className="secondary" onClick={() => void cancelCleanupJob(job.id).then(setJob)}>取消任务</button>}
                {job.state === "completed" && job.output_path && <button className="primary" onClick={() => window.voiceBridge?.openPath(job.output_path as string)}><FolderIcon />打开清理后视频</button>}
              </div>
            ) : (
              <button className="primary large" disabled={!canStart} onClick={() => void startJob()}><PlayIcon />开始清理视频</button>
            )}
            <small>处理后会重新挂载源视频音轨；源文件不会被修改。</small>
          </div>
        </aside>
      </div>
    </section>
  );
}
