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
  PATCH: { requireAuth: true, requireFeatures: ['attachments.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['attachments.manage'] },
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
  const json = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
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
  const patch: Record<string, unknown> = {}
  if (parsed.data.tags) patch.tags = normalizeAttachmentTags(parsed.data.tags)
  if (parsed.data.assignments) patch.assignments = normalizeAttachmentAssignments(parsed.data.assignments)
  record.storageMetadata = mergeAttachmentMetadata(record.storageMetadata, patch)
  await em.flush()
  const metadata = readAttachmentMetadata(record.storageMetadata)
  return NextResponse.json({
    ok: true,
    item: {
      id: record.id,
      tags: metadata.tags ?? [],
      assignments: metadata.assignments ?? [],
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
