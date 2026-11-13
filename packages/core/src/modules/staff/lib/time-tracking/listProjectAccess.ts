import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { resolveFeatureAccess } from './featureAccess'
import { MANAGE_PROJECTS_FEATURE, resolveProjectAccess, type ProjectAccess } from './access'
import { readTimeTrackingSettings } from './settings'

const logger = createLogger('staff').child({ component: 'lib/time-tracking/listProjectAccess' })

const DENIED_ACCESS: ProjectAccess = { canManageAll: false, projectIds: [], staffMemberId: null }

type ContainerLike = { resolve: (name: string) => unknown }

type ListAccessCtx = Pick<CrudCtx, 'container' | 'auth' | 'selectedOrganizationId' | 'request'>

/** One access decision per request, shared by every filter that needs it. */
const accessByRequest = new WeakMap<Request, Promise<ProjectAccess>>()

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
  tenantId: string | null,
  organizationId: string | null,
): Promise<ProjectAccess> {
  if (!tenantId || !organizationId) return { ...DENIED_ACCESS }
  const scope = { tenantId, organizationId }
  try {
    // One lookup, one authority, and a failure that says so. The previous
    // `catch → []` could not tell "denied" from "could not ask", so an RBAC
    // hiccup silently demoted a manager to their own memberships.
    const access = await resolveFeatureAccess(container, userId, [MANAGE_PROJECTS_FEATURE], scope)
    const em = container.resolve('em') as EntityManager
    return await resolveProjectAccess({
      em: em.fork(),
      userId,
      tenantId,
      organizationId,
      canManageAll: access.allowed,
      userFeatures: access.grantedFeatures,
      assignmentGraceDays: await resolveAssignmentGraceDays(container, tenantId),
    })
  } catch (err) {
    logger.error('staff.timesheets.tasks access resolution failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.task_access_resolution_failed' })
    return { ...DENIED_ACCESS }
  }
}

/**
 * The project-access decision of the tasks list, memoised per request and failing
 * closed. Shared by the tasks list route and the task action routes (status move,
 * claim, release) so a task is only ever reachable through one access rule.
 */
export async function resolveListProjectAccess(ctx: ListAccessCtx): Promise<ProjectAccess> {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const load = () => loadProjectAccess(ctx.container, ctx.auth?.sub ?? null, tenantId, organizationId)
  const request = ctx.request
  if (!request) return load()
  const cached = accessByRequest.get(request)
  if (cached) return cached
  const pending = load()
  accessByRequest.set(request, pending)
  return pending
}
