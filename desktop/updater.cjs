const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 15 * 1000;

function createUpdateController({
  app,
  autoUpdater,
  dialog,
  getMainWindow,
  platform = process.platform,
  startupDelayMs = STARTUP_DELAY_MS,
  checkIntervalMs = CHECK_INTERVAL_MS,
  setTimer = setTimeout,
  setRepeatingTimer = setInterval,
}) {
  let manualCheck = false;
  let started = false;
  let installing = false;
  let state = {
    status: "idle",
    currentVersion: app.getVersion(),
    availableVersion: null,
    percent: 0,
    message: "将在后台检查更新",
  };

  function publish(changes) {
    state = { ...state, ...changes };
    const window = getMainWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send("voicebridge:update-status", state);
    }
    return state;
  }

  async function showMessage(options) {
    const window = getMainWindow();
    return window && !window.isDestroyed()
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options);
  }

  function registerEvents() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on("checking-for-update", () => {
      publish({ status: "checking", message: "正在检查更新" });
    });
    autoUpdater.on("update-available", (info) => {
      publish({
        status: "available",
        availableVersion: info.version,
        percent: 0,
        message: `发现 ${info.version}，正在后台下载`,
      });
    });
    autoUpdater.on("update-not-available", () => {
      publish({
        status: "up-to-date",
        availableVersion: null,
        percent: 0,
        message: "当前已是最新版本",
      });
      if (manualCheck) {
        void showMessage({
          type: "info",
          title: "VoiceBridge 更新",
          message: "当前已是最新版本",
          detail: `已安装版本：${app.getVersion()}`,
          buttons: ["确定"],
        });
      }
      manualCheck = false;
    });
    autoUpdater.on("download-progress", (progress) => {
      const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
      publish({
        status: "downloading",
        percent,
        message: `正在下载更新 ${percent}%`,
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      publish({
        status: "downloaded",
        availableVersion: info.version,
        percent: 100,
        message: `${info.version} 已下载，等待安装`,
      });
      manualCheck = false;
      void showMessage({
        type: "info",
        title: "VoiceBridge 更新已就绪",
        message: `VoiceBridge Studio ${info.version} 已下载`,
        detail: "现在重启即可安装；选择稍后后，新版本会在退出应用时安装。",
        buttons: ["立即重启安装", "稍后"],
        defaultId: 0,
        cancelId: 1,
      }).then(({ response }) => {
        if (response !== 0 || installing) return;
        installing = true;
        autoUpdater.quitAndInstall(false, true);
      });
    });
    autoUpdater.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      publish({
        status: "error",
        message: "更新检查失败，稍后会自动重试",
      });
      if (manualCheck) {
        void showMessage({
          type: "error",
          title: "VoiceBridge 更新失败",
          message: "暂时无法检查或下载更新",
          detail: message,
          buttons: ["确定"],
        });
      }
      manualCheck = false;
    });
  }

  async function check({ manual = false } = {}) {
    if (!app.isPackaged || platform !== "win32") {
      return publish({
        status: "unsupported",
        message: "自动更新仅在已安装的 Windows 版本中启用",
      });
    }
    if (state.status === "checking" || state.status === "downloading") return state;
    manualCheck = manual;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      autoUpdater.emit("error", error);
    }
    return state;
  }

  function start() {
    if (started) return;
    started = true;
    registerEvents();
    if (!app.isPackaged || platform !== "win32") {
      publish({
        status: "unsupported",
        message: "开发环境不执行自动更新",
      });
      return;
    }
    const startupTimer = setTimer(() => void check(), startupDelayMs);
    if (startupTimer && typeof startupTimer.unref === "function") startupTimer.unref();
    const interval = setRepeatingTimer(() => void check(), checkIntervalMs);
    if (interval && typeof interval.unref === "function") interval.unref();
  }

  return {
    start,
    check,
    getState: () => state,
  };
}

module.exports = {
  CHECK_INTERVAL_MS,
  STARTUP_DELAY_MS,
  createUpdateController,
};
