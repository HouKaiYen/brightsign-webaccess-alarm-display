export interface FloorPlan {
  id: string;
  name: string;
  imageUrl: string;
}

export type IconKind = 'sos' | 'warning' | 'circle' | 'push-button' | 'custom';

export interface AlarmMarker {
  id: string;
  name: string;
  pageId: string;
  text: string;
  // 相對於平面圖實際圖片範圍的百分比，範圍為 0–100。
  x: number;
  y: number;
  // 圖示寬高使用像素，設定範圍為 20–160。
  size: number;
  color: string;
  shouldBlink: boolean;
  shouldShowExitIcon?: boolean;
  iconKind: IconKind;
  iconUrl: string;
}

export interface AlarmSettings {
  version: number;
  pages: FloorPlan[];
  markers: AlarmMarker[];
  idleImageUrl: string;
  floorPlanImages?: FloorPlan[];
  idle?: IdleSettings;
}

export type IdleMediaKind = 'image' | 'gif' | 'video' | 'pdf';

export interface IdleMedia {
  id: string;
  name: string;
  kind: IdleMediaKind;
  url: string;
  pageUrls?: string[];
  durationSeconds: number;
}

export type MarqueeSpeed = 'very-slow' | 'slow' | 'relaxed' | 'normal' | 'brisk' | 'fast' | 'very-fast' | 'extreme';
export const MarqueeSpeedOptions: ReadonlyArray<{ value: MarqueeSpeed; label: string; seconds: number }> = [
  { value: 'very-slow', label: '1 · 極慢', seconds: 60 },
  { value: 'slow', label: '2 · 慢速', seconds: 36 },
  { value: 'relaxed', label: '3 · 稍慢', seconds: 30 },
  { value: 'normal', label: '4 · 一般', seconds: 24 },
  { value: 'brisk', label: '5 · 稍快', seconds: 18 },
  { value: 'fast', label: '6 · 快速', seconds: 14 },
  { value: 'very-fast', label: '7 · 很快', seconds: 8 },
  { value: 'extreme', label: '8 · 極快', seconds: 4 },
];

export interface IdleMarquee {
  isEnabled: boolean;
  text: string;
  speed: MarqueeSpeed;
  position?: 'top' | 'bottom';
}

export interface IdleSettings {
  items: IdleMedia[];
  isMuted: boolean;
  marquee: IdleMarquee;
}

export interface VersionedIdleSettings extends IdleSettings {
  version: number;
}

export const DefaultIdleSettings: IdleSettings = {
  items: [],
  isMuted: true,
  marquee: { isEnabled: false, text: '', speed: 'normal', position: 'bottom' },
};

export interface ActiveAlarm {
  name: string;
  description: string;
  time: string;
  occurredAt: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface DisplayState {
  settings: AlarmSettings;
  alarms: ActiveAlarm[];
  selectedPageId: string | null;
  connectionStatus: ConnectionStatus;
  lastSuccessAt: string | null;
  isMonitoring?: boolean;
}

export interface TagOption {
  name: string;
  description: string;
}

export interface UploadResult {
  imageUrl: string;
}

export interface ApiError {
  error: string;
}

export interface ConnectionSettings {
  version: number;
  apiBase: string;
  project: string;
  username: string;
  hasPassword: boolean;
  passwordNeedsReset?: boolean;
}

export interface SaveConnectionSettingsRequest {
  version: number;
  apiBase: string;
  project: string;
  username: string;
  password?: string;
}

export const EmptySettings: AlarmSettings = {
  version: 1,
  pages: [],
  markers: [],
  idleImageUrl: '',
};
