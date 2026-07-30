import { useEffect, useMemo, useRef, useState } from "react";
import { fetchReadiness, type DesktopUpdateStatus } from "./api";
import { initialSegments, pipeline } from "./data";
import { AlertIcon, CheckIcon, ChevronIcon, DownloadIcon, FileIcon, LockIcon, MediaIcon, PauseIcon, PlayIcon, RefreshIcon, SettingsIcon, UploadIcon } from "./icons";
import { downloadJson, downloadText, loadJobs, saveJobs } from "./storage";
import { serializeSubtitles, subtitleFilename, type SubtitleFormat, type SubtitleTrack } from "./subtitles";
import type { JobFile, SegmentStatus, StoredJob } from "./types";
import { ModelManagerView } from "./ModelManagerView";
import { ExpressiveView } from "./ExpressiveView";

const waveform = Array.from({ length: 116 }, (_, i) =>
  Math.round(12 + Math.abs(Math.sin(i * 0.47) * 34) + Math.abs(Math.cos(i * 0.18) * 22)),
);

function ScoreRing({ value, label }: { value: number; label: string }) {
  return (
    <div className="score">
      <div className="score-ring" style={{ "--score": `${value * 3.6}deg` } as React.CSSProperties}>
        <span>{value}</span>
      </div>
      <small>{label}</small>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return "演示素材";
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function createJobId() {
  return `VB-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function App() {
  const [view, setView] = useState<"workspace" | "expressive" | "jobs" | "models">("workspace");
  const [file, setFile] = useState<JobFile | null>(null);
  const [segments, setSegments] = useState(initialSegments);
  const [activeId, setActiveId] = useState("SEG 003");
  const [filter, setFilter] = useState<"all" | SegmentStatus>("all");
  const [step, setStep] = useState(8);
  const [running, setRunning] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState("");
  const [jobs, setJobs] = useState<StoredJob[]>(loadJobs);
  const [currentJobId, setCurrentJobId] = useState("DEMO-001");
  const [apiOnline, setApiOnline] = useState(false);
  const [subtitleFormat, setSubtitleFormat] = useState<SubtitleFormat>("srt");
  const [subtitleTrack, setSubtitleTrack] = useState<SubtitleTrack>("target");
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = segments.find((item) => item.id === activeId) ?? segments[0];
  const approved = segments.filter((item) => item.status === "approved").length;
  const reviewCount = segments.filter((item) => item.status === "review").length;
  const overall = Math.round(segments.reduce((sum, item) => sum + item.semantic, 0) / segments.length);
  const visibleSegments = segments.filter((item) => filter === "all" || item.status === filter);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setStep((current) => {
        if (current >= pipeline.length) {
          window.clearInterval(timer);
          setRunning(false);
          setSegments((items) => items.map((item) =>
            item.status === "processing" ? { ...item, status: "approved", semantic: 96 } : item,
          ));
          setNotice("模拟处理完成：1 个片段需要人工复核");
          return current;
        }
        return current + 1;
      });
    }, 650);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (jobs.length) saveJobs(jobs);
  }, [jobs]);

  useEffect(() => {
    const desktop = window.voiceBridge;
    if (!desktop) return;
    void desktop.getUpdateStatus().then(setUpdateStatus);
    return desktop.onUpdateStatus(setUpdateStatus);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchReadiness(controller.signal)
      .then((result) => {
        setApiOnline(true);
        void result;
      })
      .catch(() => {
        setApiOnline(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setJobs((items) => items.map((job) => {
      if (job.id !== currentJobId) return job;
      const status: StoredJob["status"] = running
        ? "processing"
        : segments.every((item) => item.status === "approved") ? "completed" : "review";
      return {
        ...job,
        segments,
        progress: running ? Math.round(step / pipeline.length * 100) : 100,
        status,
      };
    }));
  }, [segments, running, step, currentJobId]);

  const fileLabel = useMemo(() => file?.name ?? "产品更新_中文采访.mp4", [file]);

  function chooseFile(next: File) {
    if (!next.type.startsWith("audio/") && !next.type.startsWith("video/")) {
      setNotice("请选择音频或视频文件");
      return;
    }
    if (file?.url) URL.revokeObjectURL(file.url);
    const nextFile = { name: next.name, size: next.size, type: next.type, url: URL.createObjectURL(next) };
    const jobId = createJobId();
    setFile(nextFile);
    setView("workspace");
    setSegments(initialSegments);
    setActiveId("SEG 003");
    setFilter("all");
    setStep(1);
    setRunning(true);
    setCurrentJobId(jobId);
    const job: StoredJob = {
      id: jobId,
      name: next.name,
      createdAt: new Date().toISOString(),
      mediaType: next.type,
      size: next.size,
      status: "processing",
      progress: 11,
      segments: initialSegments,
    };
    setJobs((items) => [job, ...items].slice(0, 12));
    setNotice("已创建本地模拟任务，模型下载保持关闭");
  }

  function startDemo() {
    const exists = jobs.some((job) => job.id === "DEMO-001");
    if (!exists) {
      const demoJob: StoredJob = {
        id: "DEMO-001",
        name: "产品更新_中文采访.mp4",
        createdAt: new Date().toISOString(),
        mediaType: "video/mp4",
        size: 0,
        status: "processing",
        progress: 11,
        segments: initialSegments,
      };
      setJobs((items) => [demoJob, ...items]);
    }
    setCurrentJobId("DEMO-001");
    setFile(null);
    setSegments(initialSegments);
    setActiveId("SEG 003");
    setFilter("all");
    setStep(1);
    setRunning(true);
    setNotice("正在运行确定性演示数据，不会调用真实模型");
  }

  function openJob(job: StoredJob) {
    setCurrentJobId(job.id);
    setFile({ name: job.name, size: job.size, type: job.mediaType });
    setSegments(job.segments);
    setActiveId(job.segments.find((item) => item.status === "review")?.id ?? job.segments[0].id);
    setStep(pipeline.length);
    setRunning(false);
    setView("workspace");
    setNotice(job.size ? "已恢复任务数据；出于浏览器安全限制，请重新选择原媒体以预览" : "已打开演示任务");
  }

  function updateTarget(value: string) {
    setSegments((items) => items.map((item) => item.id === active.id ? { ...item, target: value } : item));
  }

  function approveSegment() {
    setSegments((items) => items.map((item) =>
      item.id === active.id ? { ...item, status: "approved", issue: undefined, semantic: 98 } : item,
    ));
    setNotice(`${active.id} 已锁定译文并批准`);
  }

  function exportReport() {
    const report = {
      schema_version: "1.0",
      job_id: currentJobId,
      source_file: fileLabel,
      generated_at: new Date().toISOString(),
      model_mode: "fixture_no_download",
      background_policy: "preserve_and_duck",
      summary: {
        overall_score: overall,
        approved_segments: approved,
        total_segments: segments.length,
        critical_errors: reviewCount,
        ready: approved === segments.length,
      },
      segments,
    };
    downloadJson(`${fileLabel.replace(/\.[^.]+$/, "")}_quality_report.json`, report);
    setNotice("质量报告已导出为 JSON");
  }

  function exportSubtitles() {
    try {
      const content = serializeSubtitles(segments, subtitleFormat, subtitleTrack);
      const filename = subtitleFilename(fileLabel, subtitleFormat, subtitleTrack);
      const mediaType = subtitleFormat === "vtt"
        ? "text/vtt;charset=utf-8"
        : "application/x-subrip;charset=utf-8";
      downloadText(filename, content, mediaType);
      setNotice(`字幕已导出：${filename}`);
    } catch {
      setNotice("字幕导出失败：片段时间码无效");
    }
  }

  function regenerate() {
    const regeneratedTarget = active.id === "SEG 003"
      ? "But this does not mean that the previous version will no longer be maintained."
      : active.target;
    setSegments((items) => items.map((item) =>
      item.id === active.id ? { ...item, status: "processing", route: "Qwen3-TTS" } : item,
    ));
    setNotice(`${active.id} 已加入模拟重生成队列`);
    window.setTimeout(() => {
      setSegments((items) => items.map((item) =>
        item.id === active.id ? {
          ...item,
          target: regeneratedTarget,
          status: "review",
          semantic: 98,
          timing: 92,
          issue: "等待人工确认",
        } : item,
      ));
    }, 900);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("workspace")} aria-label="返回工作台">
          <span className="brand-mark"><i /><i /><i /><i /></span>
          <span>VOICEBRIDGE</span>
        </button>

        <nav aria-label="主导航">
          <button className={view === "workspace" ? "active" : ""} onClick={() => setView("workspace")}>
            <span className="nav-icon">⌁</span>工作台
          </button>
          <button className={view === "expressive" ? "active" : ""} onClick={() => setView("expressive")}>
            <span className="nav-icon">ϟ</span>快速直译
          </button>
          <button className={view === "jobs" ? "active" : ""} onClick={() => setView("jobs")}>
            <span className="nav-icon">◫</span>全部任务 <em>{Math.max(1, jobs.length)}</em>
          </button>
          <button className={view === "models" ? "active" : ""} onClick={() => setView("models")}>
            <SettingsIcon />模型与运行
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="guard">
            <span><LockIcon />模型保护</span>
            <strong>仅由用户触发下载</strong>
            <p>启动与创建任务都不会自动拉取模型。</p>
          </div>
          <button
            className="docs-link"
            onClick={() => {
              if (window.voiceBridge) void window.voiceBridge.openDocumentation();
              else setNotice("开发文档位于项目 docs/DEVELOPMENT.md");
            }}
          ><FileIcon />开发文档 <ChevronIcon /></button>
          <button
            className="version update-button"
            type="button"
            title="点击检查更新"
            onClick={() => void window.voiceBridge?.checkForUpdates()}
          >
            WINDOWS DESKTOP · {updateStatus?.currentVersion ?? "DEV"}
            <small>{updateStatus?.message ?? "自动更新"}</small>
          </button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">{view === "workspace" ? "翻译任务 / 可控链路" : view === "expressive" ? "SeamlessExpressive / 快速链路" : view === "jobs" ? "浏览器存储 / 任务记录" : "运行环境 / 模型适配"}</span>
            <h1>{view === "workspace" ? fileLabel : view === "expressive" ? "中文语音 → 英文表达式语音" : view === "jobs" ? "全部任务" : "模型与运行状态"}</h1>
          </div>
          <div className="top-actions">
            <span className={`offline ${apiOnline ? "connected" : ""}`}><i />{apiOnline ? "API 已连接" : "本地模式"}</span>
            {view === "workspace" && <button className="primary" onClick={() => fileRef.current?.click()}><UploadIcon />导入媒体</button>}
          </div>
        </header>

        {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}

        {view === "models" ? (
          <ModelManagerView onConnectionChange={setApiOnline} />
        ) : view === "expressive" ? (
          <ExpressiveView
            onConnectionChange={setApiOnline}
            onOpenModels={() => setView("models")}
          />
        ) : view === "jobs" ? (
          <section className="jobs-view">
            <div className="jobs-heading">
              <div><span className="section-index">LOCAL JOBS / 本地任务</span><h2>任务只保存在当前浏览器</h2><p>译文、状态和质量分数会持久化；媒体文件本身不会写入浏览器存储。</p></div>
              <button className="primary" onClick={() => fileRef.current?.click()}><UploadIcon />新建任务</button>
            </div>
            <div className="jobs-table">
              <div className="jobs-table-head"><span>任务</span><span>进度</span><span>状态</span><span>创建时间</span><span /></div>
              {jobs.length ? jobs.map((job) => (
                <button className="job-row" key={job.id} onClick={() => openJob(job)}>
                  <span className="job-name"><MediaIcon /><span><strong>{job.name}</strong><small>{job.id} · {formatBytes(job.size)}</small></span></span>
                  <span className="job-progress"><i><b style={{ width: `${job.progress}%` }} /></i><small>{job.progress}%</small></span>
                  <span className={`job-state ${job.status}`}>{job.status === "completed" ? "已完成" : job.status === "processing" ? "处理中" : "待复核"}</span>
                  <span className="job-date">{new Date(job.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  <ChevronIcon />
                </button>
              )) : (
                <div className="jobs-empty"><strong>还没有任务</strong><p>导入一个中文音频或视频开始。</p></div>
              )}
            </div>
          </section>
        ) : (
          <div className="workspace">
            {!file && (
              <section
                className="dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); const next = event.dataTransfer.files[0]; if (next) chooseFile(next); }}
              >
                <div className="drop-copy">
                  <span className="section-index">NEW JOB / 新建任务</span>
                  <h2>让原来的声音，<br />说准确的英文。</h2>
                  <p>导入中文音频或视频，先体验完整审校流程。此阶段不会下载模型。</p>
                  <div className="drop-actions">
                    <button className="primary large" onClick={() => fileRef.current?.click()}><UploadIcon />选择音频或视频</button>
                    <button className="text-button" onClick={startDemo}><PlayIcon />使用演示素材</button>
                  </div>
                  <small>支持 MP4、MOV、WAV、MP3、M4A · 文件只保留在当前浏览器会话</small>
                </div>
                <div className="visualizer" aria-hidden="true">
                  {waveform.slice(0, 62).map((height, index) => <i key={index} style={{ height: `${height * 1.8}px`, animationDelay: `${index * -22}ms` }} />)}
                  <span className="lang-tag source-lang">中文</span>
                  <span className="lang-tag target-lang">EN</span>
                  <div className="bridge-line" />
                </div>
              </section>
            )}

            {file && (
              <section className="media-source">
                <div className="media-copy">
                  <span className="section-index">SOURCE MEDIA / 源媒体</span>
                  <h2>{file.name}</h2>
                  <div><span>{file.type || "未知格式"}</span><span>{formatBytes(file.size)}</span><span>中文 → English</span><span>背景轨保留</span></div>
                  <p>{file.url ? "媒体只在当前浏览器会话中读取，不会上传。" : "任务数据已恢复。重新选择原媒体后可继续本地预览。"}</p>
                </div>
                <div className="media-player">
                  {file.url ? (
                    file.type.startsWith("video/")
                      ? <video src={file.url} controls preload="metadata" />
                      : <audio src={file.url} controls preload="metadata" />
                  ) : (
                    <button onClick={() => fileRef.current?.click()}><UploadIcon />重新选择源媒体</button>
                  )}
                </div>
              </section>
            )}

            <section className="pipeline-section">
              <div className="section-heading">
                <div><span className="section-index">01 / PIPELINE</span><h2>处理流水线</h2></div>
                <div className="job-status">
                  <span>{running ? `正在处理 · ${Math.min(step, pipeline.length)}/${pipeline.length}` : "等待复核"}</span>
                  <strong>{running ? Math.round(step / pipeline.length * 100) : 100}%</strong>
                </div>
              </div>
              <div className="pipeline">
                {pipeline.map((item, index) => {
                  const done = index < step;
                  const current = running && index === step;
                  return (
                    <div className={`pipeline-step ${done ? "done" : ""} ${current ? "current" : ""}`} key={item.id}>
                      <div className="step-line"><i /></div>
                      <span className="step-index">{String(index + 1).padStart(2, "0")}</span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                      <span className="step-state">{done ? <CheckIcon /> : current ? <span className="spinner" /> : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="timeline-section">
              <div className="section-heading">
                <div><span className="section-index">02 / TIMELINE</span><h2>分段与时间轴</h2></div>
                <div className="legend"><span><i className="speaker-one" />说话人 01</span><span><i className="speaker-two" />说话人 02</span></div>
              </div>
              <div className="transport">
                <button onClick={() => setPlaying((value) => !value)} aria-label={playing ? "暂停" : "播放"}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
                <span>00:09.72</span>
                <div className={`wave-track ${playing ? "playing" : ""}`}>
                  {waveform.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
                  <b style={{ left: "40%" }} />
                </div>
                <span>00:24.10</span>
              </div>
              <div className="segment-strip">
                {segments.map((segment) => (
                  <button
                    key={segment.id}
                    className={`${segment.id === active.id ? "active" : ""} ${segment.status === "review" ? "risk" : ""}`}
                    style={{ flex: segment.duration, "--speaker": segment.speakerColor } as React.CSSProperties}
                    onClick={() => setActiveId(segment.id)}
                  >
                    <i /><span>{segment.id.replace("SEG ", "")}</span>
                    {segment.status === "review" && <AlertIcon />}
                  </button>
                ))}
              </div>
            </section>

            <section className="review-grid">
              <div className="segment-list">
                <div className="section-heading compact">
                  <div><span className="section-index">03 / REVIEW</span><h2>片段审校</h2></div>
                  <span className="review-count">{reviewCount} 待处理</span>
                </div>
                <div className="review-filters" aria-label="片段筛选">
                  {([
                    ["all", `全部 ${segments.length}`],
                    ["review", `待复核 ${reviewCount}`],
                    ["approved", `已通过 ${approved}`],
                  ] as const).map(([value, label]) => (
                    <button className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>{label}</button>
                  ))}
                </div>
                {visibleSegments.map((segment) => (
                  <button className={`segment-row ${segment.id === active.id ? "active" : ""}`} key={segment.id} onClick={() => setActiveId(segment.id)}>
                    <span className="segment-status">
                      {segment.status === "approved" ? <CheckIcon /> : segment.status === "review" ? <AlertIcon /> : <span className="spinner" />}
                    </span>
                    <span className="segment-main">
                      <span><b>{segment.id}</b><small>{segment.start} — {segment.end}</small></span>
                      <strong>{segment.source}</strong>
                      <em>{segment.issue ?? segment.route}</em>
                    </span>
                    <ChevronIcon />
                  </button>
                ))}
              </div>

              <div className="inspector">
                <div className="inspector-head">
                  <div><span style={{ background: active.speakerColor }} /><strong>{active.id}</strong><small>{active.speaker} · {active.duration.toFixed(2)}s</small></div>
                  <span className={`status-pill ${active.status}`}>{active.status === "review" ? "需要复核" : active.status === "approved" ? "已通过" : "处理中"}</span>
                </div>
                {active.issue && <div className={`critical-alert ${active.semantic >= 95 ? "resolved" : ""}`}><AlertIcon /><div><strong>{active.semantic >= 95 ? "候选已修正，等待确认" : "内容质量闸门未通过"}</strong><p>{active.issue}{active.semantic < 95 ? " · Critical error" : ""}</p></div></div>}
                <label className="transcript-field">
                  <span>中文原文 <small>Qwen3-ASR · 模拟</small></span>
                  <p>{active.source}</p>
                </label>
                <label className="transcript-field editable">
                  <span>英文译文 <small>{active.route}</small></span>
                  <textarea value={active.target} onChange={(event) => updateTarget(event.target.value)} />
                </label>
                <div className="scores">
                  <ScoreRing value={active.semantic} label="语义" />
                  <ScoreRing value={active.voice} label="音色" />
                  <ScoreRing value={active.timing} label="时长" />
                </div>
                <div className="inspector-actions">
                  <button className="secondary" onClick={regenerate}><RefreshIcon />生成备用候选</button>
                  <button className="primary" onClick={approveSegment}><CheckIcon />锁定并批准</button>
                </div>
              </div>
            </section>

            <section className="summary">
              <div><span className="section-index">04 / QUALITY REPORT</span><h2>交付就绪度</h2></div>
              <div className="summary-metrics">
                <span><strong>{overall}</strong><small>内容质量 / 100</small></span>
                <span><strong>{approved}/{segments.length}</strong><small>已批准片段</small></span>
                <span><strong>{reviewCount}</strong><small>待复核片段</small></span>
                <span><strong>1.03×</strong><small>平均时长比</small></span>
              </div>
              <div className="delivery-actions">
                <div className="subtitle-export">
                  <label>
                    <span>字幕轨</span>
                    <select aria-label="字幕轨" value={subtitleTrack} onChange={(event) => setSubtitleTrack(event.target.value as SubtitleTrack)}>
                      <option value="target">英文</option>
                      <option value="bilingual">中英双语</option>
                      <option value="source">中文</option>
                    </select>
                  </label>
                  <label>
                    <span>格式</span>
                    <select aria-label="字幕格式" value={subtitleFormat} onChange={(event) => setSubtitleFormat(event.target.value as SubtitleFormat)}>
                      <option value="srt">SRT</option>
                      <option value="vtt">WebVTT</option>
                    </select>
                  </label>
                  <button className={`export-button subtitle-button ${approved === segments.length ? "ready" : ""}`} disabled={approved !== segments.length} onClick={exportSubtitles}>
                    {approved === segments.length ? <DownloadIcon /> : <LockIcon />}导出字幕
                  </button>
                </div>
                <button className={`export-button ${approved === segments.length ? "ready" : ""}`} disabled={approved !== segments.length} onClick={exportReport}>
                  {approved === segments.length ? <DownloadIcon /> : <LockIcon />}
                  {approved === segments.length ? "质量报告" : "完成全部复核后导出"}
                </button>
              </div>
            </section>
          </div>
        )}

        <input
          ref={fileRef}
          className="file-input"
          type="file"
          accept="audio/*,video/mp4,video/quicktime"
          onChange={(event) => { const next = event.target.files?.[0]; if (next) chooseFile(next); }}
        />
      </main>
    </div>
  );
}

export default App;
