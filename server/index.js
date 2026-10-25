import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pool } from './pool.js'
import { storeImage, persistImageUrl } from './product-media.js'
import { calculateDelivery, calculateLine, calculatePrice, VAT_RATES } from '../shared/vat.js'
import { refundSources, allocateRefund } from './refund-tax.js'
import { reportFilters, vatReport } from './vat-report.js'
import { pathToFileURL } from 'node:url'

export const app = express()
const port = Number(process.env.PORT || 3000)
const production = process.env.NODE_ENV === 'production'
const cookieName = 'sipup_session'
const customerCookieName = 'sipup_customer_session'
const jwtSecret = process.env.JWT_SECRET
const confirmedStatuses = ['confirmed', 'processing', 'dispatched', 'delivered']

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be set to a random value of at least 32 characters.')
}

app.set('trust proxy', production ? 1 : false)
app.use(helmet({
  contentSecurityPolicy: production ? {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
    },
  } : false,
}))
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }))
app.use(express.json({ limit: '32kb' }))
app.use(cookieParser())
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }))
app.use('/api/account/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }))
app.use('/api/account/register', rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false }))
app.use('/api/orders', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }))

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
const idSchema = z.coerce.number().int().positive()
const statusSchema = z.enum(['booking', 'confirmed', 'processing', 'dispatched', 'delivered', 'cancelled'])
const emailSchema = z.string().trim().email().max(254)
const cleanText = (max) => z.string().trim().max(max)
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const toGbp = (pence) => (Number(pence) / 100).toFixed(2)

function toPence(value) {
  if (typeof value === 'number') return Math.round(value * 100)
  const text = String(value ?? '0').trim()
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) throw new Error('Database returned an invalid GBP amount.')
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0')))
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback
  return typeof value === 'string' ? JSON.parse(value) : value
}

function serializeProduct(row) {
  const details = parseJson(row.catalogue_details, {})
  const { catalogue_details: _internalSource, ...publicRow } = row
  return {
    ...publicRow,
    category_id: row.category_id == null ? null : Number(row.category_id),
    category_slug: row.category_slug,
    parent_category: row.parent_category || null,
    selling_unit: details.selling_unit === 'case' ? 'case' : 'item',
    size: details.size || '',
    flavour: details.flavour || '',
    units_per_case: details.units_per_case || null,
    source_unit_price_pence: details.source_unit_price_pence ?? null,
    source_price_mode: details.price_mode || null,
    review_warnings: details.review_warnings || [],
    id: Number(row.id),
    price_pence: Number(row.price_pence),
    sale_price_pence: row.sale_price_pence === null ? null : Number(row.sale_price_pence),
    vat_treatment: row.vat_treatment,
    vat_rate: row.vat_rate === null ? null : Number(row.vat_rate),
    vat_confirmed: Boolean(row.vat_confirmed),
    price_entry_mode: row.price_entry_mode,
    stock_quantity: Number(row.stock_quantity),
    min_quantity: Number(row.min_quantity),
    is_published: Boolean(row.is_published),
    is_featured: Boolean(row.is_featured),
    is_new: Boolean(row.is_new),
    images: parseJson(row.images, []).map((image) => ({ ...image, id: Number(image.id) })),
    bulk_prices: parseJson(row.bulk_prices, []).map((tier) => ({
      min_quantity: Number(tier.min_quantity),
      unit_price_pence: Number(tier.unit_price_pence),
    })),
  }
}

function issueCookie(res, token, maxAge, name = cookieName) {
  res.cookie(name, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true' || production,
    sameSite: 'strict',
    path: '/',
    maxAge,
  })
}

async function createAudit(connection, adminId, action, entityType, entityId, details = {}) {
  await connection.query(
    'INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, action, entityType, entityId, details],
  )
}

const requireAdmin = asyncRoute(async (req, res, next) => {
  const token = req.cookies[cookieName]
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' })
  let payload
  try {
    payload = jwt.verify(token, jwtSecret, { issuer: 'sipup' })
  } catch {
    res.clearCookie(cookieName, { httpOnly: true, secure: process.env.COOKIE_SECURE === 'true' || production, sameSite: 'strict', path: '/' })
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  }
  const session = await pool.query(`
    SELECT a.id, a.email FROM admin_sessions s
    JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ? AND s.admin_id = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP()
  `, [sha256(token), payload.sub])
  if (!session.rowCount) return res.status(401).json({ error: 'Your session is no longer valid.' })
  req.admin = session.rows[0]
  next()
})

const requireCustomer = asyncRoute(async (req, res, next) => {
  const token = req.cookies[customerCookieName]
  if (!token) return res.status(401).json({ error: 'Sign in or create a SipUp account before placing a booking.' })
  let payload
  try {
    payload = jwt.verify(token, jwtSecret, { issuer: 'sipup', audience: 'customer' })
  } catch {
    res.clearCookie(customerCookieName, { httpOnly: true, secure: process.env.COOKIE_SECURE === 'true' || production, sameSite: 'strict', path: '/' })
    return res.status(401).json({ error: 'Your customer session has expired. Please sign in again.' })
  }
  const session = await pool.query(`
    SELECT c.id, c.name, c.phone, ca.email
    FROM customer_sessions s
    JOIN customer_accounts ca ON ca.customer_id = s.customer_id
    JOIN customers c ON c.id = ca.customer_id
    WHERE s.token_hash = ? AND s.customer_id = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP()
  `, [sha256(token), payload.sub])
  if (!session.rowCount) return res.status(401).json({ error: 'Your customer session is no longer valid. Please sign in again.' })
  req.customer = { ...session.rows[0], id: Number(session.rows[0].id) }
  next()
})

async function setting(key) {
  const result = await pool.query('SELECT `value` FROM settings WHERE `key` = ?', [key])
  return result.rows[0]?.value ?? {}
}

async function getCategories() {
  const result = await pool.query(
    `WITH RECURSIVE descendants AS (
      SELECT id AS ancestor, id FROM categories
      UNION ALL SELECT d.ancestor, c.id FROM descendants d JOIN categories c ON c.parent_id=d.id
    ) SELECT c.id,c.name,c.slug,c.parent_id,c.description,c.sort_order,
      (SELECT COUNT(*) FROM descendants d JOIN products p ON p.category_id=d.id
       WHERE d.ancestor=c.id AND p.is_published=TRUE AND p.vat_confirmed=TRUE) AS product_count
      FROM categories c WHERE c.is_active=TRUE ORDER BY c.sort_order,c.name`,
  )
  return result.rows
}

async function ensureCategory(name) {
  const normalized = name.trim()
  const slug = normalized.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120)
  await pool.query(
    'INSERT INTO categories (name, slug) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), name = VALUES(name), is_active = TRUE',
    [normalized, slug],
  )
  const found = await pool.query('SELECT id FROM categories WHERE slug = ?', [slug])
  return found.rows[0].id
}

async function settingGroup() {
  const [store, homepage] = await Promise.all([setting('store'), setting('homepage')])
  return { store, homepage }
}

const productSelect = `
  SELECT p.id, p.name, p.slug, p.sku, p.brand, p.category_id, c.slug AS category_slug,
    (SELECT pc.name FROM categories pc WHERE pc.id=c.parent_id) AS parent_category,
    p.catalogue_details, COALESCE(c.name, 'Other') AS category,
    p.description, COALESCE((
      SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order, pi.id LIMIT 1
    ), '') AS image_url,
    ROUND(p.price_gbp * 100) AS price_pence,
    CASE WHEN p.sale_price_gbp IS NULL THEN NULL ELSE ROUND(p.sale_price_gbp * 100) END AS sale_price_pence,
    p.stock_quantity, p.min_quantity, p.pack_size, p.is_published, p.is_featured, p.is_new,
    p.vat_treatment, p.vat_rate, p.vat_confirmed, p.price_entry_mode,
    COALESCE((
      SELECT JSON_ARRAYAGG(JSON_OBJECT('id', pi.id, 'image_url', pi.image_url, 'alt_text', pi.alt_text))
      FROM product_images pi WHERE pi.product_id = p.id
    ), JSON_ARRAY()) AS images,
    COALESCE((
      SELECT JSON_ARRAYAGG(JSON_OBJECT('min_quantity', bp.min_quantity, 'unit_price_pence', ROUND(bp.unit_price_gbp * 100)))
      FROM bulk_pricing bp WHERE bp.product_id = p.id
    ), JSON_ARRAY()) AS bulk_prices,
    p.created_at, p.updated_at
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ status: 'ok', database: 'mysql' })
}))

app.get('/api/settings', asyncRoute(async (_req, res) => {
  const { store, homepage } = await settingGroup()
  res.json({
    store: {
      name: store.name || 'SipUp',
      tagline: store.tagline || 'Good stock. Good energy.',
      whatsapp_number: store.whatsapp_number || '',
      email: store.email || '',
      phone: store.phone || '',
      address: store.address || '',
      currency: 'GBP',
      delivery_vat_treatment: store.delivery_vat_treatment || null,
      delivery_charge_pence: Number(store.delivery_charge_pence) || 0,
      free_delivery_threshold_pence: Number(store.free_delivery_threshold_pence) || 0,
      minimum_order_pence: Number(store.minimum_order_pence) || 0,
      business_hours: store.business_hours || '',
      announcement: store.announcement || '',
    },
    homepage,
  })
}))

app.get('/api/categories', asyncRoute(async (_req, res) => {
  res.json({ categories: await getCategories() })
}))

app.get('/api/products', asyncRoute(async (req, res) => {
  const parsed = z.object({
    search: cleanText(100).optional(),
    category: cleanText(100).optional(),
    brand: cleanText(100).optional(),
    sort: z.enum(['featured', 'price_asc', 'price_desc', 'newest']).default('featured'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(48).default(24),
  }).safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid catalogue filters.' })
  const { search, category, brand, sort, page, limit } = parsed.data
  const conditions = ['p.is_published = TRUE', 'p.vat_confirmed = TRUE', 'p.vat_treatment IS NOT NULL']
  const params = []
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
    conditions.push('(p.name LIKE ? OR p.brand LIKE ? OR p.sku LIKE ?)')
    params.push(pattern, pattern, pattern)
  }
  if (category && category !== 'All') {
    conditions.push(`p.category_id IN (WITH RECURSIVE selected_categories AS (
      SELECT id FROM categories WHERE slug=? OR name=?
      UNION DISTINCT SELECT child.id FROM categories child JOIN selected_categories parent ON child.parent_id=parent.id
    ) SELECT id FROM selected_categories)`)
    params.push(category,category)
  }
  if (brand) { conditions.push('p.brand = ?'); params.push(brand) }
  const where = conditions.join(' AND ')
  const orderBy = {
    featured: 'p.is_featured DESC, p.created_at DESC, p.id DESC',
    price_asc: 'COALESCE(p.sale_price_gbp, p.price_gbp) * (1 + COALESCE(p.vat_rate, 0) / 100) ASC, p.id ASC',
    price_desc: 'COALESCE(p.sale_price_gbp, p.price_gbp) * (1 + COALESCE(p.vat_rate, 0) / 100) DESC, p.id DESC',
    newest: 'p.created_at DESC, p.id DESC',
  }[sort]
  const count = await pool.query(
    `SELECT COUNT(*) AS total FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${where}`,
    params,
  )
  const result = await pool.query(
    `${productSelect} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  )
  res.json({ products: result.rows.map(serializeProduct), total: Number(count.rows[0].total), page, pages: Math.ceil(Number(count.rows[0].total) / limit) })
}))

app.get('/api/catalogue/filters', asyncRoute(async (_req,res) => {
  const brands=await pool.query("SELECT DISTINCT brand FROM products WHERE is_published=TRUE AND vat_confirmed=TRUE AND vat_treatment IS NOT NULL AND brand<>'' ORDER BY brand")
  res.json({ categories:await getCategories(), brands:brands.rows.map(r=>r.brand) })
}))

app.get('/api/products/:slug', asyncRoute(async (req, res) => {
  const result = await pool.query(`${productSelect} WHERE p.slug = ? AND p.is_published = TRUE AND p.vat_confirmed = TRUE AND p.vat_treatment IS NOT NULL LIMIT 1`, [req.params.slug])
  if (!result.rowCount) return res.status(404).json({ error: 'This product could not be found.' })
  res.json(serializeProduct(result.rows[0]))
}))

const checkoutSchema = z.object({
  expected_total_pence: z.coerce.number().int().min(0).optional(),
  customer: z.object({
    address: cleanText(300).optional().default(''),
    postcode: cleanText(16).optional().default(''),
    preference: z.enum(['delivery', 'collection']),
    notes: cleanText(1000).optional().default(''),
  }),
  items: z.array(z.object({
    productId: idSchema,
    quantity: z.coerce.number().int().min(1).max(500),
  })).min(1).max(50),
})

export async function calculateCheckoutQuote(connection, requestedItems, preference, lockProducts = false) {
  const quantities = new Map()
  for (const item of requestedItems) quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity)
  const productIds = [...quantities.keys()]
  const productRows = await connection.query(`
    SELECT p.id, p.name, p.sku, p.price_gbp, p.sale_price_gbp, p.stock_quantity, p.min_quantity,
      p.vat_treatment, p.vat_rate, p.vat_confirmed, p.price_entry_mode
      , (SELECT c.name FROM categories c WHERE c.id=p.category_id) AS category_name
    FROM products p WHERE p.id IN (${productIds.map(() => '?').join(',')})
      AND p.is_published = TRUE ${lockProducts ? 'FOR UPDATE' : ''}
  `, productIds)
  if (productRows.rowCount !== quantities.size) {
    throw new Error('One or more products are no longer available. Refresh the catalogue and try again.')
  }
  const products = new Map(productRows.rows.map((product) => [Number(product.id), product]))
  const bulkPricing = await connection.query(`
    SELECT product_id, min_quantity, unit_price_gbp FROM bulk_pricing
    WHERE product_id IN (${productIds.map(() => '?').join(',')})
    ORDER BY product_id, min_quantity DESC
  `, productIds)
  const tiersByProduct = new Map()
  for (const tier of bulkPricing.rows) {
    const tiers = tiersByProduct.get(Number(tier.product_id)) || []
    tiers.push(tier)
    tiersByProduct.set(Number(tier.product_id), tiers)
  }
  const items = [...quantities].map(([productId, quantity]) => {
    const product = products.get(productId)
    if (!product.vat_confirmed || !product.vat_treatment) {
      throw new Error(`VAT classification for ${product.name} must be confirmed before it can be ordered.`)
    }
    if (quantity < product.min_quantity) throw new Error(`Minimum order quantity for ${product.name} is ${product.min_quantity}.`)
    if (quantity > product.stock_quantity) throw new Error(`Only ${product.stock_quantity} of ${product.name} are currently available.`)
    const tier = (tiersByProduct.get(productId) || []).find((candidate) => quantity >= candidate.min_quantity)
    const regularUnitPrice = toPence(product.price_gbp)
    const unitPrice = tier ? toPence(tier.unit_price_gbp) : toPence(product.sale_price_gbp ?? product.price_gbp)
    const amounts = calculateLine(unitPrice, quantity, product.vat_treatment)
    return {
      product, quantity, unitPrice, lineTotal: amounts.netPence, amounts,
      discountPence: Math.max(regularUnitPrice - unitPrice, 0) * quantity,
    }
  })
  const subtotal = items.reduce((total, item) => total + item.lineTotal, 0)
  const storeResult = await connection.query('SELECT `value` FROM settings WHERE `key` = ?', ['store'])
  const settings = parseJson(storeResult.rows[0]?.value, {})
  const minimum = Number(settings.minimum_order_pence) || 0
  if (subtotal < minimum) throw new Error(`The minimum order value is £${toGbp(minimum)}.`)
  const threshold = Number(settings.free_delivery_threshold_pence) || 0
  const delivery = preference === 'collection' || (threshold > 0 && subtotal >= threshold)
    ? 0 : Number(settings.delivery_charge_pence) || 0
  const deliveryTreatment = settings.delivery_vat_treatment
  if (delivery > 0 && !Object.hasOwn(VAT_RATES, deliveryTreatment)) {
    throw new Error('Delivery VAT treatment must be configured by an administrator before delivery can be ordered.')
  }
  const deliveryAmounts = delivery > 0 ? calculateDelivery(delivery, deliveryTreatment) : {
    netPence: 0, vatPence: 0, grossPence: 0, rate: deliveryTreatment ? VAT_RATES[deliveryTreatment] : null,
  }
  const vat = items.reduce((total, item) => total + item.amounts.vatPence, 0) + deliveryAmounts.vatPence
  const total = subtotal + delivery + vat
  if (!Number.isSafeInteger(total) || total > 999_999_999_999) throw new Error('Order value exceeds the supported maximum.')
  const summaries = new Map()
  for (const item of items) {
    const key = `${item.product.vat_treatment}:${item.amounts.rate ?? 'exempt'}`
    const current = summaries.get(key) || {
      treatment: item.product.vat_treatment, rate: item.amounts.rate,
      netPence: 0, vatPence: 0, grossPence: 0,
    }
    current.netPence += item.amounts.netPence
    current.vatPence += item.amounts.vatPence
    current.grossPence += item.amounts.grossPence
    summaries.set(key, current)
  }
  const breakdowns = [...summaries.values()]
  if (delivery > 0) breakdowns.push({
    treatment: deliveryTreatment, rate: deliveryAmounts.rate,
    netPence: deliveryAmounts.netPence, vatPence: deliveryAmounts.vatPence,
    grossPence: deliveryAmounts.grossPence, isDelivery: true,
  })
  return { items, subtotal, vat, delivery, deliveryTreatment, deliveryAmounts, total, breakdowns }
}

function checkoutValidationError(error) {
  return error.message.startsWith('One or more products')
    || error.message.startsWith('Minimum order')
    || error.message.startsWith('Only ')
    || error.message.startsWith('Order value')
    || error.message.startsWith('VAT classification')
    || error.message.startsWith('Delivery VAT treatment')
}

async function findIdempotentOrder(referenceKey, customerId) {
  const order = await pool.query(`
    SELECT o.id, o.reference, o.status, c.name AS customer_name, c.phone AS customer_phone,
      COALESCE(c.email, '') AS customer_email, d.address AS delivery_address,
      d.postcode AS delivery_postcode, d.preference AS delivery_preference, d.customer_notes AS notes,
      ROUND(o.subtotal_gbp * 100) AS subtotal_pence, ROUND(o.vat_gbp * 100) AS vat_pence,
      ROUND(o.delivery_gbp * 100) AS delivery_pence, ROUND(o.delivery_vat_gbp * 100) AS delivery_vat_pence,
      ROUND(o.total_gbp * 100) AS total_pence
    FROM orders o JOIN customers c ON c.id = o.customer_id
    JOIN delivery_details d ON d.order_id = o.id WHERE o.idempotency_key = ? AND o.customer_id = ? LIMIT 1
  `, [referenceKey, customerId])
  if (!order.rowCount) return null
  const saved = order.rows[0]
  const items = await pool.query(`
    SELECT product_name AS name, sku, quantity,
      ROUND(unit_price_gbp * 100) AS unit_price_pence, ROUND(line_total_gbp * 100) AS line_total_pence,
      vat_treatment, vat_rate, price_entry_mode, ROUND(discount_gbp * 100) AS discount_pence,
      ROUND(line_net_gbp * 100) AS line_net_pence,
      ROUND(line_vat_gbp * 100) AS line_vat_pence, ROUND(line_gross_gbp * 100) AS line_gross_pence
    FROM order_items WHERE order_id = ? ORDER BY id
  `, [saved.id])
  return {
    reference: saved.reference, status: saved.status,
    customer: {
      name: saved.customer_name, phone: saved.customer_phone, email: saved.customer_email,
      address: saved.delivery_address, postcode: saved.delivery_postcode,
      preference: saved.delivery_preference, notes: saved.notes,
    },
    items: items.rows.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      unit_price_pence: Number(item.unit_price_pence),
      line_total_pence: Number(item.line_total_pence),
      vat_rate: item.vat_rate === null ? null : Number(item.vat_rate),
      discount_pence: Number(item.discount_pence || 0),
      line_net_pence: item.line_net_pence === null ? null : Number(item.line_net_pence),
      line_vat_pence: item.line_vat_pence === null ? null : Number(item.line_vat_pence),
      line_gross_pence: item.line_gross_pence === null ? null : Number(item.line_gross_pence),
    })),
    subtotal_pence: Number(saved.subtotal_pence),
    vat_pence: Number(saved.vat_pence),
    delivery_pence: Number(saved.delivery_pence),
    delivery_vat_pence: Number(saved.delivery_vat_pence || 0),
    total_pence: Number(saved.total_pence),
  }
}

app.post('/api/checkout/preview', requireCustomer, asyncRoute(async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Please check the order details and try again.' })
  try {
    const quote = await calculateCheckoutQuote(pool, parsed.data.items, parsed.data.customer.preference)
    res.json({
      items: quote.items.map(({ product, quantity, unitPrice, amounts }) => ({
        product_id: Number(product.id), name: product.name, sku: product.sku, quantity,
        unit_price_pence: unitPrice, line_net_pence: amounts.netPence,
        line_vat_pence: amounts.vatPence, line_gross_pence: amounts.grossPence,
        vat_treatment: product.vat_treatment, vat_rate: amounts.rate,
      })),
      subtotal_pence: quote.subtotal, vat_pence: quote.vat,
      delivery_pence: quote.delivery, delivery_vat_pence: quote.deliveryAmounts.vatPence,
      total_pence: quote.total,
      vat_breakdowns: quote.breakdowns.map((row) => ({
        vat_treatment: row.treatment, vat_rate: row.rate,
        net_pence: row.netPence, vat_pence: row.vatPence,
        gross_pence: row.grossPence, is_delivery: Boolean(row.isDelivery),
      })),
    })
  } catch (error) {
    if (checkoutValidationError(error)) return res.status(400).json({ error: error.message })
    throw error
  }
}))

app.post('/api/orders', requireCustomer, asyncRoute(async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Please check the order details and try again.' })
  const requestKey = z.string().uuid().safeParse(req.get('Idempotency-Key'))
  if (!requestKey.success) return res.status(400).json({ error: 'A valid checkout request key is required. Refresh checkout and try again.' })
  const { customer } = parsed.data
  if (customer.preference === 'delivery' && (!customer.address || !customer.postcode)) {
    return res.status(400).json({ error: 'Delivery orders need an address and postcode.' })
  }
  const previousOrder = await findIdempotentOrder(requestKey.data, req.customer.id)
  if (previousOrder) return res.json(previousOrder)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const quote = await calculateCheckoutQuote(client, parsed.data.items, customer.preference, true)
    const { items, subtotal, vat, delivery, deliveryTreatment, deliveryAmounts, total, breakdowns } = quote
    if (parsed.data.expected_total_pence !== undefined && parsed.data.expected_total_pence !== total) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Prices or tax changed since checkout was displayed. Review the updated total and try again.' })
    }

    const customerId = req.customer.id
    const reference = `SU-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`
    const order = await client.query(`
      INSERT INTO orders
        (customer_id, reference, idempotency_key, status, subtotal_gbp, vat_gbp, delivery_gbp,
         delivery_vat_treatment, delivery_vat_rate, delivery_vat_gbp, total_gbp, admin_notes)
      VALUES (?, ?, ?, 'booking', ?, ?, ?, ?, ?, ?, ?, '')
    `, [customerId, reference, requestKey.data, toGbp(subtotal), toGbp(vat), toGbp(delivery),
      delivery > 0 ? deliveryTreatment : null, delivery > 0 ? deliveryAmounts.rate : null,
      toGbp(deliveryAmounts.vatPence), toGbp(total)])
    const orderId = order.insertId
    await client.query(
      'INSERT INTO delivery_details (order_id, preference, address, postcode, customer_notes) VALUES (?, ?, ?, ?, ?)',
      [orderId, customer.preference, customer.address, customer.postcode, customer.notes],
    )
    for (const item of items) {
      await client.query(`
        INSERT INTO order_items
          (order_id, product_id, product_name, sku, quantity, unit_price_gbp, line_total_gbp,
           vat_treatment, vat_rate, price_entry_mode, discount_gbp,
           line_net_gbp, line_vat_gbp, line_gross_gbp, category_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [orderId, item.product.id, item.product.name, item.product.sku, item.quantity,
        toGbp(item.unitPrice), toGbp(item.lineTotal), item.product.vat_treatment,
        item.amounts.rate, item.product.price_entry_mode, toGbp(item.discountPence),
        toGbp(item.amounts.netPence), toGbp(item.amounts.vatPence),
        toGbp(item.amounts.grossPence), item.product.category_name])
    }
    for (const summary of breakdowns.filter((row) => !row.isDelivery)) {
      await client.query(`INSERT INTO order_vat_breakdowns
        (order_id, vat_treatment, vat_rate, net_gbp, vat_gbp, gross_gbp, is_delivery)
        VALUES (?, ?, ?, ?, ?, ?, FALSE)`, [orderId, summary.treatment, summary.rate,
        toGbp(summary.netPence), toGbp(summary.vatPence), toGbp(summary.grossPence)])
    }
    if (delivery > 0) {
      await client.query(`INSERT INTO order_vat_breakdowns
        (order_id, vat_treatment, vat_rate, net_gbp, vat_gbp, gross_gbp, is_delivery)
        VALUES (?, ?, ?, ?, ?, ?, TRUE)`, [orderId, deliveryTreatment, deliveryAmounts.rate,
        toGbp(deliveryAmounts.netPence), toGbp(deliveryAmounts.vatPence),
        toGbp(deliveryAmounts.grossPence)])
    }
    await client.query(
      'INSERT INTO order_events (order_id, event_type, details) VALUES (?, ?, ?)',
      [orderId, 'booking_created', { source: 'storefront' }],
    )
    await client.query('COMMIT')
    res.status(201).json({
      reference, status: 'booking', customer: { ...req.customer, ...customer },
      items: items.map(({ product, quantity, unitPrice, lineTotal, amounts, discountPence }) => ({
        name: product.name, sku: product.sku, quantity, unit_price_pence: unitPrice,
        line_total_pence: lineTotal, vat_treatment: product.vat_treatment,
        vat_rate: amounts.rate, price_entry_mode: product.price_entry_mode,
        discount_pence: discountPence, line_vat_pence: amounts.vatPence,
        line_gross_pence: amounts.grossPence,
      })),
      subtotal_pence: subtotal, vat_pence: vat, delivery_pence: delivery,
      delivery_vat_pence: deliveryAmounts.vatPence, total_pence: total,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === 'ER_DUP_ENTRY') {
      const previous = await findIdempotentOrder(requestKey.data, req.customer.id)
      if (previous) return res.status(200).json(previous)
      return res.status(409).json({ error: 'This checkout request was already used. Refresh your basket and try again.' })
    }
    if (checkoutValidationError(error)) {
      return res.status(400).json({ error: error.message })
    }
    throw error
  } finally {
    client.release()
  }
}))

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(200) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' })
  const result = await pool.query('SELECT id, email, password_hash FROM admins WHERE email = ? LIMIT 1', [parsed.data.email.toLowerCase()])
  const valid = result.rowCount && await bcrypt.compare(parsed.data.password, result.rows[0].password_hash)
  if (!valid) return res.status(401).json({ error: 'Email or password is incorrect.' })
  const token = jwt.sign({ sub: String(result.rows[0].id) }, jwtSecret, { expiresIn: '8h', issuer: 'sipup' })
  await pool.query('INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))', [result.rows[0].id, sha256(token)])
  issueCookie(res, token, 8 * 60 * 60 * 1000)
  res.json({ admin: { email: result.rows[0].email } })
}))

async function startCustomerSession(connection, customerId) {
  const token = jwt.sign({ sub: String(customerId) }, jwtSecret, {
    expiresIn: '30d',
    issuer: 'sipup',
    audience: 'customer',
  })
  await connection.query(
    'INSERT INTO customer_sessions (customer_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY))',
    [customerId, sha256(token)],
  )
  return token
}

app.post('/api/account/register', asyncRoute(async (req, res) => {
  const parsed = z.object({
    name: cleanText(120).min(2),
    phone: cleanText(30).min(7),
    email: emailSchema,
    password: z.string().min(10).max(200),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check your account details and try again.' })
  const email = parsed.data.email.toLowerCase()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const duplicate = await client.query('SELECT customer_id FROM customer_accounts WHERE email = ? FOR UPDATE', [email])
    if (duplicate.rowCount) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'An account already uses this email. Please sign in instead.' })
    }
    const customer = await client.query(
      'INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)',
      [parsed.data.name, parsed.data.phone, email],
    )
    const customerId = customer.insertId
    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    await client.query(
      'INSERT INTO customer_accounts (customer_id, email, password_hash) VALUES (?, ?, ?)',
      [customerId, email, passwordHash],
    )
    const token = await startCustomerSession(client, customerId)
    await client.query('COMMIT')
    issueCookie(res, token, 30 * 24 * 60 * 60 * 1000, customerCookieName)
    res.status(201).json({ customer: { id: customerId, name: parsed.data.name, phone: parsed.data.phone, email } })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account already uses this email or phone number.' })
    throw error
  } finally {
    client.release()
  }
}))

app.post('/api/account/login', asyncRoute(async (req, res) => {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(200) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' })
  const result = await pool.query(`
    SELECT c.id, c.name, c.phone, ca.email, ca.password_hash
    FROM customer_accounts ca JOIN customers c ON c.id = ca.customer_id
    WHERE ca.email = ? LIMIT 1
  `, [parsed.data.email.toLowerCase()])
  const valid = result.rowCount && await bcrypt.compare(parsed.data.password, result.rows[0].password_hash)
  if (!valid) return res.status(401).json({ error: 'Email or password is incorrect.' })
  const token = await startCustomerSession(pool, result.rows[0].id)
  issueCookie(res, token, 30 * 24 * 60 * 60 * 1000, customerCookieName)
  res.json({ customer: { id: Number(result.rows[0].id), name: result.rows[0].name, phone: result.rows[0].phone, email: result.rows[0].email } })
}))

app.get('/api/account/me', requireCustomer, (req, res) => res.json({ customer: req.customer }))

app.post('/api/account/logout', asyncRoute(async (req, res) => {
  const token = req.cookies[customerCookieName]
  if (token) await pool.query(
    'UPDATE customer_sessions SET revoked_at = UTC_TIMESTAMP() WHERE token_hash = ? AND revoked_at IS NULL',
    [sha256(token)],
  )
  res.clearCookie(customerCookieName, { httpOnly: true, secure: process.env.COOKIE_SECURE === 'true' || production, sameSite: 'strict', path: '/' })
  res.status(204).end()
}))

app.get('/api/account/orders', requireCustomer, asyncRoute(async (req, res) => {
  const parsed = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }).safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid order history page.' })
  const { page, limit } = parsed.data
  const count = await pool.query('SELECT COUNT(*) AS total FROM orders WHERE customer_id = ?', [req.customer.id])
  const orders = await orderRows('WHERE o.customer_id = ?', [req.customer.id], limit, (page - 1) * limit)
  res.json({ orders, total: Number(count.rows[0].total), page, pages: Math.ceil(Number(count.rows[0].total) / limit) })
}))

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  const token = req.cookies[cookieName]
  if (token) await pool.query('UPDATE admin_sessions SET revoked_at = UTC_TIMESTAMP() WHERE token_hash = ? AND revoked_at IS NULL', [sha256(token)])
  res.clearCookie(cookieName, { httpOnly: true, secure: process.env.COOKIE_SECURE === 'true' || production, sameSite: 'strict', path: '/' })
  res.status(204).end()
}))

app.get('/api/product-media/:hash', asyncRoute(async (req, res) => {
  if (!/^[a-f0-9]{64}$/.test(req.params.hash)) return res.status(404).end()
  const result = await pool.query('SELECT mime_type, image_data FROM product_media WHERE sha256 = ?', [req.params.hash])
  if (!result.rowCount) return res.status(404).end()
  res.set('Cache-Control', 'public, max-age=31536000, immutable')
  res.set('ETag', `"${req.params.hash}"`)
  res.type(result.rows[0].mime_type).send(result.rows[0].image_data)
}))

app.post('/api/admin/product-media', requireAdmin,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'], limit: '5mb' }),
  asyncRoute(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Upload a JPEG, PNG, WebP, AVIF or GIF image.' })
    res.status(201).json({ image_url: await storeImage(pool, req.body) })
  }))

app.get('/api/auth/me', requireAdmin, (req, res) => res.json({ admin: { email: req.admin.email } }))

app.get('/api/admin/dashboard', requireAdmin, asyncRoute(async (req, res) => {
  const period = z.enum(['day', 'week', 'month']).safeParse(req.query.period || 'day')
  if (!period.success) return res.status(400).json({ error: 'Invalid reporting period.' })
  const range = { day: 6, week: 7, month: 11 }[period.data]
  const [metrics, lowStock, topProducts, recent, sales] = await Promise.all([
    pool.query(`
      SELECT COUNT(*) AS total_orders,
        COALESCE(SUM(status = 'booking'), 0) AS new_orders,
        COALESCE(SUM(status = 'confirmed'), 0) AS confirmed_orders,
        COALESCE(SUM(status = 'processing'), 0) AS processing_orders,
        COALESCE(SUM(status = 'dispatched'), 0) AS dispatched_orders,
        COALESCE(SUM(status = 'delivered'), 0) AS delivered_orders,
        COALESCE(SUM(status = 'cancelled'), 0) AS cancelled_orders,
        ROUND(COALESCE(SUM(IF(status = 'booking', total_gbp, 0)),0) * 100) AS booking_value_pence,
        ROUND(COALESCE(SUM(IF(status IN ('confirmed','processing','dispatched','delivered'), total_gbp, 0)),0) * 100) AS confirmed_value_pence,
        ROUND(COALESCE(SUM(IF(status <> 'cancelled', total_gbp, 0)),0) * 100) AS total_order_value_pence,
        ROUND(((SELECT COALESCE(SUM(amount_gbp),0) FROM payments)
          - (SELECT COALESCE(SUM(amount_gbp),0) FROM refunds)) * 100) AS paid_revenue_pence,
        ROUND(COALESCE((SELECT SUM(GREATEST(
          o.total_gbp - COALESCE((SELECT SUM(p.amount_gbp) FROM payments p WHERE p.order_id = o.id),0)
          + COALESCE((SELECT SUM(r.amount_gbp) FROM refunds r WHERE r.order_id = o.id),0), 0))
          FROM orders o WHERE o.status IN ('confirmed','processing','dispatched','delivered')),0) * 100) AS outstanding_pence
      FROM orders
    `),
    pool.query('SELECT COUNT(*) AS low_stock FROM products WHERE stock_quantity <= 12 AND is_published = TRUE'),
    pool.query(`
      SELECT oi.product_name, SUM(oi.quantity) AS units FROM order_items oi
      JOIN orders o ON o.id = oi.order_id WHERE o.status <> 'cancelled'
      GROUP BY oi.product_name ORDER BY units DESC LIMIT 5
    `),
    pool.query(`
      SELECT o.id, o.reference, c.name AS customer_name, c.phone AS customer_phone, o.status,
        ROUND(o.total_gbp * 100) AS total_pence, o.created_at,
        ROUND((COALESCE((SELECT SUM(p.amount_gbp) FROM payments p WHERE p.order_id=o.id),0)
          - COALESCE((SELECT SUM(r.amount_gbp) FROM refunds r WHERE r.order_id=o.id),0)) * 100) AS paid_pence
      FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.created_at DESC LIMIT 8
    `),
    getSalesTrend(period.data, range),
  ])
  const metric = metrics.rows[0]
  for (const key of Object.keys(metric)) metric[key] = Number(metric[key] || 0)
  const recentOrders = recent.rows.map((order) => ({
    ...order, id: Number(order.id), total_pence: Number(order.total_pence), paid_pence: Number(order.paid_pence),
  }))

  res.json({
    metrics: { ...metric, low_stock: Number(lowStock.rows[0].low_stock) },
    top_products: topProducts.rows.map((item) => ({ ...item, units: Number(item.units) })),
    recent_orders: recentOrders,
    sales_trend: sales,
    period: period.data,
  })
}))

app.get('/api/admin/vat/dashboard', requireAdmin, asyncRoute(async (req, res) => {
  const filters = reportFilters.safeParse(req.query)
  if (!filters.success) return res.status(400).json({ error: 'Invalid VAT report filters or date range.' })
  res.json(await vatReport(pool, filters.data))
}))

app.get('/api/admin/vat/export.csv', requireAdmin, asyncRoute(async (req, res) => {
  const filters = reportFilters.safeParse(req.query)
  if (!filters.success) return res.status(400).json({ error: 'Invalid VAT report filters or date range.' })
  const report = await vatReport(pool, filters.data)
  const rows = [['Type','Treatment','Rate','Delivery','Net GBP','VAT GBP','Gross GBP','Orders','Discount GBP']]
  for (const type of ['orders', 'refunds']) for (const row of report[type]) rows.push([
    type, row.vat_treatment, row.vat_rate ?? 'Exempt', row.is_delivery ? 'Yes' : 'No',
    toGbp(row.net_pence), toGbp(row.vat_pence), toGbp(row.gross_pence), row.order_count, toGbp(row.discount_pence || 0),
  ])
  rows.push(['Unallocated refunds','','','', '', '', toGbp(report.unallocated_refunds.gross_pence), report.unallocated_refunds.refund_count,''])
  rows.push(['Legacy orders without tax','','','','','','',report.legacy_orders_without_tax,''])
  for (const state of report.refund_states) rows.push([`${state.status} ${state.refund_state} refund`,'','','','','','',state.order_count,''])
  res.type('text/csv').attachment('sipup-vat-report.csv').send(rows.map((row) => row.join(',')).join('\r\n'))
}))

async function getSalesTrend(period, range) {
  const grouping = period === 'day'
    ? "DATE_FORMAT(created_at, '%Y-%m-%d')"
    : period === 'week'
      ? "DATE_FORMAT(DATE_SUB(DATE(created_at), INTERVAL WEEKDAY(created_at) DAY), '%Y-%m-%d')"
      : "DATE_FORMAT(created_at, '%Y-%m-01')"
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  if (period === 'day') start.setUTCDate(start.getUTCDate() - range)
  if (period === 'week') {
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7 - range * 7)
  }
  if (period === 'month') {
    start.setUTCDate(1)
    start.setUTCMonth(start.getUTCMonth() - range)
  }
  const result = await pool.query(`
    SELECT ${grouping} AS period_start, COUNT(*) AS order_count,
      ROUND(COALESCE(SUM(IF(status IN ('confirmed','processing','dispatched','delivered'), subtotal_gbp, 0)),0) * 100) AS sales_pence
    FROM orders
    WHERE created_at >= ?
    GROUP BY period_start ORDER BY period_start
  `, [start])
  const byKey = new Map(result.rows.map((row) => [String(row.period_start).slice(0, 10), row]))
  return Array.from({ length: range + 1 }, (_, index) => {
    const date = new Date(start)
    if (period === 'day') date.setUTCDate(date.getUTCDate() + index)
    if (period === 'week') date.setUTCDate(date.getUTCDate() + index * 7)
    if (period === 'month') date.setUTCMonth(date.getUTCMonth() + index)
    const key = date.toISOString().slice(0, 10)
    const item = byKey.get(key)
    const label = period === 'day'
      ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
      : period === 'week'
        ? `W${getIsoWeek(date)}`
        : date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    return { label, order_count: Number(item?.order_count || 0), sales_pence: Number(item?.sales_pence || 0) }
  })
}

function getIsoWeek(date) {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  thursday.setUTCDate(thursday.getUTCDate() + 3 - (thursday.getUTCDay() + 6) % 7)
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + (firstThursday.getUTCDay() + 6) % 7) / 7)
}

async function orderRows(where = '', params = [], limit = 50, offset = 0) {
  const result = await pool.query(`
    SELECT o.id, o.reference, o.status, o.admin_notes, o.stock_deducted, o.created_at, o.updated_at,
      ROUND(o.subtotal_gbp * 100) AS subtotal_pence, ROUND(o.vat_gbp * 100) AS vat_pence,
      ROUND(o.delivery_gbp * 100) AS delivery_pence, ROUND(o.delivery_vat_gbp * 100) AS delivery_vat_pence,
      ROUND(o.total_gbp * 100) AS total_pence,
      c.name AS customer_name, c.phone AS customer_phone, COALESCE(c.email, '') AS customer_email,
      d.address AS delivery_address, d.postcode AS delivery_postcode,
      d.preference AS delivery_preference, d.customer_notes AS notes,
      ROUND((COALESCE((SELECT SUM(p.amount_gbp) FROM payments p WHERE p.order_id = o.id),0)
        - COALESCE((SELECT SUM(r.amount_gbp) FROM refunds r WHERE r.order_id = o.id),0)) * 100) AS paid_pence
    FROM orders o JOIN customers c ON c.id = o.customer_id
    JOIN delivery_details d ON d.order_id = o.id
    ${where}
    ORDER BY o.created_at DESC LIMIT ? OFFSET ?
  `, [...params, limit, offset])
  const rows = result.rows
  if (!rows.length) return rows
  const itemResult = await pool.query(`
    SELECT order_id, id, product_id, product_name, sku, quantity,
      ROUND(unit_price_gbp * 100) AS unit_price_pence,
      ROUND(line_total_gbp * 100) AS line_total_pence,
      vat_treatment, vat_rate, price_entry_mode, ROUND(discount_gbp * 100) AS discount_pence,
      ROUND(line_net_gbp * 100) AS line_net_pence,
      ROUND(line_vat_gbp * 100) AS line_vat_pence, ROUND(line_gross_gbp * 100) AS line_gross_pence
    FROM order_items WHERE order_id IN (${rows.map(() => '?').join(',')}) ORDER BY id
  `, rows.map((row) => row.id))
  const itemsByOrder = new Map()
  for (const item of itemResult.rows) {
    const group = itemsByOrder.get(Number(item.order_id)) || []
    group.push({
      ...item,
      product_id: item.product_id === null ? null : Number(item.product_id),
      quantity: Number(item.quantity),
      unit_price_pence: Number(item.unit_price_pence),
      line_total_pence: Number(item.line_total_pence),
      vat_rate: item.vat_rate === null ? null : Number(item.vat_rate),
      discount_pence: Number(item.discount_pence || 0),
      line_net_pence: item.line_net_pence === null ? null : Number(item.line_net_pence),
      line_vat_pence: item.line_vat_pence === null ? null : Number(item.line_vat_pence),
      line_gross_pence: item.line_gross_pence === null ? null : Number(item.line_gross_pence),
    })
    itemsByOrder.set(Number(item.order_id), group)
  }
  const vatResult = await pool.query(`
    SELECT order_id, vat_treatment, vat_rate, net_gbp, vat_gbp, gross_gbp, is_delivery
    FROM order_vat_breakdowns WHERE order_id IN (${rows.map(() => '?').join(',')})
    ORDER BY id
  `, rows.map((row) => row.id))
  const vatByOrder = new Map()
  for (const summary of vatResult.rows) {
    const group = vatByOrder.get(Number(summary.order_id)) || []
    group.push({
      vat_treatment: summary.vat_treatment,
      vat_rate: summary.vat_rate === null ? null : Number(summary.vat_rate),
      net_pence: toPence(summary.net_gbp),
      vat_pence: toPence(summary.vat_gbp),
      gross_pence: toPence(summary.gross_gbp),
      is_delivery: Boolean(summary.is_delivery),
    })
    vatByOrder.set(Number(summary.order_id), group)
  }
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    subtotal_pence: Number(row.subtotal_pence),
    vat_pence: Number(row.vat_pence),
    delivery_pence: Number(row.delivery_pence),
    delivery_vat_pence: Number(row.delivery_vat_pence || 0),
    total_pence: Number(row.total_pence),
    paid_pence: Number(row.paid_pence || 0),
    items: itemsByOrder.get(Number(row.id)) || [],
    vat_breakdowns: vatByOrder.get(Number(row.id)) || [],
  }))
}

app.get('/api/admin/orders/export.csv', requireAdmin, asyncRoute(async (_req, res) => {
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const batch = await orderRows('', [], 1000, offset)
    rows.push(...batch)
    if (batch.length < 1000) break
  }
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const lines = [
    ['Reference', 'Created', 'Customer', 'Phone', 'Status', 'Subtotal (GBP)', 'VAT (GBP)', 'Delivery (GBP)', 'Total (GBP)', 'Paid (GBP)', 'Outstanding (GBP)'].map(escape).join(','),
    ...rows.map((row) => [
      row.reference, new Date(row.created_at).toISOString(), row.customer_name, row.customer_phone, row.status,
      toGbp(row.subtotal_pence), toGbp(row.vat_pence), toGbp(row.delivery_pence), toGbp(row.total_pence),
      toGbp(row.paid_pence), confirmedStatuses.includes(row.status) ? toGbp(Math.max(row.total_pence - row.paid_pence, 0)) : '0.00',
    ].map(escape).join(',')),
  ]
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="sipup-orders.csv"')
  res.send(lines.join('\r\n'))
}))

app.get('/api/admin/orders', requireAdmin, asyncRoute(async (req, res) => {
  const querySchema = z.object({
    status: z.union([statusSchema, z.literal('all')]).optional().default('all'),
    search: cleanText(100).optional().default(''),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  const parsed = querySchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid order filters.' })
  const { status, search, from, to, page, limit } = parsed.data
  if (from && to && from > to) return res.status(400).json({ error: 'The start date must be on or before the end date.' })
  const conditions = []
  const params = []
  if (status !== 'all') {
    conditions.push('o.status = ?')
    params.push(status)
  }
  if (search) {
    conditions.push('(o.reference LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)')
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
    params.push(pattern, pattern, pattern)
  }
  if (from) { conditions.push('o.created_at >= ?'); params.push(`${from} 00:00:00`) }
  if (to) { conditions.push('o.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${to} 00:00:00`) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const count = await pool.query(`
    SELECT COUNT(*) AS total FROM orders o JOIN customers c ON c.id=o.customer_id ${where}
  `, params)
  const orders = await orderRows(where, params, limit, (page - 1) * limit)
  res.json({ orders, total: Number(count.rows[0].total), page, pages: Math.ceil(Number(count.rows[0].total) / limit) })
}))

app.get('/api/admin/orders/:id', requireAdmin, asyncRoute(async (req, res) => {
  const id = idSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json({ error: 'Invalid order id.' })
  const [orders, history, payments] = await Promise.all([
    orderRows('WHERE o.id = ?', [id.data], 1, 0),
    pool.query('SELECT id, event_type, details, actor, created_at FROM order_events WHERE order_id = ? ORDER BY created_at DESC', [id.data]),
    pool.query(`
      SELECT CONCAT('p-', id) AS id, 'payment' AS type, ROUND(amount_gbp * 100) AS amount_pence, method, paid_at, reference, notes
      FROM payments WHERE order_id = ?
      UNION ALL
      SELECT CONCAT('r-', id) AS id, 'refund' AS type, ROUND(amount_gbp * 100) AS amount_pence, method, refunded_at AS paid_at, reference, notes
      FROM refunds WHERE order_id = ? ORDER BY paid_at DESC
    `, [id.data, id.data]),
  ])
  if (!orders.length) return res.status(404).json({ error: 'Order not found.' })
  res.json({ order: orders[0], refund_sources: await refundSources(pool, id.data), events: history.rows, payments: payments.rows.map((p) => ({ ...p, amount_pence: Number(p.amount_pence) })) })
}))

app.put('/api/admin/orders/:id/notes', requireAdmin, asyncRoute(async (req, res) => {
  const id = idSchema.safeParse(req.params.id)
  const parsed = z.object({ notes: cleanText(2000) }).safeParse(req.body)
  if (!id.success || !parsed.success) return res.status(400).json({ error: 'Invalid admin note.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query('SELECT id FROM orders WHERE id = ? FOR UPDATE', [id.data])
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Order not found.' })
    }
    await client.query('UPDATE orders SET admin_notes = ? WHERE id = ?', [parsed.data.notes, id.data])
    await client.query('INSERT INTO order_events (order_id, event_type, details, actor) VALUES (?, ?, ?, ?)', [id.data, 'admin_note_updated', { notes: parsed.data.notes }, req.admin.email])
    await createAudit(client, req.admin.id, 'order_note_updated', 'order', id.data, { notes: parsed.data.notes })
    await client.query('COMMIT')
    res.json({ success: true })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.patch('/api/admin/orders/:id/status', requireAdmin, asyncRoute(async (req, res) => {
  const id = idSchema.safeParse(req.params.id)
  const parsed = z.object({ status: statusSchema, notes: cleanText(1000).optional().default('') }).safeParse(req.body)
  if (!id.success || !parsed.success) return res.status(400).json({ error: 'Invalid order update.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query('SELECT id, status, stock_deducted FROM orders WHERE id = ? FOR UPDATE', [id.data])
    if (!current.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Order not found.' })
    }
    const previous = current.rows[0]
    const next = parsed.data.status
    if (previous.status === 'cancelled' && next !== 'cancelled') {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Cancelled orders cannot be reopened.' })
    }
    if (next !== previous.status && confirmedStatuses.includes(next) && !previous.stock_deducted) {
      const items = await client.query('SELECT product_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id', [id.data])
      for (const item of items.rows) {
        if (item.product_id === null) continue
        const updated = await client.query(
          'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?',
          [item.quantity, item.product_id, item.quantity],
        )
        if (!updated.rowCount) throw new Error('A product no longer has enough stock to confirm this order.')
        await client.query('INSERT INTO stock_movements (product_id, order_id, quantity_delta, reason, actor) VALUES (?, ?, ?, ?, ?)', [item.product_id, id.data, -item.quantity, 'order_confirmed', req.admin.email])
      }
      await client.query('UPDATE orders SET stock_deducted = TRUE WHERE id = ?', [id.data])
    }
    if (next === 'cancelled' && previous.stock_deducted) {
      const items = await client.query('SELECT product_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id', [id.data])
      for (const item of items.rows) {
        if (item.product_id !== null) {
          await client.query('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', [item.quantity, item.product_id])
          await client.query('INSERT INTO stock_movements (product_id, order_id, quantity_delta, reason, actor) VALUES (?, ?, ?, ?, ?)', [item.product_id, id.data, item.quantity, 'order_cancelled', req.admin.email])
        }
      }
      await client.query('UPDATE orders SET stock_deducted = FALSE WHERE id = ?', [id.data])
    }
    await client.query('UPDATE orders SET status = ? WHERE id = ?', [next, id.data])
    await client.query('INSERT INTO order_events (order_id, event_type, details, actor) VALUES (?, ?, ?, ?)', [id.data, 'status_changed', { from: previous.status, to: next, notes: parsed.data.notes }, req.admin.email])
    await createAudit(client, req.admin.id, 'order_status_changed', 'order', id.data, { from: previous.status, to: next })
    await client.query('COMMIT')
    res.json({ success: true, status: next })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.message.startsWith('A product')) return res.status(409).json({ error: error.message })
    throw error
  } finally {
    client.release()
  }
}))

app.post('/api/admin/orders/:id/payments', requireAdmin, asyncRoute(async (req, res) => {
  const id = idSchema.safeParse(req.params.id)
  const parsed = z.object({
    type: z.enum(['payment', 'refund']),
    amount_pence: z.coerce.number().int().min(1).max(1_000_000_000),
    method: z.enum(['cash', 'bank_transfer', 'card', 'other']),
    paid_at: z.string().datetime().optional(),
    reference: cleanText(120).optional().default(''),
    notes: cleanText(1000).optional().default(''),
    refund_lines: z.array(z.object({ source: z.string().regex(/^(item|delivery):\d+$/), quantity: z.number().int().min(1) })).max(51).optional(),
  }).safeParse(req.body)
  if (!id.success || !parsed.success) return res.status(400).json({ error: 'Check the payment details and try again.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const order = await client.query('SELECT id, status, total_gbp FROM orders WHERE id = ? FOR UPDATE', [id.data])
    if (!order.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Order not found.' })
    }
    const [received, refunded] = await Promise.all([
      client.query('SELECT COALESCE(SUM(amount_gbp),0) AS amount FROM payments WHERE order_id = ?', [id.data]),
      client.query('SELECT COALESCE(SUM(amount_gbp),0) AS amount FROM refunds WHERE order_id = ?', [id.data]),
    ])
    const receivedPence = toPence(received.rows[0].amount)
    const refundedPence = toPence(refunded.rows[0].amount)
    const { type, amount_pence: amount } = parsed.data
    if (type === 'payment' && (!confirmedStatuses.includes(order.rows[0].status))) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Record payments only after an order is confirmed.' })
    }
    if (type === 'payment' && amount > toPence(order.rows[0].total_gbp) - receivedPence + refundedPence) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Payment exceeds the outstanding balance.' })
    }
    if (type === 'refund' && amount > receivedPence - refundedPence) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Refund exceeds payments already recorded.' })
    }
    const paidAt = parsed.data.paid_at ? new Date(parsed.data.paid_at) : new Date()
    let paymentId = null
    if (type === 'payment') {
      const inserted = await client.query(`
        INSERT INTO payments (order_id, amount_gbp, method, paid_at, reference, notes) VALUES (?, ?, ?, ?, ?, ?)
      `, [id.data, toGbp(amount), parsed.data.method, paidAt, parsed.data.reference, parsed.data.notes])
      paymentId = inserted.insertId
    } else {
      const sources = await refundSources(client, id.data)
      let allocation = []
      if (sources.length) {
        try {
          allocation = allocateRefund(sources, parsed.data.refund_lines || [])
          if (!allocation.length || allocation.reduce((sum, row) => sum + row.grossPence, 0) !== amount) {
            throw new RangeError('Refund amount must match the selected original items and quantities.')
          }
        } catch (error) {
          await client.query('ROLLBACK')
          return res.status(400).json({ error: error.message })
        }
      }
      const refund = await client.query(`
        INSERT INTO refunds (order_id, payment_id, amount_gbp, method, refunded_at, reference, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [id.data, null, toGbp(amount), parsed.data.method, paidAt, parsed.data.reference, parsed.data.notes])
      for (const row of allocation) await client.query(`INSERT INTO refund_tax_lines
        (refund_id, order_item_id, delivery_breakdown_id, quantity, vat_treatment, vat_rate, net_gbp, vat_gbp, gross_gbp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [refund.insertId, row.order_item_id, row.delivery_breakdown_id,
        row.refundQuantity, row.vat_treatment, row.vat_rate, toGbp(row.netPence), toGbp(row.vatPence), toGbp(row.grossPence)])
    }
    const details = { amount_pence: amount, method: parsed.data.method, reference: parsed.data.reference }
    await client.query('INSERT INTO order_events (order_id, event_type, details, actor) VALUES (?, ?, ?, ?)', [id.data, `${type}_recorded`, details, req.admin.email])
    await createAudit(client, req.admin.id, `${type}_recorded`, 'order', id.data, details)
    await client.query('COMMIT')
    res.status(201).json({ success: true, payment_id: paymentId })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

const productImageUrl = z.union([
  z.string().regex(/^\/api\/product-media\/[a-f0-9]{64}$/),
  z.string().url().max(1000).refine(value=>/^https?:\/\//i.test(value),'Use an HTTP(S) image URL.'),
  z.string().regex(/^\/products\/(?:web\/)?[a-zA-Z0-9-]+\.webp$/),
])
export const productSchema = z.object({
  category_id: idSchema.nullable().optional(),
  name: cleanText(160).min(2),
  sku: cleanText(80).min(1),
  brand: cleanText(100).optional().default(''),
  category: cleanText(100).min(1),
  description: cleanText(3000).optional().default(''),
  image_url: z.union([productImageUrl, z.literal('')]).optional().default(''),
  image_urls: z.array(productImageUrl).max(10).optional().default([]),
  price_pence: z.coerce.number().int().min(0).max(1_000_000_000),
  sale_price_pence: z.union([z.coerce.number().int().min(0).max(1_000_000_000), z.null()]).optional().default(null),
  vat_treatment: z.enum(['standard', 'reduced', 'zero', 'exempt']).nullable().optional().default(null),
  vat_confirmed: z.boolean().default(false),
  price_entry_mode: z.enum(['exclusive', 'inclusive']).default('exclusive'),
  stock_quantity: z.coerce.number().int().min(0).max(1_000_000),
  min_quantity: z.coerce.number().int().min(1).max(100_000).default(1),
  pack_size: cleanText(100).optional().default(''),
  is_published: z.boolean().default(true),
  is_featured: z.boolean().default(false),
  is_new: z.boolean().default(false),
  bulk_prices: z.array(z.object({
    min_quantity: z.coerce.number().int().min(1).max(100_000),
    unit_price_pence: z.coerce.number().int().min(0).max(1_000_000_000),
  })).max(20).optional().default([]),
}).superRefine((product, context) => {
  const basePrice = product.sale_price_pence ?? product.price_pence
  if (product.sale_price_pence !== null && product.sale_price_pence > product.price_pence) {
    context.addIssue({ code: 'custom', message: 'Sale price must not exceed regular price.', path: ['sale_price_pence'] })
  }
  if (product.is_published && (!product.vat_treatment || !product.vat_confirmed)) {
    context.addIssue({
      code: 'custom',
      message: 'Confirm this product’s VAT treatment before publishing it.',
      path: ['vat_confirmed'],
    })
  }
  if (product.vat_confirmed && !product.vat_treatment) {
    context.addIssue({
      code: 'custom',
      message: 'Select a VAT treatment before confirming the classification.',
      path: ['vat_treatment'],
    })
  }
  if (product.price_entry_mode === 'inclusive' && !product.vat_treatment) {
    context.addIssue({
      code: 'custom',
      message: 'Select a VAT treatment before entering a VAT-inclusive price.',
      path: ['price_entry_mode'],
    })
  }
  if (product.price_entry_mode === 'inclusive' && product.vat_treatment) {
    const amounts = [product.price_pence, product.sale_price_pence,
      ...product.bulk_prices.map((tier) => tier.unit_price_pence)].filter((n) => n !== null)
    if (amounts.some((amount) => {
      const net = calculatePrice(amount, 'inclusive', product.vat_treatment).netPence
      return calculatePrice(net, 'exclusive', product.vat_treatment).grossPence !== amount
    })) context.addIssue({ code: 'custom', path: ['price_pence'],
      message: 'This inclusive price cannot be represented by a whole-penny net price. Enter an exclusive price or adjust the inclusive price by a penny.' })
  }
  const thresholds = new Set()
  for (const tier of product.bulk_prices) {
    if (thresholds.has(tier.min_quantity)) {
      context.addIssue({ code: 'custom', message: 'Bulk-price quantities must be unique.', path: ['bulk_prices'] })
    }
    if (tier.unit_price_pence > basePrice) {
      context.addIssue({ code: 'custom', message: 'Bulk prices must not exceed the current selling price.', path: ['bulk_prices'] })
    }
    thresholds.add(tier.min_quantity)
  }
})

app.get('/api/admin/categories', requireAdmin, asyncRoute(async (_req, res) => {
  res.json({ categories: await getCategories() })
}))

app.get('/api/admin/customers', requireAdmin, asyncRoute(async (_req, res) => {
  const customers = await pool.query(`SELECT c.id,c.name,c.phone,c.email,c.created_at,
    COUNT(o.id) AS order_count, COALESCE(SUM(ROUND(o.total_gbp*100)),0) AS order_value_pence
    FROM customers c LEFT JOIN orders o ON o.customer_id=c.id
    GROUP BY c.id ORDER BY c.created_at DESC, c.id DESC LIMIT 500`)
  res.json({ customers: customers.rows.map((row) => ({ ...row, order_count: Number(row.order_count), order_value_pence: Number(row.order_value_pence) })) })
}))

export function normalizeProductPrices(product) {
  if (!product.vat_treatment) return product
  const net = (amount) => amount === null ? null
    : calculatePrice(amount, product.price_entry_mode, product.vat_treatment).netPence
  return {
    ...product,
    price_pence: net(product.price_pence),
    sale_price_pence: net(product.sale_price_pence),
    bulk_prices: product.bulk_prices.map((tier) => ({
      ...tier,
      unit_price_pence: net(tier.unit_price_pence),
    })),
  }
}

app.post('/api/admin/products/price-preview', requireAdmin, asyncRoute(async (req, res) => {
  const parsed = z.object({
    amount_pence: z.coerce.number().int().min(0).max(1_000_000_000),
    price_mode: z.enum(['exclusive', 'inclusive']),
    vat_treatment: z.enum(['standard', 'reduced', 'zero', 'exempt']),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Provide a valid price, entry mode, and VAT treatment.' })
  res.json(calculatePrice(parsed.data.amount_pence, parsed.data.price_mode, parsed.data.vat_treatment))
}))

const categoryDetails = z.object({ name: cleanText(100).min(1), parent_id: idSchema.nullable().optional(), description: cleanText(500).optional().default(''), sort_order:z.coerce.number().int().min(0).max(10000).default(0) })
async function saveCategory(req,res,editing=false) {
  const parsed = categoryDetails.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid category details.' })
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    const categories=(await client.query('SELECT id,name,parent_id,slug FROM categories ORDER BY id FOR UPDATE')).rows
    const id=editing?Number(req.params.id):null
    if(editing&&!categories.some(c=>c.id===id)) { const e=new Error('Category not found.');e.status=404;throw e }
    const {name,description,sort_order}=parsed.data, parent=parsed.data.parent_id||null
    if(categories.some(c=>c.id!==id && (c.parent_id||null)===parent && c.name.trim().toLowerCase()===name.trim().toLowerCase())) {
      const e=new Error('This parent already has a category with that name.');e.status=409;throw e
    }
    let ancestor=parent
    const seen=new Set()
    while(ancestor) {
      if(ancestor===id||seen.has(ancestor)) { const e=new Error('Category hierarchy cannot contain a cycle.');e.status=400;throw e }
      seen.add(ancestor)
      const row=categories.find(c=>c.id===ancestor)
      if(!row) { const e=new Error('Parent category does not exist.');e.status=400;throw e }
      ancestor=row.parent_id
    }
    if(editing) await client.query('UPDATE categories SET name=?,parent_id=?,description=?,sort_order=? WHERE id=?',[name,parent,description,sort_order,id])
    else {
      const base=name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'category'
      const prefix=parent?`${parent}-${base}`:base
      let slug=prefix, suffix=2
      while(categories.some(c=>c.slug===slug)) slug=`${prefix}-${suffix++}`
      await client.query('INSERT INTO categories (parent_id,name,slug,description,sort_order) VALUES (?,?,?,?,?)',[parent,name,slug,description,sort_order])
    }
    await client.query('INSERT INTO audit_logs (action,entity_type,entity_id,details) VALUES (?,?,?,?)',['category_saved','category',id,parsed.data])
    await client.query('COMMIT')
    res.status(editing?200:201).json({ categories: await getCategories() })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A category with this name already exists.' })
    throw error
  } finally { client.release() }
}
app.post('/api/admin/categories', requireAdmin, asyncRoute((req,res)=>saveCategory(req,res)))
app.put('/api/admin/categories/:id', requireAdmin, asyncRoute((req,res)=>saveCategory(req,res,true)))

app.get('/api/admin/products', requireAdmin, asyncRoute(async (_req, res) => {
  const result = await pool.query(`${productSelect} ORDER BY p.created_at DESC`)
  res.json({ products: result.rows.map(serializeProduct), categories: await getCategories() })
}))

app.get('/api/admin/import-history',requireAdmin,asyncRoute(async (_req,res)=>{
  const events=await pool.query("SELECT id,action,details,created_at FROM audit_logs WHERE action IN ('catalogue_import_completed','catalogue_legacy_archived','catalogue_publication_completed') ORDER BY id DESC LIMIT 100")
  res.json({imports:events.rows.map(r=>({...r,details:parseJson(r.details,{})}))})
}))

async function productCategory(product) {
  if(product.category_id) {
    const category=await pool.query('SELECT id FROM categories WHERE id=? AND is_active=TRUE',[product.category_id])
    if(!category.rowCount) { const error=new Error('Select an active category.'); error.status=400; throw error }
    return product.category_id
  }
  return ensureCategory(product.category)
}

async function saveProductImages(connection, productId, imageUrls, name) {
  await connection.query('DELETE FROM product_images WHERE product_id = ?', [productId])
  for (const [index, imageUrl] of [...new Set(imageUrls.filter(Boolean))].entries()) {
    await connection.query(
      'INSERT INTO product_images (product_id, image_url, alt_text, sort_order) VALUES (?, ?, ?, ?)',
      [productId, await persistImageUrl(connection, imageUrl), name, index],
    )
  }
}

async function saveBulkPricing(connection, productId, tiers) {
  await connection.query('DELETE FROM bulk_pricing WHERE product_id = ?', [productId])
  for (const tier of tiers) {
    await connection.query(
      'INSERT INTO bulk_pricing (product_id, min_quantity, unit_price_gbp) VALUES (?, ?, ?)',
      [productId, tier.min_quantity, toGbp(tier.unit_price_pence)],
    )
  }
}

app.post('/api/admin/products', requireAdmin, asyncRoute(async (req, res) => {
  const parsed = productSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid product details.' })
  const p = normalizeProductPrices(parsed.data)
  p.vat_rate = p.vat_treatment ? VAT_RATES[p.vat_treatment] : null
  const categoryId = await productCategory(p)
  const slug = `${p.name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120)}-${randomUUID().slice(0, 6)}`
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(`
      INSERT INTO products
        (category_id, name, slug, sku, brand, description, price_gbp, sale_price_gbp,
         vat_treatment, vat_rate, vat_confirmed, price_entry_mode, stock_quantity,
         min_quantity, pack_size, is_published, is_featured, is_new)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [categoryId, p.name, slug, p.sku, p.brand, p.description, toGbp(p.price_pence),
      p.sale_price_pence === null ? null : toGbp(p.sale_price_pence), p.vat_treatment,
      p.vat_rate, p.vat_confirmed, p.price_entry_mode, p.stock_quantity, p.min_quantity,
      p.pack_size, p.is_published, p.is_featured, p.is_new])
    await saveProductImages(client, result.insertId, [p.image_url, ...p.image_urls], p.name)
    await saveBulkPricing(client, result.insertId, p.bulk_prices)
    if (p.stock_quantity > 0) {
      await client.query('INSERT INTO stock_movements (product_id, quantity_delta, reason, actor) VALUES (?, ?, ?, ?)', [result.insertId, p.stock_quantity, 'initial_stock', req.admin.email])
    }
    await createAudit(client, req.admin.id, 'product_created', 'product', result.insertId, {
      sku: p.sku, vat_treatment: p.vat_treatment, vat_rate: p.vat_rate,
      vat_confirmed: p.vat_confirmed, price_entry_mode: p.price_entry_mode,
    })
    await client.query('COMMIT')
    const saved = await pool.query(`${productSelect} WHERE p.id = ? LIMIT 1`, [result.insertId])
    res.status(201).json({ product: serializeProduct(saved.rows[0]) })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A product with this SKU already exists.' })
    throw error
  } finally {
    client.release()
  }
}))

app.put('/api/admin/products/:id', requireAdmin, asyncRoute(async (req, res) => {
  const id = idSchema.safeParse(req.params.id)
  const parsed = productSchema.safeParse(req.body)
  if (!id.success || !parsed.success) return res.status(400).json({ error: parsed.success ? 'Invalid product id.' : parsed.error.issues[0]?.message })
  const p = normalizeProductPrices(parsed.data)
  p.vat_rate = p.vat_treatment ? VAT_RATES[p.vat_treatment] : null
  const categoryId = await productCategory(p)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query(`SELECT stock_quantity, vat_treatment, vat_rate, vat_confirmed,
      price_gbp, sale_price_gbp, price_entry_mode FROM products WHERE id = ? FOR UPDATE`, [id.data])
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Product not found.' })
    }
    const updated = await client.query(`
      UPDATE products SET category_id=?, name=?, sku=?, brand=?, description=?, price_gbp=?,
        sale_price_gbp=?, vat_treatment=?, vat_rate=?, vat_confirmed=?, price_entry_mode=?,
        stock_quantity=?, min_quantity=?, pack_size=?, is_published=?, is_featured=?, is_new=?
      WHERE id=?
    `, [categoryId, p.name, p.sku, p.brand, p.description, toGbp(p.price_pence),
      p.sale_price_pence === null ? null : toGbp(p.sale_price_pence), p.vat_treatment,
      p.vat_rate, p.vat_confirmed, p.price_entry_mode, p.stock_quantity, p.min_quantity,
      p.pack_size, p.is_published, p.is_featured, p.is_new, id.data])
    if (p.stock_quantity !== Number(existing.rows[0].stock_quantity)) {
      await client.query('INSERT INTO stock_movements (product_id, quantity_delta, reason, actor) VALUES (?, ?, ?, ?)', [id.data, p.stock_quantity - Number(existing.rows[0].stock_quantity), 'admin_stock_adjustment', req.admin.email])
    }
    await saveProductImages(client, id.data, [p.image_url, ...p.image_urls], p.name)
    await saveBulkPricing(client, id.data, p.bulk_prices)
    await createAudit(client, req.admin.id, 'product_updated', 'product', id.data, {
      sku: p.sku,
      previous_vat_treatment: existing.rows[0].vat_treatment,
      previous_vat_rate: existing.rows[0].vat_rate,
      previous_vat_confirmed: Boolean(existing.rows[0].vat_confirmed),
      vat_treatment: p.vat_treatment, vat_rate: p.vat_rate,
      vat_confirmed: p.vat_confirmed, price_entry_mode: p.price_entry_mode,
      previous_net_price_gbp: existing.rows[0].price_gbp,
      net_price_gbp: toGbp(p.price_pence),
      previous_price_entry_mode: existing.rows[0].price_entry_mode,
    })
    await client.query('COMMIT')
    const saved = await pool.query(`${productSelect} WHERE p.id = ? LIMIT 1`, [id.data])
    res.json({ product: serializeProduct(saved.rows[0]) })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A product with this SKU already exists.' })
    throw error
  } finally {
    client.release()
  }
}))

app.delete('/api/admin/products/:id', requireAdmin, asyncRoute(async (req, res) => {
  const id = idSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json({ error: 'Invalid product id.' })
  const existing = await pool.query('SELECT id FROM products WHERE id = ?', [id.data])
  if (!existing.rowCount) return res.status(404).json({ error: 'Product not found.' })
  const result = await pool.query('UPDATE products SET is_published = FALSE WHERE id = ?', [id.data])
  await createAudit(pool, req.admin.id, 'product_unpublished', 'product', id.data)
  res.status(204).end()
}))

app.get('/api/admin/settings', requireAdmin, asyncRoute(async (_req, res) => {
  const settings = await settingGroup()
  res.json(settings)
}))

app.put('/api/admin/settings/:key', requireAdmin, asyncRoute(async (req, res) => {
  if (!['store', 'homepage'].includes(req.params.key)) return res.status(404).json({ error: 'Settings group not found.' })
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Settings must be an object.' })
  let value
  if (req.params.key === 'store') {
    const parsed = z.object({
      name: cleanText(100).min(1),
      tagline: cleanText(200).optional().default(''),
      whatsapp_number: cleanText(30).optional().default(''),
      email: z.union([emailSchema, z.literal('')]).optional().default(''),
      phone: cleanText(30).optional().default(''),
      address: cleanText(300).optional().default(''),
      currency: z.literal('GBP').default('GBP'),
      delivery_vat_treatment: z.enum(['standard', 'reduced', 'zero', 'exempt']).nullable().default(null),
      delivery_charge_pence: z.coerce.number().int().min(0).max(100_000_000).default(0),
      free_delivery_threshold_pence: z.coerce.number().int().min(0).max(100_000_000).default(0),
      minimum_order_pence: z.coerce.number().int().min(0).max(100_000_000).default(0),
      business_hours: cleanText(500).optional().default(''),
      announcement: cleanText(200).optional().default(''),
    }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid store settings.' })
    value = parsed.data
  } else {
    const parsed = z.object({
      hero_title: cleanText(150).optional().default(''),
      hero_copy: cleanText(500).optional().default(''),
      hero_image: z.union([z.string().url().max(1000), z.literal('')]).optional().default(''),
      promo_message: cleanText(200).optional().default(''),
      featured_heading: cleanText(120).optional().default(''),
    }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid homepage settings.' })
    value = parsed.data
  }
  await pool.query(
    'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [req.params.key, value],
  )
  await createAudit(pool, req.admin.id, 'settings_updated', 'settings', null, { key: req.params.key })
  res.json({ settings: value })
}))

app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }))

if (production) {
  const dist = resolve(process.cwd(), 'dist')
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }))
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')))
  }
}

app.use((error, _req, res, _next) => {
  console.error('Request failed:', error.code || error.name || 'UnknownError')
  if (res.headersSent) return
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Uploaded data exceeds the allowed size.' })
  if(error.status===400) return res.status(400).json({error:error.message})
  res.status(500).json({ error: 'Something went wrong. Please try again.' })
})

async function bootstrap() {
  await pool.query('SELECT 1')
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    if (process.env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.')
    const email = process.env.ADMIN_EMAIL.toLowerCase()
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12)
    await pool.query('INSERT INTO admins (email, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email)', [email, hash])
  } else {
    console.warn('Admin bootstrap is disabled: set ADMIN_EMAIL and ADMIN_PASSWORD before initial deployment.')
  }
  app.listen(port, () => console.log(`SipUp server listening on port ${port}`))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) bootstrap().catch(async (error) => {
  console.error('SipUp startup failed:', error.message)
  await pool.end()
  process.exitCode = 1
})
