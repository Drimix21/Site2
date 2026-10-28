import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return json({ error: 'Server configuration is incomplete' }, 500);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const required = ['p_service_id', 'p_start_at', 'p_client_name', 'p_client_phone'];
  if (required.some((key) => typeof body[key] !== 'string' || !String(body[key]).trim())) {
    return json({ error: 'Missing required booking fields' }, 400);
  }
  const authorization = request.headers.get('Authorization');
  const supabase = createClient(url, anonKey, {
    global: { headers: authorization ? { Authorization: authorization } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('create_appointment', {
    p_service_id: body.p_service_id,
    p_specialist_id: typeof body.p_specialist_id === 'string' && body.p_specialist_id ? body.p_specialist_id : null,
    p_start_at: body.p_start_at,
    p_client_name: String(body.p_client_name).trim(),
    p_client_phone: String(body.p_client_phone).trim(),
    p_client_email: typeof body.p_client_email === 'string' && body.p_client_email.trim() ? body.p_client_email.trim() : null,
    p_comment: typeof body.p_comment === 'string' && body.p_comment.trim() ? body.p_comment.trim() : null,
    p_consent: body.p_consent === true,
  });
  if (error) {
    const conflict = /no longer available|unavailable|overlap/i.test(error.message);
    return json({ error: conflict ? 'Selected time is no longer available' : 'Could not create appointment' }, conflict ? 409 : 400);
  }
  return json({ appointment_id: data, status: 'pending' }, 201);
});
