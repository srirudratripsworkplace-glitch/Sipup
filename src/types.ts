export type Product = {
  review_warnings?: string[]
  category_id?: number | null
  category_slug?: string
  parent_category?: string | null
  selling_unit?: 'case' | 'item'
  size?: string
  flavour?: string
  units_per_case?: number | null
  source_unit_price_pence?: number | null
  source_price_mode?: 'exclusive' | 'inclusive' | null
  id: number
  name: string
  slug: string
  sku: string
  brand: string
  category: string
  description: string
  image_url: string
  price_pence: number
  sale_price_pence: number | null
  vat_treatment: 'standard' | 'reduced' | 'zero' | 'exempt' | null
  vat_rate: number | null
  vat_confirmed: boolean
  price_entry_mode: 'exclusive' | 'inclusive'
  stock_quantity: number
  min_quantity: number
  pack_size: string
  is_published: boolean
  is_featured: boolean
  is_new: boolean
  images?: Array<{ id?: number; image_url: string; alt_text: string }>
  bulk_prices?: Array<{ min_quantity: number; unit_price_pence: number }>
}

export type CartItem = { product: Product; quantity: number }

export type CustomerAccount = {
  id: number
  name: string
  phone: string
  email: string
}

export type StoreSettings = {
  name: string
  tagline: string
  whatsapp_number: string
  email: string
  phone: string
  address: string
  currency: 'GBP'
  delivery_vat_treatment: 'standard' | 'reduced' | 'zero' | 'exempt' | null
  delivery_charge_pence: number
  free_delivery_threshold_pence: number
  minimum_order_pence: number
  business_hours: string
  announcement: string
}

export type HomeSettings = {
  hero_title: string
  hero_copy: string
  hero_image: string
  promo_message: string
  featured_heading: string
}

export type SavedOrder = {
  reference: string
  status: string
  customer: {
    name: string
    phone: string
    email: string
    address: string
    postcode: string
    preference: 'delivery' | 'collection'
    notes: string
  }
  items: Array<{
    name: string
    sku: string
    quantity: number
    unit_price_pence: number
    line_total_pence: number
    vat_treatment?: Product['vat_treatment']
    vat_rate?: number | null
    price_entry_mode?: 'exclusive' | 'inclusive' | null
    discount_pence?: number
    line_vat_pence?: number | null
    line_gross_pence?: number | null
  }>
  subtotal_pence: number
  vat_pence: number
  delivery_pence: number
  delivery_vat_pence?: number
  total_pence: number
}

export type Order = {
  id: number
  reference: string
  customer_name: string
  customer_phone: string
  customer_email: string
  delivery_address: string
  delivery_postcode: string
  delivery_preference: string
  notes: string
  admin_notes: string
  status: 'booking' | 'confirmed' | 'processing' | 'dispatched' | 'delivered' | 'cancelled'
  subtotal_pence: number
  vat_pence: number
  delivery_pence: number
  total_pence: number
  paid_pence: number
  created_at: string
  items: Array<{
    product_name: string
    sku: string
    quantity: number
    unit_price_pence: number
    line_total_pence: number
    vat_treatment: Product['vat_treatment']
    vat_rate: number | null
    price_entry_mode: 'exclusive' | 'inclusive' | null
    discount_pence: number
    line_net_pence: number | null
    line_vat_pence: number | null
    line_gross_pence: number | null
  }>
  delivery_vat_pence: number
  vat_breakdowns: Array<{
    vat_treatment: NonNullable<Product['vat_treatment']>
    vat_rate: number | null
    net_pence: number
    vat_pence: number
    gross_pence: number
    is_delivery: boolean
  }>
}
