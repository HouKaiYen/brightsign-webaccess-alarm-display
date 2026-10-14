import type { ActiveAlarm, AlarmMarker, DisplayState, IconKind } from '../../shared/contracts';
import { getAlarmText, getDisplayViewModel, getMarkerPosition, type DisplayViewModel } from './model';
import { IdlePlaylistPlayer } from './idlePlaylistPlayer';

interface MarkerElements {
  element: HTMLDivElement;
  signature: string;
}

interface AlarmElements {
  element: HTMLDivElement;
  text: HTMLSpanElement;
  exitIcon: HTMLImageElement;
}

const namespace: 'http://www.w3.org/2000/svg' = 'http://www.w3.org/2000/svg';

function createBuiltInIcon(iconKind: IconKind, color: string): SVGSVGElement {
  const svg: SVGSVGElement = document.createElementNS(namespace, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  if (iconKind === 'warning') {
    const shape: SVGPathElement = document.createElementNS(namespace, 'path') as SVGPathElement;
    shape.setAttribute('d', 'M50 5 L97 91 H3 Z');
    shape.setAttribute('fill', color);
    shape.setAttribute('stroke', '#151922');
    shape.setAttribute('stroke-width', '5');
    shape.setAttribute('stroke-linejoin', 'round');
    svg.append(shape);
    const mark: SVGPathElement = document.createElementNS(namespace, 'path');
    mark.setAttribute('d', 'M50 34v28');
    mark.setAttribute('stroke', '#151922');
    mark.setAttribute('stroke-width', '9');
    mark.setAttribute('stroke-linecap', 'round');
    const dot: SVGCircleElement = document.createElementNS(namespace, 'circle');
    dot.setAttribute('cx', '50');
    dot.setAttribute('cy', '76');
    dot.setAttribute('r', '5');
    dot.setAttribute('fill', '#151922');
    svg.append(mark, dot);
  } else if (iconKind === 'sos') {
    const shape: SVGCircleElement = document.createElementNS(namespace, 'circle') as SVGCircleElement;
    shape.setAttribute('cx', '50');
    shape.setAttribute('cy', '50');
    shape.setAttribute('r', '46');
    shape.setAttribute('fill', color);
    shape.setAttribute('stroke', '#101216');
    shape.setAttribute('stroke-width', '6');
    svg.append(shape);
    const label: SVGTextElement = document.createElementNS(namespace, 'text') as SVGTextElement;
    label.setAttribute('x', '50');
    label.setAttribute('y', '63');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-family', 'Arial, sans-serif');
    label.setAttribute('font-size', '34');
    label.setAttribute('font-weight', '800');
    label.setAttribute('fill', '#101216');
    label.textContent = 'SOS';
    svg.append(label);
  } else {
    const shape: SVGCircleElement = document.createElementNS(namespace, 'circle') as SVGCircleElement;
    shape.setAttribute('cx', '50');
    shape.setAttribute('cy', '50');
    shape.setAttribute('r', '45');
    shape.setAttribute('fill', color);
    svg.append(shape);
  }
  return svg;
}

function createMarkerGraphic(marker: AlarmMarker): HTMLElement {
  if (marker.iconKind === 'push-button') {
    const image: HTMLImageElement = document.createElement('img');
    image.className = 'alarm-marker-image';
    image.alt = '緊急押鈕';
    image.draggable = false;
    image.src = '/icons/emergency-push-button.svg';
    return image;
  }
  if (marker.iconKind === 'custom' && marker.iconUrl.length === 0) {
    const fallback: HTMLSpanElement = document.createElement('span');
    fallback.className = 'alarm-marker-fallback';
    fallback.textContent = '⚠';
    return fallback;
  }
  if (marker.iconKind === 'custom') {
    const image: HTMLImageElement = document.createElement('img');
    image.className = 'alarm-marker-image';
    image.alt = '';
    image.draggable = false;
    image.src = marker.iconUrl;
    image.addEventListener('error', (): void => {
      const fallback: HTMLSpanElement = document.createElement('span');
      fallback.className = 'alarm-marker-fallback';
      fallback.textContent = '⚠';
      const parent: Node | null = image.parentNode;
      if (parent !== null) {
        parent.replaceChild(fallback, image);
      }
    }, { once: true });
    return image;
  }

  const holder: HTMLSpanElement = document.createElement('span');
  holder.className = `alarm-marker-built-in alarm-marker-${marker.iconKind}`;
  holder.append(createBuiltInIcon(marker.iconKind, marker.color));
  return holder;
}

function replaceChildrenCompat(parent: Element, ...children: Node[]): void {
  while (parent.firstChild !== null) {
    parent.removeChild(parent.firstChild);
  }
  for (const child of children) {
    parent.appendChild(child);
  }
}

function markerSignature(marker: AlarmMarker): string {
  const iconUrl: string = marker.iconKind === 'custom' ? marker.iconUrl : '';
  return [marker.x, marker.y, marker.size, marker.color, marker.shouldBlink, marker.iconKind, iconUrl].join('|');
}

function createMarker(marker: AlarmMarker): MarkerElements {
  const element: HTMLDivElement = document.createElement('div');
  element.className = 'alarm-marker';
  element.dataset.markerId = marker.id;
  element.append(createMarkerGraphic(marker));
  const elements: MarkerElements = { element, signature: '' };
  updateMarker(elements, marker);
  return elements;
}

function updateMarker(elements: MarkerElements, marker: AlarmMarker): void {
  const signature: string = markerSignature(marker);
  if (signature === elements.signature) {
    return;
  }
  const position: { left: string; top: string; size: string } = getMarkerPosition(marker);
  elements.element.style.left = position.left;
  elements.element.style.top = position.top;
  elements.element.style.width = position.size;
  elements.element.style.height = position.size;
  elements.element.classList.toggle('should-blink', marker.shouldBlink);
  replaceChildrenCompat(elements.element, createMarkerGraphic(marker));
  elements.signature = signature;
}

export class DisplayRenderer {
  private readonly _root: HTMLElement;
  private readonly _status: HTMLDivElement;
  private readonly _alarms: HTMLDivElement;
  private readonly _planViewport: HTMLDivElement;
  private readonly _markerLayer: HTMLDivElement;
  private readonly _idle: HTMLDivElement;
  private readonly _idlePlayer: IdlePlaylistPlayer;
  private readonly _markerElements: Map<string, MarkerElements> = new Map<string, MarkerElements>();
  private readonly _alarmElements: Map<string, AlarmElements> = new Map<string, AlarmElements>();
  private _state: DisplayState | null = null;
  private _isConnected: boolean = false;
  private _hasConnectionFailure: boolean = false;
  private _pageImageUrl: string = '';
  private readonly _errorPageImage: HTMLDivElement;
  private readonly _resizeHandler: () => void;

  public constructor(root: HTMLElement) {
    this._root = root;
    root.className = 'display-screen';
    const header: HTMLElement = document.createElement('header');
    header.className = 'display-header';
    this._status = document.createElement('div');
    this._status.className = 'connection-status';
    this._status.setAttribute('role', 'status');
    this._alarms = document.createElement('div');
    this._alarms.className = 'alarm-list';
    header.append(this._status, this._alarms);

    this._planViewport = document.createElement('main') as HTMLDivElement;
    this._planViewport.className = 'plan-viewport';
    const layer: HTMLDivElement = document.createElement('div');
    layer.className = 'floor-plan-layer';
    this._markerLayer = document.createElement('div');
    this._markerLayer.className = 'marker-layer';
    layer.append(this._markerLayer);
    this._planViewport.append(layer);
    this._errorPageImage = document.createElement('div');
    this._errorPageImage.className = 'page-image-error';
    this._errorPageImage.setAttribute('role', 'status');
    this._errorPageImage.textContent = '平面圖無法載入';
    this._planViewport.append(this._errorPageImage);

    this._idle = document.createElement('div');
    this._idle.className = 'idle-screen';
    this._idlePlayer = new IdlePlaylistPlayer(this._idle);
    this._resizeHandler = (): void => this.resizePlanImage();
    window.addEventListener('resize', this._resizeHandler);
    replaceChildrenCompat(this._root, header, this._planViewport, this._idle);
    this.render();
  }

  public setState(state: DisplayState): void {
    this._state = state;
    this.render();
  }

  public setConnectionStatus(isConnected: boolean): void {
    this._isConnected = isConnected;
    this._hasConnectionFailure = !isConnected;
    this.renderStatus();
  }

  public dispose(): void {
    window.removeEventListener('resize', this._resizeHandler);
    this._idlePlayer.dispose();
  }

  private render(): void {
    const view: DisplayViewModel = getDisplayViewModel(this._state);
    this._root.classList.toggle('is-idle', view.page === null);
    this.renderStatus(view.statusText);
    this.renderAlarms(view.alarms, view.markers);
    this._planViewport.classList.toggle('has-alarm', view.alarms.length > 0);
    if (view.page === null) {
      this._idlePlayer.setVisible(true);
      this._idlePlayer.update(this._state?.settings.idle, this._state?.settings.idleImageUrl ?? '', this.getIdleMessage());
      this.clearMarkers();
      this._planViewport.hidden = true;
      return;
    }

    this._idlePlayer.setVisible(false);
    this._planViewport.hidden = false;
    this.renderPlanImage(view.page.imageUrl);
    this.renderMarkers(view.markers, view.alarms);
    this.resizePlanImage();
  }

  private renderStatus(statusText?: string): void {
    const stateStatusText: string = this._state === null
      ? '正在連線至警報系統…'
      : getDisplayViewModel(this._state).statusText;
    const stateIsOffline: boolean = this._state?.connectionStatus === 'disconnected';
    const label: string = this._state === null && !this._hasConnectionFailure
      ? '正在連線至警報系統…'
      : !this._isConnected && !stateIsOffline
        ? this._state?.lastSuccessAt === null || this._state === null
          ? '資料連線中斷，尚未取得資料'
          : `資料連線中斷 · 最後更新 ${this._state.lastSuccessAt}`
        : statusText ?? stateStatusText;
    if (this._status.textContent !== label) {
      this._status.textContent = label;
    }
    this._status.classList.toggle('is-offline', !this._isConnected || stateIsOffline);
  }

  private renderAlarms(alarms: ActiveAlarm[], markers: AlarmMarker[]): void {
    const markerByName: Map<string, AlarmMarker> = new Map<string, AlarmMarker>(
      markers.map((marker: AlarmMarker): [string, AlarmMarker] => [marker.name, marker]),
    );
    const desiredIds: Set<string> = new Set<string>();
    const desiredRows: HTMLDivElement[] = [];
    for (const alarm of alarms) {
      const marker: AlarmMarker | undefined = markerByName.get(alarm.name);
      if (marker === undefined) {
        continue;
      }
      const id: string = `${alarm.name}`;
      desiredIds.add(id);
      let row: AlarmElements | undefined = this._alarmElements.get(id);
      if (row === undefined) {
        const element: HTMLDivElement = document.createElement('div');
        element.className = 'alarm-row';
        const text: HTMLSpanElement = document.createElement('span');
        text.className = 'alarm-row-text';
        const time: HTMLTimeElement = document.createElement('time');
        time.className = 'alarm-row-time';
        const message: HTMLDivElement = document.createElement('div');
        message.className = 'alarm-message';
        const exitIcon: HTMLImageElement = document.createElement('img');
        exitIcon.className = 'alarm-exit-icon';
        exitIcon.src = '/icons/evacuation-exit.svg';
        exitIcon.alt = 'EXIT 避難出口';
        exitIcon.hidden = true;
        message.append(text, exitIcon);
        element.append(message, time);
        row = { element, text, exitIcon };
        this._alarmElements.set(id, row);
      }
      row.exitIcon.hidden = marker.shouldShowExitIcon !== true;
      const text: string = getAlarmText(marker, alarm);
      if (row.text.textContent !== text) {
        row.text.textContent = text;
      }
      const timeElement: HTMLTimeElement = row.element.querySelector('time') as HTMLTimeElement;
      const timeText: string = alarm.time.length > 0 ? alarm.time : '';
      if (timeElement.textContent !== timeText) {
        timeElement.textContent = timeText;
      }
      desiredRows.push(row.element);
    }
    for (const [id, row] of this._alarmElements) {
      if (!desiredIds.has(id)) {
        row.element.remove();
        this._alarmElements.delete(id);
      }
    }
    if (this._alarms.childElementCount !== desiredRows.length
      || desiredRows.some((row: HTMLDivElement, index: number): boolean => row !== this._alarms.children.item(index))) {
    replaceChildrenCompat(this._alarms, ...desiredRows);
    }
    this._alarms.hidden = alarms.length === 0;
  }

  private renderPlanImage(imageUrl: string): void {
    const layer: HTMLDivElement = this._planViewport.querySelector('.floor-plan-layer') as HTMLDivElement;
    if (imageUrl.length === 0) {
      this.removePlanImage(layer);
      this._markerLayer.hidden = true;
      this._errorPageImage.hidden = false;
      return;
    }
    this._errorPageImage.hidden = true;
    if (this._pageImageUrl === imageUrl && layer.querySelector('img') !== null) {
      this.resizePlanImage();
      return;
    }
    this._markerLayer.hidden = true;
    this.removePlanImage(layer);
    this._pageImageUrl = imageUrl;
    const image: HTMLImageElement = document.createElement('img');
    image.className = 'floor-plan-image';
    image.alt = '';
    image.draggable = false;
    image.src = imageUrl;
    image.addEventListener('error', (): void => {
      this._errorPageImage.hidden = false;
      this._markerLayer.hidden = true;
      image.remove();
      this._pageImageUrl = '';
    }, { once: true });
    image.addEventListener('load', (): void => {
      this._markerLayer.hidden = false;
      this.resizePlanImage();
    }, { once: true });
    layer.prepend(image);
  }

  private removePlanImage(layer: HTMLDivElement): void {
    layer.querySelector('img')?.remove();
    this._pageImageUrl = '';
  }

  private renderMarkers(markers: AlarmMarker[], alarms: ActiveAlarm[]): void {
    const alarmsByName: Map<string, ActiveAlarm> = new Map<string, ActiveAlarm>(
      alarms.map((alarm: ActiveAlarm): [string, ActiveAlarm] => [alarm.name, alarm]),
    );
    const desiredIds: Set<string> = new Set<string>();
    const desiredMarkers: HTMLDivElement[] = [];
    for (const marker of markers) {
      const alarm: ActiveAlarm | undefined = alarmsByName.get(marker.name);
      if (alarm === undefined || marker.shouldShowExitIcon === true) {
        continue;
      }
      desiredIds.add(marker.id);
      let elements: MarkerElements | undefined = this._markerElements.get(marker.id);
      if (elements === undefined) {
        elements = createMarker(marker);
        this._markerElements.set(marker.id, elements);
      } else {
        updateMarker(elements, marker);
      }
      desiredMarkers.push(elements.element);
    }
    for (const [id, elements] of this._markerElements) {
      if (!desiredIds.has(id)) {
        elements.element.remove();
        this._markerElements.delete(id);
      }
    }
    if (this._markerLayer.childElementCount !== desiredMarkers.length
      || desiredMarkers.some((marker: HTMLDivElement, index: number): boolean => marker !== this._markerLayer.children.item(index))) {
    replaceChildrenCompat(this._markerLayer, ...desiredMarkers);
    }
  }

  private clearMarkers(): void {
    this._markerElements.clear();
    replaceChildrenCompat(this._markerLayer);
    this._markerLayer.hidden = false;
    this._alarmElements.clear();
    replaceChildrenCompat(this._alarms);
    this._alarms.hidden = true;
  }

  private getIdleMessage(): string {
    return this._state === null
        ? '正在載入警報狀態…'
        : this._state.isMonitoring === false
          ? '警報監控已停止'
          : this._state.connectionStatus === 'connecting'
          ? '正在取得警報狀態…'
          : this._state.connectionStatus === 'disconnected' && this._state.lastSuccessAt === null
            ? '尚未取得警報資料'
            : '目前無警報';
  }

  private resizePlanImage(): void {
    const image: HTMLImageElement | null = this._planViewport.querySelector('.floor-plan-image');
    const layer: HTMLDivElement | null = this._planViewport.querySelector('.floor-plan-layer');
    if (image === null || layer === null || image.naturalWidth === 0 || image.naturalHeight === 0) {
      return;
    }

    const viewportBounds: DOMRect = this._planViewport.getBoundingClientRect();
    const style: CSSStyleDeclaration = window.getComputedStyle(this._planViewport);
    const availableWidth: number = Math.max(1, viewportBounds.width
      - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight));
    const availableHeight: number = Math.max(1, viewportBounds.height
      - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom));
    const scale: number = Math.min(availableWidth / image.naturalWidth, availableHeight / image.naturalHeight);
    const width: number = image.naturalWidth * scale;
    const height: number = image.naturalHeight * scale;
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
  }
}
