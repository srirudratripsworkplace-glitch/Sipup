import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

export const mediaPrefix = '/api/product-media/'
export const mediaPattern = /^\/api\/product-media\/[a-f0-9]{64}$/
const publicRoot = resolve(fileURLToPath(new URL('../public/', import.meta.url)))

export async function storeImage(connection, bytes, { preserve = false } = {}) {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) {
    const error = new Error('Choose an image smaller than 5 MB.'); error.status = 400; throw error
  }
  let data, metadata
  try {
    metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata()
    if (!['jpeg', 'png', 'webp', 'avif', 'gif'].includes(metadata.format)) throw new Error('Unsupported image')
    data = preserve && metadata.format === 'webp' ? bytes : await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
  } catch {
    const error = new Error('Choose a valid JPEG, PNG, WebP, AVIF or GIF image.'); error.status = 400; throw error
  }
  const hash = createHash('sha256').update(data).digest('hex')
  await connection.query('INSERT IGNORE INTO product_media (sha256, mime_type, image_data) VALUES (?, ?, ?)', [hash, 'image/webp', data])
  return `${mediaPrefix}${hash}`
}

export async function persistImageUrl(connection, url) {
  if (mediaPattern.test(url)) {
    const result = await connection.query('SELECT sha256 FROM product_media WHERE sha256 = ?', [url.slice(mediaPrefix.length)])
    if (!result.rowCount) { const error = new Error('Image no longer exists. Upload it again.'); error.status = 400; throw error }
    return url
  }
  if (!url.startsWith('/products/')) return url
  // Only trusted local product assets may be read. Remote URLs remain explicit external references.
  if (!/^\/products\/(?:web\/)?[a-zA-Z0-9-]+\.webp$/.test(url)) {
    const error = new Error('Invalid local product image.'); error.status = 400; throw error
  }
  const filename = resolve(publicRoot, `.${url}`)
  if (!filename.startsWith(`${publicRoot}${sep}`)) throw new Error('Invalid image path')
  try { return await storeImage(connection, await readFile(filename), { preserve: true }) }
  catch (error) {
    if (error.code === 'ENOENT') { error.message = 'Local image is missing. Upload it again.'; error.status = 400 }
    throw error
  }
}
