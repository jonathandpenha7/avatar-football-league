/** "17:05" or "17:05:00" → 1025 minutes after midnight. */
export function toMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/** 1025 → "17:05" */
export function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 1025 → "5:05 PM" */
export function formatClock(total: number | null | undefined): string {
  if (total === null || total === undefined) return "—";
  const h24 = Math.floor(total / 60) % 24;
  const m = Math.round(total % 60);
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Inclusive list of ISO dates between start and end. */
export function dateRange(start: string, end?: string | null): string[] {
  const out: string[] = [];
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end ?? start}T00:00:00Z`);
  for (let d = s; d <= e && out.length < 60; d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
