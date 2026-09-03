/**
 * Shared access filtering for the two tag-assignment endpoints (T3.4).
 *
 * Tagging a task or a time entry is a write on a project-scoped row, so it goes
 * through the same resolver every other project-scoped read and write uses: a
 * caller without `staff.timesheets.projects.manage` only reaches the projects
 * they are an active member of. Skipping the resolver here would let anyone with
 * `tasks.manage` tag a task on a project they cannot even see — that is the R3
 * defect class, and it is why the target lookup below is never done without it.
 *
 * The refusal is a flat 404 with a generic message. "Not yours" and "does not
 * exist" are deliberately indistinguishable, so the endpoint cannot be used to
 * probe which task or entry ids exist.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { StaffTimeEntry, StaffTimeTask } from '../../../data/entities'
import { MANAGE_PROJECTS_FEATURE, resolveProjectAccess, type ProjectAccess } from '../../../lib/time-tracking/access'
import { resolveFeatureAccess } from '../../../lib/time-tracking/featureAccess'
import { readTimeTrackingSettings } from '../../../lib/time-tracking/settings'

const logger = createLogger('staff').child({ component: 'api/timesheets/tags' })

const DENIED_ACCESS: ProjectAccess = { canManageAll: false, projectIds: [], staffMemberId: null }

export type ContainerLike = { resolve: (name: string) => unknown }

export type TagAssignmentScope = {
  tenantId: string
  organizationId: string
  userId: string
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

export async function loadTagProjectAccess(
  container: ContainerLike,
  scope: TagAssignmentScope,
): Promise<ProjectAccess> {
  try {
    // One lookup, one authority, one failure direction. The hand-rolled grant read
    // this replaces could not tell "denied" from "could not ask", so an RBAC hiccup
    // silently demoted a manager to their own memberships.
    const access = await resolveFeatureAccess(container, scope.userId, [MANAGE_PROJECTS_FEATURE], {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const em = container.resolve('em') as EntityManager
    return await resolveProjectAccess({
      em: em.fork(),
      userId: scope.userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      canManageAll: access.allowed,
      userFeatures: access.grantedFeatures,
      assignmentGraceDays: await resolveAssignmentGraceDays(container, scope.tenantId),
    })
  } catch (err) {
    logger.error('staff.timesheets.tags access resolution failed', { err })
    return { ...DENIED_ACCESS }
  }
}

function targetNotFound(translate: (key: string, fallback: string) => string, target: 'task' | 'time_entry'): CrudHttpError {
  const message =
    target === 'task'
      ? translate('staff.time_tracking.tags.errors.taskNotFound', 'Task not found or not accessible.')
      : translate('staff.time_tracking.tags.errors.entryNotFound', 'Time entry not found or not accessible.')
  return new CrudHttpError(404, { error: message })
}

/**
 * Loads the task inside the caller's tenant/organization AND inside the projects
 * the resolver grants them. Both misses answer the same 404.
 */
export async function requireAccessibleTask(
  em: EntityManager,
  taskId: string,
  scope: TagAssignmentScope,
  access: ProjectAccess,
  translate: (key: string, fallback: string) => string,
): Promise<{ id: string; timeProjectId: string }> {
  const task = await em.findOne(StaffTimeTask, {
    id: taskId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!task) throw targetNotFound(translate, 'task')
  if (!access.canManageAll && !access.projectIds.includes(task.timeProjectId)) {
    throw targetNotFound(translate, 'task')
  }
  return { id: task.id, timeProjectId: task.timeProjectId }
}

/**
 * Same rule for a time entry, with one extra branch: an entry that carries no
 * project is personal time, reachable only by the member who logged it (or by a
 * manager).
 */
export async function requireAccessibleTimeEntry(
  em: EntityManager,
  timeEntryId: string,
  scope: TagAssignmentScope,
  access: ProjectAccess,
  translate: (key: string, fallback: string) => string,
): Promise<{ id: string; timeProjectId: string | null }> {
  const entry = await em.findOne(StaffTimeEntry, {
    id: timeEntryId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!entry) throw targetNotFound(translate, 'time_entry')
  if (!access.canManageAll) {
    const projectId = entry.timeProjectId ?? null
    const reachable = projectId
      ? access.projectIds.includes(projectId)
      : access.staffMemberId != null && entry.staffMemberId === access.staffMemberId
    if (!reachable) throw targetNotFound(translate, 'time_entry')
  }
  return { id: entry.id, timeProjectId: entry.timeProjectId ?? null }
}
