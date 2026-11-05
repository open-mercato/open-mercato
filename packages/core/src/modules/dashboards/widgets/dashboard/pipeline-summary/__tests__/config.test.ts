/**
 * @jest-environment node
 */
import {
  CLOSED_DEAL_STATUSES,
  DEFAULT_SETTINGS,
  OPEN_DEAL_CLOSURE_OUTCOME_FILTER,
  buildPipelineDataRequest,
  dehydrateSettings,
  hydrateSettings,
} from '../config'
import { CLOSED_DEAL_STATUS_LIST } from '@open-mercato/core/modules/customers/lib/dealStatus'

describe('pipeline summary settings', () => {
  describe('hydrateSettings', () => {
    it('falls back to the defaults for a non-object value', () => {
      expect(hydrateSettings(null)).toEqual(DEFAULT_SETTINGS)
      expect(hydrateSettings('this_month')).toEqual(DEFAULT_SETTINGS)
    })

    it('defaults the status scope to open when it is absent', () => {
      expect(hydrateSettings({ dateRange: 'this_year' })).toEqual({
        dateRange: 'this_year',
        statusScope: 'open',
      })
    })

    it('keeps a valid status scope', () => {
      expect(hydrateSettings({ dateRange: 'this_month', statusScope: 'all' }).statusScope).toBe('all')
    })

    it('rejects an unknown status scope', () => {
      expect(hydrateSettings({ dateRange: 'this_month', statusScope: 'won' }).statusScope).toBe('open')
    })
  })

  describe('dehydrateSettings', () => {
    it('persists the status scope so a saved widget keeps it', () => {
      expect(dehydrateSettings({ dateRange: 'this_year', statusScope: 'all' })).toEqual({
        dateRange: 'this_year',
        statusScope: 'all',
      })
    })

    it('round-trips through hydrateSettings without losing the scope', () => {
      const saved = dehydrateSettings({ dateRange: 'this_year', statusScope: 'all' })

      expect(hydrateSettings(saved)).toEqual({ dateRange: 'this_year', statusScope: 'all' })
    })
  })

  describe('CLOSED_DEAL_STATUSES', () => {
    // Spelled out rather than derived from the constant: a test that maps over
    // CLOSED_DEAL_STATUSES passes no matter which terminal statuses are missing from it.
    it('covers every terminal status the supported write paths persist', () => {
      expect([...CLOSED_DEAL_STATUSES].sort()).toEqual(['closed', 'loose', 'lost', 'win', 'won'])
    })

    // The literal above is deliberate (see its comment), but a literal alone cannot notice
    // the customers module dropping a spelling from its own vocabulary: when `loose` is
    // removed from LOST_DEAL_STATUS_LIST at 0.9.0 this copy would keep it and both suites
    // would stay green. Cross-checking membership catches that divergence without turning
    // the duplication into a cross-module import in the widget itself, which is a separate
    // architectural call.
    it('stays in step with the customers module vocabulary it duplicates', () => {
      expect([...CLOSED_DEAL_STATUSES].sort()).toEqual([...CLOSED_DEAL_STATUS_LIST].sort())
    })

    it('does not deny any status that means the deal is still open', () => {
      for (const openStatus of ['open', 'in_progress', 'negotiations', 'awaiting_legal']) {
        expect(CLOSED_DEAL_STATUSES).not.toContain(openStatus)
      }
    })
  })

  describe('buildPipelineDataRequest', () => {
    it.each(['win', 'loose', 'won', 'lost', 'closed'])('excludes deals stored as %s', (status) => {
      const request = buildPipelineDataRequest({ dateRange: 'this_year', statusScope: 'open' })

      expect(request.filters).toContainEqual({ field: 'status', operator: 'neq', value: status })
    })

    it('excludes closed deals for the open scope', () => {
      const request = buildPipelineDataRequest({ dateRange: 'this_year', statusScope: 'open' })

      expect(request.filters).toEqual([
        ...CLOSED_DEAL_STATUSES.map((status) => ({ field: 'status', operator: 'neq', value: status })),
        { field: 'closureOutcome', operator: 'is_null' },
      ])
    })

    it('leaves a tenant-specific active status in the chart', () => {
      const request = buildPipelineDataRequest({ dateRange: 'this_year', statusScope: 'open' })

      const statusFilters = request.filters?.filter((filter) => filter.field === 'status')

      expect(statusFilters?.every((filter) => filter.operator === 'neq')).toBe(true)
      expect(statusFilters?.map((filter) => filter.value)).not.toContain('awaiting_legal')
    })

    // #4668: a deal can be closed through `closure_outcome` alone — the CRUD API accepts it
    // without a status change — and the deals-summary KPI already counts such a deal as won or
    // lost. Without this filter the chart and the KPI cards disagree about the same deal.
    it('excludes a deal closed through closureOutcome alone', () => {
      const request = buildPipelineDataRequest({ dateRange: 'this_year', statusScope: 'open' })

      expect(request.filters).toContainEqual({ field: 'closureOutcome', operator: 'is_null' })
    })

    // The regression this locks in is silent: `neq` renders as `column != ?`, and because
    // `closure_outcome` is NULL on every open deal, `NULL != 'won'` is NULL rather than true —
    // a denylist there would empty the chart instead of trimming it. `not_in` (`!= ALL(?)`)
    // fails the same way. Only `is_null` keeps the open deals in.
    it('never tests closureOutcome with an operator that NULL cannot satisfy', () => {
      const request = buildPipelineDataRequest({ dateRange: 'this_year', statusScope: 'open' })
      const closureFilters = request.filters?.filter((filter) => filter.field === 'closureOutcome')

      expect(closureFilters).toHaveLength(1)
      for (const filter of closureFilters ?? []) {
        expect(filter.operator).toBe('is_null')
        expect(filter).not.toHaveProperty('value')
      }
    })

    it('exposes the closure-outcome filter as a constant so the intent is not re-derived', () => {
      expect(OPEN_DEAL_CLOSURE_OUTCOME_FILTER).toEqual({ field: 'closureOutcome', operator: 'is_null' })
    })

    it('drops the closure-outcome filter for the all scope', () => {
      const request = buildPipelineDataRequest({ dateRange: 'this_year', statusScope: 'all' })

      expect(request.filters?.some((filter) => filter.field === 'closureOutcome')).toBeFalsy()
    })

    it('sends no filters for the all scope', () => {
      const request = buildPipelineDataRequest({ dateRange: 'this_year', statusScope: 'all' })

      expect(request.filters).toBeUndefined()
    })

    it('keeps the metric, grouping and date range regardless of scope', () => {
      const request = buildPipelineDataRequest({ dateRange: 'last_month', statusScope: 'open' })

      expect(request.entityType).toBe('customers:deals')
      expect(request.metric).toEqual({ field: 'valueAmount', aggregate: 'sum' })
      expect(request.groupBy).toEqual({ field: 'pipelineStage', resolveLabels: true })
      expect(request.dateRange).toEqual({ field: 'createdAt', preset: 'last_month' })
    })
  })
})
