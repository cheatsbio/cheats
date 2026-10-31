import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProfileView from "@/components/ProfileView";
import { createClient } from "@/lib/supabase/server";
import type { LinkItem, Profile } from "@/lib/types";

interface PageProps {
  params: { username: string };
}

async function getProfile(username: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username.toLowerCase())
    .maybeSingle<Profile>();
  return data;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const profile = await getProfile(decodeURIComponent(params.username));
  if (!profile) return { title: "Page not found" };
  const name = profile.display_name || profile.username;
  return {
    title: name,
    description: profile.bio ?? `${name} on Murmur`,
    openGraph: {
      title: name,
      description: profile.bio ?? `${name} on Murmur`,
      images: profile.avatar_url ? [profile.avatar_url] : undefined,
    },
  };
}

export default async function PublicProfilePage({ params }: PageProps) {
  const username = decodeURIComponent(params.username);
  const profile = await getProfile(username);
  if (!profile) notFound();

  const supabase = createClient();
  const { data: links } = await supabase
    .from("links")
    .select("*")
    .eq("user_id", profile.id)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .returns<LinkItem[]>();

  return <ProfileView profile={profile} links={links ?? []} />;
}
