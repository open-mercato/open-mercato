import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTimeEntry, StaffTimeEntrySegment } from '../../../../../../data/entities'
import { staffTimeEntrySegmentUpdateSchema } from '../../../../../../data/validators'
import { getStaffMemberByUserId } from '../../../../../../lib/staffMemberResolver'

const routeMetadata = {
  PATCH: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

export const metadata = routeMetadata

function extractIdsFromUrl(request?: Request): { entryId: string; segmentId: string } | null {
  if (!request?.url) return null
  try {
    const url = new URL(request.url)
    const match = url.pathname.match(/\/time-entries\/([^/]+)\/segments\/([^/]+)/)
    if (!match?.[1] || !match?.[2]) return null
    return { entryId: match[1], segmentId: match[2] }
  } catch {
    return null
  }
}

export async function PATCH(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ids = extractIdsFromUrl(req)
  if (!ids) {
    return NextResponse.json({ error: 'Segment id is required' }, { status: 400 })
  }

  const rawBody = await req.json().catch(() => null)
  if (!rawBody) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const parsed = staffTimeEntrySegmentUpdateSchema.safeParse({ ...rawBody, id: ids.segmentId })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }

  const { resolve } = await createRequestContainer()
  const em = (resolve('em') as EntityManager).fork()
  const scopeCtx = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const entry = await findOneWithDecryption(em, StaffTimeEntry, { id: ids.entryId, tenantId: auth.tenantId, organizationId: auth.orgId, deletedAt: null }, {}, scopeCtx)
  if (!entry) {
    return NextResponse.json({ error: 'Time entry not found' }, { status: 404 })
  }

  const staffMember = await getStaffMemberByUserId(em, auth.sub, auth.tenantId, auth.orgId)
  if (!staffMember || entry.staffMemberId !== staffMember.id) {
    return NextResponse.json({ error: 'You can only manage your own time entries.' }, { status: 403 })
  }

  const segment = await findOneWithDecryption(em, StaffTimeEntrySegment, {
    id: ids.segmentId,
    timeEntryId: ids.entryId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  }, {}, scopeCtx)

  if (!segment) {
    return NextResponse.json({ error: 'Segment not found' }, { status: 404 })
  }

  if (parsed.data.startedAt !== undefined) {
    segment.startedAt = parsed.data.startedAt
  }
  if (parsed.data.endedAt !== undefined) {
    segment.endedAt = parsed.data.endedAt ?? null
  }
  if (parsed.data.segmentType !== undefined) {
    segment.segmentType = parsed.data.segmentType
  }

  await em.flush()

  return NextResponse.json({
    ok: true,
    item: {
      id: segment.id,
      timeEntryId: segment.timeEntryId,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      segmentType: segment.segmentType,
      createdAt: segment.createdAt,
      updatedAt: segment.updatedAt,
    },
  })
}

const errorSchema = z.object({ error: z.string() })
const segmentResponseSchema = z.object({
  ok: z.literal(true),
  item: z.object({
    id: z.string(),
    timeEntryId: z.string(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    segmentType: z.enum(['work', 'break']),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Time entry segment management',
  methods: {
    PATCH: {
      summary: 'Update a time entry segment',
      description: 'Updates fields on an existing time entry segment (startedAt, endedAt, segmentType).',
      requestBody: {
        contentType: 'application/json',
        schema: staffTimeEntrySegmentUpdateSchema.omit({ id: true }),
      },
      responses: [
        { status: 200, description: 'Segment updated successfully', schema: segmentResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload or missing segment id', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Segment not found', schema: errorSchema },
      ],
    },
  },
}
