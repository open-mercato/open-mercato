/** @jest-environment node */
import {
  hashVectorImage,
  inspectVectorImageCss,
  isTrustedVectorImage,
  isVectorImageUploadCandidate,
  prepareVectorImageUpload,
  sanitizeVectorImage,
  VECTOR_IMAGE_MAX_ATTRIBUTES,
  VECTOR_IMAGE_MAX_ATTRIBUTES_PER_ELEMENT,
  VECTOR_IMAGE_MAX_BYTES,
  VECTOR_IMAGE_MAX_DEPTH,
  VECTOR_IMAGE_MAX_ELEMENTS,
  VECTOR_IMAGE_MAX_MARKUP,
  VECTOR_IMAGE_MAX_NODES,
  VECTOR_IMAGE_METADATA_KEY,
  VECTOR_IMAGE_POLICY_VERSION,
} from '../vector-image'
import {
  ACCESSIBLE_LOGO,
  BENIGN_LOGO,
  CDATA_STYLED_LOGO,
  CLOBBERING_ID_LOGO,
  EDITOR_EXPORT_LOGO,
  FILTERED_RASTER_LOGO,
  INKSCAPE_LOGO,
  INKSCAPE_PLAIN_LOGO,
  MALICIOUS_FIXTURES,
  MASKED_LOGO,
  nestedUseBomb,
  NON_STANDARD_XLINK_PREFIX_LOGO,
  TINY_PNG_BASE64,
} from './vector-image.fixtures'

const svgBuffer = (svg: string) => Buffer.from(svg, 'utf8')

async function sanitisedText(svg: string): Promise<string> {
  const result = await sanitizeVectorImage(svgBuffer(svg))
  if (!result.ok) throw new Error(`[internal] expected sanitisation to succeed, got ${result.code}`)
  return result.buffer.toString('utf8')
}

describe('sanitizeVectorImage — malicious documents', () => {
  it.each(MALICIOUS_FIXTURES)('refuses $name at the sanitiser with $code and returns no document', async ({ svg, code }) => {
    const result = await sanitizeVectorImage(svgBuffer(svg))
    expect(result).toMatchObject({ ok: false, code })
    expect(result).not.toHaveProperty('buffer')
  })

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

  it('keeps a mask-based logo intact', async () => {
    const prepared = await prepareVectorImageUpload(svgBuffer(MASKED_LOGO))
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.removals).toEqual([])
    const output = prepared.buffer.toString('utf8')
    expect(output).toContain('<mask id="reveal" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">')
    expect(output).toContain('<rect width="120" height="120" fill="white"/>')
    expect(output).toContain('<circle cx="60" cy="60" r="24" fill="black"/>')
    expect(output).toContain('<g mask="url(#reveal)">')
  })

  it('keeps an feImage filter carrying an embedded PNG', async () => {
    const prepared = await prepareVectorImageUpload(svgBuffer(FILTERED_RASTER_LOGO))
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.removals).toEqual([])
    const output = prepared.buffer.toString('utf8')
    expect(output).toContain(`<feImage href="data:image/png;base64,${TINY_PNG_BASE64}" result="grain" preserveAspectRatio="none"/>`)
    expect(output).toContain('<feComposite in="SourceGraphic" in2="grain" operator="in"/>')
    expect(output).toContain('filter="url(#texture)"')
  })

  it('keeps a CDATA-wrapped style block from a design-tool export', async () => {
    const prepared = await prepareVectorImageUpload(svgBuffer(CDATA_STYLED_LOGO))
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.removals.filter((removal) => removal.kind !== 'inert')).toEqual([])
    const output = prepared.buffer.toString('utf8')
    expect(output).toContain('.st0{fill:#E30613;}')
    expect(output).toContain('.st1{fill:#1D1D1B;}')
    expect(output).toMatch(/g &gt; \.st1\{stroke:none;\}|g > \.st1\{stroke:none;\}/)
    expect(output).toContain('class="st0"')
  })

  it('still inspects CSS that arrives inside CDATA', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[ rect{fill:url(https://evil.example/p.svg#p)} ]]></style><rect width="1" height="1"/></svg>'
    const prepared = await prepareVectorImageUpload(svgBuffer(svg))
    expect(prepared).toMatchObject({ ok: false, code: 'vector_image_external_reference' })
  })

  it.each([
    ['an Inkscape SVG export', INKSCAPE_LOGO],
    ['an Inkscape plain SVG export', INKSCAPE_PLAIN_LOGO],
  ])('keeps %s, dropping only editor data', async (_label, svg) => {
    const prepared = await prepareVectorImageUpload(svgBuffer(svg))
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.removals.every((removal) => removal.kind === 'inert')).toBe(true)
    const output = prepared.buffer.toString('utf8')
    expect(output).toContain('style="fill:#2a9d8f;stroke:none;stroke-width:0.264583"')
    expect(output).toContain('viewBox="0 0 64 64"')
    expect(output).not.toMatch(/sodipodi|inkscape:/)
  })

  it('keeps an XLink reference written with a prefix other than xlink', async () => {
    const prepared = await prepareVectorImageUpload(svgBuffer(NON_STANDARD_XLINK_PREFIX_LOGO))
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.buffer.toString('utf8')).toContain('xlink:href="#leaf"')
  })

  it('keeps ids that clash with document properties, and the references to them', async () => {
    const prepared = await prepareVectorImageUpload(svgBuffer(CLOBBERING_ID_LOGO))
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const output = prepared.buffer.toString('utf8')
    for (const id of ['title', 'body', 'images', 'links', 'fonts', 'style', 'name', 'action']) {
      expect(output).toContain(`<linearGradient id="${id}">`)
      expect(output).toContain(`fill="url(#${id})"`)
    }
  })

  it('keeps the accessible-name pattern: role, aria-labelledby and the ids it points at', async () => {
    const prepared = await prepareVectorImageUpload(svgBuffer(ACCESSIBLE_LOGO))
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const output = prepared.buffer.toString('utf8')
    expect(output).toContain('role="img"')
    expect(output).toContain('aria-labelledby="title desc"')
    expect(output).toContain('<title id="title">Brand</title>')
    expect(output).toContain('<desc id="desc">The brand mark</desc>')
  })

  it('accepts non-ASCII spaces at the edges of an attribute that carries no reference', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" aria-label="　Brand"/></svg>'
    const prepared = await prepareVectorImageUpload(svgBuffer(svg))
    expect(prepared.ok).toBe(true)
  })

  it('keeps an unquoted url() with ASCII whitespace around an in-document target', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="a"/></defs><style>rect{fill:url( #a )}</style><rect width="1" height="1"/></svg>'
    const prepared = await prepareVectorImageUpload(svgBuffer(svg))
    expect(prepared.ok).toBe(true)
  })

  it('keeps a <style> that mentions a DOCTYPE inside a CSS comment in CDATA', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[ .a{fill:#000} /* <!DOCTYPE svg [ */ ]]></style><rect class="a"/></svg>'
    const prepared = await prepareVectorImageUpload(svgBuffer(svg))
    expect(prepared.ok).toBe(true)
  })

  it('keeps CDATA text outside <style> as text', async () => {
    const output = await sanitisedText('<svg xmlns="http://www.w3.org/2000/svg"><text><![CDATA[Brand & Co]]></text></svg>')
    expect(output).toContain('<text>Brand &amp; Co</text>')
  })

  it('accepts href and xlink:href that agree, and follows href', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><path id="leaf" d="M0 0h1"/></defs><use href="#leaf" xlink:href="#leaf"/></svg>'
    const prepared = await prepareVectorImageUpload(svgBuffer(svg))
    expect(prepared.ok).toBe(true)
  })

  it('reports only inert removals for a stored document', async () => {
    for (const svg of [BENIGN_LOGO, EDITOR_EXPORT_LOGO, CDATA_STYLED_LOGO]) {
      const result = await sanitizeVectorImage(svgBuffer(svg))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.removals.every((removal) => removal.kind === 'inert')).toBe(true)
    }
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
    for (const svg of [BENIGN_LOGO, EDITOR_EXPORT_LOGO, MASKED_LOGO, FILTERED_RASTER_LOGO]) {
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

  it('rejects a document whose serialised form outgrows the byte bound', async () => {
    const escapesOnOutput = '>'.repeat(300_000)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><desc>${escapesOnOutput}</desc></svg>`
    expect(Buffer.byteLength(svg)).toBeLessThan(VECTOR_IMAGE_MAX_BYTES)
    const result = await sanitizeVectorImage(svgBuffer(svg))
    expect(result).toMatchObject({ ok: false, code: 'vector_image_too_large' })
  })

  it('rejects documents with too many elements', async () => {
    const rects = '<rect width="1" height="1"/>'.repeat(VECTOR_IMAGE_MAX_ELEMENTS + 1)
    const result = await sanitizeVectorImage(svgBuffer(`<svg xmlns="http://www.w3.org/2000/svg">${rects}</svg>`))
    expect(result).toMatchObject({ ok: false, code: 'vector_image_too_complex' })
  })

  it('rejects an element carrying more attributes than the per-element bound', async () => {
    const attributes = Array.from({ length: VECTOR_IMAGE_MAX_ATTRIBUTES_PER_ELEMENT + 1 }, (_, index) => `a${index}="1"`).join(' ')
    const result = await sanitizeVectorImage(svgBuffer(`<svg xmlns="http://www.w3.org/2000/svg"><rect ${attributes}/></svg>`))
    expect(result).toMatchObject({ ok: false, code: 'vector_image_too_complex' })
  })

  it('rejects documents carrying more attributes than the document bound', async () => {
    const perElement = 10
    const elements = Math.floor(VECTOR_IMAGE_MAX_ATTRIBUTES / perElement) + 1
    const rect = `<rect ${Array.from({ length: perElement }, (_, index) => `a${index}="1"`).join(' ')}/>`
    const result = await sanitizeVectorImage(svgBuffer(`<svg xmlns="http://www.w3.org/2000/svg">${rect.repeat(elements)}</svg>`))
    expect(result).toMatchObject({ ok: false, code: 'vector_image_too_complex' })
  })

  it('rejects documents with more nodes of any type than the node bound', async () => {
    const pairs = Math.ceil(VECTOR_IMAGE_MAX_NODES / 2) + 1
    const result = await sanitizeVectorImage(svgBuffer(`<svg xmlns="http://www.w3.org/2000/svg"><text>${'a<!---->'.repeat(pairs)}</text></svg>`))
    expect(result).toMatchObject({ ok: false, code: 'vector_image_too_complex' })
  })

  it('rejects documents with more markup than the markup bound before parsing them', async () => {
    const result = await sanitizeVectorImage(svgBuffer(`<svg xmlns="http://www.w3.org/2000/svg">${'<?a?>'.repeat(VECTOR_IMAGE_MAX_MARKUP)}</svg>`))
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

describe('sanitizeVectorImage — bounded cost', () => {
  /**
   * Every pass is linear in the document, the first non-inert finding stops
   * the work, and the bounds cap the document — by bytes, markup before
   * parsing, nodes of every type, elements, depth and attributes. Warm worst
   * cases measured at these bounds, one call per macrotask on a loaded
   * laptop, were 0.04-0.44 s. The pre-fix quadratic shapes took 2.5-27 s at
   * sizes the bounds now refuse. The ceiling is more than ten times the
   * measured worst case, so a slow CI runner cannot flake it, while a return
   * of super-linear behaviour fails it.
   */
  const CEILING_MS = 5_000
  const open = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="urn:example:editor" viewBox="0 0 10 10">'
  const wrap = (body: string) => `${open}${body}</svg>`
  const elements = VECTOR_IMAGE_MAX_ELEMENTS - 10
  const pairs = Math.min(VECTOR_IMAGE_MAX_MARKUP, Math.floor(VECTOR_IMAGE_MAX_NODES / 2)) - 12
  const flat = Math.min(VECTOR_IMAGE_MAX_MARKUP, VECTOR_IMAGE_MAX_NODES) - 12
  const attributesPerElement = Math.floor(VECTOR_IMAGE_MAX_ATTRIBUTES / elements)
  const unknownAttributes = (count: number, prefix = 'a') => Array.from({ length: count }, (_, index) => `${prefix}${index}="1"`).join(' ')
  const worstCases: Array<[string, string, boolean]> = [
    ['flat elements at the element and attribute bounds', wrap(`<rect ${unknownAttributes(attributesPerElement)}/>`.repeat(elements)), true],
    ['paths with url() paint at the attribute bound', wrap(`<defs><linearGradient id="g"/></defs>${'<path d="M0 0h1v1z" fill="url(#g)" stroke="url(#g)" class="c" transform="translate(1 1)"/>'.repeat(Math.min(elements, Math.floor(VECTOR_IMAGE_MAX_ATTRIBUTES / 5) - 2))}`), true],
    ['rects with five kept presentation attributes at the attribute bound', wrap('<rect x="1" y="1" width="1" height="1" fill="#123456"/>'.repeat(Math.floor(VECTOR_IMAGE_MAX_ATTRIBUTES / 5) - 2)), true],
    ['elements at the per-element attribute bound', wrap(`<rect ${unknownAttributes(VECTOR_IMAGE_MAX_ATTRIBUTES_PER_ELEMENT)}/>`.repeat(Math.floor(VECTOR_IMAGE_MAX_ATTRIBUTES / VECTOR_IMAGE_MAX_ATTRIBUTES_PER_ELEMENT))), true],
    ['editor-namespaced attributes at the attribute bound', wrap(`<rect ${unknownAttributes(attributesPerElement, 'x:a')}/>`.repeat(elements)), true],
    ['in-document <use> at the element bound', wrap(`<defs><g id="a"><rect/></g></defs>${'<use href="#a"/>'.repeat(elements)}`), true],
    ['nesting at the depth bound', wrap(`${'<g>'.repeat(VECTOR_IMAGE_MAX_DEPTH - 2)}${'<rect/>'.repeat(elements - VECTOR_IMAGE_MAX_DEPTH)}${'</g>'.repeat(VECTOR_IMAGE_MAX_DEPTH - 2)}`), true],
    ['text interleaved with comments at the node bound', wrap(`<text>${'a<!---->'.repeat(pairs)}</text>`), true],
    ['text interleaved with processing instructions at the node bound', wrap(`<text>${'a<?a?>'.repeat(pairs)}</text>`), true],
    ['text interleaved with CDATA sections at the node bound', wrap(`<text>${'a<![CDATA[b]]>'.repeat(pairs)}</text>`), true],
    ['flat comments at the node bound', wrap('<!---->'.repeat(flat)), true],
    ['flat processing instructions at the node bound', wrap('<?a?>'.repeat(flat)), true],
    ['prolog comments at the node bound', `${'<!---->'.repeat(flat)}${wrap('<rect/>')}`, true],
    ['text interleaved with disallowed elements at the element bound', wrap('a<blink/>'.repeat(Math.min(pairs, elements))), false],
    ['text interleaved with foreign editor elements at the element bound', wrap('a<x:a/>'.repeat(Math.min(pairs, elements))), true],
    ['whitespace-formatted elements at the node bound', wrap('\n<rect/>'.repeat(Math.floor(VECTOR_IMAGE_MAX_NODES / 2) - 12)), true],
  ]

  beforeAll(async () => {
    await sanitizeVectorImage(svgBuffer('<svg xmlns="http://www.w3.org/2000/svg"/>'))
  })

  it.each(worstCases)('handles %s within the ceiling', async (_label, svg, accepted) => {
    const started = performance.now()
    const result = await sanitizeVectorImage(svgBuffer(svg))
    const elapsed = performance.now() - started
    expect(result.ok).toBe(accepted)
    expect(elapsed).toBeLessThan(CEILING_MS)
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
    ['fill:url(https://example.com/p.svg', 'active_content'],
    ['fill:u\\72l(https://example.com/p.svg)', 'active_content'],
    ['width:expression(alert(1))', 'active_content'],
    ['fill:url(javascript:alert(1))', 'active_content'],
    ['fill:/* comment */url(#ok)', null],
    ['fill:url(\u3000#a)', 'external_reference'],
    ['fill:url(" #a")', 'external_reference'],
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
