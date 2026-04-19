import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { S3StorageDriver } from '@open-mercato/core/modules/attachments/lib/drivers/s3Driver'

export const metadata = {
  path: '/storage-providers/s3/list',
  GET: { requireAuth: true, requireFeatures: ['storage_providers.manage'] },
}

const querySchema = z.object({
  prefix: z.string().optional().default(''),
  maxKeys: z.coerce.number().int().min(1).max(1000).optional().default(100),
  continuationToken: z.string().optional(),
})

const fileSchema = z.object({
  key: z.string(),
  size: z.number().int(),
  lastModified: z.string(),
})

const responseSchema = z.object({
  files: z.array(fileSchema),
  truncated: z.boolean(),
  nextContinuationToken: z.string().optional(),
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

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = Object.fromEntries(new URL(req.url).searchParams.entries())
  const parsed = querySchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  const driver = await resolveDriver(auth.tenantId, auth.orgId)
  if (!driver) {
    return NextResponse.json({ error: 'S3 integration is not configured.' }, { status: 400 })
  }

  const result = await driver.listObjects(
    parsed.data.prefix,
    parsed.data.maxKeys,
    parsed.data.continuationToken,
  )

  return NextResponse.json({
    files: result.files.map((f) => ({
      key: f.key,
      size: f.size,
      lastModified: f.lastModified.toISOString(),
    })),
    truncated: result.truncated,
    nextContinuationToken: result.nextContinuationToken,
  })
}

export default GET

export const openApi: OpenApiRouteDoc = {
  tag: 'Storage',
  summary: 'List S3 objects',
  methods: {
    GET: {
      summary: 'List files in S3 by prefix',
      description: 'Returns a paginated list of S3 objects matching the given prefix.',
      query: querySchema,
      responses: [{ status: 200, description: 'File listing', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid params or S3 not configured', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
