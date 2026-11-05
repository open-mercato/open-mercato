/** @jest-environment jsdom */
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { inflateSync } from 'node:zlib'

const assetDirectory = join(__dirname, '../assets')
function imageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? imageFiles(path) : /\.(svg|png)$/i.test(entry.name) ? [path] : []
  })
}
const files = imageFiles(assetDirectory)

it('finds the source image library', () => {
  expect(files.length).toBeGreaterThan(0)
})

it.each(files.map(path => [relative(assetDirectory, path), path]))('loads valid source artwork: %s', (_, path) => {
  const bytes = readFileSync(path)
  expect(bytes.length).toBeGreaterThan(0)
  if (extname(path).toLowerCase() === '.svg') {
    const document = new DOMParser().parseFromString(bytes.toString('utf8'), 'image/svg+xml')
    expect(document.querySelector('parsererror')).toBeNull()
    expect(document.documentElement.localName).toBe('svg')
    expect(document.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg')
    return
  }
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR')
  expect(bytes.readUInt32BE(16)).toBeGreaterThan(0)
  expect(bytes.readUInt32BE(20)).toBeGreaterThan(0)
  const compressed: Buffer[] = []
  let offset = 8
  let ended = false
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    expect(offset + size + 12).toBeLessThanOrEqual(bytes.length)
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + size))
    offset += size + 12
    if (type === 'IEND') {
      ended = true
      break
    }
  }
  expect(ended).toBe(true)
  expect(offset).toBe(bytes.length)
  expect(compressed.length).toBeGreaterThan(0)
  expect(inflateSync(Buffer.concat(compressed)).length).toBeGreaterThan(0)
})
