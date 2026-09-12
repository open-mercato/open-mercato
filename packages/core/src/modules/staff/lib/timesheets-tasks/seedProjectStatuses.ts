import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTimeTaskStatus } from '../../data/entities'
import { buildDefaultTaskStatusRows, type TaskStatusLabelTranslate } from './defaultStatusTemplate'

export type SeedProjectTaskStatusesScope = {
  tenantId: string
  organizationId: string
  timeProjectId: string
}

/**
 * Materialises the default template onto a freshly created project.
 *
 * Persist-only, deliberately: it issues no query and never flushes, so the caller
 * can run it as a mutation phase of the same transaction that inserted the
 * project. That is the whole point — a project that exists without columns is a
 * board nothing can be filed on, and there is no UI that repairs one.
 */
export function seedProjectTaskStatuses(
  em: EntityManager,
  scope: SeedProjectTaskStatusesScope,
  translate: TaskStatusLabelTranslate,
): StaffTimeTaskStatus[] {
  const now = new Date()
  return buildDefaultTaskStatusRows(translate).map((row) => {
    const status = em.create(StaffTimeTaskStatus, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      timeProjectId: scope.timeProjectId,
      name: row.name,
      slug: row.slug,
      color: row.color,
      position: row.position,
      isDefault: row.isDefault,
      isDone: row.isDone,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(status)
    return status
  })
}
