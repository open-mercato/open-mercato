import { parseAiContentSegments } from '../AiMessageContent'
import { withoutAiRecordImages } from '../imagePolicy'

describe('AI record image policy', () => {
  it.each([
    ['product', 'imageUrl'],
    ['product', 'image'],
    ['person', 'avatarUrl'],
    ['person', 'avatar'],
    ['company', 'logoUrl'],
    ['company', 'logo'],
  ])('blocks %s images supplied as %s without modifying parsed content', (kind, field) => {
    const canary = 'https://ai-image-canary.invalid/pixel?data=inert'
    const content = `open-mercato:${kind} ${JSON.stringify({ name: 'Visible record', [field]: canary })}`
    const segment = parseAiContentSegments(content)[0]
    expect(segment.kind).toBe('record-card')
    if (segment.kind !== 'record-card') throw new Error('[internal] Expected record card')

    const original = { ...segment.payload }
    const safe = withoutAiRecordImages(segment.payload)
    expect(JSON.stringify(safe)).not.toContain(canary)
    expect(safe).toMatchObject({ kind, name: 'Visible record' })
    expect(segment.payload).toEqual(original)
    expect(JSON.stringify(segment.payload)).toContain(canary)
  })

  it.each(['/api/redirect?data=inert', '//ai-image-canary.invalid/pixel', 'data:image/svg+xml,<svg/>'])
    ('blocks non-HTTPS model image sources too: %s', (imageUrl) => {
      expect(withoutAiRecordImages({ kind: 'product', name: 'Product', imageUrl }))
        .toMatchObject({ kind: 'product', name: 'Product', imageUrl: null })
    })

  it('keeps image-free card details', () => {
    const payload = { kind: 'deal' as const, title: 'Visible deal', amount: 100, currency: 'USD' }
    expect(withoutAiRecordImages(payload)).toEqual(payload)
  })
})
