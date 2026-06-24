import {
  compileOutcome,
  jsonSchemaToZod,
  UnsupportedOutcomeSchemaError,
  type JsonSchemaNode,
} from '../lib/sdk/outcomeSchema'

describe('jsonSchemaToZod', () => {
  it('accepts a nested object/array/string/number/boolean/const/nullable subset', () => {
    const schema: JsonSchemaNode = {
      type: 'object',
      additionalProperties: false,
      required: ['actions', 'confidence'],
      properties: {
        actions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['type', 'stage'],
            properties: {
              type: { const: 'set_stage' },
              stage: { type: 'string', minLength: 1 },
            },
          },
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        note: { type: 'string', nullable: true },
        flagged: { type: 'boolean' },
      },
    }
    const zod = jsonSchemaToZod(schema)

    expect(
      zod.safeParse({
        actions: [{ type: 'set_stage', stage: 'won' }],
        confidence: 0.8,
        flagged: true,
        note: null,
      }).success,
    ).toBe(true)

    // optional `note`/`flagged` may be omitted
    expect(zod.safeParse({ actions: [{ type: 'set_stage', stage: 'won' }], confidence: 0.5 }).success).toBe(true)

    // additionalProperties:false → strict rejects unknown keys
    expect(
      zod.safeParse({ actions: [{ type: 'set_stage', stage: 'x' }], confidence: 0.5, extra: 1 }).success,
    ).toBe(false)
    // minItems enforced
    expect(zod.safeParse({ actions: [], confidence: 0.5 }).success).toBe(false)
    // const enforced
    expect(zod.safeParse({ actions: [{ type: 'other', stage: 'x' }], confidence: 0.5 }).success).toBe(false)
    // minimum/maximum enforced
    expect(zod.safeParse({ actions: [{ type: 'set_stage', stage: 'x' }], confidence: 2 }).success).toBe(false)
    // missing required
    expect(zod.safeParse({ confidence: 0.5 }).success).toBe(false)
  })

  it('maps string enum to z.enum', () => {
    const zod = jsonSchemaToZod({ type: 'string', enum: ['low', 'high'] })
    expect(zod.safeParse('low').success).toBe(true)
    expect(zod.safeParse('mid').success).toBe(false)
  })

  it('rejects unsupported keywords (oneOf/anyOf/$ref/format/patternProperties)', () => {
    expect(() => jsonSchemaToZod({ oneOf: [] } as unknown as JsonSchemaNode)).toThrow(
      UnsupportedOutcomeSchemaError,
    )
    expect(() => jsonSchemaToZod({ anyOf: [] } as unknown as JsonSchemaNode)).toThrow(
      UnsupportedOutcomeSchemaError,
    )
    expect(() => jsonSchemaToZod({ $ref: '#/x' } as unknown as JsonSchemaNode)).toThrow(
      UnsupportedOutcomeSchemaError,
    )
    expect(() => jsonSchemaToZod({ type: 'string', format: 'email' } as unknown as JsonSchemaNode)).toThrow(
      UnsupportedOutcomeSchemaError,
    )
    expect(() =>
      jsonSchemaToZod({ type: 'object', patternProperties: {} } as unknown as JsonSchemaNode),
    ).toThrow(UnsupportedOutcomeSchemaError)
  })

  it('rejects a node missing a type', () => {
    expect(() => jsonSchemaToZod({ properties: {} } as unknown as JsonSchemaNode)).toThrow(
      UnsupportedOutcomeSchemaError,
    )
  })
})

describe('compileOutcome', () => {
  it('wraps an informative schema under { kind, data }', () => {
    const { kind, resultSchema } = compileOutcome({
      kind: 'informative',
      schema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string', minLength: 1 } } },
    })
    expect(kind).toBe('informative')
    expect(resultSchema.safeParse({ kind: 'informative', data: { summary: 'ok' } }).success).toBe(true)
    expect(resultSchema.safeParse({ kind: 'actionable', data: { summary: 'ok' } }).success).toBe(false)
    expect(resultSchema.safeParse({ kind: 'informative', proposal: { summary: 'ok' } }).success).toBe(false)
  })

  it('wraps an actionable schema under { kind, proposal }', () => {
    const { kind, resultSchema } = compileOutcome({
      kind: 'actionable',
      schema: { type: 'object', required: ['rationale'], properties: { rationale: { type: 'string', minLength: 1 } } },
    })
    expect(kind).toBe('actionable')
    expect(resultSchema.safeParse({ kind: 'actionable', proposal: { rationale: 'because' } }).success).toBe(true)
    expect(resultSchema.safeParse({ kind: 'informative', proposal: { rationale: 'because' } }).success).toBe(false)
  })
})
