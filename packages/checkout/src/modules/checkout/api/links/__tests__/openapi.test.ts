import { buildOpenApiDocument } from '@open-mercato/shared/lib/openapi/generator'
import type { Module } from '@open-mercato/shared/modules/registry'
import { CheckoutLink } from '../../../data/entities'
import { serializeLinkRecord } from '../../../commands/links'
import { GET, POST, openApi } from '../route'

type SchemaNode = {
  type?: string
  format?: string
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  required?: string[]
}

function successSchema(method: 'get' | 'post', status: string): SchemaNode {
  const modules: Module[] = [{
    id: 'checkout',
    apis: [{ path: '/checkout/links', handlers: { GET, POST }, docs: openApi }],
  }]
  const document = buildOpenApiDocument(modules)
  const operation = document.paths['/checkout/links'][method] as {
    responses: Record<string, { content: { 'application/json': { schema: SchemaNode } } }>
  }
  return operation.responses[status].content['application/json'].schema
}

describe('checkout links OpenAPI success responses', () => {
  it('describes every serialized list field and pagination with their wire types', () => {
    const record = Object.assign(new CheckoutLink(), {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Test checkout',
      slug: 'test-checkout',
      pricingMode: 'fixed' as const,
      fixedPriceAmount: '12.5000',
      fixedPriceCurrencyCode: 'USD',
      priceListItems: [{ id: 'item-1', description: 'Precise price', amount: 12.5, amountExact: '12.5000000000000001', currencyCode: 'USD' }],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    })
    const body = { items: [serializeLinkRecord(record)], total: 1, page: 1, pageSize: 25, totalPages: 1 }
    const declared = openApi.methods.GET.responses[0].schema
    expect(declared.parse(body)).toEqual(body)
    expect(declared.safeParse({ ...body, items: [{ ...body.items[0], fixedPriceAmount: '12.5' }] }).success).toBe(false)
    const generated = successSchema('get', '200')
    expect(Object.keys(generated.properties ?? {}).sort()).toEqual(Object.keys(body).sort())
    const item = generated.properties?.items?.items
    expect(Object.keys(item?.properties ?? {}).sort()).toEqual(Object.keys(body.items[0]).sort())
    expect(item?.properties).toMatchObject({
      id: { type: 'string', format: 'uuid' },
      slug: { type: 'string' },
      completionCount: { type: 'number' },
      isLocked: { type: 'boolean' },
    })
    expect(item?.properties?.priceListItems?.items?.properties?.amountExact).toBeDefined()
    expect(JSON.stringify(generated)).not.toContain('Schema not declared')
  })

  it('declares the 201 creation response with id and slug', () => {
    const result = { id: '11111111-1111-4111-8111-111111111111', slug: 'test-checkout' }
    expect(openApi.methods.POST.responses[0].schema.parse(result)).toEqual(result)
    const generated = successSchema('post', '201')
    expect(generated.properties).toEqual({
      id: expect.objectContaining({ type: 'string', format: 'uuid' }),
      slug: expect.objectContaining({ type: 'string' }),
    })
    expect(generated.required).toEqual(expect.arrayContaining(['id', 'slug']))
  })
})
