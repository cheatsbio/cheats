"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Reorder, useDragControls } from "framer-motion";
import {
  AlertCircle, Check, ChevronDown, ChevronUp, GripVertical, Loader2, Plus, Trash2, Upload, X,
} from "lucide-react";
import ProfileView from "./ProfileView";
import { createClient } from "@/lib/supabase/client";
import { IMAGE_ACCEPT, compressImage, formatBytes } from "@/lib/compress";
import { ICON_OPTIONS, getIcon } from "@/lib/icons";
import { cn, normalizeUrl } from "@/lib/utils";
import {
  createLink, deleteLink, reorderLinks, updateLink, updateProfile,
} from "@/app/dashboard/actions";
import type { BackgroundType, LinkItem, Profile, ProfileInput } from "@/lib/types";

/* ---------- Media rules ---------- */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLIC_MARKER = "/storage/v1/object/public/";
const MAX_CURSOR_BYTES = 100 * 1024;

/** True when a URL points at this project's own Supabase Storage (so it is hidden in the UI). */
function isStorageUrl(url: string | null | undefined): boolean {
  return !!url && SUPABASE_URL !== "" && url.startsWith(SUPABASE_URL) && url.includes(PUBLIC_MARKER);
}

/** Splits one of our storage URLs into bucket + path. Returns null for foreign files. */
function parseOwnedStorageUrl(
  url: string | null | undefined,
  userId: string
): { bucket: string; path: string } | null {
  if (!url || !isStorageUrl(url)) return null;
  const rest = url.slice(url.indexOf(PUBLIC_MARKER) + PUBLIC_MARKER.length).split("?")[0];
  const slash = rest.indexOf("/");
  if (slash < 1) return null;
  const bucket = rest.slice(0, slash);
  let path: string;
  try {
    path = decodeURIComponent(rest.slice(slash + 1));
  } catch {
    return null;
  }
  // Only ever delete inside the signed-in user's own folder.
  return path.startsWith(`${userId}/`) ? { bucket, path } : null;
}

/** The profile table keeps a single background URL; the editor keeps one slot per kind. */
function resolveBackground(
  type: BackgroundType,
  image: string | null,
  video: string | null
): string | null {
  if (type === "image") return image;
  if (type === "video") return video;
  return image || video || null;
}

function isStreamablePage(url: string): boolean {
  return /^(https?:\/\/)?(www\.)?streamable\.com\/[a-z0-9]+\/?$/i.test(url.trim());
}

type Tab = "profile" | "appearance" | "links";
type Toast = { kind: "ok" | "error"; text: string } | null;

const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "links", label: "Links" },
];

interface Props {
  userId: string;
  initialProfile: Profile;
  initialLinks: LinkItem[];
}

export default function DashboardForm({ userId, initialProfile, initialLinks }: Props) {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("profile");
  const [profile, setProfile] = useState<ProfileInput>({
    username: initialProfile.username,
    display_name: initialProfile.display_name,
    bio: initialProfile.bio,
    avatar_url: initialProfile.avatar_url,
    background_url: initialProfile.background_url,
    background_type: initialProfile.background_type,
    theme_color: initialProfile.theme_color,
    accent_color: initialProfile.accent_color,
    music_url: initialProfile.music_url,
    custom_cursor_url: initialProfile.custom_cursor_url,
  });
  const [links, setLinks] = useState<LinkItem[]>(initialLinks);
  const linksRef = useRef(links);
  linksRef.current = links;

  const [toast, setToast] = useState<Toast>(null);
  const [saving, startSaving] = useTransition();
  const [uploading, setUploading] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Image and video backgrounds each get a slot; only one is sent to the database.
  const [bgImage, setBgImage] = useState<string | null>(() => {
    const url = initialProfile.background_url;
    if (initialProfile.background_type === "image") return url;
    if (initialProfile.background_type === "color" && isStorageUrl(url)) return url;
    return null;
  });
  const [bgVideo, setBgVideo] = useState<string>(() => {
    const url = initialProfile.background_url;
    if (initialProfile.background_type === "video") return url ?? "";
    if (initialProfile.background_type === "color" && url && !isStorageUrl(url)) return url;
    return "";
  });
  const [previewVideo, setPreviewVideo] = useState(bgVideo);

  // Files that the saved profile points at. They are only deleted after a successful save.
  const savedUrls = useRef<Set<string>>(
    new Set(
      [
        initialProfile.avatar_url,
        initialProfile.background_url,
        initialProfile.music_url,
        initialProfile.custom_cursor_url,
      ].filter((u): u is string => !!u)
    )
  );
  const pendingDeletes = useRef<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setPreviewVideo(bgVideo), 600);
    return () => clearTimeout(t);
  }, [bgVideo]);

  const [newTitle, setNewTitle] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newIcon, setNewIcon] = useState("link");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  function notify(kind: "ok" | "error", text: string) {
    setToast({ kind, text });
  }

  function set<K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) {
    setProfile((p) => ({ ...p, [key]: value }));
    setDirty(true);
  }

  /* ---------- Storage housekeeping ---------- */

  function removeOwnedFile(url: string) {
    const target = parseOwnedStorageUrl(url, userId);
    if (!target) return;
    void supabase.storage.from(target.bucket).remove([target.path]);
  }

  /**
   * Called when a stored file is replaced or removed. Files the saved profile still
   * points at are deleted after the next successful save; unsaved uploads go right away.
   */
  function retire(url: string | null | undefined) {
    if (!url || !parseOwnedStorageUrl(url, userId)) return;
    if (savedUrls.current.has(url)) pendingDeletes.current.add(url);
    else removeOwnedFile(url);
  }

  async function putFile(
    bucket: "avatars" | "backgrounds" | "audio",
    path: string,
    body: Blob,
    contentType: string
  ): Promise<string | null> {
    const { error } = await supabase.storage.from(bucket).upload(path, body, {
      // Names are unique per upload, so browsers and the CDN can cache them for a year.
      cacheControl: "31536000",
      upsert: false,
      contentType,
    });
    if (error) {
      notify("error", `Upload failed: ${error.message}`);
      return null;
    }
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  /* ---------- Uploads ---------- */

  async function uploadAvatar(rawFile: File) {
    setUploading("avatar");
    try {
      const out = await compressImage(rawFile, "avatar");
      const url = await putFile(
        "avatars",
        `${userId}/avatar-${crypto.randomUUID()}.webp`,
        out.blob,
        "image/webp"
      );
      if (!url) return;
      retire(profile.avatar_url);
      set("avatar_url", url);
      notify(
        "ok",
        `Avatar crushed: ${formatBytes(rawFile.size)} → ${formatBytes(out.blob.size)}. Save changes to publish.`
      );
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Couldn't process that image.");
    } finally {
      setUploading(null);
    }
  }

  async function uploadBackgroundImage(rawFile: File) {
    setUploading("background");
    try {
      const out = await compressImage(rawFile, "background");
      const url = await putFile(
        "backgrounds",
        `${userId}/bg-${crypto.randomUUID()}.webp`,
        out.blob,
        "image/webp"
      );
      if (!url) return;
      retire(bgImage);
      setBgImage(url);
      set("background_type", "image");
      notify(
        "ok",
        `Background crushed: ${formatBytes(rawFile.size)} → ${formatBytes(out.blob.size)}. Save changes to publish.`
      );
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Couldn't process that image.");
    } finally {
      setUploading(null);
    }
  }

  async function uploadAudio(rawFile: File) {
    const looksLikeMp3 = rawFile.type === "audio/mpeg" || /\.mp3$/i.test(rawFile.name);
    if (!looksLikeMp3) {
      notify("error", "Audio uploads must be MP3 files. You can also paste a direct audio URL.");
      return;
    }
    if (rawFile.size > 3 * 1024 * 1024) {
      notify(
        "error",
        `That file is ${formatBytes(rawFile.size)}. MP3 uploads are limited to 3 MB. Trim it, or paste a direct audio URL instead.`
      );
      return;
    }

    setUploading("music");
    try {
      const url = await putFile(
        "audio",
        `${userId}/track-${crypto.randomUUID()}.mp3`,
        rawFile,
        "audio/mpeg"
      );
      if (!url) return;
      retire(profile.music_url);
      set("music_url", url);
      notify("ok", "Audio attached. Save changes to publish.");
    } finally {
      setUploading(null);
    }
  }

  async function uploadCursor(rawFile: File) {
    const isPng = rawFile.type === "image/png";
    const isCur = /\.cur$/i.test(rawFile.name);
    if (!isPng && !isCur) {
      notify("error", "Cursors must be a PNG or .cur file.");
      return;
    }
    if (rawFile.size > MAX_CURSOR_BYTES) {
      notify("error", `That cursor is ${formatBytes(rawFile.size)}. Keep it under ${formatBytes(MAX_CURSOR_BYTES)}.`);
      return;
    }

    setUploading("cursor");
    try {
      const url = await putFile(
        "backgrounds",
        `${userId}/cursors/${crypto.randomUUID()}.${isPng ? "png" : "cur"}`,
        rawFile,
        isPng ? "image/png" : "image/x-icon"
      );
      if (!url) return;
      retire(profile.custom_cursor_url);
      set("custom_cursor_url", url);
      notify("ok", "Cursor attached. Save changes to publish.");
    } finally {
      setUploading(null);
    }
  }

  /* ---------- Removals ---------- */

  function removeAvatar() {
    retire(profile.avatar_url);
    set("avatar_url", null);
  }

  function removeBackgroundImage() {
    retire(bgImage);
    setBgImage(null);
    setDirty(true);
  }

  function removeAudio() {
    retire(profile.music_url);
    set("music_url", null);
  }

  function removeCursor() {
    retire(profile.custom_cursor_url);
    set("custom_cursor_url", null);
  }

  /* ---------- Save ---------- */

  function save() {
    const videoText = bgVideo.trim();
    const videoValue = videoText ? normalizeUrl(videoText, false) : null;
    if (profile.background_type === "video" && videoText && !videoValue) {
      notify("error", "Enter a valid video URL that starts with http:// or https://.");
      return;
    }

    const payload: ProfileInput = {
      ...profile,
      background_url: resolveBackground(profile.background_type, bgImage, videoValue),
    };

    startSaving(async () => {
      const res = await updateProfile(payload);
      if (!res.ok) {
        notify("error", res.error ?? "Couldn't save changes.");
        return;
      }

      const keep = new Set<string>(
        [payload.avatar_url, payload.background_url, payload.music_url, payload.custom_cursor_url].filter(
          (u): u is string => !!u
        )
      );
      const stale = new Set<string>(pendingDeletes.current);

      // The database holds one background. Saving as video replaces an uploaded image.
      if (payload.background_type === "video" && bgImage && !keep.has(bgImage)) {
        stale.add(bgImage);
        setBgImage(null);
      }

      pendingDeletes.current.clear();
      savedUrls.current = keep;
      stale.forEach((url) => {
        if (!keep.has(url)) removeOwnedFile(url);
      });

      setDirty(false);
      notify("ok", "Changes saved.");
    });
  }

  const videoText = bgVideo.trim();
  const previewVideoValue = previewVideo.trim() ? normalizeUrl(previewVideo, false) : null;
  const previewBackground = resolveBackground(profile.background_type, bgImage, previewVideoValue);

  /* ---------------- Links ---------------- */

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    const position = links.length ? Math.max(...links.map((l) => l.position)) + 1 : 0;
    const res = await createLink({ title: newTitle, url: newUrl, icon: newIcon, position });
    setAdding(false);
    if (res.ok && res.data) {
      setLinks((prev) => [...prev, res.data!]);
      setNewTitle("");
      setNewUrl("");
      setNewIcon("link");
    } else {
      setToast({ kind: "error", text: res.error ?? "Couldn't add the link." });
    }
  }

  async function patchLink(
    id: string,
    patch: Partial<Pick<LinkItem, "title" | "url" | "icon" | "is_active">>
  ) {
    const previous = linksRef.current;
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const res = await updateLink(id, patch);
    if (res.ok && res.data) {
      setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...res.data! } : l)));
    } else {
      setLinks(previous);
      setToast({ kind: "error", text: res.error ?? "Couldn't update the link." });
    }
  }

  async function removeLink(id: string) {
    const previous = linksRef.current;
    setLinks((prev) => prev.filter((l) => l.id !== id));
    const res = await deleteLink(id);
    if (!res.ok) {
      setLinks(previous);
      setToast({ kind: "error", text: res.error ?? "Couldn't delete the link." });
    }
  }

  async function commitOrder(list: LinkItem[]) {
    const res = await reorderLinks(list.map((l) => l.id));
    if (!res.ok) setToast({ kind: "error", text: res.error ?? "Couldn't save the new order." });
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= links.length) return;
    const next = [...links];
    [next[index], next[target]] = [next[target], next[index]];
    setLinks(next);
    void commitOrder(next);
  }

  const bgTypes: { id: BackgroundType; label: string }[] = [
    { id: "color", label: "Solid color" },
    { id: "image", label: "Image" },
    { id: "video", label: "Video" },
  ];

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* ---------- Editor ---------- */}
      <section className="min-w-0">
        <div className="flex items-center justify-between gap-4">
          <div role="tablist" aria-label="Dashboard sections" className="flex gap-1 rounded-xl border border-line bg-panel p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                  tab === t.id ? "bg-iris text-ink" : "text-mute hover:text-fog"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab !== "links" && (
            <button onClick={save} disabled={saving || !dirty} className="btn-primary">
              {saving && <Loader2 size={16} className="animate-spin" />}
              Save changes
            </button>
          )}
        </div>

        <div className="mt-6 rounded-2xl border border-line bg-panel p-6">
          {tab === "profile" && (
            <div className="space-y-5">
              <div>
                <label htmlFor="username" className="label">Username</label>
                <input
                  id="username"
                  className="field"
                  value={profile.username}
                  onChange={(e) => set("username", e.target.value.toLowerCase())}
                  maxLength={24}
                />
                <p className="hint">Your page lives at /{profile.username}</p>
              </div>

              <div>
                <label htmlFor="display_name" className="label">Display name</label>
                <input
                  id="display_name"
                  className="field"
                  value={profile.display_name ?? ""}
                  onChange={(e) => set("display_name", e.target.value)}
                  maxLength={50}
                />
              </div>

              <div>
                <label htmlFor="bio" className="label">Bio</label>
                <textarea
                  id="bio"
                  className="field min-h-[96px] resize-y"
                  value={profile.bio ?? ""}
                  onChange={(e) => set("bio", e.target.value)}
                  maxLength={280}
                />
                <p className="hint">{(profile.bio ?? "").length}/280</p>
              </div>

              <AssetField
                label="Avatar"
                setText="Custom Avatar Set"
                isSet={!!profile.avatar_url}
                thumbUrl={profile.avatar_url}
                accept={IMAGE_ACCEPT}
                busy={uploading === "avatar"}
                uploadText="Upload avatar"
                hint="Cropped to a square and crushed to 250×250 WebP (about 10–20 KB)."
                onFile={uploadAvatar}
                onRemove={removeAvatar}
              />
            </div>
          )}

          {tab === "appearance" && (
            <div className="space-y-7">
              <div className="grid gap-5 sm:grid-cols-2">
                <ColorField
                  id="theme_color"
                  label="Background color"
                  value={profile.theme_color}
                  onChange={(v) => set("theme_color", v)}
                />
                <ColorField
                  id="accent_color"
                  label="Accent & glow"
                  value={profile.accent_color}
                  onChange={(v) => set("accent_color", v)}
                />
              </div>

              <div>
                <span className="label">Background</span>
                <div className="flex gap-2">
                  {bgTypes.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => set("background_type", b.id)}
                      aria-pressed={profile.background_type === b.id}
                      className={cn(
                        "rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors",
                        profile.background_type === b.id
                          ? "border-iris bg-iris/15 text-fog"
                          : "border-line text-mute hover:text-fog"
                      )}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>

                {profile.background_type === "image" && (
                  <div className="mt-4">
                    <AssetField
                      setText="Custom Image Set"
                      isSet={!!bgImage}
                      accept={IMAGE_ACCEPT}
                      busy={uploading === "background"}
                      uploadText="Upload image"
                      hint="Resized to 1280px wide and crushed to WebP (about 40–80 KB)."
                      onFile={uploadBackgroundImage}
                      onRemove={removeBackgroundImage}
                    />
                  </div>
                )}

                {profile.background_type === "video" && (
                  <div className="mt-4">
                    <label htmlFor="bg_video_url" className="label">Video URL</label>
                    <input
                      id="bg_video_url"
                      type="url"
                      inputMode="url"
                      className="field"
                      placeholder="https://files.catbox.moe/abc123.mp4"
                      value={bgVideo}
                      onChange={(e) => {
                        setBgVideo(e.target.value);
                        setDirty(true);
                      }}
                      spellCheck={false}
                      autoComplete="off"
                    />
                    {videoText && isStreamablePage(videoText) ? (
                      <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-300">
                        <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden />
                        Streamable page links won&apos;t play. Open the video, then copy its direct
                        file address (it ends in .mp4).
                      </p>
                    ) : (
                      <p className="hint">
                        Paste a direct .mp4 or .webm link from Catbox, Streamable or any host.
                        Video uploads aren&apos;t accepted, so your storage stays small.
                        {bgImage ? " Saving with video selected replaces your uploaded image." : ""}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <span className="label">Background music</span>
                {isStorageUrl(profile.music_url) ? (
                  <AssetStatus
                    badge="Audio Track Attached"
                    accept="audio/mpeg,.mp3"
                    busy={uploading === "music"}
                    onFile={uploadAudio}
                    onRemove={removeAudio}
                  />
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="url"
                      inputMode="url"
                      className="field"
                      aria-label="Audio URL"
                      placeholder="https://…/track.mp3"
                      value={profile.music_url ?? ""}
                      onChange={(e) => set("music_url", e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <FileButton
                      accept="audio/mpeg,.mp3"
                      busy={uploading === "music"}
                      onFile={uploadAudio}
                    >
                      Upload MP3
                    </FileButton>
                  </div>
                )}
                <p className="hint">
                  Paste a direct audio link, or upload an MP3 up to 3 MB. Music starts after a
                  visitor clicks to enter.
                </p>
              </div>

              <AssetField
                label="Custom cursor"
                setText="Custom Cursor Set"
                isSet={!!profile.custom_cursor_url}
                accept="image/png,.cur"
                busy={uploading === "cursor"}
                uploadText="Upload cursor"
                hint="PNG or .cur, up to 100 KB and no larger than 128×128 pixels."
                onFile={uploadCursor}
                onRemove={removeCursor}
              />
            </div>
          )}

          {tab === "links" && (
            <div>
              <form onSubmit={addLink} className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto_auto]">
                <input
                  className="field"
                  aria-label="Link title"
                  placeholder="Title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  maxLength={60}
                  required
                />
                <input
                  className="field"
                  aria-label="Link URL"
                  placeholder="https://example.com"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  required
                />
                <select
                  className="field sm:w-32"
                  aria-label="Link icon"
                  value={newIcon}
                  onChange={(e) => setNewIcon(e.target.value)}
                >
                  {ICON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <button type="submit" disabled={adding} className="btn-primary">
                  {adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Add link
                </button>
              </form>

              {links.length === 0 ? (
                <p className="mt-8 rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-mute">
                  No links yet. Add your first one above and it appears in the preview.
                </p>
              ) : (
                <Reorder.Group
                  axis="y"
                  values={links}
                  onReorder={setLinks}
                  className="mt-6 space-y-3"
                >
                  {links.map((link, i) => (
                    <LinkRow
                      key={link.id}
                      link={link}
                      isFirst={i === 0}
                      isLast={i === links.length - 1}
                      onPatch={patchLink}
                      onDelete={removeLink}
                      onMove={(dir) => move(i, dir)}
                      onDragEnd={() => void commitOrder(linksRef.current)}
                    />
                  ))}
                </Reorder.Group>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ---------- Live preview ---------- */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-3 text-sm font-medium text-mute">Live preview</p>
        <div
          className="relative mx-auto h-[640px] w-full max-w-[340px] overflow-hidden rounded-[2.2rem] border-[6px] border-line"
          style={{ boxShadow: `0 0 60px ${profile.accent_color}22` }}
        >
          <ProfileView
            preview
            profile={{
              ...profile,
              background_url: previewBackground,
              id: initialProfile.id,
              views: initialProfile.views,
            }}
            links={links.filter((l) => l.is_active)}
          />
        </div>
      </aside>

      {/* ---------- Toast ---------- */}
      {toast && (
        <div
          role="status"
          className={cn(
            "fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-xl backdrop-blur",
            toast.kind === "ok"
              ? "border-iris/50 bg-panel/95 text-fog"
              : "border-red-500/50 bg-panel/95 text-red-300"
          )}
        >
          {toast.kind === "ok" ? <Check size={16} className="text-iris" /> : <AlertCircle size={16} />}
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ================= Sub-components ================= */

function ColorField({
  id, label, value, onChange,
}: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-ink p-1"
        />
        <input
          id={id}
          className="field"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function FileButton({
  accept, busy, onFile, children, variant = "ghost",
}: {
  accept: string;
  busy: boolean;
  onFile: (file: File) => void;
  children: React.ReactNode;
  variant?: "ghost" | "primary";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={cn(variant === "primary" ? "btn-primary" : "btn-ghost", "shrink-0 px-3 py-2")}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
        {children}
      </button>
    </>
  );
}

/** Replaces a raw URL with a status badge plus Upload New / Remove. */
function AssetStatus({
  badge, thumbUrl, accept, busy, onFile, onRemove,
}: {
  badge: string;
  thumbUrl?: string | null;
  accept: string;
  busy: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {thumbUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded-full border border-line object-cover"
        />
      )}
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
        <Check size={13} aria-hidden />
        {badge}
      </span>
      <div className="ml-auto flex gap-2">
        <FileButton accept={accept} busy={busy} onFile={onFile}>
          Upload New
        </FileButton>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="btn-ghost shrink-0 px-3 py-2 text-red-300 hover:border-red-500/50 hover:bg-red-500/10"
        >
          <X size={15} />
          Remove
        </button>
      </div>
    </div>
  );
}

/** Upload-only field: empty shows an upload button, filled shows the status badge. */
function AssetField({
  label, setText, isSet, thumbUrl, accept, busy, uploadText, hint, onFile, onRemove,
}: {
  label?: string;
  setText: string;
  isSet: boolean;
  thumbUrl?: string | null;
  accept: string;
  busy: boolean;
  uploadText: string;
  hint: string;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  return (
    <div>
      {label && <span className="label">{label}</span>}
      {isSet ? (
        <AssetStatus
          badge={setText}
          thumbUrl={thumbUrl}
          accept={accept}
          busy={busy}
          onFile={onFile}
          onRemove={onRemove}
        />
      ) : (
        <FileButton accept={accept} busy={busy} onFile={onFile}>
          {uploadText}
        </FileButton>
      )}
      <p className="hint">{hint}</p>
    </div>
  );
}

interface LinkRowProps {
  link: LinkItem;
  isFirst: boolean;
  isLast: boolean;
  onPatch: (
    id: string,
    patch: Partial<Pick<LinkItem, "title" | "url" | "icon" | "is_active">>
  ) => void;
  onDelete: (id: string) => void;
  onMove: (dir: -1 | 1) => void;
  onDragEnd: () => void;
}

function LinkRow({ link, isFirst, isLast, onPatch, onDelete, onMove, onDragEnd }: LinkRowProps) {
  const controls = useDragControls();
  const [title, setTitle] = useState(link.title);
  const [url, setUrl] = useState(link.url);
  const Icon = getIcon(link.icon);

  useEffect(() => setTitle(link.title), [link.title]);
  useEffect(() => setUrl(link.url), [link.url]);

  return (
    <Reorder.Item
      value={link}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.015, boxShadow: "0 12px 40px rgba(0,0,0,0.45)" }}
      className={cn(
        "flex items-start gap-3 rounded-xl border border-line bg-ink p-3",
        !link.is_active && "opacity-60"
      )}
    >
      <div className="flex flex-col items-center gap-0.5 pt-1">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={isFirst}
          aria-label="Move link up"
          className="rounded p-0.5 text-mute hover:text-fog disabled:opacity-30"
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          aria-label="Drag to reorder"
          onPointerDown={(e) => controls.start(e)}
          className="cursor-grab touch-none rounded p-0.5 text-mute hover:text-fog active:cursor-grabbing"
        >
          <GripVertical size={16} />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={isLast}
          aria-label="Move link down"
          className="rounded p-0.5 text-mute hover:text-fog disabled:opacity-30"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex gap-2">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-iris/15 text-iris">
            <Icon size={18} />
          </span>
          <input
            className="field"
            aria-label="Title"
            value={title}
            maxLength={60}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== link.title && onPatch(link.id, { title })}
          />
          <select
            className="field w-28 shrink-0"
            aria-label="Icon"
            value={link.icon}
            onChange={(e) => onPatch(link.id, { icon: e.target.value })}
          >
            {ICON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <input
          className="field"
          aria-label="URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url !== link.url && onPatch(link.id, { url })}
        />
        <p className="text-xs text-mute">
          {link.clicks} {link.clicks === 1 ? "click" : "clicks"}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 pt-1">
        <button
          type="button"
          role="switch"
          aria-checked={link.is_active}
          aria-label={link.is_active ? "Hide link" : "Show link"}
          onClick={() => onPatch(link.id, { is_active: !link.is_active })}
          className={cn(
            "relative h-6 w-11 rounded-full transition-colors",
            link.is_active ? "bg-iris" : "bg-line"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
              link.is_active ? "left-[22px]" : "left-0.5"
            )}
          />
        </button>
        <button
          type="button"
          onClick={() => onDelete(link.id)}
          aria-label="Delete link"
          className="rounded-lg p-2 text-mute transition-colors hover:bg-red-500/10 hover:text-red-400"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </Reorder.Item>
  );
}
