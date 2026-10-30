import path from 'path'
import { createRequire } from 'module'

const moduleRequire = createRequire(path.join(process.cwd(), 'package.json'))
const pdfJsPackageRoot = path.dirname(moduleRequire.resolve('pdfjs-dist/package.json'))

export const PDF_CMAP_URL = `${path.join(pdfJsPackageRoot, 'cmaps')}${path.sep}`
export const PDF_STANDARD_FONT_DATA_URL = `${path.join(pdfJsPackageRoot, 'standard_fonts')}${path.sep}`

export async function openPdfDocument(data: Uint8Array) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return getDocument({
    data,
    cMapUrl: PDF_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
  })
}
