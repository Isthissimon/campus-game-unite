import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ORBZ.IO — Multiplayer Arena You Can Play Schoolwide" },
      { name: "description", content: "Pick a name. Join the arena. Eat smaller orbs, dodge bigger ones, and climb the live leaderboard." },
    ],
  }),
  component: Lobby,
});

const ROOM_PRESETS = [
  { id: "global", label: "Global Arena", desc: "Everyone, everywhere" },
  { id: "school", label: "Schoolwide", desc: "Share the link with your school" },
  { id: "chill", label: "Chill Lobby", desc: "Smaller, slower, cozier" },
];

function Lobby() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [room, setRoom] = useState("school");
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("orbz:name");
      if (saved) setName(saved);
    } catch {}
  }, []);

  // Quick presence ping for online count
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const channel = supabase.channel(`presence:${room}`, { config: { presence: { key: crypto.randomUUID() } } });
      channel
        .on("presence", { event: "sync" }, () => {
          if (cancelled) return;
          const state = channel.presenceState();
          setOnline(Object.keys(state).length);
        })
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    })();
    return () => { cancelled = true; };
  }, [room]);

  const play = () => {
    const finalName = (name.trim() || `orb_${Math.floor(Math.random() * 9999)}`).slice(0, 14);
    try { localStorage.setItem("orbz:name", finalName); } catch {}
    navigate({ to: "/play", search: { room, name: finalName } });
  };

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Ambient orbs */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full blur-3xl opacity-50" style={{ background: "var(--neon-pink)" }} />
        <div className="absolute top-1/3 -right-40 h-[28rem] w-[28rem] rounded-full blur-3xl opacity-40" style={{ background: "var(--neon-cyan)" }} />
        <div className="absolute -bottom-40 left-1/3 h-[26rem] w-[26rem] rounded-full blur-3xl opacity-40" style={{ background: "var(--neon-green)" }} />
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full animate-pulse-glow" style={{ background: "var(--neon-green)", color: "var(--neon-green)" }} />
          <span className="font-black tracking-tight text-xl">ORBZ<span style={{ color: "var(--neon-green)" }}>.IO</span></span>
        </div>
        <nav className="hidden md:flex gap-6 text-sm text-muted-foreground">
          <a href="#how" className="hover:text-foreground">How to play</a>
          <a href="#schoolwide" className="hover:text-foreground">Play with your school</a>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-12 px-6 pt-8 pb-24 md:grid-cols-2 md:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs font-mono uppercase tracking-widest text-muted-foreground">
            <span className="h-2 w-2 rounded-full animate-pulse-glow" style={{ background: "var(--neon-green)", color: "var(--neon-green)" }} />
            {online !== null ? `${online} online in ${room}` : "Connecting…"}
          </div>
          <h1 className="mt-5 text-5xl md:text-7xl font-black leading-[0.95] tracking-tight">
            Eat. Grow.<br/>
            <span className="text-glow-pink" style={{ color: "var(--neon-pink)" }}>Dominate.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-muted-foreground">
            A real-time multiplayer arena that runs in your browser. Share one link and your whole school joins the same fight.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
            <li>⚡ Live multiplayer — no install, no signup</li>
            <li>🏫 One link = the whole school in one arena</li>
            <li>🏆 Live leaderboard, mass tracker, mini-map</li>
          </ul>
        </div>

        <div className="panel relative rounded-3xl p-7 scanlines">
          <h2 className="text-sm font-mono uppercase tracking-[0.2em] text-muted-foreground">Drop in</h2>
          <label className="mt-4 block text-xs font-bold uppercase tracking-widest text-muted-foreground">Your name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && play()}
            maxLength={14}
            placeholder="dark_matter"
            className="mt-2 w-full rounded-xl border border-border bg-input px-4 py-3 text-lg font-mono outline-none focus:border-transparent focus:ring-2"
            style={{ caretColor: "var(--neon-green)" }}
          />

          <label className="mt-5 block text-xs font-bold uppercase tracking-widest text-muted-foreground">Arena</label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {ROOM_PRESETS.map((r) => (
              <button
                key={r.id}
                onClick={() => setRoom(r.id)}
                className={`rounded-xl border px-3 py-3 text-left transition ${room === r.id ? "border-transparent ring-2" : "border-border hover:border-muted-foreground/40"}`}
                style={room === r.id ? { boxShadow: "0 0 0 2px var(--neon-green)" } : undefined}
              >
                <div className="text-sm font-bold">{r.label}</div>
                <div className="text-[11px] text-muted-foreground">{r.desc}</div>
              </button>
            ))}
          </div>

          <button onClick={play} className="btn-neon mt-6 w-full rounded-xl py-4 text-lg font-black tracking-wide">
            ▶ PLAY NOW
          </button>

          <div id="schoolwide" className="mt-5 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
            Send this exact URL to friends to land in the same arena:
            <div className="mt-1 font-mono text-foreground break-all">
              {typeof window !== "undefined" ? `${window.location.origin}/play?room=${room}` : `/play?room=${room}`}
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="text-3xl font-black tracking-tight">How to play</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { t: "Move", d: "Your orb follows your cursor. The bigger you grow, the slower you move." },
            { t: "Eat orbs", d: "Glowing dots = mass. Vacuum them up to grow." },
            { t: "Eat players", d: "If you're 25% bigger than another player, touch them to absorb them." },
          ].map((s) => (
            <div key={s.t} className="panel rounded-2xl p-5">
              <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{s.t}</div>
              <div className="mt-1 text-lg">{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 pb-10 text-center text-xs text-muted-foreground">
        Built for recess. Tap fast, dodge hard. © ORBZ.IO
      </footer>
    </main>
  );
}
