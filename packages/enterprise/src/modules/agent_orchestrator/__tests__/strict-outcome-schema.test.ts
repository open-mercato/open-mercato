import { z } from 'zod'
import { compileOutcome, type JsonSchemaNode } from '../lib/sdk/outcomeSchema'
import { stripOptionalNulls, toStrictOutcomeSchema } from '../lib/sdk/strictOutcomeSchema'

const resolutionOutcome: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['actions', 'confidence', 'rationale'],
  properties: {
    actions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'payload'],
        properties: {
          type: { type: 'string', enum: ['set_priority', 'assign_specialist', 'send_macro'] },
          payload: {
            type: 'object',
            additionalProperties: false,
            properties: {
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
              team: { type: 'string', minLength: 1 },
              macroId: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string', minLength: 1 },
  },
}

function everyObjectIsStrict(node: Record<string, unknown>): boolean {
  if (node.type === 'object' && node.properties) {
    const keys = Object.keys(node.properties as object).sort()
    const required = [...((node.required as string[]) ?? [])].sort()
    if (JSON.stringify(keys) !== JSON.stringify(required) || node.additionalProperties !== false) return false
  }
  return Object.values(node).every((value) =>
    value && typeof value === 'object' ? everyObjectIsStrict(value as Record<string, unknown>) : true,
  )
}

describe('toStrictOutcomeSchema', () => {
  it('requires every property and makes the optional ones nullable', () => {
    const strict = toStrictOutcomeSchema(resolutionOutcome)!
    const payload = strict.properties!.actions.items!.properties!.payload
    expect(payload.required).toEqual(['priority', 'team', 'macroId'])
    expect(payload.properties!.team.nullable).toBe(true)
    expect(strict.properties!.confidence.nullable).toBeUndefined()
  })

  it('compiles to a JSON schema a strict structured-output provider accepts', () => {
    const strict = toStrictOutcomeSchema(resolutionOutcome)!
    const { resultSchema } = compileOutcome({ kind: 'proposal', schema: strict })
    expect(everyObjectIsStrict(z.toJSONSchema(resultSchema) as Record<string, unknown>)).toBe(true)
  })

  it('closes an open object as an empty one, which is what the authored schema accepts anyway', () => {
    const authored = {
      type: 'object' as const,
      required: ['summary'],
      properties: { summary: { type: 'string' as const }, meta: { type: 'object' as const }, note: { type: 'string' as const } },
    }
    const strict = toStrictOutcomeSchema(authored)
    expect(strict.properties!.meta).toEqual({ type: 'object', properties: {}, required: [], additionalProperties: false, nullable: true })
    expect(strict.required).toEqual(['summary', 'meta', 'note'])
    const { resultSchema } = compileOutcome({ kind: 'research', schema: strict })
    expect(everyObjectIsStrict(z.toJSONSchema(resultSchema) as Record<string, unknown>)).toBe(true)
    const authoredResult = compileOutcome({ kind: 'research', schema: authored }).resultSchema
    expect(authoredResult.parse({ kind: 'research', data: { summary: 'x', meta: { lost: 1 } } })).toEqual({
      kind: 'research',
      data: { summary: 'x', meta: {} },
    })
  })
})

describe('stripOptionalNulls', () => {
  it('maps a strict answer back onto the authored schema', () => {
    const answer = {
      actions: [{ type: 'assign_specialist', payload: { priority: null, team: 'billing', macroId: null } }],
      confidence: 0.8,
      rationale: 'VIP payout blocked',
    }
    const restored = stripOptionalNulls(answer, resolutionOutcome)
    expect(restored).toEqual({
      actions: [{ type: 'assign_specialist', payload: { team: 'billing' } }],
      confidence: 0.8,
      rationale: 'VIP payout blocked',
    })
    const { resultSchema } = compileOutcome({ kind: 'proposal', schema: resolutionOutcome })
    expect(resultSchema.safeParse({ kind: 'proposal', proposal: restored }).success).toBe(true)
  })

  it('keeps a null on a required or nullable property for the authored schema to judge', () => {
    const schema: JsonSchemaNode = {
      type: 'object',
      required: ['owner'],
      properties: { owner: { type: 'string' }, note: { type: 'string', nullable: true } },
    }
    expect(stripOptionalNulls({ owner: null, note: null }, schema)).toEqual({ owner: null, note: null })
  })
})
