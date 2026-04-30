import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { S3StorageDriver } from '../../../../lib/s3-driver'

export const metadata = {
  path: '/storage-providers/s3/signed-url',
  POST: { requireAuth: true, requireFeatures: ['storage_providers.manage'] },
}

const requestSchema = z.object({
  key: z.string().min(1),
  operation: z.enum(['upload', 'download']),
  expiresIn: z.number().int().min(60).max(604800).optional().default(3600),
  contentType: z.string().optional(),
})

const responseSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
})

async function resolveDriver(tenantId: string, orgId: string): Promise<S3StorageDriver | null> {
  const { resolve } = await createRequestContainer()
  const credentialsService = resolve('integrationCredentialsService') as {
    resolve(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
  }
  const creds = await credentialsService.resolve('storage_s3', { tenantId, organizationId: orgId })
  if (!creds) return null
  return new S3StorageDriver(creds)
}

function isKeyScoped(key: string, orgId: string, tenantId: string): boolean {
  return key.includes(`org_${orgId}/tenant_${tenantId}/`)
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const json = await req.json().catch(() => null)
  const parsed = requestSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  if (!isKeyScoped(parsed.data.key, auth.orgId, auth.tenantId)) {
    return NextResponse.json({ error: 'Access denied: key is not scoped to this tenant.' }, { status: 403 })
  }

  const driver = await resolveDriver(auth.tenantId, auth.orgId)
  if (!driver) {
    return NextResponse.json({ error: 'S3 integration is not configured.' }, { status: 400 })
  }

  const { key, operation, expiresIn, contentType } = parsed.data
  const url = await driver.getSignedUrl(key, operation, expiresIn, contentType)
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  return NextResponse.json({ url, expiresAt })
}

export default POST

export const openApi: OpenApiRouteDoc = {
  tag: 'Storage',
  summary: 'Generate S3 pre-signed URL',
  methods: {
    POST: {
      summary: 'Generate a pre-signed URL for direct browser upload or download',
      description: 'Returns a time-limited URL that allows a browser to directly upload or download a file from S3.',
      requestBody: { contentType: 'application/json', schema: requestSchema },
      responses: [{ status: 200, description: 'Pre-signed URL and expiry', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or S3 not configured', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Key not scoped to this tenant', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
