import ProductImage from './ProductImage'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, Box, Check, ChevronDown, ChevronRight, CircleHelp, Minus, Package, Plus, ShieldCheck, ShoppingBag, Truck, X, ZoomIn } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, formatMoney, imageFallback } from './api'
import { calculateLine } from '../shared/vat.js'
import { displayedPrice, displayedLinePrice, unitPriceFor } from '../shared/storefront-pricing.js'
import type { Product, StoreSettings } from './types'

type Props = { product: Product; store: StoreSettings; vatDisplayMode: 'inclusive' | 'exclusive'; onAdd: (product: Product, quantity?: number) => void }

export default function ProductDetailContent({ product, store, vatDisplayMode, onAdd }: Props) {
  const [qty, setQty] = useState(product.min_quantity)
  const [activeImage, setActiveImage] = useState(product.image_url)
  const [related, setRelated] = useState<Product[]>([])
  const dialog = useRef<HTMLDialogElement>(null)
  const caseProduct = product.selling_unit === 'case' || product.pack_size.startsWith('Case of ')
  const unitLabel = caseProduct ? 'case' : 'pack'
  const units = product.units_per_case || 1
  const unavailable = product.stock_quantity < product.min_quantity
  const netPrice = unitPriceFor(product, qty)
  const price = displayedPrice(netPrice, product.vat_treatment, vatDisplayMode)
  const inclusive = displayedPrice(netPrice, product.vat_treatment, 'inclusive')
  const total = product.vat_treatment ? calculateLine(netPrice, qty, product.vat_treatment) : null
  const gallery = product.images?.length ? product.images : [{ image_url: product.image_url, alt_text: product.name }]
  const changeQuantity = (value: number) => setQty(Math.max(product.min_quantity, Math.min(product.stock_quantity, Math.floor(value) || product.min_quantity)))

  useEffect(() => {
    const controller = new AbortController()
    api<{ products: Product[] }>(`/products?category=${encodeURIComponent(product.category_slug || 'All')}&limit=5`, { signal: controller.signal })
      .then(data => setRelated(data.products.filter(p => p.id !== product.id).slice(0, 4)))
      .catch(() => { /* The product can be purchased without related suggestions. */ })
    return () => controller.abort()
  }, [product.id, product.category_slug])

  return <main className="product-detail product-page-v2 section-wrap">
    <nav className="breadcrumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><ChevronRight size={13} /><Link to="/shop">Shop</Link>{product.category_slug && <><ChevronRight size={13} /><Link to={`/category/${product.category_slug}`}>{product.category}</Link></>}<ChevronRight size={13} /><span aria-current="page">{product.flavour || product.name}</span></nav>
    <div className="pdp-layout">
      <div className="pdp-gallery">
        <div className="pdp-image-stage">
          <div className="pdp-image-top"><span><Box size={15} /> {caseProduct ? 'Wholesale case' : 'Wholesale pack'}</span>{product.is_new && <span className="pdp-new">New arrival</span>}</div>
          <span className="pdp-image-ring" aria-hidden="true" />
          <button type="button" className="pdp-image-button" onClick={() => dialog.current?.showModal()} aria-label={`Enlarge photo of ${product.name}`}><ProductImage src={activeImage || imageFallback} alt={gallery.find(image => image.image_url === activeImage)?.alt_text || product.name} fetchPriority="high" /></button>
          <button className="pdp-zoom" type="button" onClick={() => dialog.current?.showModal()} aria-label="Enlarge product image"><ZoomIn size={19} /></button>
          <div className="pdp-image-caption"><span>THE SIPUP SELECTION</span><span>{String(gallery.findIndex(image => image.image_url === activeImage) + 1 || 1).padStart(2, '0')} / {String(gallery.length).padStart(2, '0')}</span></div>
        </div>
        {gallery.length > 1 && <div className="pdp-thumbnails" aria-label="Product photos">{gallery.map((image, index) => <button type="button" key={image.id || image.image_url} aria-label={`View photo ${index + 1}`} aria-pressed={activeImage === image.image_url} onClick={() => setActiveImage(image.image_url)}><ProductImage src={image.image_url || imageFallback} alt={image.alt_text || product.name} /></button>)}</div>}
        <p className="pdp-photo-note"><Package size={15} /> {product.pack_size || 'Product packaging shown'}</p>
        <div className="pdp-gallery-note"><span className="pdp-note-icon"><ShoppingBag size={22} /></span><div><strong>Good things come in {caseProduct ? 'cases' : 'packs'}.</strong><p>{caseProduct ? 'Stock your shelves with a full case of flavour.' : 'Your next shelf favourite is right here.'}</p></div></div>
      </div>

      <div className="pdp-info">
        <div className="pdp-kicker"><Link to={product.category_slug ? `/category/${product.category_slug}` : '/shop'}>{product.parent_category ? `${product.parent_category} / ` : ''}{product.category}</Link><span className={`pdp-stock ${unavailable ? 'is-unavailable' : ''}`}><i />{unavailable ? 'Out of stock' : 'In stock'}</span></div>
        <span className="pdp-brand">{product.brand || 'The SipUp selection'}</span>
        <h1>{product.name}</h1>
        <p className="pdp-intro">{caseProduct ? 'Your shelf, stocked. ' : ''}{product.flavour ? `${product.flavour} flavour, ready to add to your next order.` : 'Explore the product details and choose your quantity below.'}</p>
        <dl className="pdp-quick-facts">{product.flavour && <div><dt>Flavour</dt><dd>{product.flavour}</dd></div>}{product.size && <div><dt>Unit size</dt><dd>{product.size}</dd></div>}<div><dt>{caseProduct ? 'Per case' : 'Pack size'}</dt><dd>{caseProduct && product.units_per_case ? `${units} items` : product.pack_size || '1 item'}</dd></div></dl>

        <section className="pdp-purchase" aria-label="Price and ordering">
          <div className="pdp-price-label">{caseProduct ? 'Price per case' : 'Price per pack'}{product.sale_price_pence !== null && product.sale_price_pence < product.price_pence && <span>On offer</span>}</div>
          <div className="pdp-main-price"><strong>{formatMoney(price)}</strong><span>{vatDisplayMode === 'inclusive' ? 'including VAT' : 'excluding VAT'}</span>{product.sale_price_pence !== null && product.sale_price_pence < product.price_pence && <del>{formatMoney(displayedPrice(product.price_pence, product.vat_treatment, vatDisplayMode))}</del>}</div>
          <div className="pdp-secondary-price">{vatDisplayMode === 'inclusive' ? `${formatMoney(netPrice)} excluding VAT` : `${formatMoney(inclusive)} including VAT`}{caseProduct && units > 1 && <span>Approx. {formatMoney(Math.round(inclusive / units))} per item incl. VAT</span>}</div>
          {!!product.bulk_prices?.length && <div className="pdp-price-breaks"><strong>Stock up for less</strong>{[...product.bulk_prices].sort((a, b) => a.min_quantity - b.min_quantity).map(tier => <div className={qty >= tier.min_quantity ? 'active' : ''} key={tier.min_quantity}><span>{tier.min_quantity}+ {unitLabel}s</span><b>{formatMoney(displayedPrice(tier.unit_price_pence, product.vat_treatment, vatDisplayMode))} / {unitLabel}</b><small>{vatDisplayMode === 'inclusive' ? 'inc.' : 'ex.'} VAT</small></div>)}</div>}
          <div className="pdp-order-line"><label htmlFor={`pdp-quantity-${product.id}`}>{caseProduct ? 'Number of cases' : 'Quantity'}<small>Minimum {product.min_quantity} {unitLabel}{product.min_quantity === 1 ? '' : 's'}</small></label><div className="pdp-stepper"><button type="button" disabled={unavailable || qty <= product.min_quantity} aria-label="Decrease quantity" onClick={() => changeQuantity(qty - 1)}><Minus size={17} /></button><input id={`pdp-quantity-${product.id}`} aria-label={caseProduct ? 'Number of cases' : 'Quantity'} type="number" inputMode="numeric" min={product.min_quantity} max={product.stock_quantity} value={qty} disabled={unavailable} onChange={event => changeQuantity(Number(event.target.value))} /><button type="button" disabled={unavailable || qty >= product.stock_quantity} aria-label="Increase quantity" onClick={() => changeQuantity(qty + 1)}><Plus size={17} /></button></div></div>
          <div className="pdp-order-total" aria-live="polite"><span>{qty} {unitLabel}{qty === 1 ? '' : 's'}{caseProduct ? ` · ${qty * units} items` : ''}<small>Order total including VAT</small></span><strong>{formatMoney(total?.grossPence ?? netPrice * qty)}</strong></div>
          <button className="button pdp-add-button" disabled={unavailable} onClick={() => onAdd(product, qty)}><ShoppingBag size={19} /><span>{unavailable ? 'Currently out of stock' : 'Add to bag'}</span><strong>{!unavailable && formatMoney(displayedLinePrice(netPrice, qty, product.vat_treatment, vatDisplayMode))}</strong>{!unavailable && <ArrowRight size={18} />}</button>
          <p className="pdp-purchase-note"><Check size={14} /> {unavailable ? 'Browse the range for more favourites.' : `${product.stock_quantity} ${unitLabel}${product.stock_quantity === 1 ? '' : 's'} available to order`}</p>
        </section>
        <div className="pdp-reassurance"><div><Truck size={20} /><span><strong>Delivery or collection</strong><small>Choose at checkout</small></span></div><div><ShieldCheck size={20} /><span><strong>Clear pricing</strong><small>VAT shown in your total</small></span></div></div>
      </div>
    </div>

    <section className="pdp-information" aria-labelledby="product-information-title"><div className="pdp-information-heading"><span className="eyebrow">A CLOSER LOOK</span><h2 id="product-information-title">The good-to-know details.</h2><p>Everything you need before you stock up.</p>{(store.email || store.phone) && <a className="text-link" href={store.email ? `mailto:${store.email}` : `tel:${store.phone}`}><CircleHelp size={16} /> Ask the SipUp team <ArrowUpRight size={15} /></a>}</div><div className="pdp-accordions">
      <details open><summary>About this product <ChevronDown size={19} /></summary><div className="pdp-accordion-content"><p>{product.description || `${product.name} is available as ${product.pack_size || 'a wholesale pack'}. Choose your quantity above to add it to your order.`}</p></div></details>
      <details open><summary>Product & pack details <ChevronDown size={19} /></summary><div className="pdp-accordion-content"><dl className="pdp-specifications">{product.brand && <div><dt>Brand</dt><dd>{product.brand}</dd></div>}{product.flavour && <div><dt>Flavour</dt><dd>{product.flavour}</dd></div>}{product.size && <div><dt>Unit size</dt><dd>{product.size}</dd></div>}<div><dt>Pack size</dt><dd>{product.pack_size || 'Single pack'}</dd></div><div><dt>Product code</dt><dd>{product.sku}</dd></div></dl></div></details>
      <details><summary>Ordering, delivery & collection <ChevronDown size={19} /></summary><div className="pdp-accordion-content"><p>Sold by the {unitLabel}. The minimum order for this product is {product.min_quantity} {unitLabel}{product.min_quantity === 1 ? '' : 's'}. Choose delivery or collection at checkout, where any delivery charges are shown before you submit your order.</p><p>Your order request is saved before the WhatsApp handoff, so the SipUp team can confirm the details with you.</p></div></details>
      <details><summary>Price & VAT breakdown <ChevronDown size={19} /></summary><div className="pdp-accordion-content">{total ? <dl className="pdp-specifications"><div><dt>{qty} {unitLabel}{qty === 1 ? '' : 's'} excluding VAT</dt><dd>{formatMoney(total.netPence)}</dd></div><div><dt>VAT{product.vat_rate != null ? ` (${product.vat_rate}%)` : ''}</dt><dd>{formatMoney(total.vatPence)}</dd></div><div><dt>Total including VAT</dt><dd>{formatMoney(total.grossPence)}</dd></div></dl> : <p>VAT is confirmed in the order breakdown.</p>}<p>All prices are in GBP.{caseProduct ? ' Per-item prices are rounded comparisons; complete cases are charged.' : ''}</p></div></details>
    </div></section>

    {!!related.length && <section className="pdp-related" aria-labelledby="related-title"><div className="section-heading"><div><span className="eyebrow">KEEP THE GOOD THINGS COMING</span><h2 id="related-title">More for your <em>shelves.</em></h2></div><Link to={product.category_slug ? `/category/${product.category_slug}` : '/shop'} className="text-link">Explore {product.category || 'the range'} <ArrowRight size={16} /></Link></div><div className="pdp-related-grid">{related.map(item => <Link className="pdp-related-card" key={item.id} to={`/product/${item.slug}`}><div className="pdp-related-photo"><ProductImage src={item.image_url || imageFallback} alt={item.name} loading="lazy" /><span><ArrowUpRight size={19} /></span></div><span className="pdp-related-brand">{item.brand || item.category}</span><h3>{item.name}</h3><p>{item.pack_size}</p><strong>{formatMoney(displayedPrice(unitPriceFor(item, item.min_quantity), item.vat_treatment, vatDisplayMode))} <small>{vatDisplayMode === 'inclusive' ? 'inc.' : 'ex.'} VAT</small></strong></Link>)}</div></section>}
    <Link to="/shop" className="pdp-back-link"><ArrowLeft size={16} /> Back to all products</Link>
    <dialog className="pdp-image-dialog" ref={dialog} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close() }}><div><button autoFocus type="button" aria-label="Close image" onClick={() => dialog.current?.close()}><X size={22} /></button><ProductImage src={activeImage || imageFallback} alt={product.name} /><p>{product.name}</p></div></dialog>
  </main>
}
