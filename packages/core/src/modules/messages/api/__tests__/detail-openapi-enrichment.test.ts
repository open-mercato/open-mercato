import { buildOpenApiDocument } from '@open-mercato/shared/lib/openapi/generator'
import type { Module, ModuleApiRouteFile } from '@open-mercato/shared/modules/registry'
import { openApi } from '@open-mercato/core/modules/messages/api/[id]/route'

const routePath = '/messages/{id}'

function buildDetailResponseSchema(): Record<string, unknown> {
  const api: ModuleApiRouteFile = {
    path: routePath,
    metadata: { GET: { requireAuth: true } },
    handlers: { GET: async () => new Response(null) },
    docs: openApi,
  }
  const doc = buildOpenApiDocument([{ id: 'messages', apis: [api] } as Module])
  const operation = doc.paths[routePath].get as Record<string, never>
  const response = (operation.responses as Record<string, never>)['200'] as Record<string, never>
  const schema = (response.content as Record<string, never>)['application/json'].schema as Record<string, unknown>
  if (typeof schema.$ref !== 'string') return schema
  const name = schema.$ref.split('/').pop() as string
  const schemas = (doc.components as Record<string, never>).schemas as Record<string, never>
  return schemas[name] as Record<string, unknown>
}

describe('GET /api/messages/{id} — published response contract', () => {
  it('permits the enrichment keys the route actually returns', () => {
    // The route runs response enrichers for `messages.message`, so the payload
    // carries `_`-prefixed keys from any module registering one. A plain
    // `z.object()` would generate `additionalProperties: false` and the published
    // spec would forbid exactly those fields.
    const schema = buildDetailResponseSchema()

    expect(schema.additionalProperties).toBe(true)
  })

  it('documents the enrichment keys the shipped enrichers produce', () => {
    const properties = buildDetailResponseSchema().properties as Record<string, unknown>

    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(['_channel', '_channelPayload', '_channelContact', '_reactions', '_meta']),
    )
  })
})
