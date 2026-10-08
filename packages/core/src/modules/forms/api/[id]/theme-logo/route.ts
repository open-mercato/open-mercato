/**
 * Form logo upload — POST /api/forms/:id/theme-logo
 *
 * Authoring-only (`forms.design`). Stores a brand logo/header image so a themed
 * form can render it. The author NEVER supplies a URL — only the uploaded bytes;
 * the route returns an `assetId` that the studio writes into `x-om-theme.logo`.
 *
 * The image is validated (magic bytes + dimensions + size) and stored via the
 * core attachments storage into a PUBLIC, UNSCOPED partition row (`formLogos`,
 * no org/tenant) so the public image route can serve it to anonymous form
 * visitors on `/f/:slug` and `/embed/:slug` (see D4 in
 * `.ai/specs/2026-05-22-forms-styling-ux-and-branding.md`). The asset is
 * referenced only by opaque UUID.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { storePartitionFile } from '@open-mercato/core/modules/attachments/lib/storage'
import {
  detectImageMimeType,
  validateImageMagicBytes,
  validateImageDimensions,
} from '@open-mercato/core/modules/attachments/lib/imageSafety'
import { buildAttachmentFileUrl } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { Form } from '../../../data/entities'
import { buildFormsRouteContext, handleRouteError, jsonError } from '../../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['forms.design'] },
}

const LOGO_PARTITION_CODE = 'formLogos'
const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2 MiB — logos/headers are small

async function ensureLogoPartition(em: EntityManager): Promise<void> {
  const existing = await em.findOne(AttachmentPartition, { code: LOGO_PARTITION_CODE })
  if (existing) return
  const partition = em.create(AttachmentPartition, {
    code: LOGO_PARTITION_CODE,
    title: 'Form logos',
    description: 'Public logos/headers uploaded for branded forms.',
    storageDriver: 'local',
    isPublic: true,
    requiresOcr: false,
  })
  em.persist(partition)
  await em.flush()
}

export async function POST(
  req: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  try {
    const { ctx, organizationId, tenantId } = await buildFormsRouteContext(req)
    const em = ctx.container.resolve('em') as EntityManager
    const params = await Promise.resolve(context.params)
    const formId = String(params.id)

    // Ownership: the form must exist within the caller's scope.
    const form = await em.findOne(Form, {
      id: formId,
      ...(organizationId ? { organizationId } : {}),
      ...(tenantId ? { tenantId } : {}),
    })
    if (!form) return jsonError(404, 'forms.errors.not_found')

    const contentType = req.headers.get('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      return jsonError(400, 'forms.errors.invalid_upload')
    }
    const formData = await req.formData()
    const file = formData.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return jsonError(422, 'forms.errors.invalid_upload')
    }
    if (file.size > MAX_LOGO_BYTES) {
      return jsonError(413, 'forms.errors.file_too_large')
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const detectedMime = detectImageMimeType(buffer)
    const magic = validateImageMagicBytes(buffer, detectedMime)
    if (!magic.ok) return jsonError(422, 'forms.errors.invalid_image')
    const dimensions = await validateImageDimensions(buffer)
    if (!dimensions.ok) return jsonError(422, 'forms.errors.invalid_image')

    await ensureLogoPartition(em)

    const stored = await storePartitionFile({
      partitionCode: LOGO_PARTITION_CODE,
      orgId: null,
      tenantId: null,
      fileName: file.name || 'logo',
      buffer,
    })

    const assetId = randomUUID()
    const attachment = em.create(Attachment, {
      id: assetId,
      entityId: 'forms:theme-logo',
      recordId: formId,
      organizationId: null,
      tenantId: null,
      partitionCode: LOGO_PARTITION_CODE,
      fileName: stored.fileName,
      mimeType: detectedMime ?? 'image/png',
      fileSize: buffer.length,
      storageDriver: 'local',
      storagePath: stored.storagePath,
      url: buildAttachmentFileUrl(assetId),
      storageMetadata: null,
    })
    em.persist(attachment)
    await em.flush()

    return NextResponse.json({ assetId }, { status: 201 })
  } catch (error) {
    return handleRouteError('theme-logo', error)
  }
}

const errorSchema = z.object({ error: z.string() })
const responseSchema = z.object({ assetId: z.string().uuid() })

const postMethodDoc: OpenApiMethodDoc = {
  summary: 'Upload a form logo/header image',
  description:
    'Stores a brand logo as a public, unscoped attachment and returns its assetId for x-om-theme.logo. Requires forms.design.',
  tags: ['Forms Authoring'],
  responses: [{ status: 201, description: 'Logo stored', schema: responseSchema }],
  errors: [
    { status: 400, description: 'Not a multipart upload', schema: errorSchema },
    { status: 404, description: 'Form not found in scope', schema: errorSchema },
    { status: 413, description: 'File too large', schema: errorSchema },
    { status: 422, description: 'Missing file or not a valid image', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Form logo upload',
  methods: { POST: postMethodDoc },
}
