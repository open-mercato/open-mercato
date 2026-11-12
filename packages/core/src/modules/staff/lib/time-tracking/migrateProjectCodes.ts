/**
 * Rewrites existing project codes to the short form and re-derives every task
 * reference to match.
 *
 * `staff_time_tasks.reference` is denormalised (`<project code>-<sequence>`) and
 * frozen at creation, because it is quoted where the task row is no longer
 * joined. That freeze is what makes this a migration rather than a settings
 * change: shortening a project's code does not retro-number its tasks, so
 * without this the tenant ends up with `EHK` projects whose tasks still say
 * `ERGO-HESTIA-KORPO-4`.
 *
 * What this deliberately preserves:
 *
 *  * **Sequence numbers.** `APOLLO-14` becomes `APO-14`, never `APO-1`. The
 *    number is the task's identity to the people who use it; only the prefix
 *    changes.
 *  * **Hand-picked codes.** A code that is already at or under the target length
 *    was chosen, not derived, so it is left exactly as it is.
 *
 * What it cannot preserve: a reference somebody wrote down outside the system.
 * Reports do not quote task references — report lines are labelled by task title
 * and `staff_time_report_entries` freezes minutes and money, never the reference
 * — so nothing already exported changes meaning. Anything a person memorised
 * does.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTimeProject, StaffTimeTask } from '../../data/entities'
import { PROJECT_CODE_TARGET_LENGTH, deriveProjectCodeBase } from './projectCode'
import { formatTaskReference } from '../timesheets-tasks/taskReference'

export type MigrateProjectCodesScope = { tenantId: string; organizationId: string }

export type ProjectCodeChange = {
  projectId: string
  projectName: string
  fromCode: string
  toCode: string
  taskCount: number
}

export type MigrateProjectCodesResult = {
  changes: ProjectCodeChange[]
  /** Projects left alone because their code was already short. */
  skipped: number
  tasksRenumbered: number
}

/**
 * Plans the rename without writing anything. Exported so the CLI can offer a dry
 * run: a rewrite of every code in a tenant is not something to discover the
 * shape of by executing it.
 */
export function planProjectCodeMigration(
  projects: readonly Pick<StaffTimeProject, 'id' | 'name' | 'code'>[],
  taskCountByProjectId: ReadonlyMap<string, number>,
): { changes: ProjectCodeChange[]; skipped: number } {
  // Codes that survive untouched are reserved first, so a project keeping `HBH`
  // cannot have it taken from under it by a project being shortened to `HBH`.
  const taken = new Set<string>()
  const shortening: typeof projects[number][] = []
  let skipped = 0

  for (const project of projects) {
    const code = (project.code ?? '').trim()
    if (code.length > 0 && code.length <= PROJECT_CODE_TARGET_LENGTH) {
      taken.add(code.toUpperCase())
      skipped += 1
      continue
    }
    shortening.push(project)
  }

  // Oldest first, so a re-run is stable and the same project keeps the same code
  // rather than the order of a query deciding who gets the unsuffixed one.
  const ordered = [...shortening].sort((left, right) => left.id.localeCompare(right.id))

  const changes: ProjectCodeChange[] = []
  for (const project of ordered) {
    const base = deriveProjectCodeBase(project.name ?? '')
    let candidate = base
    for (let counter = 2; taken.has(candidate.toUpperCase()); counter += 1) {
      candidate = `${base}${counter}`
    }
    taken.add(candidate.toUpperCase())
    changes.push({
      projectId: project.id,
      projectName: project.name ?? '',
      fromCode: project.code ?? '',
      toCode: candidate,
      taskCount: taskCountByProjectId.get(project.id) ?? 0,
    })
  }

  return { changes, skipped }
}

export async function migrateProjectCodes(
  em: EntityManager,
  scope: MigrateProjectCodesScope,
  options: { dryRun?: boolean } = {},
): Promise<MigrateProjectCodesResult> {
  const projects = await em.find(StaffTimeProject, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })

  const tasks = await em.find(StaffTimeTask, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })

  const tasksByProjectId = new Map<string, StaffTimeTask[]>()
  for (const task of tasks) {
    const bucket = tasksByProjectId.get(task.timeProjectId) ?? []
    bucket.push(task)
    tasksByProjectId.set(task.timeProjectId, bucket)
  }
  const counts = new Map([...tasksByProjectId].map(([id, list]) => [id, list.length]))

  const { changes, skipped } = planProjectCodeMigration(projects, counts)
  if (options.dryRun) {
    return {
      changes,
      skipped,
      tasksRenumbered: changes.reduce((total, change) => total + change.taskCount, 0),
    }
  }

  const projectById = new Map(projects.map((project) => [project.id, project]))
  const now = new Date()
  let tasksRenumbered = 0

  // One transaction: a half-applied rename leaves tasks quoting a prefix their
  // project no longer carries, which is the exact inconsistency this exists to
  // remove.
  await em.transactional(async (tem) => {
    for (const change of changes) {
      const project = projectById.get(change.projectId)
      if (!project) continue
      const managed = tem.getReference(StaffTimeProject, project.id)
      managed.code = change.toCode
      managed.updatedAt = now
      tem.persist(managed)

      for (const task of tasksByProjectId.get(change.projectId) ?? []) {
        const managedTask = tem.getReference(StaffTimeTask, task.id)
        // The sequence number is the task's identity to the people who use it;
        // only the prefix moves.
        managedTask.reference = formatTaskReference(change.toCode, task.sequenceNumber)
        managedTask.updatedAt = now
        tem.persist(managedTask)
        tasksRenumbered += 1
      }
    }
  })

  return { changes, skipped, tasksRenumbered }
}
