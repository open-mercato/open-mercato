/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { z } from 'zod'
import { flattenSchemaToContract } from '../ledger-schema-flatten'

describe('flattenSchemaToContract', () => {
  test('maps scalar property kinds to ledger types', () => {
    const contract = flattenSchemaToContract(
      z.object({
        title: z.string(),
        quantity: z.number(),
        approved: z.boolean(),
        stage: z.enum(['open', 'won']),
        closedAt: z.date(),
      }),
    )
    expect(contract).toEqual({
      entries: [
        { path: 'title', type: 'text' },
        { path: 'quantity', type: 'number' },
        { path: 'approved', type: 'boolean' },
        { path: 'stage', type: 'select' },
        { path: 'closedAt', type: 'date' },
      ],
    })
  })

  test('unwraps optional, nullable, default, and catch wrappers before mapping', () => {
    const contract = flattenSchemaToContract(
      z.object({
        note: z.string().optional(),
        count: z.number().default(0),
        flag: z.boolean().nullable(),
        fallbackStage: z.enum(['open', 'won']).catch('open'),
      }),
    )
    expect(contract).toEqual({
      entries: [
        { path: 'note', type: 'text' },
        { path: 'count', type: 'number' },
        { path: 'flag', type: 'boolean' },
        { path: 'fallbackStage', type: 'select' },
      ],
    })
  })

  test('flattens nested objects into dot-path entries', () => {
    const contract = flattenSchemaToContract(
      z.object({
        customer: z.object({
          name: z.string(),
          address: z.object({ city: z.string() }),
        }),
      }),
    )
    expect(contract).toEqual({
      entries: [
        { path: 'customer.name', type: 'text' },
        { path: 'customer.address.city', type: 'text' },
      ],
    })
  })

  test('stops recursion at the depth cap and emits an object entry there', () => {
    const deepSchema = z.object({
      level1: z.object({
        level2: z.object({
          level3: z.object({ leaf: z.string() }),
        }),
      }),
    })
    expect(flattenSchemaToContract(deepSchema)).toEqual({
      entries: [{ path: 'level1.level2.level3', type: 'object' }],
    })
    expect(flattenSchemaToContract(deepSchema, { maxDepth: 1 })).toEqual({
      entries: [{ path: 'level1', type: 'object' }],
    })
    expect(flattenSchemaToContract(deepSchema, { maxDepth: 4 })).toEqual({
      entries: [{ path: 'level1.level2.level3.leaf', type: 'text' }],
    })
  })

  test('collapses arrays of objects to one object entry without exploding indices', () => {
    const contract = flattenSchemaToContract(
      z.object({
        lines: z.array(z.object({ sku: z.string(), quantity: z.number() })),
      }),
    )
    expect(contract).toEqual({ entries: [{ path: 'lines', type: 'object' }] })
  })

  test('marks arrays of non-objects as unknown', () => {
    const contract = flattenSchemaToContract(z.object({ tags: z.array(z.string()) }))
    expect(contract).toEqual({ entries: [{ path: 'tags', type: 'unknown' }] })
  })

  test('marks unmappable property kinds as named unknown entries', () => {
    const contract = flattenSchemaToContract(
      z.object({
        mixed: z.union([z.string(), z.number()]),
        bag: z.record(z.string(), z.string()),
        piped: z.string().transform((value) => value.length),
        pinned: z.literal('fixed'),
      }),
    )
    expect(contract).toEqual({
      entries: [
        { path: 'mixed', type: 'unknown' },
        { path: 'bag', type: 'unknown' },
        { path: 'piped', type: 'unknown' },
        { path: 'pinned', type: 'unknown' },
      ],
    })
  })

  test("returns 'unknown' for non-object roots", () => {
    expect(flattenSchemaToContract(z.string())).toBe('unknown')
    expect(flattenSchemaToContract(z.array(z.object({ sku: z.string() })))).toBe('unknown')
    expect(flattenSchemaToContract(z.object({ sku: z.string() }).transform((value) => value))).toBe('unknown')
    expect(flattenSchemaToContract(z.union([z.object({ left: z.string() }), z.object({ right: z.string() })]))).toBe('unknown')
  })

  test("returns 'unknown' for empty object schemas", () => {
    expect(flattenSchemaToContract(z.object({}))).toBe('unknown')
  })

  test('unwraps a wrapped object root before flattening', () => {
    expect(flattenSchemaToContract(z.object({ dealId: z.string() }).optional())).toEqual({
      entries: [{ path: 'dealId', type: 'text' }],
    })
  })

  test('flattens a typical CRUD API response schema (paged list) into honest entries', () => {
    const contract = flattenSchemaToContract(
      z.object({
        items: z.array(z.object({ id: z.string(), name: z.string() })),
        total: z.number(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
        totalPages: z.number(),
      }),
    )
    expect(contract).toEqual({
      entries: [
        { path: 'items', type: 'object' },
        { path: 'total', type: 'number' },
        { path: 'page', type: 'number' },
        { path: 'pageSize', type: 'number' },
        { path: 'totalPages', type: 'number' },
      ],
    })
  })

  test('flattens a detail-style API response with a nested data envelope', () => {
    const contract = flattenSchemaToContract(
      z.object({
        data: z.object({
          id: z.string().uuid(),
          status: z.enum(['RUNNING', 'COMPLETED']),
          context: z.unknown(),
        }),
        message: z.string(),
      }),
    )
    expect(contract).toEqual({
      entries: [
        { path: 'data.id', type: 'text' },
        { path: 'data.status', type: 'select' },
        { path: 'data.context', type: 'unknown' },
        { path: 'message', type: 'text' },
      ],
    })
  })

  test('resolves the deals exemplar to a single text entry', () => {
    expect(flattenSchemaToContract(z.object({ dealId: z.string().uuid() }))).toEqual({
      entries: [{ path: 'dealId', type: 'text' }],
    })
  })
})
