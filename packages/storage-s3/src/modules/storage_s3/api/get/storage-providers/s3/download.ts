import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { S3StorageDriver } from '../../../../lib/s3-driver'

export const metadata = {
  path: '/storage-providers/s3/download',
  GET: { requireAuth: true, requireFeatures: ['storage_providers.manage'] },
}

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
  const parts = key.split('/')
  return parts.length >= 3 && parts[1] === `org_${orgId}` && parts[2] === `tenant_${tenantId}`
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const key = new URL(req.url).searchParams.get('key')
  if (!key) {
    return NextResponse.json({ error: 'key query param is required' }, { status: 400 })
  }

  if (!isKeyScoped(key, auth.orgId, auth.tenantId)) {
    return NextResponse.json({ error: 'Access denied: key is not scoped to this tenant.' }, { status: 403 })
  }

  const driver = await resolveDriver(auth.tenantId, auth.orgId)
  if (!driver) {
    return NextResponse.json({ error: 'S3 integration is not configured.' }, { status: 400 })
  }

  let buffer: Buffer
  let contentType: string | undefined
  try {
    const result = await driver.read('', key)
    buffer = result.buffer
    contentType = result.contentType
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType ?? 'application/octet-stream',
      'Content-Length': String(buffer.length),
    },
  })
}

export default GET

export const openApi: OpenApiRouteDoc = {
  tag: 'Storage',
  summary: 'Download file from S3',
  methods: {
    GET: {
      summary: 'Download a file from S3 by key',
      description: 'Streams the file content for the given S3 key. Requires storage_providers.manage feature.',
      query: z.object({ key: z.string().describe('S3 object key') }),
      responses: [{ status: 200, description: 'File content stream', schema: z.any() }],
      errors: [
        { status: 400, description: 'Missing key or S3 not configured', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Key not scoped to this tenant', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'File not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
