import { z } from 'zod'
import { toolInputJsonSchema } from '../tool-input-schema'

/**
 * The regression these cover is silent by construction: the Zod 3 converter this replaced did
 * not throw on a Zod 4 schema, it returned `{ "$schema": … }` and nothing else. So every
 * assertion below is about the schema having CONTENT — a converter that quietly degrades again
 * has to fail here rather than in a model's confused tool call.
 */
describe('toolInputJsonSchema', () => {
  it('publishes properties and required fields for a real tool input', () => {
    const schema = toolInputJsonSchema(z.object({
      customerId: z.string().uuid(),
      note: z.string().optional(),
    }))

    expect(schema.type).toBe('object')
    expect(Object.keys(schema.properties as Record<string, unknown>).sort()).toEqual(['customerId', 'note'])
    expect(schema.required).toEqual(['customerId'])
  })

  it('distinguishes an argument-free tool from one that takes arguments', () => {
    const empty = toolInputJsonSchema(z.object({}))
    const withArgs = toolInputJsonSchema(z.object({ customerId: z.string() }))

    expect(Object.keys(empty.properties as Record<string, unknown>)).toEqual([])
    expect(Object.keys(withArgs.properties as Record<string, unknown>)).toEqual(['customerId'])
    // The bug being guarded: the two used to serialize identically.
    expect(JSON.stringify(empty)).not.toBe(JSON.stringify(withArgs))
  })

  it('describes what the caller sends, so a defaulted field is not published as required', () => {
    const schema = toolInputJsonSchema(z.object({
      limit: z.number().default(10),
      query: z.string(),
    }))

    expect(schema.required).toEqual(['query'])
    expect(Object.keys(schema.properties as Record<string, unknown>).sort()).toEqual(['limit', 'query'])
  })

  it('publishes an unrepresentable field as unconstrained instead of failing the whole listing', () => {
    const schema = toolInputJsonSchema(z.object({ when: z.date(), title: z.string() }))

    expect(Object.keys(schema.properties as Record<string, unknown>).sort()).toEqual(['title', 'when'])
    expect((schema.properties as Record<string, unknown>).when).toEqual({})
  })

  it('degrades to an empty object schema when there is no schema at all', () => {
    expect(toolInputJsonSchema(undefined)).toEqual({ type: 'object', properties: {} })
  })
})
