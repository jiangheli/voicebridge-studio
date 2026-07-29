const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const API_PORT = 8765;
const API_BASE = `http://127.0.0.1:${API_PORT}`;
let backendProcess = null;
let mainWindow = null;

function localDataRoot() {
  if (process.env.VOICEBRIDGE_DATA_DIR) return process.env.VOICEBRIDGE_DATA_DIR;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "VoiceBridge");
  }
  return app.getPath("userData");
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

app.whenReady().then(() => {
  if (hasSingleInstanceLock) return createWindow();
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
