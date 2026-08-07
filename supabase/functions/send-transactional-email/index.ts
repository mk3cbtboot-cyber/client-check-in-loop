/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@3.23.8'
import { TEMPLATES, resolveSubject } from '../_shared/transactional-email-templates/registry.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SITE_NAME = 'Tenacia'
const SENDER_DOMAIN = 'notify.tenacia.app'
const FROM_DOMAIN = 'notify.tenacia.app'

const BodySchema = z.object({
  templateName: z.string().min(1).max(100),
  recipientEmail: z.string().email().max(255),
  idempotencyKey: z.string().min(1).max(200).optional(),
  templateData: z.record(z.unknown()).optional(),
})

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
    console.error('send-transactional-email: missing environment configuration')
    return json({ error: 'Server configuration error' }, 500)
  }

  let parsed
  try {
    parsed = BodySchema.safeParse(await req.json())
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (!parsed.success) {
    return json({ error: parsed.error.flatten().fieldErrors }, 400)
  }

  const { templateName, recipientEmail, idempotencyKey, templateData } = parsed.data
  const entry = TEMPLATES[templateName]
  if (!entry) {
    console.error('send-transactional-email: unknown template', { templateName })
    return json({ error: `Unknown template: ${templateName}` }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  // Suppression check
  const { data: suppressed } = await supabase
    .from('suppressed_emails')
    .select('email')
    .eq('email', recipientEmail.toLowerCase())
    .maybeSingle()

  const messageId = idempotencyKey || crypto.randomUUID()

  if (suppressed) {
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: recipientEmail,
      status: 'suppressed',
    })
    return json({ ok: false, suppressed: true }, 200)
  }

  const data = (templateData ?? {}) as Record<string, unknown>

  let html: string
  let text: string
  try {
    const element = React.createElement(entry.component, data as any)
    html = await renderAsync(element)
    text = await renderAsync(React.createElement(entry.component, data as any), { plainText: true })
  } catch (err) {
    console.error('send-transactional-email: render failed', { templateName, err })
    return json({ error: 'Failed to render email template' }, 500)
  }

  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: templateName,
    recipient_email: recipientEmail,
    status: 'pending',
  })

  // Get-or-create the one-click unsubscribe token for this recipient.
  const normalizedEmail = recipientEmail.toLowerCase()
  let unsubscribeToken: string | null = null
  {
    const { data: existing } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalizedEmail)
      .maybeSingle()
    if (existing?.token) {
      unsubscribeToken = existing.token
    } else {
      const fresh = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
      const { data: inserted, error: tokenErr } = await supabase
        .from('email_unsubscribe_tokens')
        .insert({ token: fresh, email: normalizedEmail })
        .select('token')
        .maybeSingle()
      if (tokenErr) {
        // Unique-violation race: re-read.
        const { data: retry } = await supabase
          .from('email_unsubscribe_tokens')
          .select('token')
          .eq('email', normalizedEmail)
          .maybeSingle()
        unsubscribeToken = retry?.token ?? null
      } else {
        unsubscribeToken = inserted?.token ?? fresh
      }
    }
  }

  if (!unsubscribeToken) {
    console.error('send-transactional-email: could not resolve unsubscribe token', { recipientEmail })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: recipientEmail,
      status: 'failed',
      error_message: 'Could not create unsubscribe token',
    })
    return json({ error: 'Could not create unsubscribe token' }, 500)
  }

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: recipientEmail,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: resolveSubject(entry, data),
      html,
      text,
      purpose: 'transactional',
      label: templateName,
      idempotency_key: messageId,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('send-transactional-email: enqueue failed', {
      templateName,
      recipientEmail,
      error: enqueueError,
    })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: recipientEmail,
      status: 'failed',
      error_message: `Failed to enqueue: ${enqueueError.message ?? 'unknown error'}`,
    })
    return json({ error: 'Failed to enqueue email' }, 500)
  }

  console.log('send-transactional-email: queued', { templateName, messageId })
  return json({ ok: true, queued: true, messageId }, 200)
})
