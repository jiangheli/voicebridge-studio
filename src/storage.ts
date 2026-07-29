import type { Route, Segment, StoredJob } from "./types";

const STORAGE_KEY = "voicebridge.jobs.v1";

function migrateRoute(route: unknown): Route {
  if (route === "Qwen3-TTS" || route === "Fallback TTS") return "Qwen3-TTS";
  return "CosyVoice 3";
}

function migrateSegment(segment: Segment): Segment {
  return {
    ...segment,
    route: migrateRoute(segment.route),
  };
}

function migrateJob(job: StoredJob): StoredJob {
  return {
    ...job,
    segments: Array.isArray(job.segments) ? job.segments.map(migrateSegment) : [],
  };
}

export function loadJobs(): StoredJob[] {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    const jobs = value ? JSON.parse(value) as StoredJob[] : [];
    return Array.isArray(jobs) ? jobs.map(migrateJob) : [];
  } catch {
    return [];
  }
}

export function saveJobs(jobs: StoredJob[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // The workspace remains usable when storage is blocked or full.
  }
}

export function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  downloadBlob(filename, blob);
}

export function downloadText(filename: string, value: string, type: string) {
  const blob = new Blob([value], { type });
  downloadBlob(filename, blob);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
