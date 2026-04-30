import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { S3StorageDriver } from '../../../../lib/s3-driver'
import { randomUUID } from 'crypto'

export const metadata = {
  path: '/storage-providers/s3/upload',
  POST: { requireAuth: true, requireFeatures: ['storage_providers.manage'] },
}

const responseSchema = z.object({
  key: z.string(),
  bucket: z.string(),
  size: z.number().int(),
  contentType: z.string().optional(),
})

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload'
}

function isKeyScoped(key: string, orgId: string, tenantId: string): boolean {
  return key.includes(`org_${orgId}/tenant_${tenantId}/`)
}

async function resolveDriver(
  tenantId: string,
  orgId: string,
): Promise<S3StorageDriver | null> {
  const { resolve } = await createRequestContainer()
  const credentialsService = resolve('integrationCredentialsService') as {
    resolve(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
  }
  const creds = await credentialsService.resolve('storage_s3', { tenantId, organizationId: orgId })
  if (!creds) return null
  return new S3StorageDriver(creds)
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 })
  }

  const keyOverride = form.get('key') ? String(form.get('key')) : null
  const contentTypeHeader = form.get('contentType') ? String(form.get('contentType')) : file.type || undefined

  if (keyOverride !== null && !isKeyScoped(keyOverride, auth.orgId, auth.tenantId)) {
    return NextResponse.json(
      { error: 'Access denied: key override is not scoped to this tenant.' },
      { status: 403 },
    )
  }

  const driver = await resolveDriver(auth.tenantId, auth.orgId)
  if (!driver) {
    return NextResponse.json({ error: 'S3 integration is not configured.' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const safeName = sanitizeFileName(file.name)
  const key =
    keyOverride ??
    `uploads/org_${auth.orgId}/tenant_${auth.tenantId}/${Date.now()}_${randomUUID().slice(0, 8)}_${safeName}`

  await driver.putObject(key, buffer, contentTypeHeader)

  return NextResponse.json({
    key,
    bucket: driver.getBucket(),
    size: buffer.length,
    contentType: contentTypeHeader,
  })
}

export default POST

export const openApi: OpenApiRouteDoc = {
  tag: 'Storage',
  summary: 'Upload file to S3',
  methods: {
    POST: {
      summary: 'Upload a file directly to S3',
      description: 'Uploads a file to the configured S3 bucket. Requires storage_providers.manage feature.',
      requestBody: {
        contentType: 'multipart/form-data',
        schema: z.object({
          file: z.any().describe('File to upload'),
          key: z.string().optional().describe('Optional S3 key override (must be scoped to org/tenant)'),
          contentType: z.string().optional().describe('Optional content-type override'),
        }),
      },
      responses: [{ status: 200, description: 'Upload result', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Missing file or S3 not configured', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Key override not scoped to this tenant', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
