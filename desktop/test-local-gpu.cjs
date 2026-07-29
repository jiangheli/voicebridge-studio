const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  IMAGE_NAME,
  REQUIRED_MODEL_FILES,
  prerequisiteCommands,
  probeLocalGpu,
  startLocalGpu,
} = require("./local-gpu.cjs");

test("non-Windows status is explicitly unsupported", async () => {
  const status = await probeLocalGpu({ platform: "darwin" });
  assert.equal(status.supported, false);
  assert.equal(status.detail, "local_gpu_windows_only");
});

test("system prerequisite commands are fixed and elevated", () => {
  assert.deepEqual(Object.keys(prerequisiteCommands), ["wsl", "docker"]);
  for (const [executable, args] of Object.values(prerequisiteCommands)) {
    assert.equal(executable, "powershell.exe");
    assert.equal(args.includes("-NoProfile"), true);
    assert.equal(args.at(-1).includes("-Verb RunAs"), true);
  }
});

test("Windows status reports a ready local GPU service", async () => {
  const run = async (executable, args) => {
    const command = [executable, ...args].join(" ");
    if (command.startsWith("nvidia-smi.exe")) {
      return { ok: true, stdout: "NVIDIA RTX 4090", stderr: "" };
    }
    if (command.startsWith("wsl.exe")) {
      return { ok: true, stdout: "2", stderr: "" };
    }
    if (command.includes("docker.exe version")) {
      return { ok: true, stdout: "linux", stderr: "" };
    }
    if (command.includes("image inspect")) {
      return { ok: true, stdout: "sha256:image", stderr: "" };
    }
    return { ok: true, stdout: "running", stderr: "" };
  };
  const status = await probeLocalGpu({
    platform: "win32",
    run,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ model_ready: true, cuda_ready: true }),
    }),
  });
  assert.equal(status.detail, "ready");
  assert.equal(status.gpu_name, "NVIDIA RTX 4090");
  assert.equal(status.service_online, true);
});

test("start uses argument arrays and read-only model mount", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "voicebridge-local-gpu-"));
  const model = path.join(root, "SeamlessExpressive");
  const sidecar = path.join(root, "sidecar");
  fs.mkdirSync(model);
  fs.mkdirSync(sidecar);
  fs.writeFileSync(path.join(sidecar, "Dockerfile"), "FROM scratch\n");
  fs.writeFileSync(path.join(sidecar, "app.py"), "# sidecar\n");
  for (const filename of REQUIRED_MODEL_FILES) {
    fs.writeFileSync(path.join(model, filename), Buffer.alloc(1_000_001));
  }

  const calls = [];
  const run = async (executable, args) => {
    calls.push({ executable, args });
    if (args[0] === "image") return { ok: false, stdout: "", stderr: "missing" };
    if (args[0] === "inspect") return { ok: false, stdout: "", stderr: "missing" };
    if (args[0] === "version") return { ok: true, stdout: "linux", stderr: "" };
    return { ok: true, stdout: "ok", stderr: "" };
  };
  const result = await startLocalGpu(model, sidecar, {
    platform: process.platform,
    run,
    healthAttempts: 1,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        model_ready: true,
        cuda_ready: true,
        gpu_name: "NVIDIA RTX 4090",
      }),
    }),
  });

  assert.equal(result.ok, true);
  const build = calls.find((call) => call.args[0] === "build");
  assert.deepEqual(build.args, ["build", "--tag", IMAGE_NAME, sidecar]);
  const launch = calls.find((call) => call.args[0] === "run");
  assert.ok(launch);
  assert.equal(launch.args.includes("--gpus"), true);
  assert.equal(
    launch.args.includes(`${model}:/models/SeamlessExpressive:ro`),
    true,
  );
  assert.equal(launch.args.includes(";"), false);
  fs.rmSync(root, { recursive: true, force: true });
});
