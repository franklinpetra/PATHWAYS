"use client";

import { Copy, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { createHandoffLink } from "@/lib/client/api";

interface HandoffDialogProps {
  open: boolean;
  onClose: () => void;
  pathwayId: string;
  place: { query: string; label?: string | null } | null;
}

/** Desktop "Send to phone": a single-use, signed-in link shown as a QR code. */
export function HandoffDialog({ open, onClose, pathwayId, place }: HandoffDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; url: string; qr: string; expiresAt: string } | { status: "error"; message: string }
  >({ status: "loading" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const placeQuery = place?.query ?? null;
  const placeLabel = place?.label ?? null;

  // Keyed on primitives so a re-render never mints a second token.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: "loading" });
    setCopied(false);
    createHandoffLink(pathwayId, placeQuery ? { query: placeQuery, label: placeLabel } : null)
      .then(async ({ url, expiresAt }) => {
        const qr = await QRCode.toDataURL(url, {
          margin: 1,
          width: 220,
          color: { dark: "#1C1D1F", light: "#FFFFFF" },
        });
        if (!cancelled) setState({ status: "ready", url, qr, expiresAt });
      })
      .catch((err: Error) => !cancelled && setState({ status: "error", message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [open, pathwayId, placeQuery, placeLabel]);

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="handoff-title"
      className="m-auto w-[min(22rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-6 text-foreground shadow-md backdrop:bg-foreground/20"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id="handoff-title" className="font-semibold">
          Continue on your phone
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-icon -m-1">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {place && <p className="mt-1 text-sm text-muted-foreground">{place.label ?? place.query}</p>}

      <div className="mt-5 flex min-h-[220px] items-center justify-center">
        {state.status === "loading" && <p className="text-sm text-muted-foreground">Creating a secure link…</p>}
        {state.status === "error" && <p className="text-sm text-muted-foreground">{state.message}</p>}
        {state.status === "ready" && (
          <img src={state.qr} alt="QR code that opens this pathway on your phone" width={220} height={220} className="rounded-lg" />
        )}
      </div>

      {state.status === "ready" && (
        <>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Scan with your phone&apos;s camera. The link signs you in, works once, and expires in 10 minutes.
          </p>
          <button
            type="button"
            onClick={() => copy(state.url)}
            className="btn btn-ghost btn-sm mx-auto mt-3 flex text-forest"
          >
            <Copy className="size-3.5" aria-hidden />
            {copied ? "Copied" : "Copy link instead"}
          </button>
        </>
      )}
    </dialog>
  );
}
