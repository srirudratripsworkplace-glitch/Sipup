import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'

const cookieName = 'sipup_staff_session'
const digest = value => createHash('sha256').update(value).digest('hex')
const route = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
const idSchema = z.coerce.number().int().positive()
const permissionSchema = z.object({
  sales_view: z.boolean().default(true),
  inventory_view: z.boolean().default(false),
  inventory_manage: z.boolean().default(false),
}).strict().refine(p => !p.inventory_manage || p.inventory_view, 'Inventory editing requires inventory viewing.')
const staffSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(12).max(200).optional(),
  is_active: z.boolean().default(true),
  permissions: permissionSchema,
}).strict()
const publicStaff = row => ({
  id: Number(row.id), name: row.name, email: row.email, is_active: Boolean(row.is_active),
  permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions,
})
const sold = "o.status IN ('confirmed','processing','dispatched','delivered')"

export async function selectedStaff(connection, id) {
  if (id === null || id === undefined) return null
  const result = await connection.query('SELECT id, name FROM staff WHERE id = ? AND is_active = TRUE FOR SHARE', [id])
  if (!result.rowCount) { const error = new Error('The selected staff member is unavailable. Select another member or None of the above.'); error.status = 400; throw error }
  return { id: Number(result.rows[0].id), name: result.rows[0].name }
}

async function salesReport(pool, staffId, page) {
  const condition = staffId === null ? 'o.staff_id IS NULL' : 'o.staff_id = ?'
  const params = staffId === null ? [] : [staffId]
  const totals = await pool.query(`SELECT COUNT(*) AS assigned_orders,
    COALESCE(SUM(o.status = 'booking'),0) AS pending_orders,
    COALESCE(SUM(${sold}),0) AS confirmed_orders,
    COALESCE(SUM(o.status = 'cancelled'),0) AS cancelled_orders,
    COALESCE(SUM(CASE WHEN ${sold} THEN o.subtotal_gbp ELSE 0 END),0) * 100 AS sales_pence,
    COALESCE(SUM(CASE WHEN ${sold} THEN (SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id=o.id) ELSE 0 END),0) AS quantity_sold
    FROM orders o WHERE ${condition}`, params)
  const products = await pool.query(`SELECT oi.sku, oi.product_name, SUM(oi.quantity) AS quantity,
    ROUND(SUM(oi.line_total_gbp)*100) AS sales_pence
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE ${condition} AND ${sold} GROUP BY oi.sku, oi.product_name ORDER BY quantity DESC, oi.product_name`, params)
  const orders = await pool.query(`SELECT o.id, o.reference, o.status, o.staff_name, o.created_at,
    c.name AS customer_name, ROUND(o.subtotal_gbp*100) AS subtotal_pence
    FROM orders o JOIN customers c ON c.id=o.customer_id WHERE ${condition}
    ORDER BY o.created_at DESC, o.id DESC LIMIT 25 OFFSET ?`, [...params, (page - 1) * 25])
  if (orders.rowCount) {
    const items = await pool.query(`SELECT order_id, product_name, sku, quantity, ROUND(line_total_gbp*100) AS line_total_pence
      FROM order_items WHERE order_id IN (${orders.rows.map(() => '?').join(',')}) ORDER BY id`, orders.rows.map(o => o.id))
    for (const order of orders.rows) {
      order.subtotal_pence = Number(order.subtotal_pence)
      order.items = items.rows.filter(i => Number(i.order_id) === Number(order.id)).map(i => ({ ...i, quantity: Number(i.quantity), line_total_pence: Number(i.line_total_pence) }))
    }
  }
  const summary = Object.fromEntries(Object.entries(totals.rows[0]).map(([key, value]) => [key, Number(value)]))
  return { summary, products: products.rows.map(p => ({ ...p, quantity: Number(p.quantity), sales_pence: Number(p.sales_pence) })), orders: orders.rows,
    page, pages: Math.max(1, Math.ceil(summary.assigned_orders / 25)) }
}

export function registerStaffRoutes(app, { pool, requireAdmin, requireCustomer, jwtSecret }) {
  const secure = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production'
  const cookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/' }
  const requireStaff = route(async (req, res, next) => {
    const token = req.cookies[cookieName]
    if (!token) return res.status(401).json({ error: 'Please sign in with your staff account.' })
    let payload
    try { payload = jwt.verify(token, jwtSecret, { issuer: 'sipup', audience: 'staff' }) }
    catch { return res.status(401).json({ error: 'Your staff session has expired. Please sign in again.' }) }
    const result = await pool.query(`SELECT st.id, st.name, st.email, st.is_active, st.permissions
      FROM staff_sessions s JOIN staff st ON st.id=s.staff_id
      WHERE s.token_hash=? AND s.staff_id=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP() AND st.is_active=TRUE`, [digest(token), payload.sub])
    if (!result.rowCount) return res.status(401).json({ error: 'Your staff session is no longer active.' })
    req.staff = publicStaff(result.rows[0])
    next()
  })
  const allowed = permission => (req, res, next) => {
    if (!req.staff.permissions[permission]) return res.status(403).json({ error: 'Your administrator has not granted access to this feature.' })
    next()
  }
  app.use('/api/staff/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }))
  app.post('/api/staff/login', route(async (req, res) => {
    const parsed = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' })
    const result = await pool.query('SELECT id,name,email,password_hash,is_active,permissions FROM staff WHERE email=? AND is_active=TRUE', [parsed.data.email.toLowerCase()])
    if (!result.rowCount || !await bcrypt.compare(parsed.data.password, result.rows[0].password_hash)) return res.status(401).json({ error: 'Email or password is incorrect.' })
    const token = jwt.sign({ sub: String(result.rows[0].id), jti: randomUUID() }, jwtSecret, { expiresIn: '8h', issuer: 'sipup', audience: 'staff' })
    await pool.query('INSERT INTO staff_sessions (staff_id, token_hash, expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR))', [result.rows[0].id, digest(token)])
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 })
    res.json({ staff: publicStaff(result.rows[0]) })
  }))
  app.post('/api/staff/logout', route(async (req, res) => {
    if (req.cookies[cookieName]) await pool.query('UPDATE staff_sessions SET revoked_at=UTC_TIMESTAMP() WHERE token_hash=?', [digest(req.cookies[cookieName])])
    res.clearCookie(cookieName, cookieOptions).json({ success: true })
  }))
  app.get('/api/staff/me', requireStaff, (req, res) => res.json({ staff: req.staff }))
  app.get('/api/checkout/staff', requireCustomer, route(async (_req, res) => {
    const result = await pool.query('SELECT id,name FROM staff WHERE is_active=TRUE ORDER BY name,id')
    res.json({ staff: result.rows.map(row => ({ id: Number(row.id), name: row.name })) })
  }))
  app.get('/api/admin/staff', requireAdmin, route(async (_req, res) => {
    const result = await pool.query(`SELECT s.id,s.name,s.email,s.permissions,s.is_active,
      (SELECT COUNT(*) FROM orders o WHERE o.staff_id=s.id AND ${sold}) AS confirmed_orders,
      (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.staff_id=s.id AND ${sold}) AS quantity_sold,
      (SELECT COALESCE(SUM(o.subtotal_gbp),0)*100 FROM orders o WHERE o.staff_id=s.id AND ${sold}) AS sales_pence
      FROM staff s ORDER BY s.name,s.id`)
    res.json({ staff: result.rows.map(row => ({ ...publicStaff(row), confirmed_orders: Number(row.confirmed_orders), quantity_sold: Number(row.quantity_sold), sales_pence: Number(row.sales_pence) })) })
  }))
  const saveStaff = update => route(async (req, res) => {
    const parsed = staffSchema.safeParse(req.body)
    const id = update ? idSchema.safeParse(req.params.id) : null
    if (!parsed.success || (update && !id.success) || (!update && !parsed.data.password)) return res.status(400).json({ error: 'Enter a name, valid email, permissions and a password of at least 12 characters for a new account.' })
    const data = parsed.data
    const hash = data.password ? await bcrypt.hash(data.password, 12) : null
    const connection = await pool.connect()
    try {
      await connection.query('BEGIN')
      let staffId
      if (update) {
        const current = await connection.query('SELECT id FROM staff WHERE id=? FOR UPDATE', [id.data])
        if (!current.rowCount) { await connection.query('ROLLBACK'); return res.status(404).json({ error: 'Staff member not found.' }) }
        staffId = id.data
        await connection.query('UPDATE staff SET name=?,email=?,is_active=?,permissions=? WHERE id=?', [data.name,data.email,data.is_active,data.permissions,staffId])
        if (hash) await connection.query('UPDATE staff SET password_hash=? WHERE id=?', [hash,staffId])
        if (hash || !data.is_active) await connection.query('UPDATE staff_sessions SET revoked_at=UTC_TIMESTAMP() WHERE staff_id=? AND revoked_at IS NULL', [staffId])
      } else {
        const result = await connection.query('INSERT INTO staff (name,email,password_hash,is_active,permissions) VALUES (?,?,?,?,?)', [data.name,data.email,hash,data.is_active,data.permissions])
        staffId = result.insertId
      }
      await connection.query('INSERT INTO audit_logs (admin_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)', [req.admin.id,update?'staff_updated':'staff_created','staff',staffId,{ name:data.name,email:data.email,is_active:data.is_active,permissions:data.permissions,password_reset:Boolean(hash && update) }])
      await connection.query('COMMIT')
      res.status(update ? 200 : 201).json({ id: Number(staffId), success: true })
    } catch (error) {
      await connection.query('ROLLBACK')
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A staff account already uses this email.' })
      throw error
    } finally { connection.release() }
  })
  app.post('/api/admin/staff', requireAdmin, saveStaff(false))
  app.put('/api/admin/staff/:id', requireAdmin, saveStaff(true))
  app.get('/api/admin/staff/:id/sales', requireAdmin, route(async (req, res) => {
    const id = req.params.id === 'unassigned' ? { success: true, data: null } : idSchema.safeParse(req.params.id)
    const page = z.coerce.number().int().min(1).max(100000).default(1).safeParse(req.query.page)
    if (!id.success || !page.success) return res.status(400).json({ error: 'Invalid sales filters.' })
    if (id.data !== null && !(await pool.query('SELECT id FROM staff WHERE id=?',[id.data])).rowCount) return res.status(404).json({ error: 'Staff member not found.' })
    res.json(await salesReport(pool, id.data, page.data))
  }))
  app.get('/api/staff/sales', requireStaff, allowed('sales_view'), route(async (req, res) => {
    const page = z.coerce.number().int().min(1).max(100000).default(1).safeParse(req.query.page)
    if (!page.success) return res.status(400).json({ error: 'Invalid page.' })
    res.json(await salesReport(pool, req.staff.id, page.data))
  }))
  app.get('/api/staff/inventory', requireStaff, allowed('inventory_view'), route(async (_req, res) => {
    const result = await pool.query(`SELECT id,name,sku,stock_quantity,pack_size,
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(catalogue_details,'$.selling_unit')),'item') AS selling_unit
      FROM products ORDER BY name,id`)
    res.json({ products: result.rows.map(p => ({ ...p,id:Number(p.id),stock_quantity:Number(p.stock_quantity) })) })
  }))
  app.patch('/api/staff/inventory/:id', requireStaff, allowed('inventory_manage'), route(async (req, res) => {
    const id = idSchema.safeParse(req.params.id)
    const parsed = z.object({ quantity: z.number().int().min(0).max(1000000), expected_quantity: z.number().int().min(0), reason: z.string().trim().min(3).max(120) }).strict().safeParse(req.body)
    if (!id.success || !parsed.success) return res.status(400).json({ error: 'Enter a valid quantity and a reason for this stock adjustment.' })
    const connection = await pool.connect()
    try {
      await connection.query('BEGIN')
      const product = await connection.query('SELECT stock_quantity FROM products WHERE id=? FOR UPDATE', [id.data])
      if (!product.rowCount) { await connection.query('ROLLBACK'); return res.status(404).json({ error: 'Product not found.' }) }
      const old = Number(product.rows[0].stock_quantity)
      if (old !== parsed.data.expected_quantity) { await connection.query('ROLLBACK'); return res.status(409).json({ error: 'Stock has changed. Refresh inventory before updating it.' }) }
      const delta = parsed.data.quantity - old
      if (delta) {
        await connection.query('UPDATE products SET stock_quantity=? WHERE id=?', [parsed.data.quantity,id.data])
        await connection.query('INSERT INTO stock_movements (product_id,quantity_delta,reason,actor) VALUES (?,?,?,?)', [id.data,delta,parsed.data.reason,`staff:${req.staff.id}:${req.staff.name}`])
      }
      await connection.query('COMMIT')
      res.json({ success: true, stock_quantity: parsed.data.quantity })
    } catch (error) { await connection.query('ROLLBACK'); throw error }
    finally { connection.release() }
  }))
}
