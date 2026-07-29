import { useCallback, useEffect, useState } from "react";
import { updateSettings, type LocalGpuStatus, type ModelReadiness } from "./api";
import { CheckIcon, DownloadIcon, PauseIcon, PlayIcon, RefreshIcon } from "./icons";

function readinessLabel(ready: boolean, yes: string, no: string) {
  return ready ? yes : no;
}

export function LocalGpuPanel({
  model,
  onNotice,
  onConfigured,
}: {
  model?: ModelReadiness;
  onNotice: (message: string) => void;
  onConfigured: () => Promise<void>;
}) {
  const [status, setStatus] = useState<LocalGpuStatus | null>(null);
  const [busy, setBusy] = useState("");

  const refresh = useCallback(async () => {
    if (!window.voiceBridge?.localGpuStatus) {
      setStatus({
        supported: false,
        nvidia_ready: false,
        gpu_name: null,
        wsl_ready: false,
        docker_ready: false,
        image_ready: false,
        container_state: "unavailable",
        service_online: false,
        model_ready: false,
        cuda_ready: false,
        detail: "windows_exe_required",
      });
      return;
    }
    try {
      setStatus(await window.voiceBridge.localGpuStatus());
    } catch (error) {
      onNotice(`本机 GPU 检测失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }, [onNotice]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function install(kind: "wsl" | "docker") {
    setBusy(kind);
    try {
      await window.voiceBridge?.installPrerequisite(kind);
      onNotice(
        kind === "wsl"
          ? "已请求启用 WSL2；请确认管理员窗口，完成后可能需要重启 Windows"
          : "已启动 Docker Desktop 安装；完成后请启动 Docker Desktop 并返回刷新",
      );
    } catch (error) {
      onNotice(`启动安装失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setBusy("");
    }
  }

  async function start() {
    if (!model?.local_path) {
      onNotice("请先安装或引入 SeamlessExpressive 模型");
      return;
    }
    setBusy("start");
    try {
      const result = await window.voiceBridge?.startLocalGpu(model.local_path);
      if (!result?.ok) throw new Error("local_gpu_start_failed");
      await updateSettings({
        seamless_api_base: result.service_base,
        seamless_api_key: "",
      });
      await Promise.all([refresh(), onConfigured()]);
      onNotice(`本机 SeamlessExpressive 已启动：${result.gpu_name ?? "NVIDIA GPU"}`);
    } catch (error) {
      onNotice(`本机推理启动失败：${error instanceof Error ? error.message : "未知错误"}`);
      await refresh();
    } finally {
      setBusy("");
    }
  }

  async function stop() {
    setBusy("stop");
    try {
      await window.voiceBridge?.stopLocalGpu();
      await refresh();
      onNotice("本机 SeamlessExpressive 服务已停止，模型文件保留");
    } catch (error) {
      onNotice(`停止失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setBusy("");
    }
  }

  const ready = Boolean(
    status?.service_online && status.model_ready && status.cuda_ready,
  );
  const canStart = Boolean(
    status?.supported
      && status.nvidia_ready
      && status.wsl_ready
      && status.docker_ready
      && model?.configured,
  );

  return (
    <section className={`local-gpu-panel ${ready ? "ready" : ""}`}>
      <div className="local-gpu-copy">
        <span className="section-index">03 / LOCAL NVIDIA</span>
        <h3>在这台 Windows 电脑运行</h3>
        <p>EXE 管理 WSL2 Docker 推理服务，直接使用本机 NVIDIA GPU。模型目录只读挂载，不会复制第二份权重。</p>
        <small>首次启动需要构建 Linux 运行镜像，通常需 10–30 分钟；以后启动会直接复用。</small>
      </div>

      <div className="local-gpu-runtime" aria-live="polite">
        <div className="local-gpu-stages">
          <span className={status?.nvidia_ready ? "ready" : ""}>
            <i>{status?.nvidia_ready ? <CheckIcon /> : "01"}</i>
            <strong>NVIDIA</strong>
            <small>{status?.gpu_name ?? "需要兼容驱动"}</small>
          </span>
          <span className={status?.wsl_ready ? "ready" : ""}>
            <i>{status?.wsl_ready ? <CheckIcon /> : "02"}</i>
            <strong>WSL2</strong>
            <small>{readinessLabel(Boolean(status?.wsl_ready), "Linux 子系统就绪", "尚未启用")}</small>
          </span>
          <span className={status?.docker_ready ? "ready" : ""}>
            <i>{status?.docker_ready ? <CheckIcon /> : "03"}</i>
            <strong>Docker</strong>
            <small>{readinessLabel(Boolean(status?.docker_ready), "Linux 引擎就绪", "尚未安装或启动")}</small>
          </span>
          <span className={ready ? "ready live" : ""}>
            <i>{ready ? <CheckIcon /> : "04"}</i>
            <strong>Expressive</strong>
            <small>{ready ? "本机推理已在线" : model?.configured ? "等待启动" : "先安装模型"}</small>
          </span>
        </div>

        <div className="local-gpu-actions">
          <button className="secondary compact-button" onClick={() => void refresh()} disabled={Boolean(busy)}>
            <RefreshIcon />刷新环境
          </button>
          {status?.supported && !status.wsl_ready && (
            <button className="primary" onClick={() => void install("wsl")} disabled={Boolean(busy)}>
              <DownloadIcon />{busy === "wsl" ? "正在请求…" : "启用 WSL2"}
            </button>
          )}
          {status?.supported && status.wsl_ready && !status.docker_ready && (
            <button className="primary" onClick={() => void install("docker")} disabled={Boolean(busy)}>
              <DownloadIcon />{busy === "docker" ? "正在请求…" : "安装 Docker Desktop"}
            </button>
          )}
          {status?.docker_ready && !ready && (
            <button className="primary" onClick={() => void start()} disabled={Boolean(busy) || !canStart}>
              <PlayIcon />{busy === "start" ? "正在构建并启动…" : "启动本机 GPU 服务"}
            </button>
          )}
          {ready && (
            <button className="secondary" onClick={() => void stop()} disabled={Boolean(busy)}>
              <PauseIcon />{busy === "stop" ? "正在停止…" : "停止服务"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
