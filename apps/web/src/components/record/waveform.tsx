"use client";

import { useEffect, useRef } from "react";

/**
 * Live waveform drawn on a canvas from the recorder's real level history.
 * Runs its own rAF loop only while `active`.
 */
export function Waveform({ barsRef, active, dim, className }: { barsRef: React.RefObject<number[]>; active: boolean; dim?: boolean; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const bars = barsRef.current ?? [];
      const n = bars.length;
      if (n === 0) return;
      const gap = 3;
      const barW = Math.max(2, (w - gap * (n - 1)) / n);
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, dim ? "rgba(199,185,255,0.25)" : "rgba(199,185,255,0.35)");
      grad.addColorStop(0.6, dim ? "rgba(199,185,255,0.45)" : "rgba(214,204,255,0.95)");
      grad.addColorStop(1, dim ? "rgba(167,220,230,0.45)" : "rgba(167,220,230,0.95)");
      ctx.fillStyle = grad;
      for (let i = 0; i < n; i++) {
        const v = bars[i] ?? 0;
        const bh = Math.max(3, v * (h - 4));
        const x = i * (barW + gap);
        const y = (h - bh) / 2;
        const r = Math.min(barW / 2, bh / 2);
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, barW, bh, r);
        else ctx.rect(x, y, barW, bh);
        ctx.fill();
      }
      if (active) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active, barsRef, dim]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
