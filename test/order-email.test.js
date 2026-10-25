import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmationMessage, smtpSettings } from '../server/order-email.js'

test('confirmation messages escape names and preserve quantities, VAT and delivery totals', () => {
  const message = confirmationMessage({ reference: 'SU-TEST', customer_name: '<script>bad</script>', preference: 'delivery', address: '1 Main & High', postcode: 'AB1 2CD', subtotal_gbp: '50.00', vat_gbp: '10.00', delivery_gbp: '5.00', delivery_vat_gbp: '1.00', total_gbp: '66.00', staff_name: 'Team One' },
    [{ product_name: '<Drink>', sku: 'DRINK', quantity: 5, selling_unit: 'case', line_total_gbp: '50.00' }], 'SipUp')
  assert.match(message.text, /5 cases/)
  assert.match(message.text, /VAT: £11\.00/)
  assert.match(message.text, /Order total \(inc. VAT\): £66\.00/)
  assert.match(message.html, /&lt;script&gt;/)
  assert.match(message.html, /&lt;Drink&gt;/)
  assert.ok(!message.html.includes('<script>'))
})

test('SMTP requires a configured sender and credentials and keeps TLS enabled', () => {
  assert.equal(smtpSettings({ SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'sender@gmail.com', MAIL_FROM: 'sender@gmail.com' }).configured, false)
  const settings = smtpSettings({ SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'sender@gmail.com', SMTP_PASSWORD: 'app-password', MAIL_FROM: 'SipUp <sender@gmail.com>' })
  assert.equal(settings.configured, true)
  assert.equal(settings.options.port, 465)
  assert.equal(settings.options.secure, true)
  assert.equal(settings.options.requireTLS, true)
  assert.equal(smtpSettings({ SMTP_PORT: 'bad' }).configured, false)
})
