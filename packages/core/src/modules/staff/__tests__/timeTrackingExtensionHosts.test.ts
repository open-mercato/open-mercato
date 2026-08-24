import path from 'node:path'
import fs from 'node:fs'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  crudFormExtensionSpotId,
  dataTableExtensionSpotId,
} from '@open-mercato/shared/modules/widgets/extension-points'
import { extensionPoints } from '../extension-points'

const MODULE_ROOT = path.join(__dirname, '..')

type HostRecord = Record<string, { source: string } & Record<string, unknown>>

const hosts = extensionPoints.hosts as unknown as HostRecord

/**
 * The ids below are the module's public extension surface. Renaming one silently
 * unbinds every third-party widget aimed at it, so the list is spelled out here
 * rather than derived from the declaration it is meant to guard.
 */
const EXPECTED_TABLE_IDS = [
  'staff.time_entries.list',
  'staff.time_projects.list',
  'staff.time_reports.list',
]

const EXPECTED_CRUD_FORM_SPOT_IDS = [
  'crud-form:staff.staff_time_entry',
  'crud-form:staff.staff_time_project',
  'crud-form:staff.staff_time_report',
  'crud-form:staff.staff_time_task',
]

const EXPECTED_INJECTION_SPOT_IDS = [
  'detail:staff:staff_time_project:footer',
  'detail:staff:staff_time_project:header',
  'detail:staff:staff_time_project:sidebar',
  'detail:staff:staff_time_project:status-badges',
  'detail:staff:staff_time_project:tabs',
  'detail:staff:staff_time_report:footer',
  'detail:staff:staff_time_report:header',
  'detail:staff:staff_time_report:status-badges',
  'detail:staff:staff_time_task:footer',
  'detail:staff:staff_time_task:header',
  'detail:staff:staff_time_task:sidebar',
  'detail:staff:staff_time_task:status-badges',
  'detail:staff:staff_time_task:tabs',
  'staff.my_work:after-sections',
  'staff.my_work:before-sections',
  'staff.time_report.sheet:after-totals',
  'staff.time_report.sheet:before-lines',
  'staff.time_task.board:card-badges',
  'staff.time_task.board:card-footer',
  'staff.time_task.board:column-header',
  'staff.time_task.board:toolbar',
  'staff.time_tracking.settings:sections',
  'staff.timesheet:day-cell-actions',
  'staff.timesheet:period-footer',
  'staff.timesheet:toolbar',
  'staff.timesheets.timer-bar:actions',
]

/**
 * EP-32…EP-41. Each id is the registry's own identifier, reused as the catalog
 * host id, and each registry module reads it back off this declaration so the
 * two cannot drift.
 */
const EXPECTED_REGISTRY_IDS = [
  'staff.time_tracking.billability',
  'staff.time_tracking.capacity_provider',
  'staff.time_tracking.overlap_policy',
  'staff.time_tracking.project_code_generator',
  'staff.time_tracking.rate',
  'staff.time_tracking.report_approval_policy',
  'staff.time_tracking.report_export_format',
  'staff.time_tracking.report_grouping',
  'staff.time_tracking.rounding',
  'staff.time_tracking.setting_key',
  'staff.time_tracking.time_entry_source',
]

const EXPECTED_COMPONENT_IDS = [
  'staff.entries_summary_footer',
  'staff.kanban_card',
  'staff.kanban_column',
  'staff.project_card',
  'staff.report_sheet',
  'staff.time_entry_dialog',
  'staff.timer_bar',
  'staff.timesheet_calendar',
  'staff.timesheet_grid',
  'staff.timesheet_list',
]

function idsOfFamily(family: string, key: string): string[] {
  return Object.values(hosts)
    .filter((host) => host.family === family)
    .map((host) => String(host[key]))
    .sort()
}

describe('staff time-tracking extension host catalog', () => {
  it('declares the module id', () => {
    expect(extensionPoints.moduleId).toBe('staff')
  })

  it('publishes exactly the three time-tracking data-table hosts', () => {
    expect(idsOfFamily('data-table', 'tableId')).toEqual([...EXPECTED_TABLE_IDS].sort())
  })

  it('publishes exactly the four time-tracking crud-form hosts', () => {
    expect(idsOfFamily('crud-form', 'spotId')).toEqual([...EXPECTED_CRUD_FORM_SPOT_IDS].sort())
  })

  it('publishes exactly the declared injection spots', () => {
    const declared = Object.values(hosts)
      .filter((host) => host.family === 'detail' || host.family === 'generic')
      .map((host) => String(host.spotId))
      .sort()
    expect(declared).toEqual([...EXPECTED_INJECTION_SPOT_IDS].sort())
  })

  it('publishes exactly the declared strategy registries', () => {
    expect(idsOfFamily('specialized-registry', 'spotId')).toEqual([...EXPECTED_REGISTRY_IDS].sort())
  })

  it('names each registry built-in as the host runtime contract', () => {
    const runtimeContracts = Object.values(hosts)
      .filter((host) => host.family === 'specialized-registry')
      .map((host) => String(host.runtimeContract))
    expect(runtimeContracts.filter(Boolean)).toHaveLength(EXPECTED_REGISTRY_IDS.length)
  })

  it('publishes exactly the ten replaceable component handles', () => {
    expect(idsOfFamily('component-handle', 'componentId')).toEqual([...EXPECTED_COMPONENT_IDS].sort())
  })

  it('gives every host a distinct id', () => {
    const ids = Object.values(hosts).map((host) => String(host.spotId ?? host.tableId ?? host.componentId))
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * `CrudForm` derives its own spot id from `entityIds` by replacing every colon
   * with a dot, so a host declared with the colon form (`staff:staff_time_entry`)
   * would name a spot the form never loads widgets for. This pins the two together.
   */
  it('matches the crud-form spot ids CrudForm derives from the entity ids', () => {
    const derive = (entityId: string) => crudFormExtensionSpotId(entityId.replace(/[:]+/g, '.'))
    expect(hosts.projectForm.spotId).toBe(derive(E.staff.staff_time_project))
    expect(hosts.timeEntryForm.spotId).toBe(derive(E.staff.staff_time_entry))
    expect(hosts.taskForm.spotId).toBe(derive(E.staff.staff_time_task))
    expect(hosts.reportForm.spotId).toBe(derive(E.staff.staff_time_report))
  })

  it('derives the nine data-table child spots from each table id', () => {
    for (const tableId of EXPECTED_TABLE_IDS) {
      expect([
        'columns',
        'row-actions',
        'bulk-actions',
        'filters',
        'toolbar',
        'search-trailing',
        'header',
        'footer',
        'empty-state',
      ].map((suffix) => dataTableExtensionSpotId(tableId, suffix))).toEqual([
        `data-table:${tableId}:columns`,
        `data-table:${tableId}:row-actions`,
        `data-table:${tableId}:bulk-actions`,
        `data-table:${tableId}:filters`,
        `data-table:${tableId}:toolbar`,
        `data-table:${tableId}:search-trailing`,
        `data-table:${tableId}:header`,
        `data-table:${tableId}:footer`,
        `data-table:${tableId}:empty-state`,
      ])
    }
  })

  it('points every declaration at a source file that exists', () => {
    for (const [key, host] of Object.entries(hosts)) {
      const sourcePath = path.join(MODULE_ROOT, host.source)
      expect({ key, exists: fs.existsSync(sourcePath) }).toEqual({ key, exists: true })
    }
  })

  /**
   * `module-extension-facts` marks a declaration `bound` only when the file named
   * by `source` references `extensionPoints.hosts.<key>`; an unreferenced host is
   * emitted as an `unbound-declaration` diagnostic instead of a usable host.
   */
  it('binds every declaration from its own source file', () => {
    for (const [key, host] of Object.entries(hosts)) {
      const source = fs.readFileSync(path.join(MODULE_ROOT, host.source), 'utf8')
      expect({ key, bound: source.includes(`extensionPoints.hosts.${key}`) }).toEqual({ key, bound: true })
    }
  })
})
