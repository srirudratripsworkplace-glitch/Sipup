import nodemailer from 'nodemailer'
import { randomUUID } from 'node:crypto'

const money = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value))
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const parse = value => typeof value === 'string' ? JSON.parse(value) : value
const confirmed = ['confirmed', 'processing', 'dispatched', 'delivered']

export function confirmationMessage(order, items, storeName = 'SipUp') {
  const subject = `${storeName}: order ${order.reference} confirmed`
  const lines = items.map(item => `${item.product_name} (${item.sku}) — ${item.quantity} ${item.selling_unit === 'case' ? 'cases' : 'packs/items'} — ${money(item.line_total_gbp)} ex. VAT`)
  const delivery = order.preference === 'collection' ? 'Collection — our team will arrange the details with you.' : `Delivery to: ${order.address}, ${order.postcode}`
  const text = [`Hello ${order.customer_name},`, '', `Your order ${order.reference} has been confirmed by ${storeName}.`, '', ...lines,
    '', `Product subtotal (ex. VAT): ${money(order.subtotal_gbp)}`, `VAT: ${money(Number(order.vat_gbp) + Number(order.delivery_vat_gbp))}`,
    `Delivery (ex. VAT): ${money(order.delivery_gbp)}`, `Order total (inc. VAT): ${money(order.total_gbp)}`, '', delivery,
    ...(order.staff_name ? [`Sales staff: ${order.staff_name}`] : []), '', 'This confirms your order. Payment is recorded separately.', '', `Thank you for ordering with ${storeName}.`].join('\n')
  const html = `<div style="font:16px/1.6 Arial,sans-serif;color:#173b2b;max-width:640px;margin:auto"><h1>Order confirmed</h1><p>Hello ${escape(order.customer_name)},</p><p>Your order <strong>${escape(order.reference)}</strong> has been confirmed by ${escape(storeName)}.</p><ul>${lines.map(line => `<li>${escape(line)}</li>`).join('')}</ul><p>Product subtotal (ex. VAT): ${escape(money(order.subtotal_gbp))}<br>VAT: ${escape(money(Number(order.vat_gbp) + Number(order.delivery_vat_gbp)))}<br>Delivery (ex. VAT): ${escape(money(order.delivery_gbp))}<br><strong>Order total (inc. VAT): ${escape(money(order.total_gbp))}</strong></p><p>${escape(delivery)}</p>${order.staff_name ? `<p>Sales staff: ${escape(order.staff_name)}</p>` : ''}<p>This confirms your order. Payment is recorded separately.</p><p>Thank you for ordering with ${escape(storeName)}.</p></div>`
  return { subject, text, html }
}

// Called inside the same transaction as stock deduction and order confirmation.
export async function enqueueConfirmation(connection, orderId) {
  const order = (await connection.query(`SELECT o.*,c.name AS customer_name,COALESCE(ca.email,c.email,'') AS recipient,
    d.preference,d.address,d.postcode FROM orders o JOIN customers c ON c.id=o.customer_id
    LEFT JOIN customer_accounts ca ON ca.customer_id=c.id JOIN delivery_details d ON d.order_id=o.id WHERE o.id=?`, [orderId])).rows[0]
  const items = (await connection.query(`SELECT oi.product_name,oi.sku,oi.quantity,oi.line_total_gbp,
    JSON_UNQUOTE(JSON_EXTRACT(p.catalogue_details,'$.selling_unit')) AS selling_unit
    FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=? ORDER BY oi.id`, [orderId])).rows
  const settings = (await connection.query("SELECT `value` FROM settings WHERE `key`='store'")).rows[0]
  const storeName = (settings ? parse(settings.value).name : '') || 'SipUp'
  const validRecipient = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.recipient)
  await connection.query(`INSERT IGNORE INTO order_confirmation_emails
    (order_id,message_key,recipient,payload,status,attempts,last_error,next_attempt_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP())`,
  [orderId,randomUUID(),order.recipient,confirmationMessage(order,items,storeName),validRecipient?'pending':'failed',validRecipient?0:10,validRecipient?'':'MISSING_RECIPIENT'])
}

export function smtpSettings(env = process.env) {
  const port = Number(env.SMTP_PORT || 465)
  const configured = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.MAIL_FROM && Number.isInteger(port) && port > 0 && port < 65536)
  return { configured, from: env.MAIL_FROM, options: {
    host: env.SMTP_HOST, port, secure: env.SMTP_SECURE === undefined ? port === 465 : env.SMTP_SECURE === 'true',
    requireTLS: true, auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true,
  } }
}

export function createOrderEmailService(pool) {
  let transport, processing = false, timer
  const service = {
    isConfigured: () => smtpSettings().configured,
    async send(message) {
      const config = smtpSettings()
      if (!config.configured) throw Object.assign(new Error('Outgoing email is not configured.'), { code: 'SMTP_NOT_CONFIGURED' })
      transport ||= nodemailer.createTransport(config.options)
      const info = await transport.sendMail({ ...message, from: config.from })
      if (!info.accepted?.length) throw Object.assign(new Error('Recipient was not accepted.'), { code: 'RECIPIENT_REJECTED' })
      return info
    },
    async drain(limit = 20) {
      if (processing || !service.isConfigured()) return
      processing = true
      try {
        for (let i = 0; i < limit; i++) {
          const connection = await pool.connect()
          let email, token
          try {
            await connection.query('BEGIN')
            const due = await connection.query(`SELECT * FROM order_confirmation_emails
              WHERE ((status IN ('pending','failed') AND attempts<10 AND next_attempt_at<=UTC_TIMESTAMP())
                OR (status='sending' AND locked_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 MINUTE)))
              ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`)
            if (due.rowCount) {
              email = due.rows[0]; token = randomUUID()
              await connection.query("UPDATE order_confirmation_emails SET status='sending',attempts=attempts+1,locked_at=UTC_TIMESTAMP(),lease_token=? WHERE id=?", [token,email.id])
            }
            await connection.query('COMMIT')
          } catch (error) { await connection.query('ROLLBACK'); throw error }
          finally { connection.release() }
          if (!email) break
          try {
            const order = (await pool.query('SELECT status FROM orders WHERE id=?', [email.order_id])).rows[0]
            if (!order || !confirmed.includes(order.status)) {
              await pool.query("UPDATE order_confirmation_emails SET status='cancelled',lease_token=NULL,locked_at=NULL WHERE id=? AND lease_token=?", [email.id,token])
              continue
            }
            await service.send({ ...parse(email.payload), to: email.recipient, messageId: `<sipup-${email.message_key}@${(process.env.SMTP_USER || '').split('@')[1] || 'sipup.local'}>` })
            await pool.query("UPDATE order_confirmation_emails SET status='sent',sent_at=UTC_TIMESTAMP(),last_error='',lease_token=NULL,locked_at=NULL WHERE id=? AND lease_token=?", [email.id,token])
          } catch (error) {
            const code = /^[A-Z0-9_]{1,60}$/.test(error.code || '') ? error.code : 'DELIVERY_FAILED'
            const delay = Math.min(3600, 60 * 2 ** Math.min(Number(email.attempts), 6))
            await pool.query("UPDATE order_confirmation_emails SET status='failed',last_error=?,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? SECOND),lease_token=NULL,locked_at=NULL WHERE id=? AND lease_token=?", [code,delay,email.id,token])
          }
        }
      } finally { processing = false }
    },
    wake() { if (timer) void service.drain().catch(error => console.error('Email worker failed:', error.code || error.name)) },
    start() { if (!timer) { timer = setInterval(() => service.wake(), 30000); timer.unref(); service.wake() } },
    stop() { clearInterval(timer); timer = undefined; transport?.close() },
  }
  return service
}
