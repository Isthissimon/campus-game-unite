import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

const searchSchema = z.object({
  room: z.string().min(1).max(32).default("00000000"),
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
const EAT_RATIO = 1.25;
const TICK_HZ = 30;
const HUES = [140, 200, 320, 50, 280, 10, 170];
const TARGET_TOTAL = 8; // top up with bots until this many entities
const MAX_BOTS = 12;

const BOT_NAMES = [
  "void", "neo", "blip", "zap", "echo", "comet", "pixel", "lumen",
  "drift", "nova", "spark", "rune", "glitch", "halo", "onyx", "vex",
];

type RemotePlayer = {
  id: string;
  name: string;
  hue: number;
  x: number;
  y: number;
  mass: number;
  lastSeen: number;
};

type Bot = {
  id: string;
  name: string;
  hue: number;
  x: number;
  y: number;
  mass: number;
  vx: number;
  vy: number;
  retargetAt: number;
  tx: number;
  ty: number;
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
  const [copied, setCopied] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [massInput, setMassInput] = useState("");
  const [codeMsg, setCodeMsg] = useState<string | null>(null);

  const myIdRef = useRef<string>(crypto.randomUUID());
  const channelRef = useRef<any>(null);
  const hueRef = useRef<number>(HUES[Math.floor(Math.random() * HUES.length)]);
  const dpadRef = useRef<{ dx: number; dy: number; active: boolean }>({ dx: 0, dy: 0, active: false });

  const stateRef = useRef({
    me: { x: WORLD / 2 + (Math.random() - 0.5) * 200, y: WORLD / 2 + (Math.random() - 0.5) * 200, mass: START_MASS, name },
    mouse: { x: 0, y: 0 },
    cam: { x: WORLD / 2, y: WORLD / 2, zoom: 1 },
    orbs: [] as Orb[],
    remote: new Map<string, RemotePlayer>(),
    bots: new Map<string, Bot>(),
    eatenOrbs: new Set<number>(),
    lastFrame: 0,
    fpsAccum: 0,
    fpsFrames: 0,
  });

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

  // realtime
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
      channelRef.current = channel;

      channel
        .on("broadcast", { event: "state" }, ({ payload }: any) => {
          const p = payload as RemotePlayer;
          if (p.id === myIdRef.current) return;
          p.lastSeen = performance.now();
          stateRef.current.remote.set(p.id, p);
        })
        .on("broadcast", { event: "eat-orb" }, ({ payload }: any) => {
          stateRef.current.eatenOrbs.add(payload.id);
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
          payload: { id: myIdRef.current, name, hue: hueRef.current, x: me.x, y: me.y, mass: me.mass },
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

  // bot maintenance
  useEffect(() => {
    const spawnBot = (): Bot => {
      const id = "bot_" + Math.random().toString(36).slice(2, 9);
      return {
        id,
        name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + Math.floor(Math.random() * 90 + 10),
        hue: HUES[Math.floor(Math.random() * HUES.length)],
        x: Math.random() * WORLD,
        y: Math.random() * WORLD,
        mass: START_MASS + Math.random() * 60,
        vx: 0, vy: 0,
        retargetAt: 0,
        tx: Math.random() * WORLD,
        ty: Math.random() * WORLD,
      };
    };
    const tick = () => {
      const s = stateRef.current;
      const real = s.remote.size + 1;
      const desiredBots = Math.max(0, Math.min(MAX_BOTS, TARGET_TOTAL - real));
      while (s.bots.size < desiredBots) {
        const b = spawnBot();
        s.bots.set(b.id, b);
      }
      // remove excess bots gracefully
      if (s.bots.size > desiredBots) {
        const extras = s.bots.size - desiredBots;
        const ids = Array.from(s.bots.keys()).slice(0, extras);
        for (const id of ids) s.bots.delete(id);
      }
    };
    tick();
    const iv = setInterval(tick, 800);
    return () => clearInterval(iv);
  }, []);

  // input + loop
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

    const keys = new Set<string>();
    const updateDpadFromKeys = () => {
      let dx = 0, dy = 0;
      if (keys.has("ArrowUp") || keys.has("w") || keys.has("W")) dy -= 1;
      if (keys.has("ArrowDown") || keys.has("s") || keys.has("S")) dy += 1;
      if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) dx -= 1;
      if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) dx += 1;
      dpadRef.current = { dx: dx * 200, dy: dy * 200, active: dx !== 0 || dy !== 0 };
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) e.preventDefault();
      keys.add(e.key);
      updateDpadFromKeys();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.key);
      updateDpadFromKeys();
    };
    const onBlur = () => { keys.clear(); updateDpadFromKeys(); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    try { window.focus(); } catch {}

    let lastHudUpdate = 0;
    let broadcastEatBuffer: number[] = [];
    const eatFlush = setInterval(() => {
      if (!broadcastEatBuffer.length) return;
      const ch = channelRef.current;
      if (!ch) return;
      const ids = broadcastEatBuffer.splice(0);
      for (const id of ids) ch.send({ type: "broadcast", event: "eat-orb", payload: { id } });
    }, 100);

    const tick = (t: number) => {
      const s = stateRef.current;
      const dt = Math.min(1 / 30, (t - s.lastFrame) / 1000 || 1 / 60);
      s.lastFrame = t;
      s.fpsAccum += dt; s.fpsFrames++;

      // --- player input: d-pad or cursor ---
      const w = window.innerWidth, h = window.innerHeight;
      let mvx = 0, mvy = 0;
      if (dpadRef.current.active) {
        mvx = dpadRef.current.dx;
        mvy = dpadRef.current.dy;
      } else {
        const wmx = s.cam.x + (s.mouse.x - w / 2) / s.cam.zoom;
        const wmy = s.cam.y + (s.mouse.y - h / 2) / s.cam.zoom;
        mvx = wmx - s.me.x;
        mvy = wmy - s.me.y;
      }
      const md = Math.hypot(mvx, mvy);
      if (md > 1) {
        const sp = speedFor(s.me.mass) * 60 * dt;
        const f = Math.min(sp, md) / md;
        s.me.x += mvx * f; s.me.y += mvy * f;
      }
      s.me.x = Math.max(0, Math.min(WORLD, s.me.x));
      s.me.y = Math.max(0, Math.min(WORLD, s.me.y));

      // --- eat orbs (player) ---
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

      // --- bots AI + physics ---
      for (const b of s.bots.values()) {
        // re-target every couple seconds
        if (t > b.retargetAt) {
          b.retargetAt = t + 1500 + Math.random() * 2000;
          // flee biggest nearby threat
          let threat: { x: number; y: number; mass: number } | null = null;
          let threatD = Infinity;
          const scan = [
            ...Array.from(s.remote.values()),
            { x: s.me.x, y: s.me.y, mass: s.me.mass },
            ...Array.from(s.bots.values()).filter((o) => o.id !== b.id),
          ];
          for (const o of scan) {
            if (o.mass > b.mass * EAT_RATIO) {
              const d = Math.hypot(o.x - b.x, o.y - b.y);
              if (d < 350 && d < threatD) { threatD = d; threat = o; }
            }
          }
          if (threat) {
            const ang = Math.atan2(b.y - threat.y, b.x - threat.x);
            b.tx = b.x + Math.cos(ang) * 600;
            b.ty = b.y + Math.sin(ang) * 600;
          } else {
            // chase nearest orb
            let bestD = Infinity; let target: Orb | null = null;
            for (const orb of s.orbs) {
              if (s.eatenOrbs.has(orb.id)) continue;
              const d = (orb.x - b.x) ** 2 + (orb.y - b.y) ** 2;
              if (d < bestD) { bestD = d; target = orb; }
            }
            if (target) { b.tx = target.x; b.ty = target.y; }
            else { b.tx = Math.random() * WORLD; b.ty = Math.random() * WORLD; }
          }
        }
        const bdx = b.tx - b.x, bdy = b.ty - b.y;
        const bd = Math.hypot(bdx, bdy);
        if (bd > 1) {
          const sp = speedFor(b.mass) * 60 * dt;
          const f = Math.min(sp, bd) / bd;
          b.x += bdx * f; b.y += bdy * f;
        }
        if (bd < 8) b.retargetAt = 0; // force pick a new target next frame
        b.x = Math.max(0, Math.min(WORLD, b.x));
        b.y = Math.max(0, Math.min(WORLD, b.y));

        // bots eat orbs
        const br = massToRadius(b.mass);
        for (const orb of s.orbs) {
          if (s.eatenOrbs.has(orb.id)) continue;
          const ox = orb.x - b.x, oy = orb.y - b.y;
          if (ox * ox + oy * oy < br * br) {
            s.eatenOrbs.add(orb.id);
            b.mass = Math.min(MAX_MASS, b.mass + 1);
            setTimeout(() => {
              orb.x = Math.random() * WORLD;
              orb.y = Math.random() * WORLD;
              orb.hue = HUES[Math.floor(Math.random() * HUES.length)];
              s.eatenOrbs.delete(orb.id);
            }, 4000);
          }
        }
      }

      // --- collisions: me vs remote ---
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
            return;
          }
        }
      }

      // --- collisions: me vs bots ---
      for (const b of s.bots.values()) {
        const br = massToRadius(b.mass);
        const dx = b.x - s.me.x, dy = b.y - s.me.y;
        const dist = Math.hypot(dx, dy);
        if (dist < Math.max(r, br) * 0.85) {
          if (s.me.mass > b.mass * EAT_RATIO) {
            s.me.mass = Math.min(MAX_MASS, s.me.mass + b.mass * 0.8);
            s.bots.delete(b.id);
          } else if (b.mass > s.me.mass * EAT_RATIO && !dead) {
            setDead({ by: b.name });
            return;
          }
        }
      }

      // --- camera ---
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

      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, WORLD, WORLD);

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

      const drawList: { x: number; y: number; mass: number; name: string; hue: number; me: boolean }[] = [];
      for (const p of s.remote.values()) drawList.push({ ...p, me: false });
      for (const b of s.bots.values()) drawList.push({ x: b.x, y: b.y, mass: b.mass, name: b.name, hue: b.hue, me: false });
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

      // mini-map
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
      for (const b of s.bots.values()) {
        ctx.fillStyle = `oklch(0.78 0.22 ${b.hue})`;
        ctx.fillRect(w - mm - pad + b.x * mmScale - 1, h - mm - pad + b.y * mmScale - 1, 3, 3);
      }
      ctx.fillStyle = `oklch(0.9 0.25 ${hueRef.current})`;
      ctx.fillRect(w - mm - pad + s.me.x * mmScale - 2, h - mm - pad + s.me.y * mmScale - 2, 5, 5);

      if (t - lastHudUpdate > 300) {
        lastHudUpdate = t;
        const all = [...drawList].sort((a, b) => b.mass - a.mass);
        const rank = all.findIndex((p) => p.me) + 1;
        const fps = s.fpsFrames / Math.max(0.001, s.fpsAccum);
        s.fpsAccum = 0; s.fpsFrames = 0;
        setHud({ mass: Math.floor(s.me.mass), players: drawList.length, rank, fps: Math.round(fps) });
        setLeaderboard(all.slice(0, 8).map((p) => ({ name: p.name, mass: Math.floor(p.mass), me: p.me })));
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(eatFlush);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
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

  const copyCode = async () => {
    try {
      await navigator.clipboard?.writeText(room);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };


  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 touch-none" />

      {/* Back to lobby */}
      <div className="pointer-events-auto absolute top-4 left-4 z-20">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-xl border border-border bg-background/80 backdrop-blur-md px-4 py-2.5 font-bold text-sm shadow-lg transition hover:bg-background hover:scale-105"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          Home
        </Link>
      </div>

      {/* Secret Codes tab — top center */}
      <div className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
        <button
          onClick={() => { setCodesOpen((v) => !v); setCodeMsg(null); }}
          className="rounded-b-xl rounded-t-none border border-t-0 border-border bg-background/80 backdrop-blur-md px-5 py-2 font-mono text-xs uppercase tracking-[0.25em] font-bold shadow-lg transition hover:bg-background"
          style={{ color: "var(--neon-pink)" }}
        >
          🔒 Secret Codes
        </button>
        {codesOpen && (
          <div className="panel rounded-2xl p-4 w-[280px] flex flex-col gap-3">
            {!unlocked ? (
              <>
                <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Enter code</label>
                <input
                  autoFocus
                  type="password"
                  inputMode="numeric"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (codeInput.trim() === "4123") { setUnlocked(true); setCodeMsg(null); }
                      else setCodeMsg("Wrong code");
                    }
                  }}
                  placeholder="••••"
                  className="rounded-lg bg-input border border-border px-3 py-2 font-mono text-center tracking-[0.4em] text-lg"
                />
                <button
                  onClick={() => {
                    if (codeInput.trim() === "4123") { setUnlocked(true); setCodeMsg(null); }
                    else setCodeMsg("Wrong code");
                  }}
                  className="btn-neon rounded-lg px-3 py-2 font-bold text-sm"
                >Unlock</button>
                {codeMsg && <div className="text-xs text-center" style={{ color: "var(--destructive)" }}>{codeMsg}</div>}
              </>
            ) : (
              <>
                <div className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--neon-green)" }}>✓ Cheats unlocked</div>
                <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Set mass (1–{MAX_MASS})</label>
                <input
                  type="number"
                  value={massInput}
                  onChange={(e) => setMassInput(e.target.value)}
                  placeholder={String(hud.mass)}
                  className="rounded-lg bg-input border border-border px-3 py-2 font-mono"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const n = Math.max(1, Math.min(MAX_MASS, Math.floor(Number(massInput) || 0)));
                      if (n > 0) {
                        stateRef.current.me.mass = n;
                        setHud((h) => ({ ...h, mass: n }));
                        setCodeMsg(`Mass set to ${n}`);
                      }
                    }}
                    className="btn-neon rounded-lg px-3 py-2 font-bold text-sm flex-1"
                  >Apply</button>
                  <button
                    onClick={() => { setUnlocked(false); setCodeInput(""); setMassInput(""); setCodeMsg(null); }}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  >Lock</button>
                </div>
                {codeMsg && <div className="text-xs text-center text-muted-foreground">{codeMsg}</div>}
              </>
            )}
          </div>
        )}
      </div>


      {/* HUD top-left (below back) */}
      <div className="pointer-events-none absolute top-[64px] left-4 panel rounded-2xl px-4 py-3">
        <div className="flex items-center gap-5 text-sm">
          <Stat label="Mass" value={hud.mass} accent="var(--neon-green)" />
          <Stat label="Rank" value={`#${hud.rank}`} accent="var(--neon-pink)" />
          <Stat label="FPS" value={hud.fps} accent="var(--muted-foreground)" />
        </div>
      </div>

      {/* Room code + leaderboard top-right */}
      <div className="pointer-events-auto absolute top-4 right-4 flex flex-col gap-3 items-end z-10">
        <button
          onClick={copyCode}
          className="panel rounded-2xl px-4 py-3 text-right hover:scale-[1.02] transition"
          title="Click to copy room code"
        >
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {copied ? "Copied!" : "Room Code · tap to copy"}
          </div>
          <div className="font-mono text-2xl font-black tracking-[0.25em]" style={{ color: "var(--neon-cyan)" }}>
            {room}
          </div>
        </button>

        <div className="pointer-events-none panel rounded-2xl px-4 py-3 min-w-[220px]">
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Leaderboard</div>
          <ol className="mt-2 space-y-1 text-sm">
            {leaderboard.map((p, i) => (
              <li key={p.name + i} className={`flex justify-between gap-3 ${p.me ? "font-bold" : ""}`} style={p.me ? { color: "var(--neon-green)" } : undefined}>
                <span className="truncate">{i + 1}. {p.name}</span>
                <span className="font-mono text-muted-foreground">{p.mass}</span>
              </li>
            ))}
            {leaderboard.length === 0 && <li className="text-muted-foreground text-xs">Loading…</li>}
          </ol>
        </div>
      </div>

      {/* Controls hint bottom-left */}
      <div className="pointer-events-none absolute bottom-6 left-6 z-20 panel rounded-xl px-4 py-2 text-xs font-mono text-muted-foreground">
        Move: <span className="text-foreground">Arrow Keys</span> / <span className="text-foreground">WASD</span> / <span className="text-foreground">Cursor</span>
      </div>

      {/* Death overlay */}
      {dead && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
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
