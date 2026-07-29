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
  model_paths: Record<string, string>;
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

declare global {
  interface Window {
    voiceBridge?: {
      apiBase: string;
      platform: string;
      chooseDirectory: () => Promise<string | null>;
      openPath: (path: string) => Promise<string>;
      openDocumentation: () => Promise<string>;
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

export async function startModelDownload(modelId: string): Promise<ModelReadiness> {
  return request<ModelReadiness>(`/api/v1/models/${modelId}/download`, {
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
