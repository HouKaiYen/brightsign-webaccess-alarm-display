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
  fixture.advance(30000);
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
