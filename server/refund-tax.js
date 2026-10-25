import { calculateRefund } from '../shared/vat.js'

const pence = (value) => {
  const [whole, fraction = ''] = String(value).split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

export async function refundSources(connection, orderId) {
  const result = await connection.query(`
    SELECT CONCAT('item:', i.id) AS source, i.id AS order_item_id, NULL AS delivery_breakdown_id,
      i.product_name AS name, i.quantity, i.vat_treatment, i.vat_rate,
      i.line_net_gbp AS net_gbp, i.line_vat_gbp AS vat_gbp,
      COALESCE((SELECT SUM(t.quantity) FROM refund_tax_lines t WHERE t.order_item_id=i.id),0) AS refunded_quantity
    FROM order_items i WHERE i.order_id=? AND i.line_net_gbp IS NOT NULL AND i.line_vat_gbp IS NOT NULL
    UNION ALL
    SELECT CONCAT('delivery:', b.id), NULL, b.id, 'Delivery charge', 1, b.vat_treatment, b.vat_rate,
      b.net_gbp, b.vat_gbp,
      COALESCE((SELECT SUM(t.quantity) FROM refund_tax_lines t WHERE t.delivery_breakdown_id=b.id),0)
    FROM order_vat_breakdowns b WHERE b.order_id=? AND b.is_delivery=TRUE
  `, [orderId, orderId])
  return result.rows.map((row) => ({ ...row, quantity: Number(row.quantity),
    refunded_quantity: Number(row.refunded_quantity),
    netPence: pence(row.net_gbp), vatPence: pence(row.vat_gbp) }))
}

export function allocateRefund(sources, requested) {
  const seen = new Set()
  return requested.map((line) => {
    const source = sources.find((candidate) => candidate.source === line.source)
    if (!source || seen.has(line.source)) throw new RangeError('Select each original refund item once.')
    seen.add(line.source)
    return { ...source, refundQuantity: line.quantity,
      ...calculateRefund(source, line.quantity, source.refunded_quantity) }
  })
}
