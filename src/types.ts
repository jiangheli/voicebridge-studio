export type SegmentStatus = "approved" | "review" | "processing";
export type Route = "CosyVoice 3" | "Qwen3-TTS";

export interface Segment {
  id: string;
  speaker: string;
  speakerColor: string;
  start: string;
  end: string;
  duration: number;
  source: string;
  target: string;
  route: Route;
  status: SegmentStatus;
  semantic: number;
  voice: number;
  timing: number;
  issue?: string;
}

export interface JobFile {
  name: string;
  size: number;
  type: string;
  url?: string;
}

export interface StoredJob {
  id: string;
  name: string;
  createdAt: string;
  mediaType: string;
  size: number;
  status: "processing" | "review" | "completed";
  progress: number;
  segments: Segment[];
}
