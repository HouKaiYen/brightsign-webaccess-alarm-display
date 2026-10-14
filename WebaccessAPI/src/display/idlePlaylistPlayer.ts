import { MarqueeSpeedOptions } from '../../shared/contracts';
import type { IdleMedia, IdleSettings } from '../../shared/contracts';

interface PlaylistFrame {
  item: IdleMedia;
  url: string;
}

export class IdlePlaylistPlayer {
  private readonly _host: HTMLDivElement;
  private readonly _mediaLayer: HTMLDivElement;
  private readonly _ticker: HTMLDivElement;
  private readonly _tickerContent: HTMLSpanElement;
  private readonly _message: HTMLDivElement;
  private _settingsSignature: string = '';
  private _legacyImageUrl: string = '';
  private _frames: PlaylistFrame[] = [];
  private _failedFrameKeys: Set<string> = new Set<string>();
  private _frameIndex: number = 0;
  private _timer: number | null = null;
  private _retryTimer: number | null = null;
  private _isVisible: boolean = true;
  private _isDisposed: boolean = false;
  private _isMuted: boolean = true;
  private _mediaGeneration: number = 0;

  public constructor(host: HTMLDivElement) {
    this._host = host;
    this._mediaLayer = document.createElement('div');
    this._mediaLayer.className = 'idle-media-layer';
    this._ticker = document.createElement('div');
    this._ticker.className = 'idle-ticker';
    this._ticker.setAttribute('aria-live', 'off');
    this._tickerContent = document.createElement('span');
    this._tickerContent.className = 'idle-ticker-content';
    this._ticker.append(this._tickerContent);
    this._message = document.createElement('div');
    this._message.className = 'idle-message';
    this._host.append(this._mediaLayer, this._ticker, this._message);
  }

  public update(settings: IdleSettings | undefined, legacyImageUrl: string, message: string): void {
    if (this._isDisposed) {
      return;
    }
    const settingsSignature: string = JSON.stringify({ items: settings?.items ?? [], isMuted: settings?.isMuted ?? true });
    const effectiveLegacyImageUrl: string = settings === undefined ? legacyImageUrl : '';
    if (settingsSignature !== this._settingsSignature || effectiveLegacyImageUrl !== this._legacyImageUrl) {
      this._settingsSignature = settingsSignature;
      this._legacyImageUrl = effectiveLegacyImageUrl;
      this._isMuted = settings?.isMuted ?? true;
      this._frames = this.expandFrames(settings);
      if (effectiveLegacyImageUrl.length > 0) {
        this._frames = [{ item: { id: 'legacy', name: '待機圖片', kind: 'image', url: effectiveLegacyImageUrl, durationSeconds: 10 }, url: effectiveLegacyImageUrl }];
      }
      this.clearRetryTimer();
      this._failedFrameKeys.clear();
      this._frameIndex = 0;
      this.clearTimer();
      this.clearMedia();
      this.renderFrame();
    }
    const marqueeText: string = settings?.marquee.isEnabled === true ? settings.marquee.text.trim() : '';
    this._ticker.hidden = marqueeText.length === 0;
    if (marqueeText.length > 0) {
      const tickerContent: string = `${marqueeText}\u00a0\u00a0\u00a0\u00a0${marqueeText}\u00a0\u00a0\u00a0\u00a0`;
      if (this._tickerContent.textContent !== tickerContent) {
        this._tickerContent.textContent = tickerContent;
      }
      this._ticker.dataset.position = settings?.marquee.position ?? 'bottom';
      const speed: string = settings?.marquee.speed ?? 'normal';
      this._tickerContent.style.animationDuration = String(MarqueeSpeedOptions.find((option) => option.value === speed)?.seconds ?? 24) + 's';
      if (this._ticker.dataset.speed !== speed) {
        this._ticker.dataset.speed = speed;
      }
    }
    this._message.hidden = this._frames.length > 0 && this._failedFrameKeys.size < this._frames.length;
    if (this._frames.length === 0 && this._message.textContent !== message) {
      this._message.textContent = message;
    }
  }

  public setVisible(isVisible: boolean): void {
    if (this._isDisposed || this._isVisible === isVisible) {
      return;
    }
    this._isVisible = isVisible;
    this._host.hidden = !isVisible;
    if (!isVisible) {
      this.clearRetryTimer();
      this.clearTimer();
      this.clearMedia();
      return;
    }
    this._failedFrameKeys.clear();
    this._frameIndex = 0;
    this.renderFrame();
  }

  public dispose(): void {
    this._isDisposed = true;
    this.clearRetryTimer();
    this.clearTimer();
    this.clearMedia();
    this._mediaLayer.remove();
    this._ticker.remove();
    this._message.remove();
  }

  private readonly handleSoundToggle = (): void => {
    const video: HTMLVideoElement | null = this._mediaLayer.querySelector('video');
    if (video !== null) {
      video.muted = !video.muted;
      this.updateSoundButton(video.muted);
    }
  };

  private expandFrames(settings: IdleSettings | undefined): PlaylistFrame[] {
    const frames: PlaylistFrame[] = [];
    for (const item of settings?.items ?? []) {
      const urls: string[] = item.kind === 'pdf' ? item.pageUrls ?? [] : [item.url];
      for (const url of urls) {
        if (url.length > 0) {
          frames.push({ item, url: url });
        }
      }
    }
    return frames;
  }

  private renderFrame(): void {
    if (this._isDisposed || !this._isVisible || this._frames.length === 0) {
      return;
    }
    if (this._failedFrameKeys.size >= this._frames.length) {
      this.clearMedia();
      this._message.hidden = false;
      this._message.textContent = '待機媒體無法載入';
      return;
    }
    this._frameIndex %= this._frames.length;
    const frame: PlaylistFrame = this._frames[this._frameIndex];
    const key: string = `${this._frameIndex}|${frame.url}`;
    if (this._failedFrameKeys.has(key)) {
      this.advanceFrame();
      return;
    }
    this.clearMedia();
    this._message.hidden = true;
    if (frame.item.kind === 'video') {
      const video: HTMLVideoElement = document.createElement('video');
      const mediaGeneration: number = this._mediaGeneration;
      video.className = 'idle-media';
      video.playsInline = true;
      video.loop = false;
      video.muted = this._isMuted;
      video.autoplay = true;
      video.src = frame.url;
      video.addEventListener('ended', (): void => {
        if (mediaGeneration === this._mediaGeneration && this._isVisible && video.isConnected) {
          this.advanceFrame();
        }
      }, { once: true });
      video.addEventListener('error', (): void => {
        if (mediaGeneration === this._mediaGeneration && this._isVisible && video.isConnected) {
          this.failCurrentFrame();
        }
      }, { once: true });
      const soundButton: HTMLButtonElement = document.createElement('button');
      soundButton.className = 'idle-sound-toggle';
      soundButton.type = 'button';
      soundButton.setAttribute('aria-label', '開啟影片聲音');
      soundButton.textContent = '開啟聲音';
      soundButton.addEventListener('click', this.handleSoundToggle, { once: false });
      this._mediaLayer.append(video, soundButton);
      this.updateSoundButton(video.muted);
      const playResult: Promise<void> = video.play();
      void playResult.catch((): void => {
        if (mediaGeneration !== this._mediaGeneration || !this._isVisible || !video.isConnected) {
          return;
        }
        video.muted = true;
        this.updateSoundButton(true);
        void video.play().catch((): void => {
          if (mediaGeneration === this._mediaGeneration && this._isVisible && video.isConnected) {
            this.failCurrentFrame();
          }
        });
      });
      return;
    }
    const image: HTMLImageElement = document.createElement('img');
    const mediaGeneration: number = this._mediaGeneration;
    image.className = 'idle-media';
    image.alt = '';
    image.draggable = false;
    image.addEventListener('error', (): void => {
      if (mediaGeneration === this._mediaGeneration && this._isVisible && image.isConnected) {
        this.failCurrentFrame();
      }
    }, { once: true });
    image.src = frame.url;
    this._mediaLayer.append(image);
    const durationSeconds: number = Math.min(300, Math.max(3, frame.item.durationSeconds || 10));
    this._timer = window.setTimeout(this.advanceFrame, durationSeconds * 1000);
  }

  private readonly advanceFrame = (): void => {
    this.clearTimer();
    this._frameIndex = (this._frameIndex + 1) % this._frames.length;
    this.renderFrame();
  };

  private readonly failCurrentFrame = (): void => {
    const frame: PlaylistFrame | undefined = this._frames[this._frameIndex];
    if (frame !== undefined) {
      this._failedFrameKeys.add(`${this._frameIndex}|${frame.url}`);
      if (this._retryTimer === null) {
        this._retryTimer = window.setTimeout((): void => {
          this._retryTimer = null;
          if (this._isDisposed || !this._isVisible) return;
          const shouldResume: boolean = this._failedFrameKeys.size >= this._frames.length;
          this._failedFrameKeys.clear();
          // 部分媒體仍能播放時，等下一輪再重試，避免中斷目前畫面。
          if (shouldResume) this.renderFrame();
        }, 30000);
      }
    }
    this.clearTimer();
    this._frameIndex = (this._frameIndex + 1) % this._frames.length;
    this.renderFrame();
  };

  private updateSoundButton(isMuted: boolean): void {
    const button: HTMLButtonElement | null = this._mediaLayer.querySelector('.idle-sound-toggle');
    if (button !== null) {
      button.textContent = isMuted ? '開啟聲音' : '靜音';
      button.setAttribute('aria-label', isMuted ? '開啟影片聲音' : '關閉影片聲音');
    }
  }

  private clearRetryTimer(): void {
    if (this._retryTimer !== null) {
      window.clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  private clearTimer(): void {
    if (this._timer !== null) {
      window.clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private clearMedia(): void {
    this._mediaGeneration++;
    const video: HTMLVideoElement | null = this._mediaLayer.querySelector('video');
    if (video !== null) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    const soundButton: HTMLButtonElement | null = this._mediaLayer.querySelector('.idle-sound-toggle');
    soundButton?.removeEventListener('click', this.handleSoundToggle);
    while (this._mediaLayer.firstChild !== null) {
      this._mediaLayer.removeChild(this._mediaLayer.firstChild);
    }
  }
}
