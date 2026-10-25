import { z } from 'zod'

export const reportFilters = z.object({
  from: z.string().date().optional(), to: z.string().date().optional(),
  status: z.enum(['booking','confirmed','processing','dispatched','delivered','cancelled']).optional(),
  treatment: z.enum(['standard','reduced','zero','exempt']).optional(),
  category: z.string().trim().max(100).optional(),
}).refine((f) => !f.from || !f.to || f.from <= f.to, 'Start date must precede end date.')

export function reportWhere(filters, dateColumn, taxAlias = 'b') {
  const conditions = []
  const params = []
  conditions.push('o.status = ?')
  params.push(filters.status || 'delivered')
  if (filters.from) { conditions.push(`${dateColumn} >= ?`); params.push(`${filters.from} 00:00:00`) }
  if (filters.to) { conditions.push(`${dateColumn} < DATE_ADD(?, INTERVAL 1 DAY)`); params.push(filters.to) }
  if (filters.treatment) { conditions.push(`${taxAlias}.vat_treatment = ?`); params.push(filters.treatment) }
  if (filters.category) { conditions.push(`${taxAlias}.category_name = ?`); params.push(filters.category) }
  return { sql: conditions.join(' AND '), params }
}

const numericRows = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
  [key, key.endsWith('_pence') || key.endsWith('_count') || key === 'vat_rate' ? value === null ? null : Number(value)
    : key === 'is_delivery' ? Boolean(value) : value])))

export async function vatReport(pool, filters) {
  const catalogueParams = []
  const catalogueWhere = []
  if (filters.category) { catalogueWhere.push('c.name=?'); catalogueParams.push(filters.category) }
  if (filters.treatment) { catalogueWhere.push('p.vat_treatment=?'); catalogueParams.push(filters.treatment) }
  const catalogue = await pool.query(`SELECT
    COALESCE(SUM(IF(p.vat_confirmed AND p.vat_treatment IS NOT NULL, ROUND(COALESCE(p.sale_price_gbp,p.price_gbp)*100)*p.stock_quantity,0)),0) AS net_pence,
    COALESCE(SUM(IF(p.vat_confirmed AND p.vat_treatment IS NOT NULL, ROUND(COALESCE(p.sale_price_gbp,p.price_gbp)*p.stock_quantity*COALESCE(p.vat_rate,0)),0)),0) AS estimated_vat_pence,
    COALESCE(SUM(IF(p.vat_confirmed AND p.vat_treatment='zero', ROUND(COALESCE(p.sale_price_gbp,p.price_gbp)*100)*p.stock_quantity,0)),0) AS zero_rated_pence,
    COALESCE(SUM(IF(p.vat_confirmed AND p.vat_treatment='exempt', ROUND(COALESCE(p.sale_price_gbp,p.price_gbp)*100)*p.stock_quantity,0)),0) AS exempt_pence,
    COALESCE(SUM(p.vat_confirmed AND p.vat_treatment IS NOT NULL),0) AS classified_products,
    COALESCE(SUM(NOT p.vat_confirmed OR p.vat_treatment IS NULL),0) AS products_requiring_review,
    COALESCE(SUM(p.vat_treatment IS NULL),0) AS products_missing_classification
    FROM products p LEFT JOIN categories c ON c.id=p.category_id
    ${catalogueWhere.length ? `WHERE ${catalogueWhere.join(' AND ')}` : ''}`, catalogueParams)
  const salesWhere = reportWhere(filters, 'o.created_at')
  const sales = await pool.query(`SELECT b.vat_treatment, b.vat_rate, b.is_delivery,
    SUM(ROUND(b.net_gbp*100)) AS net_pence, SUM(ROUND(b.vat_gbp*100)) AS vat_pence,
    SUM(ROUND(b.gross_gbp*100)) AS gross_pence, SUM(ROUND(b.discount_gbp*100)) AS discount_pence,
    COUNT(DISTINCT o.id) AS order_count
    FROM (
      SELECT order_id, vat_treatment, vat_rate, FALSE AS is_delivery, line_net_gbp AS net_gbp,
        line_vat_gbp AS vat_gbp, line_gross_gbp AS gross_gbp, discount_gbp, category_name
      FROM order_items WHERE line_net_gbp IS NOT NULL AND vat_treatment IS NOT NULL
      UNION ALL
      SELECT order_id, vat_treatment, vat_rate, TRUE, net_gbp, vat_gbp, gross_gbp, 0, NULL
      FROM order_vat_breakdowns WHERE is_delivery=TRUE
    ) b JOIN orders o ON o.id=b.order_id WHERE ${salesWhere.sql}
    GROUP BY b.vat_treatment, b.vat_rate, b.is_delivery ORDER BY b.is_delivery, b.vat_treatment`, salesWhere.params)
  const refundWhere = reportWhere(filters, 'r.refunded_at')
  const refunds = await pool.query(`SELECT b.vat_treatment, b.vat_rate, b.is_delivery,
    SUM(ROUND(b.net_gbp*100)) AS net_pence, SUM(ROUND(b.vat_gbp*100)) AS vat_pence,
    SUM(ROUND(b.gross_gbp*100)) AS gross_pence, COUNT(DISTINCT o.id) AS order_count
    FROM (SELECT t.*, t.delivery_breakdown_id IS NOT NULL AS is_delivery, i.category_name
      FROM refund_tax_lines t LEFT JOIN order_items i ON i.id=t.order_item_id) b
    JOIN refunds r ON r.id=b.refund_id JOIN orders o ON o.id=r.order_id WHERE ${refundWhere.sql}
    GROUP BY b.vat_treatment, b.vat_rate, b.is_delivery`, refundWhere.params)
  // Warnings are deliberately independent of treatment/category: these legacy
  // records cannot be assigned to a treatment/category without inventing data.
  const warningWhere = reportWhere({ ...filters, treatment: undefined, category: undefined }, 'o.created_at')
  const legacy = await pool.query(`SELECT COUNT(*) AS order_count FROM orders o WHERE ${warningWhere.sql}
    AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.id AND i.line_net_gbp IS NULL)`, warningWhere.params)
  const unallocatedWhere = reportWhere({ ...filters, treatment: undefined, category: undefined }, 'r.refunded_at')
  const unallocated = await pool.query(`SELECT COUNT(*) AS refund_count, COALESCE(SUM(ROUND(r.amount_gbp*100)),0) AS gross_pence
    FROM refunds r JOIN orders o ON o.id=r.order_id WHERE ${unallocatedWhere.sql}
    AND NOT EXISTS (SELECT 1 FROM refund_tax_lines t WHERE t.refund_id=r.id)`, unallocatedWhere.params)
  const recent = await pool.query(`SELECT DISTINCT o.id, o.reference, o.status, o.created_at,
    ROUND(o.subtotal_gbp*100) AS net_pence, ROUND(o.vat_gbp*100) AS vat_pence,
    ROUND(o.total_gbp*100) AS gross_pence FROM orders o
    JOIN order_items b ON b.order_id=o.id WHERE ${salesWhere.sql} ORDER BY o.created_at DESC, o.id DESC LIMIT 8`, salesWhere.params)
  const cat = numericRows(catalogue.rows)[0]
  const refundStates = await pool.query(`SELECT o.status,
    CASE WHEN COALESCE(r.amount,0)=0 THEN 'none' WHEN r.amount>=o.total_gbp THEN 'full' ELSE 'partial' END AS refund_state,
    COUNT(DISTINCT o.id) AS order_count FROM orders o JOIN order_items b ON b.order_id=o.id
    LEFT JOIN (SELECT order_id,SUM(amount_gbp) AS amount FROM refunds GROUP BY order_id) r ON r.order_id=o.id
    WHERE ${salesWhere.sql} GROUP BY o.status, refund_state`, salesWhere.params)
  cat.gross_pence = cat.net_pence + cat.estimated_vat_pence
  return { catalogue: cat, orders: numericRows(sales.rows), refunds: numericRows(refunds.rows), refund_states: numericRows(refundStates.rows),
    recent_orders: numericRows(recent.rows), legacy_orders_without_tax: Number(legacy.rows[0].order_count),
    unallocated_refunds: numericRows(unallocated.rows)[0],
    basis: 'Order creation dates and refund dates in UTC; delivered orders by default. Category filters exclude delivery and legacy lines without a category snapshot.' }
}
