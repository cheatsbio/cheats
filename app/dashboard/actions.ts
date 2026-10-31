"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ICONS } from "@/lib/icons";
import { HEX_RE, RESERVED_USERNAMES, USERNAME_RE, normalizeUrl } from "@/lib/utils";
import type { ActionResult, LinkItem, ProfileInput } from "@/lib/types";

async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

function optionalMediaUrl(value: string | null): string | null | undefined {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const normalized = normalizeUrl(trimmed, false);
  return normalized ?? undefined; // undefined = invalid
}

export async function updateProfile(input: ProfileInput): Promise<ActionResult> {
  const { supabase, user } = await requireUser();

  const username = input.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: "Usernames use 3–24 letters, numbers or underscores." };
  }
  if (RESERVED_USERNAMES.has(username)) {
    return { ok: false, error: "That username is reserved. Try another." };
  }
  if (!HEX_RE.test(input.theme_color) || !HEX_RE.test(input.accent_color)) {
    return { ok: false, error: "Colors must be 6-digit hex values like #8b7bff." };
  }
  if (!["image", "video", "color"].includes(input.background_type)) {
    return { ok: false, error: "Choose a valid background type." };
  }
  if ((input.display_name ?? "").length > 50) {
    return { ok: false, error: "Display name can be up to 50 characters." };
  }
  if ((input.bio ?? "").length > 280) {
    return { ok: false, error: "Bio can be up to 280 characters." };
  }

  const avatar = optionalMediaUrl(input.avatar_url);
  const background = optionalMediaUrl(input.background_url);
  const music = optionalMediaUrl(input.music_url);
  const cursor = optionalMediaUrl(input.custom_cursor_url);
  if (avatar === undefined || background === undefined || music === undefined || cursor === undefined) {
    return { ok: false, error: "Media URLs must start with http:// or https://." };
  }

  const { data: before } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .update({
      username,
      display_name: input.display_name?.trim() || null,
      bio: input.bio?.trim() || null,
      avatar_url: avatar,
      background_url: background,
      background_type: background ? input.background_type : "color",
      theme_color: input.theme_color,
      accent_color: input.accent_color,
      music_url: music,
      custom_cursor_url: cursor,
    })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") return { ok: false, error: "That username is taken." };
    return { ok: false, error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/${username}`);
  if (before?.username && before.username !== username) revalidatePath(`/${before.username}`);
  return { ok: true };
}

export async function createLink(input: {
  title: string;
  url: string;
  icon: string;
  position: number;
}): Promise<ActionResult<LinkItem>> {
  const { supabase, user } = await requireUser();

  const title = input.title.trim();
  const url = normalizeUrl(input.url);
  if (!title) return { ok: false, error: "Give the link a title." };
  if (title.length > 60) return { ok: false, error: "Titles can be up to 60 characters." };
  if (!url) return { ok: false, error: "Enter a valid URL, like https://example.com." };

  const { data, error } = await supabase
    .from("links")
    .insert({
      user_id: user.id,
      title,
      url,
      icon: ICONS[input.icon] ? input.icon : "link",
      position: input.position,
    })
    .select("*")
    .single<LinkItem>();

  if (error) return { ok: false, error: error.message };
  await revalidateOwnPage(supabase, user.id);
  return { ok: true, data };
}

export async function updateLink(
  id: string,
  patch: Partial<Pick<LinkItem, "title" | "url" | "icon" | "is_active">>
): Promise<ActionResult<LinkItem>> {
  const { supabase, user } = await requireUser();
  const update: Record<string, unknown> = {};

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) return { ok: false, error: "A link needs a title." };
    if (title.length > 60) return { ok: false, error: "Titles can be up to 60 characters." };
    update.title = title;
  }
  if (patch.url !== undefined) {
    const url = normalizeUrl(patch.url);
    if (!url) return { ok: false, error: "Enter a valid URL, like https://example.com." };
    update.url = url;
  }
  if (patch.icon !== undefined) update.icon = ICONS[patch.icon] ? patch.icon : "link";
  if (patch.is_active !== undefined) update.is_active = !!patch.is_active;

  const { data, error } = await supabase
    .from("links")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single<LinkItem>();

  if (error) return { ok: false, error: error.message };
  await revalidateOwnPage(supabase, user.id);
  return { ok: true, data };
}

export async function deleteLink(id: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("links").delete().eq("id", id).eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  await revalidateOwnPage(supabase, user.id);
  return { ok: true };
}

export async function reorderLinks(orderedIds: string[]): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("links").update({ position: index }).eq("id", id).eq("user_id", user.id)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };
  await revalidateOwnPage(supabase, user.id);
  return { ok: true };
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/");
}

async function revalidateOwnPage(
  supabase: ReturnType<typeof createClient>,
  userId: string
) {
  const { data } = await supabase.from("profiles").select("username").eq("id", userId).maybeSingle();
  if (data?.username) revalidatePath(`/${data.username}`);
}
