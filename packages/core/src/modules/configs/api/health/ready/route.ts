import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { configsTag } from '../../openapi'

const logger = createLogger('configs').child({ component: 'readiness' })

const readySchema = z.object({ status: z.literal('ready') })
const notReadySchema = z.object({ status: z.literal('not_ready'), check: z.literal('tenant_data_encryption') })

export const metadata = {
  GET: {
    requireAuth: false,
    skipModuleResourceUsageTracking: true,
  },
} as const

export async function GET() {
  try {
    const container = await createRequestContainer()
    const encryption = container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
    if (!encryption.getReadiness().ready) {
      return NextResponse.json(
        { status: 'not_ready', check: 'tenant_data_encryption' },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      )
    }
    return NextResponse.json(
      { status: 'ready' },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    logger.warn('Readiness check failed', { err: error })
    return NextResponse.json(
      { status: 'not_ready', check: 'tenant_data_encryption' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: configsTag,
  summary: 'Application readiness',
  methods: {
    GET: {
      summary: 'Check whether the application is ready to receive traffic',
      responses: [
        { status: 200, description: 'Application is ready', schema: readySchema },
      ],
      errors: [
        { status: 503, description: 'A required runtime dependency is unavailable', schema: notReadySchema },
      ],
    },
  },
}
