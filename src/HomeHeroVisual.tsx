import ProductImage from './ProductImage'
import { useEffect, useState } from 'react'
import type { Product } from './types'

export default function HomeHeroVisual({ image, products }: { image: string; products: Product[] }) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => setLoaded(false), [image])
  const chosen = [/gushers/i, /faygo.*cotton/i, /roll.ups/i].map(pattern => products.find(product => product.image_url && pattern.test(product.name)))
  const samples = [...chosen.filter(Boolean) as Product[], ...products.filter(product => product.image_url && !chosen.some(p => p?.id === product.id))].slice(0, 3)
  return <div className="hero-visual hero-product-visual">
    <div className="hero-product-art" aria-label="A selection from the SipUp drinks and candy range">
      <span className="hero-art-ring" aria-hidden="true" /><span className="hero-art-word" aria-hidden="true">GOOD<br />STOCK.</span>
      {samples.map((product, index) => <ProductImage key={product.id} className={`hero-art-product hero-art-product-${index + 1}`} src={product.image_url} alt={product.name} />)}
    </div>
    {image && <img className={`hero-configured-image ${loaded ? 'is-loaded' : ''}`} src={image} alt="A colourful selection of drinks and snacks" onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} />}
    <div className="hero-sticker"><span>THE</span><b>good</b><span>STUFF</span><span className="sticker-star">✳</span></div>
    <div className="hero-image-caption"><span>YOUR SHELF, SORTED.</span><span>DRINKS · SNACKS · CANDY</span></div>
  </div>
}
