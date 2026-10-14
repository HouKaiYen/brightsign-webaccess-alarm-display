import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent } from 'react';
import type { AlarmMarker, FloorPlan } from '../../../shared/contracts';
import { AlarmIcon } from './AlarmIcon';

interface PlanCanvasProps {
  page: FloorPlan | null;
  marker: AlarmMarker | null;
  previewEnabled: boolean;
  onMoveMarker: (markerId: string, x: number, y: number) => void;
}

interface ImageBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ImageDimensions {
  imageUrl: string;
  width: number;
  height: number;
}

export function PlanCanvas({ page, marker, previewEnabled, onMoveMarker }: PlanCanvasProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<ImageDimensions>({ imageUrl: '', width: 0, height: 0 });
  const draggingMarkerId = useRef<string | null>(null);

  useEffect(() => {
    const stageElement: HTMLDivElement | null = stageRef.current;
    if (stageElement === null) return undefined;
    const observer: ResizeObserver = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const entry: ResizeObserverEntry | undefined = entries[0];
      if (entry !== undefined) {
        setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(stageElement);
    return () => observer.disconnect();
  }, [page?.id]);

  const imageBounds: ImageBounds = useMemo(() => {
    if (naturalSize.imageUrl !== page?.imageUrl || stageSize.width === 0 || stageSize.height === 0 || naturalSize.width === 0 || naturalSize.height === 0) {
      return { left: 0, top: 0, width: 0, height: 0 };
    }
    const imageRatio: number = naturalSize.width / naturalSize.height;
    const stageRatio: number = stageSize.width / stageSize.height;
    if (imageRatio > stageRatio) {
      const height: number = stageSize.width / imageRatio;
      return { left: 0, top: (stageSize.height - height) / 2, width: stageSize.width, height };
    }
    const width: number = stageSize.height * imageRatio;
    return { left: (stageSize.width - width) / 2, top: 0, width, height: stageSize.height };
  }, [stageSize, naturalSize, page?.imageUrl]);

  function updateFromPointer(markerId: string, event: ReactPointerEvent<HTMLDivElement>): void {
    const stageElement: HTMLDivElement | null = stageRef.current;
    if (stageElement === null || imageBounds.width === 0 || imageBounds.height === 0) return;
    const stageRect: DOMRect = stageElement.getBoundingClientRect();
    const localX: number = event.clientX - stageRect.left - imageBounds.left;
    const localY: number = event.clientY - stageRect.top - imageBounds.top;
    const x: number = Math.max(0, Math.min(100, (localX / imageBounds.width) * 100));
    const y: number = Math.max(0, Math.min(100, (localY / imageBounds.height) * 100));
    onMoveMarker(markerId, x, y);
  }

  function handlePointerDown(markerId: string, event: ReactPointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    draggingMarkerId.current = markerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const markerId: string | null = draggingMarkerId.current;
    if (markerId !== null && event.buttons > 0) updateFromPointer(markerId, event);
  }

  function handlePointerEnd(): void {
    draggingMarkerId.current = null;
  }

  if (page === null) {
    return (
      <div className="canvas-empty">
        <div className="empty-art" aria-hidden="true"><span>＋</span></div>
        <h2>請先選取或新增測點頁面</h2>
        <p>每個測點頁面有自己的底圖與唯一 Name，選取後即可編輯圖示位置與警報文字。</p>
      </div>
    );
  }

  return (
    <div className="plan-stage" ref={stageRef} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd}>
      {page.imageUrl.length > 0 ? (
        <img
          key={page.imageUrl}
          className="plan-stage-image"
          style={imageBounds.width > 0 && imageBounds.height > 0 ? { inset: 'auto', left: imageBounds.left, top: imageBounds.top, width: imageBounds.width, height: imageBounds.height } : undefined}
          src={page.imageUrl}
          alt={`${page.name}平面圖`}
          draggable={false}
          onLoad={(event) => setNaturalSize({ imageUrl: page.imageUrl, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        />
      ) : (
        <div className="plan-image-empty">
          <span className="empty-image-icon">▧</span>
          <strong>尚未上傳平面圖</strong>
          <span>使用上方「上傳平面圖」加入 PNG 或 JPEG</span>
        </div>
      )}
      {page.imageUrl.length > 0 && imageBounds.width > 0 && imageBounds.height > 0 && (
        <div
          className="marker-layer"
          style={{ left: imageBounds.left, top: imageBounds.top, width: imageBounds.width, height: imageBounds.height } as CSSProperties}
        >
          {marker !== null && marker.pageId === page.id && marker.shouldShowExitIcon !== true && (
              <button
                key={marker.id}
                className="plan-marker is-selected"
                type="button"
                style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                title={marker.text || marker.name}
                aria-label={`${marker.name} 警報圖示`}
                onPointerDown={(event) => handlePointerDown(marker.id, event)}
                onPointerUp={handlePointerEnd}
              >
                <AlarmIcon iconKind={marker.iconKind} iconUrl={marker.iconUrl} color={marker.color} size={marker.size} shouldBlink={previewEnabled && marker.shouldBlink} />
              </button>
          )}
          {previewEnabled && <span className="preview-badge">模擬預覽</span>}
        </div>
      )}
    </div>
  );
}
