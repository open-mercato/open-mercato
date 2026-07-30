/**
 * @jest-environment node
 */
import {
  CLOSED_DEAL_STATUSES,
  DEFAULT_SETTINGS,
  buildPipelineDataRequest,
  dehydrateSettings,
  hydrateSettings,
} from '../config'

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

      expect(request.filters).toEqual(
        CLOSED_DEAL_STATUSES.map((status) => ({ field: 'status', operator: 'neq', value: status })),
      )
    })

    it('leaves a tenant-specific active status in the chart', () => {
      const request = buildPipelineDataRequest({ dateRange: 'this_year', statusScope: 'open' })

      expect(request.filters?.every((filter) => filter.operator === 'neq')).toBe(true)
      expect(request.filters?.map((filter) => filter.value)).not.toContain('awaiting_legal')
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
