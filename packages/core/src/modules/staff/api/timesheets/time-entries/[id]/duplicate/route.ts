/**
 * US-D6 — "repeat yesterday", for one entry.
 *
 * The row action on screen 10 and the per-row copy button on screen 1 both land
 * here. The route is deliberately thin: T4.2 already put the whole copy in the
 * `staff.timesheets.time_entries.duplicate` command, which resolves the SOURCE,
 * runs it past the lock gate and then delegates the write to the create command
 * so the copy inherits ownership enforcement, project access, the billable and
 * currency defaults, rounding (D-7), tag syncing and the audit entry unchanged.
 * Nothing here re-implements any of that.
 *
 * Two things the route owns that the command cannot:
 *
 *  1. **Existence is decided by the caller's project access, not by the row.** The
 *     source is looked up through the same intersection the list route applies —
 *     entries on projects the caller belongs to, plus their own project-less
 *     entries — and anything outside it answers `404`, never `403`. A `403` on a
 *     project the caller cannot see would confirm the entry exists and name the
 *     project it belongs to.
 *  2. **`date` and `durationMinutes` overrides.** US-D6 ends with "I adjust the
 *     duration and the date", so both travel with the copy request instead of
 *     costing a follow-up PUT that would briefly show the wrong duration.
 *
 * `tagIds` is passed in by the caller rather than read off the junction: the
 * command writes tags only through the tag commands and never touches
 * `staff_time_entry_tags`, and the client already holds the source's `tags[]`
 * from the list response.
 */

import { NextResponse } from 'next/server'
import { resolveFeatureAccess } from '../../../../../lib/time-tracking/featureAccess'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitStaffEvent } from '../../../../../events'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { StaffTimeEntry } from '../../../../../data/entities'
import { staffTimeEntryCommandIds } from '../../../../../commands/timesheets-entries'
import { resolveProjectAccess, type ProjectAccess } from '../../../../../lib/time-tracking/access'
import { readTimeTrackingSettings } from '../../../../../lib/time-tracking/settings'
import { STAFF_TIME_TRACKING_RESOURCE_KINDS } from '../../../../guards'

const logger = createLogger('staff').child({ component: 'api/timesheets/time-entries/duplicate' })

const MANAGE_OWN_FEATURE = 'staff.timesheets.manage_own'
const RESOURCE_KIND = STAFF_TIME_TRACKING_RESOURCE_KINDS.timeEntry

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [MANAGE_OWN_FEATURE] },
}

const duplicateRequestSchema = z.object({
  date: z.coerce.date().optional(),
  durationMinutes: z.number().int().min(0).max(1440).optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
})

const duplicateResponseSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
})

const lockedConflictSchema = z.object({
  code: z.literal('time_entry_locked'),
  error: z.string(),
  lockedReportId: z.string().uuid().nullable(),
  lockedEntryIds: z.array(z.string().uuid()),
  lockedReportIds: z.array(z.string().uuid()),
})

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    options: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

type ContainerLike = { resolve: (name: string) => unknown }

function extractEntryIdFromUrl(request?: Request): string | null {
  if (!request?.url) return null
  try {
    const url = new URL(request.url)
    const match = url.pathname.match(/\/time-entries\/([^/]+)\/duplicate/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * Granted features power both the explicit feature check and the feature gating
 * inside the mutation-guard registry. Returns null when RBAC cannot be consulted,
 * in which case the declarative `requireFeatures` guard in `metadata` remains the
 * authorization source.
 */
async function resolveGrantedFeatures(
  container: ContainerLike,
  userId: string,
  tenantId: string,
  organizationId: string | null,
): Promise<string[] | null> {
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return null
    return await rbac.getGrantedFeatures(userId, { tenantId, organizationId })
  } catch {
    return null
  }
}

async function resolveAssignmentGraceDays(container: ContainerLike, tenantId: string): Promise<number | null> {
  try {
    const configService = container.resolve('moduleConfigService') as ModuleConfigService
    const settings = await readTimeTrackingSettings(configService, { tenantId })
    return settings.access.assignmentGraceDays
  } catch {
    // Fail safe to the documented default rather than widening the window.
    return null
  }
}

async function loadProjectAccess(
  container: ContainerLike,
  userId: string | null,
  tenantId: string,
  organizationId: string,
  grantedFeatures: readonly string[],
): Promise<ProjectAccess> {
  const em = container.resolve('em') as EntityManager
  return resolveProjectAccess({
    em: em.fork(),
    userId,
    tenantId,
    organizationId,
    userFeatures: grantedFeatures,
    assignmentGraceDays: await resolveAssignmentGraceDays(container, tenantId),
  })
}

/**
 * The per-row form of the list route's `$or` intersection: an entry on a project
 * is visible to the members of that project, and a project-less entry is visible
 * only to the member who logged it.
 */
function isTimeEntryVisible(
  entry: { staffMemberId: string; timeProjectId?: string | null },
  access: ProjectAccess,
): boolean {
  if (access.canManageAll) return true
  const projectId = entry.timeProjectId ?? null
  if (projectId) return access.projectIds.includes(projectId)
  return access.staffMemberId !== null && access.staffMemberId === entry.staffMemberId
}

export async function POST(req: Request) {
  try {
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

    const timeEntryId = extractEntryIdFromUrl(req)
    if (!timeEntryId) {
      throw new CrudHttpError(400, {
        error: translate('staff.timesheets.errors.missingEntryId', 'Missing entry ID.'),
      })
    }

    const actorId = auth.sub ?? ''
    const grantedFeatures = await resolveGrantedFeatures(container, actorId, tenantId, organizationId)
    // Checked unconditionally. The `grantedFeatures &&` this replaces turned the
    // check off whenever the grant read failed — harmless here only because the
    // route metadata happens to require the same feature, which is exactly the
    // shape that leaked rates on the report routes where no such backstop existed.
    if (!(await resolveFeatureAccess(container, actorId, [MANAGE_OWN_FEATURE], { tenantId, organizationId })).allowed) {
      throw forbidden(translate('staff.errors.forbidden', 'Forbidden'))
    }

    const parsed = duplicateRequestSchema.parse(await readJsonSafe(req, {}))

    // The source is resolved here, before the command, purely so an entry the
    // caller cannot see answers 404 instead of the command's 403 — which would
    // confirm the entry exists and name the project that hides it.
    const em = (container.resolve('em') as EntityManager).fork()
    const source = await findOneWithDecryption(
      em,
      StaffTimeEntry,
      { id: timeEntryId, tenantId, organizationId, deletedAt: null },
      {},
      { tenantId, organizationId },
    )
    const access = await loadProjectAccess(container, actorId || null, tenantId, organizationId, grantedFeatures ?? [])
    if (!source || !isTimeEntryVisible(source, access)) {
      throw new CrudHttpError(404, {
        error: translate('staff.timesheets.errors.entryNotFound', 'Time entry not found, deleted, or not owned by you.'),
      })
    }

    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: {
        userId: actorId,
        tenantId,
        organizationId,
        userFeatures: grantedFeatures ?? undefined,
      },
      input: {
        resourceKind: RESOURCE_KIND,
        resourceId: timeEntryId,
        operation: 'create',
        mutationPayload: parsed,
      },
    })
    if (!guardResult.ok) return guardResult.response

    const effective = guardResult.modifiedPayload
      ? duplicateRequestSchema.parse({ ...parsed, ...guardResult.modifiedPayload })
      : parsed

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<unknown, { timeEntryId: string }>(
      staffTimeEntryCommandIds.duplicate,
      { input: { ...effective, id: timeEntryId }, ctx },
    )

    await guardResult.runAfterSuccess()

    if (result?.timeEntryId) {
      void emitStaffEvent('staff.timesheets.time_entry.copied', {
        id: result.timeEntryId,
        sourceId: timeEntryId,
        tenantId,
        organizationId,
      }, { persistent: true }).catch((err) => {
        logger.error('staff.timesheets emit time_entry.copied failed', { err })
      })
    }

    return NextResponse.json({ id: result?.timeEntryId ?? null, sourceId: timeEntryId }, { status: 201 })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('staff.errors.invalid_request', 'Invalid request'), details: err.issues },
        { status: 400 },
      )
    }
    logger.error('staff.timesheets.time-entries.duplicate failed', { err })
    return NextResponse.json(
      { error: translate('staff.errors.internal', 'Internal server error') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Duplicate a time entry',
  methods: {
    POST: {
      summary: 'Duplicate a time entry',
      description:
        'US-D6. Copies an existing time entry, carrying its task, project, description, billable flag and rate override across. `date` and `durationMinutes` override the copy without a second request; `tagIds` sets the copy tag set (the caller passes the source tags it already holds from the list response). The copy is written through the create command, so ownership, project access, the billable and currency defaults, and the tenant rounding rule apply to it exactly as they do to a hand-made entry. A source locked into a closed report is refused with 409 `time_entry_locked`; a source the caller cannot see answers 404.',
      requestBody: {
        contentType: 'application/json',
        schema: duplicateRequestSchema,
      },
      responses: [
        { status: 201, description: 'Copy created', schema: duplicateResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid body or missing scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.manage_own' },
        { status: 404, description: 'Time entry not found, deleted, or outside the caller project access' },
        {
          status: 409,
          description: 'The source entry is locked into a closed report; nothing was copied',
          schema: lockedConflictSchema,
        },
      ],
    },
  },
}
