import React, { useLayoutEffect, useRef, useState } from 'react';

// Shrinks a fixed-width document to fit a phone screen (print uses the real size).
export default function FitWidth({ width, children }: { width: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setZoom(Math.min(1, el.clientWidth / width));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={ref} className="w-full">
      <div className="fit-width print:!w-auto" style={zoom < 1 ? { width, zoom } : undefined}>{children}</div>
      <style>{'@media print { .fit-width { zoom: 1 !important; width: auto !important; } }'}</style>
    </div>
  );
}
