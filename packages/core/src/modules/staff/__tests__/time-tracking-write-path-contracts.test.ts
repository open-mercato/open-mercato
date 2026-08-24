import fs from 'node:fs'
import path from 'node:path'
import { STAFF_TIME_TRACKING_RESOURCE_KINDS } from '../api/guards'
import { STAFF_TIME_TASK_RESOURCE_KIND } from '../commands/timesheets-tasks'
import { STAFF_TIME_REPORT_RESOURCE_KIND } from '../commands/timesheets-reports'
import { eventsConfig } from '../events'
import {
  staffTimeEntryCrudEvents,
  staffTimeProjectCrudEvents,
  staffTimeProjectMemberCrudEvents,
  staffTimeReportCrudEvents,
  staffTimeTagCrudEvents,
  staffTimeTaskCrudEvents,
  staffTimeTaskStatusCrudEvents,
} from '../lib/crud'
import { metadata as budgetSubscriberMetadata } from '../subscribers/time-project-budget-threshold-notification'

const MODULE_ROOT = path.resolve(__dirname, '..')
const TIMESHEETS_API_ROOT = path.join(MODULE_ROOT, 'api', 'timesheets')

function readRoute(...segments: string[]): string {
  return fs.readFileSync(path.join(TIMESHEETS_API_ROOT, ...segments), 'utf8')
}

function listRouteFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      found.push(...listRouteFiles(full))
    } else if (entry.name === 'route.ts') {
      found.push(full)
    }
  }
  return found
}

/**
 * `deriveLifecycleEventIds` and `emitOrmEntityEvent` both build the id as
 * `${module}.${entity}.${action}`, so the config a route declares IS the event id.
 */
function crudEventId(config: { module: string; entity: string }, action: string): string {
  return `${config.module}.${config.entity}.${action}`
}

function matchesSubscription(pattern: string, eventId: string): boolean {
  if (pattern === eventId) return true
  if (!pattern.endsWith('.*')) return false
  return eventId.startsWith(`${pattern.slice(0, -1)}`) && !eventId.slice(pattern.length - 1).includes('.')
}

describe('time-tracking CRUD routes declare the frozen event ids', () => {
  const declaredIds = new Set(eventsConfig.events.map((event) => event.id))

  const resources = [
    { config: staffTimeEntryCrudEvents, entity: 'time_entry' },
    { config: staffTimeProjectCrudEvents, entity: 'time_project' },
    { config: staffTimeProjectMemberCrudEvents, entity: 'time_project_member' },
    { config: staffTimeTaskCrudEvents, entity: 'time_task' },
    { config: staffTimeReportCrudEvents, entity: 'time_report' },
  ] as const

  it.each(resources)('reproduces staff.timesheets.$entity.* byte for byte', ({ config, entity }) => {
    for (const action of ['created', 'updated', 'deleted'] as const) {
      const eventId = crudEventId(config, action)
      expect(eventId).toBe(`staff.timesheets.${entity}.${action}`)
      expect(declaredIds.has(eventId)).toBe(true)
    }
  })

  it.each([
    ['time-entries', 'staffTimeEntryCrudEvents'],
    ['time-projects', 'staffTimeProjectCrudEvents'],
    ['tasks', 'staffTimeTaskCrudEvents'],
    ['task-statuses', 'staffTimeTaskStatusCrudEvents'],
    ['tags', 'staffTimeTagCrudEvents'],
    ['reports', 'staffTimeReportCrudEvents'],
  ])('%s/route.ts declares events: %s', (resource, configName) => {
    expect(readRoute(resource, 'route.ts')).toContain(`events: ${configName},`)
  })

  it('time-projects/[id]/employees/route.ts declares the project-member events config', () => {
    expect(readRoute('time-projects', '[id]', 'employees', 'route.ts')).toContain(
      'events: staffTimeProjectMemberCrudEvents,',
    )
  })

  it('keeps the tag and task-status configs on the same module/entity shape', () => {
    expect(crudEventId(staffTimeTagCrudEvents, 'created')).toBe('staff.timesheets.time_tag.created')
    expect(crudEventId(staffTimeTaskStatusCrudEvents, 'created')).toBe(
      'staff.timesheets.time_task_status.created',
    )
  })
})

describe('the budget-threshold subscriber sees every time-entry write path', () => {
  it('matches the manual create/update/delete ids the commands emit', () => {
    for (const action of ['created', 'updated', 'deleted'] as const) {
      expect(matchesSubscription(budgetSubscriberMetadata.event, crudEventId(staffTimeEntryCrudEvents, action))).toBe(true)
    }
  })

  it('matches the timer transitions', () => {
    expect(matchesSubscription(budgetSubscriberMetadata.event, 'staff.timesheets.time_entry.timer_started')).toBe(true)
    expect(matchesSubscription(budgetSubscriberMetadata.event, 'staff.timesheets.time_entry.timer_stopped')).toBe(true)
  })

  it('is reached by the /bulk route, which emits the very same events config per changed row', () => {
    const source = readRoute('time-entries', 'bulk', 'route.ts')
    expect(source).toContain('events: staffTimeEntryCrudEvents,')
    expect(source).toContain("import { staffTimeEntryCrudEvents } from '../../../../lib/crud'")
  })

  it('is not reached by an unrelated entity family', () => {
    expect(matchesSubscription(budgetSubscriberMetadata.event, 'staff.timesheets.time_entry_segment.created')).toBe(false)
    expect(matchesSubscription(budgetSubscriberMetadata.event, 'staff.timesheets.time_project.updated')).toBe(false)
  })
})

describe('STAFF_TIME_TRACKING_RESOURCE_KINDS is the single source for the custom routes', () => {
  const sources = listRouteFiles(TIMESHEETS_API_ROOT).map((file) => ({
    file: path.relative(TIMESHEETS_API_ROOT, file),
    source: fs.readFileSync(file, 'utf8'),
  }))

  it('every published entry is used by at least one route', () => {
    const unused = Object.keys(STAFF_TIME_TRACKING_RESOURCE_KINDS).filter(
      (key) => !sources.some((entry) => entry.source.includes(`STAFF_TIME_TRACKING_RESOURCE_KINDS.${key}`)),
    )
    expect(unused).toEqual([])
  })

  it('no timesheets route re-types a guard resourceKind as a raw literal', () => {
    const offenders = sources
      .filter((entry) => /resourceKind: '[^']+'/.test(entry.source))
      .map((entry) => entry.file)
    expect(offenders).toEqual([])
  })

  it('agrees with the resource kinds the commands feed to the optimistic-lock guard', () => {
    expect(STAFF_TIME_TRACKING_RESOURCE_KINDS.timeTask).toBe(STAFF_TIME_TASK_RESOURCE_KIND)
    expect(STAFF_TIME_TRACKING_RESOURCE_KINDS.timeReport).toBe(STAFF_TIME_REPORT_RESOURCE_KIND)
  })
})
