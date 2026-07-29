import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const UploadIcon = (p: IconProps) => <svg {...base} {...p}><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 14v5h14v-5"/></svg>;
export const PlayIcon = (p: IconProps) => <svg {...base} {...p}><path d="m8 5 11 7-11 7V5Z" /></svg>;
export const PauseIcon = (p: IconProps) => <svg {...base} {...p}><path d="M9 5v14M15 5v14" /></svg>;
export const CheckIcon = (p: IconProps) => <svg {...base} {...p}><path d="m5 12 4 4L19 6" /></svg>;
export const AlertIcon = (p: IconProps) => <svg {...base} {...p}><path d="M12 9v4m0 4h.01"/><path d="M10.3 3.8 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/></svg>;
export const SettingsIcon = (p: IconProps) => <svg {...base} {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>;
export const FileIcon = (p: IconProps) => <svg {...base} {...p}><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h6"/></svg>;
export const ChevronIcon = (p: IconProps) => <svg {...base} {...p}><path d="m9 18 6-6-6-6"/></svg>;
export const LockIcon = (p: IconProps) => <svg {...base} {...p}><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>;
export const RefreshIcon = (p: IconProps) => <svg {...base} {...p}><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9A7 7 0 0 1 18 6.4L20 12M4 12l2 5.6A7 7 0 0 0 17.9 15"/></svg>;
export const DownloadIcon = (p: IconProps) => <svg {...base} {...p}><path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M5 20h14"/></svg>;
export const MediaIcon = (p: IconProps) => <svg {...base} {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3V9Z"/></svg>;
export const FolderIcon = (p: IconProps) => <svg {...base} {...p}><path d="M3 6h7l2 2h9v11H3z"/><path d="M3 10h18"/></svg>;
