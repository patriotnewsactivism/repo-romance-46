import { createClient } from '@supabase/supabase-js';

const PRODUCTION_SUPABASE_URL = 'https://rdsrxfzahhxbvugyarld.supabase.co';
const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_95xMusG9KjCGJemIa8dgcw_-8JqzgER';

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ||
  PRODUCTION_SUPABASE_URL;

const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
  PRODUCTION_SUPABASE_PUBLISHABLE_KEY;

// These fallbacks are intentionally browser-safe values. The Supabase project
// URL and publishable/anon key are public client configuration, not privileged
// server credentials. Keeping a source fallback prevents a Vercel env-var
// regression from crashing React before the app can render.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
