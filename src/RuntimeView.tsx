import { useCallback, useEffect, useState } from "react";
import {
  fetchReadiness,
  importModelDirectory,
  type ModelReadiness,
} from "./api";
import { FolderIcon, RefreshIcon } from "./icons";
import { LocalGpuPanel } from "./LocalGpuPanel";

export function RuntimeView({
  onConnectionChange,
}: {
  onConnectionChange: (online: boolean) => void;
}) {
  const [model, setModel] = useState<ModelReadiness | undefined>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const readiness = await fetchReadiness();
      setModel(readiness.models.find((item) => item.id === "seamless_expressive"));
      onConnectionChange(true);
    } catch {
      onConnectionChange(false);
      setNotice("本地后台尚未响应，请重新打开应用。");
    }
  }, [onConnectionChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function chooseModel() {
    const selected = await window.voiceBridge?.chooseDirectory();
    if (!selected) return;
    setBusy(true);
    try {
      await importModelDirectory("seamless_expressive", selected);
      await refresh();
      setNotice("SeamlessExpressive 模型目录已连接。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setNotice(
        message.includes("weights_incomplete")
          ? "模型文件不完整，请选择包含三个 .pt 权重的目录。"
          : "无法使用这个模型目录，请检查文件是否完整。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="runtime-view">
      <div className="runtime-heading">
        <div>
          <span className="section-index">MODEL & GPU</span>
          <h2>把环境问题一次看清。</h2>
          <p>只保留实际需要的模型路径、Windows GPU 状态和启动操作。</p>
        </div>
        <button className="secondary" type="button" onClick={() => void refresh()}>
          <RefreshIcon />刷新全部
        </button>
      </div>

      {notice && (
        <button className="inline-notice" type="button" onClick={() => setNotice("")}>
          {notice}<span>×</span>
        </button>
      )}

      <section className="model-path-panel">
        <div>
          <span className="section-index">01 / MODEL</span>
          <h3>SeamlessExpressive</h3>
          <p>{model?.configured ? "模型文件已连接，无需重复下载。" : "请选择包含三个模型权重的文件夹。"}</p>
          <code>{model?.local_path ?? "尚未选择模型目录"}</code>
        </div>
        <div className="model-path-actions">
          {model?.local_path && (
            <button
              className="secondary"
              type="button"
              onClick={() => void window.voiceBridge?.openPath(model.local_path as string)}
            >
              <FolderIcon />打开目录
            </button>
          )}
          <button className="primary" type="button" disabled={busy} onClick={() => void chooseModel()}>
            <FolderIcon />{busy ? "正在验证…" : model?.configured ? "更换目录" : "选择模型目录"}
          </button>
        </div>
      </section>

      <LocalGpuPanel
        model={model}
        onNotice={setNotice}
        onConfigured={refresh}
      />
    </section>
  );
}
