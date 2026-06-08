import { extensions } from '../extensions'

describe('communication_channels extensions — per-user additions (slice 3a)', () => {
  it('declares the per-user CommunicationChannel → auth:user link', () => {
    const link = extensions.find(
      (e) =>
        e.base === 'auth:user' &&
        e.extension === 'communication_channels:communication_channel' &&
        e.join.extensionKey === 'user_id',
    )
    expect(link).toBeDefined()
    expect(link?.cardinality).toBe('one-to-many')
  })

  it('declares the integration_credentials.user_id → auth:user link (cross-module)', () => {
    const link = extensions.find(
      (e) =>
        e.base === 'auth:user' &&
        e.extension === 'integrations:integration_credentials' &&
        e.join.extensionKey === 'user_id',
    )
    expect(link).toBeDefined()
    expect(link?.cardinality).toBe('one-to-many')
  })

  it('keeps every cross-module link in the canonical EntityExtension shape', () => {
    for (const e of extensions) {
      expect(typeof e.base).toBe('string')
      expect(typeof e.extension).toBe('string')
      expect(e.join.baseKey).toBe('id')
      expect(typeof e.join.extensionKey).toBe('string')
      // Ensure no raw FK foreign-keying — the spec mandates EntityExtension only.
      expect(e.extension).not.toBe(e.base) // safety: never self-extend
    }
  })

  it('exports 6 extensions (4 from earlier slices + 2 added in slice 3a)', () => {
    expect(extensions).toHaveLength(6)
  })
})
