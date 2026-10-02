import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTeamMember } from '../../../data/entities'
import { staffTimesheetPreferenceUpdateSchema } from '../../../data/validators'
import {
  isProjectAssignedToMember,
  loadTimesheetPreference,
  saveTimesheetPreference,
} from '../../../lib/timesheets/timesheetPreferenceService'
import { runStaffMutationGuardAfterSuccess, runStaffMutationGuards } from '../../guards'
import { runTimesheetInterceptors } from '../_shared/withTimesheetInterceptors'

const logger = createLogger('staff')

const RESOURCE_KIND = 'staff.timesheets.preference'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
  PUT: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

const preferenceResponseSchema = z.object({
  lastProjectId: z.string().uuid().nullable(),
  updatedAt: z.string().nullable(),
})

/**
 * Resolves the caller's own staff member for the *requested* scope.
 *
 * Deliberately not `getStaffMemberByUserId`: that helper takes tenant and
 * organization but passes them only as a decryption scope, so its query is
 * `WHERE user_id = ?` with no scope predicate. `StaffTeamMember` is org-scoped,
 * so a user belonging to two organizations has two rows and the helper returns an
 * arbitrary one. This route mirrors the sibling `my-projects/[projectId]` route,
 * which filters explicitly — the spec's own rule is that where the two precedents
 * disagree, `my-projects/[projectId]` wins.
 */
async function resolveOwnStaffMember(
  em: EntityManager,
  userId: string,
  tenantId: string,
  organizationId: string,
) {
  return findOneWithDecryption(
    em,
    StaffTeamMember,
    { userId, tenantId, organizationId, deletedAt: null },
    {},
    { tenantId, organizationId },
  )
}

async function resolveRequestContext(req: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) {
    throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const tenantId = scope?.tenantId ?? auth.tenantId ?? null
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, {
      error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
    })
  }

  const em = (container.resolve('em') as EntityManager).fork()
  const staffMember = await resolveOwnStaffMember(em, auth.sub, tenantId, organizationId)
  if (!staffMember) {
    throw new CrudHttpError(403, {
      error: translate('staff.timesheets.errors.noStaffMember', 'No staff member linked to your account.'),
    })
  }

  return { container, auth, translate, em, staffMember, scope: { tenantId, organizationId } }
}

/**
 * GET /api/staff/timesheets/my-preferences
 *
 * Self-scoped. There is no `staffMemberId` parameter by design, so the endpoint
 * cannot be used to read another member's default. Absence of a row is not an
 * error — it returns `lastProjectId: null`.
 */
export async function GET(req: Request) {
  try {
    const { em, staffMember, scope } = await resolveRequestContext(req)
    const preference = await loadTimesheetPreference(em, scope, staffMember.id)
    return NextResponse.json(preference, { status: 200 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('staff.timesheets.my-preferences.get failed', { err })
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('staff.timesheets.errors.loadPreference', 'Failed to load timesheet preference.') },
      { status: 400 },
    )
  }
}

/**
 * PUT /api/staff/timesheets/my-preferences
 *
 * Written automatically after a successful timer start. The client deliberately
 * does not wrap this call in `useGuardedMutation` — it is a side effect that must
 * never fail the start it follows — but that is a UX decision about error
 * surfacing and grants this route no exemption: it is a public endpoint reachable
 * by any authenticated caller, so the server-side mutation-guard registry runs
 * unconditionally.
 */
export async function PUT(req: Request) {
  try {
    const { container, auth, translate, em, staffMember, scope } = await resolveRequestContext(req)

    const interceptors = await runTimesheetInterceptors({
      request: req,
      method: 'PUT',
      scope: { container, userId: auth.sub, tenantId: scope.tenantId, organizationId: scope.organizationId },
      body: await readJsonSafe<Record<string, unknown>>(req, {}),
    })
    if (!interceptors.ok) return interceptors.response
    const { session } = interceptors

    const parsed = staffTimesheetPreferenceUpdateSchema.safeParse(session.body)
    if (!parsed.success) {
      throw new CrudHttpError(400, {
        error: translate('staff.timesheets.errors.invalidBody', 'Invalid request body.'),
        details: parsed.error.flatten(),
      })
    }

    const current = await loadTimesheetPreference(em, scope, staffMember.id)

    // Honours the header when a caller sends one; the timer-start path sends none
    // and is last-write-wins by design (§ Optimistic Locking).
    //
    // This is check-then-act, not compare-and-swap: the upsert below issues an
    // unconditional DO UPDATE, so two writers that both pass this check both
    // write and the later one wins. Adequate here — the contested value is one
    // UUID naming a UI default, both writers are necessarily the same
    // authenticated member, and the losing outcome is identical to the
    // documented last-write-wins default. Folding `AND updated_at = ?` into the
    // upsert would be the stronger guarantee if this ever backs a real form.
    await enforceCommandOptimisticLockWithGuards(container, {
      resourceKind: RESOURCE_KIND,
      resourceId: staffMember.id,
      request: req,
      current: current.updatedAt,
    })

    const guardResult = await runStaffMutationGuards(
      container,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: auth.sub ?? '',
        resourceKind: RESOURCE_KIND,
        resourceId: staffMember.id,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        mutationPayload: parsed.data as unknown as Record<string, unknown>,
      },
    )
    if (!guardResult.ok) {
      return NextResponse.json(
        guardResult.errorBody ?? { error: 'Operation blocked by guard' },
        { status: guardResult.errorStatus ?? 422 },
      )
    }

    // A guard may rewrite the payload; persist what it returned, not what arrived.
    const effective = { ...parsed.data, ...(guardResult.modifiedPayload ?? {}) }
    const nextProjectId = effective.lastProjectId ?? null
    if (nextProjectId != null && !z.string().uuid().safeParse(nextProjectId).success) {
      throw new CrudHttpError(400, {
        error: translate('staff.timesheets.errors.invalidProjectId', 'Invalid project id.'),
      })
    }

    // Stops a buggy or hostile client parking an arbitrary project in the row.
    if (nextProjectId) {
      const assigned = await isProjectAssignedToMember(em, scope, staffMember.id, nextProjectId)
      if (!assigned) {
        throw new CrudHttpError(400, {
          error: translate('staff.timesheets.errors.notAssigned', 'You are not assigned to this project.'),
        })
      }
    }

    const saved = await saveTimesheetPreference(em, scope, staffMember.id, nextProjectId)

    if (guardResult.afterSuccessCallbacks.length) {
      // The row is already committed. A throwing callback must not undo that, and
      // `runStaffMutationGuardAfterSuccess` does not catch on its own.
      try {
        await runStaffMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          userId: auth.sub ?? '',
          resourceKind: RESOURCE_KIND,
          resourceId: staffMember.id,
          operation: 'update',
          requestMethod: req.method,
          requestHeaders: req.headers,
        })
      } catch (callbackErr) {
        logger.error('staff.timesheets.my-preferences.afterSuccess failed', { err: callbackErr })
      }
    }

    return session.respond(200, saved)
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('staff.timesheets.my-preferences.put failed', { err })
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('staff.timesheets.errors.savePreference', 'Failed to save timesheet preference.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'My timesheet preferences',
  methods: {
    GET: {
      summary: "Read the caller's own timesheet preferences",
      description:
        'Self-scoped: there is no member parameter, so one member cannot read another\'s default. Returns `lastProjectId: null` when no row exists, and also when the stored project is no longer an active assignment for the caller in this organization.',
      responses: [
        { status: 200, description: 'Current preference', schema: preferenceResponseSchema },
        { status: 400, description: 'Missing scope', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'No staff member linked', schema: z.object({ error: z.string() }) },
      ],
    },
    PUT: {
      summary: "Set the caller's last-used time project",
      description:
        'Written automatically after a successful timer start. Atomically upserts the single row for (organization, tenant, member). Rejects a project the caller is not actively assigned to. When `x-om-ext-optimistic-lock-expected-updated-at` is supplied it is validated against the version read at the start of this request and rejected with 409 on mismatch; it is NOT a compare-and-swap, so two writers that both pass the check will both write and the later one wins. Callers that omit the header — including the timer-start path, which is the only production caller — are last-write-wins by design.',
      requestBody: {
        contentType: 'application/json',
        schema: staffTimesheetPreferenceUpdateSchema,
      },
      responses: [
        { status: 200, description: 'Preference saved', schema: preferenceResponseSchema },
        { status: 400, description: 'Invalid input or project not assigned', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'No staff member linked', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Optimistic lock conflict', schema: z.object({ error: z.string() }) },
        { status: 422, description: 'Blocked by a mutation guard', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
