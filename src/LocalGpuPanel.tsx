import { useCallback, useEffect, useMemo, useState } from "react";
import { updateSettings, type LocalGpuStatus, type ModelReadiness } from "./api";
import {
  AlertIcon,
  CheckIcon,
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
} from "./icons";

const issueCopy: Record<string, { title: string; body: string }> = {
  windows_exe_required: {
    title: "请在 Windows 桌面程序中运行",
    body: "浏览器预览无法读取 WSL2、Docker Desktop 和 NVIDIA GPU。",
  },
  nvidia_driver_required: {
    title: "没有检测到 NVIDIA 驱动",
    body: "安装适用于 RTX 5060 Ti 的最新 NVIDIA Windows 驱动后重新启动。",
  },
  wsl2_required: {
    title: "WSL2 尚未启用",
    body: "启用后 Windows 可能要求重启，重启完成再返回刷新。",
  },
  docker_desktop_required: {
    title: "Docker Linux 引擎未运行",
    body: "启动 Docker Desktop，并确认使用 Linux containers。",
  },
  blackwell_runtime_upgrade_required: {
    title: "当前 GPU 运行时不支持 RTX 50 系列",
    body: "检测到旧版 CUDA 镜像。请更新到 PyTorch 2.8 / CUDA 12.8 的 Blackwell 兼容镜像后重新启动。",
  },
  container_exited: {
    title: "GPU 服务容器已经退出",
    body: "环境基本就绪，但容器启动失败。更新兼容镜像后重新启动。",
  },
  runtime_stopped: {
    title: "环境已安装，GPU 服务尚未就绪",
    body: "确认模型目录后启动服务；第一次初始化可能需要一些时间。",
  },
  ready: {
    title: "本机 GPU 服务已就绪",
    body: "SeamlessExpressive 可以直接处理中文语音并输出英文 WAV。",
  },
};

function Stage({
  label,
  value,
  ready,
}: {
  label: string;
  value: string;
  ready: boolean;
}) {
  return (
    <div className={`runtime-stage ${ready ? "ready" : ""}`}>
      <span>{ready ? <CheckIcon /> : <i />}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
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
        runtime_compatible: false,
        detail: "windows_exe_required",
      });
      return;
    }
    setBusy("refresh");
    try {
      setStatus(await window.voiceBridge.localGpuStatus());
    } catch (error) {
      onNotice(`环境检测失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setBusy("");
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
          ? "已打开 WSL2 启用窗口，完成后请重启 Windows。"
          : "已打开 Docker Desktop 安装，完成后请启动 Docker Desktop。",
      );
    } catch (error) {
      onNotice(`启动失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setBusy("");
    }
  }

  async function start() {
    if (!model?.local_path) {
      onNotice("请先选择 SeamlessExpressive 模型目录。");
      return;
    }
    if (status?.runtime_compatible === false) {
      onNotice("RTX 5060 Ti 需要 Blackwell 兼容镜像，当前 CUDA 12.1 镜像无法启动推理。");
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
      onNotice(`GPU 服务已启动：${result.gpu_name ?? "NVIDIA GPU"}`);
    } catch (error) {
      onNotice(`启动失败：${error instanceof Error ? error.message : "未知错误"}`);
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
      onNotice("GPU 服务已停止，模型文件不会删除。");
    } catch (error) {
      onNotice(`停止失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setBusy("");
    }
  }

  const ready = Boolean(
    status?.service_online
      && status.model_ready
      && status.cuda_ready
      && status.runtime_compatible !== false,
  );
  const issue = issueCopy[status?.detail ?? "runtime_stopped"];
  const completed = useMemo(() => [
    status?.nvidia_ready,
    status?.wsl_ready,
    status?.docker_ready,
    status?.image_ready,
    model?.configured,
    ready,
  ].filter(Boolean).length, [model?.configured, ready, status]);

  return (
    <section className="gpu-console">
      <div className="gpu-console-head">
        <div>
          <span className="section-index">02 / WINDOWS GPU</span>
          <h3>RTX 环境状态</h3>
          <p>{completed}/6 项完成</p>
        </div>
        <button
          className="secondary"
          type="button"
          onClick={() => void refresh()}
          disabled={Boolean(busy)}
        >
          <RefreshIcon />{busy === "refresh" ? "正在检测…" : "重新检测"}
        </button>
      </div>

      <div className="runtime-stage-grid" aria-live="polite">
        <Stage
          label="显卡与驱动"
          value={status?.gpu_name
            ? `${status.gpu_name}${status.driver_version ? ` · ${status.driver_version}` : ""}`
            : "未检测到"}
          ready={Boolean(status?.nvidia_ready)}
        />
        <Stage
          label="WSL2"
          value={status?.wsl_ready ? "已启用" : "未启用"}
          ready={Boolean(status?.wsl_ready)}
        />
        <Stage
          label="Docker Desktop"
          value={status?.docker_ready ? "Linux 引擎在线" : "未启动"}
          ready={Boolean(status?.docker_ready)}
        />
        <Stage
          label="推理镜像"
          value={status?.image_ready
            ? `PyTorch ${status.torch_version ?? "2.8.0"} · CUDA ${status.cuda_runtime ?? "12.8"}`
            : "尚未载入"}
          ready={Boolean(status?.image_ready && status?.runtime_compatible !== false)}
        />
        <Stage
          label="模型权重"
          value={model?.configured ? "三个 checkpoint 已连接" : "尚未选择"}
          ready={Boolean(model?.configured)}
        />
        <Stage
          label="GPU 服务"
          value={ready ? "127.0.0.1:8787 在线" : status?.container_state ?? "未启动"}
          ready={ready}
        />
      </div>

      <div className={`runtime-diagnosis ${ready ? "ready" : "warning"}`}>
        <span>{ready ? <CheckIcon /> : <AlertIcon />}</span>
        <div>
          <strong>{issue.title}</strong>
          <p>{issue.body}</p>
          {status?.compute_capability && <code>Compute capability {status.compute_capability}</code>}
          {status?.cuda_error && <code>{status.cuda_error}</code>}
        </div>
      </div>

      <div className="gpu-console-actions">
        {status?.supported && !status.wsl_ready && (
          <button className="primary" type="button" onClick={() => void install("wsl")} disabled={Boolean(busy)}>
            <DownloadIcon />启用 WSL2
          </button>
        )}
        {status?.supported && status.wsl_ready && !status.docker_ready && (
          <button className="primary" type="button" onClick={() => void install("docker")} disabled={Boolean(busy)}>
            <DownloadIcon />安装 Docker Desktop
          </button>
        )}
        {status?.docker_ready && !ready && (
          <button
            className="primary"
            type="button"
            onClick={() => void start()}
            disabled={Boolean(busy) || !model?.configured || status.runtime_compatible === false}
          >
            <PlayIcon />{busy === "start" ? "正在启动…" : "启动 GPU 服务"}
          </button>
        )}
        {ready && (
          <button className="secondary" type="button" onClick={() => void stop()} disabled={Boolean(busy)}>
            <PauseIcon />停止服务
          </button>
        )}
      </div>
    </section>
  );
}
