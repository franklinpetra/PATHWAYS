/** Dates stored as midnight UTC (due dates) are formatted in UTC so they never shift a day. */
export function formatDay(iso: string, opts: { utc?: boolean; now?: Date } = {}): string {
  const date = new Date(iso);
  const now = opts.now ?? new Date();
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
    ...(opts.utc && { timeZone: "UTC" }),
  }).format(date);
}

export function formatIsoDate(date: string): string {
  return formatDay(`${date}T00:00:00Z`, { utc: true });
}
