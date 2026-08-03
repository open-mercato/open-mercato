import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { S3StorageDriver } from '../../../../lib/s3-driver'

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

const DEFAULT_LIST_NAMESPACE = 'uploads'

async function resolveDriver(tenantId: string, orgId: string): Promise<S3StorageDriver | null> {
  const { resolve } = await createRequestContainer()
  const credentialsService = resolve('integrationCredentialsService') as {
    resolve(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
  }
  const creds = await credentialsService.resolve('storage_s3', { tenantId, organizationId: orgId })
  if (!creds) return null
  return new S3StorageDriver({ ...creds, organizationId: orgId, tenantId })
}

function buildTenantPrefix(namespace: string, tenantId: string, orgId: string): string {
  return `${namespace}/org_${orgId}/tenant_${tenantId}/`
}

function resolveTenantScopedPrefix(prefix: string, tenantId: string, orgId: string): string | null {
  const normalized = prefix.replace(/^\/+/, '')
  const parts = normalized.split('/')
  const namespace = parts[0] || DEFAULT_LIST_NAMESPACE
  const tenantPrefix = buildTenantPrefix(namespace, tenantId, orgId)

  if (!normalized || normalized === tenantPrefix.slice(0, -1)) {
    return tenantPrefix
  }

  if (normalized.startsWith(tenantPrefix)) {
    return normalized
  }

  if (
    parts[1]?.startsWith('org_') ||
    parts[2]?.startsWith('tenant_') ||
    normalized.includes(`org_${orgId}/tenant_${tenantId}`)
  ) {
    return null
  }

  const namespaceRelativePrefix = normalized.slice(namespace.length).replace(/^\/+/, '')
  return tenantPrefix + namespaceRelativePrefix
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

  // Always scope list operations to the tenant namespace to prevent cross-tenant enumeration.
  const effectivePrefix = resolveTenantScopedPrefix(parsed.data.prefix, auth.tenantId, auth.orgId)
  if (effectivePrefix === null) {
    return NextResponse.json(
      { error: 'Access denied: prefix is not scoped to this tenant.' },
      { status: 403 },
    )
  }

  const driver = await resolveDriver(auth.tenantId, auth.orgId)
  if (!driver) {
    return NextResponse.json({ error: 'S3 integration is not configured.' }, { status: 400 })
  }

  const result = await driver.listObjects(
    effectivePrefix,
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
      description: 'Returns a paginated list of S3 objects scoped to the authenticated tenant namespace.',
      query: querySchema,
      responses: [{ status: 200, description: 'File listing', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid params or S3 not configured', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Prefix not scoped to this tenant', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
