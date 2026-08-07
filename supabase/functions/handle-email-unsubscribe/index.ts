import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    console.error('handle-email-unsubscribe: missing environment configuration')
    return json({ error: 'Server configuration error' }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  let token = ''
  if (req.method === 'GET') {
    token = new URL(req.url).searchParams.get('token') ?? ''
  } else if (req.method === 'POST') {
    try {
      const body = await req.json()
      token = typeof body?.token === 'string' ? body.token : ''
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }
  } else {
    return json({ error: 'Method not allowed' }, 405)
  }

  if (!token || token.length > 200) return json({ valid: false, reason: 'invalid' }, 200)

  const { data: row } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token, email, used_at')
    .eq('token', token)
    .maybeSingle()

  if (!row) return json({ valid: false, reason: 'invalid' }, 200)

  if (req.method === 'GET') {
    return json({ valid: true, email: row.email, alreadyUnsubscribed: Boolean(row.used_at) }, 200)
  }

  if (!row.used_at) {
    const { error: supErr } = await supabase.from('suppressed_emails').insert({
      email: row.email.toLowerCase(),
      reason: 'unsubscribe',
      metadata: { source: 'one-click-unsubscribe' },
    })
    if (supErr) console.error('handle-email-unsubscribe: suppression insert failed', supErr)

    await supabase
      .from('email_unsubscribe_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token)
  }

  return json({ ok: true, email: row.email, unsubscribed: true }, 200)
})
