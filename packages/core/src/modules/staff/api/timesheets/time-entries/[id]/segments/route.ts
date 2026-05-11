import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeEntry, StaffTimeEntrySegment } from '../../../../../data/entities'
import { staffTimeEntrySegmentCreateSchema } from '../../../../../data/validators'
import { getStaffMemberByUserId } from '../../../../../lib/staffMemberResolver'
import {
  resolveUserFeatures,
  runStaffMutationGuardAfterSuccess,
  runStaffMutationGuards,
} from '../../../../guards'

function extractEntryIdFromUrl(request?: Request): string | null {
  if (!request?.url) return null
  try {
    const url = new URL(request.url)
    const match = url.pathname.match(/\/time-entries\/([^/]+)\/segments/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, { error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.') })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const scopeCtx = { tenantId, organizationId }

    const entryId = extractEntryIdFromUrl(req)
    if (!entryId) {
      throw new CrudHttpError(400, { error: translate('staff.timesheets.errors.missingEntryId', 'Missing entry ID.') })
    }

    const entry = await findOneWithDecryption(
      em,
      StaffTimeEntry,
      { id: entryId, tenantId, organizationId, deletedAt: null },
      {},
      scopeCtx,
    )
    if (!entry) {
      throw new CrudHttpError(404, { error: translate('staff.timesheets.errors.entryNotFound', 'Time entry not found.') })
    }

    const staffMember = await getStaffMemberByUserId(em, auth.sub, tenantId, organizationId)
    if (!staffMember || entry.staffMemberId !== staffMember.id) {
      throw new CrudHttpError(403, { error: translate('staff.timesheets.errors.notOwner', 'You can only manage your own time entries.') })
    }

    const body = await req.json().catch(() => ({}))
    const input = parseScopedCommandInput(
      staffTimeEntrySegmentCreateSchema,
      { ...body, timeEntryId: entryId },
      {
        container,
        auth,
        organizationScope: scope,
        selectedOrganizationId: organizationId,
        organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
        request: req,
      },
      translate,
    )

    const guardResult = await runStaffMutationGuards(
      container,
      {
        tenantId,
        organizationId,
        userId: auth.sub ?? '',
        resourceKind: 'staff.timesheets.time_entry_segment',
        resourceId: entry.id,
        operation: 'create',
        requestMethod: req.method,
        requestHeaders: req.headers,
        mutationPayload: input as unknown as Record<string, unknown>,
      },
      resolveUserFeatures(auth),
    )
    if (!guardResult.ok) {
      return NextResponse.json(
        guardResult.errorBody ?? { error: 'Operation blocked by guard' },
        { status: guardResult.errorStatus ?? 422 },
      )
    }

    const segmentData = {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      timeEntryId: input.timeEntryId,
      startedAt: input.startedAt,
      endedAt: input.endedAt ?? null,
      segmentType: input.segmentType,
    }
    const segment = em.create(StaffTimeEntrySegment, segmentData as never)

    await em.flush()

    if (guardResult.afterSuccessCallbacks.length) {
      await runStaffMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
        tenantId,
        organizationId,
        userId: auth.sub ?? '',
        resourceKind: 'staff.timesheets.time_entry_segment',
        resourceId: segment.id,
        operation: 'create',
        requestMethod: req.method,
        requestHeaders: req.headers,
      })
    }

    return NextResponse.json(
      {
        id: segment.id,
        timeEntryId: segment.timeEntryId,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt ?? null,
        segmentType: segment.segmentType,
        createdAt: segment.createdAt,
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('staff.timesheets.time-entries.segments.create failed', err)
    return NextResponse.json(
      { error: translate('staff.timesheets.errors.segmentCreate', 'Failed to create time entry segment.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Add a segment to a time entry',
  methods: {
    POST: {
      summary: 'Add a segment to a time entry',
      description: 'Creates a new work or break segment for the specified time entry.',
      requestBody: {
        contentType: 'application/json',
        schema: staffTimeEntrySegmentCreateSchema,
      },
      responses: [
        {
          status: 201,
          description: 'Segment created',
          schema: z.object({
            id: z.string().uuid(),
            timeEntryId: z.string().uuid(),
            startedAt: z.string(),
            endedAt: z.string().nullable(),
            segmentType: z.enum(['work', 'break']),
            createdAt: z.string(),
          }),
        },
        { status: 404, description: 'Time entry not found', schema: z.object({ error: z.string() }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
