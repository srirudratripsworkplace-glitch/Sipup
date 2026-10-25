import ProductImage from './ProductImage'
import { imageFallback } from './api'
import './order-products.css'

export default function OrderProductSummary({ item, openOrder }: {
  item: { product_name: string; image_url: string; quantity: number }
  openOrder?: () => void
}) {
  const picture = <ProductImage src={item.image_url || imageFallback} alt={item.product_name} loading="lazy" />
  return <div className="order-product-summary">
    {item.image_url ? <a className="order-product-thumbnail" href={item.image_url} target="_blank" rel="noopener noreferrer" aria-label={`Open full-size image of ${item.product_name}`} onClick={event => event.stopPropagation()}>{picture}</a> : <span className="order-product-thumbnail">{picture}</span>}
    <div className="order-product-copy">{openOrder ? <button className="order-product-name" type="button" onClick={event => { event.stopPropagation(); openOrder() }}>{item.product_name}</button> : <strong>{item.product_name}</strong>}<small>Quantity: {item.quantity}</small></div>
  </div>
}
