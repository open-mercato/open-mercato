/**
 * Regression guard for #4668: the analytics/aggregation layer can only filter on
 * fields the module maps, so a closed-deal predicate built on `status` alone
 * misses deals whose closure was recorded through `closure_outcome`. The deals
 * KPI definition treats a set `closureOutcome` as closed, which the aggregation
 * layer could not express while the field was unmapped.
 */
import { analyticsConfig } from '../analytics'

function getDealsEntity() {
  const entity = analyticsConfig.entities.find((candidate) => candidate.entityId === 'customers:deals')
  if (!entity) throw new Error('[internal] customers:deals analytics entity is not declared')
  return entity
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

describe('customers analytics field mappings', () => {
  it('exposes closureOutcome so closed-deal filtering matches the KPI definition (#4668)', () => {
    expect(getDealsEntity().fieldMappings.closureOutcome).toEqual({
      dbColumn: 'closure_outcome',
      type: 'text',
    })
  })

  it('maps every deals field to the snake_case column of the same name', () => {
    for (const [field, mapping] of Object.entries(getDealsEntity().fieldMappings)) {
      expect(mapping.dbColumn).toBe(toSnakeCase(field))
    }
  })
})
