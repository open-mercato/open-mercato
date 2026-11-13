/** @jest-environment node */
import type { ZodArray, ZodObject, ZodRawShape } from 'zod'

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn(() => ({
    GET: jest.fn(),
    POST: jest.fn(),
    PUT: jest.fn(),
    DELETE: jest.fn(),
  })),
}))

import { openApi } from '../companies/route'

const COMPANY_ID = '11111111-1111-4111-8111-111111111111'

function listItemSchema(): ZodObject<ZodRawShape> {
  const listResponse = openApi.methods.GET?.responses?.[0]?.schema as ZodObject<ZodRawShape> | undefined
  if (!listResponse) throw new Error('[internal] companies list response schema is missing from the OpenAPI doc')
  const items = listResponse.shape.items as ZodArray<ZodObject<ZodRawShape>>
  return items.element
}

describe('companies list OpenAPI response (#8538)', () => {
  it('declares the tax_id column the list handler returns', () => {
    const item = listItemSchema()

    expect(Object.keys(item.shape)).toContain('tax_id')
    expect(item.safeParse({ id: COMPANY_ID, tax_id: 'PL1234567890' }).success).toBe(true)
    expect(item.safeParse({ id: COMPANY_ID, tax_id: null }).success).toBe(true)
    expect(item.safeParse({ id: COMPANY_ID }).success).toBe(true)
    expect(item.safeParse({ id: COMPANY_ID, tax_id: 1234567890 }).success).toBe(false)
  })
})
