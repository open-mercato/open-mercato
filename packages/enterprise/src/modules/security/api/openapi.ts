import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'

export const securityErrorSchema = z.object({
  error: z.string(),
  issues: z.array(z.unknown()).optional(),
  errors: z.array(z.string()).optional(),
})

export function buildSecurityOpenApi(params: {
  summary: string
  methods: OpenApiRouteDoc['methods']
}): OpenApiRouteDoc {
  return {
    tag: 'Security',
    summary: params.summary,
    methods: params.methods,
  }
}
