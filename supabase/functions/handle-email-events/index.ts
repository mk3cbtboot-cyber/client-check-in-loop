import { createEmailWebhookHandler } from 'npm:@lovable.dev/email-js@0.1.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

// App-side record of terminal delivery outcomes. Notification only — Lovable
// enforces suppression server-side at send time.
function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}

async function record(
  recipient: string,
  logStatus: 'bounced' | 'complained' | 'suppressed',
  reason: 'bounce' | 'complaint' | 'unsubscribe',
  message: string,
  eventId: string
) {
  const supabase = admin()

  const { error: logErr } = await supabase.from('email_send_log').insert({
    message_id: eventId,
    template_name: 'system',
    recipient_email: recipient,
    status: logStatus,
    error_message: message,
  })
  if (logErr) {
    console.error('email_send_log insert failed', {
      code: logErr.code,
      message: logErr.message,
      event_id: eventId,
    })
    throw new Error('email_send_log insert failed')
  }

  const { error: supErr } = await supabase
    .from('suppressed_emails')
    .upsert({ email: recipient.toLowerCase(), reason, metadata: null }, { onConflict: 'email' })
  if (supErr) {
    console.error('suppressed_emails upsert failed', {
      code: supErr.code,
      message: supErr.message,
      event_id: eventId,
    })
    throw new Error('suppressed_emails upsert failed')
  }
}

const handler = createEmailWebhookHandler({
  apiKey: Deno.env.get('LOVABLE_API_KEY')!,
  on: {
    'email.bounced': async (event) => {
      await record(event.data.recipient, 'bounced', 'bounce', 'Email bounced', event.event_id)
    },
    'email.complaint': async (event) => {
      await record(
        event.data.recipient,
        'complained',
        'complaint',
        'Spam complaint received',
        event.event_id
      )
    },
    'email.unsubscribed': async (event) => {
      await record(
        event.data.recipient,
        'suppressed',
        'unsubscribe',
        'Recipient unsubscribed',
        event.event_id
      )
    },
  },
})

Deno.serve((req) => handler(req))
