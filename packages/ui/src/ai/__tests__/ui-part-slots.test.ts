import {
  RESERVED_AI_UI_PART_IDS,
  isReservedAiUiPartId,
} from '../ui-part-slots'

describe('ui-part-slots', () => {
  it('exposes exactly four reserved Phase 3 slot ids', () => {
    expect(RESERVED_AI_UI_PART_IDS).toHaveLength(4)
  })

  it('matches the spec §9 / Step 5.10 contract verbatim and in order', () => {
    expect(RESERVED_AI_UI_PART_IDS).toEqual([
      'mutation-preview-card',
      'field-diff-card',
      'confirmation-card',
      'mutation-result-card',
    ])
  })

  it('is a readonly tuple — attempting to mutate it is a compile-time error', () => {
    // Runtime assertion — defence-in-depth against accidental spreading or
    // push() operations in consumer code. The tuple is `as const` so this
    // mostly guards against typed-but-cast code paths.
    const sealedLength = RESERVED_AI_UI_PART_IDS.length
    const mutable = RESERVED_AI_UI_PART_IDS as unknown as string[]
    expect(() => mutable.push('bogus')).toThrow()
    expect(RESERVED_AI_UI_PART_IDS.length).toBe(sealedLength)
  })

  describe('isReservedAiUiPartId()', () => {
    it('returns true for every reserved id', () => {
      for (const reserved of RESERVED_AI_UI_PART_IDS) {
        expect(isReservedAiUiPartId(reserved)).toBe(true)
      }
    })

    it('returns false for non-reserved ids', () => {
      expect(isReservedAiUiPartId('custom-widget')).toBe(false)
      expect(isReservedAiUiPartId('')).toBe(false)
      expect(isReservedAiUiPartId('mutation-preview-card-variant')).toBe(false)
    })
  })
})
