const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  prerequisiteCommands,
  probeLocalGpu,
  startLocalGpu,
  stopLocalGpu,
} = require("./local-gpu.cjs");
const { createUpdateController } = require("./updater.cjs");

const API_PORT = 8765;
const API_BASE = `http://127.0.0.1:${API_PORT}`;
let backendProcess = null;
let mainWindow = null;
let updateController = null;

function localDataRoot() {
  if (process.env.VOICEBRIDGE_DATA_DIR) return process.env.VOICEBRIDGE_DATA_DIR;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "VoiceBridge");
  }
  return app.getPath("userData");
}

function sidecarResourcesRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "sidecar")
    : path.resolve(__dirname, "..", "services", "seamless-sidecar");
}

function launchPrerequisite(kind) {
  const command = prerequisiteCommands[kind];
  if (process.platform !== "win32" || !command) {
    throw new Error("windows_prerequisite_only");
  }
  const child = spawn(command[0], command[1], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  child.unref();
  return { launched: true, kind };
}

async function apiIsReady() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/health`, {
      signal: AbortSignal.timeout(800),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function backendCommand() {
  if (app.isPackaged) {
    return {
      executable: path.join(process.resourcesPath, "backend", "voicebridge-api.exe"),
      args: [],
    };
  }
  return {
    executable: process.env.VOICEBRIDGE_PYTHON || (process.platform === "win32" ? "python" : "python3"),
    args: ["-m", "server"],
  };
}

async function ensureBackend() {
  if (await apiIsReady()) return;
  const command = backendCommand();
  const dataRoot = localDataRoot();
  const logDir = path.join(dataRoot, "logs");
  const ffmpegPath = app.isPackaged
    ? path.join(process.resourcesPath, "runtime", "ffmpeg.exe")
    : (process.env.VOICEBRIDGE_FFMPEG_PATH || "");
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, "api.log"), "a");
  backendProcess = spawn(command.executable, command.args, {
    cwd: app.isPackaged ? process.resourcesPath : path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      VOICEBRIDGE_API_PORT: String(API_PORT),
      VOICEBRIDGE_DATA_DIR: dataRoot,
      VOICEBRIDGE_FFMPEG_PATH: ffmpegPath,
    },
    detached: false,
    windowsHide: true,
    stdio: ["ignore", log, log],
  });

  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (await apiIsReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local API did not start. See ${path.join(logDir, "api.log")}`);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

async function createWindow() {
  await ensureBackend();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 930,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#0a0c0d",
    title: "VoiceBridge Studio",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = app.isPackaged
      ? url.startsWith("file://")
      : url.startsWith("http://127.0.0.1:4173");
    if (!allowed) {
      event.preventDefault();
      if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    }
  });

  if (!app.isPackaged) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:4173");
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("voicebridge:choose-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("voicebridge:choose-media-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      {
        name: "音频与视频",
        extensions: ["wav", "mp3", "m4a", "flac", "mp4", "mov", "mkv"],
      },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const selected = result.filePaths[0];
  const stats = fs.statSync(selected);
  return {
    path: selected,
    name: path.basename(selected),
    size: stats.size,
    extension: path.extname(selected).toLowerCase(),
  };
});

ipcMain.handle("voicebridge:choose-video-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      {
        name: "视频",
        extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"],
      },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const selected = result.filePaths[0];
  const stats = fs.statSync(selected);
  return {
    path: selected,
    name: path.basename(selected),
    size: stats.size,
    extension: path.extname(selected).toLowerCase(),
  };
});

ipcMain.handle("voicebridge:open-path", async (_event, targetPath) => {
  if (typeof targetPath !== "string" || !path.isAbsolute(targetPath)) {
    return "invalid_path";
  }
  return shell.openPath(targetPath);
});

ipcMain.handle("voicebridge:open-documentation", async () => {
  const docsRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return shell.openPath(path.join(docsRoot, "docs", "DEVELOPMENT.md"));
});

ipcMain.handle("voicebridge:local-gpu-status", async () => probeLocalGpu());

ipcMain.handle("voicebridge:install-prerequisite", async (_event, kind) => {
  if (kind !== "wsl" && kind !== "docker") {
    throw new Error("invalid_prerequisite");
  }
  return launchPrerequisite(kind);
});

ipcMain.handle("voicebridge:start-local-gpu", async (_event, payload) => {
  if (!payload || typeof payload.modelPath !== "string") {
    throw new Error("invalid_local_gpu_request");
  }
  return startLocalGpu(payload.modelPath, sidecarResourcesRoot());
});

ipcMain.handle("voicebridge:stop-local-gpu", async () => stopLocalGpu());

ipcMain.handle("voicebridge:get-update-status", async () => (
  updateController
    ? updateController.getState()
    : {
        status: "starting",
        currentVersion: app.getVersion(),
        availableVersion: null,
        percent: 0,
        message: "更新服务正在启动",
      }
));

ipcMain.handle("voicebridge:check-for-updates", async () => {
  if (!updateController) throw new Error("update_service_not_ready");
  return updateController.check({ manual: true });
});

app.whenReady().then(async () => {
  if (hasSingleInstanceLock) {
    await createWindow();
    updateController = createUpdateController({
      app,
      autoUpdater,
      dialog,
      getMainWindow: () => mainWindow,
    });
    updateController.start();
    return;
  }
  return undefined;
}).catch((error) => {
  dialog.showErrorBox("VoiceBridge 启动失败", error instanceof Error ? error.message : String(error));
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("before-quit", () => {
  if (backendProcess && backendProcess.exitCode === null) {
    backendProcess.kill();
  }
});
