import React, { useEffect, useRef, useState } from 'react';
import createGlobe from 'cobe';

export interface GlobeMarker {
  lat: number;
  lon: number;
  hits: number;
  label: string;
}

interface GlobeViewProps {
  markers: GlobeMarker[];
  /** Rendered when there is no traffic to plot yet. */
  emptyMessage?: string;
}

/**
 * Rotating globe with one marker per city that generated traffic.
 *
 * Marker size is scaled by hit count on a logarithmic curve: linear scaling
 * makes a single busy city swallow the globe and hides everywhere else.
 */
export const GlobeView: React.FC<GlobeViewProps> = ({ markers, emptyMessage }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const phiRef = useRef(0);
  const pointerRef = useRef<{ dragging: boolean; startX: number; startPhi: number }>({
    dragging: false,
    startX: 0,
    startPhi: 0,
  });
  const [size, setSize] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setSize(Math.floor(width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!canvasRef.current || size === 0) return;

    const maxHits = Math.max(1, ...markers.map((m) => m.hits));
    const globeMarkers = markers.map((m) => ({
      location: [m.lat, m.lon] as [number, number],
      size: 0.03 + (Math.log10(1 + m.hits) / Math.log10(1 + maxHits)) * 0.06,
    }));

    // cobe expects width/height in backing-store pixels, which is the CSS size
    // multiplied by the ratio it is given. Hardcoding a factor of 2 while
    // passing a ratio of 1 on a standard display renders the globe at the
    // wrong scale.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const globe = createGlobe(canvasRef.current, {
      devicePixelRatio: dpr,
      width: size * dpr,
      height: size * dpr,
      phi: phiRef.current,
      theta: 0.25,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 16000,
      mapBrightness: 5,
      baseColor: [0.18, 0.22, 0.35],
      markerColor: [0.35, 0.85, 0.75],
      glowColor: [0.12, 0.16, 0.28],
      markers: globeMarkers,
    });

    // Rotation is driven through the typed update() API rather than the
    // untyped onRender hook, which cobe v2 no longer declares.
    let frame = 0;
    const tick = () => {
      if (!pointerRef.current.dragging) {
        phiRef.current += 0.0035;
      }
      globe.update({ phi: phiRef.current });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      globe.destroy();
    };
  }, [markers, size]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerRef.current = { dragging: true, startX: e.clientX, startPhi: phiRef.current };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointerRef.current.dragging) return;
    const delta = e.clientX - pointerRef.current.startX;
    phiRef.current = pointerRef.current.startPhi + delta / 200;
  };

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerRef.current.dragging = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div ref={containerRef} className="relative w-full aspect-square max-w-[460px] mx-auto">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        style={{ width: size, height: size, cursor: 'grab', touchAction: 'none' }}
        className="select-none"
      />

      {markers.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-xs text-on-surface-variant text-center max-w-[220px] bg-surface-container-lowest/80 backdrop-blur px-4 py-3 rounded-xl border border-outline-variant">
            {emptyMessage || 'Nenhum acesso localizado ainda.'}
          </p>
        </div>
      )}
    </div>
  );
};
