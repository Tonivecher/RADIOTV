import { RefObject, useEffect, useState } from 'react';

export interface CanvasMetrics {
  /** CSS pixel width of the canvas box. */
  width: number;
  /** CSS pixel height of the canvas box. */
  height: number;
  /** Device pixel ratio the backing store was sized for. */
  dpr: number;
}

const MAX_DPR = 3;

function readDpr(): number {
  return Math.max(1, Math.min(MAX_DPR, window.devicePixelRatio || 1));
}

/**
 * Keeps a canvas backing store matched to its CSS box × devicePixelRatio.
 * Returns the current metrics; consumers should redraw when they change
 * (resizing a canvas clears it).
 *
 * Draw with `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` and CSS-pixel coordinates.
 */
export function useHiDpiCanvas(canvasRef: RefObject<HTMLCanvasElement | null>): CanvasMetrics {
  const [metrics, setMetrics] = useState<CanvasMetrics>({ width: 0, height: 0, dpr: 1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const apply = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = readDpr();
      const bufW = Math.max(1, Math.round(width * dpr));
      const bufH = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== bufW) canvas.width = bufW;
      if (canvas.height !== bufH) canvas.height = bufH;
      setMetrics((prev) =>
        prev.width === width && prev.height === height && prev.dpr === dpr
          ? prev
          : { width, height, dpr }
      );
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(canvas);

    // Browser zoom / moving the window between displays changes DPR without resizing the box.
    let mql: MediaQueryList | null = null;
    const onDprChange = () => {
      apply();
      bindDprWatcher();
    };
    const bindDprWatcher = () => {
      mql?.removeEventListener('change', onDprChange);
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mql.addEventListener('change', onDprChange, { once: true });
    };
    bindDprWatcher();

    return () => {
      observer.disconnect();
      mql?.removeEventListener('change', onDprChange);
    };
  }, [canvasRef]);

  return metrics;
}
