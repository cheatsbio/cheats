"use client";

import { motion } from "framer-motion";

interface Props {
  displayName: string;
  avatarUrl: string | null;
  accent: string;
  onEnter: () => void;
}

/**
 * Full-screen blurred gate. The click is a user gesture, which is what lets
 * the browser allow audio playback afterwards.
 */
export default function ClickToEnterOverlay({ displayName, avatarUrl, accent, onEnter }: Props) {
  return (
    <motion.button
      type="button"
      onClick={onEnter}
      aria-label={`Enter ${displayName}'s page`}
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-6 bg-black/55 text-white backdrop-blur-2xl"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, filter: "blur(18px)", scale: 1.04 }}
      transition={{ duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="h-20 w-20 rounded-full object-cover"
          style={{ boxShadow: `0 0 0 2px ${accent}, 0 0 40px ${accent}88` }}
        />
      )}
      <motion.span
        className="font-display text-2xl font-semibold tracking-wide"
        style={{ textShadow: `0 0 20px ${accent}, 0 0 50px ${accent}88` }}
        animate={{ opacity: [0.55, 1, 0.55] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        click to enter
      </motion.span>
    </motion.button>
  );
}
