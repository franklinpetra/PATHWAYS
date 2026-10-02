"use client";

import Image from "next/image";
import { useEffect } from "react";

/**
 * The Pathways mark with a text wordmark. The wordmark is live text in forest green rather
 * than the image's leaf-green lettering, which is too light to read on the bone background.
 *
 * Entrance: a CSS fade with a slight upward glide (animate-logo-enter), once per full page
 * load. The module-level flag survives client-side navigation but resets on reload, so the
 * logo animates on first load and refresh only.
 */

let hasEntered = false;

const SIZES = {
  sm: { mark: 28, word: "text-sm tracking-[0.2em]", gap: "gap-2.5" },
  lg: { mark: 60, word: "text-lg tracking-[0.26em]", gap: "gap-4" },
} as const;

export function Logo({ size = "sm", wordmark = true }: { size?: keyof typeof SIZES; wordmark?: boolean }) {
  const animate = !hasEntered;
  useEffect(() => {
    hasEntered = true;
  }, []);

  const s = SIZES[size];
  return (
    <span className={`inline-flex items-center ${s.gap} ${animate ? "motion-safe:animate-logo-enter" : ""}`}>
      <Image
        src="/brand/pathways-mark.png"
        alt={wordmark ? "" : "Pathways"}
        width={Math.round((s.mark * 502) / 557)}
        height={s.mark}
        priority
        className="select-none"
        draggable={false}
      />
      {wordmark && <span className={`font-semibold text-forest uppercase ${s.word}`}>Pathways</span>}
    </span>
  );
}
