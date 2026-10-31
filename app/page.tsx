import Link from "next/link";
import { ArrowRight, AudioLines, GripVertical, MousePointerClick } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export default async function LandingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-[-10rem] h-[38rem] w-[38rem] rounded-full opacity-40 blur-[120px]"
        style={{ background: "radial-gradient(circle, #8b7bff 0%, transparent 70%)" }}
      />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="font-display text-xl font-bold tracking-tight">
          murmur
        </Link>
        <nav className="flex items-center gap-2">
          {user ? (
            <Link href="/dashboard" className="btn-primary">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">
                Log in
              </Link>
              <Link href="/register" className="btn-primary">
                Create your page
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="relative z-10 mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-14 lg:grid-cols-[1.15fr_0.85fr] lg:pt-24">
        <div>
          <h1 className="blur-in font-display text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-7xl">
            Everything you share, on one page that sounds like you.
          </h1>
          <p
            className="blur-in mt-6 max-w-lg text-lg text-mute"
            style={{ animationDelay: "120ms" }}
          >
            Pick a background, drop in a track, line up your links. Visitors click to enter and
            your page starts playing.
          </p>
          <div className="blur-in mt-9 flex flex-wrap gap-3" style={{ animationDelay: "240ms" }}>
            <Link href={user ? "/dashboard" : "/register"} className="btn-primary px-6 py-3">
              {user ? "Go to dashboard" : "Claim your username"}
              <ArrowRight size={16} />
            </Link>
            {!user && (
              <Link href="/login" className="btn-ghost px-6 py-3">
                I already have a page
              </Link>
            )}
          </div>
        </div>

        {/* Static sample of a finished page */}
        <div className="blur-in mx-auto w-full max-w-sm" style={{ animationDelay: "380ms" }}>
          <div
            className="relative overflow-hidden rounded-[2rem] border border-line p-8 text-center"
            style={{
              background:
                "radial-gradient(120% 80% at 50% 0%, #2a2250 0%, #120f22 55%, #0a0912 100%)",
              boxShadow: "0 0 80px #8b7bff33",
            }}
          >
            <div
              className="mx-auto h-24 w-24 rounded-full"
              style={{
                background: "linear-gradient(135deg, #8b7bff, #ff8fb1)",
                boxShadow: "0 0 0 3px #8b7bff, 0 0 36px #8b7bffaa",
              }}
            />
            <p
              className="mt-5 font-display text-2xl font-bold"
              style={{ textShadow: "0 0 18px #8b7bffcc, 0 0 40px #8b7bff66" }}
            >
              nova
            </p>
            <p className="mt-1 text-sm text-white/70">night-shift producer · tokyo</p>
            <div className="mt-7 space-y-3">
              {["New EP on Spotify", "Studio livestream", "Book a session"].map((label) => (
                <div
                  key={label}
                  className="rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3 text-sm font-medium backdrop-blur"
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl border-t border-line px-6 py-16">
        <ul className="grid gap-10 md:grid-cols-3">
          <li>
            <MousePointerClick className="text-iris" size={22} />
            <h2 className="mt-4 font-display text-xl font-bold">A blurred doorway</h2>
            <p className="mt-2 text-mute">
              Visitors click once to enter, which also lets your music play without the browser
              blocking it.
            </p>
          </li>
          <li>
            <AudioLines className="text-iris" size={22} />
            <h2 className="mt-4 font-display text-xl font-bold">Your own atmosphere</h2>
            <p className="mt-2 text-mute">
              Video or image backgrounds, glowing type, a custom cursor, and a soundtrack.
            </p>
          </li>
          <li>
            <GripVertical className="text-iris" size={22} />
            <h2 className="mt-4 font-display text-xl font-bold">Links you can rearrange</h2>
            <p className="mt-2 text-mute">
              Drag to reorder, switch links off without deleting them, and see how many clicks
              each one gets.
            </p>
          </li>
        </ul>
      </section>
    </main>
  );
}
