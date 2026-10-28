import { SUPABASE_URL, SUPABASE_ANON_KEY, hasSupabaseConfig } from "./config.js";
let clientPromise;
export async function getSupabase() {
  if (!hasSupabaseConfig) return null;
  if (!clientPromise) clientPromise = import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm").then(({createClient}) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  return clientPromise;
}