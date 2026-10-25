import { useEffect, useRef, useState } from 'react'
import type { ImgHTMLAttributes } from 'react'
import { imageFallback } from './api'

// A temporary image failure should get a second chance before showing a placeholder.
export default function ProductImage({ src, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'onError'>) {
  const [state, setState] = useState({ source: src, attempt: 0 })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const attempt = state.source === src ? state.attempt : 0
  useEffect(() => {
    setState({ source: src, attempt: 0 })
    return () => clearTimeout(timer.current)
  }, [src])
  let image = src || imageFallback
  if (attempt === 1) image += `${image.includes('?') ? '&' : '?'}image_retry=1`
  if (attempt === 2) image = imageFallback
  return <img decoding="async" {...props} src={image} onError={() => {
    if (!src || attempt === 2) return
    clearTimeout(timer.current)
    if (attempt === 0) timer.current = setTimeout(() => setState({ source: src, attempt: 1 }), 400)
    else setState({ source: src, attempt: 2 })
  }} />
}
