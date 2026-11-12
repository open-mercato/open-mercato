/** @jest-environment node */
/**
 * Phase P6 (EP-46…EP-49) — the search, analytics and notification surfaces.
 *
 * Three of the four are declarations with no compiler behind them: a search entity
 * id, an analytics `dbColumn` and a notification type string are all just strings
 * until something reads them at runtime. These assertions pin them against the
 * migration snapshot — the authoritative record of what the migrations created —
 * and against the two rules that make the declarations safe to ship:
 *
 *  1. **The search gate can only ever be a per-entity feature check.** The search
 *     pipeline has no row-level hook, so an entity whose REST route intersects
 *     with `resolveProjectAccess` must name the feature that switches that
 *     intersection off (`staff.timesheets.projects.manage`), or search would
 *     return records the API would not.
 *  2. **Money is absent, not blanked.** No search-indexed field and no analytics
 *     dimension may name a rate, a cost or an amount: both surfaces carry one
 *     feature list per entity and neither can apply the separate
 *     `staff.timesheets.rates.view` gate to a subset of columns.
 */

import fs from 'node:fs'
import path from 'node:path'
import { MANAGE_PROJECTS_FEATURE } from '../lib/time-tracking/access'
import { analyticsConfig } from '../analytics'
import { searchConfig } from '../search'
import { notificationTypes } from '../notifications'
import { notificationHandlers } from '../notifications.handlers'
import { aiTools } from '../ai-tools'
import { aiAgents } from '../ai-agents'
import features from '../acl'

const moduleRoot = path.join(__dirname, '..')

/**
 * The money columns, enumerated rather than pattern-matched. A regex over
 * "rate|cost|amount" both over-matches (`cost_center` is an accounting label, not
 * a number of euros) and under-matches (`budget_value` is money and contains none
 * of those words), and either mistake turns this guard into noise.
 */
const MONEY_COLUMNS_BY_TABLE: Record<string, readonly string[]> = {
  staff_time_entries: ['rate_override_amount', 'rate_currency_code'],
  staff_time_projects: ['hourly_rate', 'budget_value', 'currency_code'],
  staff_time_reports: ['total_amount', 'currency_code'],
  staff_time_report_entries: ['frozen_rate_amount', 'frozen_amount', 'frozen_currency_code'],
}

const MONEY_COLUMNS = new Set(Object.values(MONEY_COLUMNS_BY_TABLE).flat())

function readSnapshotTables(): Record<string, string[]> {
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(moduleRoot, 'migrations', '.snapshot-open-mercato.json'), 'utf8'),
  ) as { tables: Array<{ name: string; columns: Record<string, unknown> }> }
  return Object.fromEntries(snapshot.tables.map((table) => [table.name, Object.keys(table.columns)]))
}

const tables = readSnapshotTables()
const declaredFeatureIds = new Set(features.map((feature) => feature.id))

describe('EP-46 — time-tracking search entities', () => {
  const timeTrackingEntities = searchConfig.entities.filter((entity) =>
    entity.entityId.startsWith('staff:staff_time_'),
  )

  it('indexes the five time-tracking entities', () => {
    expect(timeTrackingEntities.map((entity) => entity.entityId).sort()).toEqual([
      'staff:staff_time_entry',
      'staff:staff_time_project',
      'staff:staff_time_report',
      'staff:staff_time_tag',
      'staff:staff_time_task',
    ])
  })

  it('gates every entity on features the module actually declares', () => {
    for (const entity of timeTrackingEntities) {
      expect({ id: entity.entityId, gated: (entity.aclFeatures ?? []).length > 0 }).toEqual({
        id: entity.entityId,
        gated: true,
      })
      for (const feature of entity.aclFeatures ?? []) {
        expect({ id: entity.entityId, feature, declared: declaredFeatureIds.has(feature) }).toEqual({
          id: entity.entityId,
          feature,
          declared: true,
        })
      }
    }
  })

  /**
   * Entries, tasks and reports are all narrowed by project membership on their own
   * REST routes. `staff.timesheets.projects.manage` is the feature that makes
   * `resolveProjectAccess` answer `canManageAll`, which is the only state in which
   * that narrowing stops — so it is the only honest search gate for them. Tags are
   * organization-global on their route and correctly do not carry it.
   */
  it('requires unrestricted project access for the project-scoped entities', () => {
    const gates = Object.fromEntries(
      timeTrackingEntities.map((entity) => [
        entity.entityId,
        (entity.aclFeatures ?? []).includes(MANAGE_PROJECTS_FEATURE),
      ]),
    )
    expect(gates).toEqual({
      'staff:staff_time_entry': true,
      'staff:staff_time_task': true,
      'staff:staff_time_report': true,
      'staff:staff_time_project': false,
      'staff:staff_time_tag': false,
    })
  })

  it('never marks a money column searchable', () => {
    for (const entity of timeTrackingEntities) {
      for (const field of entity.fieldPolicy?.searchable ?? []) {
        expect({ id: entity.entityId, field, money: MONEY_COLUMNS.has(field) }).toEqual({
          id: entity.entityId,
          field,
          money: false,
        })
      }
    }
  })

  it('excludes the report and entry money columns outright', () => {
    const byId = Object.fromEntries(timeTrackingEntities.map((entity) => [entity.entityId, entity]))
    expect(byId['staff:staff_time_report'].fieldPolicy?.excluded).toEqual(
      expect.arrayContaining(['total_amount']),
    )
    expect(byId['staff:staff_time_entry'].fieldPolicy?.excluded).toEqual(
      expect.arrayContaining(['rate_override_amount', 'rate_currency_code']),
    )
  })

  it('names only fields that exist on the entity table', () => {
    const tableOf: Record<string, string> = {
      'staff:staff_time_entry': 'staff_time_entries',
      'staff:staff_time_project': 'staff_time_projects',
      'staff:staff_time_report': 'staff_time_reports',
      'staff:staff_time_tag': 'staff_time_tags',
      'staff:staff_time_task': 'staff_time_tasks',
    }
    for (const entity of timeTrackingEntities) {
      const columns = tables[tableOf[entity.entityId]]
      expect({ id: entity.entityId, hasTable: Array.isArray(columns) }).toEqual({
        id: entity.entityId,
        hasTable: true,
      })
      for (const field of [
        ...(entity.fieldPolicy?.searchable ?? []),
        ...(entity.fieldPolicy?.excluded ?? []),
      ]) {
        expect({ id: entity.entityId, field, exists: columns.includes(field) }).toEqual({
          id: entity.entityId,
          field,
          exists: true,
        })
      }
    }
  })
})

describe('EP-47 — time-tracking analytics entities', () => {
  it('declares the four time-tracking entity configs', () => {
    expect(analyticsConfig.entities.map((entity) => entity.entityId).sort()).toEqual([
      'staff:staff_time_entries',
      'staff:staff_time_projects',
      'staff:staff_time_reports',
      'staff:staff_time_tasks',
    ])
  })

  it('maps only columns that exist on the declared table', () => {
    for (const entity of analyticsConfig.entities) {
      const columns = tables[entity.entityConfig.tableName]
      expect({ id: entity.entityId, hasTable: Array.isArray(columns) }).toEqual({
        id: entity.entityId,
        hasTable: true,
      })
      for (const mapping of Object.values(entity.fieldMappings)) {
        expect({ id: entity.entityId, column: mapping.dbColumn, exists: columns.includes(mapping.dbColumn) }).toEqual({
          id: entity.entityId,
          column: mapping.dbColumn,
          exists: true,
        })
      }
      expect(columns).toEqual(expect.arrayContaining(entity.entityConfig.defaultScopeFields))
      expect(columns).toContain(entity.entityConfig.dateField)
    }
  })

  it('exposes no money column as a dimension', () => {
    for (const entity of analyticsConfig.entities) {
      const money = new Set(MONEY_COLUMNS_BY_TABLE[entity.entityConfig.tableName] ?? [])
      for (const [field, mapping] of Object.entries(entity.fieldMappings)) {
        expect({ id: entity.entityId, field, money: money.has(mapping.dbColumn) }).toEqual({
          id: entity.entityId,
          field,
          money: false,
        })
      }
    }
  })

  /**
   * The enumeration above is only a guard while it matches the schema. If a
   * migration renames a money column this fails here rather than silently
   * un-guarding a dimension.
   */
  it('enumerates money columns that still exist', () => {
    for (const [table, columns] of Object.entries(MONEY_COLUMNS_BY_TABLE)) {
      for (const column of columns) {
        expect({ table, column, exists: (tables[table] ?? []).includes(column) }).toEqual({
          table,
          column,
          exists: true,
        })
      }
    }
  })

  it('gates every entity on a declared staff feature', () => {
    for (const entity of analyticsConfig.entities) {
      expect(entity.requiredFeatures.length).toBeGreaterThan(0)
      for (const feature of entity.requiredFeatures) {
        expect({ id: entity.entityId, feature, declared: declaredFeatureIds.has(feature) }).toEqual({
          id: entity.entityId,
          feature,
          declared: true,
        })
      }
    }
  })

  /**
   * A `labelResolver` join is a raw table reference with no compiler behind it, and
   * the two that point at `customer_entities` cross a module boundary — a typo
   * there is a SQL error at dashboard-render time.
   */
  it('resolves labels from tables that exist', () => {
    const knownForeignTables = new Set(['customer_entities'])
    for (const entity of analyticsConfig.entities) {
      for (const resolver of Object.values(entity.labelResolvers ?? {})) {
        const local = tables[resolver.table]
        if (local) {
          expect(local).toContain(resolver.idColumn)
          expect(local).toContain(resolver.labelColumn)
        } else {
          expect(knownForeignTables.has(resolver.table)).toBe(true)
        }
      }
    }
  })
})

describe('EP-48 — time-tracking notification types and handlers', () => {
  const NEW_TYPES = [
    'staff.timesheets.time_entry.timer_running_long',
    'staff.timesheets.time_report.approved',
    'staff.timesheets.time_report.ready_for_approval',
    'staff.timesheets.timesheet.period_incomplete',
  ]

  it('declares the four new types', () => {
    const declared = notificationTypes.map((type) => type.type)
    for (const type of NEW_TYPES) expect(declared).toContain(type)
  })

  it('gives every new type a title key, a body key and a link', () => {
    for (const type of NEW_TYPES) {
      const definition = notificationTypes.find((entry) => entry.type === type)
      expect(definition).toBeDefined()
      expect(definition?.module).toBe('staff')
      expect(definition?.titleKey?.startsWith('staff.notifications.')).toBe(true)
      expect(definition?.bodyKey?.startsWith('staff.notifications.')).toBe(true)
      expect(typeof definition?.linkHref).toBe('string')
    }
  })

  /**
   * A handler whose `notificationType` names a type nobody declares is dead code
   * that looks live, which is the defect this phase's predecessor removed from
   * `events.ts`. Every handler must aim at a declared type.
   */
  it('aims every handler at a declared notification type', () => {
    const declared = new Set(notificationTypes.map((type) => type.type))
    for (const handler of notificationHandlers) {
      const targets = Array.isArray(handler.notificationType)
        ? handler.notificationType
        : [handler.notificationType]
      for (const target of targets) {
        expect({ handler: handler.id, target, declared: declared.has(target) }).toEqual({
          handler: handler.id,
          target,
          declared: true,
        })
      }
    }
  })

  it('gives every handler a stable override id and a declared feature gate', () => {
    const ids = notificationHandlers.map((handler) => handler.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const handler of notificationHandlers) {
      expect(handler.id.startsWith('staff.')).toBe(true)
      for (const feature of handler.features ?? []) {
        expect({ handler: handler.id, feature, declared: declaredFeatureIds.has(feature) }).toEqual({
          handler: handler.id,
          feature,
          declared: true,
        })
      }
    }
  })
})

describe('EP-49 — time-tracking AI tools and agent', () => {
  it('publishes the six tools the spec names', () => {
    expect(aiTools.map((tool) => tool.name).sort()).toEqual([
      'staff.draft_client_report',
      'staff.find_missing_days',
      'staff.log_time',
      'staff.start_timer',
      'staff.stop_timer',
      'staff.summarize_week',
    ])
  })

  /**
   * `isMutation` is what makes the runtime intercept the call and raise the
   * approval card; `loadBeforeRecord` is what gives that card a diff to render.
   * A write tool missing either is a write that persists without review.
   */
  it('routes every write through the approval contract', () => {
    const writes = ['staff.log_time', 'staff.start_timer', 'staff.stop_timer']
    for (const name of writes) {
      const tool = aiTools.find((candidate) => candidate.name === name)
      expect({ name, isMutation: tool?.isMutation === true }).toEqual({ name, isMutation: true })
      expect({ name, hasDiff: typeof tool?.loadBeforeRecord === 'function' }).toEqual({ name, hasDiff: true })
    }
    const reads = ['staff.summarize_week', 'staff.find_missing_days', 'staff.draft_client_report']
    for (const name of reads) {
      const tool = aiTools.find((candidate) => candidate.name === name)
      expect({ name, isMutation: tool?.isMutation === true }).toEqual({ name, isMutation: false })
    }
  })

  it('gates every tool on declared staff.timesheets.* features', () => {
    for (const tool of aiTools) {
      expect(tool.requiredFeatures?.length ?? 0).toBeGreaterThan(0)
      for (const feature of tool.requiredFeatures ?? []) {
        expect({ tool: tool.name, feature, declared: declaredFeatureIds.has(feature) }).toEqual({
          tool: tool.name,
          feature,
          declared: true,
        })
        expect(feature.startsWith('staff.timesheets.')).toBe(true)
      }
    }
  })

  it('ships one write-capable agent whose whitelist matches the pack', () => {
    expect(aiAgents).toHaveLength(1)
    const agent = aiAgents[0]
    expect(agent.id).toBe('staff.time_tracking_assistant')
    expect(agent.moduleId).toBe('staff')
    expect(agent.readOnly).toBe(false)
    expect(agent.mutationPolicy).toBe('confirm-required')
    const toolNames = new Set(aiTools.map((tool) => tool.name))
    for (const allowed of agent.allowedTools ?? []) {
      if (!allowed.startsWith('staff.')) continue
      expect({ allowed, exists: toolNames.has(allowed) }).toEqual({ allowed, exists: true })
    }
    for (const feature of agent.requiredFeatures ?? []) {
      expect(declaredFeatureIds.has(feature)).toBe(true)
    }
  })
})
