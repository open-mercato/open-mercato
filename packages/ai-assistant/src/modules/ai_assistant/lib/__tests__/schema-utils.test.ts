import { z } from 'zod'

import { jsonSchemaToZod, toSafeZodSchema } from '../schema-utils'

describe('schema-utils', () => {
  it('coerces numeric strings for JSON Schema number fields while preserving bounds', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        ratio: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 },
      },
      additionalProperties: false,
    })

    expect(schema.parse({ limit: '2', ratio: '0.5' })).toEqual({ limit: 2, ratio: 0.5 })
    expect(() => schema.parse({ limit: '0', ratio: '0.5' })).toThrow()
    expect(() => schema.parse({ limit: '', ratio: '0.5' })).toThrow()
  })

  it('keeps safe tool schemas compatible with OpenRouter-style string pagination args', () => {
    const originalSchema = z.object({
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    })

    const safeSchema = toSafeZodSchema(originalSchema)

    expect(safeSchema.parse({ limit: '2', offset: '0' })).toEqual({ limit: 2, offset: 0 })
    expect(() => safeSchema.parse({ limit: '101', offset: '0' })).toThrow()
  })

  describe('keeps what the model needs from a tool input schema', () => {
    const toolInput = z.object({
      query: z.string().describe('Text to search for'),
      limit: z.number().int().min(1).max(100).default(20).describe('Maximum number of rows'),
      status: z.enum(['open', 'closed']).optional().describe('Only rows in this status'),
      sort: z.enum(['newest', 'oldest']).default('newest'),
    })

    const publish = (schema: z.ZodType) =>
      z.toJSONSchema(schema, { io: 'input' }) as {
        required?: string[]
        properties: Record<string, { description?: string; enum?: unknown[]; default?: unknown }>
      }

    it('does not make a defaulted field required, and applies its default', () => {
      const safeSchema = toSafeZodSchema(toolInput)

      expect(publish(safeSchema).required).toEqual(['query'])
      expect(safeSchema.parse({ query: 'acme' })).toEqual({ query: 'acme', limit: 20, sort: 'newest' })
      expect(safeSchema.parse({ query: 'acme', limit: '5' })).toEqual({ query: 'acme', limit: 5, sort: 'newest' })
    })

    it('keeps enum values and rejects anything outside them', () => {
      const safeSchema = toSafeZodSchema(toolInput)
      const { properties } = publish(safeSchema)

      expect(properties.status.enum).toEqual(['open', 'closed'])
      expect(properties.sort.enum).toEqual(['newest', 'oldest'])
      expect(() => safeSchema.parse({ query: 'acme', status: 'archived' })).toThrow()
    })

    it('keeps field descriptions and publishes defaults', () => {
      const { properties } = publish(toSafeZodSchema(toolInput))

      expect(properties.query.description).toBe('Text to search for')
      expect(properties.limit.description).toBe('Maximum number of rows')
      expect(properties.status.description).toBe('Only rows in this status')
      expect(properties.sort.default).toBe('newest')
    })

    it('converts enums of non-string literals', () => {
      const schema = jsonSchemaToZod({ enum: [1, 2, 3] })

      expect(schema.parse(2)).toBe(2)
      expect(() => schema.parse(4)).toThrow()
    })
  })
})
