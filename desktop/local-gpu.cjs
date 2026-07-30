const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const IMAGE_NAME = "voicebridge-seamless-sidecar:0.6.0";
const CONTAINER_NAME = "voicebridge-seamless-sidecar";
const SERVICE_BASE = "http://127.0.0.1:8787";
const SIDECAR_TORCH_VERSION = "2.8.0";
const SIDECAR_CUDA_RUNTIME = "12.8";
const REQUIRED_MODEL_FILES = [
  "m2m_expressive_unity.pt",
  "pretssel_melhifigan_wm.pt",
  "pretssel_melhifigan_wm-16khz.pt",
];

function runCommand(executable, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      executable,
      args,
      {
        windowsHide: true,
        timeout: options.timeout ?? 20_000,
        maxBuffer: options.maxBuffer ?? 12 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout = "", stderr = "") => {
        resolve({
          ok: !error,
          code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
          stdout: String(stdout).trim(),
          stderr: String(stderr).trim(),
        });
      },
    );
  });
}

function dockerExecutable(platform = process.platform) {
  if (platform !== "win32") return "docker.exe";
  const programFiles = process.env.ProgramFiles || process.env.PROGRAMFILES;
  const bundledCli = programFiles
    ? path.join(programFiles, "Docker", "Docker", "resources", "bin", "docker.exe")
    : "";
  return bundledCli && fs.existsSync(bundledCli) ? bundledCli : "docker.exe";
}

async function probeLocalGpu(options = {}) {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runCommand;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (platform !== "win32") {
    return {
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
      detail: "local_gpu_windows_only",
    };
  }
  const docker = dockerExecutable(platform);

  const [nvidia, wsl, dockerVersion, image, container] = await Promise.all([
    run("nvidia-smi.exe", [
      "--query-gpu=name,driver_version,compute_cap",
      "--format=csv,noheader",
    ]),
    run("wsl.exe", ["--status"]),
    run(docker, ["version", "--format", "{{.Server.Os}}"]),
    run(docker, ["image", "inspect", IMAGE_NAME, "--format", "{{.Id}}"]),
    run(docker, [
      "inspect",
      CONTAINER_NAME,
      "--format",
      "{{.State.Status}}",
    ]),
  ]);

  let serviceOnline = false;
  let modelReady = false;
  let cudaReady = false;
  let torchVersion = SIDECAR_TORCH_VERSION;
  let cudaRuntime = SIDECAR_CUDA_RUNTIME;
  let cudaError = null;
  if (container.ok && container.stdout === "running") {
    try {
      const response = await fetchImpl(`${SERVICE_BASE}/health`, {
        signal: AbortSignal.timeout(2500),
      });
      if (response.ok) {
        const health = await response.json();
        serviceOnline = true;
        modelReady = Boolean(health.model_ready);
        cudaReady = Boolean(health.cuda_ready);
        torchVersion = health.torch_version ?? torchVersion;
        cudaRuntime = health.cuda_runtime ?? cudaRuntime;
        cudaError = health.cuda_error ?? null;
      }
    } catch {
      serviceOnline = false;
    }
  }

  const dockerReady = dockerVersion.ok
    && dockerVersion.stdout.toLowerCase().includes("linux");
  const gpuFields = nvidia.ok
    ? nvidia.stdout.split(/\r?\n/)[0].split(",").map((value) => value.trim())
    : [];
  const gpuName = gpuFields[0] || null;
  const driverVersion = gpuFields[1] || null;
  const computeCapability = gpuFields[2] || null;
  const blackwell = Boolean(
    gpuName && /\bRTX\s*50\d{2}\b/i.test(gpuName),
  ) || Boolean(
    computeCapability && Number.parseFloat(computeCapability) >= 10,
  );
  const runtimeCompatible = !blackwell
    || Number.parseFloat(cudaRuntime) >= 12.8;
  const detail = !nvidia.ok
    ? "nvidia_driver_required"
    : !wsl.ok
      ? "wsl2_required"
      : !dockerReady
        ? "docker_desktop_required"
        : !runtimeCompatible
          ? "blackwell_runtime_upgrade_required"
          : serviceOnline && modelReady && cudaReady
            ? "ready"
            : container.ok && container.stdout === "exited"
              ? "container_exited"
              : "runtime_stopped";
  return {
    supported: true,
    nvidia_ready: nvidia.ok && Boolean(nvidia.stdout),
    gpu_name: gpuName,
    driver_version: driverVersion,
    compute_capability: computeCapability,
    wsl_ready: wsl.ok,
    docker_ready: dockerReady,
    image_ready: image.ok,
    container_state: container.ok ? container.stdout || "unknown" : "not_created",
    service_online: serviceOnline,
    model_ready: modelReady,
    cuda_ready: cudaReady,
    runtime_compatible: runtimeCompatible,
    torch_version: torchVersion,
    cuda_runtime: cudaRuntime,
    cuda_error: cudaError,
    detail,
  };
}

function validateModelDirectory(modelPath, platform = process.platform) {
  if (typeof modelPath !== "string" || !modelPath.trim()) {
    throw new Error("seamless_model_required");
  }
  const absolute = platform === "win32"
    ? path.win32.isAbsolute(modelPath)
    : path.isAbsolute(modelPath);
  if (!absolute || !fs.statSync(modelPath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("seamless_model_directory_invalid");
  }
  for (const filename of REQUIRED_MODEL_FILES) {
    const checkpoint = path.join(modelPath, filename);
    const stats = fs.statSync(checkpoint, { throwIfNoEntry: false });
    if (!stats?.isFile() || stats.size <= 1_000_000) {
      throw new Error(`seamless_checkpoint_missing:${filename}`);
    }
  }
}

function validateSidecarRoot(sidecarRoot) {
  if (
    typeof sidecarRoot !== "string"
    || !path.isAbsolute(sidecarRoot)
    || !fs.statSync(path.join(sidecarRoot, "Dockerfile"), { throwIfNoEntry: false })?.isFile()
    || !fs.statSync(path.join(sidecarRoot, "app.py"), { throwIfNoEntry: false })?.isFile()
  ) {
    throw new Error("sidecar_resources_missing");
  }
}

async function startLocalGpu(modelPath, sidecarRoot, options = {}) {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runCommand;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const docker = dockerExecutable(platform);
  validateModelDirectory(modelPath, platform);
  validateSidecarRoot(sidecarRoot);

  const nvidia = await run("nvidia-smi.exe", [
    "--query-gpu=name",
    "--format=csv,noheader",
  ]);
  if (!nvidia.ok) throw new Error("nvidia_driver_required");
  const dockerVersion = await run(docker, [
    "version",
    "--format",
    "{{.Server.Os}}",
  ]);
  if (!dockerVersion.ok || !dockerVersion.stdout.toLowerCase().includes("linux")) {
    throw new Error("docker_linux_engine_required");
  }

  const image = await run(docker, [
    "image",
    "inspect",
    IMAGE_NAME,
    "--format",
    "{{.Id}}",
  ]);
  if (!image.ok) {
    const build = await run(
      docker,
      ["build", "--tag", IMAGE_NAME, sidecarRoot],
      { timeout: 45 * 60_000, maxBuffer: 24 * 1024 * 1024 },
    );
    if (!build.ok) {
      throw new Error(`sidecar_image_build_failed:${build.stderr.slice(-500)}`);
    }
  }

  const existing = await run(docker, [
    "inspect",
    CONTAINER_NAME,
    "--format",
    "{{.Id}}",
  ]);
  if (existing.ok) {
    await run(docker, ["rm", "--force", CONTAINER_NAME]);
  }
  const launched = await run(
    docker,
    [
      "run",
      "--detach",
      "--name",
      CONTAINER_NAME,
      "--restart",
      "unless-stopped",
      "--gpus",
      "all",
      "--publish",
      "127.0.0.1:8787:8787",
      "--volume",
      `${modelPath}:/models/SeamlessExpressive:ro`,
      IMAGE_NAME,
    ],
    { timeout: 120_000 },
  );
  if (!launched.ok) {
    throw new Error(`sidecar_start_failed:${launched.stderr.slice(-500)}`);
  }

  const attempts = options.healthAttempts ?? 30;
  const delay = options.healthDelay ?? 1000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${SERVICE_BASE}/health`, {
        signal: AbortSignal.timeout(2500),
      });
      if (response.ok) {
        const health = await response.json();
        if (health.model_ready && health.cuda_ready) {
          return {
            ok: true,
            service_base: SERVICE_BASE,
            gpu_name: health.gpu_name ?? nvidia.stdout.split(/\r?\n/)[0],
          };
        }
      }
    } catch {
      // The container may still be starting.
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("sidecar_health_not_ready");
}

async function stopLocalGpu(options = {}) {
  const run = options.run ?? runCommand;
  const platform = options.platform ?? process.platform;
  const stopped = await run(
    dockerExecutable(platform),
    ["stop", CONTAINER_NAME],
    {
    timeout: 120_000,
    },
  );
  if (!stopped.ok && !stopped.stderr.includes("No such container")) {
    throw new Error(`sidecar_stop_failed:${stopped.stderr.slice(-300)}`);
  }
  return { ok: true };
}

const prerequisiteCommands = {
  wsl: [
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Start-Process -FilePath 'wsl.exe' -ArgumentList @('--install','--no-distribution') -Verb RunAs",
    ],
  ],
  docker: [
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Start-Process -FilePath 'winget.exe' -ArgumentList @('install','--exact','--id','Docker.DockerDesktop','--accept-package-agreements','--accept-source-agreements') -Verb RunAs",
    ],
  ],
};

module.exports = {
  CONTAINER_NAME,
  IMAGE_NAME,
  REQUIRED_MODEL_FILES,
  SERVICE_BASE,
  SIDECAR_CUDA_RUNTIME,
  SIDECAR_TORCH_VERSION,
  prerequisiteCommands,
  dockerExecutable,
  probeLocalGpu,
  runCommand,
  startLocalGpu,
  stopLocalGpu,
  validateModelDirectory,
};
