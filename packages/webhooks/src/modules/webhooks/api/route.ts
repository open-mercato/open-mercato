import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { GET, POST, openApi as legacyOpenApi } from './webhooks/route'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['webhooks.view'] },
  POST: { requireAuth: true, requireFeatures: ['webhooks.manage'] },
}

export { GET, POST }

export const openApi: OpenApiRouteDoc = {
  ...legacyOpenApi,
  methods: {
    GET: legacyOpenApi.methods.GET,
    POST: legacyOpenApi.methods.POST,
  },
}
