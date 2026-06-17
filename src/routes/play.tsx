import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

const searchSchema = z.object({
  room: z.string().min(1).max(32).default("school"),
  name: z.string().min(1).max(14).default("anon"),
});

export const Route = createFileRoute("/play")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "ORBZ.IO — Live Arena" },
      { name: "description", content: "Real-time multiplayer arena. Eat, grow, dominate." },
    ],
  }),
  component: Play,
});

// ---------- Game constants ----------
const WORLD = 4000;
const ORB_COUNT = 600;
const START_MASS = 20;
const MAX_MASS = 5000;
const EAT_RATIO = 1.25; // bigger must be 25% larger
const TICK_HZ = 30;     // broadcast rate
const HUES = [140, 200, 320, 50, 280, 10, 170];

type RemotePlayer = {
  id: string;
  name: string;
  hue: number;
  x: number;
  y: number;
  mass: number;
  lastSeen: number;
};

type Orb = { id: number; x: number; y: number; hue: number };

function massToRadius(m: number) { return 6 + Math.sqrt(m) * 4; }
function speedFor(m: number) { return 4.2 / (1 + Math.sqrt(m) / 18); }

function Play() {
  const { room, name } = Route.useSearch();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hud, setHud] = useState({ mass: START_MASS, players: 1, rank: 1, fps: 0 });
  const [leaderboard, setLeaderboard] = useState<{ name: string; mass: number; me: boolean }[]>([]);
  const [dead, setDead] = useState<null | { by: string }>(null);

  const myIdRef = useRef<string>(crypto.randomUUID());
  const hueRef = useRef<number>(HUES[Math.floor(Math.random() * HUES.length)]);

  // mutable game state held in refs to avoid React re-renders per frame
  const stateRef = useRef({
    me: { x: WORLD / 2 + (Math.random() - 0.5) * 200, y: WORLD / 2 + (Math.random() - 0.5) * 200, mass: START_MASS, name },
    mouse: { x: 0, y: 0 }, // viewport
    cam: { x: WORLD / 2, y: WORLD / 2, zoom: 1 },
    orbs: [] as Orb[],
    remote: new Map<string, RemotePlayer>(),
    eatenOrbs: new Set<number>(),
    lastFrame: 0,
    fpsAccum: 0,
    fpsFrames: 0,
  });

  // init orbs
  useMemo(() => {
    const arr: Orb[] = [];
    for (let i = 0; i < ORB_COUNT; i++) {
      arr.push({
        id: i,
        x: Math.random() * WORLD,
        y: Math.random() * WORLD,
        hue: HUES[Math.floor(Math.random() * HUES.length)],
      });
    }
    stateRef.current.orbs = arr;
  }, []);

  // realtime channel
  useEffect(() => {
    let channel: any;
    let broadcastTimer: any;
    let pruneTimer: any;
    let stopped = false;

    (async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      channel = supabase.channel(`arena:${room}`, {
        config: { broadcast: { self: false }, presence: { key: myIdRef.current } },
      });

      channel
        .on("broadcast", { event: "state" }, ({ payload }: any) => {
          const p = payload as RemotePlayer;
          if (p.id === myIdRef.current) return;
          p.lastSeen = performance.now();
          stateRef.current.remote.set(p.id, p);
        })
        .on("broadcast", { event: "eat-orb" }, ({ payload }: any) => {
          stateRef.current.eatenOrbs.add(payload.id);
          // respawn elsewhere after delay so world stays full
          setTimeout(() => {
            const orb = stateRef.current.orbs[payload.id];
            if (!orb) return;
            orb.x = Math.random() * WORLD;
            orb.y = Math.random() * WORLD;
            orb.hue = HUES[Math.floor(Math.random() * HUES.length)];
            stateRef.current.eatenOrbs.delete(payload.id);
          }, 4000);
        })
        .on("broadcast", { event: "died" }, ({ payload }: any) => {
          stateRef.current.remote.delete(payload.id);
        })
        .on("presence", { event: "leave" }, ({ key }: any) => {
          stateRef.current.remote.delete(key);
        })
        .subscribe(async (status: string) => {
          if (status === "SUBSCRIBED") {
            await channel.track({ name, hue: hueRef.current });
          }
        });

      broadcastTimer = setInterval(() => {
        if (stopped) return;
        const { me } = stateRef.current;
        channel.send({
          type: "broadcast",
          event: "state",
          payload: {
            id: myIdRef.current, name, hue: hueRef.current,
            x: me.x, y: me.y, mass: me.mass,
          },
        });
      }, 1000 / TICK_HZ);

      pruneTimer = setInterval(() => {
        const now = performance.now();
        for (const [id, p] of stateRef.current.remote) {
          if (now - p.lastSeen > 6000) stateRef.current.remote.delete(id);
        }
      }, 2000);
    })();

    return () => {
      stopped = true;
      clearInterval(broadcastTimer);
      clearInterval(pruneTimer);
      (async () => {
        const { supabase } = await import("@/integrations/supabase/client");
        if (channel) {
          channel.send({ type: "broadcast", event: "died", payload: { id: myIdRef.current } });
          supabase.removeChannel(channel);
        }
      })();
    };
  }, [room, name]);

  // input + game loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let rafId = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const onMove = (e: PointerEvent) => {
      stateRef.current.mouse.x = e.clientX;
      stateRef.current.mouse.y = e.clientY;
    };
    window.addEventListener("pointermove", onMove);

    let lastHudUpdate = 0;
    let broadcastEatBuffer: number[] = [];
    let eatFlush = setInterval(async () => {
      if (!broadcastEatBuffer.length) return;
      const ids = broadcastEatBuffer.splice(0);
      const { supabase } = await import("@/integrations/supabase/client");
      const ch = supabase.getChannels().find((c) => c.topic === `realtime:arena:${room}`);
      if (!ch) return;
      for (const id of ids) {
        ch.send({ type: "broadcast", event: "eat-orb", payload: { id } });
      }
    }, 100);

    const tick = (t: number) => {
      const s = stateRef.current;
      const dt = Math.min(1 / 30, (t - s.lastFrame) / 1000 || 1 / 60);
      s.lastFrame = t;
      s.fpsAccum += dt; s.fpsFrames++;

      // --- move me toward mouse ---
      const w = window.innerWidth, h = window.innerHeight;
      const worldMouseX = s.cam.x + (s.mouse.x - w / 2) / s.cam.zoom;
      const worldMouseY = s.cam.y + (s.mouse.y - h / 2) / s.cam.zoom;
      const dx = worldMouseX - s.me.x;
      const dy = worldMouseY - s.me.y;
      const d = Math.hypot(dx, dy);
      if (d > 1) {
        const sp = speedFor(s.me.mass) * 60 * dt;
        const f = Math.min(sp, d) / d;
        s.me.x += dx * f;
        s.me.y += dy * f;
      }
      s.me.x = Math.max(0, Math.min(WORLD, s.me.x));
      s.me.y = Math.max(0, Math.min(WORLD, s.me.y));

      // --- eat orbs ---
      const r = massToRadius(s.me.mass);
      for (const orb of s.orbs) {
        if (s.eatenOrbs.has(orb.id)) continue;
        const odx = orb.x - s.me.x, ody = orb.y - s.me.y;
        if (odx * odx + ody * ody < r * r) {
          s.eatenOrbs.add(orb.id);
          s.me.mass = Math.min(MAX_MASS, s.me.mass + 1);
          broadcastEatBuffer.push(orb.id);
          setTimeout(() => {
            orb.x = Math.random() * WORLD;
            orb.y = Math.random() * WORLD;
            orb.hue = HUES[Math.floor(Math.random() * HUES.length)];
            s.eatenOrbs.delete(orb.id);
          }, 4000);
        }
      }

      // --- player collisions ---
      for (const p of s.remote.values()) {
        const pr = massToRadius(p.mass);
        const pdx = p.x - s.me.x, pdy = p.y - s.me.y;
        const dist = Math.hypot(pdx, pdy);
        if (dist < Math.max(r, pr) * 0.85) {
          if (s.me.mass > p.mass * EAT_RATIO) {
            s.me.mass = Math.min(MAX_MASS, s.me.mass + p.mass * 0.8);
            s.remote.delete(p.id);
          } else if (p.mass > s.me.mass * EAT_RATIO && !dead) {
            setDead({ by: p.name });
            return; // stop loop until respawn
          }
        }
      }

      // --- camera zoom by mass ---
      const targetZoom = Math.max(0.45, Math.min(1.2, 1.4 - Math.sqrt(s.me.mass) / 35));
      s.cam.zoom += (targetZoom - s.cam.zoom) * 0.08;
      s.cam.x += (s.me.x - s.cam.x) * 0.15;
      s.cam.y += (s.me.y - s.cam.y) * 0.15;

      // --- render ---
      ctx.fillStyle = "#0e0b1a";
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(s.cam.zoom, s.cam.zoom);
      ctx.translate(-s.cam.x, -s.cam.y);

      // grid
      const grid = 100;
      const x0 = Math.floor((s.cam.x - w / 2 / s.cam.zoom) / grid) * grid;
      const y0 = Math.floor((s.cam.y - h / 2 / s.cam.zoom) / grid) * grid;
      const x1 = s.cam.x + w / 2 / s.cam.zoom;
      const y1 = s.cam.y + h / 2 / s.cam.zoom;
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      for (let x = x0; x < x1; x += grid) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      for (let y = y0; y < y1; y += grid) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.stroke();

      // world border
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, WORLD, WORLD);

      // orbs
      for (const orb of s.orbs) {
        if (s.eatenOrbs.has(orb.id)) continue;
        if (orb.x < x0 - 50 || orb.x > x1 + 50 || orb.y < y0 - 50 || orb.y > y1 + 50) continue;
        ctx.beginPath();
        ctx.fillStyle = `oklch(0.78 0.22 ${orb.hue})`;
        ctx.shadowColor = `oklch(0.78 0.22 ${orb.hue})`;
        ctx.shadowBlur = 12;
        ctx.arc(orb.x, orb.y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // players (remote + me) sorted by mass small first
      const drawList: { x: number; y: number; mass: number; name: string; hue: number; me: boolean }[] = [];
      for (const p of s.remote.values()) drawList.push({ ...p, me: false });
      drawList.push({ x: s.me.x, y: s.me.y, mass: s.me.mass, name: s.me.name, hue: hueRef.current, me: true });
      drawList.sort((a, b) => a.mass - b.mass);

      for (const p of drawList) {
        const pr = massToRadius(p.mass);
        ctx.beginPath();
        const grad = ctx.createRadialGradient(p.x, p.y, pr * 0.2, p.x, p.y, pr);
        grad.addColorStop(0, `oklch(0.85 0.22 ${p.hue})`);
        grad.addColorStop(1, `oklch(0.55 0.22 ${p.hue})`);
        ctx.fillStyle = grad;
        ctx.shadowColor = `oklch(0.78 0.22 ${p.hue})`;
        ctx.shadowBlur = p.me ? 30 : 18;
        ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = p.me ? 3 : 2;
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.stroke();

        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = `700 ${Math.max(12, pr * 0.45)}px Space Grotesk, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.name, p.x, p.y - 4);
        ctx.font = `500 ${Math.max(10, pr * 0.3)}px JetBrains Mono, monospace`;
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText(String(Math.floor(p.mass)), p.x, p.y + pr * 0.35);
      }

      ctx.restore();

      // --- mini-map ---
      const mm = 160;
      const pad = 16;
      ctx.fillStyle = "rgba(10,8,20,0.7)";
      ctx.fillRect(w - mm - pad, h - mm - pad, mm, mm);
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.strokeRect(w - mm - pad, h - mm - pad, mm, mm);
      const mmScale = mm / WORLD;
      for (const p of s.remote.values()) {
        ctx.fillStyle = `oklch(0.78 0.22 ${p.hue})`;
        ctx.fillRect(w - mm - pad + p.x * mmScale - 1, h - mm - pad + p.y * mmScale - 1, 3, 3);
      }
      ctx.fillStyle = `oklch(0.9 0.25 ${hueRef.current})`;
      ctx.fillRect(w - mm - pad + s.me.x * mmScale - 2, h - mm - pad + s.me.y * mmScale - 2, 5, 5);

      // hud throttled
      if (t - lastHudUpdate > 300) {
        lastHudUpdate = t;
        const all = [...drawList].sort((a, b) => b.mass - a.mass);
        const rank = all.findIndex((p) => p.me) + 1;
        const fps = s.fpsFrames / Math.max(0.001, s.fpsAccum);
        s.fpsAccum = 0; s.fpsFrames = 0;
        setHud({ mass: Math.floor(s.me.mass), players: s.remote.size + 1, rank, fps: Math.round(fps) });
        setLeaderboard(
          all.slice(0, 8).map((p) => ({ name: p.name, mass: Math.floor(p.mass), me: p.me }))
        );
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(eatFlush);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, [dead, room]);

  const respawn = () => {
    const s = stateRef.current;
    s.me.x = Math.random() * WORLD;
    s.me.y = Math.random() * WORLD;
    s.me.mass = START_MASS;
    hueRef.current = HUES[Math.floor(Math.random() * HUES.length)];
    setDead(null);
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 touch-none" />

      {/* HUD top-left */}
      <div className="pointer-events-none absolute top-4 left-4 panel rounded-2xl px-4 py-3">
        <div className="flex items-center gap-4">
          <Link to="/" className="pointer-events-auto text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground">← Lobby</Link>
          <div className="h-4 w-px bg-border" />
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Room</div>
          <div className="font-bold">{room}</div>
        </div>
        <div className="mt-2 flex items-center gap-5 text-sm">
          <Stat label="Mass" value={hud.mass} accent="var(--neon-green)" />
          <Stat label="Rank" value={`#${hud.rank}`} accent="var(--neon-pink)" />
          <Stat label="Players" value={hud.players} accent="var(--neon-cyan)" />
          <Stat label="FPS" value={hud.fps} accent="var(--muted-foreground)" />
        </div>
      </div>

      {/* Leaderboard top-right */}
      <div className="pointer-events-none absolute top-4 right-4 panel rounded-2xl px-4 py-3 min-w-[200px]">
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Leaderboard</div>
        <ol className="mt-2 space-y-1 text-sm">
          {leaderboard.map((p, i) => (
            <li key={p.name + i} className={`flex justify-between gap-3 ${p.me ? "font-bold" : ""}`} style={p.me ? { color: "var(--neon-green)" } : undefined}>
              <span className="truncate">{i + 1}. {p.name}</span>
              <span className="font-mono text-muted-foreground">{p.mass}</span>
            </li>
          ))}
          {leaderboard.length === 0 && <li className="text-muted-foreground text-xs">Waiting for players…</li>}
        </ol>
      </div>

      {/* Share bar bottom-center */}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 panel rounded-full px-4 py-2 text-xs font-mono">
        <button
          onClick={() => {
            if (typeof window === "undefined") return;
            navigator.clipboard?.writeText(`${window.location.origin}/play?room=${room}`);
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          📋 Copy invite link — get the whole school in
        </button>
      </div>

      {/* Death overlay */}
      {dead && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="panel rounded-3xl p-10 text-center max-w-sm">
            <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">You got absorbed by</div>
            <div className="mt-1 text-4xl font-black text-glow-pink" style={{ color: "var(--neon-pink)" }}>{dead.by}</div>
            <div className="mt-4 text-sm text-muted-foreground">Final mass: <span className="font-mono text-foreground">{hud.mass}</span></div>
            <div className="mt-6 flex gap-2 justify-center">
              <button onClick={respawn} className="btn-neon rounded-xl px-6 py-3 font-black">Respawn</button>
              <Link to="/" className="rounded-xl border border-border px-6 py-3 font-bold">Lobby</Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="flex flex-col leading-none">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="font-black text-lg" style={{ color: accent }}>{value}</span>
    </div>
  );
}
