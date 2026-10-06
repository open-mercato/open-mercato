/** @jest-environment node */
import {
  hashVectorImage,
  inspectVectorImageCss,
  isTrustedVectorImage,
  isVectorImageUploadCandidate,
  prepareVectorImageUpload,
  sanitizeVectorImage,
  VECTOR_IMAGE_MAX_BYTES,
  VECTOR_IMAGE_MAX_DEPTH,
  VECTOR_IMAGE_MAX_ELEMENTS,
  VECTOR_IMAGE_METADATA_KEY,
  VECTOR_IMAGE_POLICY_VERSION,
} from '../vector-image'
import {
  BENIGN_LOGO,
  EDITOR_EXPORT_LOGO,
  MALICIOUS_FIXTURES,
  nestedUseBomb,
  TINY_PNG_BASE64,
} from './vector-image.fixtures'

const svgBuffer = (svg: string) => Buffer.from(svg, 'utf8')

async function sanitisedText(svg: string): Promise<string> {
  const result = await sanitizeVectorImage(svgBuffer(svg))
  if (!result.ok) throw new Error(`[internal] expected sanitisation to succeed, got ${result.code}`)
  return result.buffer.toString('utf8')
}

describe('sanitizeVectorImage — malicious documents', () => {
  it.each(MALICIOUS_FIXTURES.filter((fixture) => fixture.code !== 'vector_image_entity_declaration'))(
    'strips the payload of: $name',
    async ({ svg, payload }) => {
      const output = await sanitisedText(svg)
      expect(output).not.toMatch(payload)
      expect(output).toMatch(/^<svg[\s>]/)
    },
  )

  it.each(MALICIOUS_FIXTURES)('rejects the upload of: $name with $code', async ({ svg, code }) => {
    const prepared = await prepareVectorImageUpload(svgBuffer(svg))
    expect(prepared.ok).toBe(false)
    if (!prepared.ok) expect(prepared.code).toBe(code)
  })
})

describe('sanitizeVectorImage — benign logos', () => {
  it('keeps style blocks, gradients, clip paths, masks, in-document use and embedded rasters intact', async () => {
    const prepared = await prepareVectorImageUpload(svgBuffer(BENIGN_LOGO))
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.removals.filter((removal) => removal.kind !== 'inert')).toEqual([])
    const output = prepared.buffer.toString('utf8')
    expect(output).toContain('viewBox="0 0 200 80"')
    expect(output).toContain('preserveAspectRatio="xMidYMid meet"')
    expect(output).toContain('.mark{fill:url(#brand-gradient)')
    expect(output).toMatch(/<linearGradient id="brand-gradient"/)
    expect(output).toMatch(/<radialGradient id="glow"/)
    expect(output).toMatch(/<clipPath id="badge-clip">/)
    expect(output).toMatch(/<mask id="fade">/)
    expect(output).toContain('clip-path="url(#badge-clip)"')
    expect(output).toContain('fill="url(#glow)"')
    expect(output).toContain('mask="url(#fade)"')
    expect(output).toContain('href="#leaf"')
    expect(output).toContain('xlink:href="#leaf"')
    expect(output).toContain(`href="data:image/png;base64,${TINY_PNG_BASE64}"`)
    expect(output).toContain('style="letter-spacing:1px"')
    expect(output).toContain('<title>Brand mark</title>')
    expect(output.match(/<use /g)?.length).toBe(2)
  })

  it('drops only inert editor data from an editor export and keeps the drawing', async () => {
    const prepared = await prepareVectorImageUpload(svgBuffer(EDITOR_EXPORT_LOGO))
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const output = prepared.buffer.toString('utf8')
    expect(output).not.toMatch(/sodipodi|inkscape|rdf:|<metadata|DOCTYPE|<!--/i)
    expect(output).toContain('d="M8 8 H56 V56 H8 Z"')
    expect(output).toContain('style="fill:#2a9d8f;stroke:none"')
    expect(prepared.removals.length).toBeGreaterThan(0)
    expect(prepared.removals.every((removal) => removal.kind === 'inert')).toBe(true)
  })

  it('is idempotent: sanitising sanitised output removes nothing', async () => {
    for (const svg of [BENIGN_LOGO, EDITOR_EXPORT_LOGO]) {
      const once = await sanitizeVectorImage(svgBuffer(svg))
      expect(once.ok).toBe(true)
      if (!once.ok) continue
      const twice = await sanitizeVectorImage(once.buffer)
      expect(twice.ok).toBe(true)
      if (!twice.ok) continue
      expect(twice.removals).toEqual([])
      expect(twice.buffer.toString('utf8')).toBe(once.buffer.toString('utf8'))
    }
  })

  it('records the sanitiser, its version, the policy version and the digest of the stored bytes', async () => {
    const now = new Date('2026-10-05T10:00:00.000Z')
    const prepared = await prepareVectorImageUpload(svgBuffer(BENIGN_LOGO), now)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.record).toEqual({
      sanitizer: 'dompurify',
      sanitizerVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
      policyVersion: VECTOR_IMAGE_POLICY_VERSION,
      sha256: hashVectorImage(prepared.buffer),
      sanitizedAt: now.toISOString(),
    })
  })
})

describe('sanitizeVectorImage — bounds and well-formedness', () => {
  it('rejects documents over the byte bound', async () => {
    const padding = 'x'.repeat(VECTOR_IMAGE_MAX_BYTES)
    const result = await sanitizeVectorImage(svgBuffer(`<svg xmlns="http://www.w3.org/2000/svg"><desc>${padding}</desc></svg>`))
    expect(result).toMatchObject({ ok: false, code: 'vector_image_too_large' })
  })

  it('rejects documents with too many elements', async () => {
    const rects = '<rect width="1" height="1"/>'.repeat(VECTOR_IMAGE_MAX_ELEMENTS + 1)
    const result = await sanitizeVectorImage(svgBuffer(`<svg xmlns="http://www.w3.org/2000/svg">${rects}</svg>`))
    expect(result).toMatchObject({ ok: false, code: 'vector_image_too_complex' })
  })

  it('rejects documents nested too deeply', async () => {
    const depth = VECTOR_IMAGE_MAX_DEPTH + 1
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${'<g>'.repeat(depth)}${'</g>'.repeat(depth)}</svg>`
    const result = await sanitizeVectorImage(svgBuffer(svg))
    expect(result).toMatchObject({ ok: false, code: 'vector_image_too_complex' })
  })

  it('rejects exponential in-document <use> expansion', async () => {
    const result = await sanitizeVectorImage(svgBuffer(nestedUseBomb(6, 10)))
    expect(result).toMatchObject({ ok: false, code: 'vector_image_too_complex' })
  })

  it('rejects <use> reference cycles', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></svg>'
    const result = await sanitizeVectorImage(svgBuffer(svg))
    expect(result).toMatchObject({ ok: false, code: 'vector_image_too_complex' })
  })

  it('accepts modest in-document <use> reuse', async () => {
    const result = await sanitizeVectorImage(svgBuffer(nestedUseBomb(2, 5)))
    expect(result.ok).toBe(true)
  })

  it.each([
    ['not well-formed XML', '<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>'],
    ['an HTML document', '<html><body><svg></svg></body></html>'],
    ['an svg root outside the SVG namespace', '<svg><rect width="1" height="1"/></svg>'],
    ['plain text', 'just a logo'],
  ])('rejects %s as malformed', async (_label, text) => {
    const result = await sanitizeVectorImage(svgBuffer(text))
    expect(result).toMatchObject({ ok: false, code: 'vector_image_malformed' })
  })

  it('rejects bytes that are not UTF-8', async () => {
    const result = await sanitizeVectorImage(Buffer.from([0x3c, 0x73, 0x76, 0x67, 0xff, 0xfe, 0x3e]))
    expect(result).toMatchObject({ ok: false, code: 'vector_image_malformed' })
  })
})

describe('inspectVectorImageCss', () => {
  it.each([
    ['fill:url(#gradient)', null],
    ['fill:url("#gradient")', null],
    [`background:url(data:image/png;base64,${TINY_PNG_BASE64})`, null],
    ['fill:#123456;stroke-width:2', null],
    ['fill:url(https://example.com/p.svg#p)', 'external_reference'],
    ['fill:url(//example.com/p.svg#p)', 'external_reference'],
    ['fill:url(p.svg#p)', 'external_reference'],
    ['@import "https://example.com/x.css";', 'external_reference'],
    ['@IMPORT url(x.css);', 'external_reference'],
    ['mask-image:-webkit-image-set("https://example.com/m.png" 1x)', 'external_reference'],
    ['fill:url(https://example.com/p.svg', 'external_reference'],
    ['fill:u\\72l(https://example.com/p.svg)', 'active_content'],
    ['width:expression(alert(1))', 'active_content'],
    ['fill:url(javascript:alert(1))', 'active_content'],
    ['fill:/* comment */url(#ok)', null],
  ])('classifies %s', (css, expected) => {
    expect(inspectVectorImageCss(css)).toBe(expected)
  })
})

describe('isVectorImageUploadCandidate', () => {
  const svg = svgBuffer('<svg xmlns="http://www.w3.org/2000/svg"/>')

  it('accepts the .svg extension', () => {
    expect(isVectorImageUploadCandidate(svg, 'logo.svg', null)).toBe(true)
  })

  it('accepts an extension-less SVG by declared or sniffed type', () => {
    expect(isVectorImageUploadCandidate(svg, 'logo', 'image/svg+xml')).toBe(true)
    expect(isVectorImageUploadCandidate(svg, 'logo', null)).toBe(true)
  })

  it.each(['logo.html', 'logo.xhtml', 'logo.xml', 'logo.htm'])('never accepts %s, whatever the content', (name) => {
    expect(isVectorImageUploadCandidate(svg, name, 'image/svg+xml')).toBe(false)
  })
})

describe('isTrustedVectorImage', () => {
  const bytes = svgBuffer('<svg xmlns="http://www.w3.org/2000/svg"/>')
  const record = {
    sanitizer: 'dompurify',
    sanitizerVersion: '3.4.11',
    policyVersion: VECTOR_IMAGE_POLICY_VERSION,
    sha256: hashVectorImage(bytes),
    sanitizedAt: '2026-10-05T10:00:00.000Z',
  }

  it('trusts a recorded vector image whose bytes match the digest', () => {
    expect(isTrustedVectorImage({ mimeType: 'image/svg+xml', storageMetadata: { [VECTOR_IMAGE_METADATA_KEY]: record } }, bytes)).toBe(true)
  })

  it('does not trust tampered bytes', () => {
    const tampered = svgBuffer('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
    expect(isTrustedVectorImage({ mimeType: 'image/svg+xml', storageMetadata: { [VECTOR_IMAGE_METADATA_KEY]: record } }, tampered)).toBe(false)
  })

  it('does not trust an SVG row without a record', () => {
    expect(isTrustedVectorImage({ mimeType: 'image/svg+xml', storageMetadata: { tags: [] } }, bytes)).toBe(false)
    expect(isTrustedVectorImage({ mimeType: 'image/svg+xml', storageMetadata: null }, bytes)).toBe(false)
  })

  it('does not trust a record with an unknown sanitiser or policy version', () => {
    const unknownSanitizer = { ...record, sanitizer: 'other' }
    const unknownPolicy = { ...record, policyVersion: 999 }
    expect(isTrustedVectorImage({ mimeType: 'image/svg+xml', storageMetadata: { [VECTOR_IMAGE_METADATA_KEY]: unknownSanitizer } }, bytes)).toBe(false)
    expect(isTrustedVectorImage({ mimeType: 'image/svg+xml', storageMetadata: { [VECTOR_IMAGE_METADATA_KEY]: unknownPolicy } }, bytes)).toBe(false)
  })

  it('does not trust a record on a non-SVG row', () => {
    expect(isTrustedVectorImage({ mimeType: 'text/html', storageMetadata: { [VECTOR_IMAGE_METADATA_KEY]: record } }, bytes)).toBe(false)
  })
})
