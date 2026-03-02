import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not set. Auth and cloud features will not work.');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
    autoRefreshToken: true,
    persistSession: true,
  },
});
