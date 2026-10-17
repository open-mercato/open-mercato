/**
 * @jest-environment jsdom
 *
 * Field-level spots (`crud-form:<entityId>:field:<fieldId>:after`) are rendered by CrudForm only
 * when `hasInjectionWidgetsForSpotPrefix` finds a registration that names the `:field:` segment.
 * A broad pattern such as `record_locks.injection.crud-form-locking` on `crud-form:*` must neither
 * enable field spots nor resolve into them.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import type { InjectionWidgetModule, ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import {
  INJECTION_FIELD_SPOT_SEGMENT,
  hasInjectionWidgetsForSpotPrefix,
  invalidateInjectionWidgetCache,
  loadInjectionWidgetsForSpot,
  registerCoreInjectionTables,
  registerCoreInjectionWidgets,
  registerEnabledModuleIds,
  subscribeToInjectionRegistryChanges,
} from '@open-mercato/shared/modules/widgets/injection-loader'

const DEAL_FIELD_PREFIX = 'crud-form:customers.deal:field:'
const PERSON_FIELD_PREFIX = 'crud-form:customers.person:field:'
const RECORD_LOCKS_WIDGET_ID = 'record_locks.injection.crud-form-locking'
const FIELD_WIDGET_ID = 'insights.injection.field-why'

const PlaceholderComponent = () => null

function makeWidget(id: string): InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> {
  return {
    metadata: { id, title: id, description: id, priority: 0, enabled: true },
    Widget: PlaceholderComponent,
  }
}

function makeWidgetEntry(moduleId: string, widgetId: string): ModuleInjectionWidgetEntry {
  return {
    moduleId,
    key: `${moduleId}/widgets/injection/${widgetId}/widget.ts`,
    source: 'package',
    widgetId,
    loader: async () => makeWidget(widgetId),
  } as ModuleInjectionWidgetEntry
}

function registerTables(tables: Array<{ moduleId: string; table: ModuleInjectionTable }>) {
  registerCoreInjectionTables(tables)
}

describe('field-level injection spots', () => {
  const pendingUnsubscribers: Array<() => void> = []

  beforeEach(() => {
    invalidateInjectionWidgetCache()
    registerCoreInjectionWidgets([])
    registerTables([])
    registerEnabledModuleIds(['record_locks', 'insights'])
  })

  afterEach(() => {
    while (pendingUnsubscribers.length) pendingUnsubscribers.pop()?.()
  })

  it('uses the documented field segment', () => {
    expect(INJECTION_FIELD_SPOT_SEGMENT).toBe(':field:')
  })

  it('answers false while no table addresses a field spot', () => {
    expect(hasInjectionWidgetsForSpotPrefix(DEAL_FIELD_PREFIX)).toBe(false)
    expect(hasInjectionWidgetsForSpotPrefix('')).toBe(false)
  })

  it('never counts a bare crud-form wildcard or other non-field keys (record_locks)', () => {
    registerTables([
      {
        moduleId: 'record_locks',
        table: {
          'crud-form:*': [{ widgetId: RECORD_LOCKS_WIDGET_ID, priority: 400 }],
          'backend-mutation:global': [{ widgetId: RECORD_LOCKS_WIDGET_ID, priority: 500 }],
        },
      },
      {
        moduleId: 'other',
        table: {
          'crud-form:customers.deal:*': 'other.injection.any',
          'crud-form:customers.deal:header': 'other.injection.header',
          'crud-form:customers.deal:fields': 'other.injection.fields',
          '*': 'other.injection.everything',
        },
      },
    ])
    expect(hasInjectionWidgetsForSpotPrefix(DEAL_FIELD_PREFIX)).toBe(false)
  })

  it('counts an exact field spot key only for its own form prefix', () => {
    registerTables([
      { moduleId: 'insights', table: { 'crud-form:customers.deal:field:status:after': FIELD_WIDGET_ID } },
    ])
    expect(hasInjectionWidgetsForSpotPrefix(DEAL_FIELD_PREFIX)).toBe(true)
    expect(hasInjectionWidgetsForSpotPrefix(PERSON_FIELD_PREFIX)).toBe(false)
    expect(hasInjectionWidgetsForSpotPrefix('crud-form:customers.dealer:field:')).toBe(false)
  })

  it('counts an explicit field pattern for the matching form only', () => {
    registerTables([
      { moduleId: 'insights', table: { 'crud-form:customers.deal:field:*:after': [{ widgetId: FIELD_WIDGET_ID }] } },
    ])
    expect(hasInjectionWidgetsForSpotPrefix(DEAL_FIELD_PREFIX)).toBe(true)
    expect(hasInjectionWidgetsForSpotPrefix(PERSON_FIELD_PREFIX)).toBe(false)
  })

  it('counts a cross-form pattern that still names the field segment', () => {
    registerTables([
      { moduleId: 'other', table: { 'crud-form:customers.*:field:*:after': FIELD_WIDGET_ID } },
      { moduleId: 'sales', table: { 'crud-form:sales.*:field:*:after': FIELD_WIDGET_ID } },
    ])
    expect(hasInjectionWidgetsForSpotPrefix(DEAL_FIELD_PREFIX)).toBe(true)
    expect(hasInjectionWidgetsForSpotPrefix(PERSON_FIELD_PREFIX)).toBe(true)
    expect(hasInjectionWidgetsForSpotPrefix('crud-form:catalog.product:field:')).toBe(false)
  })

  it('matches the form part of a pattern exactly, not just its literal head', () => {
    registerTables([
      { moduleId: 'other', table: { 'crud-form:*.person:field:*:after': FIELD_WIDGET_ID } },
    ])
    expect(hasInjectionWidgetsForSpotPrefix(PERSON_FIELD_PREFIX)).toBe(true)
    expect(hasInjectionWidgetsForSpotPrefix(DEAL_FIELD_PREFIX)).toBe(false)
  })

  it('answers false for a prefix that is not a field prefix', () => {
    registerTables([
      { moduleId: 'insights', table: { 'crud-form:customers.deal:field:*:after': FIELD_WIDGET_ID } },
    ])
    expect(hasInjectionWidgetsForSpotPrefix('crud-form:customers.deal')).toBe(false)
    expect(hasInjectionWidgetsForSpotPrefix('crud-form:customers.deal:fi')).toBe(false)
  })

  it('ignores field keys registered with no widgets', () => {
    registerTables([{ moduleId: 'insights', table: { 'crud-form:customers.deal:field:*:after': [] } }])
    expect(hasInjectionWidgetsForSpotPrefix(DEAL_FIELD_PREFIX)).toBe(false)
  })

  it('re-evaluates and notifies subscribers when the registry registers late', () => {
    let notifications = 0
    pendingUnsubscribers.push(subscribeToInjectionRegistryChanges(() => {
      notifications += 1
    }))
    expect(hasInjectionWidgetsForSpotPrefix(DEAL_FIELD_PREFIX)).toBe(false)
    registerTables([
      { moduleId: 'insights', table: { 'crud-form:customers.deal:field:*:after': FIELD_WIDGET_ID } },
    ])
    expect(notifications).toBe(1)
    expect(hasInjectionWidgetsForSpotPrefix(DEAL_FIELD_PREFIX)).toBe(true)
    registerTables([])
    expect(hasInjectionWidgetsForSpotPrefix(DEAL_FIELD_PREFIX)).toBe(false)
  })

  it('keeps crud-form wildcard widgets out of field spots but not out of the form spot', async () => {
    registerCoreInjectionWidgets([
      makeWidgetEntry('record_locks', RECORD_LOCKS_WIDGET_ID),
      makeWidgetEntry('insights', FIELD_WIDGET_ID),
    ])
    registerTables([
      { moduleId: 'record_locks', table: { 'crud-form:*': [{ widgetId: RECORD_LOCKS_WIDGET_ID, priority: 400 }] } },
      { moduleId: 'insights', table: { 'crud-form:customers.deal:field:*:after': FIELD_WIDGET_ID } },
    ])

    const fieldWidgets = await loadInjectionWidgetsForSpot('crud-form:customers.deal:field:status:after')
    expect(fieldWidgets.map((widget) => widget.metadata.id)).toEqual([FIELD_WIDGET_ID])

    const otherFormFieldWidgets = await loadInjectionWidgetsForSpot('crud-form:customers.person:field:status:after')
    expect(otherFormFieldWidgets).toEqual([])

    const formWidgets = await loadInjectionWidgetsForSpot('crud-form:customers.deal')
    expect(formWidgets.map((widget) => widget.metadata.id)).toEqual([RECORD_LOCKS_WIDGET_ID])
  })
})
