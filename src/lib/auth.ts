import { supabase } from './supabaseClient';
import type { Database } from './database.types';
import type { User } from '../types';

export const SAVED_USER_KEY = 'abaqera_user_id';
const DEVICE_ID_KEY = 'abaqera_device_id';
const HEARTBEAT_MS = 45_000; // how often we bump last_seen_at while the app is open
const ONLINE_WINDOW_MS = 2 * 60_000; // "online" = seen within the last 2 minutes

type UserRow = Database['public']['Tables']['users']['Row'];
// Never select `password` back to the client except inside the one filtered
// query in signIn — everywhere else we only need the public profile fields.
const SAFE_USER_COLUMNS = 'id,name,name_en,row_side,color,gradient,nicknames,heba_english_only';
type SafeUserRow = Omit<UserRow, 'password' | 'created_at'>;

function mapUserRow(row: SafeUserRow): User {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.name_en,
    password: '', // intentionally never populated client-side after login
    row: row.row_side,
    color: row.color,
    gradient: row.gradient,
    nicknames: row.nicknames ?? [],
    hebaEnglishOnly: row.heba_english_only,
  };
}

/** All users, for the login picker grid. Ordered to match the original seed order. */
export async function getAllUsers(): Promise<User[]> {
  const { data, error } = await supabase
    .from('users')
    .select(SAFE_USER_COLUMNS)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as SafeUserRow[]).map(mapUserRow);
}

export async function getUserById(id: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select(SAFE_USER_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapUserRow(data as SafeUserRow) : null;
}

/**
 * Checks id+password directly against Postgres. The filter runs server-side,
 * so a wrong password just comes back as "no row" — the password column
 * itself is never sent back over the wire.
 */
export async function signIn(id: string, password: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select(SAFE_USER_COLUMNS)
    .eq('id', id)
    .eq('password', password)
    .maybeSingle();
  if (error) throw error;
  return data ? mapUserRow(data as SafeUserRow) : null;
}

/** Batch profile lookup (e.g. resolving invite/match-player rows to display names). */
export async function getUsersByIds(ids: string[]): Promise<Map<string, User>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from('users').select(SAFE_USER_COLUMNS).in('id', unique);
  if (error) throw error;
  const map = new Map<string, User>();
  (data as SafeUserRow[]).forEach((row) => map.set(row.id, mapUserRow(row)));
  return map;
}

// ── Device sessions / "online" presence ─────────────────────────────────────

function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall back to a
    // session-only id so the app still works, just without persistence.
    return `session-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Records a device session row and starts a periodic heartbeat that keeps
 * `last_seen_at` fresh so other users can see this person as "online".
 * Returns a cleanup function to call on logout / unmount.
 */
export function startPresence(userId: string): () => void {
  let sessionId: string | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let cancelled = false;

  (async () => {
    try {
      const { data, error } = await supabase
        .from('device_sessions')
        .insert({ user_id: userId, device_id: getDeviceId() })
        .select('id')
        .single();
      if (error) throw error;
      if (cancelled) return;
      sessionId = data.id;
      interval = setInterval(() => {
        if (sessionId) {
          supabase
            .from('device_sessions')
            .update({ last_seen_at: new Date().toISOString() })
            .eq('id', sessionId)
            .then(() => {});
        }
      }, HEARTBEAT_MS);
    } catch {
      // Presence is a nice-to-have; never let it break login.
    }
  })();

  return () => {
    cancelled = true;
    if (interval) clearInterval(interval);
  };
}

/** User ids seen within the last couple of minutes, for "online" badges. */
export async function getOnlineUserIds(): Promise<Set<string>> {
  const thresholdIso = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('device_sessions')
    .select('user_id,last_seen_at')
    .gte('last_seen_at', thresholdIso);
  if (error) throw error;
  const ids = new Set<string>();
  data?.forEach((r) => {
    if (r.user_id) ids.add(r.user_id);
  });
  return ids;
}

export function clearSavedUser(): void {
  try {
    localStorage.removeItem(SAVED_USER_KEY);
  } catch {
    /* noop */
  }
}

export function saveUserId(id: string): void {
  try {
    localStorage.setItem(SAVED_USER_KEY, id);
  } catch {
    /* noop */
  }
}

export function loadSavedUserId(): string | null {
  try {
    return localStorage.getItem(SAVED_USER_KEY);
  } catch {
    return null;
  }
}
