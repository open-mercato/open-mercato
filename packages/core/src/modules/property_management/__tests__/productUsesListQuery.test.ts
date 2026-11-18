/** @jest-environment node */
import type { ZodTypeAny } from 'zod'

type CapturedListConfig = {
  schema: ZodTypeAny
  buildFilters?: (query: Record<string, unknown>) => Promise<Record<string, unknown>>
}

const captured: CapturedListConfig[] = []

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((config: { list?: CapturedListConfig }) => {
    if (config.list) captured.push(config.list)
    const handler = jest.fn()
    return { GET: handler, POST: handler, PUT: handler, DELETE: handler }
  }),
}))

import '../api/product-uses/route'

const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function listConfig(): CapturedListConfig {
  const config = captured[0]
  if (!config) throw new Error('[internal] product-uses list config was not captured')
  return config
}

describe('GET /api/property_management/product-uses productIds', () => {
  it('rejects a malformed or mixed productIds list instead of passing it to a uuid column', () => {
    const { schema } = listConfig()
    expect(schema.safeParse({ productIds: 'abc' }).success).toBe(false)
    expect(schema.safeParse({ productIds: `${PRODUCT_A},abc` }).success).toBe(false)
  })

  it('accepts a comma-separated uuid list and filters by its trimmed entries', async () => {
    const { schema, buildFilters } = listConfig()
    const parsed = schema.parse({ productIds: ` ${PRODUCT_A}, ${PRODUCT_B} ` }) as Record<string, unknown>
    expect(await buildFilters?.(parsed)).toEqual({ catalog_product_id: { $in: [PRODUCT_A, PRODUCT_B] } })
    expect(await buildFilters?.(schema.parse({}) as Record<string, unknown>)).toEqual({})
  })
})
