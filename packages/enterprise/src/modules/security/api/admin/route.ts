import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { securityApiError } from '../i18n'

export async function GET() {
  return securityApiError(501, 'Not implemented')
}

export async function POST() {
  return securityApiError(501, 'Not implemented')
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Security',
  summary: 'Admin security routes',
  methods: {
    GET: { summary: 'Get admin security data' },
    POST: { summary: 'Manage admin security actions' },
  },
}
