import "server-only";

/** Server clock reading for a request, sent to the browser so it can correct for device clock drift. */
export function serverTimeMs(): number {
  return Date.now();
}
