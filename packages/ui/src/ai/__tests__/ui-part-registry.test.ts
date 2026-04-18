import {
  RESERVED_AI_UI_PART_IDS,
  registerAiUiPart,
  resetAiUiPartRegistryForTests,
  resolveAiUiPart,
  unregisterAiUiPart,
} from '../ui-part-registry'

describe('ai-part-registry', () => {
  beforeEach(() => {
    resetAiUiPartRegistryForTests()
  })

  afterAll(() => {
    resetAiUiPartRegistryForTests()
  })

  it('returns null for unregistered component ids without throwing', () => {
    const resolved = resolveAiUiPart('mutation-preview-card')
    expect(resolved).toBeNull()
  })

  it('round-trips a registered component', () => {
    const Component = (() => null) as unknown as Parameters<typeof registerAiUiPart>[1]
    registerAiUiPart('mutation-preview-card', Component)
    expect(resolveAiUiPart('mutation-preview-card')).toBe(Component)
  })

  it('unregisterAiUiPart removes a registration', () => {
    const Component = (() => null) as unknown as Parameters<typeof registerAiUiPart>[1]
    registerAiUiPart('field-diff-card', Component)
    unregisterAiUiPart('field-diff-card')
    expect(resolveAiUiPart('field-diff-card')).toBeNull()
  })

  it('re-registering the same id overwrites the previous entry', () => {
    const first = (() => null) as unknown as Parameters<typeof registerAiUiPart>[1]
    const second = (() => null) as unknown as Parameters<typeof registerAiUiPart>[1]
    registerAiUiPart('confirmation-card', first)
    registerAiUiPart('confirmation-card', second)
    expect(resolveAiUiPart('confirmation-card')).toBe(second)
  })

  it('rejects empty component ids', () => {
    const Component = (() => null) as unknown as Parameters<typeof registerAiUiPart>[1]
    expect(() => registerAiUiPart('', Component)).toThrow()
  })

  it('ships with the canonical reserved Phase 3 slot ids', () => {
    expect(RESERVED_AI_UI_PART_IDS).toEqual([
      'mutation-preview-card',
      'field-diff-card',
      'confirmation-card',
      'mutation-result-card',
    ])
  })
})
