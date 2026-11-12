/**
 * What a timesheet line logs against — a project, or a project **and** a task.
 *
 * The spec's second grid upgrade ("rows can be project or project + task, so
 * grid entries carry `taskId` like every other entry") and screen 12's quick-add
 * row are the same question asked twice, so they share one model. A target is
 * addressed by a single opaque key, because the grid's dirty map, its row list
 * and the list view's `<select>` all need one string that identifies a line
 * without pretending a project row and a task row are different kinds of thing.
 */

export type TimesheetLogTarget = {
  /** `<projectId>` for a project row, `<projectId>:<taskId>` for a task row. */
  key: string
  timeProjectId: string
  taskId: string | null
  projectName: string
  projectCode: string | null
  projectColor: string | null
  taskTitle: string | null
}

export type TimesheetProjectRef = {
  id: string
  name: string
  code: string | null
  color: string | null
}

export type TimesheetTaskRef = {
  id: string
  title: string
  timeProjectId: string
}

export function buildTargetKey(timeProjectId: string, taskId: string | null | undefined): string {
  return taskId ? `${timeProjectId}:${taskId}` : timeProjectId
}

export function parseTargetKey(key: string): { timeProjectId: string; taskId: string | null } {
  const separator = key.indexOf(':')
  if (separator < 0) return { timeProjectId: key, taskId: null }
  return { timeProjectId: key.slice(0, separator), taskId: key.slice(separator + 1) || null }
}

export function projectTarget(project: TimesheetProjectRef): TimesheetLogTarget {
  return {
    key: buildTargetKey(project.id, null),
    timeProjectId: project.id,
    taskId: null,
    projectName: project.name,
    projectCode: project.code,
    projectColor: project.color,
    taskTitle: null,
  }
}

export function taskTarget(project: TimesheetProjectRef, task: TimesheetTaskRef): TimesheetLogTarget {
  return {
    key: buildTargetKey(project.id, task.id),
    timeProjectId: project.id,
    taskId: task.id,
    projectName: project.name,
    projectCode: project.code,
    projectColor: project.color,
    taskTitle: task.title,
  }
}

/**
 * Every loggable line for a set of projects: the project itself, then its tasks.
 * Tasks of a project the caller cannot see are dropped rather than rendered
 * without a project name — a row whose project is unknown cannot be saved.
 */
export function buildLogTargets(
  projects: readonly TimesheetProjectRef[],
  tasks: readonly TimesheetTaskRef[],
): TimesheetLogTarget[] {
  const targets: TimesheetLogTarget[] = []
  for (const project of projects) {
    targets.push(projectTarget(project))
    for (const task of tasks) {
      if (task.timeProjectId !== project.id) continue
      targets.push(taskTarget(project, task))
    }
  }
  return targets
}

/** `Nordvik — migracja B2B · Mapowanie cen` — one line for a picker or a row header. */
export function targetLabel(target: TimesheetLogTarget): string {
  return target.taskTitle ? `${target.projectName} · ${target.taskTitle}` : target.projectName
}
