import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment } from '../../../data/entities'
import {
  mergeAttachmentMetadata,
  normalizeAttachmentAssignments,
  normalizeAttachmentTags,
  readAttachmentMetadata,
} from '../../../lib/metadata'
import { deletePartitionFile } from '../../../lib/storage'
import { splitCustomFieldPayload, loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

const updateSchema = z.object({
  tags: z.array(z.string()).optional(),
  assignments: z
    .array(
      z.object({
        type: z.string().min(1),
        id: z.string().min(1),
        href: z.string().nullable().optional(),
        label: z.string().nullable().optional(),
      }),
    )
    .optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['attachments.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['attachments.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['attachments.manage'] },
}

function normalizeCustomFieldResponse(values: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!values) return undefined
  const entries: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('cf_')) {
      const normalized = key.slice(3)
      if (normalized) entries[normalized] = value
      continue
    }
    if (key.startsWith('cf:')) {
      const normalized = key.slice(3)
      if (normalized) entries[normalized] = value
      continue
    }
    entries[key] = value
  }
  return Object.keys(entries).length ? entries : undefined
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const attachmentId = ctx.params?.id
  if (!attachmentId) {
    return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })
  }
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const record = await em.findOne(Attachment, {
    id: attachmentId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })
  if (!record) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }
  const metadata = readAttachmentMetadata(record.storageMetadata)
  const customFieldValues = await loadCustomFieldValues({
    em,
    entityId: E.attachments.attachment,
    recordIds: [record.id],
    tenantIdByRecord: { [record.id]: record.tenantId ?? auth.tenantId ?? null },
    organizationIdByRecord: { [record.id]: record.organizationId ?? auth.orgId ?? null },
    tenantFallbacks: [auth.tenantId ?? null].filter((value): value is string => !!value),
  })
  const customFields = normalizeCustomFieldResponse(customFieldValues[record.id])
  return NextResponse.json({
    item: {
      id: record.id,
      fileName: record.fileName,
      fileSize: record.fileSize,
      mimeType: record.mimeType,
      partitionCode: record.partitionCode,
      tags: metadata.tags ?? [],
      assignments: metadata.assignments ?? [],
      customFields,
    },
  })
}

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const attachmentId = ctx.params?.id
  if (!attachmentId) {
    return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })
  }
  const rawBody = await req.json().catch(() => null)
  const { base, custom } = splitCustomFieldPayload(rawBody)
  const parsed = updateSchema.safeParse(base)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const dataEngine = resolve('dataEngine') as any
  const record = await em.findOne(Attachment, {
    id: attachmentId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })
  if (!record) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }
  const patch: Record<string, unknown> = {}
  if (parsed.data.tags) patch.tags = normalizeAttachmentTags(parsed.data.tags)
  if (parsed.data.assignments) patch.assignments = normalizeAttachmentAssignments(parsed.data.assignments)
  record.storageMetadata = mergeAttachmentMetadata(record.storageMetadata, patch)
  await em.flush()

  if (dataEngine && custom && Object.keys(custom).length) {
    try {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.attachments.attachment,
        recordId: record.id,
        tenantId: record.tenantId ?? auth.tenantId ?? null,
        organizationId: record.organizationId ?? auth.orgId ?? null,
        values: custom,
      })
    } catch (error) {
      console.error('[attachments] failed to persist custom attributes', error)
      return NextResponse.json({ error: 'Failed to save attachment attributes.' }, { status: 500 })
    }
  }

  const metadata = readAttachmentMetadata(record.storageMetadata)
  return NextResponse.json({
    ok: true,
    item: {
      id: record.id,
      tags: metadata.tags ?? [],
      assignments: metadata.assignments ?? [],
      customFields: normalizeCustomFieldResponse(custom ?? null),
    },
  })
}

export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const attachmentId = ctx.params?.id
  if (!attachmentId) {
    return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })
  }
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const record = await em.findOne(Attachment, {
    id: attachmentId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })
  if (!record) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  await deletePartitionFile(record.partitionCode, record.storagePath, record.storageDriver)
  await em.removeAndFlush(record)

  return NextResponse.json({ ok: true })
}
