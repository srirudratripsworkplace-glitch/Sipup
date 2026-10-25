import { useState } from 'react'
import { Pause, Play } from 'lucide-react'
import './promo-ticker.css'

export default function PromoTicker({ message }: { message: string }) {
  const [paused, setPaused] = useState(false)
  const text = message || 'Stock up on the good stuff'
  return <div className="ticker promo-ticker" role="region" aria-label="Store offers" data-paused={paused}>
    <span className="ticker-copy">{text}. Good things for your shelves.</span>
    <div className="ticker-track" aria-hidden="true">{[0, 1].map(copy => <div className="ticker-group" key={copy}><span>{text}</span><span>✳</span><span>Good things for your shelves</span><span>✳</span><span>{text}</span><span>✳</span></div>)}</div>
    <button className="ticker-toggle" type="button" onClick={() => setPaused(p => !p)} aria-label={paused ? 'Resume scrolling offers' : 'Pause scrolling offers'} aria-pressed={paused}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>
  </div>
}
