import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { S3StorageDriver } from '../../../../lib/s3-driver'

export const metadata = {
  path: '/storage-providers/s3/delete',
  DELETE: { requireAuth: true, requireFeatures: ['storage_providers.manage'] },
}

const requestSchema = z.object({
  key: z.string().min(1),
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
  const parts = key.split('/')
  return parts.length >= 3 && parts[1] === `org_${orgId}` && parts[2] === `tenant_${tenantId}`
}

export async function DELETE(req: Request) {
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

  await driver.delete('', parsed.data.key)
  return new NextResponse(null, { status: 204 })
}

export default DELETE

export const openApi: OpenApiRouteDoc = {
  tag: 'Storage',
  summary: 'Delete file from S3',
  methods: {
    DELETE: {
      summary: 'Delete a file from S3 by key',
      description: 'Permanently removes the object at the given key from the configured S3 bucket.',
      requestBody: { contentType: 'application/json', schema: requestSchema },
      responses: [{ status: 204, description: 'File deleted', schema: z.null() }],
      errors: [
        { status: 400, description: 'Invalid payload or S3 not configured', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Key not scoped to this tenant', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
