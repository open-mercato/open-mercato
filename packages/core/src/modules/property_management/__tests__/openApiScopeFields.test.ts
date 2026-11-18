/** @jest-environment node */
import { z } from 'zod'

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn(() => {
    const handler = jest.fn()
    return { GET: handler, POST: handler, PUT: handler, DELETE: handler }
  }),
}))

import { unscopedDocSchema } from '../api/crudShared'
import { spaceCreateSchema } from '../data/validators'

type DocMethod = { requestBody?: { schema?: unknown } }
type RouteDoc = { methods: Record<string, DocMethod | undefined> }

const ROUTES: Array<[string, Array<'POST' | 'PUT'>]> = [
  ['buildings', ['POST', 'PUT']],
  ['floors', ['PUT']],
  ['spaces', ['POST', 'PUT']],
  ['units', ['POST', 'PUT']],
  ['common-areas', ['POST', 'PUT']],
  ['leases', ['POST', 'PUT']],
  ['product-uses', ['POST', 'PUT']],
]

function bodyKeys(doc: RouteDoc, method: 'POST' | 'PUT'): string[] {
  const schema = doc.methods[method]?.requestBody?.schema
  expect(schema).toBeInstanceOf(z.ZodObject)
  return Object.keys((schema as z.ZodObject<z.ZodRawShape>).shape)
}

describe('public OpenAPI request bodies', () => {
  it.each(ROUTES)('%s does not document the server-pinned tenant and organization', async (route, methods) => {
    const { openApi } = (await import(`../api/${route}/route`)) as { openApi: RouteDoc }
    for (const method of methods) {
      const keys = bodyKeys(openApi, method)
      expect(keys.length).toBeGreaterThan(0)
      expect(keys).not.toContain('tenantId')
      expect(keys).not.toContain('organizationId')
    }
  })

  it('keeps the runtime validator requiring the scope', () => {
    const docSchema = unscopedDocSchema(spaceCreateSchema)
    expect(Object.keys(docSchema.shape)).toEqual(Object.keys(spaceCreateSchema.shape).filter((key) => key !== 'tenantId' && key !== 'organizationId'))
    expect(Object.keys(spaceCreateSchema.shape)).toEqual(expect.arrayContaining(['tenantId', 'organizationId']))
  })
})
