import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActiveAlarm, AlarmMarker, DisplayState } from '../shared/contracts';
import { getAlarmText, getDisplayViewModel, getMarkerPosition } from '../src/display/model';

const alarm = (name: string, occurredAt: number, description: string = ''): ActiveAlarm => ({
  name,
  description,
  time: '',
  occurredAt,
});

const marker = (name: string, id: string, text: string = ''): AlarmMarker => ({
  id,
  name,
  pageId: 'first',
  text,
  x: 25,
  y: 75,
  size: 48,
  color: '#ff0000',
  shouldBlink: true,
  iconKind: 'custom',
  iconUrl: '/uploads/sos.png',
});

const baseState: DisplayState = {
  settings: {
    version: 1,
    pages: [
      { id: 'first', name: '一樓', imageUrl: '/uploads/plan.png' },
      { id: 'second', name: '二樓', imageUrl: '/uploads/plan2.png' },
    ],
    markers: [marker('A', 'marker-a'), marker('B', 'marker-b'), { ...marker('C', 'marker-c'), pageId: 'second' }],
    idleImageUrl: '',
  },
  alarms: [alarm('B', 20, '警報 B'), alarm('ignored', 100), alarm('A', 30, '警報 A')],
  selectedPageId: 'first',
  connectionStatus: 'connected',
  lastSuccessAt: '14:00:00',
};

test('同一平面圖有多筆舊資料時，只顯示最新的有效 Name 與對應圖示', () => {
  const view = getDisplayViewModel(baseState);
  assert.equal(view.page?.id, 'first');
  assert.deepEqual(view.alarms.map((item: ActiveAlarm): string => item.name), ['A']);
  assert.deepEqual(view.markers.map((item: AlarmMarker): string => item.id), ['marker-a']);
});

test('同時觸發時以測點名稱穩定決定唯一顯示項目', () => {
  const view = getDisplayViewModel({
    ...baseState,
    alarms: [alarm('B', 30), alarm('A', 30), alarm('ignored', 100)],
  });
  assert.deepEqual(view.alarms.map((item: ActiveAlarm): string => item.name), ['A']);
  assert.deepEqual(view.markers.map((item: AlarmMarker): string => item.id), ['marker-a']);
});

test('目前平面圖沒有有效警報時，不顯示其他平面圖的標記', () => {
  const view = getDisplayViewModel({ ...baseState, selectedPageId: 'second' });
  assert.deepEqual(view.alarms, []);
  assert.deepEqual(view.markers, []);
});

test('警報文字使用自訂內容，否則描述，最後才回退測點名稱', () => {
  assert.equal(getAlarmText(marker('A', 'a', '自訂文字'), alarm('A', 1, 'Desc')), '自訂文字');
  assert.equal(getAlarmText(marker('A', 'a'), alarm('A', 1, 'Desc')), 'Desc');
  assert.equal(getAlarmText(marker('A', 'a'), alarm('A', 1, '  ')), 'A');
});

test('標記位置維持圖片百分比座標並限制在圖片範圍內', () => {
  assert.deepEqual(getMarkerPosition({ ...marker('A', 'a'), x: 25, y: 75 }), {
    left: '25%', top: '75%', size: '48px',
  });
  assert.deepEqual(getMarkerPosition({ ...marker('A', 'a'), x: 150, y: -4 }), {
    left: '100%', top: '0%', size: '48px',
  });
  assert.equal(getMarkerPosition({ ...marker('A', 'a'), size: 10 }).size, '20px');
  assert.equal(getMarkerPosition({ ...marker('A', 'a'), size: 64 }).size, '64px');
});

test('斷線時保留最後更新時間供狀態顯示', () => {
  const view = getDisplayViewModel({ ...baseState, connectionStatus: 'disconnected' });
  assert.equal(view.statusText, '資料連線中斷 · 最後更新 14:00:00');
});

test('停止監控時明確標示停止，不誤報為資料連線正常或目前無警報', () => {
  const stoppedView = getDisplayViewModel({ ...baseState, isMonitoring: false, connectionStatus: 'connected' });
  assert.equal(stoppedView.statusText, '警報監控已停止');
});
