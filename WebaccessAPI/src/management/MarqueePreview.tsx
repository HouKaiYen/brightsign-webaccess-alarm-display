import { useEffect, useRef, type JSX, type RefObject } from 'react';
import type { IdleMarquee } from '../../shared/contracts';
import { MarqueeRenderer } from '../display/marquee';

export function MarqueePreview({ settings, className }: { settings: IdleMarquee; className: string }): JSX.Element {
  const hostRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const contentRef: RefObject<HTMLSpanElement | null> = useRef<HTMLSpanElement>(null);
  const rendererRef: RefObject<MarqueeRenderer | null> = useRef<MarqueeRenderer | null>(null);
  useEffect(() => {
    if (hostRef.current === null || contentRef.current === null) return;
    const renderer: MarqueeRenderer = new MarqueeRenderer(hostRef.current, contentRef.current);
    rendererRef.current = renderer;
    return () => { renderer.dispose(); rendererRef.current = null; };
  }, []);
  useEffect(() => { rendererRef.current?.update(settings); }, [settings]);
  return <div ref={hostRef} className={className} aria-label="跑馬燈預覽"><span ref={contentRef} className="management-ticker-content" /></div>;
}
