export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.name = 'ApiError'; this.status = status }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const readOnly = ['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())
  const attempts = readOnly ? 3 : 1
  for (let attempt = 0; attempt < attempts; attempt++) {
    options.signal?.throwIfAborted()
    const timeout = AbortSignal.timeout(readOnly ? 10_000 : 30_000)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    try {
      const headers = new Headers(options.headers)
      if (options.body && !(options.body instanceof Blob) && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      const response = await fetch(`/api${path}`, {
        ...options, credentials: 'include', headers, signal,
      })
      if (response.status === 204 || (response.ok && options.method?.toUpperCase() === 'HEAD')) return undefined as T
      const body = await response.json().catch((error: unknown) => {
        signal.throwIfAborted()
        if (error instanceof SyntaxError) return null
        throw error
      })
      if (!response.ok) throw new ApiError(body?.error || `Request failed (${response.status}). Please try again.`, response.status)
      if (body === null) throw new ApiError('The server returned an invalid response. Please try again.', 502)
      return body as T
    } catch (error) {
      // Navigation cancellation must not trigger another request or a visible error.
      options.signal?.throwIfAborted()
      const transient = !(error instanceof ApiError) || [500, 502, 503, 504].includes(error.status)
      if (!transient) throw error
      if (attempt === attempts - 1) {
        if (error instanceof ApiError) throw error
        throw new ApiError(timeout.aborted
          ? 'The server took too long to respond. Please try again.'
          : 'Cannot reach the server. Check your connection and try again.', 0)
      }
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(options.signal?.reason) }
        const timer = setTimeout(() => {
          options.signal?.removeEventListener('abort', onAbort)
          resolve()
        }, 400 * (attempt + 1))
        options.signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
  throw new Error('Request did not complete.')
}

export const formatMoney = (pence: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)

export const imageFallback = '/sipup-product.svg'
