import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { mergeAttachmentMetadata, readAttachmentMetadata } from '../../lib/metadata'

const transferSchema = z.object({
  entityId: z.string().min(1),
  attachmentIds: z.array(z.string().uuid()).min(1),
  fromRecordId: z.string().min(1).optional(),
  toRecordId: z.string().min(1),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['attachments.manage'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const json = await req.json().catch(() => null)
  const parsed = transferSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const { attachmentIds, entityId, fromRecordId, toRecordId } = parsed.data
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  let AttachmentEntity: any
  try {
    const mod = await import('@open-mercato/core/modules/attachments/data/entities')
    AttachmentEntity = mod.Attachment
  } catch {
    return NextResponse.json({ error: 'Attachment model missing' }, { status: 500 })
  }
  const filters: Record<string, unknown> = {
    id: { $in: attachmentIds },
    entityId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  }
  if (fromRecordId) {
    filters.recordId = fromRecordId
  }
  const records = await em.find(AttachmentEntity, filters)
  if (!records.length) {
    return NextResponse.json({ error: 'Attachments not found' }, { status: 404 })
  }
  for (const record of records) {
    const previousRecordId = record.recordId
    record.recordId = toRecordId
    const metadata = readAttachmentMetadata(record.storageMetadata)
    const nextAssignments =
      metadata.assignments?.map((assignment) => {
        const matchesType = assignment.type === entityId
        const matchesRecord = fromRecordId
          ? assignment.id === fromRecordId
          : assignment.id === previousRecordId
        if (matchesType && matchesRecord) {
          return { ...assignment, id: toRecordId }
        }
        return assignment
      }) ?? []
    record.storageMetadata = mergeAttachmentMetadata(record.storageMetadata, { assignments: nextAssignments })
  }
  await em.persistAndFlush(records)
  return NextResponse.json({ ok: true, updated: records.length })
}
