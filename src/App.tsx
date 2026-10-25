import ProductImage from './ProductImage'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import AisleSection from './AisleSection'
import ProductDetailContent from './ProductDetailContent'
import RouteScroll from './RouteScroll'
import HomeHeroVisual from './HomeHeroVisual'
import { ThemeToggle } from './Theme'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, Box, Check, ChevronDown,
  ChevronRight, CircleHelp, Clock3, Download, ExternalLink, Eye, EyeOff, Globe,
  LayoutDashboard, LockKeyhole, LogOut, Menu, Minus, Package, Plus, Search, Settings, SlidersHorizontal,
  ShieldCheck, ShoppingBag, ShoppingCart, Sparkles, Truck, X, Zap,
} from 'lucide-react'
import {
  Link, NavLink, Route, Routes, useLocation, useNavigate, useParams,
} from 'react-router-dom'
import { api, ApiError, formatMoney, imageFallback } from './api'
import { readPendingBagItem, safeStorefrontRedirect } from '../shared/navigation.js'
import { calculateLine, calculatePrice, calculateRefund, VAT_RATES } from '../shared/vat.js'
import { displayedPrice, displayedLinePrice, unitPriceFor, readVatPreference, saveVatPreference } from '../shared/storefront-pricing.js'
import type { CartItem, CustomerAccount, HomeSettings, Order, Product, SavedOrder, StoreSettings } from './types'

const defaultStore: StoreSettings = {
  name: 'SipUp', tagline: 'Good stock. Good energy.', whatsapp_number: '', email: '', phone: '', address: '',
  currency: 'GBP', delivery_vat_treatment: null, delivery_charge_pence: 0,
  free_delivery_threshold_pence: 0, minimum_order_pence: 0, business_hours: '',
  announcement: 'Wholesale favourites, ready when you are.',
}
const defaultHome: HomeSettings = {
  hero_title: 'Good stock.\nGood energy.', hero_copy: 'A better way to keep your shelves full. Discover the drinks and snacks your customers come back for.',
  hero_image: '', promo_message: 'Stock up on the good stuff', featured_heading: 'The SipUp essentials',
}
const vatTreatments = ['standard', 'reduced', 'zero', 'exempt'] as const
const emptyProduct = (): Partial<Product> => ({
  name: '', sku: '', brand: '', category: 'Drinks', description: '', image_url: '',
  price_pence: 0, sale_price_pence: null, stock_quantity: 0, min_quantity: 1,
  pack_size: '', is_published: false, is_featured: false, is_new: false,
  vat_treatment: null, vat_rate: null, vat_confirmed: false, price_entry_mode: 'exclusive',
})
type VatDisplayMode = 'exclusive' | 'inclusive'
type CheckoutQuote = {
  items: Array<{
    product_id: number
    name: string
    sku: string
    quantity: number
    unit_price_pence: number
    line_net_pence: number
    line_vat_pence: number
    line_gross_pence: number
    vat_treatment: NonNullable<Product['vat_treatment']>
    vat_rate: number | null
  }>
  subtotal_pence: number
  vat_pence: number
  delivery_pence: number
  delivery_vat_pence: number
  total_pence: number
  vat_breakdowns: Array<{
    vat_treatment: NonNullable<Product['vat_treatment']>
    vat_rate: number | null
    net_pence: number
    vat_pence: number
    gross_pence: number
    is_delivery: boolean
  }>
}
const vatTreatmentName = (treatment: Product['vat_treatment']) => {
  if (treatment === 'standard') return `Standard-rated (${VAT_RATES.standard}%)`
  if (treatment === 'reduced') return `Reduced-rated (${VAT_RATES.reduced}%)`
  if (treatment === 'zero') return 'Zero-rated (0%)'
  if (treatment === 'exempt') return 'Exempt'
  return 'Needs review'
}

function useCart() {
  const [items, setItems] = useState<CartItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('sipup-cart') || '[]') as CartItem[] } catch { return [] }
  })
  useEffect(() => localStorage.setItem('sipup-cart', JSON.stringify(items)), [items])
  const add = (product: Product, quantity = product.min_quantity) => setItems((current) => {
    const found = current.find((item) => item.product.id === product.id)
    if (found) return current.map((item) => item.product.id === product.id
      ? { ...item, quantity: Math.min(item.quantity + quantity, product.stock_quantity) } : item)
    return [...current, { product, quantity: Math.min(quantity, product.stock_quantity) }]
  })
  const setQuantity = (id: number, quantity: number) => setItems((current) => current
    .map((item) => item.product.id === id ? { ...item, quantity: Math.max(1, Math.min(item.product.stock_quantity, quantity)) } : item)
    .filter((item) => item.quantity > 0))
  const remove = (id: number) => setItems((current) => current.filter((item) => item.product.id !== id))
  return { items, add, setQuantity, remove, clear: () => setItems([]) }
}

function useStore() {
  const [store, setStore] = useState<StoreSettings>(defaultStore)
  const [home, setHome] = useState<HomeSettings>(defaultHome)
  useEffect(() => {
    api<{ store: StoreSettings; homepage: HomeSettings }>('/settings')
      .then((data) => { setStore({ ...defaultStore, ...data.store }); setHome({ ...defaultHome, ...data.homepage }) })
      .catch((error: Error) => console.error('Could not load SipUp settings:', error.message))
  }, [])
  return { store, home }
}

const ShopperSession = createContext<{ customer: CustomerAccount | null; setCustomer: (customer: CustomerAccount | null) => void }>({ customer: null, setCustomer: () => {} })

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const cart = useCart()
  const [customer, setCustomer] = useState<CustomerAccount | null>(null)
  const adding = useRef(false)
  const { store, home } = useStore()
  const [toast, setToast] = useState('')
  const [vatDisplayMode, setVatDisplayMode] = useState<VatDisplayMode>(() =>
    readVatPreference(localStorage))
  useEffect(() => { saveVatPreference(localStorage, vatDisplayMode) }, [vatDisplayMode])
  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timeout)
  }, [toast])
  useEffect(() => {
    if (location.pathname.startsWith('/admin')) return
    const controller = new AbortController()
    api<{ customer: CustomerAccount }>('/account/me', { signal: controller.signal })
      .then(result => setCustomer(result.customer))
      .catch(reason => { if (!controller.signal.aborted && reason instanceof ApiError && reason.status === 401) setCustomer(null) })
    return () => controller.abort()
  }, [location.pathname])
  useEffect(() => {
    if (!customer || location.pathname.startsWith('/account')) return
    let pending
    try {
      pending = readPendingBagItem(sessionStorage.getItem('sipup-pending-bag'))
      if (!pending || new URL(pending.redirect, window.location.origin).pathname !== location.pathname) return
      sessionStorage.removeItem('sipup-pending-bag')
    } catch { return }
    api<Product>(`/products/${pending.slug}`).then(product => {
      if (product.stock_quantity < product.min_quantity) { setToast('This product is currently out of stock.'); return }
      const quantity = Math.max(product.min_quantity, Math.min(pending.quantity, product.stock_quantity))
      cart.add(product, quantity)
      setToast(`${product.name} added to your bag`)
    }).catch(() => setToast('You are signed in. Please add your product to the bag again.'))
  }, [customer, location.pathname])
  const onAdd = async (product: Product, quantity = product.min_quantity) => {
    if (adding.current || product.stock_quantity < product.min_quantity) return
    adding.current = true
    try {
      const result = await api<{ customer: CustomerAccount }>('/account/me')
      setCustomer(result.customer)
      cart.add(product, quantity)
      setToast(`${product.name} added to your bag`)
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        setCustomer(null)
        const redirect = safeStorefrontRedirect(location.pathname + location.search)
        try { sessionStorage.setItem('sipup-pending-bag', JSON.stringify({ slug: product.slug, quantity, redirect, createdAt: Date.now() })) } catch { /* Sign-in still works without browser storage. */ }
        navigate(`/account/login?redirect=${encodeURIComponent(redirect)}&reason=bag`)
      } else setToast('We could not check your account. Please try again.')
    } finally { adding.current = false }
  }
  return (
    <ShopperSession.Provider value={{ customer, setCustomer }}><div className="min-h-screen">
      <RouteScroll />
      {(location.pathname.startsWith('/account') || location.pathname === '/admin/login') && <div className="account-theme-control"><ThemeToggle /></div>}
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/account/login" element={<AccountPage mode="login" />} />
        <Route path="/account/register" element={<AccountPage mode="register" />} />
        <Route path="/account" element={<AccountPage mode="account" />} />
        <Route path="/product/:slug" element={<ProductPage store={store} cart={cart} onAdd={onAdd} vatDisplayMode={vatDisplayMode} />} />
        <Route path="/cart" element={<CartPage store={store} cart={cart} vatDisplayMode={vatDisplayMode} />} />
        <Route path="/checkout" element={<CheckoutPage store={store} cart={cart} />} />
        <Route path="/order-confirmation/:reference" element={<ConfirmationPage store={store} />} />
        <Route path="/shop" element={<Storefront store={store} home={home} cart={cart} onAdd={onAdd} initialCategory="All" vatDisplayMode={vatDisplayMode} onVatDisplayModeChange={setVatDisplayMode} />} />
        <Route path="/category/:category" element={<CategoryRoute store={store} home={home} cart={cart} onAdd={onAdd} vatDisplayMode={vatDisplayMode} onVatDisplayModeChange={setVatDisplayMode} />} />
        <Route path="/:legal" element={<LegalPage store={store} />} />
        <Route path="*" element={<Storefront store={store} home={home} cart={cart} onAdd={onAdd} initialCategory="All" vatDisplayMode={vatDisplayMode} onVatDisplayModeChange={setVatDisplayMode} />} />
      </Routes>
      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    </div></ShopperSession.Provider>
  )
}

function BrandLogo() {
  return <img className="brand-logo" src="/SipUp%20Beverages%20Winged%20Cart%20Emblem.png" alt="SipUp Beverages" width={128} height={128} />
}

function Header({ store, count }: { store: StoreSettings; count: number }) {
  const { customer } = useContext(ShopperSession)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const searchDialog = useRef<HTMLDialogElement>(null)
  const [categories,setCategories]=useState<Category[]>([])
  useEffect(()=>{api<{categories:Category[]}>('/categories').then(r=>setCategories(r.categories)).catch(()=>{})},[])
  const location = useLocation()
  useEffect(() => { setOpen(false); searchDialog.current?.close() }, [location.pathname, location.search])
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const onResize = () => { if (window.innerWidth > 1100) setOpen(false) }
    window.addEventListener('keydown', onKey); window.addEventListener('resize', onResize)
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize) }
  }, [open])
  const runSearch = (value: string) => {
    const query = value.trim()
    searchDialog.current?.close()
    navigate(query ? `/shop?search=${encodeURIComponent(query)}` : '/shop')
  }
  return (
    <>
      {store.announcement && <div className="announcement"><Sparkles size={14} />{store.announcement}</div>}
      <header className="site-header">
        <button className="icon-btn mobile-menu" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="store-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
        <Link to="/" className="brand" aria-label="SipUp home"><BrandLogo /></Link>
        <nav id="store-navigation" className={`main-nav ${open ? 'is-open' : ''}`} aria-label="Main navigation">
          <NavLink to="/shop">Shop all</NavLink>
          {categories.filter(c=>!c.parent_id&&Number(c.product_count)>0).map(c=><NavLink key={c.id} to={`/category/${c.slug}`}>{c.name}</NavLink>)}
          <NavLink to="/shop?sort=featured">Wholesale</NavLink>
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          <button type="button" className="icon-btn search-btn" aria-label="Search products" onClick={() => { setOpen(false); setSearch(new URLSearchParams(location.search).get('search') || ''); searchDialog.current?.showModal() }}><Search size={19} /></button>
          {store.whatsapp_number && <a className="whatsapp-header" href={`https://wa.me/${store.whatsapp_number.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><Zap size={15} /><span>WhatsApp</span></a>}
          <Link to="/account" className="account-link" aria-label={customer ? 'My account' : 'Sign in or create an account'}><LockKeyhole size={17} /><span>{customer ? 'My account' : 'Sign in / Join'}</span></Link>
          <Link to="/cart" className="cart-link" aria-label={`Cart, ${count} items`}>
            <ShoppingBag size={19} /><span>Bag</span><b className="cart-count">{count}</b>
          </Link>
        </div>
      </header>
      {open && <button className="navigation-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
      <dialog ref={searchDialog} className="store-search-dialog" aria-labelledby="store-search-title" onClick={event => { if (event.target === event.currentTarget) searchDialog.current?.close() }}><div className="store-search-content"><button type="button" className="search-close icon-btn" aria-label="Close search" onClick={() => searchDialog.current?.close()}><X size={21} /></button><span className="eyebrow">THE GOOD STUFF, ONE SEARCH AWAY</span><h2 id="store-search-title">What are you looking for?</h2><form onSubmit={event => { event.preventDefault(); runSearch(search) }} role="search"><Search size={21} /><input autoFocus type="search" aria-label="Search the SipUp range" placeholder="Try a brand, flavour or product…" value={search} onChange={event => setSearch(event.target.value)} /><button className="button button-dark" type="submit">Search <ArrowRight size={17} /></button></form><div className="search-suggestions"><span>Try a favourite</span>{['Fanta', 'Monster', 'Haribo', 'Samyang'].map(term => <button key={term} type="button" onClick={() => runSearch(term)}>{term}<ArrowUpRight size={13} /></button>)}</div></div></dialog>
    </>
  )
}

function Footer({ store }: { store: StoreSettings }) {
  return (
    <footer className="footer">
      <div className="footer-top">
        <div><Link to="/" className="brand footer-brand"><BrandLogo /></Link>
          <p>Good stock. Good energy.<br />Wholesale favourites for every shelf.</p></div>
        <div className="footer-links"><strong>Explore</strong><Link to="/shop">Shop all</Link><Link to="/#products">Product catalogue</Link><Link to="/account/register">Create customer account</Link><Link to="/admin/login">Business login</Link></div>
        <div className="footer-links"><strong>Here to help</strong><Link to="/delivery">Delivery information</Link><Link to="/returns">Returns & refunds</Link><Link to="/contact">Contact us</Link><Link to="/terms">Terms & conditions</Link></div>
        <div className="footer-links"><strong>Get in touch</strong>{store.email && <a href={`mailto:${store.email}`}>{store.email}</a>}{store.phone && <a href={`tel:${store.phone}`}>{store.phone}</a>}<Link to="/privacy">Privacy policy</Link><Link to="/cookies">Cookie policy</Link></div>
      </div>
      <div className="footer-bottom"><span>© {new Date().getFullYear()} SipUp. All rights reserved.</span><span>Made for the good stuff <span className="brand-dot">✳</span></span></div>
    </footer>
  )
}

function CategorySymbol({ name }: { name: string }) {
  if (/^(american?|usa|united states)$/i.test(name.trim())) return <span className="aisle-symbol aisle-symbol-american" role="img" aria-label="United States flag"><svg viewBox="0 0 38 26" aria-hidden="true"><rect width="38" height="26" fill="#fff" />{Array.from({length:7},(_,i)=><rect key={i} y={i*4} width="38" height="2" fill="#be3344"/>)}<rect width="16" height="14" fill="#233b6b"/>{[0,1,2].flatMap(row=>[0,1,2,3].map(col=><circle key={row+'-'+col} cx={2.5+col*3.6} cy={2.5+row*4.4} r=".8" fill="#fff"/>))}</svg></span>
  return <span className="aisle-symbol" aria-hidden="true">{name.trim().toLowerCase()==='global'?<Globe size={30} strokeWidth={1.6}/>:<Box size={30} strokeWidth={1.6}/>}</span>
}

function ProductCard({ product, onAdd, vatDisplayMode }: {
  product: Product; onAdd: (product: Product, quantity?: number) => void; vatDisplayMode: VatDisplayMode
}) {
  const [quantity,setQuantity]=useState(product.min_quantity)
  const cases=product.selling_unit==='case'
  const netPrice = unitPriceFor(product,quantity)
  const price = displayedPrice(netPrice, product.vat_treatment, vatDisplayMode)
  const secondaryMode=vatDisplayMode==='inclusive'?'exclusive':'inclusive'
  const unavailable=product.stock_quantity<product.min_quantity
  const changeQuantity=(next:number)=>setQuantity(Math.max(product.min_quantity,Math.min(product.stock_quantity,Math.floor(next)||product.min_quantity)))
  const adjustQuantity=(delta:number)=>setQuantity(current=>Math.max(product.min_quantity,Math.min(product.stock_quantity,current+delta)))
  return (
    <article className="product-card catalogue-card">
      <Link to={`/product/${product.slug}`} className="product-image-wrap">
        <ProductImage className="product-image" src={product.image_url || imageFallback} alt={product.name} loading="lazy" />
        <div className="card-image-badges">{product.sale_price_pence!==null&&<span className="card-offer">Offer</span>}{product.is_new&&<span className="card-new">New arrival</span>}</div>
        {unavailable&&<span className="card-sold-out">Sold out</span>}
        {cases&&<span className="card-pack-badge"><Box size={15}/>{product.units_per_case} per case</span>}
        <span className="card-view-link" aria-hidden="true"><ArrowUpRight size={19}/></span>
      </Link>
      <div className="product-info">
        <div className="card-topline"><span className="card-category">{product.category}</span><span className={unavailable?'card-stock unavailable':'card-stock'}><i/>{unavailable?'Unavailable':`${product.stock_quantity} ${cases?'cases':'in stock'}`}</span></div>
        {product.brand&&<span className="card-brand">{product.brand}</span>}
        <Link to={`/product/${product.slug}`} className="product-name">{product.name}</Link>
        <div className="card-specs">{product.flavour&&<span>{product.flavour}</span>}{product.size&&<span>{product.size}</span>}{!cases&&product.pack_size&&<span>{product.pack_size}</span>}</div>
        <div className="card-purchase">
          <div className="card-pricing"><span className="card-price-heading">{cases?'Price per case':'Price each'}</span><div className="card-primary-price"><strong>{formatMoney(price)}</strong><span>{vatDisplayMode==='inclusive'?'inc. VAT':'ex. VAT'}</span>{product.sale_price_pence!==null&&<del>{formatMoney(displayedPrice(product.price_pence,product.vat_treatment,vatDisplayMode))}</del>}</div><div className="card-secondary-price"><strong>{formatMoney(displayedPrice(netPrice,product.vat_treatment,secondaryMode))}</strong><span>{secondaryMode==='inclusive'?'inc. VAT':'ex. VAT'}</span>{product.vat_treatment==='zero'&&<span className="card-zero-rate">0% VAT</span>}{product.vat_treatment==='exempt'&&<span className="card-zero-rate">Exempt</span>}</div></div>
          <div className="card-order-row"><div className="card-quantity"><label htmlFor={`card-quantity-${product.id}`}>{cases?'Cases':'Quantity'}</label><div className="card-stepper"><button type="button" aria-label={`Decrease quantity of ${product.name}`} disabled={unavailable||quantity<=product.min_quantity} onClick={()=>adjustQuantity(-1)}><Minus size={15}/></button><input id={`card-quantity-${product.id}`} aria-label={`${cases?'Cases':'Quantity'} of ${product.name}`} type="number" inputMode="numeric" min={product.min_quantity} max={product.stock_quantity} step={1} value={quantity} disabled={unavailable} onChange={event=>changeQuantity(Number(event.target.value))}/><button type="button" aria-label={`Increase quantity of ${product.name}`} disabled={unavailable||quantity>=product.stock_quantity} onClick={()=>adjustQuantity(1)}><Plus size={15}/></button></div></div><button type="button" className="button button-dark card-cart-button" aria-label={`Add ${quantity} ${cases?'cases':'items'} of ${product.name} to cart`} disabled={unavailable} onClick={()=>onAdd(product,quantity)}><ShoppingBag size={17}/>{unavailable?'Sold out':'Add to cart'}</button></div>
        </div>
      </div>
    </article>
  )
}

function Storefront({ store, home, cart, onAdd, initialCategory, vatDisplayMode, onVatDisplayModeChange }: {
  store: StoreSettings; home: HomeSettings; cart: ReturnType<typeof useCart>; onAdd: (product: Product, quantity?: number) => void; initialCategory: string
  vatDisplayMode: VatDisplayMode; onVatDisplayModeChange: (mode: VatDisplayMode) => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('search') || '')
  const [brand,setBrand]=useState('')
  const [catalogueFilters,setCatalogueFilters]=useState<{categories:Category[];brands:string[]}>({categories:[],brands:[]})
  useEffect(()=>{api<typeof catalogueFilters>('/catalogue/filters').then(setCatalogueFilters).catch((e:Error)=>setError(e.message))},[])
  const [activeCategory, setCategory] = useState(initialCategory)
  const [sort, setSort] = useState('featured')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [resultCount, setResultCount] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {setCategory(initialCategory);setPage(1)}, [initialCategory])
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    setSort(params.get('sort') || 'featured')
    setQuery(params.get('search') || '')
    setPage(1)
  }, [location.search])
  useEffect(() => {
    let active=true
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const timer=window.setTimeout(()=>{api<{ products: Product[]; pages: number; total: number }>(`/products?search=${encodeURIComponent(query)}&brand=${encodeURIComponent(brand)}&category=${encodeURIComponent(activeCategory)}&sort=${sort}&page=${page}&limit=24`, { signal: controller.signal })
      .then((data) => { if(active){setProducts(data.products); setTotalPages(data.pages); setResultCount(data.total)} })
      .catch((reason: Error) => {if(active)setError(reason.message)})
      .finally(() => {if(active)setLoading(false)})},query?200:0)
    return ()=>{active=false;window.clearTimeout(timer);controller.abort()}
  }, [query, brand, activeCategory, sort, page])
  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const params = new URLSearchParams(location.search)
    if (query.trim()) params.set('search', query.trim()); else params.delete('search')
    navigate({ pathname: location.pathname, search: params.toString() })
    setPage(1)
  }
  const catalogTitle = query ? `Results for “${query}”` : activeCategory === 'All' ? home.featured_heading || 'The SipUp essentials' : `${catalogueFilters.categories.find(c=>c.slug===activeCategory)?.name || activeCategory}, sorted.`
  const changePage = (nextPage: number) => { setPage(nextPage); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }) }
  return (
    <>
      <Header store={store} count={cart.items.reduce((sum, item) => sum + item.quantity, 0)} />
      <main>
        {location.pathname === '/' && activeCategory === 'All' && page === 1 && !query && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <span className="eyebrow"><span className="eyebrow-dot" /> THE WHOLESALE EDIT</span>
                <h1>{home.hero_title.split('\n').map((line, index) => <span key={line}>{index === 1 ? <em>{line}</em> : line}{index === 0 && <br />}</span>)}</h1>
                <p>{home.hero_copy}</p>
                <div className="hero-actions"><Link to="/shop" className="button button-dark">Explore the shop <ArrowRight size={17} /></Link><span><ShieldCheck size={17} /> Straightforward wholesale</span></div>
                <div className="hero-note"><span>01</span><span>GOOD THINGS, IN STOCK</span><span className="hero-note-line" /></div>
              </div>
              <HomeHeroVisual image={home.hero_image} products={products} />
              <div className="hero-side-label">DRINKS · SNACKS · EVERYDAY FAVOURITES</div>
            </section>
            <div className="ticker"><span>{home.promo_message || 'Stock up on the good stuff'}</span><span>✳</span><span>Good things for your shelves</span><span>✳</span><span>{home.promo_message || 'Stock up on the good stuff'}</span></div>
            <section className="trust-strip"><div><Truck /><span>Delivery & collection<br /><small>Options at checkout</small></span></div><div><Box /><span>Wholesale ready<br /><small>Pack sizes shown clearly</small></span></div><div><BadgeCheck /><span>Simple ordering<br /><small>Bookings saved before handoff</small></span></div><div><CircleHelp /><span>Need a hand?<br /><small>Contact the SipUp team</small></span></div></section>
            <AisleSection categories={catalogueFilters.categories} renderSymbol={name => <CategorySymbol name={name} />} />
          </>
        )}
        <section className="shop-section section-wrap" id="products">
          <div className="section-heading"><div><span className="eyebrow">{query ? 'FIND YOUR FAVOURITES' : activeCategory === 'All' ? 'THE SIPUP LINE-UP' : 'TAKE A CLOSER LOOK'}</span>{location.pathname === '/' ? <h2>{catalogTitle}</h2> : <h1 className="catalog-title">{catalogTitle}</h1>}</div>
            <span className="results-count" aria-live="polite">{loading ? 'Finding your favourites…' : `${resultCount} ${resultCount === 1 ? 'product' : 'products'}${query ? ' found' : ' to explore'}`}</span>
          </div>
          <form className="catalog-tools" onSubmit={onSearch} role="search">
            <div className="search-field"><Search size={18} /><input type="search" aria-label="Search products" placeholder="Search products, brands or flavour…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} /><button type="submit" aria-label="Search catalogue">Search <ArrowRight size={15} /></button></div>
            <div className="category-pills"><button type="button" className={activeCategory==='All'?'category-pill active':'category-pill'} onClick={()=>{setCategory('All');setPage(1)}}>All</button>{catalogueFilters.categories.filter(c=>!c.parent_id && Number(c.product_count)>0).map((category) => <button type="button" key={category.id} className={activeCategory === category.slug ? 'category-pill active' : 'category-pill'} onClick={() => { setCategory(category.slug); setPage(1) }}>{category.name}</button>)}</div>
            <label className="sort-select"><span>Brand</span><select value={brand} onChange={e=>{setBrand(e.target.value);setPage(1)}}><option value="">All brands</option>{catalogueFilters.brands.map(b=><option key={b}>{b}</option>)}</select></label>
            <label className="sort-select"><span>Category / subcategory</span><select value={activeCategory} onChange={e=>{setCategory(e.target.value);setPage(1)}}><option value="All">All products</option>{catalogueFilters.categories.filter(c=>Number(c.product_count)>0).map(c=><option key={c.id} value={c.slug}>{c.parent_id?`${catalogueFilters.categories.find(p=>p.id===c.parent_id)?.name} / `:''}{c.name}</option>)}</select></label>
            <div className="catalog-price-tools">
              <div className="vat-toggle" role="group" aria-label="Product price display">
                <button type="button" aria-pressed={vatDisplayMode === 'exclusive'} className={vatDisplayMode === 'exclusive' ? 'active' : ''} onClick={() => onVatDisplayModeChange('exclusive')}>Ex. VAT</button>
                <button type="button" aria-pressed={vatDisplayMode === 'inclusive'} className={vatDisplayMode === 'inclusive' ? 'active' : ''} onClick={() => onVatDisplayModeChange('inclusive')}>Inc. VAT</button>
              </div>
              <label className="sort-select"><span>Sort</span><select value={sort} onChange={(event) => {setSort(event.target.value);setPage(1)}}><option value="featured">Featured</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="newest">Newest</option></select><ChevronDown size={15} /></label>
            </div>
          </form>
          {error && <div className="inline-error">{error}<button onClick={() => window.location.reload()}>Try again</button></div>}
          {loading ? <div className="product-grid">{[1, 2, 3, 4].map((key) => <div className="skeleton-card" key={key}><div /><span /><span /></div>)}</div>
            : error ? null
            : products.length ? <div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} onAdd={onAdd} vatDisplayMode={vatDisplayMode} />)}</div>
              : <div className="empty-state"><Package size={27} /><h3>No products found</h3><p>Try a different search or explore another aisle.</p><button className="button button-dark" onClick={() => { setQuery(''); setBrand(''); setCategory('All'); setPage(1); navigate('/shop') }}>Clear filters</button></div>}
          {totalPages > 1 && <div className="pagination"><button disabled={page === 1} onClick={() => changePage(page - 1)}><ArrowLeft size={15} /> Previous</button><span>Page {page} of {totalPages}</span><button disabled={page === totalPages} onClick={() => changePage(page + 1)}>Next <ArrowRight size={15} /></button></div>}
        </section>
        {activeCategory === 'All' && <section className="wholesale-band"><div className="wholesale-art"><img src="/wholesale-unlabelled-drinks.webp" alt="" loading="lazy" onError={(event) => { event.currentTarget.src = '/sipup-product.svg' }} /><span>GOOD<br />STOCK<br /><b>CLUB</b></span></div><div className="wholesale-copy"><span className="eyebrow">A LITTLE MORE SIPUP</span><h2>Good things<br />come in <em>cases.</em></h2><p>Shop the multi-packs and everyday bestsellers your customers love. Browse the range, build your basket and send your order request in a few easy steps.</p><Link to="/shop" className="button button-lime">Browse wholesale <ArrowRight size={17} /></Link></div><span className="band-doodle">✳</span></section>}
      </main>
      <Footer store={store} />
    </>
  )
}

function CategoryRoute(props: Omit<Parameters<typeof Storefront>[0], 'initialCategory'>) {
  const { category } = useParams()
  return <Storefront {...props} initialCategory={category || 'All'} />
}

function ProductPage({ store, cart, onAdd, vatDisplayMode }: {
  store: StoreSettings; cart: ReturnType<typeof useCart>
  onAdd: (product: Product, quantity?: number) => void; vatDisplayMode: VatDisplayMode
}) {
  const { slug } = useParams()
  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setProduct(null)
    setError('')
    api<Product>('/products/' + encodeURIComponent(slug || ''), { signal: controller.signal })
      .then(setProduct)
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [slug])
  return <><Header store={store} count={cart.items.reduce((sum, item) => sum + item.quantity, 0)} />
    {error ? <main className="empty-state page-empty"><Package size={32} /><h1>Product not found</h1><p>{error}</p><Link to="/shop" className="button button-dark">Back to shop <ArrowRight size={17} /></Link></main>
      : product ? <ProductDetailContent key={product.id} product={product} store={store} onAdd={onAdd} vatDisplayMode={vatDisplayMode} />
      : <main className="pdp-loading section-wrap" aria-busy="true" aria-label="Loading product"><div className="pdp-loading-image" /><div><span /><span /><span /><p>Getting the good stuff ready?</p></div></main>}
    <Footer store={store} /></>
}

function CartPage({ store, cart, vatDisplayMode }: {
  store: StoreSettings; cart: ReturnType<typeof useCart>; vatDisplayMode: VatDisplayMode
}) {
  const subtotal = cart.items.reduce((sum, item) => sum + unitPriceFor(item.product, item.quantity) * item.quantity, 0)
  const vat = cart.items.reduce((sum, { product, quantity }) => sum + (product.vat_confirmed && product.vat_treatment
    ? calculateLine(unitPriceFor(product, quantity), quantity, product.vat_treatment).vatPence : 0), 0)
  const allClassified = cart.items.every(({ product }) => product.vat_confirmed && product.vat_treatment)
  return <><Header store={store} count={cart.items.reduce((sum, item) => sum + item.quantity, 0)} /><main className="section-wrap cart-page">
    <div className="page-title"><span className="eyebrow">YOUR SELECTION</span><h1>Your bag<span className="brand-dot">.</span></h1><p>{cart.items.length ? `${cart.items.length} lovely ${cart.items.length === 1 ? 'thing' : 'things'} picked out` : 'A good order starts here.'}</p></div>
    {!cart.items.length ? <div className="empty-state"><ShoppingBag size={29} /><h3>Your bag is taking a little breather</h3><p>Have a look around and add some favourites.</p><Link to="/shop" className="button button-dark">Explore the shop <ArrowRight size={16} /></Link></div>
      : <div className="cart-grid"><div className="cart-list">{cart.items.map(({ product, quantity }) => <div className="cart-row" key={product.id}>
        <Link to={`/product/${product.slug}`} className="cart-thumb"><ProductImage src={product.image_url || imageFallback} alt="" /></Link>
        <div className="cart-row-info"><Link to={`/product/${product.slug}`}>{product.name}</Link><small>{product.pack_size} · {product.sku}</small><span>{formatMoney(displayedPrice(unitPriceFor(product, quantity), product.vat_treatment, vatDisplayMode))} each · {vatDisplayMode === 'inclusive' ? 'inc. VAT' : 'ex. VAT'}</span></div>
        <div className="quantity-control"><button aria-label="Decrease quantity" onClick={() => cart.setQuantity(product.id, quantity - 1)}><Minus size={15} /></button><span>{quantity}</span><button aria-label="Increase quantity" onClick={() => cart.setQuantity(product.id, quantity + 1)}><Plus size={15} /></button></div>
        <strong className="cart-line-price">{formatMoney(displayedLinePrice(unitPriceFor(product, quantity), quantity, product.vat_treatment, vatDisplayMode))}</strong><button className="remove-btn" aria-label={`Remove ${product.name}`} onClick={() => cart.remove(product.id)}><X size={16} /></button>
      </div>)}<Link to="/shop" className="text-link continue-link"><ArrowLeft size={15} /> Continue shopping</Link></div>
      <aside className="order-summary"><h2>Order summary</h2><div><span>Product subtotal (ex. VAT)</span><strong>{formatMoney(subtotal)}</strong></div><div><span>Product VAT</span><strong>{formatMoney(vat)}</strong></div><div><span>Delivery</span><span>Calculated at checkout</span></div><hr /><div className="summary-total"><span>Estimated total (inc. VAT)</span><strong>{formatMoney(subtotal + vat)}</strong></div>{!allClassified && <p className="inline-error">A product in your saved basket needs VAT review before checkout.</p>}<p className="summary-note">Delivery VAT, if applicable, is confirmed at checkout.</p><Link aria-disabled={!allClassified} onClick={(event) => { if (!allClassified) event.preventDefault() }} to="/checkout" className={`button button-dark button-wide${allClassified ? '' : ' disabled-link'}`}>Continue to checkout <ArrowRight size={16} /></Link><p className="summary-secure"><ShieldCheck size={15} /> Your order request is recorded securely</p></aside></div>}
  </main><Footer store={store} /></>
}

function CheckoutPage({ store, cart }: { store: StoreSettings; cart: ReturnType<typeof useCart> }) {
  const navigate = useNavigate()
  const [preference, setPreference] = useState<'delivery' | 'collection'>('delivery')
  const [customerAccount, setCustomerAccount] = useState<CustomerAccount | null>(null)
  const [checkingAccount, setCheckingAccount] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [quote, setQuote] = useState<CheckoutQuote | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteReload, setQuoteReload] = useState(0)
  useEffect(() => {
    let active = true
    setQuote(null)
    setQuoteError('')
    if (!cart.items.length) return () => { active = false }
    setQuoteLoading(true)
    api<CheckoutQuote>('/checkout/preview', { method: 'POST', body: JSON.stringify({
      customer: { preference },
      items: cart.items.map(({ product, quantity }) => ({ productId: product.id, quantity })),
    }) })
      .then((nextQuote) => { if (active) setQuote(nextQuote) })
      .catch((reason: Error) => { if (active) setQuoteError(reason.message) })
      .finally(() => { if (active) setQuoteLoading(false) })
    return () => { active = false }
  }, [cart.items, preference, quoteReload])
  useEffect(() => {
    api<{ customer: CustomerAccount }>('/account/me')
      .then(({ customer }) => setCustomerAccount(customer))
      .catch(() => setCustomerAccount(null))
      .finally(() => setCheckingAccount(false))
  }, [])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const customer = {
      address: String(form.get('address') || '').trim(),
      postcode: String(form.get('postcode') || '').trim(),
      preference,
      notes: String(form.get('notes') || '').trim(),
    }
    try {
      if (!quote) throw new Error('Wait for the latest server price and VAT summary before placing the booking.')
      const keyName = 'sipup-checkout-key'
      const requestKey = sessionStorage.getItem(keyName) || crypto.randomUUID()
      sessionStorage.setItem(keyName, requestKey)
      const order = await api<SavedOrder>('/orders', { method: 'POST', headers: { 'Idempotency-Key': requestKey }, body: JSON.stringify({
        customer, items: cart.items.map(({ product, quantity }) => ({ productId: product.id, quantity })),
        expected_total_pence: quote.total_pence,
      }) })
      sessionStorage.setItem(`sipup-order-${order.reference}`, JSON.stringify(order))
      sessionStorage.removeItem(keyName)
      cart.clear()
      navigate(`/order-confirmation/${order.reference}`)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'We could not save your order. Please try again.'
      setError(message)
      if (message.startsWith('Prices or tax changed')) setQuoteReload((revision) => revision + 1)
    }
    finally { setBusy(false) }
  }
  if (!cart.items.length) return <><Header store={store} count={0} /><div className="empty-state page-empty"><ShoppingBag size={28} /><h2>Your bag is empty</h2><p>Add a few favourites before checkout.</p><Link to="/shop" className="button button-dark">Back to the shop</Link></div><Footer store={store} /></>
  if (checkingAccount) return <><Header store={store} count={cart.items.length} /><div className="page-loading">Checking your SipUp account...</div><Footer store={store} /></>
  if (!customerAccount) return <><Header store={store} count={cart.items.length} /><main className="section-wrap account-gate"><span className="eyebrow">ACCOUNT REQUIRED</span><h1>Your order starts with <em>you.</em></h1><p>Create a free SipUp customer account or sign in to book products. Your basket will be ready when you return.</p><div className="account-gate-actions"><Link to="/account/register?redirect=%2Fcheckout" className="button button-dark">Create your account <ArrowRight size={16} /></Link><Link to="/account/login?redirect=%2Fcheckout" className="button button-outline">I already have an account</Link></div><Link to="/cart" className="text-link"><ArrowLeft size={15} /> Back to your bag</Link></main><Footer store={store} /></>
  return <><Header store={store} count={cart.items.reduce((sum, item) => sum + item.quantity, 0)} /><main className="section-wrap checkout-page">
    <div className="breadcrumbs"><Link to="/cart">Your bag</Link><ChevronRight size={13} /><span>Checkout</span></div><div className="page-title checkout-title"><span className="eyebrow">ALMOST THERE</span><h1>Let's make it <em>official.</em></h1><p>Your booking request is saved securely before you head to WhatsApp.</p><p className="checkout-account-note">Signed in as <strong>{customerAccount.name}</strong> · <Link to="/account">{customerAccount.email}</Link></p></div>
    <form className="checkout-grid" onSubmit={submit}><div className="checkout-fields">
      <section className="form-card"><div className="form-section-heading"><span>01</span><div><h2>Your details</h2><p>So we know who to thank.</p></div></div>
        <div className="form-row"><label>Full name<input value={customerAccount.name} readOnly /></label><label>Mobile / WhatsApp<input value={customerAccount.phone} readOnly /></label></div>
        <label>Email address<input value={customerAccount.email} readOnly /></label>
      </section>
      <section className="form-card"><div className="form-section-heading"><span>02</span><div><h2>How shall we get it to you?</h2><p>Choose what works best.</p></div></div>
        <div className="choice-cards"><label className={preference === 'delivery' ? 'choice-card selected' : 'choice-card'}><input type="radio" name="preference" checked={preference === 'delivery'} onChange={() => setPreference('delivery')} /><Truck size={19} /><span><b>Delivery</b><small>To your door</small></span><i /></label><label className={preference === 'collection' ? 'choice-card selected' : 'choice-card'}><input type="radio" name="preference" checked={preference === 'collection'} onChange={() => setPreference('collection')} /><ShoppingBag size={19} /><span><b>Collection</b><small>Arrange with our team</small></span><i /></label></div>
        {preference === 'delivery' && <><label>Delivery address <textarea name="address" required rows={3} maxLength={300} autoComplete="street-address" placeholder="Building, street and town" /></label><label>UK postcode <input name="postcode" required maxLength={16} autoComplete="postal-code" placeholder="e.g. SW1A 1AA" /></label></>}
        <label>Order notes <span className="optional">(optional)</span><textarea name="notes" rows={2} maxLength={1000} placeholder="Anything else we should know?" /></label>
      </section>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div><aside className="order-summary checkout-summary"><h2>Your order</h2>
      {quoteLoading && <p className="summary-note" aria-live="polite">Refreshing server-side prices and VAT...</p>}
      {quoteError && <p className="inline-error" role="alert">{quoteError}</p>}
      {quote?.items.map((item) => {
        const image = cart.items.find(({ product }) => product.id === item.product_id)?.product.image_url || imageFallback
        return <div className="summary-product" key={item.product_id}><ProductImage src={image} alt="" /><span>{item.name}<small>Qty {item.quantity} · {vatTreatmentName(item.vat_treatment)}</small></span><strong>{formatMoney(item.line_gross_pence)}</strong></div>
      })}
      <hr /><div><span>Product subtotal (ex. VAT)</span><strong>{formatMoney(quote?.subtotal_pence ?? 0)}</strong></div>
      {quote?.vat_breakdowns.map((row, index) => <div key={`${row.vat_treatment}-${row.vat_rate}-${row.is_delivery}-${index}`}><span>{vatTreatmentName(row.vat_treatment)}{row.is_delivery ? ' delivery' : ''} VAT</span><strong>{formatMoney(row.vat_pence)}</strong></div>)}
      <div><span>Delivery (ex. VAT)</span><strong>{formatMoney(quote?.delivery_pence ?? 0)}</strong></div>
      <div><span>Total VAT</span><strong>{formatMoney(quote?.vat_pence ?? 0)}</strong></div>
      <hr /><div className="summary-total"><span>Total payable (inc. VAT)</span><strong>{formatMoney(quote?.total_pence ?? 0)}</strong></div>
      <p className="summary-note">This total is calculated by the server from current product prices and confirmed classifications. The storefront price switch does not change it.</p>
      <button className="button button-dark button-wide" disabled={busy || quoteLoading || !quote || Boolean(quoteError)}>{busy ? 'Saving your booking...' : <>Save booking & continue <ArrowRight size={16} /></>}</button><p className="summary-secure"><LockKeyhole size={15} /> Your booking is saved before WhatsApp opens</p></aside></form>
  </main><Footer store={store} /></>
}

function AccountPage({ mode }: { mode: 'login' | 'register' | 'account' }) {
  const shopper = useContext(ShopperSession)
  const location = useLocation()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState<CustomerAccount | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const redirectParam = new URLSearchParams(location.search).get('redirect')
  const redirectTo = safeStorefrontRedirect(redirectParam)
  const addingToBag = new URLSearchParams(location.search).get('reason') === 'bag'

  useEffect(() => {
    setChecking(true)
    api<{ customer: CustomerAccount }>('/account/me')
      .then(({ customer: saved }) => setCustomer(saved))
      .catch(() => setCustomer(null))
      .finally(() => setChecking(false))
  }, [location.pathname])

  useEffect(() => {
    if (mode === 'account' && customer) {
      api<{ orders: Order[] }>('/account/orders')
        .then((result) => setOrders(result.orders))
        .catch((reason: Error) => setError(reason.message))
    }
  }, [mode, customer])

  useEffect(() => {
    if (customer && mode !== 'account') navigate(redirectTo, { replace: true })
  }, [customer, mode, navigate, redirectTo])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const path = mode === 'register' ? '/account/register' : '/account/login'
      const body = mode === 'register'
        ? { name: name.trim(), phone: phone.trim(), email: email.trim(), password }
        : { email: email.trim(), password }
      const result = await api<{ customer: CustomerAccount }>(path, { method: 'POST', body: JSON.stringify(body) })
      setCustomer(result.customer)
      shopper.setCustomer(result.customer)
      navigate(redirectTo, { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'We could not sign you in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    setBusy(true)
    setError('')
    try {
      await api('/account/logout', { method: 'POST' })
      setCustomer(null)
      shopper.setCustomer(null)
      setOrders([])
      navigate('/account/login', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign out.')
    } finally {
      setBusy(false)
    }
  }

  if (checking) return <main className="login-page"><div className="page-loading">Checking your SipUp account...</div></main>

  if (mode === 'account' && customer) return <main className="account-page section-wrap">
    <Link to="/" className="brand account-page-brand"><BrandLogo /></Link>
    <div className="account-page-heading"><div><span className="eyebrow">YOUR SIPUP ACCOUNT</span><h1>Welcome, {customer.name.split(' ')[0]}<span className="brand-dot">.</span></h1><p>{customer.email} · {customer.phone}</p></div><button className="button button-outline" onClick={logout} disabled={busy}><LogOut size={15} /> Sign out</button></div>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <section className="admin-panel account-orders"><div className="panel-heading"><div><h2>Your bookings</h2><p>Order updates and saved booking requests.</p></div><ShoppingBag size={18} /></div>
      {orders.length ? <div className="table-wrap"><table><thead><tr><th>REFERENCE</th><th>DATE</th><th>STATUS</th><th>ORDER TOTAL</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.reference}</strong></td><td>{new Date(order.created_at).toLocaleDateString('en-GB')}</td><td><span className={`status-badge status-${order.status}`}>{order.status}</span></td><td>{formatMoney(order.total_pence)}</td></tr>)}</tbody></table></div> : <div className="admin-empty">Your bookings will appear here once you place your first order.</div>}
    </section>
    <Link to="/shop" className="button button-dark account-shop-link">Browse the shop <ArrowRight size={16} /></Link>
  </main>

  if (mode === 'account') return <main className="login-page"><Link to="/" className="brand login-brand"><BrandLogo /></Link><div className="login-card account-choice"><div className="login-icon"><LockKeyhole size={22} /></div><span className="eyebrow">YOUR SIPUP ACCOUNT</span><h1>Book with<br /><em>confidence.</em></h1><p>Create an account or sign in to place an order and keep track of your bookings.</p><Link to="/account/register" className="button button-dark button-wide">Create a free account <ArrowRight size={16} /></Link><Link to="/account/login" className="button button-outline button-wide">I already have an account</Link><Link to="/" className="text-link login-back"><ArrowLeft size={15} /> Return to storefront</Link></div></main>

  if (customer) return null
  const registering = mode === 'register'
  return <main className="login-page"><Link to="/" className="brand login-brand"><BrandLogo /></Link><div className="login-card"><div className="login-icon"><LockKeyhole size={22} /></div><span className="eyebrow">{registering ? 'JOIN SIPUP' : 'CUSTOMER & STORE SIGN IN'}</span><h1>{registering ? <>Make it<br /><em>official.</em></> : <>Good to have<br />you <em>back.</em></>}</h1><p>{registering ? 'Create your free customer or store account to order and follow your bookings.' : addingToBag ? 'Sign in to add this product to your bag. Your product and quantity will be ready after sign-in.' : 'Sign in with your customer or store account to continue shopping.'}</p>
    <form onSubmit={submit}>
      {registering && <><label>Full name<input autoComplete="name" required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></label><label>Mobile / WhatsApp<input autoComplete="tel" type="tel" required minLength={7} maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+44 ..." /></label></>}
      <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      <label>Password<div className="password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} required minLength={registering ? 10 : 1} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={registering ? 'At least 10 characters' : ''} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
      {error && <div className="inline-error" role="alert">{error}</div>}<button className="button button-dark button-wide" disabled={busy}>{busy ? 'Please wait...' : <>{registering ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></>}</button>
    </form>
    <div className="login-security"><ShieldCheck size={15} /> Your account and bookings are stored securely</div>
    <p className="account-mode-switch">{registering ? 'Already have an account?' : 'New to SipUp?'} <Link to={`/account/${registering ? 'login' : 'register'}${location.search}`}>{registering ? 'Sign in' : 'Create an account'}</Link></p>
    <Link to="/shop" className="text-link login-back"><ArrowLeft size={15} /> Return to storefront</Link>
  </div></main>
}

function ConfirmationPage({ store }: { store: StoreSettings }) {
  const { reference = '' } = useParams()
  const [order, setOrder] = useState<SavedOrder | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    try { setOrder(JSON.parse(sessionStorage.getItem(`sipup-order-${reference}`) || 'null')) } catch { setOrder(null) }
  }, [reference])
  const message = useMemo(() => {
    if (!order) return ''
    const lines = [
      `Hello ${store.name || 'SipUp'}, I'd like to follow up on booking ${order.reference}.`,
      '', ...order.items.map((item) => `${item.name} (${item.sku}) × ${item.quantity} — net ${formatMoney(item.line_total_pence)}${item.line_vat_pence == null ? '' : `, VAT ${formatMoney(item.line_vat_pence)}, gross ${formatMoney(item.line_gross_pence ?? item.line_total_pence)}`}`),
      '', `Subtotal ex. VAT: ${formatMoney(order.subtotal_pence)}`,
      `VAT: ${formatMoney(order.vat_pence)}`,
      `Delivery ex. VAT: ${formatMoney(order.delivery_pence)}`,
      `Delivery VAT: ${formatMoney(order.delivery_vat_pence || 0)}`,
      `Total: ${formatMoney(order.total_pence)}`,
      '', `Name: ${order.customer.name}`, `Phone: ${order.customer.phone}`,
      order.customer.email ? `Email: ${order.customer.email}` : '',
      order.customer.preference === 'delivery' ? `Address: ${order.customer.address}, ${order.customer.postcode}` : 'Preference: Collection',
      order.customer.notes ? `Notes: ${order.customer.notes}` : '',
    ].filter(Boolean)
    return lines.join('\n')
  }, [order, store.name])
  const openWhatsApp = () => {
    const number = store.whatsapp_number.replace(/\D/g, '')
    if (!number) return
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }
  const copyMessage = async () => {
    await navigator.clipboard.writeText(message)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2200)
  }
  return <><Header store={store} count={0} /><main className="confirmation-wrap">
    <div className="confirmation-card"><div className="confirmation-icon"><Check size={30} /></div><span className="eyebrow">BOOKING REQUEST SAVED</span><h1>One good thing<br />at a <em>time.</em></h1><p className="confirmation-lead">Your order request is safely recorded. To get things moving, send the details to our team on WhatsApp.</p><div className="reference-box"><span>YOUR BOOKING REFERENCE</span><strong>{reference}</strong><small>Saved in SipUp · {new Date().toLocaleDateString('en-GB')}</small></div>
      {order && <div className="confirmation-total"><span>{order.items.length} line {order.items.length === 1 ? 'item' : 'items'}</span><strong>{formatMoney(order.total_pence)}</strong></div>}
      {store.whatsapp_number ? <button className="button button-whatsapp button-wide" onClick={openWhatsApp}><Zap size={17} /> Continue in WhatsApp <ExternalLink size={15} /></button>
        : <div className="inline-note"><CircleHelp size={17} /> The store hasn't configured a WhatsApp number yet. Your booking is saved; please contact the business using the details in the footer.</div>}
      {order && store.whatsapp_number && <button className="copy-message" onClick={copyMessage}>{copied ? <Check size={15} /> : <Download size={15} />}{copied ? 'Message copied' : 'Copy order message instead'}</button>}
      <p className="confirmation-warning">This is a booking request, not a confirmed order or payment. The business will confirm availability and next steps separately.</p>
      <Link to="/shop" className="text-link">Back to the shop <ArrowRight size={15} /></Link></div>
  </main><Footer store={store} /></>
}

function LegalPage({ store }: { store: StoreSettings }) {
  const { legal = 'information' } = useParams()
  const titles: Record<string, string> = { terms: 'Terms & conditions', privacy: 'Privacy policy', cookies: 'Cookie policy', delivery: 'Delivery & shipping', returns: 'Returns & refunds', contact: 'Contact information' }
  const title = titles[legal] || 'Store information'
  return <><Header store={store} count={0} /><main className="legal-page section-wrap"><span className="eyebrow">SIPUP INFORMATION</span><h1>{title}<span className="brand-dot">.</span></h1><div className="legal-callout"><CircleHelp size={20} /><p>This page is ready for the business owner to review and complete before launch. SipUp does not invent legal, tax, delivery or returns terms. Please add accurate, approved information here through a future content-management update.</p></div>
    {legal === 'contact' && <div className="legal-contact">{store.email && <p>Email: <a href={`mailto:${store.email}`}>{store.email}</a></p>}{store.phone && <p>Telephone: <a href={`tel:${store.phone}`}>{store.phone}</a></p>}{store.address && <p>Address: {store.address}</p>}{store.business_hours && <p>Business hours: {store.business_hours}</p>}</div>}
    <Link to="/shop" className="text-link">Back to the shop <ArrowRight size={15} /></Link></main><Footer store={store} /></>
}

function AdminApp() {
  const { store } = useStore()
  const location = useLocation()
  const [adminEmail, setAdminEmail] = useState('')
  const [checking, setChecking] = useState(true)
  const [sessionError, setSessionError] = useState('')
  const [sessionAttempt, setSessionAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setSessionError('')
    api<{ admin: { email: string } }>('/auth/me', { signal: controller.signal })
      .then(({ admin }) => { if (!controller.signal.aborted) setAdminEmail(admin.email) })
      .catch((error: Error) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 401) setAdminEmail('')
        else setSessionError(error.message)
      }).finally(() => { if (!controller.signal.aborted) setChecking(false) })
    return () => controller.abort()
  }, [location.pathname, sessionAttempt])
  if (location.pathname === '/admin/login') return <AdminLogin />
  if (checking) return <div className="page-loading">Checking your secure session...</div>
  if (sessionError && !adminEmail) return <div className="page-empty" role="alert"><h1>Unable to load the admin panel</h1><p>{sessionError}</p><button className="button button-dark" onClick={() => { setChecking(true); setSessionAttempt(value => value + 1) }}>Try again</button></div>
  if (!adminEmail) return <AdminLogin />
  return <>{sessionError && <div className="inline-error" role="alert">{sessionError} <button className="text-link" onClick={() => setSessionAttempt(value => value + 1)}>Retry session check</button></div>}<AdminLayout email={adminEmail} store={store} /></>
}

function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try { await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); window.location.assign('/admin') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Sign in failed.') }
    finally { setBusy(false) }
  }
  return <main className="login-page"><Link to="/" className="brand login-brand"><BrandLogo /></Link><div className="login-card"><div className="login-icon"><LockKeyhole size={22} /></div><span className="eyebrow">SIPUP BUSINESS</span><h1>Good to have<br />you <em>back.</em></h1><p>Sign in to manage your shop and bookings.</p>
    <form onSubmit={submit}><label>Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="owner@example.com" /></label><label>Password<div className="password-wrap"><input type={visible ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>{error && <div className="inline-error" role="alert">{error}</div>}<button className="button button-dark button-wide" disabled={busy}>{busy ? 'Signing in...' : <>Sign in <ArrowRight size={16} /></>}</button></form>
    <div className="login-security"><ShieldCheck size={15} /> Protected with secure server-side sign in</div><Link to="/" className="text-link login-back"><ArrowLeft size={15} /> Return to storefront</Link></div></main>
}

function AdminLayout({ email, store }: { email: string; store: StoreSettings }) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); navigate('/admin/login') }
  const nav = [
    { to: '/admin', title: 'Dashboard', icon: LayoutDashboard, exact: true },
    { to: '/admin/orders', title: 'Orders', icon: ShoppingCart },
    { to: '/admin/products', title: 'Products', icon: Package },
    { to: '/admin/import-history', title: 'Import history', icon: Download },
    { to: '/admin/categories', title: 'Categories', icon: Box },
    { to: '/admin/vat-pricing', title: 'VAT & Pricing', icon: BadgeCheck },
    { to: '/admin/customers', title: 'Customers', icon: ShoppingBag },
    { to: '/admin/delivery', title: 'Delivery & Collection', icon: Truck },
    { to: '/admin/reports', title: 'Reports', icon: Download },
    { to: '/admin/settings', title: 'Settings', icon: Settings },
  ]
  return <div className="admin-shell"><aside className={`admin-sidebar ${menuOpen ? 'menu-open' : ''}`}><Link to="/" className="brand admin-brand"><BrandLogo /><span className="admin-badge">ADMIN</span></Link><span className="sidebar-label">WORKSPACE</span><nav>{nav.map(({ to, title, icon: Icon, exact }) => <NavLink end={exact} to={to} key={to} onClick={() => setMenuOpen(false)}><Icon size={18} />{title}{title === 'Orders' && <ChevronRight className="nav-chevron" size={15} />}</NavLink>)}</nav><div className="sidebar-bottom"><div className="sidebar-user"><div className="user-avatar">{email.slice(0, 1).toUpperCase()}</div><span><strong>{email}</strong><small>Store admin</small></span></div><button onClick={logout}><LogOut size={17} /> Sign out</button></div></aside>
    <div className="admin-main"><header className="admin-topbar"><button className="icon-btn admin-mobile-toggle" aria-label="Toggle menu" onClick={() => setMenuOpen(!menuOpen)}><Menu /></button><div><span>Workspace</span><ChevronRight size={13} /><b>{store.name}</b></div><Link to="/" target="_blank" rel="noreferrer" className="view-store-link">View storefront <ArrowUpRight size={15} /></Link></header>
      <div className="admin-content"><Routes><Route index element={<Dashboard />} /><Route path="orders" element={<OrdersAdmin />} /><Route path="products" element={<ProductsAdmin />} /><Route path="import-history" element={<ImportHistoryAdmin />} /><Route path="categories" element={<CategoriesAdmin />} /><Route path="customers" element={<CustomersAdmin />} /><Route path="delivery" element={<SettingsAdmin deliveryPage />} /><Route path="reports" element={<VatPricingAdmin reportPage />} /><Route path="vat-pricing" element={<VatPricingAdmin />} /><Route path="settings" element={<SettingsAdmin />} /><Route path="*" element={<Dashboard />} /></Routes></div>
    </div></div>
}

type Category = { id: number; name: string; slug: string; description: string; parent_id?:number|null; sort_order?:number; product_count?:number }

function ImportHistoryAdmin() {
  const [imports,setImports]=useState<Array<{id:number;action:string;created_at:string;details:{created?:number;preserved?:number;failed?:number;approvalDigest?:string;count?:number}}>>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  useEffect(()=>{api<{imports:typeof imports}>('/admin/import-history').then(r=>setImports(r.imports)).catch((e:Error)=>setError(e.message)).finally(()=>setLoading(false))},[])
  return <div><div className="admin-page-heading"><div><span className="eyebrow">CATALOGUE AUDIT</span><h1>Import history.</h1><p>Committed imports and catalogue archival actions recorded in MySQL.</p></div></div>{error&&<div role="alert" className="inline-error">{error}</div>}{loading?<p>Loading import history...</p>:<section className="admin-panel table-wrap"><table><thead><tr><th>DATE</th><th>ACTION</th><th>CREATED</th><th>PRESERVED</th><th>FAILED</th><th>PREVIEW</th></tr></thead><tbody>{imports.map(r=><tr key={r.id}><td>{new Date(r.created_at).toLocaleString('en-GB')}</td><td>{r.action.replaceAll('_',' ')}</td><td>{r.details.created??'—'}</td><td>{r.details.preserved??r.details.count??'—'}</td><td>{r.details.failed??'—'}</td><td><code>{r.details.approvalDigest?.slice(0,16)||'—'}</code></td></tr>)}</tbody></table>{!imports.length&&<p className="admin-empty">No committed catalogue imports yet. Dry runs do not write import history.</p>}</section>}</div>
}

function CategoriesAdmin() {
  const [categories, setCategories] = useState<Category[]>([])
  const [editing,setEditing]=useState<Category|null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => api<{ categories: Category[] }>('/admin/categories').then((r) => setCategories(r.categories)).catch((e: Error) => setError(e.message))
  useEffect(() => { load() }, [])
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; setBusy(true); setError('')
    const data=new FormData(form)
    try { await api(editing?`/admin/categories/${editing.id}`:'/admin/categories', { method: editing?'PUT':'POST', body: JSON.stringify({ name:data.get('name'), parent_id:data.get('parent_id')?Number(data.get('parent_id')):null, description:data.get('description'), sort_order:Number(data.get('sort_order')) }) }); form.reset(); setEditing(null); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not create category.') }
    finally { setBusy(false) }
  }
  return <div><div className="admin-page-heading"><div><span className="eyebrow">CATALOGUE ORGANISATION</span><h1>Categories.</h1><p>Categories organise products. Each product needs its own confirmed VAT treatment.</p></div></div>
    {error && <div role="alert" className="inline-error">{error}</div>}
    <form key={editing?.id||'new'} className="admin-panel settings-form" onSubmit={create}><h2>{editing?'Edit category':'Add category or subcategory'}</h2><label>Name<input name="name" defaultValue={editing?.name||''} required maxLength={100} /></label><label>Parent category<select name="parent_id" defaultValue={editing?.parent_id||''}><option value="">None (main category)</option>{categories.filter(c=>c.id!==editing?.id).map(c=><option key={c.id} value={c.id}>{c.parent_id?`${categories.find(p=>p.id===c.parent_id)?.name} / `:''}{c.name}</option>)}</select></label><label>Description<input name="description" maxLength={500} defaultValue={editing?.description||''}/></label><label>Display order<input type="number" name="sort_order" min={0} max={10000} defaultValue={editing?.sort_order||0}/></label><button className="button button-dark" disabled={busy}>{editing?'Save category':'Add category'}</button>{editing&&<button type="button" className="button button-outline" onClick={()=>setEditing(null)}>Cancel</button>}</form>
    <section className="admin-panel"><div className="table-wrap"><table><thead><tr><th>CATEGORY</th><th>PARENT</th><th>LIVE PRODUCTS</th><th></th></tr></thead><tbody>{categories.map((c) => <tr key={c.id}><td>{c.name}</td><td>{categories.find(p=>p.id===c.parent_id)?.name||'Main category'}</td><td>{c.product_count}</td><td><button className="text-link" onClick={()=>setEditing(c)}>Edit</button></td></tr>)}</tbody></table></div></section></div>
}

function CustomersAdmin() {
  const [customers, setCustomers] = useState<Array<{ id: number; name: string; phone: string; email: string; order_count: number; order_value_pence: number }>>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    api<{ customers: typeof customers }>('/admin/customers', { signal: controller.signal })
      .then((r) => { if (!controller.signal.aborted) setCustomers(r.customers) })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [attempt])
  return <div><div className="admin-page-heading"><div><span className="eyebrow">CUSTOMER DIRECTORY</span><h1>Customers.</h1><p>Latest 500 customers, with booking values including all order statuses.</p></div></div>
    <div className="admin-search"><Search size={17} /><input aria-label="Search customers" placeholder="Search name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
    {error && <div role="alert" className="inline-error">{error} <button className="text-link" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}{loading ? <p>Loading customers...</p> : <section className="admin-panel"><div className="table-wrap"><table><thead><tr><th>CUSTOMER</th><th>CONTACT</th><th>BOOKINGS</th><th>BOOKING VALUE</th></tr></thead><tbody>{customers.filter((c) => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(search.toLowerCase())).map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.phone}<small>{c.email}</small></td><td>{c.order_count}</td><td>{formatMoney(c.order_value_pence)}</td></tr>)}</tbody></table>{!error && !customers.length && <p className="admin-empty">No customers yet.</p>}</div></section>}</div>
}

type RefundSource = { source: string; name: string; quantity: number; refunded_quantity: number; netPence: number; vatPence: number; vat_treatment: Product['vat_treatment'] }

function RefundForm({ orderId, paidPence, sources, onSaved }: { orderId: number; paidPence: number; sources: RefundSource[]; onSaved: () => Promise<void> }) {
  const [sourceId, setSourceId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const available = sources.filter((s) => s.quantity > s.refunded_quantity)
  const source = available.find((s) => s.source === sourceId) || available[0]
  const validQuantity = source && quantity > 0 && quantity <= source.quantity - source.refunded_quantity
  const amounts = source && validQuantity ? calculateRefund(source, quantity, source.refunded_quantity) : null
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    const amount = amounts?.grossPence ?? Math.round(Number(form.get('amount')) * 100)
    if (!window.confirm(`Record a refund of ${formatMoney(amount)}${source ? ` for ${quantity} × ${source.name}` : ''}?`)) return
    setBusy(true); setError('')
    try { await api(`/admin/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify({ type: 'refund', amount_pence: amount, method: form.get('method'),
      ...(source ? { refund_lines: [{ source: source.source, quantity }] } : {}) }) }); await onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save refund.') }
    finally { setBusy(false) }
  }
  return <form className="payment-form refund-form" onSubmit={submit}><h3>Record refund</h3>
    {sources.length ? <><label>Original order item<select value={source?.source || ''} onChange={(e) => { setSourceId(e.target.value); setQuantity(1) }}>{available.map((s) => <option key={s.source} value={s.source}>{s.name} · {s.quantity - s.refunded_quantity} remaining</option>)}</select></label><label>Quantity<input type="number" min={1} max={source ? source.quantity - source.refunded_quantity : 0} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required /></label><p aria-live="polite">Refund {formatMoney(amounts?.grossPence || 0)} · VAT {formatMoney(amounts?.vatPence || 0)} · {vatTreatmentName(source?.vat_treatment || null)}</p></>
      : <><p>Historical tax snapshot unavailable. This refund will be flagged for VAT review.</p><label>Amount (£)<input name="amount" type="number" min="0.01" step="0.01" max={paidPence / 100} required /></label></>}
    <label>Method<select name="method"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></select></label>
    {error && <p role="alert" className="inline-error">{error}</p>}<button className="button button-outline button-wide" disabled={busy || (sources.length > 0 && (!amounts || amounts.grossPence <= 0 || amounts.grossPence > paidPence))}>{busy ? 'Saving...' : 'Record refund'}</button></form>
}

type DashboardData = {
  metrics: Record<string, number>
  top_products: Array<{ product_name: string; units: number }>
  recent_orders: Order[]
  sales_trend: Array<{ label: string; order_count: number; sales_pence: number }>
  period: 'day' | 'week' | 'month'
}

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day')
  useEffect(() => { api<DashboardData>(`/admin/dashboard?period=${period}`).then(setData).catch((reason: Error) => setError(reason.message)) }, [period])
  if (error) return <div className="inline-error">{error}</div>
  if (!data) return <div className="page-loading">Loading business overview...</div>
  const m = data.metrics
  const stats = [
    { label: 'Bookings', value: String(m.total_orders || 0), help: 'All booking requests', icon: ShoppingBag, tone: 'green' },
    { label: 'Booking value', value: formatMoney(m.booking_value_pence || 0), help: 'Awaiting confirmation', icon: Clock3, tone: 'amber' },
    { label: 'Confirmed sales', value: formatMoney(m.confirmed_value_pence || 0), help: 'Excludes cancelled · gross', icon: BadgeCheck, tone: 'blue' },
    { label: 'Paid revenue', value: formatMoney(m.paid_revenue_pence || 0), help: 'Payments recorded · net', icon: ArrowDown, tone: 'lilac' },
  ]
  const max = Math.max(1, ...data.top_products.map((item) => item.units))
  const trendMax = Math.max(1, ...data.sales_trend.map((item) => item.sales_pence))
  return <div className="dashboard-page"><div className="admin-page-heading"><div><span className="eyebrow">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()}</span><h1>Good morning<span className="brand-dot">.</span></h1><p>Here's what's happening at your shop.</p></div><Link to="/admin/orders" className="button button-dark admin-heading-action">View bookings <ArrowRight size={16} /></Link></div>
    <div className="stat-grid">{stats.map(({ label, value, help, icon: Icon, tone }) => <div className="stat-card" key={label}><div className={`stat-icon ${tone}`}><Icon size={18} /></div><span className="stat-label">{label}</span><strong>{value}</strong><small>{help}</small></div>)}</div>
    <div className="secondary-metrics"><div><span>New bookings</span><b>{m.new_orders || 0}</b></div><div><span>Processing</span><b>{m.processing_orders || 0}</b></div><div><span>Dispatched</span><b>{m.dispatched_orders || 0}</b></div><div><span>Delivered</span><b>{m.delivered_orders || 0}</b></div><div><span>Outstanding balance</span><b>{formatMoney(m.outstanding_pence || 0)}</b></div><div><span>Low-stock products</span><b>{m.low_stock || 0}</b></div></div>
    <section className="admin-panel trend-panel"><div className="panel-heading"><div><h2>Confirmed sales trend</h2><p>Order subtotals, excluding bookings, cancelled orders and VAT</p></div><label className="admin-filter"><span>Period</span><select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}><option value="day">Last 7 days</option><option value="week">Last 8 weeks</option><option value="month">Last 12 months</option></select><ChevronDown size={15} /></label></div><div className="trend-bars" role="img" aria-label={`Confirmed sales trend for the selected ${period} period`}>
      {data.sales_trend.map((item) => <div className="trend-item" key={item.label} title={`${item.label}: ${formatMoney(item.sales_pence)}, ${item.order_count} orders`}><span className="trend-value">{item.sales_pence ? formatMoney(item.sales_pence) : '—'}</span><div><i style={{ height: `${item.sales_pence ? Math.max(4, item.sales_pence / trendMax * 100) : 1}%` }} /></div><small>{item.label}</small></div>)}
    </div></section>
    <div className="dashboard-columns"><section className="admin-panel"><div className="panel-heading"><div><h2>Recent bookings</h2><p>Latest customer order requests</p></div><Link to="/admin/orders" className="panel-link">See all <ArrowRight size={14} /></Link></div>
      {data.recent_orders.length ? <div className="table-wrap"><table><thead><tr><th>REFERENCE</th><th>CUSTOMER</th><th>STATUS</th><th>VALUE</th></tr></thead><tbody>{data.recent_orders.map((order) => <tr key={order.id}><td><strong>{order.reference}</strong><small>{new Date(order.created_at).toLocaleDateString('en-GB')}</small></td><td>{order.customer_name}</td><td><StatusBadge status={order.status} /></td><td>{formatMoney(order.total_pence)}</td></tr>)}</tbody></table></div> : <div className="admin-empty">No bookings yet. Your first customer order will appear here.</div>}
    </section><section className="admin-panel top-products"><div className="panel-heading"><div><h2>Top movers</h2><p>Units in non-cancelled orders</p></div><div className="panel-icon"><Zap size={17} /></div></div>
      {data.top_products.length ? data.top_products.map((product, index) => <div className="mover-row" key={product.product_name}><span className="mover-rank">0{index + 1}</span><div><b>{product.product_name}</b><span className="mover-bar"><i style={{ width: `${product.units / max * 100}%` }} /></span></div><strong>{product.units}</strong></div>) : <div className="admin-empty">Product sales appear after orders are confirmed.</div>}
      <div className="report-footnote"><CircleHelp size={14} /> Paid revenue reflects recorded payments less refunds. Sales figures exclude VAT from analytics.</div>
    </section></div>
  </div>
}

function StatusBadge({ status }: { status: string }) {
  const label: Record<string, string> = { booking: 'New booking', confirmed: 'Confirmed', processing: 'Processing', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' }
  return <span className={`status-badge status-${status}`}>{label[status] || status}</span>
}

function OrdersAdmin() {
  const [orders, setOrders] = useState<Order[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState<Order | null>(null)
  const [adminNotes, setAdminNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [details, setDetails] = useState<{ refund_sources: RefundSource[]; events: Array<{ event_type: string; details: Record<string, string>; created_at: string }>; payments: Array<{ id: number | string; type: string; amount_pence: number; method: string; paid_at: string }> } | null>(null)
  const [error, setError] = useState('')
  const load = () => {
    const params = new URLSearchParams({ status, search, page: String(page), limit: '25' })
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return api<{ orders: Order[]; total: number; pages: number }>(`/admin/orders?${params}`).then((result) => {
      setOrders(result.orders); setTotal(result.total); setPages(Math.max(1, result.pages))
    }).catch((reason: Error) => setError(reason.message))
  }
  useEffect(() => {
    const timeout = window.setTimeout(load, search ? 250 : 0)
    return () => window.clearTimeout(timeout)
  }, [status, from, to, search, page])
  const open = async (order: Order) => {
    setSelected(order); setDetails(null)
    try { const detail = await api<{ order: Order; refund_sources: RefundSource[]; events: Array<{ event_type: string; details: Record<string, string>; created_at: string }>; payments: Array<{ id: number | string; type: string; amount_pence: number; method: string; paid_at: string }> }>(`/admin/orders/${order.id}`); setSelected(detail.order); setAdminNotes(detail.order.admin_notes || ''); setDetails(detail) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load order.') }
  }
  const saveAdminNotes = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    setSavingNotes(true)
    try {
      await api(`/admin/orders/${selected.id}/notes`, { method: 'PUT', body: JSON.stringify({ notes: adminNotes }) })
      setSelected({ ...selected, admin_notes: adminNotes })
      await open({ ...selected, admin_notes: adminNotes })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save admin note.') }
    finally { setSavingNotes(false) }
  }
  const updateStatus = async (next: string) => {
    if (!selected) return
    try { await api(`/admin/orders/${selected.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); await load(); await open({ ...selected, status: next as Order['status'] }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update order.') }
  }
  const recordPayment = async (event: FormEvent<HTMLFormElement>, type: 'payment' | 'refund') => {
    event.preventDefault(); if (!selected) return
    const formElement = event.currentTarget
    const form = new FormData(formElement); const amount = Math.round(Number(form.get('amount')) * 100)
    try { await api(`/admin/orders/${selected.id}/payments`, { method: 'POST', body: JSON.stringify({ type, amount_pence: amount, method: form.get('method'), notes: form.get('notes') || '' }) }); formElement.reset(); await load(); await open(selected) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not record payment.') }
  }
  return <div className="orders-page"><div className="admin-page-heading"><div><span className="eyebrow">CUSTOMER BOOKINGS</span><h1>Orders<span className="brand-dot">.</span></h1><p>Keep every booking and payment in one place.</p></div><a href="/api/admin/orders/export.csv" className="button button-outline"><Download size={16} /> Export CSV</a></div>
    {error && <div className="inline-error">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    <section className="admin-panel orders-panel"><div className="order-toolbar"><div className="admin-search"><Search size={17} /><input placeholder="Search reference, name or phone..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></div><button type="button" className="filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={15} /> Filters</button><div className={`order-filters ${filtersOpen ? 'filters-open' : ''}`}><label className="admin-filter"><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="all">All bookings</option><option value="booking">New bookings</option><option value="confirmed">Confirmed</option><option value="processing">Processing</option><option value="dispatched">Dispatched</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select><ChevronDown size={15} /></label><label className="date-filter">From<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} /></label><label className="date-filter">To<input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} /></label></div></div>
      <div className="table-wrap"><table><thead><tr><th>BOOKING</th><th>CUSTOMER</th><th>STATUS</th><th>ORDER VALUE</th><th>PAID</th><th></th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} onClick={() => open(order)} className="click-row"><td><strong>{order.reference}</strong><small>{new Date(order.created_at).toLocaleDateString('en-GB')}</small></td><td><strong>{order.customer_name}</strong><small>{order.customer_phone}</small></td><td><StatusBadge status={order.status} /></td><td>{formatMoney(order.total_pence)}</td><td>{formatMoney(order.paid_pence)}</td><td><button className="table-open" aria-label={`View ${order.reference}`}><ArrowUpRight size={16} /></button></td></tr>)}</tbody></table>
        {!orders.length && <div className="admin-empty">No bookings match those filters.</div>}</div><div className="table-pagination"><span>{total ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, total)} of ${total} bookings` : '0 bookings'}</span><div><button className="button button-outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="button button-outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div></div>
    </section>
    {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="order-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-heading"><div><span className="eyebrow">BOOKING DETAILS</span><h2>{selected.reference}</h2></div><button className="icon-btn" onClick={() => setSelected(null)} aria-label="Close details"><X /></button></div><div className="drawer-scroll">
      <div className="drawer-customer"><StatusBadge status={selected.status} /><h3>{selected.customer_name}</h3><a href={`tel:${selected.customer_phone}`}>{selected.customer_phone}</a>{selected.customer_email && <a href={`mailto:${selected.customer_email}`}>{selected.customer_email}</a>}<p>{selected.delivery_preference === 'delivery' ? `${selected.delivery_address}, ${selected.delivery_postcode}` : 'Collection preference'}</p>{selected.notes && <div className="customer-note"><b>Customer note</b>{selected.notes}</div>}</div>
      <form className="payment-form" onSubmit={saveAdminNotes}><label>Internal admin notes<textarea value={adminNotes} onChange={(event) => setAdminNotes(event.target.value)} rows={3} maxLength={2000} placeholder="Notes for the team (not shared with the customer)" /></label><button className="button button-outline button-wide" disabled={savingNotes}>{savingNotes ? 'Saving notes...' : 'Save internal note'}</button></form>
      <div className="drawer-products"><h3>Items</h3>{selected.items.map((item, index) => <div key={`${item.sku}-${index}`}><span>{item.product_name}<small>{item.sku} · Qty {item.quantity} · {item.vat_treatment ? vatTreatmentName(item.vat_treatment) : 'Legacy VAT snapshot unavailable'}{item.discount_pence ? ` · discount ${formatMoney(item.discount_pence)}` : ''}</small></span><strong>{formatMoney(item.line_gross_pence ?? item.line_total_pence)}</strong></div>)}</div>
      {!!selected.vat_breakdowns.length && <div className="drawer-products"><h3>VAT breakdown</h3>{selected.vat_breakdowns.map((row, index) => <div key={`${row.vat_treatment}-${row.vat_rate}-${row.is_delivery}-${index}`}><span>{vatTreatmentName(row.vat_treatment)}{row.is_delivery ? ' · Delivery' : ''}<small>Net {formatMoney(row.net_pence)} · VAT {formatMoney(row.vat_pence)}</small></span><strong>{formatMoney(row.gross_pence)}</strong></div>)}</div>}
      <div className="drawer-totals"><div><span>Product subtotal (ex. VAT)</span><b>{formatMoney(selected.subtotal_pence)}</b></div><div><span>Product VAT</span><b>{formatMoney(selected.vat_pence - selected.delivery_vat_pence)}</b></div><div><span>Delivery (ex. VAT)</span><b>{formatMoney(selected.delivery_pence)}</b></div><div><span>Delivery VAT</span><b>{formatMoney(selected.delivery_vat_pence)}</b></div><hr /><div><strong>Total (inc. VAT)</strong><strong>{formatMoney(selected.total_pence)}</strong></div><div><span>Recorded net payments</span><b>{formatMoney(selected.paid_pence)}</b></div><div><span>Outstanding</span><b>{formatMoney(Math.max(selected.total_pence - selected.paid_pence, 0))}</b></div></div>
      <div className="drawer-status-update"><label>Update order status<select value={selected.status} onChange={(event) => updateStatus(event.target.value)}>{['booking','confirmed','processing','dispatched','delivered','cancelled'].map((value) => <option value={value} key={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label></div>
      {selected.status !== 'booking' && selected.status !== 'cancelled' && selected.total_pence > selected.paid_pence && <form className="payment-form" onSubmit={(event) => recordPayment(event, 'payment')}><h3>Record payment</h3><div><label>Amount (£)<input name="amount" type="number" step="0.01" min="0.01" max={(selected.total_pence - selected.paid_pence) / 100} required /></label><label>Method<select name="method"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></select></label></div><button className="button button-dark button-wide">Record payment</button></form>}
      {selected.paid_pence > 0 && details && <RefundForm key={selected.id + '-' + selected.paid_pence} orderId={selected.id} paidPence={selected.paid_pence} sources={details.refund_sources} onSaved={async () => { await load(); await open(selected) }} />}
      {details?.payments.length ? <div className="drawer-products"><h3>Payment history</h3>{details.payments.map((payment) => <div key={payment.id}><span>{payment.type === 'payment' ? 'Received' : 'Refund'}<small>{payment.method.replace('_', ' ')} · {new Date(payment.paid_at).toLocaleDateString('en-GB')}</small></span><strong>{formatMoney(payment.amount_pence)}</strong></div>)}</div> : null}
      <a className="button button-whatsapp button-wide" href={`https://wa.me/${selected.customer_phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello ${selected.customer_name}, we're getting in touch about your SipUp order ${selected.reference}.`)}`} target="_blank" rel="noreferrer"><Zap size={16} /> Contact customer on WhatsApp <ExternalLink size={14} /></a>
      {details?.events.length ? <div className="drawer-history"><h3>Order history</h3>{details.events.map((event, index) => <div key={index}><i /><span><b>{event.event_type.replaceAll('_', ' ')}</b><small>{new Date(event.created_at).toLocaleString('en-GB')}</small></span></div>)}</div> : null}
    </div></aside></div>}
  </div>
}

type VatDashboardData = {
  refund_states: Array<{ status: string; refund_state: string; order_count: number }>
  basis: string
  legacy_orders_without_tax: number
  unallocated_refunds: { refund_count: number; gross_pence: number }
  recent_orders: Array<{ id: number; reference: string; status: string; net_pence: number; vat_pence: number; gross_pence: number }>
  refunds: Array<{ vat_treatment: NonNullable<Product['vat_treatment']>; is_delivery: boolean; net_pence: number; vat_pence: number; gross_pence: number; order_count: number }>
  catalogue: {
    net_pence: number
    estimated_vat_pence: number
    gross_pence: number
    zero_rated_pence: number
    exempt_pence: number
    classified_products: number
    products_requiring_review: number
    products_missing_classification: number
  }
  orders: Array<{
    vat_treatment: NonNullable<Product['vat_treatment']>
    vat_rate: number | null
    is_delivery: boolean
    net_pence: number
    vat_pence: number
    gross_pence: number
    discount_pence: number
    order_count: number
  }>
}

function VatPricingAdmin({ reportPage = false }: { reportPage?: boolean }) {
  const [data, setData] = useState<VatDashboardData | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('all')
  const [treatment, setTreatment] = useState('all')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [error, setError] = useState('')
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (status !== 'all') params.set('status', status)
  if (treatment !== 'all') params.set('treatment', treatment)
  if (category) params.set('category', category)
  const filterQuery = params.toString()
  useEffect(() => { api<{ categories: Category[] }>('/admin/categories').then((r) => setCategories(r.categories)).catch((e: Error) => setError(e.message)) }, [])
  useEffect(() => {
    let active = true
    setLoading(true)
    api<VatDashboardData>(`/admin/vat/dashboard?${filterQuery}`)
      .then((result) => { if (active) { setData(result); setError('') } })
      .catch((reason: Error) => { if (active) setError(reason.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [filterQuery, reload])
  if (!data) return error ? <div className="inline-error" role="alert">{error}<button onClick={() => setReload(reload + 1)}>Retry</button></div> : <div className="page-loading">Loading VAT and pricing data...</div>
  const metrics = [
    ['Catalogue value ex. VAT', data.catalogue.net_pence, 'Current stock at selling prices'],
    ['Estimated catalogue VAT', data.catalogue.estimated_vat_pence, 'Estimate only — not tax collected'],
    ['Catalogue value inc. VAT', data.catalogue.gross_pence, 'Confirmed classifications only'],
    ['Zero-rated stock value', data.catalogue.zero_rated_pence, 'Separate from exempt supplies'],
    ['Exempt stock value', data.catalogue.exempt_pence, 'No VAT charged on exempt supplies'],
  ] as const
  const salesVat = data.orders.reduce((sum, row) => sum + row.vat_pence, 0)
  const refundVat = data.refunds.reduce((sum, row) => sum + row.vat_pence, 0)
  return <div className="vat-admin-page"><div className="admin-page-heading"><div><span className="eyebrow">PRODUCT-LEVEL TAX</span><h1>{reportPage ? 'VAT Reports' : 'VAT & Pricing'}<span className="brand-dot">.</span></h1><p>Confirmed product treatment, order tax snapshots and pricing checks.</p></div><Link to="/admin/products" className="button button-dark">Review products <ArrowRight size={16} /></Link></div>
    {error && <div className="inline-error" role="alert">{error}</div>}{loading && <p role="status">Updating report...</p>}
    <div className="stat-grid vat-stat-grid">{metrics.map(([label, value, help]) => <div className="stat-card" key={label}><span className="stat-label">{label}</span><strong>{formatMoney(value)}</strong><small>{help}</small></div>)}</div>
    <section className="admin-panel vat-review-banner"><div><strong>{data.catalogue.products_requiring_review} products need VAT review</strong><p>{data.catalogue.products_missing_classification} are missing classification. {data.catalogue.classified_products} products have a confirmed VAT treatment. Unconfirmed products are not shown or sold in the storefront.</p></div><Link to="/admin/products" className="text-link">Review catalogue <ArrowRight size={15} /></Link></section>
    <section className="admin-panel settings-form"><p>Order VAT {formatMoney(salesVat)} · Refunded VAT {formatMoney(refundVat)} · After refunds {formatMoney(salesVat - refundVat)}</p><small>{data.basis}</small>
      {data.refund_states.map((state) => <p key={`${state.status}-${state.refund_state}`}>{state.order_count} {state.status} orders · {state.refund_state === 'none' ? 'no refund' : state.refund_state === 'full' ? 'fully refunded' : 'partially refunded'}</p>)}
      {(data.legacy_orders_without_tax > 0 || data.unallocated_refunds.refund_count > 0) && <p role="alert" className="vat-review-hint">Excluded from tax totals: {data.legacy_orders_without_tax} historical orders without tax snapshots and {data.unallocated_refunds.refund_count} unallocated refunds ({formatMoney(data.unallocated_refunds.gross_pence)}). Review these records separately.</p>}
      <a href={`/api/admin/vat/export.csv?${filterQuery}`} className="button button-outline"><Download size={16} /> Export filtered CSV</a></section>
    <section className="admin-panel vat-orders-panel"><div className="panel-heading"><div><h2>VAT recorded on orders</h2><p>Saved order tax snapshots; delivered orders selected by default. Status filters can include bookings or cancellations. Not an HMRC VAT return.</p></div></div>
      <div className="vat-filters"><label>From (UTC)<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>To (UTC)<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Completed (delivered)</option>{['confirmed', 'processing', 'dispatched', 'delivered', 'booking', 'cancelled'].map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label><label>Treatment<select value={treatment} onChange={(event) => setTreatment(event.target.value)}><option value="all">All VAT treatments</option>{vatTreatments.map((value) => <option key={value} value={value}>{vatTreatmentName(value)}</option>)}</select></label><label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{categories.map((c) => <option key={c.id}>{c.name}</option>)}</select></label></div>
      <div className="table-wrap"><table><thead><tr><th>VAT TREATMENT</th><th>NET SALES</th><th>VAT RECORDED</th><th>GROSS SALES</th><th>ORDERS</th></tr></thead><tbody>{data.orders.map((row, index) => <tr key={`${row.vat_treatment}-${row.vat_rate}-${row.is_delivery}-${index}`}><td><strong>{vatTreatmentName(row.vat_treatment)}{row.is_delivery ? ' · Delivery' : ''}</strong></td><td>{formatMoney(row.net_pence)}</td><td>{formatMoney(row.vat_pence)}</td><td>{formatMoney(row.gross_pence)}</td><td>{row.order_count}</td></tr>)}</tbody></table>{!data.orders.length && <div className="admin-empty">No saved order tax records match the selected filters.</div>}</div>
    </section>
    <section className="admin-panel settings-form"><h2>Discounts and refund adjustments</h2><p>Product discounts included in taxable line values: {formatMoney(data.orders.reduce((sum, row) => sum + row.discount_pence, 0))}</p>{data.refunds.map((row, i) => <p key={i}>{vatTreatmentName(row.vat_treatment)}{row.is_delivery ? ' · Delivery' : ''}: net {formatMoney(row.net_pence)}, VAT {formatMoney(row.vat_pence)}, gross {formatMoney(row.gross_pence)} refunded ({row.order_count} orders).</p>)}{!data.refunds.length && <p>No allocated refunds in this period.</p>}</section>
    <section className="admin-panel settings-form"><h2>Recent matching orders</h2><div className="table-wrap"><table><thead><tr><th>ORDER</th><th>STATUS</th><th>PRODUCT NET</th><th>VAT</th><th>GROSS</th></tr></thead><tbody>{data.recent_orders.map((order) => <tr key={order.id}><td><Link to="/admin/orders">{order.reference}</Link></td><td>{order.status}</td><td>{formatMoney(order.net_pence)}</td><td>{formatMoney(order.vat_pence)}</td><td>{formatMoney(order.gross_pence)}</td></tr>)}</tbody></table>{!data.recent_orders.length && <p>No matching orders.</p>}</div></section>
  </div>
}

function VatPricingFields({ product }: { product: Partial<Product> }) {
  const [treatment, setTreatment] = useState<Product['vat_treatment']>(product.vat_treatment || null)
  const [mode, setMode] = useState<VatDisplayMode>('exclusive')
  const [price, setPrice] = useState(((product.price_pence || 0) / 100).toFixed(2))
  const [sale, setSale] = useState(product.sale_price_pence == null ? '' : (product.sale_price_pence / 100).toFixed(2))
  const [confirmed, setConfirmed] = useState(Boolean(product.vat_confirmed))
  const pricePence = Math.round(Number(price) * 100)
  const salePence = Math.round(Number(sale) * 100)
  const preview = treatment && price !== '' && Number.isSafeInteger(pricePence) && pricePence >= 0
    ? calculatePrice(pricePence, mode, treatment) : null
  const salePreview = treatment && sale !== '' && Number.isSafeInteger(salePence) && salePence >= 0
    ? calculatePrice(salePence, mode, treatment) : null
  const canonicalMismatch = preview && treatment && mode === 'inclusive'
    && calculatePrice(preview.netPence, 'exclusive', treatment).grossPence !== pricePence
  return <>
    <div className="form-row vat-entry-row">
      <label>VAT treatment
        <select name="vat_treatment" value={treatment || ''} onChange={(event) => { setTreatment(event.target.value ? event.target.value as NonNullable<Product['vat_treatment']> : null); setConfirmed(false) }}>
          <option value="">Select treatment — required to publish</option>
          <option value="standard">Standard-rated — 20%</option>
          <option value="reduced">Reduced-rated — 5%</option>
          <option value="zero">Zero-rated — 0%</option>
          <option value="exempt">Exempt — no VAT charged</option>
        </select>
      </label>
      <label>Price entered
        <select name="price_entry_mode" value={mode} onChange={(event) => setMode(event.target.value as VatDisplayMode)}>
          <option value="exclusive">Excluding VAT</option>
          <option value="inclusive">Including VAT</option>
        </select>
      </label>
    </div>
    <div className="form-row">
      <label>{mode === 'inclusive' ? 'Regular price (inc. VAT, £)' : 'Regular price (ex. VAT, £)'}
        <input name="price" type="number" min="0" step=".01" required value={price} onChange={(event) => setPrice(event.target.value)} />
      </label>
      <label>{mode === 'inclusive' ? 'Promotional price (inc. VAT, £)' : 'Promotional price (ex. VAT, £)'}
        <input name="sale_price" type="number" min="0" step=".01" value={sale} onChange={(event) => setSale(event.target.value)} />
      </label>
    </div>
    {preview ? <div className="vat-price-preview" aria-live="polite"><strong>Live pricing preview</strong><span>Ex. VAT <b>{formatMoney(preview.netPence)}</b></span><span>VAT {preview.rate === null ? '(exempt)' : `(${preview.rate}%)`} <b>{formatMoney(preview.vatPence)}</b></span><span>Inc. VAT <b>{formatMoney(preview.grossPence)}</b></span></div>
      : <p className="vat-review-hint">Select the product’s actual VAT treatment to preview its net and gross price. Do not infer treatment from its category or name.</p>}
    {salePreview && <p className="vat-review-hint">Promotional price: net {formatMoney(salePreview.netPence)} · VAT {formatMoney(salePreview.vatPence)} · gross {formatMoney(salePreview.grossPence)}</p>}
    {canonicalMismatch && <p role="alert" className="inline-error">This inclusive price needs a fractional penny net price. Adjust it by a penny or enter an exclusive price. The server will prevent saving it.</p>}
    <label className="vat-confirmation"><input type="checkbox" name="vat_confirmed" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I have checked and confirmed this product’s VAT treatment</label>
  </>
}

function ProductsAdmin() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [editing, setEditing] = useState<Partial<Product> | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [vatFilter, setVatFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<{ categories: Category[] }>('/admin/categories').then((r) => setCategories(r.categories)).catch((e: Error) => setError(e.message)) }, [])
  const [loading, setLoading] = useState(true)
  const load = (signal?: AbortSignal) => {
    setLoading(true); setError('')
    return api<{ products: Product[] }>('/admin/products', { signal })
      .then((data) => { if (!signal?.aborted) setProducts(data.products) })
      .catch((reason: Error) => { if (!signal?.aborted) setError(reason.message) })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort() }, [])
  const filtered = products.filter((product) => {
    const matchesSearch = `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(search.toLowerCase())
    const matchesTreatment = vatFilter === 'all' || (vatFilter === 'review'
      ? !product.vat_confirmed || !product.vat_treatment : product.vat_treatment === vatFilter)
    return matchesSearch && matchesTreatment
  })
  const pages = Math.max(1, Math.ceil(filtered.length / 25))
  const visible = filtered.slice((page - 1) * 25, page * 25)
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!editing) return
    const form = new FormData(event.currentTarget)
    const price = Math.round(Number(form.get('price')) * 100)
    const sale = String(form.get('sale_price') || '').trim()
    const bulkPriceLines = String(form.get('bulk_prices') || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const bulkPrices = bulkPriceLines.map((line) => {
      const match = /^(\d+)\s*:\s*(\d+(?:\.\d{1,2})?)$/.exec(line)
      return match ? { min_quantity: Number(match[1]), unit_price_pence: Math.round(Number(match[2]) * 100) } : null
    })
    if (bulkPrices.some((tier) => tier === null)) {
      setError('Enter each bulk price as quantity:price, for example 12:0.85.')
      return
    }
    const body = {
      name: String(form.get('name')), sku: String(form.get('sku')), brand: String(form.get('brand') || ''),
      category_id: Number(form.get('category_id')) || null,
      category: categories.find(c=>c.id===Number(form.get('category_id')))?.name || editing.category || 'Other', description: String(form.get('description') || ''),
      image_url: String(form.get('image_url') || ''), price_pence: price,
      image_urls: String(form.get('image_urls') || '').split(/\r?\n/).map((url) => url.trim()).filter(Boolean),
      bulk_prices: bulkPrices.filter((tier): tier is NonNullable<typeof tier> => tier !== null),
      sale_price_pence: sale ? Math.round(Number(sale) * 100) : null,
      vat_treatment: String(form.get('vat_treatment') || '') || null,
      vat_confirmed: form.get('vat_confirmed') === 'on',
      price_entry_mode: String(form.get('price_entry_mode')),
      stock_quantity: Number(form.get('stock_quantity')), min_quantity: Number(form.get('min_quantity')) || 1,
      pack_size: String(form.get('pack_size') || ''), is_published: form.get('is_published') === 'on',
      is_featured: form.get('is_featured') === 'on', is_new: form.get('is_new') === 'on',
    }
    setBusy(true); setError('')
    try {
      const upload = async (file: File) => {
        if (file.size > 5 * 1024 * 1024) throw new Error('Choose images smaller than 5 MB.')
        const result = await api<{ image_url: string }>('/admin/product-media', {
          method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' },
        })
        return result.image_url
      }
      const cover = form.get('cover_image')
      if (cover instanceof File && cover.size) body.image_url = await upload(cover)
      for (const file of form.getAll('gallery_images')) {
        if (file instanceof File && file.size) body.image_urls.push(await upload(file))
      }
      await api(`/admin/products${editing.id ? `/${editing.id}` : ''}`, { method: editing.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); setEditing(null); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save product.') }
    finally { setBusy(false) }
  }
  const archive = async (product: Product) => {
    if (!window.confirm(`Unpublish ${product.name}? It will no longer appear in the shop.`)) return
    try { await api(`/admin/products/${product.id}`, { method: 'DELETE' }); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not unpublish product.') }
  }
  return <div className="products-page"><div className="admin-page-heading"><div><span className="eyebrow">YOUR CATALOGUE</span><h1>Products<span className="brand-dot">.</span></h1><p>Keep your shelves up to date.</p></div><button className="button button-dark" onClick={() => setEditing(emptyProduct())}><Plus size={17} /> Add product</button></div>
    {error && <div className="inline-error" role="alert">{error} <button onClick={() => { load() }}>Reload products</button><button onClick={() => setError('')}>Dismiss</button></div>}{loading && <p role="status">Loading products...</p>}
    <section className="admin-panel products-panel"><div className="order-toolbar"><div className="admin-search"><Search size={17} /><input placeholder="Search name, SKU or category..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></div><label className="admin-filter"><span>VAT treatment</span><select value={vatFilter} onChange={(event) => { setVatFilter(event.target.value); setPage(1) }}><option value="all">All products</option><option value="review">Needs review</option>{vatTreatments.map((value) => <option value={value} key={value}>{vatTreatmentName(value)}</option>)}</select></label><span className="results-count">{filtered.length} products</span></div><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SKU</th><th>VAT TREATMENT</th><th>VAT RATE</th><th>NET PRICE</th><th>VAT</th><th>GROSS PRICE</th><th>STATUS</th><th></th></tr></thead><tbody>{visible.map((product) => {
      const net = product.sale_price_pence ?? product.price_pence
      const amounts = product.vat_confirmed && product.vat_treatment ? calculatePrice(net, 'exclusive', product.vat_treatment) : null
      return <tr key={product.id}><td className="table-product"><ProductImage src={product.image_url || imageFallback} alt="" /><span><strong>{product.name}</strong><small>{product.pack_size}</small></span></td><td>{product.sku}</td><td>{product.vat_confirmed ? vatTreatmentName(product.vat_treatment) : <span className="vat-review-badge">Needs review</span>}</td><td>{product.vat_rate===null ? "?" : `${product.vat_rate}%`}</td><td><strong>{formatMoney(net)}</strong>{product.sale_price_pence !== null && <small className="table-sale">Offer · regular {formatMoney(product.price_pence)}</small>}</td><td>{amounts ? formatMoney(amounts.vatPence) : '—'}</td><td>{amounts ? formatMoney(amounts.grossPence) : '—'}</td><td><span className={product.is_published ? 'publish-state' : 'publish-state unpublished'}><i />{product.is_published ? 'Published' : 'Hidden'}</span></td><td><div className="table-actions"><button onClick={() => setEditing(product)} aria-label={`Edit ${product.name}`}><Settings size={16} /></button><button onClick={() => archive(product)} aria-label={`Unpublish ${product.name}`}><EyeOff size={16} /></button></div></td></tr>
    })}</tbody></table>{!loading && !error && !filtered.length && <div className="admin-empty">No products found.</div>}</div><div className="table-pagination"><span>{filtered.length ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, filtered.length)} of ${filtered.length} products` : '0 products'}</span><div><button className="button button-outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="button button-outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div></div></section>
    {editing && <div className="drawer-backdrop" onClick={() => setEditing(null)}><aside className="product-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-heading"><div><span className="eyebrow">{editing.id ? 'EDIT YOUR CATALOGUE' : 'ADD TO THE CATALOGUE'}</span><h2>{editing.id ? 'Product details' : 'New product'}</h2></div><button className="icon-btn" onClick={() => setEditing(null)} aria-label="Close form"><X /></button></div><form className="product-form drawer-scroll" onSubmit={save}><label>Product name<input name="name" required minLength={2} maxLength={160} defaultValue={editing.name} /></label><div className="form-row"><label>SKU / code<input name="sku" required maxLength={80} readOnly={editing.selling_unit==='case'} defaultValue={editing.sku} /></label><label>Brand<input name="brand" maxLength={100} defaultValue={editing.brand} /></label></div><div className="form-row"><label>Category<select name="category_id" defaultValue={editing.category_id || categories.find(c=>c.name===editing.category)?.id || categories[0]?.id}>{categories.map(c=><option key={c.id} value={c.id}>{c.parent_id ? (categories.find(parent=>parent.id===Number(c.parent_id))?.name || 'Parent') + ' / ' : ''}{c.name}</option>)}</select></label><label>Pack size<input name="pack_size" maxLength={100} defaultValue={editing.pack_size} placeholder="e.g. 24 × 330ml" /></label></div><label>Description<textarea name="description" maxLength={3000} rows={3} defaultValue={editing.description} /></label><label>Upload cover image<input name="cover_image" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" /><small>Up to 5 MB. Replaces the cover image.</small></label><label>Add gallery images<input name="gallery_images" type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif,image/gif" /></label><label>Cover image URL<input name="image_url" type="text" inputMode="url" maxLength={1000} defaultValue={editing.image_url} placeholder="https://..." /></label><label>Additional gallery image URLs<textarea name="image_urls" rows={3} maxLength={10000} defaultValue={(editing.images || []).map((image) => image.image_url).filter((url) => url !== editing.image_url).join('\n')} placeholder="One HTTPS image URL per line" /></label>{!!editing.review_warnings?.length && <div className="vat-review-hint" role="note"><strong>Import review notes</strong><ul>{editing.review_warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul><small>These notes preserve the original import findings. Catalogue VAT confirmation is recorded separately.</small></div>}<VatPricingFields key={editing.id || 'new'} product={editing} /><label>Bulk price tiers <small>One per line: minimum quantity:unit price in GBP, using the selected price-entry convention.</small><textarea name="bulk_prices" rows={3} defaultValue={(editing.bulk_prices || []).map((tier) => `${tier.min_quantity}:${(tier.unit_price_pence / 100).toFixed(2)}`).join('\n')} placeholder="12:0.85&#10;24:0.75" /></label><div className="form-row"><label>Stock quantity {editing.selling_unit==='case' ? '(cases)' : ''}<input name="stock_quantity" type="number" min="0" required defaultValue={editing.stock_quantity ?? 0} /></label><label>Minimum quantity<input name="min_quantity" type="number" min="1" required defaultValue={editing.min_quantity ?? 1} /></label></div><div className="checkbox-options"><label><input type="checkbox" name="is_published" defaultChecked={Boolean(editing.is_published && editing.vat_confirmed && editing.vat_treatment)} /> Published in shop</label><label><input type="checkbox" name="is_featured" defaultChecked={editing.is_featured} /> Featured product</label><label><input type="checkbox" name="is_new" defaultChecked={editing.is_new} /> New arrival</label></div><button className="button button-dark button-wide" disabled={busy}>{busy ? 'Saving...' : 'Save product'}</button></form></aside></div>}
  </div>
}

function SettingsAdmin({ deliveryPage = false }: { deliveryPage?: boolean }) {
  const [store, setStore] = useState<StoreSettings>(defaultStore)
  const [home, setHome] = useState<HomeSettings>(defaultHome)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { api<{ store: StoreSettings; homepage: HomeSettings }>('/admin/settings').then((settings) => { setStore({ ...defaultStore, ...settings.store }); setHome({ ...defaultHome, ...settings.homepage }) }).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false)) }, [])
  const save = async (event: FormEvent<HTMLFormElement>, key: 'store' | 'homepage') => {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    const body = key === 'store' ? {
      ...store, name: String(form.get('name')), tagline: String(form.get('tagline')),
      whatsapp_number: String(form.get('whatsapp_number')), email: String(form.get('email')),
      phone: String(form.get('phone')), address: String(form.get('address')),
      delivery_vat_treatment: String(form.get('delivery_vat_treatment') || '') || null,
      delivery_charge_pence: Math.round(Number(form.get('delivery_charge')) * 100),
      free_delivery_threshold_pence: Math.round(Number(form.get('free_delivery')) * 100),
      minimum_order_pence: Math.round(Number(form.get('minimum_order')) * 100),
      business_hours: String(form.get('business_hours')), announcement: String(form.get('announcement')),
    } : {
      hero_title: String(form.get('hero_title')), hero_copy: String(form.get('hero_copy')),
      hero_image: String(form.get('hero_image')), promo_message: String(form.get('promo_message')),
      featured_heading: String(form.get('featured_heading')),
    }
    setSaving(true); setError(''); setMessage('')
    try { await api(`/admin/settings/${key}`, { method: 'PUT', body: JSON.stringify(body) }); setMessage('Your settings have been saved.'); window.setTimeout(() => setMessage(''), 3000) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save settings.') }
    finally { setSaving(false) }
  }
  if (loading) return <div className="page-loading">Loading store settings...</div>
  return <div className="settings-page"><div className="admin-page-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h1>{deliveryPage ? 'Delivery & Collection' : 'Settings'}<span className="brand-dot">.</span></h1><p>Business details and storefront content.</p></div></div>
    {message && <div className="success-message"><Check size={16} />{message}</div>}{error && <div className="inline-error">{error}</div>}
    <div className="settings-grid"><form className="admin-panel settings-form" onSubmit={(event) => save(event, 'store')}><div className="panel-heading"><div><h2>Business details</h2><p>Shown on your storefront and WhatsApp bookings.</p></div><div className="panel-icon"><Settings size={17} /></div></div>
      <label>Store name<input name="name" required defaultValue={store.name} /></label><label>Tagline<input name="tagline" defaultValue={store.tagline} /></label><label>Business WhatsApp number <small>Include country code, e.g. 44...</small><input name="whatsapp_number" type="tel" defaultValue={store.whatsapp_number} placeholder="Not configured" /></label><div className="form-row"><label>Email<input name="email" type="email" defaultValue={store.email} /></label><label>Telephone<input name="phone" type="tel" defaultValue={store.phone} /></label></div><label>Business address<textarea name="address" rows={2} defaultValue={store.address} /></label><label>Business hours<input name="business_hours" defaultValue={store.business_hours} /></label><label>Announcement bar<input name="announcement" maxLength={200} defaultValue={store.announcement} /></label>
      <div className="settings-divider"><span>VAT & delivery</span><small>Set the delivery treatment only after confirming it for your delivery supply.</small></div><label>Delivery VAT treatment<select name="delivery_vat_treatment" defaultValue={store.delivery_vat_treatment || ''}><option value="">Unconfigured — delivery checkout disabled</option><option value="standard">Standard-rated — 20%</option><option value="reduced">Reduced-rated — 5%</option><option value="zero">Zero-rated — 0%</option><option value="exempt">Exempt</option></select></label><p className="settings-hint">The delivery charge is stored excluding VAT. If a delivery fee applies while treatment is unconfigured, checkout will stop and ask an administrator to configure it; it is never automatically taxed at 20%.</p><div className="form-row"><label>Delivery charge (£, ex. VAT)<input name="delivery_charge" type="number" min="0" step=".01" defaultValue={(store.delivery_charge_pence / 100).toFixed(2)} /></label><label>Free delivery from (£)<input name="free_delivery" type="number" min="0" step=".01" defaultValue={(store.free_delivery_threshold_pence / 100).toFixed(2)} /></label></div><label>Minimum order (£)<input name="minimum_order" type="number" min="0" step=".01" defaultValue={(store.minimum_order_pence / 100).toFixed(2)} /></label>
      <button className="button button-dark" disabled={saving}>{saving ? 'Saving...' : 'Save business settings'} <ArrowRight size={15} /></button>
    </form>
    {!deliveryPage && <form className="admin-panel settings-form" onSubmit={(event) => save(event, 'homepage')}><div className="panel-heading"><div><h2>Homepage content</h2><p>Freshen up your storefront without a deployment.</p></div><div className="panel-icon"><Sparkles size={17} /></div></div>
      <label>Hero headline<textarea name="hero_title" rows={2} defaultValue={home.hero_title} /></label><label>Hero description<textarea name="hero_copy" rows={4} defaultValue={home.hero_copy} /></label><label>Hero image URL<input name="hero_image" type="url" defaultValue={home.hero_image} placeholder="Leave blank for default image" /></label><label>Promotion ticker<input name="promo_message" defaultValue={home.promo_message} /></label><label>Featured products heading<input name="featured_heading" defaultValue={home.featured_heading} /></label><button className="button button-dark" disabled={saving}>{saving ? 'Saving...' : 'Save homepage content'} <ArrowRight size={15} /></button>
      <div className="settings-tip"><CircleHelp size={17} /><p>Store WhatsApp is used to build pre-filled order messages. A booking is always recorded in the database before the customer is asked to open WhatsApp.</p></div>
    </form>}</div>
  </div>
}
