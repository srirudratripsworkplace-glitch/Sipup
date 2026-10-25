import { useState } from 'react'
import { api } from './api'

export type ConfirmationEmailStatus = { status: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled'; attempts: number; configured: boolean; sent_at: string | null; last_error: string }

export default function OrderEmailStatus({ orderId, orderStatus, email, refresh }: { orderId: number; orderStatus: string; email: ConfirmationEmailStatus | null; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const retry = async () => {
    setBusy(true); setError('')
    try { await api(`/admin/orders/${orderId}/confirmation-email/retry`, { method: 'POST' }); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not retry the email.') }
    finally { setBusy(false) }
  }
  return <section className="drawer-products order-email-status" aria-live="polite"><h3>Customer confirmation email</h3>
    {!email ? <p>{orderStatus === 'booking' ? 'The customer will be emailed when you confirm this booking.' : 'No confirmation email is recorded for this order.'}</p> : <>
      <p>Status: <strong>{({ pending: 'Pending', sending: 'Sending', sent: 'Sent', failed: 'Sending failed', cancelled: 'Cancelled' })[email.status]}</strong>{email.sent_at && ` · ${new Date(email.sent_at).toLocaleString('en-GB')}`}</p>
      {!email.configured && ['pending', 'failed'].includes(email.status) && <p className="inline-note">Sender setup is required. The confirmation is saved and will send after the outgoing email account is connected.</p>}
      {email.status === 'failed' && <p>{email.last_error === 'MISSING_RECIPIENT' ? 'The customer has no valid email address.' : 'The email provider could not accept this message. It will retry automatically, up to 10 attempts.'}</p>}
      <div className="staff-actions"><button className="button button-outline" type="button" disabled={busy} onClick={() => { setBusy(true); refresh().finally(() => setBusy(false)) }}>Refresh email status</button>{email.configured && ['pending', 'failed'].includes(email.status) && email.last_error !== 'MISSING_RECIPIENT' && <button className="button button-outline" type="button" disabled={busy} onClick={retry}>Retry email</button>}</div>
    </>}{error && <p className="inline-error" role="alert">{error}</p>}
  </section>
}
