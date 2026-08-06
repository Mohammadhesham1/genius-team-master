import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fails loudly at boot instead of every query failing mysteriously later.
  throw new Error(
    'Missing Supabase env vars. Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
      'are set in your .env file (see .env.example) and restart the dev server.'
  );
}

// This app uses its own `users` table + PIN-style password (checked directly
// against Postgres via RLS) instead of Supabase Auth, so there's no auth
// session for the SDK to persist — turning it off avoids a pointless
// localStorage write on every load.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});
