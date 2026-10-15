import { MarqueeSpeedOptions, type IdleMarquee } from '../../shared/contracts';

export function getMarqueeDuration(settings: IdleMarquee, cycleWidth: number): number {
  if (settings.speedPixelsPerSecond !== undefined) {
    return Math.max(1, cycleWidth) / settings.speedPixelsPerSecond;
  }
  // 舊設定維持原有每輪秒數，使用者調整速度後才改為固定像素／秒。
  return MarqueeSpeedOptions.find((option) => option.value === settings.speed)?.seconds ?? 24;
}

export class MarqueeRenderer {
  private readonly _host: HTMLElement;
  private readonly _content: HTMLElement;
  private readonly _resizeObserver: ResizeObserver | null;
  private _settings: IdleMarquee | undefined;
  private _isDisposed: boolean = false;
  private _unitText: string = '';
  private _repeatCount: number = 1;

  public constructor(host: HTMLElement, content: HTMLElement) {
    this._host = host;
    this._content = content;
    this._resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(this.updateDuration);
    this._resizeObserver?.observe(content);
    this._resizeObserver?.observe(host);
    window.addEventListener('resize', this.updateDuration);
    // 字型下載完成後字寬可能改變，需重新計算速度。
    void document.fonts?.ready.then(this.updateDuration);
  }

  public update(settings: IdleMarquee | undefined): void {
    this._settings = settings;
    const text: string = settings?.isEnabled === true ? settings.text.trim() : '';
    this._host.hidden = text.length === 0;
    if (text.length === 0 || settings === undefined) return;
    const unitText: string = `${text}\u00a0\u00a0\u00a0\u00a0`;
    if (this._unitText !== unitText) {
      this._unitText = unitText;
      this._repeatCount = 1;
      this._content.textContent = unitText.repeat(2);
    }
    this._host.dataset.position = settings.position ?? 'bottom';
    this._host.style.fontSize = `${settings.fontSizePx ?? 30}px`;
    this.updateDuration();
  }

  public dispose(): void {
    this._isDisposed = true;
    this._resizeObserver?.disconnect();
    window.removeEventListener('resize', this.updateDuration);
  }

  private readonly updateDuration = (): void => {
    if (this._isDisposed || this._settings === undefined || this._host.hidden) return;
    const unitWidth: number = this._content.getBoundingClientRect().width / (2 * this._repeatCount);
    if (unitWidth <= 0) return;
    // 兩個相同群組各自填滿可視區，位移到後半段時才不會露出空白或跳接。
    const repeatCount: number = Math.max(1, Math.ceil(this._host.getBoundingClientRect().width / unitWidth));
    if (repeatCount !== this._repeatCount) {
      this._repeatCount = repeatCount;
      this._content.textContent = this._unitText.repeat(repeatCount * 2);
    }
    const duration: string = `${getMarqueeDuration(this._settings, this._content.getBoundingClientRect().width / 2)}s`;
    if (this._content.style.animationDuration !== duration) this._content.style.animationDuration = duration;
  };
}
