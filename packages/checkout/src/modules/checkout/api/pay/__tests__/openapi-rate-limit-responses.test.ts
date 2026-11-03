import { buildOpenApiDocument } from '@open-mercato/shared/lib/openapi/generator'
import type { Module, ModuleApiRouteFile } from '@open-mercato/shared/modules/registry'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { openApi as submitOpenApi } from '../[slug]/submit/route'
import { openApi as verifyPasswordOpenApi } from '../[slug]/verify-password/route'

type ResponseEntry = { description?: string; content?: Record<string, unknown> }

function operationFor(openApi: unknown, path: string): { responses: Record<string, ResponseEntry> } {
  const api: ModuleApiRouteFile = {
    path,
    handlers: { POST: async () => new Response(null) },
    docs: openApi as OpenApiRouteDoc,
  }
  const module: Module = { id: 'checkout', apis: [api] }
  return buildOpenApiDocument([module]).paths[path]?.post as { responses: Record<string, ResponseEntry> }
}

describe('public checkout pay routes document their rate-limit responses', () => {
  it.each([
    {
      name: 'submit',
      openApi: submitOpenApi,
      path: '/api/checkout/pay/{slug}/submit',
      rejected: 'Rate limiting could not be enforced, so the payment was rejected',
      throttled: 'Too many payment attempts',
    },
    {
      name: 'verify-password',
      openApi: verifyPasswordOpenApi,
      path: '/api/checkout/pay/{slug}/verify-password',
      rejected: 'Rate limiting could not be enforced, so the attempt was rejected',
      throttled: 'Too many password attempts',
    },
  ])('exposes 429 and 503 in the generated document for $name', ({ openApi, path, rejected, throttled }) => {
    const operation = operationFor(openApi, path)

    expect(operation.responses['429'].description).toBe(throttled)
    expect(operation.responses['503'].description).toBe(rejected)
  })
})
