import ProductImage from './ProductImage'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, Box, Candy, CupSoda, Package, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from './api'
import type { Product } from './types'

type AisleCategory = { id: number; name: string; slug: string; description: string; parent_id?: number | null; product_count?: number }

function AisleCard({ category, children, index, symbol }: { category: AisleCategory; children: AisleCategory[]; index: number; symbol: ReactNode }) {
  const [samples, setSamples] = useState<Product[]>([])
  useEffect(() => {
    const controller = new AbortController()
    api<{ products: Product[] }>(`/products?category=${encodeURIComponent(category.slug)}&limit=48`, { signal: controller.signal })
      .then(({ products }) => {
        const rank = (name: string) => /candy|candys/i.test(name) ? 0 : /drink/i.test(name) ? 1 : /snack/i.test(name) ? 2 : 3
        const groups = [...new Set(products.map(p => p.category))].sort((a, b) => rank(a) - rank(b))
        const chosen = groups.map(group => {
          const options = products.filter(p => p.category === group && p.image_url)
          return options.find(p => /gushers|cotton candy|pringles/i.test(p.name)) || options[0]
        }).filter(Boolean) as Product[]
        setSamples([...chosen, ...products.filter(p => p.image_url && !chosen.some(c => c.id === p.id))].slice(0, 3))
      }).catch(() => { /* Category links remain usable if preview images are unavailable. */ })
    return () => controller.abort()
  }, [category.slug])
  const american = /american/i.test(category.name)
  const description = american ? 'Big flavours. Familiar favourites.' : /global/i.test(category.name) ? 'A world of flavour, ready to explore.' : category.description || 'Find your next shelf favourite.'
  return <article className={`aisle-card ${american ? 'aisle-card-american' : 'aisle-card-global'}`}>
    <Link to={`/category/${category.slug}`} className="aisle-feature" aria-label={`Shop all ${category.name} products`}>
      <div className="aisle-feature-top"><span className="aisle-index">AISLE {String(index + 1).padStart(2, '0')}</span><span className="aisle-count">{category.product_count} products <ArrowUpRight size={14} /></span></div>
      <div className="aisle-product-scene" aria-hidden="true">
        <span className="aisle-orbit" /><span className="aisle-orbit aisle-orbit-small" />
        <span className="aisle-scene-word">{american ? 'BIG FLAVOUR' : 'GO GLOBAL'}</span>
        {samples.map((p, i) => <ProductImage className={`aisle-product aisle-product-${i + 1}`} key={p.id} src={p.image_url} alt="" loading="lazy" />)}
        {!samples.length && <Box className="aisle-placeholder" size={80} strokeWidth={1} />}
        <span className="aisle-spark aisle-spark-one">✳</span><span className="aisle-spark aisle-spark-two">✳</span>
      </div>
      <div className="aisle-title-row">{symbol}<div><h3>{category.name}<span> favourites.</span></h3><p>{description}</p></div><span className="aisle-open"><ArrowUpRight size={23} /></span></div>
    </Link>
    <div className="aisle-subcategories" aria-label={`${category.name} categories`}>
      {children.map(child => {
        const Icon = /drink/i.test(child.name) ? CupSoda : /candy|candys|gum/i.test(child.name) ? Candy : /monster|energy/i.test(child.name) ? Zap : Package
        return <Link key={child.id} to={`/category/${child.slug}`}><Icon size={18} strokeWidth={1.7} /><span>{child.name}</span><small>{child.product_count}</small><ArrowRight size={14} /></Link>
      })}
    </div>
    <Link to={`/category/${category.slug}`} className="aisle-browse">Explore the {category.name.toLowerCase()} aisle <ArrowRight size={17} /></Link>
  </article>
}

export default function AisleSection({ categories, renderSymbol }: { categories: AisleCategory[]; renderSymbol: (name: string) => ReactNode }) {
  const parents = categories.filter(c => !c.parent_id && Number(c.product_count) > 0)
  if (!parents.length) return null
  return <section className="aisles-section section-wrap" aria-labelledby="aisles-title">
    <div className="section-heading aisle-section-heading"><div><span className="eyebrow"><span className="eyebrow-dot" /> A LITTLE DISCOVERY, A LOT OF FLAVOUR</span><h2 id="aisles-title">Find your kind of <em>good.</em></h2><p>Pick an aisle. Meet your next shelf favourite.</p></div><Link to="/shop" className="text-link">Shop the whole range <ArrowUpRight size={17} /></Link></div>
    <div className="aisles-grid">{parents.map((parent, index) => <AisleCard key={parent.id} category={parent} index={index} symbol={renderSymbol(parent.name)} children={categories.filter(c => c.parent_id === parent.id && Number(c.product_count) > 0)} />)}</div>
    <div className="aisle-section-note"><Box size={16} /><span>Made for stocking up.</span> Wholesale cases, with pack sizes shown on every product.</div>
  </section>
}
