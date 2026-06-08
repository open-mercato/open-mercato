import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { StaffTimeEntry, StaffTimeEntrySegment } from '../../../../../../data/entities'
import { staffTimeEntrySegmentUpdateSchema } from '../../../../../../data/validators'
import { getStaffMemberByUserId } from '../../../../../../lib/staffMemberResolver'
import {
  resolveUserFeatures,
  runStaffMutationGuardAfterSuccess,
  runStaffMutationGuards,
} from '../../../../../guards'

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
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ids = extractIdsFromUrl(req)
  if (!ids) {
    return NextResponse.json({ error: 'Segment id is required' }, { status: 400 })
  }

  const rawBody = await readJsonSafe<Record<string, unknown>>(req, null)
  if (!rawBody) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const parsed = staffTimeEntrySegmentUpdateSchema.safeParse({ ...rawBody, id: ids.segmentId })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const tenantId = scope?.tenantId ?? auth.tenantId ?? null
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!tenantId || !organizationId) {
    return NextResponse.json({ error: 'Missing tenant or organization scope.' }, { status: 400 })
  }

  const em = (container.resolve('em') as EntityManager).fork()
  const scopeCtx = { tenantId, organizationId }

  const entry = await findOneWithDecryption(em, StaffTimeEntry, { id: ids.entryId, tenantId, organizationId, deletedAt: null }, {}, scopeCtx)
  if (!entry) {
    return NextResponse.json({ error: 'Time entry not found' }, { status: 404 })
  }

  const staffMember = await getStaffMemberByUserId(em, auth.sub, tenantId, organizationId)
  if (!staffMember || entry.staffMemberId !== staffMember.id) {
    return NextResponse.json({ error: 'You can only manage your own time entries.' }, { status: 403 })
  }

  const segment = await findOneWithDecryption(em, StaffTimeEntrySegment, {
    id: ids.segmentId,
    timeEntryId: ids.entryId,
    tenantId,
    organizationId,
    deletedAt: null,
  }, {}, scopeCtx)

  if (!segment) {
    return NextResponse.json({ error: 'Segment not found' }, { status: 404 })
  }

  const guardResult = await runStaffMutationGuards(
    container,
    {
      tenantId,
      organizationId,
      userId: auth.sub ?? '',
      resourceKind: 'staff.timesheets.time_entry_segment',
      resourceId: segment.id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: parsed.data as unknown as Record<string, unknown>,
    },
    resolveUserFeatures(auth),
  )
  if (!guardResult.ok) {
    return NextResponse.json(
      guardResult.errorBody ?? { error: 'Operation blocked by guard' },
      { status: guardResult.errorStatus ?? 422 },
    )
  }

  // Apply the segment edit inside a single transaction with a PESSIMISTIC_WRITE
  // lock on the parent time entry row, re-loading the segment under the lock so
  // concurrent segment edits / timer-stop recomputes on the same entry serialize
  // instead of racing on a shared in-memory snapshot (issue #2416).
  let updatedSegment: StaffTimeEntrySegment
  try {
    updatedSegment = await em.transactional(async (trx) => {
      const lockedEntry = await findOneWithDecryption(
        trx,
        StaffTimeEntry,
        { id: ids.entryId, tenantId, organizationId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scopeCtx,
      )
      if (!lockedEntry) {
        throw new CrudHttpError(404, { error: 'Time entry not found' })
      }

      const lockedSegment = await findOneWithDecryption(
        trx,
        StaffTimeEntrySegment,
        { id: ids.segmentId, timeEntryId: ids.entryId, tenantId, organizationId, deletedAt: null },
        {},
        scopeCtx,
      )
      if (!lockedSegment) {
        throw new CrudHttpError(404, { error: 'Segment not found' })
      }

      if (parsed.data.startedAt !== undefined) {
        lockedSegment.startedAt = parsed.data.startedAt
      }
      if (parsed.data.endedAt !== undefined) {
        lockedSegment.endedAt = parsed.data.endedAt ?? null
      }
      if (parsed.data.segmentType !== undefined) {
        lockedSegment.segmentType = parsed.data.segmentType
      }

      await trx.flush()
      return lockedSegment
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }

  if (guardResult.afterSuccessCallbacks.length) {
    await runStaffMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
      tenantId,
      organizationId,
      userId: auth.sub ?? '',
      resourceKind: 'staff.timesheets.time_entry_segment',
      resourceId: updatedSegment.id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
    })
  }

  return NextResponse.json({
    ok: true,
    item: {
      id: updatedSegment.id,
      timeEntryId: updatedSegment.timeEntryId,
      startedAt: updatedSegment.startedAt,
      endedAt: updatedSegment.endedAt,
      segmentType: updatedSegment.segmentType,
      createdAt: updatedSegment.createdAt,
      updatedAt: updatedSegment.updatedAt,
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
