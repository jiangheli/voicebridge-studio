const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voiceBridge", {
  apiBase: "http://127.0.0.1:8765",
  platform: process.platform,
  chooseDirectory: () => ipcRenderer.invoke("voicebridge:choose-directory"),
  openPath: (targetPath) => ipcRenderer.invoke("voicebridge:open-path", targetPath),
  openDocumentation: () => ipcRenderer.invoke("voicebridge:open-documentation"),
});
