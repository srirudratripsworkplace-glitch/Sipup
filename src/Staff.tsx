import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError, formatMoney } from './api'
import { ThemeToggle } from './Theme'
import './staff.css'

type Permissions = { sales_view: boolean; inventory_view: boolean; inventory_manage: boolean }
type Staff = { id: number; name: string; email: string; is_active: boolean; permissions: Permissions; confirmed_orders?: number; quantity_sold?: number; sales_pence?: number }
type StaffOrder = { id: number; reference: string; customer_name: string; staff_name: string; status: string; created_at: string; subtotal_pence: number; items: Array<{ sku: string; product_name: string; quantity: number; line_total_pence: number }> }
type Sales = {
  summary: { assigned_orders: number; pending_orders: number; confirmed_orders: number; cancelled_orders: number; quantity_sold: number; sales_pence: number }
  products: Array<{ sku: string; product_name: string; quantity: number; sales_pence: number }>
  orders: StaffOrder[]; page: number; pages: number
}
const permissions: Array<{ key: keyof Permissions; label: string; description: string }> = [
  { key: 'sales_view', label: 'View own sales', description: 'Assigned orders, products sold and personal totals.' },
  { key: 'inventory_view', label: 'View inventory', description: 'Read product names, SKUs and stock quantities.' },
  { key: 'inventory_manage', label: 'Adjust inventory', description: 'Change stock quantities with a recorded reason. Requires view inventory.' },
]
const newStaff = (): Staff => ({ id: 0, name: '', email: '', is_active: true, permissions: { sales_view: true, inventory_view: false, inventory_manage: false } })

function SalesReport({ endpoint, title }: { endpoint: string; title: string }) {
  const [data, setData] = useState<Sales | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError(''); setData(null)
    api<Sales>(`${endpoint}?page=${page}`, { signal: controller.signal }).then(setData).catch((e: Error) => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [endpoint, page, revision])
  return <section className="staff-report"><div className="staff-section-heading"><h2>{title}</h2><button className="button button-outline" onClick={() => setRevision(r => r + 1)}>Refresh</button></div>
    <p>Sales totals include confirmed, processing, dispatched and delivered orders. Pending bookings and cancellations are shown separately. Amounts exclude VAT and delivery, before refunds. Quantities follow the product selling unit, such as cases.</p>
    {error && <p className="inline-error" role="alert">{error}</p>}{!data && !error && <p role="status">Loading sales…</p>}
    {data && <><div className="staff-stats">
      <div><span>Confirmed orders</span><strong>{data.summary.confirmed_orders}</strong></div><div><span>Quantity sold</span><strong>{data.summary.quantity_sold}</strong></div><div><span>Product sales (ex. VAT)</span><strong>{formatMoney(data.summary.sales_pence)}</strong></div><div><span>Pending bookings</span><strong>{data.summary.pending_orders}</strong></div><div><span>Cancelled orders</span><strong>{data.summary.cancelled_orders}</strong></div>
    </div><section className="admin-panel"><h3>Products sold</h3><div className="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Quantity sold</th><th>Sales (ex. VAT)</th></tr></thead><tbody>{data.products.map((p, i) => <tr key={`${p.sku}-${i}`}><td>{p.product_name}</td><td>{p.sku}</td><td>{p.quantity}</td><td>{formatMoney(p.sales_pence)}</td></tr>)}</tbody></table>{!data.products.length && <p>No confirmed product sales yet.</p>}</div></section>
    <section className="admin-panel"><h3>Assigned orders</h3>{!data.orders.length && <p>No assigned orders yet.</p>}
      {data.orders.map(order => <article className="staff-order" key={order.id}><div className="staff-section-heading"><strong>{order.reference}</strong><span className="staff-status">{order.status}</span></div><p>{order.customer_name} · {new Date(order.created_at).toLocaleDateString('en-GB')} · Staff: {order.staff_name || 'None of the above'}</p><ul>{order.items.map((item, i) => <li key={`${item.sku}-${i}`}>{item.product_name} ({item.sku}) × {item.quantity} <strong>{formatMoney(item.line_total_pence)}</strong></li>)}</ul><p>Product subtotal: <strong>{formatMoney(order.subtotal_pence)}</strong></p></article>)}
      <div className="staff-pagination"><button className="button button-outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {data.page} of {data.pages}</span><button className="button button-outline" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>Next</button></div>
    </section></>}
  </section>
}

export function StaffAdmin() {
  const [staff, setStaff] = useState<Staff[]>([])
  const [editing, setEditing] = useState<Staff | null>(null)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const load = async () => {
    const result = await api<{ staff: Staff[] }>('/admin/staff')
    setStaff(result.staff)
  }
  useEffect(() => { load().catch((e: Error) => setError(e.message)).finally(() => setLoading(false)) }, [])
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editing) return
    const form = new FormData(event.currentTarget)
    const access = Object.fromEntries(permissions.map(p => [p.key, form.get(p.key) === 'on'])) as Permissions
    if (access.inventory_manage && !access.inventory_view) { setError('Enable View inventory before granting Adjust inventory.'); return }
    const password = String(form.get('password') || '')
    setBusy(true); setError(''); setMessage('')
    try {
      await api(`/admin/staff${editing.id ? `/${editing.id}` : ''}`, { method: editing.id ? 'PUT' : 'POST', body: JSON.stringify({ name: form.get('name'), email: form.get('email'), is_active: form.get('is_active') === 'on', permissions: access, ...(password ? { password } : {}) }) })
      setEditing(null); await load(); setMessage('Staff account saved.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save staff account.') }
    finally { setBusy(false) }
  }
  return <div className="staff-admin"><div className="admin-page-heading"><div><span className="eyebrow">TEAM & SALES</span><h1>Staff</h1><p>Manage staff accounts, access and sales attribution.</p></div><button className="button button-dark" onClick={() => { setEditing(newStaff()); setError(''); setMessage('') }}>Add staff member</button></div>
    {error && <p className="inline-error" role="alert">{error} <button onClick={() => load().then(() => setError('')).catch((e: Error) => setError(e.message))}>Retry</button></p>}{message && <p role="status">{message}</p>}
    {editing && <section className="admin-panel staff-account-form"><h2>{editing.id ? `Edit ${editing.name}` : 'New staff account'}</h2><form key={editing.id} onSubmit={save}>
      <div className="form-row"><label>Full name<input name="name" required minLength={2} maxLength={120} defaultValue={editing.name} /></label><label>Login email<input name="email" type="email" required maxLength={254} defaultValue={editing.email} autoComplete="off" /></label></div>
      <label>{editing.id ? 'Reset password (leave blank to keep current password)' : 'Password'}<input name="password" type="password" required={!editing.id} minLength={12} maxLength={200} autoComplete="new-password" /></label><p>Share the login details with this staff member. Resetting a password or deactivating an account ends its active sessions.</p>
      <fieldset className="staff-permissions"><legend>Staff access</legend>{permissions.map(p => <label key={p.key}><input name={p.key} type="checkbox" defaultChecked={editing.permissions[p.key]} /><span><strong>{p.label}</strong><small>{p.description}</small></span></label>)}<label><input name="is_active" type="checkbox" defaultChecked={editing.is_active} /><span><strong>Active account</strong><small>Can sign in and can be selected at checkout. Deactivation keeps historical sales.</small></span></label></fieldset>
      <div className="staff-actions"><button className="button button-dark" disabled={busy}>{busy ? 'Saving…' : 'Save staff account'}</button><button className="button button-outline" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button></div>
    </form></section>}
    <section className="admin-panel"><h2>Your team</h2>{loading ? <p role="status">Loading staff…</p> : <div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Access</th><th>Status</th><th>Confirmed orders</th><th>Quantity sold</th><th>Sales (ex. VAT)</th><th>Actions</th></tr></thead><tbody>{staff.map(member => <tr key={member.id}><td><strong>{member.name}</strong><br />{member.email}</td><td>{permissions.filter(p => member.permissions[p.key]).map(p => p.label).join(', ') || 'No feature access'}</td><td>{member.is_active ? 'Active' : 'Inactive'}</td><td>{member.confirmed_orders}</td><td>{member.quantity_sold}</td><td>{formatMoney(member.sales_pence || 0)}</td><td><div className="staff-actions"><button className="button button-outline" onClick={() => { setEditing(member); setError(''); setMessage('') }}>Edit</button><button className="button button-outline" onClick={() => setSelected(String(member.id))}>View sales</button></div></td></tr>)}</tbody></table>{!staff.length && <p>No staff members yet. Add a staff account to get started.</p>}</div>}</section>
    <section className="admin-panel"><label>Sales report<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Select a staff member</option><option value="unassigned">None of the above — unassigned orders</option>{staff.map(member => <option key={member.id} value={member.id}>{member.name}{member.is_active ? '' : ' (inactive)'}</option>)}</select></label></section>
    {selected && <SalesReport key={selected} endpoint={`/admin/staff/${selected}/sales`} title={selected === 'unassigned' ? 'Unassigned sales' : `${staff.find(s => String(s.id) === selected)?.name || 'Staff'} — sales`} />}
  </div>
}

type InventoryProduct = { id: number; name: string; sku: string; stock_quantity: number; pack_size: string; selling_unit: string }
export function CheckoutStaffSelect() {
  const [members, setMembers] = useState<Array<{ id: number; name: string }>>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState('')
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('')
    api<{ staff: typeof members }>('/checkout/staff', { signal: controller.signal }).then(result => {
      setMembers(result.staff)
      setSelected(current => result.staff.some(s => String(s.id) === current) ? current : '')
    }).catch((e: Error) => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision])
  return <section className="form-card"><div className="form-section-heading"><span>03</span><div><h2>Who helped you with this order?</h2><p>Choose your salesperson, or leave this order unassigned.</p></div></div><label>Sales staff <span className="optional">(optional)</span><select name="staff_id" value={selected} onChange={e => setSelected(e.target.value)}><option value="">None of the above</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>{loading && <p role="status">Loading staff members…</p>}{error && <p className="inline-error" role="alert">{error} You can continue with None of the above.</p>}<button className="text-link" type="button" disabled={loading} onClick={() => setRevision(r => r + 1)}>Refresh staff list</button></section>
}

function StaffInventory({ canManage }: { canManage: boolean }) {
  const [products, setProducts] = useState<InventoryProduct[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const load = async () => { const result = await api<{ products: InventoryProduct[] }>('/staff/inventory'); setProducts(result.products) }
  useEffect(() => { load().catch((e: Error) => setError(e.message)).finally(() => setLoading(false)) }, [])
  const save = async (event: FormEvent<HTMLFormElement>, product: InventoryProduct) => {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    setBusy(product.id); setError(''); setMessage('')
    try {
      await api(`/staff/inventory/${product.id}`, { method: 'PATCH', body: JSON.stringify({ quantity: Number(form.get('quantity')), expected_quantity: product.stock_quantity, reason: form.get('reason') }) })
      setEditing(null); await load(); setMessage(`Stock updated for ${product.name}.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update stock.') }
    finally { setBusy(null) }
  }
  return <section><div className="staff-section-heading"><h1>Inventory</h1><button className="button button-outline" onClick={() => { setEditing(null); load().then(() => setError('')).catch((e: Error) => setError(e.message)) }}>Refresh inventory</button></div><p>{canManage ? 'Review stock and record adjustments with a reason.' : 'You have permission to view stock quantities.'}</p>
    {error && <p className="inline-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}<label>Search products<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Product name or SKU" /></label>
    <section className="admin-panel">{loading ? <p role="status">Loading inventory…</p> : <div className="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Pack size</th><th>Stock</th>{canManage && <th>Adjust stock</th>}</tr></thead><tbody>{products.filter(p => `${p.name} ${p.sku}`.toLowerCase().includes(search.toLowerCase())).map(product => <tr key={product.id}><td>{product.name}</td><td>{product.sku}</td><td>{product.pack_size}</td><td>{product.stock_quantity} {product.selling_unit === 'case' ? 'cases' : 'items'}</td>{canManage && <td>{editing === product.id ? <form className="staff-stock-form" onSubmit={event => save(event, product)}><label>New stock quantity<input name="quantity" type="number" min={0} max={1000000} step={1} required defaultValue={product.stock_quantity} /></label><label>Reason<input name="reason" minLength={3} maxLength={120} required placeholder="e.g. Stock received" /></label><div className="staff-actions"><button className="button button-dark" disabled={busy !== null}>{busy === product.id ? 'Saving…' : 'Save'}</button><button className="button button-outline" type="button" disabled={busy !== null} onClick={() => setEditing(null)}>Cancel</button></div></form> : <button className="button button-outline" disabled={busy !== null} onClick={() => setEditing(product.id)}>Adjust</button>}</td>}</tr>)}</tbody></table>{!products.length && <p>No products found.</p>}</div>}</section>
  </section>
}

function StaffLogin({ onSignedIn }: { onSignedIn: (member: Staff) => void }) {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('')
    try { const result = await api<{ staff: Staff }>('/staff/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) }); onSignedIn(result.staff); navigate('/staff', { replace: true }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Sign in failed.') }
    finally { setBusy(false) }
  }
  return <main className="login-page"><div className="account-theme-control"><ThemeToggle /></div><Link to="/" className="brand login-brand"><img className="brand-logo" src="/SipUp%20Beverages%20Winged%20Cart%20Emblem.png" alt="SipUp" /></Link><div className="login-card"><span className="eyebrow">SIPUP TEAM</span><h1>Staff Login</h1><p>Use the login details provided by your administrator.</p><div className="staff-login-links"><Link to="/account/login">Store / Customer Login</Link><strong>Staff Login</strong></div><form onSubmit={submit}><label>Email address<input type="email" name="email" autoComplete="username" required /></label><label>Password<input type="password" name="password" autoComplete="current-password" required maxLength={200} /></label>{error && <p className="inline-error" role="alert">{error}</p>}<button className="button button-dark button-wide" disabled={busy}>{busy ? 'Signing in…' : 'Staff Login'}</button></form><p>Need access or a password reset? Contact your administrator.</p><Link className="text-link" to="/admin/login">Admin Login</Link></div></main>
}

export function StaffApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const [staff, setStaff] = useState<Staff | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController(); setError('')
    api<{ staff: Staff }>('/staff/me', { signal: controller.signal }).then(r => setStaff(r.staff)).catch((e: Error) => {
      if (controller.signal.aborted) return
      if (e instanceof ApiError && e.status === 401) setStaff(null)
      else setError(e.message)
    }).finally(() => { if (!controller.signal.aborted) setChecking(false) })
    return () => controller.abort()
  }, [location.pathname, revision])
  const logout = async () => { try { await api('/staff/logout', { method: 'POST' }); setStaff(null); navigate('/staff/login') } catch (e) { setError(e instanceof Error ? e.message : 'Could not sign out.') } }
  if (checking) return <p className="page-loading" role="status">Checking staff session…</p>
  if (!staff && error) return <main className="page-empty"><p role="alert">{error}</p><button className="button button-dark" onClick={() => setRevision(r => r + 1)}>Try again</button></main>
  if (!staff) return <StaffLogin onSignedIn={setStaff} />
  const sales = staff.permissions.sales_view
  const inventory = staff.permissions.inventory_view
  const noAccess = <section className="admin-panel"><h1>Your staff account is ready</h1><p>Your administrator has not granted feature access. Contact them to update your permissions.</p></section>
  return <div className="staff-workspace"><header className="staff-header"><Link to="/" className="brand">SipUp <small>STAFF</small></Link><span>{staff.name}</span><ThemeToggle /><button className="button button-outline" onClick={logout}>Sign out</button></header><div className="staff-body"><nav aria-label="Staff navigation">{sales && <NavLink to="/staff" end>My sales</NavLink>}{inventory && <NavLink to="/staff/inventory">Inventory</NavLink>}<Link to="/">Storefront</Link></nav><main>{error && <p role="alert" className="inline-error">{error}</p>}<Routes><Route index element={sales ? <SalesReport endpoint="/staff/sales" title="My sales" /> : inventory ? <StaffInventory canManage={staff.permissions.inventory_manage} /> : noAccess} /><Route path="inventory" element={inventory ? <StaffInventory canManage={staff.permissions.inventory_manage} /> : noAccess} /><Route path="*" element={sales ? <SalesReport endpoint="/staff/sales" title="My sales" /> : inventory ? <StaffInventory canManage={staff.permissions.inventory_manage} /> : noAccess} /></Routes></main></div></div>
}
