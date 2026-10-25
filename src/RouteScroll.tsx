import { useEffect, useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'

export default function RouteScroll() {
  const { pathname, search, hash, key } = useLocation()
  useEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => { window.history.scrollRestoration = previous }
  }, [])
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    document.querySelector('.admin-main')?.scrollTo({ top: 0, behavior: 'instant' })
    if (!hash) return
    const frame = requestAnimationFrame(() => {
      try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ behavior: 'instant', block: 'start' }) } catch { /* Ignore invalid URL fragments. */ }
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname, search, hash, key])
  return null
}
