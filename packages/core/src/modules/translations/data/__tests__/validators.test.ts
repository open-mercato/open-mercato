import { translationBodySchema, entityTypeParamSchema, entityIdParamSchema } from '../validators'

describe('translation validators', () => {
  describe('translationBodySchema', () => {
    it('accepts valid single-locale body', () => {
      const result = translationBodySchema.safeParse({ en: { title: 'Hello' } })
      expect(result.success).toBe(true)
    })

    it('accepts multiple locales', () => {
      const result = translationBodySchema.safeParse({
        en: { title: 'Hello' },
        fr: { title: 'Bonjour' },
      })
      expect(result.success).toBe(true)
    })

    it('accepts null field values', () => {
      const result = translationBodySchema.safeParse({ en: { title: null } })
      expect(result.success).toBe(true)
    })

    it('accepts dot-path field keys', () => {
      const result = translationBodySchema.safeParse({ en: { 'options.red.label': 'Rot' } })
      expect(result.success).toBe(true)
    })

    it('rejects empty locale key', () => {
      const result = translationBodySchema.safeParse({ '': { title: 'x' } })
      expect(result.success).toBe(false)
    })

    it('rejects locale key longer than 10 chars', () => {
      const result = translationBodySchema.safeParse({ abcdefghijk: { title: 'x' } })
      expect(result.success).toBe(false)
    })

    it('rejects empty field key', () => {
      const result = translationBodySchema.safeParse({ en: { '': 'value' } })
      expect(result.success).toBe(false)
    })

    it('rejects field key longer than 100 chars', () => {
      const longKey = 'a'.repeat(101)
      const result = translationBodySchema.safeParse({ en: { [longKey]: 'value' } })
      expect(result.success).toBe(false)
    })

    it('rejects field value longer than 10000 chars', () => {
      const longValue = 'x'.repeat(10001)
      const result = translationBodySchema.safeParse({ en: { title: longValue } })
      expect(result.success).toBe(false)
    })

    it('accepts exactly 50 locales (boundary)', () => {
      const body: Record<string, Record<string, string>> = {}
      for (let i = 0; i < 50; i++) {
        body[`l${String(i).padStart(2, '0')}`] = { title: `val${i}` }
      }
      const result = translationBodySchema.safeParse(body)
      expect(result.success).toBe(true)
    })

    it('rejects 51 locales (over limit)', () => {
      const body: Record<string, Record<string, string>> = {}
      for (let i = 0; i < 51; i++) {
        body[`l${String(i).padStart(2, '0')}`] = { title: `val${i}` }
      }
      const result = translationBodySchema.safeParse(body)
      expect(result.success).toBe(false)
    })

    it('accepts field value at exactly 10000 chars', () => {
      const exactValue = 'x'.repeat(10000)
      const result = translationBodySchema.safeParse({ en: { title: exactValue } })
      expect(result.success).toBe(true)
    })

    it('rejects non-string non-null field values', () => {
      const result = translationBodySchema.safeParse({ en: { title: 123 } })
      expect(result.success).toBe(false)
    })
  })

  describe('entityTypeParamSchema', () => {
    it('accepts valid entity type with colon', () => {
      const result = entityTypeParamSchema.safeParse('catalog:product')
      expect(result.success).toBe(true)
    })

    it('accepts snake_case entity type', () => {
      const result = entityTypeParamSchema.safeParse('my_module:my_entity')
      expect(result.success).toBe(true)
    })

    it('rejects missing colon', () => {
      const result = entityTypeParamSchema.safeParse('catalogproduct')
      expect(result.success).toBe(false)
    })

    it('rejects uppercase characters', () => {
      const result = entityTypeParamSchema.safeParse('Catalog:Product')
      expect(result.success).toBe(false)
    })

    it('rejects empty string', () => {
      const result = entityTypeParamSchema.safeParse('')
      expect(result.success).toBe(false)
    })

    it('rejects numbers in entity type', () => {
      const result = entityTypeParamSchema.safeParse('mod1:entity2')
      expect(result.success).toBe(false)
    })

    it('rejects hyphens', () => {
      const result = entityTypeParamSchema.safeParse('my-module:my-entity')
      expect(result.success).toBe(false)
    })
  })

  describe('entityIdParamSchema', () => {
    it('accepts UUID-like string', () => {
      const result = entityIdParamSchema.safeParse('550e8400-e29b-41d4-a716-446655440000')
      expect(result.success).toBe(true)
    })

    it('accepts composite ID', () => {
      const result = entityIdParamSchema.safeParse('catalog:product:field_key')
      expect(result.success).toBe(true)
    })

    it('accepts simple short ID', () => {
      const result = entityIdParamSchema.safeParse('abc-123')
      expect(result.success).toBe(true)
    })

    it('rejects empty string', () => {
      const result = entityIdParamSchema.safeParse('')
      expect(result.success).toBe(false)
    })
  })
})
