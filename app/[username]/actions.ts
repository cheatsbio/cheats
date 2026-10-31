"use server";

import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Called when a visitor opens a link. Anonymous-safe via a security-definer RPC. */
export async function trackClick(linkId: string): Promise<void> {
  if (!UUID_RE.test(linkId)) return;
  const supabase = createClient();
  await supabase.rpc("increment_link_click", { link_id: linkId });
}

/** Counts a profile visit and returns the new total (null if it could not be counted). */
export async function trackView(profileId: string): Promise<number | null> {
  if (!UUID_RE.test(profileId)) return null;
  const supabase = createClient();
  const { data, error } = await supabase.rpc("increment_profile_views", {
    profile_id: profileId,
  });
  if (error || typeof data !== "number") return null;
  return data;
}
