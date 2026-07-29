import { useCallback, useEffect, useState } from "react";
import {
  createExpressiveJob,
  fetchExpressiveJob,
  fetchExpressiveStatus,
  type DesktopMediaFile,
  type ExpressiveJob,
  type ExpressiveStatus,
} from "./api";
import { CheckIcon, FolderIcon, PlayIcon, RefreshIcon, SettingsIcon, UploadIcon } from "./icons";

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ExpressiveView({
  onOpenModels,
  onConnectionChange,
}: {
  onOpenModels: () => void;
  onConnectionChange: (online: boolean) => void;
}) {
  const [status, setStatus] = useState<ExpressiveStatus | null>(null);
  const [media, setMedia] = useState<DesktopMediaFile | null>(null);
  const [job, setJob] = useState<ExpressiveJob | null>(null);
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await fetchExpressiveStatus());
      onConnectionChange(true);
    } catch {
      onConnectionChange(false);
      setNotice("无法读取快速链路状态");
    } finally {
      setChecking(false);
    }
  }, [onConnectionChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!job || !["queued", "processing"].includes(job.state)) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      fetchExpressiveJob(job.id, controller.signal)
        .then(setJob)
        .catch(() => undefined);
    }, 1400);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [job]);

  async function chooseMedia() {
    if (!window.voiceBridge) {
      setNotice("快速链路需要在 Windows GUI 中选择本地媒体");
      return;
    }
    const selected = await window.voiceBridge.chooseMediaFile();
    if (selected) {
      setMedia(selected);
      setJob(null);
      setNotice("");
    }
  }

  async function start() {
    if (!media) return;
    try {
      const created = await createExpressiveJob(media.path);
      setJob(created);
      setNotice("已提交到 SeamlessExpressive sidecar");
    } catch (error) {
      setNotice(`提交失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  const runtimeReady = Boolean(
    status?.ready && status.sidecar_runtime?.model_ready,
  );

  return (
    <section className="expressive-view">
      <div className="expressive-intro">
        <div>
          <span className="section-index">EXPRESSIVE FAST / 快速链路</span>
          <h2>中文直达<br />英文原声。</h2>
          <p>SeamlessExpressive 直接执行中文语音到英文语音翻译，保留说话节奏、停顿和音色风格。输出为英文 WAV，适合快速预览。</p>
          <div className="expressive-actions">
            <button className="primary large" onClick={() => void chooseMedia()}><UploadIcon />选择本地媒体</button>
            <button className="secondary" onClick={() => void refresh()} disabled={checking}><RefreshIcon />检查运行时</button>
          </div>
        </div>
        <div className="expressive-signal" aria-hidden="true">
          <span>CMN</span>
          <i><b /></i>
          <span>ENG</span>
        </div>
      </div>

      {notice && <button className="inline-notice" onClick={() => setNotice("")}>{notice}<span>×</span></button>}

      <div className="expressive-status">
        <span className={status?.checkpoint_ready ? "ready" : ""}><i />Checkpoint<strong>{status?.checkpoint_ready ? "当前电脑已安装" : "可在模型中心安装"}</strong></span>
        <span className={status?.sidecar_configured ? "ready" : ""}><i />Sidecar 配置<strong>{status?.sidecar_configured ? "地址已保存" : "尚未配置地址"}</strong></span>
        <span className={runtimeReady ? "ready" : ""}><i />推理运行时<strong>{runtimeReady ? status?.sidecar_runtime?.gpu_name ?? "在线" : "Linux GPU 服务未就绪"}</strong></span>
        <button className="text-button" onClick={onOpenModels}><SettingsIcon />打开模型与运行设置</button>
      </div>

      <div className="expressive-flow">
        <div><span>01</span><strong>读取语音</strong><small>FFmpeg 转为 16 kHz WAV</small></div>
        <div><span>02</span><strong>表达式直译</strong><small>UnitY2 + PRETSSEL</small></div>
        <div><span>03</span><strong>英文语音</strong><small>返回可试听 WAV</small></div>
      </div>

      <div className="expressive-job">
        <div className="expressive-job-copy">
          <span className="section-index">CURRENT INPUT / 当前输入</span>
          {media ? (
            <>
              <h3>{media.name}</h3>
              <p>{media.extension.replace(".", "").toUpperCase()} · {formatSize(media.size)} · 中文 → English</p>
            </>
          ) : (
            <>
              <h3>尚未选择媒体</h3>
              <p>支持 WAV、MP3、M4A、FLAC、MP4、MOV、MKV。</p>
            </>
          )}
          <small>快速链路只生成译制语音，不自动回混原视频背景。需要背景音与字幕审校时，请使用原可控链路。</small>
        </div>
        <div className="expressive-job-action">
          {job ? (
            <div className={`expressive-result ${job.state}`}>
              <span>{job.state === "completed" ? <CheckIcon /> : <i />}{job.state === "queued" ? "排队中" : job.state === "processing" ? "正在推理" : job.state === "completed" ? "英文语音已生成" : "推理失败"}</span>
              <strong>{job.progress}%</strong>
              <div><i style={{ width: `${job.progress}%` }} /></div>
              {job.error && <small>{job.error}</small>}
              {job.output_path && <button className="primary" onClick={() => window.voiceBridge?.openPath(job.output_path as string)}><FolderIcon />打开英文 WAV</button>}
            </div>
          ) : (
            <button className="primary large" disabled={!media || !runtimeReady} onClick={() => void start()}><PlayIcon />开始快速直译</button>
          )}
        </div>
      </div>
    </section>
  );
}
