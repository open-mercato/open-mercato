import type { ExplainModuleConfig } from '@open-mercato/shared/modules/insights/explain'
import type { ModuleInjectionSlot } from '@open-mercato/shared/modules/widgets/injection'
import injectionTable from '../../injection-table'
import customersExplainConfig from '../../../../customers/insights.explain'
import customerGroupsExplainConfig from '../../../../customer_groups/insights.explain'
import salesExplainConfig from '../../../../sales/insights.explain'

const FIELD_WHY_WIDGET_ID = 'insights.injection.field-why'
const FIELD_EXPLAIN_TOGGLE_WIDGET_ID = 'insights.injection.field-explain-toggle'

function widgetIdsOf(slots: ModuleInjectionSlot | ModuleInjectionSlot[] | undefined): string[] {
  const list = Array.isArray(slots) ? slots : slots === undefined ? [] : [slots]
  return list.map((slot) => (typeof slot === 'string' ? slot : slot.widgetId))
}

function spotKeysFor(widgetId: string): string[] {
  return Object.entries(injectionTable)
    .filter(([, slots]) => widgetIdsOf(slots).includes(widgetId))
    .map(([spotKey]) => spotKey)
    .sort((left, right) => left.localeCompare(right))
}

function declaredFormEntityIds(configs: ExplainModuleConfig[]): string[] {
  const ids = new Set<string>()
  for (const config of configs) {
    for (const resource of config.resources ?? []) {
      if (resource.noHistory) continue
      if (resource.fields.length === 0 && !resource.customFields) continue
      for (const formEntityId of resource.formEntityIds ?? []) ids.add(formEntityId)
    }
  }
  return Array.from(ids).sort((left, right) => left.localeCompare(right))
}

describe('insights field explain registration', () => {
  const formEntityIds = declaredFormEntityIds([customersExplainConfig, customerGroupsExplainConfig, salesExplainConfig])

  it('covers the customers deal, person and company forms', () => {
    expect(formEntityIds).toEqual(['customers.company', 'customers.customer_deal', 'customers.deal', 'customers.person'])
  })

  it('registers the field button only on field-after patterns of declared form entity ids', () => {
    expect(spotKeysFor(FIELD_WHY_WIDGET_ID)).toEqual(
      formEntityIds.map((formEntityId) => `crud-form:${formEntityId}:field:*:after`).sort((left, right) => left.localeCompare(right)),
    )
  })

  it('registers the explain switch only on the header spot of declared form entity ids', () => {
    expect(spotKeysFor(FIELD_EXPLAIN_TOGGLE_WIDGET_ID)).toEqual(
      formEntityIds.map((formEntityId) => `crud-form:${formEntityId}:header`).sort((left, right) => left.localeCompare(right)),
    )
  })

  it('never registers on a global CrudForm wildcard', () => {
    for (const spotKey of Object.keys(injectionTable)) {
      expect(spotKey.startsWith('crud-form:*')).toBe(false)
      expect(spotKey).not.toBe('*')
    }
  })
})
