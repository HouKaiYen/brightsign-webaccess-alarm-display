import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { IdlePlaylistPlayer } from '../src/display/idlePlaylistPlayer.js';
import { DefaultIdleSettings, type IdleSettings } from '../shared/contracts.js';

class MediaElement extends EventTarget {
  public children: MediaElement[] = [];
  public parent: MediaElement | null = null;
  public className: string = '';
  public textContent: string = '';
  public hidden: boolean = false;
  public src: string = '';
  public muted: boolean = true;
  public currentTime: number = 0;
  public measuredWidth: number | null = null;
  public dataset: Record<string, string> = {};
  public style: Record<string, string> = {};
  public constructor(public tagName: string) { super(); }
  public get firstChild(): MediaElement | null { return this.children[0] ?? null; }
  public get isConnected(): boolean { return this.parent !== null; }
  public append(...children: MediaElement[]): void {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  public removeChild(child: MediaElement): void {
    this.children = this.children.filter((element: MediaElement) => element !== child);
    child.parent = null;
  }
  public remove(): void { this.parent?.removeChild(this); }
  public getBoundingClientRect(): DOMRect { return { width: this.measuredWidth ?? this.textContent.length * 20 } as DOMRect; }
  public setAttribute(_name: string, _value: string): void {}
  public removeAttribute(_name: string): void {}
  public pause(): void {}
  public load(): void {}
  public play(): Promise<void> { return Promise.resolve(); }
  public querySelector(selector: string): MediaElement | null {
    for (const child of this.children) {
      if (selector === child.tagName || selector === '.' + child.className) return child;
      const match: MediaElement | null = child.querySelector(selector);
      if (match !== null) return match;
    }
    return null;
  }
}

interface PlayerFixture {
  host: MediaElement;
  player: IdlePlaylistPlayer;
  advance(milliseconds: number): void;
  pendingTimers(): number;
}

function createFixture(context: TestContext): PlayerFixture {
  const originalDocument: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalWindow: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const timers: Map<number, { due: number; callback: () => void }> = new Map();
  let currentTime: number = 0;
  let nextId: number = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (name: string): MediaElement => new MediaElement(name) } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout(callback: () => void, delay: number): number { const id: number = ++nextId; timers.set(id, { due: currentTime + delay, callback }); return id; },
    clearTimeout(id: number): void { timers.delete(id); },
    addEventListener(): void {},
    removeEventListener(): void {},
  } });
  const host: MediaElement = new MediaElement('div');
  const player: IdlePlaylistPlayer = new IdlePlaylistPlayer(host as unknown as HTMLDivElement);
  context.after((): void => {
    player.dispose();
    if (originalDocument !== undefined) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (originalWindow !== undefined) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  return {
    host, player, pendingTimers: (): number => timers.size,
    advance(milliseconds: number): void {
      const targetTime: number = currentTime + milliseconds;
      while (true) {
        const next: [number, { due: number; callback: () => void }] | undefined = [...timers.entries()]
          .filter((entry) => entry[1].due <= targetTime).sort((first, second) => first[1].due - second[1].due)[0];
        if (next === undefined) break;
        currentTime = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
      }
      currentTime = targetTime;
    },
  };
}

function settingsFor(kinds: Array<'image' | 'video'>): IdleSettings {
  return { ...DefaultIdleSettings, items: kinds.map((kind: 'image' | 'video', index: number) => ({
    id: String(index), name: String(index), kind, url: '/uploads/' + index + (kind === 'image' ? '.png' : '.mp4'), durationSeconds: 10,
  })) };
}

for (const kind of ['image', 'video'] as const) {
  test('待機' + kind + '暫時失敗後會延遲重試，不被狀態更新延後', (context: TestContext): void => {
    const fixture: PlayerFixture = createFixture(context);
    const settings: IdleSettings = settingsFor([kind]);
    fixture.player.update(settings, '', '目前無警報');
    const selector: string = kind === 'image' ? 'img' : 'video';
    const failedMedia: MediaElement = fixture.host.querySelector(selector)!;
    failedMedia.dispatchEvent(new Event('error'));
    assert.equal(fixture.host.querySelector(selector), null);
    fixture.advance(29000);
    fixture.player.update(structuredClone(settings), '', '目前無警報');
    fixture.advance(1000);
    const retriedMedia: MediaElement = fixture.host.querySelector(selector)!;
    assert.ok(retriedMedia);
    assert.notEqual(retriedMedia, failedMedia);
    assert.equal(retriedMedia.src, settings.items[0].url);
    failedMedia.dispatchEvent(new Event('error'));
    assert.equal(fixture.host.querySelector(selector), retriedMedia);
    retriedMedia.dispatchEvent(new Event('error'));
    fixture.advance(30000);
    assert.ok(fixture.host.querySelector(selector));
  });
}

test('部分媒體失敗時不打斷正常影片，下一輪重試失敗媒體', (context: TestContext): void => {
  const fixture: PlayerFixture = createFixture(context);
  fixture.player.update(settingsFor(['image', 'video']), '', '目前無警報');
  fixture.host.querySelector('img')!.dispatchEvent(new Event('error'));
  const video: MediaElement = fixture.host.querySelector('video')!;
  fixture.advance(15000);
  video.currentTime = 15;
  video.dispatchEvent(new Event('timeupdate'));
  fixture.advance(15000);
  assert.equal(fixture.host.querySelector('video'), video);
  video.dispatchEvent(new Event('ended'));
  assert.equal(fixture.host.querySelector('img')?.src, '/uploads/0.png');
});

test('警報切換、清空清單及關閉播放器會取消媒體重試', (context: TestContext): void => {
  const fixture: PlayerFixture = createFixture(context);
  const settings: IdleSettings = settingsFor(['image']);
  fixture.player.update(settings, '', '目前無警報');
  fixture.host.querySelector('img')!.dispatchEvent(new Event('error'));
  fixture.player.setVisible(false);
  assert.equal(fixture.pendingTimers(), 0);
  fixture.advance(30000);
  assert.equal(fixture.host.querySelector('img'), null);
  fixture.player.setVisible(true);
  fixture.host.querySelector('img')!.dispatchEvent(new Event('error'));
  fixture.player.update(settingsFor([]), '', '目前無警報');
  assert.equal(fixture.pendingTimers(), 0);
  fixture.player.update(settings, '', '目前無警報');
  fixture.host.querySelector('img')!.dispatchEvent(new Event('error'));
  fixture.player.dispose();
  assert.equal(fixture.pendingTimers(), 0);
  fixture.advance(30000);
  assert.equal(fixture.host.children.length, 0);
});

test('跑馬燈中的 HTML 與 JavaScript 負載只作為文字顯示', (context: TestContext): void => {
  const fixture: PlayerFixture = createFixture(context);
  const payload: string = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  fixture.player.update({ ...settingsFor([]), marquee: { isEnabled: true, text: payload, speed: 'normal' } }, '', '目前無警報');
  const ticker: MediaElement = fixture.host.querySelector('.idle-ticker-content')!;
  assert.ok(ticker.textContent.includes(payload));
  assert.equal(ticker.children.length, 0);
  assert.equal(fixture.host.querySelector('script'), null);
  assert.equal(fixture.host.querySelector('img'), null);
});

test('影片載入或播放停滯 30 秒會跳過，且狀態更新及無進度事件不會延後期限', (context: TestContext): void => {
  const fixture: PlayerFixture = createFixture(context);
  const settings: IdleSettings = settingsFor(['video', 'image']);
  fixture.player.update(settings, '', '');
  const video: MediaElement = fixture.host.querySelector('video')!;
  fixture.advance(29000);
  fixture.player.update(structuredClone(settings), '', '');
  video.dispatchEvent(new Event('waiting'));
  video.dispatchEvent(new Event('stalled'));
  video.dispatchEvent(new Event('timeupdate'));
  fixture.advance(1000);
  assert.equal(fixture.host.querySelector('video'), null);
  assert.equal(fixture.host.querySelector('img')?.src, '/uploads/1.png');
  video.currentTime = 99;
  video.dispatchEvent(new Event('timeupdate'));
  fixture.advance(30000);
  assert.equal(fixture.host.querySelector('video')?.src, '/uploads/0.mp4');
});

test('正常長影片持續播放，最後一次進度後停滯才跳過', (context: TestContext): void => {
  const fixture: PlayerFixture = createFixture(context);
  fixture.player.update(settingsFor(['video', 'image']), '', '');
  const video: MediaElement = fixture.host.querySelector('video')!;
  for (let elapsedSeconds: number = 10; elapsedSeconds <= 120; elapsedSeconds += 10) {
    fixture.advance(10000);
    video.currentTime = elapsedSeconds;
    video.dispatchEvent(new Event('timeupdate'));
    assert.equal(fixture.host.querySelector('video'), video);
  }
  fixture.advance(29999);
  assert.equal(fixture.host.querySelector('video'), video);
  fixture.advance(1);
  assert.equal(fixture.host.querySelector('img')?.src, '/uploads/1.png');
});

test('單一影片逾時會顯示失敗訊息並重試，隱藏及關閉會取消偵測', (context: TestContext): void => {
  const fixture: PlayerFixture = createFixture(context);
  fixture.player.update(settingsFor(['video']), '', '');
  fixture.advance(30000);
  assert.equal(fixture.host.querySelector('video'), null);
  assert.equal(fixture.host.querySelector('.idle-message')?.hidden, false);
  fixture.advance(30000);
  assert.ok(fixture.host.querySelector('video'));
  fixture.player.setVisible(false);
  assert.equal(fixture.pendingTimers(), 0);
  fixture.player.setVisible(true);
  assert.ok(fixture.host.querySelector('video'));
  fixture.player.update(settingsFor([]), '', '');
  assert.equal(fixture.pendingTimers(), 0);
  fixture.player.update(settingsFor(['video']), '', '');
  fixture.player.dispose();
  assert.equal(fixture.pendingTimers(), 0);
});

test('單張圖片持續顯示，多張圖片仍依秒數切換', (context: TestContext): void => {
  const fixture: PlayerFixture = createFixture(context);
  fixture.player.update(settingsFor(['image']), '', '');
  const image: MediaElement = fixture.host.querySelector('img')!;
  fixture.advance(300000);
  assert.equal(fixture.host.querySelector('img'), image);
  assert.equal(fixture.pendingTimers(), 0);
  fixture.player.update(settingsFor(['image', 'image']), '', '');
  fixture.advance(10000);
  assert.equal(fixture.host.querySelector('img')?.src, '/uploads/1.png');
});

test('單份多頁 PDF 仍依每頁秒數切換，單支影片播完重新播放', (context: TestContext): void => {
  const fixture: PlayerFixture = createFixture(context);
  fixture.player.update({ ...DefaultIdleSettings, items: [{ id: 'pdf', name: 'pdf', kind: 'pdf', url: '/uploads/test.pdf', pageUrls: ['/uploads/page-1.png', '/uploads/page-2.png'], durationSeconds: 3 }] }, '', '');
  fixture.advance(3000);
  assert.equal(fixture.host.querySelector('img')?.src, '/uploads/page-2.png');
  fixture.advance(3000);
  assert.equal(fixture.host.querySelector('img')?.src, '/uploads/page-1.png');
  fixture.player.update(settingsFor(['video']), '', '');
  const video: MediaElement = fixture.host.querySelector('video')!;
  video.dispatchEvent(new Event('ended'));
  assert.ok(fixture.host.querySelector('video'));
  assert.notEqual(fixture.host.querySelector('video'), video);
  assert.equal(fixture.host.querySelector('video')?.src, '/uploads/0.mp4');
});

test('跑馬燈依文字實際寬度維持固定像素速度，字體大小會套用且不重啟媒體', (context: TestContext): void => {
  const fixture: PlayerFixture = createFixture(context);
  const settings: IdleSettings = { ...settingsFor(['image']), marquee: { isEnabled: true, text: '公告', speed: 'normal', fontSizePx: 48, speedPixelsPerSecond: 80 } };
  fixture.player.update(settings, '', '');
  const image: MediaElement = fixture.host.querySelector('img')!;
  const content: MediaElement = fixture.host.querySelector('.idle-ticker-content')!;
  const ticker: MediaElement = fixture.host.querySelector('.idle-ticker')!;
  assert.equal(ticker.style.fontSize, '48px');
  assert.equal(content.getBoundingClientRect().width / 2 / parseFloat(content.style.animationDuration), 80);
  fixture.player.update({ ...settings, marquee: { ...settings.marquee, text: '長公告的移動速度應與短公告一致', speedPixelsPerSecond: 160, position: 'top' } }, '', '');
  assert.equal(content.getBoundingClientRect().width / 2 / parseFloat(content.style.animationDuration), 160);
  assert.equal(ticker.dataset.position, 'top');
  assert.equal(fixture.host.querySelector('img'), image);
  fixture.player.update({ ...settings, marquee: { isEnabled: true, text: '舊版公告', speed: 'slow' } }, '', '');
  assert.equal(content.style.animationDuration, '36s');
  fixture.player.update({ ...settings, marquee: { ...settings.marquee, isEnabled: false } }, '', '');
  assert.equal(ticker.hidden, true);
});

test('短公告填滿寬畫面且兩半內容相同，縮放與狀態更新維持無縫循環及固定速度', (context: TestContext): void => {
  const fixture: PlayerFixture = createFixture(context);
  const ticker: MediaElement = fixture.host.querySelector('.idle-ticker')!;
  ticker.measuredWidth = 1920;
  const settings: IdleSettings = { ...settingsFor([]), marquee: { isEnabled: true, text: '公告', speed: 'normal', speedPixelsPerSecond: 80 } };
  fixture.player.update(settings, '', '');
  const content: MediaElement = fixture.host.querySelector('.idle-ticker-content')!;
  const initialText: string = content.textContent;
  assert.ok(content.getBoundingClientRect().width / 2 >= 1920);
  assert.equal(initialText.slice(0, initialText.length / 2), initialText.slice(initialText.length / 2));
  assert.equal(content.getBoundingClientRect().width / 2 / parseFloat(content.style.animationDuration), 80);
  fixture.player.update(structuredClone(settings), '', '');
  assert.equal(content.textContent, initialText);
  ticker.measuredWidth = 320;
  fixture.player.update(settings, '', '');
  assert.ok(content.getBoundingClientRect().width / 2 >= 320);
  assert.ok(content.textContent.length < initialText.length);
  assert.equal(content.getBoundingClientRect().width / 2 / parseFloat(content.style.animationDuration), 80);
});
