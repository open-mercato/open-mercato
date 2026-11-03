jest.mock('puppeteer-core', () => ({
  __esModule: true,
  default: { launch: jest.fn() },
}))

const mockGetAuthFromRequest = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => ({}) }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

import { deflateSync } from 'node:zlib'

import {
  applyDocxPageBreakMarkers,
  DOCX_MAX_EMBEDDED_IMAGE_BYTES,
  PDF_MAX_EMBEDDED_IMAGE_BYTES,
  isAllowedPdfAssetRequest,
  POST,
  sanitizeDocxExportContent,
  sanitizePdfExportContent,
} from '../api/[id]/export/route'
import { maxBase64EncodedLength } from '../lib/resourceLimits'

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, checksum])
}

function makePng(options: { width?: number; height?: number; ancillaryBytes?: number } = {}): Buffer {
  const width = options.width ?? 1
  const height = options.height ?? 1
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const ancillary = options.ancillaryBytes
    ? [pngChunk('tEXt', Buffer.concat([
        Buffer.from('note\0', 'ascii'),
        Buffer.alloc(Math.max(0, options.ancillaryBytes - 5)),
      ]))]
    : []
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    ...ancillary,
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

describe('document DOCX export resource policy', () => {
  it('turns only the request-scoped sanitized marker into a Word page break', () => {
    const marker = 'OM_DOCX_PAGE_BREAK_123e4567-e89b-42d3-a456-426614174000'
    expect(applyDocxPageBreakMarkers(
      `<p>Before</p><p>${marker}</p><p>After</p>`,
      marker,
    )).toBe(
      '<p>Before</p><div class="page-break" style="page-break-after: always"></div><p>After</p>',
    )
  })

  it('removes every URL-backed authored image before DOCX rendering', () => {
    const html = sanitizeDocxExportContent([
      '<p>Keep this text</p>',
      '<img src="https://attacker.example/tracker.png" alt="remote">',
      '<img src="http://127.0.0.1:3000/internal.png" alt="loopback">',
      '<img src="/api/documents/11111111-1111-4111-8111-111111111111/attachments/22222222-2222-4222-8222-222222222222" alt="relative">',
    ].join(''))

    expect(html).toContain('Keep this text')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('attacker.example')
    expect(html).not.toContain('127.0.0.1')
    expect(html).not.toContain('/attachments/')
  })

  it('preserves a small embedded raster image without creating a fetchable URL', () => {
    const embedded = `data:image/png;base64,${makePng().toString('base64')}`
    const html = sanitizeDocxExportContent(`<p>Logo</p><img src="${embedded}" alt="logo" width="12">`)

    expect(html).toContain(`<img src="${embedded}" alt="logo" width="12" />`)
    expect(html).not.toContain('docx.invalid')
    expect(html).not.toMatch(/(?:https?:|blob:|src="\/)/i)
  })

  it('drops unsafe data-image formats and images beyond the aggregate bound', () => {
    const oversizedPayload = Buffer.alloc(DOCX_MAX_EMBEDDED_IMAGE_BYTES + 1).toString('base64')
    const html = sanitizeDocxExportContent([
      '<img src="data:image/svg+xml;base64,PHN2Zy8+">',
      `<img src="data:image/png;base64,${oversizedPayload}">`,
      '<p>Safe</p>',
    ].join(''))

    expect(html).toBe('<p>Safe</p>')
  })

  it('drops non-rich-text resource containers and active content', () => {
    const html = sanitizeDocxExportContent(
      '<script src="https://attacker.example/a.js"></script><iframe src="https://attacker.example/"></iframe><p>Safe</p>',
    )

    expect(html).toBe('<p>Safe</p>')
  })

  it('rejects an unauthenticated snapshot POST before parsing its body', async () => {
    // Auth is resolved before the snapshot body is buffered/validated, so an
    // unauthenticated caller cannot make the server process a large payload.
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await POST(
      new Request('http://localhost/api/documents/00000000-0000-4000-8000-000000000000/export?format=docx', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid json',
      }),
      { params: { id: '00000000-0000-4000-8000-000000000000' } },
    )

    expect(response.status).toBe(401)
  })
})

describe('document PDF export request policy', () => {
  it('sanitizes stored HTML and strips fetchable or active content before Chromium', () => {
    const html = sanitizePdfExportContent([
      '<script>location="https://attacker.example/script"</script>',
      '<iframe src="https://attacker.example/frame"></iframe>',
      '<p onclick="alert(1)">Keep this text</p>',
      '<img src="https://attacker.example/tracker.png">',
    ].join(''))

    expect(html).toBe('<p>Keep this text</p>')
  })

  it('preserves sanitizer-safe semantics for record chips and task lists', () => {
    const html = sanitizePdfExportContent([
      '<span data-entity-ref data-entity-id="11111111-1111-4111-8111-111111111111">Widget</span>',
      '<ul data-type="taskList"><li data-checked="true"><label><input type="checkbox" checked></label><div><p>Done</p></div></li></ul>',
    ].join(''))

    expect(html).toContain('<strong><code><span>Widget</span></code></strong>')
    expect(html).toContain('<ul><li><label><input type="checkbox" checked />')
    expect(html).not.toContain('data-entity-id')
  })

  it('preserves default and authored highlight colors through sanitization', () => {
    const html = sanitizePdfExportContent(
      '<p><mark>Default</mark> <mark style="background-color:#86efac">Green</mark></p>',
    )

    expect(html).toContain('<span style="background-color:#fef08a">Default</span>')
    expect(html).toContain('<span style="background-color:#86efac">Green</span>')
    expect(html).not.toContain('<mark')
  })

  it('promotes a leading TipTap header row for repeated PDF table headings', () => {
    const html = sanitizePdfExportContent(
      '<table style="width:640px"><tbody><tr><th><p>Name</p></th><th><p>Value</p></th></tr><tr><td>A</td><td>1</td></tr></tbody></table>',
    )

    expect(html).toContain('<table style="width:640px">')
    expect(html).toContain('<thead><tr><th><p>Name</p></th><th><p>Value</p></th></tr></thead>')
    expect(html).toContain('<tbody><tr><td>A</td><td>1</td></tr></tbody>')
  })

  it('enforces the decoded aggregate raster bound before rendering', () => {
    const minimalPngLength = makePng().length
    const firstPayload = makePng({
      ancillaryBytes: PDF_MAX_EMBEDDED_IMAGE_BYTES - minimalPngLength - 12,
    }).toString('base64')
    const secondPayload = makePng().toString('base64')
    const html = sanitizePdfExportContent([
      `<img src="data:image/png;base64,${firstPayload}" alt="first">`,
      `<img src="data:image/png;base64,${secondPayload}" alt="second">`,
    ].join(''))

    expect(html.match(/<img\b/g)).toHaveLength(1)
    expect(html).toContain('alt="first"')
    expect(html).not.toContain('alt="second"')
  })

  it('blocks every top-level or frame navigation, including data documents', () => {
    expect(isAllowedPdfAssetRequest({
      url: 'https://attacker.example/collect',
      resourceType: 'document',
      isNavigationRequest: true,
    })).toBe(false)
    expect(isAllowedPdfAssetRequest({
      url: 'data:text/html,<script>location="https://attacker.example"</script>',
      resourceType: 'document',
      isNavigationRequest: true,
    })).toBe(false)
  })

  it('blocks remote subresources and non-image data payloads', () => {
    expect(isAllowedPdfAssetRequest({
      url: 'https://attacker.example/tracker.png',
      resourceType: 'image',
      isNavigationRequest: false,
    })).toBe(false)
    expect(isAllowedPdfAssetRequest({
      url: 'data:text/javascript,alert(1)',
      resourceType: 'script',
      isNavigationRequest: false,
    })).toBe(false)
  })

  it('allows only embedded raster image payloads in image context', () => {
    const validPng = makePng().toString('base64')
    expect(isAllowedPdfAssetRequest({
      url: `data:image/png;base64,${validPng}`,
      resourceType: 'image',
      isNavigationRequest: false,
    })).toBe(true)
    expect(isAllowedPdfAssetRequest({
      url: 'data:image/svg+xml;base64,PHN2Zy8+',
      resourceType: 'image',
      isNavigationRequest: false,
    })).toBe(false)
    expect(isAllowedPdfAssetRequest({
      url: 'data:image/png;base64,not-valid-***',
      resourceType: 'image',
      isNavigationRequest: false,
    })).toBe(false)
    expect(isAllowedPdfAssetRequest({
      url: `data:image/png;base64,${Buffer.alloc(PDF_MAX_EMBEDDED_IMAGE_BYTES + 1).toString('base64')}`,
      resourceType: 'image',
      isNavigationRequest: false,
    })).toBe(false)
  })

  it('rejects malformed raster bytes and decompression-bomb dimensions', () => {
    expect(isAllowedPdfAssetRequest({
      url: `data:image/png;base64,${Buffer.from('not a png').toString('base64')}`,
      resourceType: 'image',
      isNavigationRequest: false,
    })).toBe(false)
    expect(isAllowedPdfAssetRequest({
      url: `data:image/png;base64,${makePng({ width: 4097 }).toString('base64')}`,
      resourceType: 'image',
      isNavigationRequest: false,
    })).toBe(false)
  })

  it('checks encoded size before allocating a decoded raster buffer', () => {
    const oversizedEncoded = 'A'.repeat(maxBase64EncodedLength(PDF_MAX_EMBEDDED_IMAGE_BYTES) + 4)
    const decodeSpy = jest.spyOn(Buffer, 'from')

    expect(isAllowedPdfAssetRequest({
      url: `data:image/png;base64,${oversizedEncoded}`,
      resourceType: 'image',
      isNavigationRequest: false,
    })).toBe(false)
    expect(decodeSpy).not.toHaveBeenCalled()
    decodeSpy.mockRestore()
  })
})
