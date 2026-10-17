"use client";
import { useEffect, useRef } from "react";

export type Pulse = "flat" | "weak" | "alive";

// A pixel ECG. Flat until the build and health checks pass.
export default function Heartbeat({ pulse, height = 44 }: { pulse: Pulse; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const px = 3;
    let raf = 0;
    let x = 0;
    let last = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cols = () => Math.floor(canvas.width / px);
    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = height;
      ctx.fillStyle = "#120c22";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    resize();
    const beat = [0, 0, 0, 1, 0, -1, 0, 5, -7, 2, 0, 0, 1, 2, 1, 0];
    const weak = [0, 0, 1, 0, 0, -1, 2, -1, 0, 0];
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 28) return;
      last = t;
      const mode = pulse;
      const mid = Math.floor(canvas.height / px / 2);
      const period = mode === "alive" ? 28 : 46;
      const phase = x % period;
      const shape = mode === "alive" ? beat : weak;
      const dy = mode === "flat" ? 0 : phase < shape.length ? shape[phase] : 0;
      // erase ahead
      ctx.fillStyle = "#120c22";
      ctx.fillRect(((x + 1) % cols()) * px, 0, px * 6, canvas.height);
      ctx.fillStyle = mode === "alive" ? "#7dff8a" : mode === "weak" ? "#ffb648" : "#5b5478";
      const y = mid - dy;
      const prevY = mid - (mode === "flat" ? 0 : phase - 1 >= 0 && phase - 1 < shape.length ? shape[phase - 1] : 0);
      const top = Math.min(y, prevY), bot = Math.max(y, prevY);
      ctx.fillRect((x % cols()) * px, top * px, px, (bot - top + 1) * px);
      x++;
    };
    if (reduce) {
      ctx.fillStyle = pulse === "alive" ? "#7dff8a" : "#5b5478";
      ctx.fillRect(0, Math.floor(height / 2), canvas.width, px);
    } else {
      raf = requestAnimationFrame(draw);
    }
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [height, pulse]);

  return (
    <canvas
      ref={ref}
      className="heartbeat"
      style={{ height }}
      role="img"
      aria-label={pulse === "alive" ? "Heartbeat: alive" : pulse === "weak" ? "Heartbeat: weak, reviving" : "Heartbeat: flatline"}
    />
  );
}
