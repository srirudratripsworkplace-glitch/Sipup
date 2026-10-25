import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { pool } from '../server/pool.js'
import { storeImage, mediaPrefix } from '../server/product-media.js'

const root = new URL('../public/products/', import.meta.url)
async function files(directory, prefix = '') {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...await files(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`))
    else if (entry.name.endsWith('.webp')) result.push(`${prefix}${entry.name}`)
  }
  return result
}

let connection
try {
  connection = await pool.connect()
  await connection.query('START TRANSACTION')
  const images = (await connection.query('SELECT id, image_url FROM product_images ORDER BY id FOR UPDATE')).rows
  const mappings = new Map()
  let totalBytes = 0
  // Preserve all source product assets as well as images currently used by the shop.
  let filenames = []
  try { filenames = await files(root) } catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const filename of filenames) {
    const bytes = await readFile(new URL(filename, root))
    const url = await storeImage(connection, bytes, { preserve: true })
    const saved = (await connection.query('SELECT image_data FROM product_media WHERE sha256 = ?', [url.slice(mediaPrefix.length)])).rows[0]
    if (!bytes.equals(saved.image_data)) throw new Error(`Image bytes changed: ${filename}`)
    mappings.set(`/products/${filename}`, url)
    totalBytes += bytes.length
  }
  let updated = 0
  for (const image of images) {
    if (!image.image_url.startsWith('/products/')) continue
    const url = mappings.get(image.image_url)
    if (!url) throw new Error(`Missing source image for record ${image.id}; no changes committed.`)
    await connection.query('UPDATE product_images SET image_url = ? WHERE id = ?', [url, image.id])
    updated++
  }
  // Verify existing database URLs too, including when rerunning after source files are archived.
  const saved = (await connection.query('SELECT image_url FROM product_images')).rows
  for (const image of saved) {
    if (!image.image_url.startsWith(mediaPrefix)) continue
    const hash = image.image_url.slice(mediaPrefix.length)
    const media = (await connection.query('SELECT image_data FROM product_media WHERE sha256 = ?', [hash])).rows[0]
    if (!media || createHash('sha256').update(media.image_data).digest('hex') !== hash) throw new Error('Database image verification failed.')
  }
  await connection.query('COMMIT')
  console.log(JSON.stringify({ sourceDirectory: fileURLToPath(root), filesStoredAndVerified: filenames.length, totalBytes, imageRecordsUpdated: updated }))
} catch (error) {
  if (connection) await connection.query('ROLLBACK')
  console.error('Product image migration failed:', error.message)
  process.exitCode = 1
} finally {
  connection?.release()
  await pool.end()
}
