import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTimeEntrySegment } from '../../../../../data/entities'
import { staffTimeEntrySegmentUpdateSchema } from '../../../../../data/validators'

const routeMetadata = {
  PATCH: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

export const metadata = routeMetadata

type RouteParams = { id: string; segmentId: string }
type RouteContext = { params: Promise<RouteParams> }

async function resolveParams(ctx: RouteContext): Promise<RouteParams | null> {
  try {
    const params = await ctx.params
    if (typeof params.id === 'string' && params.id.trim().length > 0 &&
        typeof params.segmentId === 'string' && params.segmentId.trim().length > 0) {
      return params
    }
    return null
  } catch {
    return null
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = await resolveParams(ctx)
  if (!params) {
    return NextResponse.json({ error: 'Segment id is required' }, { status: 400 })
  }

  const rawBody = await req.json().catch(() => null)
  if (!rawBody) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const parsed = staffTimeEntrySegmentUpdateSchema.safeParse({ ...rawBody, id: params.segmentId })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const segment = await findOneWithDecryption(
    em,
    StaffTimeEntrySegment,
    {
      id: params.segmentId,
      timeEntryId: params.id,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      deletedAt: null,
    },
    {},
    scope,
  )

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
    id: z.string().uuid(),
    timeEntryId: z.string().uuid(),
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
