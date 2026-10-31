"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { RESERVED_USERNAMES, USERNAME_RE } from "@/lib/utils";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const supabase = createClient();
  const isRegister = mode === "register";

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      if (isRegister) {
        const name = username.trim().toLowerCase();
        if (!USERNAME_RE.test(name)) {
          throw new Error("Usernames use 3–24 letters, numbers or underscores.");
        }
        if (RESERVED_USERNAMES.has(name)) {
          throw new Error("That username is reserved. Try another.");
        }

        const { data: existing } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", name)
          .maybeSingle();
        if (existing) throw new Error("That username is taken. Try another.");

        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username: name } },
        });
        if (signUpError) throw signUpError;

        if (data.session) {
          router.push("/dashboard");
          router.refresh();
        } else {
          setNotice("Check your inbox to confirm your email, then log in.");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display text-xl font-bold tracking-tight">
          cheats
        </Link>
        <h1 className="mt-8 font-display text-3xl font-bold tracking-tight">
          {isRegister ? "Create your page" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-mute">
          {isRegister
            ? "Pick a username. It becomes your link."
            : "Log in to edit your page and links."}
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          {isRegister && (
            <div>
              <label htmlFor="username" className="label">
                Username
              </label>
              <input
                id="username"
                className="field"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="nova"
                autoComplete="username"
                required
              />
            </div>
          )}
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              minLength={8}
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="rounded-lg border border-iris/40 bg-iris/10 px-3 py-2 text-sm text-fog">
              {notice}
            </p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading && <Loader2 size={16} className="animate-spin" />}
            {isRegister ? "Create page" : "Log in"}
          </button>
        </form>

        <p className="mt-6 text-sm text-mute">
          {isRegister ? "Already have a page?" : "New here?"}{" "}
          <Link
            href={isRegister ? "/login" : "/register"}
            className="font-semibold text-fog underline underline-offset-4 hover:text-iris"
          >
            {isRegister ? "Log in" : "Create your page"}
          </Link>
        </p>
      </div>
    </main>
  );
}
