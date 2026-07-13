import {
  CUSTOMER_EXAMPLES,
  ENTITY_STATUS_DEFAULTS,
  ENTITY_SOURCE_DEFAULTS,
  ENTITY_LIFECYCLE_STAGE_DEFAULTS,
  DEAL_STATUS_DEFAULTS,
  PIPELINE_STAGE_DEFAULTS,
  INTERACTION_STATUS_DEFAULTS,
} from '../cli'

const valuesOf = (dict: ReadonlyArray<{ value: string }>) => new Set(dict.map((d) => d.value))

// Regression guard for #2645: every dictionary-backed value used in the curated
// customer seed data (CUSTOMER_EXAMPLES) must be a member of the dictionary the UI
// binds that field to — otherwise the seeded record renders an out-of-scope value
// (e.g. a `status: 'customer'` that actually belongs to the lifecycle_stage dictionary).
describe('customers seed data stays within dictionary scope (#2645)', () => {
  it('uses only dictionary-backed status/source/lifecycle/pipeline values', () => {
    const statusValues = valuesOf(ENTITY_STATUS_DEFAULTS)
    const sourceValues = valuesOf(ENTITY_SOURCE_DEFAULTS)
    const lifecycleValues = valuesOf(ENTITY_LIFECYCLE_STAGE_DEFAULTS)
    const dealStatusValues = valuesOf(DEAL_STATUS_DEFAULTS)
    const pipelineValues = valuesOf(PIPELINE_STAGE_DEFAULTS)

    const violations: string[] = []
    const check = (
      where: string,
      field: string,
      value: string | undefined,
      allowed: Set<string>,
    ) => {
      if (value != null && !allowed.has(value)) {
        violations.push(`${where}: ${field}="${value}"`)
      }
    }

    for (const company of CUSTOMER_EXAMPLES) {
      const c = `company "${company.slug}"`
      check(c, 'status', company.status, statusValues)
      check(c, 'source', company.source, sourceValues)
      check(c, 'lifecycleStage', company.lifecycleStage, lifecycleValues)

      for (const person of company.people ?? []) {
        check(`person "${person.slug}"`, 'source', person.source, sourceValues)
      }

      for (const deal of company.deals ?? []) {
        const d = `deal "${deal.slug}"`
        check(d, 'status', deal.status, dealStatusValues)
        check(d, 'pipelineStage', deal.pipelineStage, pipelineValues)
        check(d, 'source', deal.source, sourceValues)
      }
    }

    expect(violations).toEqual([])
  })
})

describe('interaction status dictionary defaults', () => {
  it('seeds the five canonical statuses in order', () => {
    expect(INTERACTION_STATUS_DEFAULTS.map((entry) => entry.value)).toEqual([
      'planned',
      'in_progress',
      'waiting',
      'done',
      'canceled',
    ])
  })

  it('gives every default a label, color, and icon', () => {
    for (const entry of INTERACTION_STATUS_DEFAULTS) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.color).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(entry.icon).toMatch(/^lucide:/)
    }
  })
})
