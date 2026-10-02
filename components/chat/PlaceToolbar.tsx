"use client";

import { CalendarPlus, MapPin, Monitor, Smartphone } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { formatIsoDate } from "@/lib/client/format";
import { detectAddresses, detectEventDates, type DetectedDate } from "@/lib/places/detect";
import { buildIcs, mapsUrl, type MapTarget } from "@/lib/places/links";
import { formatSourceDate } from "@/lib/workspace/attribution";
import type { SourceAttribution, VerifiedPlace } from "@/lib/workspace/events";
import { HandoffDialog } from "./HandoffDialog";
import { usePlatform } from "./usePlatform";

export interface ToolbarPlace extends MapTarget {
  label: string | null;
  /** Present when the place comes from an authoritative source rather than text detection. */
  verified?: SourceAttribution;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Verified places first, then any other addresses written in the text. */
export function placesForMessage(text: string, verified: VerifiedPlace[] = []): ToolbarPlace[] {
  const places: ToolbarPlace[] = verified.map((v) => ({
    label: v.label,
    query: v.address,
    latitude: v.latitude,
    longitude: v.longitude,
    verified: v.source,
  }));
  const known = places.map((p) => normalize(p.query));
  for (const address of detectAddresses(text)) {
    const key = normalize(address.text);
    if (!known.some((k) => k.startsWith(key) || key.startsWith(k))) {
      places.push({ label: null, query: address.query });
      known.push(key);
    }
  }
  return places;
}

/** Compact actions beneath an assistant message that mentions a place or an event date. */
export function MessageToolbar({ text, verified, pathwayId }: { text: string; verified?: VerifiedPlace[]; pathwayId: string }) {
  const places = useMemo(() => placesForMessage(text, verified), [text, verified]);
  const dates = useMemo(() => detectEventDates(text), [text]);
  if (places.length === 0 && dates.length === 0) return null;

  // A single place is the natural location for the event.
  const eventLocation = places.length === 1 ? places[0].query : null;

  return (
    <div className="mt-3 space-y-2" role="group" aria-label="Actions for this message">
      {places.map((place) => (
        <PlaceActions key={place.query} place={place} pathwayId={pathwayId} />
      ))}
      {dates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {dates.map((d) => (
            <CalendarButton key={`${d.date}-${d.time}`} date={d} location={eventLocation} showDate={dates.length > 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Map + device handoff for one place. Also used for places shared from another device. */
export function PlaceActions({ place, pathwayId, allowHandoff = true }: { place: ToolbarPlace; pathwayId: string; allowHandoff?: boolean }) {
  const { platform, canShare } = usePlatform();
  const [handoffOpen, setHandoffOpen] = useState(false);
  const name = place.label ?? place.query;

  async function shareOrHandoff() {
    if (canShare) {
      // The share sheet gets a plain map link, never a sign-in link: it may go to anyone.
      try {
        await navigator.share({ title: name, text: place.query, url: mapsUrl(place, "other") });
      } catch {
        // Dismissed share sheet.
      }
    } else {
      setHandoffOpen(true);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface px-3 py-2.5">
      <p className="flex items-start gap-1.5 text-xs">
        <MapPin className="mt-px size-3.5 shrink-0 text-forest" aria-hidden />
        <span className="min-w-0">
          {place.label && <span className="font-medium">{place.label} · </span>}
          <span className="text-muted-foreground">{place.query}</span>
          {place.verified && (
            <span className="block text-[11px] text-muted-foreground">
              Verified · {place.verified.verificationAuthority}, as of {formatSourceDate(place.verified.asOf)}
            </span>
          )}
        </span>
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <ToolbarLink href={mapsUrl(place, platform)} icon={<MapPin className="size-3.5" aria-hidden />}>
          Open in Maps
        </ToolbarLink>
        {allowHandoff && (
          <ToolbarButton
            onClick={shareOrHandoff}
            icon={canShare ? <Monitor className="size-3.5" aria-hidden /> : <Smartphone className="size-3.5" aria-hidden />}
          >
            {canShare ? "Open on desktop" : "Send to phone"}
          </ToolbarButton>
        )}
      </div>
      {allowHandoff && !canShare && (
        <HandoffDialog
          open={handoffOpen}
          onClose={() => setHandoffOpen(false)}
          pathwayId={pathwayId}
          place={{ query: place.query, label: place.label }}
        />
      )}
    </div>
  );
}

function CalendarButton({ date, location, showDate }: { date: DetectedDate; location: string | null; showDate: boolean }) {
  function download() {
    const ics = buildIcs({
      title: date.context.length > 90 ? `${date.context.slice(0, 87)}…` : date.context,
      date: date.date,
      time: date.time,
      location,
      description: `${date.context}\n\nAdded from Pathways. Confirm details with the organizer.`,
      uid: `${crypto.randomUUID()}@pathways`,
    });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `pathways-${date.date}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <ToolbarButton onClick={download} icon={<CalendarPlus className="size-3.5" aria-hidden />}>
      {showDate ? `Add ${formatIsoDate(date.date)} to calendar` : "Add to Calendar"}
    </ToolbarButton>
  );
}

const TOOLBAR_ITEM = "btn btn-secondary btn-sm";

function ToolbarLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a href={href} className={TOOLBAR_ITEM} {...(external && { target: "_blank", rel: "noopener noreferrer" })}>
      {icon}
      {children}
    </a>
  );
}

function ToolbarButton({ onClick, icon, children }: { onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={TOOLBAR_ITEM}>
      {icon}
      {children}
    </button>
  );
}
