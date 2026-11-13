import fs from 'node:fs'
import path from 'node:path'

// Regression guard for https://github.com/open-mercato/open-mercato/issues/6398:
// When pdfjs-dist is bundled into a server chunk, its fake worker imports
// pdf.worker.mjs from the chunks folder, which the build never emits. PDF text
// extraction and OCR then return nothing in production builds.
describe('apps/mercato next.config serverExternalPackages', () => {
  const nextConfigSource = fs.readFileSync(
    path.resolve(__dirname, '../../next.config.ts'),
    'utf8',
  )

  const externalsBlock = nextConfigSource.match(/serverExternalPackages:\s*\[([\s\S]*?)\]/)?.[1] ?? ''

  it('keeps pdfjs-dist external so its worker resolves from node_modules', () => {
    expect(externalsBlock).toContain("'pdfjs-dist'")
  })
})
