import {createClient} from '@supabase/supabase-js';

// Public Supabase URL and Publishable key (safe for GitHub Pages static frontend).
// Secret keys and Hugging Face tokens must NEVER be placed in frontend code.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://ncbtoawlltxukzzdyvhc.supabase.co';

export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_wCDq_uAfoddEBuNLYeLcmQ_WqkXHnpx';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function isMissingTableError(error: {code?: string; message?: string} | null): boolean {
  if (!error) return false;
  const code = error.code || '';
  const msg = (error.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist')
  );
}
