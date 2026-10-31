"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import { ArrowUpRight, Eye, Volume2, VolumeX } from "lucide-react";
import ClickToEnterOverlay from "./ClickToEnterOverlay";
import { createClient } from "@/lib/supabase/client";
import { getIcon } from "@/lib/icons";
import { trackClick, trackView } from "@/app/[username]/actions";
import type { LinkItem, Profile } from "@/lib/types";

interface Props {
  profile: Omit<Profile, "id" | "created_at" | "views"> &
    Partial<Pick<Profile, "id" | "created_at" | "views">>;
  links: Pick<LinkItem, "id" | "title" | "url" | "icon">[];
  /** Dashboard mode: no entry gate, no audio, no view/click tracking, contained in its parent. */
  preview?: boolean;
}

/** Links using these icons are shown in the footer bar instead of the main list. */
const SOCIAL_ICONS = new Set([
  "instagram", "twitter", "github", "twitch", "youtube", "facebook", "linkedin",
]);

const numberFormat = new Intl.NumberFormat("en-US");

/** Safe value for a CSS url() so a stray quote can't break out of the declaration. */
function cssUrl(url: string): string {
  return `url("${url.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;
}

function LinkAnchor({
  link,
  className,
  children,
  label,
  accent,
  cursor,
  preview,
}: {
  link: Props["links"][number];
  className: string;
  children: React.ReactNode;
  label?: string;
  accent: string;
  cursor?: string;
  preview: boolean;
}) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      onClick={() => {
        if (!preview) void trackClick(link.id);
      }}
      className={className}
      style={{ "--accent": accent, cursor: cursor ?? "pointer" } as CSSProperties}
    >
      {children}
    </a>
  );
}

export default function ProfileView({ profile, links, preview = false }: Props) {
  const reduceMotion = useReducedMotion();
  const hasMusic = !preview && !!profile.music_url;

  // The gate only exists to unlock audio, so it only shows when there is music.
  const [entered, setEntered] = useState(!hasMusic);
  const [muted, setMuted] = useState(false);
  const [views, setViews] = useState(profile.views ?? 0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const accent = profile.accent_color;
  const name = profile.display_name || profile.username;
  const bgIsMedia = profile.background_type !== "color" && !!profile.background_url;
  const cursor = profile.custom_cursor_url
    ? `${cssUrl(profile.custom_cursor_url)} 0 0, auto`
    : undefined;

  const socialLinks = links.filter((l) => SOCIAL_ICONS.has(l.icon));
  const mainLinks = links.filter((l) => !SOCIAL_ICONS.has(l.icon));

  /* ---------- Views: count this visit once per browser session, then follow live updates ---------- */

  useEffect(() => {
    setViews((prev) => Math.max(prev, profile.views ?? 0));
  }, [profile.views]);

  useEffect(() => {
    if (preview || !profile.id) return;
    const key = `cheats:viewed:${profile.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage can be blocked; counting the visit anyway is better than losing it.
    }
    trackView(profile.id)
      .then((total) => {
        if (typeof total === "number") setViews((prev) => Math.max(prev, total));
      })
      .catch(() => undefined);
  }, [preview, profile.id]);

  useEffect(() => {
    if (preview || !profile.id) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`profile-views-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${profile.id}` },
        (payload) => {
          const next = (payload.new as { views?: number }).views;
          if (typeof next === "number") setViews((prev) => Math.max(prev, next));
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [preview, profile.id]);

  /* ---------- Audio gate ---------- */

  function enter() {
    setEntered(true);
    audioRef.current?.play().catch(() => undefined);
    videoRef.current?.play().catch(() => undefined);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
  }

  /* ---------- Motion ---------- */

  const container: Variants = useMemo(
    () => ({
      hidden: {},
      show: { transition: { staggerChildren: reduceMotion ? 0 : 0.07, delayChildren: 0.1 } },
    }),
    [reduceMotion]
  );

  const item: Variants = useMemo(
    () =>
      reduceMotion
        ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0 } } }
        : {
            hidden: { opacity: 0, filter: "blur(10px)", y: 12 },
            show: {
              opacity: 1,
              filter: "blur(0px)",
              y: 0,
              transition: { duration: 0.6, ease: [0.2, 0.7, 0.2, 1] },
            },
          },
    [reduceMotion]
  );

  const layer = preview ? "absolute" : "fixed";

  return (
    <div
      className={
        preview
          ? "absolute inset-0 overflow-y-auto overflow-x-hidden"
          : "relative min-h-[100dvh] overflow-x-hidden"
      }
      style={{ backgroundColor: profile.theme_color, cursor }}
    >
      {/* Full-screen background */}
      <div aria-hidden className={`${layer} inset-0 z-0`}>
        {profile.background_type === "image" && profile.background_url && (
          <div
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: cssUrl(profile.background_url) }}
          />
        )}
        {profile.background_type === "video" && profile.background_url && (
          <video
            ref={videoRef}
            src={profile.background_url}
            className="h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
          />
        )}
        {bgIsMedia && <div className="absolute inset-0 bg-black/40" />}
      </div>

      {hasMusic && <audio ref={audioRef} src={profile.music_url!} loop preload="auto" />}

      <AnimatePresence>
        {!entered && (
          <ClickToEnterOverlay
            key="gate"
            displayName={name}
            avatarUrl={profile.avatar_url}
            accent={accent}
            onEnter={enter}
          />
        )}
      </AnimatePresence>

      {/* Card */}
      <div
        className={`relative z-10 flex w-full items-center justify-center ${
          preview ? "min-h-full p-3" : "min-h-[100dvh] p-4 sm:p-8"
        }`}
      >
        <motion.article
          variants={container}
          initial="hidden"
          animate={entered ? "show" : "hidden"}
          className={`flex w-full flex-col overflow-hidden rounded-lg border border-white/5 bg-black/70 text-white shadow-2xl backdrop-blur-xl ${
            preview ? "max-w-full" : "max-w-2xl"
          }`}
        >
          <div className={preview ? "p-5" : "p-6 sm:p-10"}>
            {/* Header */}
            <motion.header variants={item} className="flex items-center gap-4 sm:gap-5">
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt={`${name}'s avatar`}
                  className={`shrink-0 rounded-full object-cover ring-1 ring-white/10 ${
                    preview ? "h-16 w-16" : "h-20 w-20 sm:h-24 sm:w-24"
                  }`}
                  style={{ boxShadow: `0 0 28px -4px ${accent}99` }}
                />
              ) : (
                <div
                  aria-hidden
                  className={`flex shrink-0 items-center justify-center rounded-full font-display font-bold ring-1 ring-white/10 ${
                    preview ? "h-16 w-16 text-2xl" : "h-20 w-20 text-3xl sm:h-24 sm:w-24 sm:text-4xl"
                  }`}
                  style={{ background: `${accent}2e`, boxShadow: `0 0 28px -4px ${accent}99` }}
                >
                  {name.charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0">
                <h1
                  className={`truncate font-display font-extrabold leading-tight tracking-tight ${
                    preview ? "text-2xl" : "text-3xl sm:text-4xl"
                  }`}
                  style={{ textShadow: `0 0 22px ${accent}66` }}
                >
                  {name}
                </h1>
                <p className="mt-0.5 truncate text-sm text-white/45">@{profile.username}</p>
              </div>
            </motion.header>

            {/* Bio */}
            {profile.bio && (
              <motion.p
                variants={item}
                className={`whitespace-pre-line text-white/70 ${
                  preview ? "mt-5 text-sm leading-6" : "mt-7 text-[15px] leading-7"
                }`}
              >
                {profile.bio}
              </motion.p>
            )}

            {/* Links */}
            {mainLinks.length > 0 && (
              <ul className={`flex flex-col gap-2.5 ${preview ? "mt-6" : "mt-9"}`}>
                {mainLinks.map((link) => {
                  const Icon = getIcon(link.icon);
                  return (
                    <motion.li key={link.id} variants={item}>
                      <LinkAnchor
                        link={link}
                        accent={accent}
                        cursor={cursor}
                        preview={preview}
                        className="group flex w-full items-center gap-3 rounded-md border border-white/5 bg-white/[0.04] px-3.5 py-3 text-sm font-medium text-white/90 transition-all duration-200 hover:-translate-y-px hover:border-white/15 hover:bg-white/[0.09] hover:shadow-[0_8px_28px_-10px_var(--accent)] active:translate-y-0"
                      >
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded"
                          style={{ background: `${accent}1f`, color: accent }}
                        >
                          <Icon size={16} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{link.title}</span>
                        <ArrowUpRight
                          size={15}
                          aria-hidden
                          className="shrink-0 -translate-x-1 text-white/0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-white/50"
                        />
                      </LinkAnchor>
                    </motion.li>
                  );
                })}
              </ul>
            )}

            {links.length === 0 && (
              <motion.p variants={item} className="mt-8 text-sm text-white/40">
                No links yet.
              </motion.p>
            )}
          </div>

          {/* Footer: socials + views */}
          <motion.footer
            variants={item}
            className={`flex items-center justify-between gap-4 border-t border-white/5 bg-black/30 ${
              preview ? "px-5 py-3" : "px-6 py-4 sm:px-10"
            }`}
          >
            <nav aria-label="Social links" className="flex min-w-0 flex-wrap items-center gap-4">
              {socialLinks.map((link) => {
                const Icon = getIcon(link.icon);
                return (
                  <LinkAnchor
                    key={link.id}
                    link={link}
                    accent={accent}
                    cursor={cursor}
                    preview={preview}
                    label={link.title}
                    className="text-white/45 transition-all duration-200 hover:-translate-y-0.5 hover:text-[var(--accent)]"
                  >
                    <Icon size={18} />
                  </LinkAnchor>
                );
              })}
            </nav>

            <div
              className="flex shrink-0 items-center gap-1.5 text-xs text-white/40"
              title={`${numberFormat.format(views)} profile views`}
            >
              <Eye size={14} aria-hidden />
              <span className="sr-only">Profile views:</span>
              <motion.span
                key={views}
                initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="tabular-nums"
              >
                {numberFormat.format(views)}
              </motion.span>
            </div>
          </motion.footer>
        </motion.article>
      </div>

      {hasMusic && entered && (
        <motion.button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute music" : "Mute music"}
          className="fixed bottom-5 right-5 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 backdrop-blur-md transition-colors hover:text-white"
          style={{ cursor: cursor ?? "pointer" }}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6 }}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </motion.button>
      )}
    </div>
  );
}
