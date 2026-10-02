"use client";

import { useEffect, useState } from "react";
import { detectPlatform, type Platform } from "@/lib/places/links";

export interface PlatformInfo {
  platform: Platform;
  /** Touch-first device with the Web Share API: share instead of showing a QR code. */
  canShare: boolean;
}

/** Resolved after mount; server render assumes desktop. */
export function usePlatform(): PlatformInfo {
  const [info, setInfo] = useState<PlatformInfo>({ platform: "other", canShare: false });
  useEffect(() => {
    setInfo({
      platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints),
      canShare: typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches,
    });
  }, []);
  return info;
}
