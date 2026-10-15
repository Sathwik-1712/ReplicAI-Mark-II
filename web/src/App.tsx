import { useEffect, useState } from "react";
import { cx } from "./components/ui";
import type { ExerciseId } from "./engine/types";
import { setVoiceEnabled } from "./lib/speech";
import { useSettings } from "./lib/store";
import History from "./pages/History";
import Home from "./pages/Home";
import Progress from "./pages/Progress";
import Settings from "./pages/Settings";
import Train from "./pages/Train";

export type Route = { page: "home" | "train" | "history" | "progress" | "settings"; ex?: ExerciseId };

function parse(hash: string): Route {
  const [path, query] = hash.replace(/^#\/?/, "").split("?");
  const page = (["train", "history", "progress", "settings"] as const).find((p) => p === path) ?? "home";
  const ex = new URLSearchParams(query).get("ex") as ExerciseId | null;
  return { page, ex: ex ?? undefined };
}

export function go(page: Route["page"], ex?: ExerciseId) {
  location.hash = `/${page === "home" ? "" : page}${ex ? `?ex=${ex}` : ""}`;
}

const NAV: { page: Route["page"]; label: string; icon: string }[] = [
  { page: "home", label: "Home", icon: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" },
  { page: "train", label: "Train", icon: "M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12" },
  { page: "history", label: "History", icon: "M12 7v5l3 2M3 12a9 9 0 1 0 3-6.7M3 4v4h4" },
  { page: "progress", label: "Progress", icon: "M4 19V5M4 19h16M8 15l4-4 3 3 5-6" },
  { page: "settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 .5-1.5-1L15 4h-4l-.5 2.5L9 7.5 7 7l-2 4 2 1v0l-2 1 2 4 2-.5 1.5 1L11 20h4l.5-2.5 1.5-1 2 .5 2-4z" },
];

export default function App() {
  const [route, setRoute] = useState(() => parse(location.hash));
  const settings = useSettings();

  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useEffect(() => setVoiceEnabled(settings.voice), [settings.voice]);

  return (
    <div className="min-h-dvh pb-24 md:pb-0">
      <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <a href="#/" className="flex items-center gap-2" aria-label="ReplicAI home">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="display text-2xl font-extrabold tracking-wide">
              REPLIC<span className="text-volt">AI</span>
            </span>
          </a>
          <nav className="hidden gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <a
                key={n.page}
                href={`#/${n.page === "home" ? "" : n.page}`}
                aria-current={route.page === n.page ? "page" : undefined}
                className={cx("rounded-lg px-3 py-2 text-sm font-semibold", route.page === n.page ? "bg-raise text-chalk" : "text-mute hover:text-chalk")}
              >
                {n.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {route.page === "home" && <Home />}
        {route.page === "train" && <Train key={route.ex ?? "pick"} initial={route.ex} />}
        {route.page === "history" && <History />}
        {route.page === "progress" && <Progress />}
        {route.page === "settings" && <Settings />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main">
        {NAV.map((n) => (
          <a
            key={n.page}
            href={`#/${n.page === "home" ? "" : n.page}`}
            aria-current={route.page === n.page ? "page" : undefined}
            className={cx("flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold", route.page === n.page ? "text-volt" : "text-mute")}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={n.icon} />
            </svg>
            {n.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
