import { createClient } from '@supabase/supabase-js';

// Use NEXT_PUBLIC_ vars — these are inlined by webpack's DefinePlugin at build time
// for both client and server bundles, ensuring the correct URL is always used.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Server-side Supabase client with service_role key (bypasses RLS).
 * Only available in API routes / server components where SUPABASE_SERVICE_ROLE_KEY is set.
 */
export function getSupabaseAdmin() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}
