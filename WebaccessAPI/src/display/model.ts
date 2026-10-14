import type { ActiveAlarm, AlarmMarker, DisplayState, FloorPlan } from '../../shared/contracts';

export interface DisplayViewModel {
  page: FloorPlan | null;
  alarms: ActiveAlarm[];
  markers: AlarmMarker[];
  statusText: string;
}

export function getDisplayViewModel(state: DisplayState | null): DisplayViewModel {
  if (state === null) {
    return { page: null, alarms: [], markers: [], statusText: '正在連線至警報系統…' };
  }

  const selectedPage: FloorPlan | null = state.settings.pages.find(
    (page: FloorPlan): boolean => page.id === state.selectedPageId,
  ) ?? null;

  const pageMarkers: AlarmMarker[] = selectedPage === null
    ? []
    : state.settings.markers.filter((marker: AlarmMarker): boolean => marker.pageId === selectedPage.id);
  const candidates: Array<{ alarm: ActiveAlarm; marker: AlarmMarker }> = [];
  for (const marker of pageMarkers) {
    for (const alarm of state.alarms) {
      if (alarm.name === marker.name) {
        candidates.push({ alarm, marker });
      }
    }
  }
  candidates.sort((first: { alarm: ActiveAlarm; marker: AlarmMarker }, second: { alarm: ActiveAlarm; marker: AlarmMarker }): number => {
    const firstTime: number = Number.isFinite(first.alarm.occurredAt) ? first.alarm.occurredAt : Number.NEGATIVE_INFINITY;
    const secondTime: number = Number.isFinite(second.alarm.occurredAt) ? second.alarm.occurredAt : Number.NEGATIVE_INFINITY;
    if (firstTime !== secondTime) {
      return firstTime > secondTime ? -1 : 1;
    }
    if (first.alarm.name !== second.alarm.name) {
      return first.alarm.name < second.alarm.name ? -1 : 1;
    }
    if (first.marker.id === second.marker.id) {
      return 0;
    }
    return first.marker.id < second.marker.id ? -1 : 1;
  });

  const selectedCandidate: { alarm: ActiveAlarm; marker: AlarmMarker } | undefined = candidates[0];
  const pageAlarms: ActiveAlarm[] = selectedCandidate === undefined ? [] : [selectedCandidate.alarm];

  return {
    page: selectedPage,
    alarms: pageAlarms,
    markers: selectedCandidate === undefined ? [] : [selectedCandidate.marker],
    statusText: state.isMonitoring === false
      ? '警報監控已停止'
      : state.connectionStatus === 'disconnected'
      ? state.lastSuccessAt === null
        ? '資料連線中斷，尚未取得資料'
        : `資料連線中斷 · 最後更新 ${state.lastSuccessAt}`
      : state.connectionStatus === 'connecting'
        ? '正在連線至警報系統…'
        : '資料連線正常',
  };
}

export function getAlarmText(marker: AlarmMarker, alarm: ActiveAlarm | undefined): string {
  const customText: string = marker.text.trim();
  if (customText.length > 0) {
    return customText;
  }

  const description: string = alarm?.description.trim() ?? '';
  return description.length > 0 ? description : marker.name;
}

export function getMarkerPosition(marker: AlarmMarker): { left: string; top: string; size: string } {
  const x: number = Number.isFinite(marker.x) ? Math.min(100, Math.max(0, marker.x)) : 50;
  const y: number = Number.isFinite(marker.y) ? Math.min(100, Math.max(0, marker.y)) : 50;
  const size: number = Number.isFinite(marker.size) ? Math.min(160, Math.max(20, marker.size)) : 48;
  return { left: `${x}%`, top: `${y}%`, size: `${size}px` };
}
