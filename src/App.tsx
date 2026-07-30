import { useEffect, useState } from "react";
import type { DesktopUpdateStatus } from "./api";
import { ExpressiveView } from "./ExpressiveView";
import { VideoCleanupView } from "./VideoCleanupView";
import { RuntimeView } from "./RuntimeView";
import {
  CheckIcon,
  MediaIcon,
  RefreshIcon,
  SettingsIcon,
} from "./icons";

type View = "translate" | "cleanup" | "runtime";

const viewCopy: Record<View, { eyebrow: string; title: string }> = {
  translate: {
    eyebrow: "SEAMLESS EXPRESSIVE",
    title: "语音直译",
  },
  cleanup: {
    eyebrow: "VIDEO CLEANUP",
    title: "视频文字清理",
  },
  runtime: {
    eyebrow: "LOCAL RUNTIME",
    title: "环境与 GPU",
  },
};

function App() {
  const [view, setView] = useState<View>("translate");
  const [apiOnline, setApiOnline] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus | null>(null);

  useEffect(() => {
    const desktop = window.voiceBridge;
    if (!desktop) return;
    void desktop.getUpdateStatus().then(setUpdateStatus);
    return desktop.onUpdateStatus(setUpdateStatus);
  }, []);

  return (
    <div className="desktop-gui">
      <aside className="gui-rail">
        <button
          className="gui-brand"
          type="button"
          onClick={() => setView("translate")}
          aria-label="VoiceBridge 语音直译"
        >
          <span className="gui-brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>VB</span>
        </button>

        <nav aria-label="主功能">
          <button
            type="button"
            className={view === "translate" ? "active" : ""}
            onClick={() => setView("translate")}
          >
            <MediaIcon />
            <span>直译</span>
          </button>
          <button
            type="button"
            className={view === "cleanup" ? "active" : ""}
            onClick={() => setView("cleanup")}
          >
            <span className="rail-glyph">⌗</span>
            <span>清理</span>
          </button>
          <button
            type="button"
            className={view === "runtime" ? "active" : ""}
            onClick={() => setView("runtime")}
          >
            <SettingsIcon />
            <span>环境</span>
          </button>
        </nav>

        <button
          className="gui-version"
          type="button"
          title={updateStatus?.message ?? "检查更新"}
          onClick={() => void window.voiceBridge?.checkForUpdates()}
        >
          <RefreshIcon />
          <span>{updateStatus?.currentVersion ?? "DEV"}</span>
        </button>
      </aside>

      <div className="gui-window">
        <header className="gui-titlebar">
          <div>
            <span>{viewCopy[view].eyebrow}</span>
            <h1>{viewCopy[view].title}</h1>
          </div>
          <div className={`gui-connection ${apiOnline ? "online" : ""}`}>
            <i />
            {apiOnline ? <><CheckIcon />本地服务在线</> : "正在连接本地服务"}
          </div>
        </header>

        <main className="gui-content">
          {view === "translate" && (
            <ExpressiveView
              onConnectionChange={setApiOnline}
              onOpenModels={() => setView("runtime")}
            />
          )}
          {view === "cleanup" && (
            <VideoCleanupView
              onConnectionChange={setApiOnline}
              onOpenModels={() => setView("runtime")}
            />
          )}
          {view === "runtime" && (
            <RuntimeView onConnectionChange={setApiOnline} />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
