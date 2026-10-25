import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import yauzl from 'yauzl'
import sharp from 'sharp'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

export const hash = (data) => createHash('sha256').update(data).digest('hex')
export function safeEntry(name) {
  if (/^[A-Za-z]:|^[\\/]|\\|\x00/.test(name) || name.split('/').includes('..')) throw new Error('Unsafe ZIP entry path.')
}
export async function readCatalogueZip(path) {
  const buffer = await readFile(path)
  if (!buffer.length) throw new Error(`Catalogue file is empty: ${path}`)
  if (buffer.length > 60_000_000) throw new Error('ZIP exceeds 60MB.')
  return new Promise((done, fail) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
    if (error) return fail(error)
    let pdf, total = 0, count = 0
    const reject = (e) => { zip.close(); fail(e) }
    zip.on('error', reject)
    zip.on('entry', (entry) => {
      try {
        safeEntry(entry.fileName)
        total += entry.uncompressedSize
        if (++count > 1000 || total > 100_000_000 || entry.generalPurposeBitFlag & 1
          || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('Unsupported or oversized ZIP entry.')
        if (!/\.pdf$/i.test(entry.fileName)) return zip.readEntry()
        if (pdf) throw new Error('Expected exactly one PDF catalogue.')
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e)
          const chunks = []; let bytes = 0
          stream.on('data', (chunk) => { bytes += chunk.length; if (bytes > 60_000_000) stream.destroy(new Error('PDF exceeds 60MB.')); else chunks.push(chunk) })
          stream.on('error', reject)
          stream.on('end', () => { pdf = Buffer.concat(chunks); zip.readEntry() })
        })
      } catch (e) { reject(e) }
    })
    zip.on('end', () => {
      if (!pdf || pdf.subarray(0, 5).toString() !== '%PDF-') return fail(new Error('No valid PDF found in ZIP.'))
      done({ pdf, zipHash: hash(buffer) })
    })
    zip.readEntry()
  }))
}

function multiply(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]]
}

export async function extractCatalogue(zipPath, output) {
  await mkdir(join(output, 'images'), { recursive: true })
  await mkdir(join(output, 'sources'), { recursive: true })
  const { pdf, zipHash } = await readCatalogueZip(zipPath)
  await writeFile(join(output, 'catalogue.pdf'), pdf)
  const task = getDocument({ data: new Uint8Array(pdf), isEvalSupported: false,
    wasmUrl: resolve('node_modules/pdfjs-dist/wasm').replaceAll('\\', '/') + '/',
    standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' })
  const doc = await task.promise
  const pages = [], assets = []
  try {
    if (doc.numPages > 100) throw new Error('PDF exceeds 100 pages.')
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const texts = content.items.filter((i) => i.str?.trim()).map((i) => ({ text: i.str, x: i.transform[4], y: i.transform[5], width: i.width, height: i.height }))
      const ops = await page.getOperatorList()
      const stack = []; let matrix = [1,0,0,1,0,0], occurrence = 0
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i], args = ops.argsArray[i]
        if (fn === OPS.save) stack.push([...matrix])
        else if (fn === OPS.restore) matrix = stack.pop() || [1,0,0,1,0,0]
        else if (fn === OPS.transform) matrix = multiply(matrix, args)
        else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
          const object = args[0]
          const image = typeof object === 'string' ? await new Promise((r) => (object.startsWith('g_') ? page.commonObjs : page.objs).get(object, r)) : object
          if (!image?.data || image.width * image.height > 30_000_000 || ![2,3].includes(image.kind)) continue
          const x = Math.min(matrix[4], matrix[4]+matrix[0], matrix[4]+matrix[2], matrix[4]+matrix[0]+matrix[2])
          const y = Math.min(matrix[5], matrix[5]+matrix[1], matrix[5]+matrix[3], matrix[5]+matrix[1]+matrix[3])
          const width = Math.abs(matrix[0])+Math.abs(matrix[2]), height = Math.abs(matrix[1])+Math.abs(matrix[3])
          const id = `p${n}-${++occurrence}`
          const raster = sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: image.kind === 2 ? 3 : 4 } })
          await raster.clone().png().toFile(join(output, 'sources', `${id}.png`))
          const webp = await raster
            .trim({ threshold: 8 }).resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer()
          const digest = hash(webp), filename = `${digest}.webp`
          await writeFile(join(output, 'images', filename), webp)
          assets.push({ id, page: n, filename, hash: digest, x, y, width, height,
            pixelWidth: image.width, pixelHeight: image.height, bytes: webp.length })
        }
      }
      pages.push({ page: n, texts })
      page.cleanup()
    }
  } finally { await task.destroy() }
  const inventory = { zipHash, pdfHash: hash(pdf), pages, assets }
  await writeFile(join(output, 'image-inventory.json'), JSON.stringify(inventory, null, 2))
  return inventory
}
