export interface ModelReadiness {
  id: string;
  name: string;
  repo_id: string | null;
  role: string;
  required: boolean;
  downloadable: boolean;
  estimated_size_bytes: number;
  local_path: string | null;
  configured: boolean;
  state: "not_installed" | "queued" | "downloading" | "paused" | "installed" | "failed";
  downloaded_bytes: number;
  progress: number;
  error: string | null;
  path_source: "managed" | "imported" | "environment" | "configuration" | null;
  auth_required: boolean;
  source_label: string;
}

export interface ReadinessResponse {
  download_allowed: boolean;
  required_ready: boolean;
  models: ModelReadiness[];
}

export interface LocalSettings {
  data_dir: string;
  models_dir: string;
  cache_dir: string;
  translation_api_base: string;
  translation_api_key: string;
  seamless_api_base: string;
  seamless_api_key: string;
  model_paths: Record<string, string>;
}

export interface ExpressiveStatus {
  mode: "expressive_fast";
  checkpoint_ready: boolean;
  checkpoint_path: string | null;
  sidecar_configured: boolean;
  sidecar_online: boolean;
  sidecar_runtime: {
    status: string;
    model_ready: boolean;
    cuda_ready: boolean;
    gpu_name: string | null;
    target_languages: string[];
  } | null;
  error: string | null;
  ready: boolean;
  background_policy: "voice_output_only";
}

export interface ExpressiveJob {
  id: string;
  source_path: string;
  source_name: string;
  target_language: "eng";
  state: "queued" | "processing" | "completed" | "failed";
  progress: number;
  output_path: string | null;
  translated_text: string | null;
  error: string | null;
  background_preserved: false;
}

export interface DesktopMediaFile {
  path: string;
  name: string;
  size: number;
  extension: string;
}

export interface LocalGpuStatus {
  supported: boolean;
  nvidia_ready: boolean;
  gpu_name: string | null;
  driver_version?: string | null;
  compute_capability?: string | null;
  wsl_ready: boolean;
  docker_ready: boolean;
  image_ready: boolean;
  container_state: string;
  service_online: boolean;
  model_ready: boolean;
  cuda_ready: boolean;
  runtime_compatible?: boolean;
  torch_version?: string | null;
  cuda_runtime?: string | null;
  cuda_error?: string | null;
  detail: string;
}

export interface LocalGpuStartResult {
  ok: boolean;
  service_base: string;
  gpu_name: string | null;
}

export interface RuntimeStatus {
  platform: string;
  architecture: string;
  packaged_backend: boolean;
  python_bundled: boolean;
  ffmpeg_ready: boolean;
  ffmpeg_path: string | null;
  nvidia_driver_ready: boolean;
  gpu_name: string | null;
  compute_mode: "cuda_candidate" | "cpu";
  base_runtime_ready: boolean;
}

export interface DesktopUpdateStatus {
  status:
    | "starting"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "up-to-date"
    | "error"
    | "unsupported";
  currentVersion: string;
  availableVersion: string | null;
  percent: number;
  message: string;
}

export type CleanupVariant = "auto" | "cuda11.8" | "cuda12.6" | "cuda12.8";
export type CleanupKind = "subtitle" | "watermark" | "all_text";
export type CleanupLanguage = "auto" | "zh" | "en";
export type CleanupRegionMode = "auto" | "manual";

export interface CleanupRuntime {
  state: "not_prepared" | "preparing" | "ready" | "failed" | "cancelled";
  variant: Exclude<CleanupVariant, "auto">;
  image: string;
  estimated_size_bytes: number;
  downloaded_bytes: number;
  progress: number;
  docker_ready: boolean;
  gpu_name: string | null;
  error: string | null;
  log_path: string | null;
}

export interface VideoInspection {
  id: string;
  source_path: string;
  source_name: string;
  width: number;
  height: number;
  duration_seconds: number;
  size_bytes: number;
  preview_url: string;
}

export interface CleanupRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CleanupJob {
  id: string;
  inspection_id: string;
  source_path: string;
  source_name: string;
  cleanup_kind: CleanupKind;
  language: CleanupLanguage;
  region_mode: CleanupRegionMode;
  state: "queued" | "processing" | "remuxing" | "completed" | "failed" | "cancelled";
  progress: number;
  output_path: string | null;
  error: string | null;
  container_name: string | null;
}

declare global {
  interface Window {
    voiceBridge?: {
      apiBase: string;
      platform: string;
      chooseDirectory: () => Promise<string | null>;
      chooseMediaFile: () => Promise<DesktopMediaFile | null>;
      chooseVideoFile: () => Promise<DesktopMediaFile | null>;
      openPath: (path: string) => Promise<string>;
      openDocumentation: () => Promise<string>;
      localGpuStatus: () => Promise<LocalGpuStatus>;
      installPrerequisite: (
        kind: "wsl" | "docker",
      ) => Promise<{ launched: boolean; kind: string }>;
      startLocalGpu: (modelPath: string) => Promise<LocalGpuStartResult>;
      stopLocalGpu: () => Promise<{ ok: boolean }>;
      getUpdateStatus: () => Promise<DesktopUpdateStatus>;
      checkForUpdates: () => Promise<DesktopUpdateStatus>;
      onUpdateStatus: (
        listener: (status: DesktopUpdateStatus) => void,
      ) => () => void;
    };
  }
}

const apiBase = window.voiceBridge?.apiBase ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, init);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status}:${detail}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchReadiness(signal?: AbortSignal): Promise<ReadinessResponse> {
  return request<ReadinessResponse>("/api/v1/models/readiness", { signal });
}

export async function fetchSettings(signal?: AbortSignal): Promise<LocalSettings> {
  return request<LocalSettings>("/api/v1/settings", { signal });
}

export async function fetchRuntimeStatus(signal?: AbortSignal): Promise<RuntimeStatus> {
  return request<RuntimeStatus>("/api/v1/runtime", { signal });
}

export async function updateSettings(
  changes: Partial<LocalSettings>,
): Promise<LocalSettings> {
  return request<LocalSettings>("/api/v1/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

export async function startModelDownload(
  modelId: string,
  token?: string,
): Promise<ModelReadiness> {
  return request<ModelReadiness>(`/api/v1/models/${modelId}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(token ? { token } : {}),
  });
}

export async function fetchExpressiveStatus(
  signal?: AbortSignal,
): Promise<ExpressiveStatus> {
  return request<ExpressiveStatus>("/api/v1/expressive/status", { signal });
}

export async function createExpressiveJob(
  sourcePath: string,
): Promise<ExpressiveJob> {
  return request<ExpressiveJob>("/api/v1/expressive/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: sourcePath, target_language: "eng" }),
  });
}

export async function fetchExpressiveJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<ExpressiveJob> {
  return request<ExpressiveJob>(`/api/v1/expressive/jobs/${jobId}`, { signal });
}

export async function fetchCleanupRuntime(
  variant: CleanupVariant = "auto",
  signal?: AbortSignal,
): Promise<CleanupRuntime> {
  return request<CleanupRuntime>(
    `/api/v1/video-cleanup/runtime?variant=${encodeURIComponent(variant)}`,
    { signal },
  );
}

export async function prepareCleanupRuntime(
  variant: CleanupVariant = "auto",
): Promise<CleanupRuntime> {
  return request<CleanupRuntime>("/api/v1/video-cleanup/runtime/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variant }),
  });
}

export async function cancelCleanupRuntime(): Promise<CleanupRuntime> {
  return request<CleanupRuntime>("/api/v1/video-cleanup/runtime/cancel", {
    method: "POST",
  });
}

export async function inspectCleanupVideo(
  sourcePath: string,
): Promise<VideoInspection> {
  return request<VideoInspection>("/api/v1/video-cleanup/inspect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: sourcePath }),
  });
}

export function cleanupPreviewUrl(inspection: VideoInspection): string {
  return `${apiBase}${inspection.preview_url}`;
}

export async function createCleanupJob(input: {
  inspection_id: string;
  cleanup_kind: CleanupKind;
  language: CleanupLanguage;
  region_mode: CleanupRegionMode;
  regions: CleanupRegion[];
  variant: CleanupVariant;
}): Promise<CleanupJob> {
  return request<CleanupJob>("/api/v1/video-cleanup/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function fetchCleanupJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<CleanupJob> {
  return request<CleanupJob>(`/api/v1/video-cleanup/jobs/${jobId}`, { signal });
}

export async function cancelCleanupJob(jobId: string): Promise<CleanupJob> {
  return request<CleanupJob>(`/api/v1/video-cleanup/jobs/${jobId}/cancel`, {
    method: "POST",
  });
}

export async function pauseModelDownload(modelId: string): Promise<ModelReadiness> {
  return request<ModelReadiness>(`/api/v1/models/${modelId}/pause`, {
    method: "POST",
  });
}

export async function importModelDirectory(
  modelId: string,
  path: string,
): Promise<ModelReadiness> {
  return request<ModelReadiness>(`/api/v1/models/${modelId}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}
