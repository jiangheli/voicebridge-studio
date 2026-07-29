import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchReadiness,
  fetchRuntimeStatus,
  fetchSettings,
  importModelDirectory,
  pauseModelDownload,
  startModelDownload,
  updateSettings,
  type LocalSettings,
  type ModelReadiness,
  type RuntimeStatus,
} from "./api";
import { CheckIcon, DownloadIcon, FolderIcon, LockIcon, PauseIcon, PlayIcon, RefreshIcon } from "./icons";

function formatSize(bytes: number) {
  if (!bytes) return "外部配置";
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB 估算`;
}

function stateLabel(model: ModelReadiness) {
  if (model.configured || model.state === "installed") return "已就绪";
  if (model.state === "downloading") return `下载中 ${model.progress}%`;
  if (model.state === "paused") return `已暂停 ${model.progress}%`;
  if (model.state === "failed") return "下载失败";
  return "未安装";
}

export function ModelManagerView({
  onConnectionChange,
}: {
  onConnectionChange: (online: boolean) => void;
}) {
  const [models, setModels] = useState<ModelReadiness[]>([]);
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [draft, setDraft] = useState<Partial<LocalSettings>>({});
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [githubToken, setGithubToken] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [readiness, localSettings, runtimeStatus] = await Promise.all([
        fetchReadiness(),
        fetchSettings(),
        fetchRuntimeStatus(),
      ]);
      setModels(readiness.models);
      setSettings(localSettings);
      setDraft(localSettings);
      setRuntime(runtimeStatus);
      onConnectionChange(true);
    } catch {
      onConnectionChange(false);
    }
  }, [onConnectionChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasActiveDownload = useMemo(
    () => models.some((model) => model.state === "downloading"),
    [models],
  );

  useEffect(() => {
    if (!hasActiveDownload) return;
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => window.clearInterval(timer);
  }, [hasActiveDownload, refresh]);

  async function perform(model: ModelReadiness, action: "download" | "pause") {
    setBusyId(model.id);
    try {
      if (action === "pause") {
        await pauseModelDownload(model.id);
        setNotice(`${model.name} 已暂停；再次继续会复用本地缓存`);
      } else {
        await startModelDownload(
          model.id,
          model.auth_required ? githubToken : undefined,
        );
        if (model.auth_required) setGithubToken("");
        setNotice(`${model.name} 已开始下载`);
      }
      await refresh();
    } catch (error) {
      setNotice(`操作失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setBusyId("");
    }
  }

  async function choosePath(key: "models_dir" | "cache_dir") {
    const selected = await window.voiceBridge?.chooseDirectory();
    if (selected) setDraft((current) => ({ ...current, [key]: selected }));
  }

  async function importRepository(model: ModelReadiness) {
    if (!window.voiceBridge) {
      setNotice("引入本地仓库仅在 Windows GUI 中可用");
      return;
    }
    const selected = await window.voiceBridge.chooseDirectory();
    if (!selected) return;
    setBusyId(model.id);
    try {
      await importModelDirectory(model.id, selected);
      setNotice(`${model.name} 已引入；原仓库不会被复制或删除`);
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const reason = message.includes("weights_incomplete")
        ? "权重文件不完整，可能只有 Git LFS 指针"
        : message.includes("signature_mismatch")
          ? "目录与该模型的文件结构不匹配"
          : message.includes("directory_missing")
            ? "所选目录不存在"
            : "无法验证该模型仓库";
      setNotice(`引入失败：${reason}`);
    } finally {
      setBusyId("");
    }
  }

  async function saveSettings() {
    setBusyId("settings");
    try {
      const saved = await updateSettings(draft);
      setSettings(saved);
      setDraft(saved);
      setNotice("本地配置已保存，新下载任务会使用新的目录");
      await refresh();
    } catch (error) {
      setNotice(`保存失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="models-view">
      <div className="models-intro">
        <span className="section-index">01 / LOCAL RUNTIME</span>
        <h2>模型留在电脑里，<br />下载由你明确控制。</h2>
        <p>可以直接下载，也可以引入磁盘中已有的完整模型仓库。启动应用不会自动拉取权重；暂停保留缓存，私有仓库 token 只在本次下载进程内使用。</p>
        <div className="runtime-summary">
          <span><strong>{models.filter((item) => item.required && item.configured).length}/{models.filter((item) => item.required).length}</strong><small>必需项就绪</small></span>
          <span><strong>{models.filter((item) => item.state === "installed").length}</strong><small>本地模型</small></span>
          <span><strong>{runtime?.compute_mode === "cuda_candidate" ? "GPU" : "CPU"}</strong><small>{runtime?.gpu_name ?? "自动降级模式"}</small></span>
          <span><strong>{runtime?.ffmpeg_ready ? "FFmpeg" : "待封装"}</strong><small>{runtime?.ffmpeg_ready ? "音视频运行时就绪" : "开发环境未发现"}</small></span>
        </div>
      </div>

      {notice && <button className="inline-notice" onClick={() => setNotice("")}>{notice}<span>×</span></button>}

      <div className="model-catalog-heading">
        <div><span className="section-index">02 / MODEL CATALOG</span><h3>模型清单</h3></div>
        <button className="secondary compact-button" onClick={() => void refresh()}><RefreshIcon />刷新</button>
      </div>
      <div className="model-list">
        {models.map((model, index) => (
          <article className="model-row installable" key={model.id}>
            {model.auth_required && (
              <form
                id={`model-download-${model.id}`}
                className="model-download-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(model, "download");
                }}
              />
            )}
            <span className="model-number">{String(index + 1).padStart(2, "0")}</span>
            <div className="model-identity">
              <span className="model-badges">{model.required ? <b>必需</b> : <b className="optional">可选</b>}<em>{formatSize(model.estimated_size_bytes)}</em></span>
              <strong>{model.name}</strong>
              <small>{model.role}</small>
              {model.repo_id && <code>{model.repo_id} · {model.source_label}</code>}
              {model.auth_required && !model.configured && (
                <input
                  className="model-token-input"
                  type="password"
                  form={`model-download-${model.id}`}
                  autoComplete="off"
                  aria-label="GitHub 私有仓库访问令牌"
                  placeholder="GitHub token · 仅本次下载使用"
                  value={githubToken}
                  onChange={(event) => setGithubToken(event.target.value)}
                />
              )}
            </div>
            <div className="model-progress-cell">
              <span className={`model-state ${model.configured ? "ready" : model.state}`}><i />{stateLabel(model)}</span>
              {model.downloadable && (
                <span className="download-track"><i style={{ width: `${model.progress}%` }} /></span>
              )}
              {model.error && <small className="download-error" title={model.error}>查看服务日志</small>}
            </div>
            <div className="model-action">
              {!model.downloadable ? (
                <span className="external-config"><LockIcon />配置 API</span>
              ) : model.configured || model.state === "installed" ? (
                <div className="model-button-group">
                  <button className="secondary" onClick={() => model.local_path && window.voiceBridge?.openPath(model.local_path)}><FolderIcon />打开目录</button>
                  {model.path_source === "imported" && <button className="text-button compact-button" onClick={() => void importRepository(model)}>更换</button>}
                </div>
              ) : model.state === "downloading" ? (
                <button className="secondary" disabled={busyId === model.id} onClick={() => void perform(model, "pause")}><PauseIcon />暂停</button>
              ) : (
                <div className="model-button-group">
                  <button
                    className="primary"
                    type={model.auth_required ? "submit" : "button"}
                    form={model.auth_required ? `model-download-${model.id}` : undefined}
                    disabled={busyId === model.id || (model.auth_required && !githubToken)}
                    onClick={model.auth_required ? undefined : () => void perform(model, "download")}
                  >
                    {model.state === "paused" ? <PlayIcon /> : <DownloadIcon />}{model.state === "paused" ? "继续" : "安装"}
                  </button>
                  {window.voiceBridge && <button className="secondary import-button" disabled={busyId === model.id} onClick={() => void importRepository(model)}><FolderIcon />引入</button>}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="storage-panel">
        <div className="storage-copy">
          <span className="section-index">03 / STORAGE</span>
          <h3>本地目录与翻译服务</h3>
          <p>Windows 默认写入当前用户的 Local AppData，不需要管理员权限。模型目录和缓存目录可以放到空间更大的磁盘。</p>
          {settings && <code>{settings.data_dir}\settings.json</code>}
        </div>
        <form className="settings-form" onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}>
          <label>
            <span>模型目录</span>
            <div><input value={draft.models_dir ?? ""} onChange={(event) => setDraft((current) => ({ ...current, models_dir: event.target.value }))} />
              {window.voiceBridge && <button type="button" onClick={() => void choosePath("models_dir")}><FolderIcon />选择</button>}
            </div>
          </label>
          <label>
            <span>下载缓存</span>
            <div><input value={draft.cache_dir ?? ""} onChange={(event) => setDraft((current) => ({ ...current, cache_dir: event.target.value }))} />
              {window.voiceBridge && <button type="button" onClick={() => void choosePath("cache_dir")}><FolderIcon />选择</button>}
            </div>
          </label>
          <label>
            <span>翻译 API 地址</span>
            <div><input placeholder="http://127.0.0.1:11434/v1" value={draft.translation_api_base ?? ""} onChange={(event) => setDraft((current) => ({ ...current, translation_api_base: event.target.value }))} /></div>
          </label>
          <label>
            <span>API Key（仅存本机）</span>
            <div><input type="password" autoComplete="off" placeholder="可留空" value={draft.translation_api_key ?? ""} onChange={(event) => setDraft((current) => ({ ...current, translation_api_key: event.target.value }))} /></div>
          </label>
          <label>
            <span>SeamlessExpressive Sidecar 地址</span>
            <div><input placeholder="http://127.0.0.1:8787" value={draft.seamless_api_base ?? ""} onChange={(event) => setDraft((current) => ({ ...current, seamless_api_base: event.target.value }))} /></div>
          </label>
          <label>
            <span>Sidecar API Key（仅存本机）</span>
            <div><input type="password" autoComplete="off" placeholder="可留空" value={draft.seamless_api_key ?? ""} onChange={(event) => setDraft((current) => ({ ...current, seamless_api_key: event.target.value }))} /></div>
          </label>
          <button className="primary save-settings" type="submit" disabled={busyId === "settings"}><CheckIcon />保存本地配置</button>
        </form>
      </div>
    </section>
  );
}
