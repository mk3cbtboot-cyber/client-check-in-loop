// Append-only application log of email sends (kept from the pre-managed setup).
// Purely a record for the app's own views — it never gates a send.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

type Status = 'sent' | 'suppressed' | 'failed'

export async function logEmailSend(
  supabase: SupabaseClient,
  row: {
    message_id: string | null
    template_name: string
    recipient_email: string
    status: Status
    error_message?: string | null
  }
): Promise<void> {
  const { error } = await supabase.from('email_send_log').insert({
    message_id: row.message_id,
    template_name: row.template_name,
    recipient_email: row.recipient_email,
    status: row.status,
    error_message: row.error_message ?? null,
  })
  if (error) {
    console.error('email_send_log insert failed', { code: error.code, message: error.message })
  }
}
