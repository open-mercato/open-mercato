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
})
