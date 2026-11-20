"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CelebrationEvent } from "@/lib/research/celebration";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  vRot: number;
  alpha: number;
  shape: "rect" | "circle";
};

const PALETTE = ["#785ef0", "#648fff", "#dc267f", "#fe6100", "#ffb000", "#10b981", "#38bdf8"];

export function CelebrationOverlay({ project }: { project: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [banner, setBanner] = useState<{ id: string; emoji: string; reason: string } | null>(null);

  const launchBurst = useCallback((event: CelebrationEvent) => {
    setBanner({ id: event.id, emoji: event.emoji || "🎉", reason: event.reason });
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setBanner(null), 4800);

    const cardEl = event.scope === "card" && event.nodeId
      ? document.querySelector<HTMLElement>(`[data-mind-node="${CSS.escape(event.nodeId)}"]`)
      : null;

    if (cardEl) {
      cardEl.animate(
        [
          { boxShadow: "0 0 0 0 rgb(var(--accent) / 0.55)", transform: "scale(1)" },
          { boxShadow: "0 0 0 12px rgb(var(--accent) / 0)", transform: "scale(1.025)" },
          { boxShadow: "0 0 0 0 rgb(var(--accent) / 0)", transform: "scale(1)" },
        ],
        { duration: 900, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const particles = particlesRef.current;
    if (cardEl) {
      const rect = cardEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      for (let i = 0; i < 46; i += 1) {
        const angle = (Math.PI * 2 * i) / 46 + (Math.random() - 0.5) * 0.3;
        const speed = 2.6 + Math.random() * 5.2;
        particles.push({
          x: cx + (Math.random() - 0.5) * Math.min(rect.width * 0.5, 80),
          y: cy + (Math.random() - 0.5) * Math.min(rect.height * 0.4, 40),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2.4,
          size: 4 + Math.random() * 4,
          color: PALETTE[i % PALETTE.length]!,
          rotation: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 0.25,
          alpha: 1,
          shape: i % 3 === 0 ? "circle" : "rect",
        });
      }
    } else {
      for (let i = 0; i < 95; i += 1) {
        const fromLeft = i % 2 === 0;
        const originX = fromLeft ? width * 0.16 : width * 0.84;
        const originY = height * 0.24;
        const angle = fromLeft
          ? -Math.PI * 0.22 + (Math.random() - 0.5) * 0.9
          : -Math.PI * 0.78 + (Math.random() - 0.5) * 0.9;
        const speed = 4.5 + Math.random() * 7.5;
        particles.push({
          x: originX + (Math.random() - 0.5) * 32,
          y: originY + (Math.random() - 0.5) * 24,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.5,
          size: 5 + Math.random() * 5,
          color: PALETTE[i % PALETTE.length]!,
          rotation: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 0.22,
          alpha: 1,
          shape: i % 4 === 0 ? "circle" : "rect",
        });
      }
    }

    if (rafRef.current !== null) return;
    const step = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const alive: Particle[] = [];
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.985;
        p.vy = p.vy * 0.985 + 0.16;
        p.rotation += p.vRot;
        p.alpha -= 0.011;
        if (p.alpha <= 0.02 || p.y > height + 40) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        }
        ctx.restore();
        alive.push(p);
      }
      particlesRef.current = alive;
      if (alive.length > 0) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        ctx.clearRect(0, 0, width, height);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    let active = true;
    const endpoint = `/api/p/${encodeURIComponent(project)}/celebration`;
    const check = async () => {
      if (!active || document.visibilityState !== "visible" || !document.hasFocus()) return;
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as { ok?: boolean; pending?: CelebrationEvent[] };
        const fresh = (data.pending || []).filter((item) => !seenRef.current.has(item.id));
        if (!fresh.length || !active) return;
        for (const item of fresh) seenRef.current.add(item.id);
        void fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "consume", ids: fresh.map((item) => item.id) }),
        }).catch(() => {});
        fresh.forEach((item, index) => {
          window.setTimeout(() => { if (active) launchBurst(item); }, index * 650);
        });
      } catch { /* Celebration polling is best-effort. */ }
    };
    const onFocus = () => { void check(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void check(); };
    void check();
    const interval = window.setInterval(() => { void check(); }, 12_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [launchBurst, project]);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[120]"
      />
      {banner && (
        <button
          type="button"
          onClick={() => setBanner(null)}
          role="status"
          aria-live="polite"
          className="p-glass-sm fixed left-1/2 top-4 z-[121] flex max-w-[min(92vw,480px)] -translate-x-1/2 items-center gap-2 rounded-full border border-accent/30 px-4 py-2 text-xs font-medium text-ink shadow-lg transition-all hover:scale-[1.01]"
        >
          <span aria-hidden="true" className="text-sm leading-none">{banner.emoji}</span>
          <span className="truncate">{banner.reason}</span>
        </button>
      )}
    </>
  );
}
