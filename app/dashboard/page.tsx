import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink, LogOut } from "lucide-react";
import DashboardForm from "@/components/DashboardForm";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";
import type { LinkItem, Profile } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (!profile) {
    const fallback = `user${user.id.replace(/-/g, "").slice(0, 8)}`;
    const { data: created } = await supabase
      .from("profiles")
      .insert({ id: user.id, username: fallback, display_name: fallback })
      .select("*")
      .single<Profile>();
    profile = created;
  }
  if (!profile) redirect("/login");

  const { data: links } = await supabase
    .from("links")
    .select("*")
    .eq("user_id", user.id)
    .order("position", { ascending: true })
    .returns<LinkItem[]>();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-ink/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5">
          <Link href="/" className="font-display text-lg font-bold tracking-tight">
            cheats
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href={`/${profile.username}`}
              target="_blank"
              className="btn-ghost px-3 py-2"
            >
              <ExternalLink size={15} />
              <span className="hidden sm:inline">View page</span>
            </Link>
            <form action={signOut}>
              <button type="submit" className="btn-ghost px-3 py-2">
                <LogOut size={15} />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <DashboardForm userId={user.id} initialProfile={profile} initialLinks={links ?? []} />
    </div>
  );
}
