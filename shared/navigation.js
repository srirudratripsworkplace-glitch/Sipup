export function safeStorefrontRedirect(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/account'
  try {
    const url = new URL(value, 'https://sipup.invalid')
    if (url.origin !== 'https://sipup.invalid') return '/account'
    if (!/^\/(?:shop|cart|checkout)?$/.test(url.pathname) && !/^\/(?:product|category)\/[a-z0-9_-]+$/i.test(url.pathname)) return '/account'
    return url.pathname + url.search + url.hash
  } catch { return '/account' }
}

export function readPendingBagItem(value, now = Date.now()) {
  try {
    const item = JSON.parse(value || 'null')
    if (!item || typeof item.slug !== 'string' || !/^[a-z0-9_-]+$/i.test(item.slug) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.createdAt) || now - item.createdAt > 15 * 60_000 || item.createdAt > now) return null
    const redirect = safeStorefrontRedirect(item.redirect)
    if (redirect === '/account') return null
    return { ...item, redirect }
  } catch { return null }
}
