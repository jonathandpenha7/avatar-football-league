/**
 * Durable outbox for match events recorded on this device but not yet confirmed
 * by the database. Survives reloads, closed tabs and lost connections. Each
 * entry keeps its client-generated event id, so sending it again can never
 * create a second event: the database rejects a duplicate id and the app then
 * treats the event as saved.
 *
 * localStorage is only a delivery buffer here, never the source of truth.
 */
export interface OutboxEntry {
  id: string;
  tournamentId: string;
  fixtureId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
}

export interface OutboxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "ctm:event-outbox:v1";

function storage(): OutboxStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readOutbox(store: OutboxStorage | null = storage()): OutboxEntry[] {
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.id === "string") : [];
  } catch {
    return [];
  }
}

function write(entries: OutboxEntry[], store: OutboxStorage | null) {
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

/** Add (or replace) an entry. Returns false if it could not be stored durably. */
export function putOutbox(entry: OutboxEntry, store: OutboxStorage | null = storage()): boolean {
  const list = readOutbox(store).filter((e) => e.id !== entry.id);
  list.push(entry);
  return write(list, store);
}

export function removeOutbox(id: string, store: OutboxStorage | null = storage()) {
  write(readOutbox(store).filter((e) => e.id !== id), store);
}

export function outboxFor(fixtureId: string, store: OutboxStorage | null = storage()): OutboxEntry[] {
  return readOutbox(store).filter((e) => e.fixtureId === fixtureId);
}

export function bumpAttempts(id: string, store: OutboxStorage | null = storage()) {
  write(readOutbox(store).map((e) => (e.id === id ? { ...e, attempts: e.attempts + 1 } : e)), store);
}
