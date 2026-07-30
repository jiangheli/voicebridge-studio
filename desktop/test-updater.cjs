const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createUpdateController } = require("./updater.cjs");

function fixture({ packaged = true, platform = "win32" } = {}) {
  const autoUpdater = new EventEmitter();
  autoUpdater.checkForUpdates = async () => {
    autoUpdater.emit("checking-for-update");
  };
  autoUpdater.quitAndInstall = () => {};
  const sent = [];
  const window = {
    isDestroyed: () => false,
    webContents: { send: (_channel, state) => sent.push(state) },
  };
  const dialogs = [];
  const controller = createUpdateController({
    app: { isPackaged: packaged, getVersion: () => "0.5.0" },
    autoUpdater,
    dialog: {
      showMessageBox: async (...args) => {
        dialogs.push(args.at(-1));
        return { response: 1 };
      },
    },
    getMainWindow: () => window,
    platform,
    setTimer: () => ({ unref() {} }),
    setRepeatingTimer: () => ({ unref() {} }),
  });
  return { autoUpdater, controller, dialogs, sent };
}

test("automatic updater stays disabled outside packaged Windows", async () => {
  const { controller } = fixture({ packaged: false });
  controller.start();
  const state = await controller.check();
  assert.equal(state.status, "unsupported");
});

test("update lifecycle publishes download progress", async () => {
  const { autoUpdater, controller, sent } = fixture();
  controller.start();
  await controller.check();
  autoUpdater.emit("update-available", { version: "0.6.0" });
  autoUpdater.emit("download-progress", { percent: 42.4 });
  assert.equal(sent.at(-1).status, "downloading");
  assert.equal(sent.at(-1).percent, 42);
  assert.equal(sent.at(-1).availableVersion, "0.6.0");
});

test("downloaded update prompts before restart", async () => {
  const { autoUpdater, controller, dialogs } = fixture();
  controller.start();
  autoUpdater.emit("update-downloaded", { version: "0.6.0" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getState().status, "downloaded");
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0].message, /0.6.0/);
});
