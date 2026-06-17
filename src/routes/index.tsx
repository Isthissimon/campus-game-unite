import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ORBZ.IO — Multiplayer Arena" },
      { name: "description", content: "Pick a name. Join the arena. Eat smaller orbs, dodge bigger ones, climb the leaderboard." },
    ],
  }),
  component: Lobby,
});

const MAX_PER_LOBBY = 25;

function genCode() {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

function Lobby() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("orbz:name");
      if (saved) setName(saved);
    } catch {}
  }, []);

  const cleanName = () =>
    (name.trim() || `orb_${Math.floor(Math.random() * 9999)}`).slice(0, 14);

  const go = (room: string) => {
    const finalName = cleanName();
    try { localStorage.setItem("orbz:name", finalName); } catch {}
    navigate({ to: "/play", search: { room, name: finalName } });
  };

  // Find an existing non-full lobby via the matchmaker channel, else create new.
  const quickPlay = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const ch = supabase.channel("matchmaker", {
        config: { presence: { key: crypto.randomUUID() } },
      });
      const counts = new Map<string, number>();
      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState() as Record<string, Array<{ room?: string }>>;
        counts.clear();
        for (const arr of Object.values(state)) {
          for (const meta of arr) {
            if (meta?.room) counts.set(meta.room, (counts.get(meta.room) || 0) + 1);
          }
        }
      });
      await new Promise<void>((resolve) => {
        ch.subscribe((status: string) => { if (status === "SUBSCRIBED") resolve(); });
      });
      // Give presence ~700ms to sync
      await new Promise((r) => setTimeout(r, 700));
      let pick: string | null = null;
      let best = -1;
      for (const [room, n] of counts) {
        if (n < MAX_PER_LOBBY && n > best) { best = n; pick = room; }
      }
      if (!pick) pick = genCode();
      await supabase.removeChannel(ch);
      go(pick);
    } finally {
      setBusy(false);
    }
  };

  const joinCode = () => {
    const c = code.replace(/\D/g, "").slice(0, 8);
    if (c.length !== 8) return;
    go(c);
  };

  return (
    <main className="relative min-h-screen overflow-hidden">
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
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-12 px-6 pt-8 pb-24 md:grid-cols-2 md:items-center">
        <div>
          <h1 className="mt-2 text-5xl md:text-7xl font-black leading-[0.95] tracking-tight">
            Eat. Grow.<br/>
            <span className="text-glow-pink" style={{ color: "var(--neon-pink)" }}>Dominate.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg text-muted-foreground">
            A real-time multiplayer arena that runs in your browser. One tap to drop into a lobby, or share an 8-digit code to play with friends.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
            <li>⚡ Instant multiplayer — no install, no signup</li>
            <li>🔢 8-digit room codes — share to play together</li>
            <li>🏆 Live leaderboard, mass tracker, mini-map</li>
          </ul>
        </div>

        <div className="panel relative rounded-3xl p-7 scanlines">
          <h2 className="text-sm font-mono uppercase tracking-[0.2em] text-muted-foreground">Drop in</h2>
          <label className="mt-4 block text-xs font-bold uppercase tracking-widest text-muted-foreground">Your name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && quickPlay()}
            maxLength={14}
            placeholder="dark_matter"
            className="mt-2 w-full rounded-xl border border-border bg-input px-4 py-3 text-lg font-mono outline-none focus:border-transparent focus:ring-2"
            style={{ caretColor: "var(--neon-green)" }}
          />

          <button
            onClick={quickPlay}
            disabled={busy}
            className="btn-neon mt-6 w-full rounded-xl py-4 text-lg font-black tracking-wide disabled:opacity-60"
          >
            {busy ? "FINDING LOBBY…" : "▶ PLAY NOW"}
          </button>

          <div className="my-5 flex items-center gap-3 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or join with code <div className="h-px flex-1 bg-border" />
          </div>

          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              onKeyDown={(e) => e.key === "Enter" && joinCode()}
              placeholder="12345678"
              inputMode="numeric"
              maxLength={8}
              className="flex-1 rounded-xl border border-border bg-input px-4 py-3 text-lg font-mono tracking-[0.3em] outline-none focus:ring-2"
            />
            <button
              onClick={joinCode}
              disabled={code.replace(/\D/g, "").length !== 8}
              className="rounded-xl border border-border px-5 py-3 font-bold hover:bg-card disabled:opacity-40"
            >
              JOIN
            </button>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="text-3xl font-black tracking-tight">How to play</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { t: "Move", d: "Use the on-screen D-pad or your cursor. The bigger you grow, the slower you move." },
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
