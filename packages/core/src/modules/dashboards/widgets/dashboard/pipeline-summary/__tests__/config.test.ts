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

  describe('buildPipelineDataRequest', () => {
    it('excludes closed deals for the open scope', () => {
      const request = buildPipelineDataRequest({ dateRange: 'this_year', statusScope: 'open' })

      expect(request.filters).toEqual(
        CLOSED_DEAL_STATUSES.map((status) => ({ field: 'status', operator: 'neq', value: status })),
      )
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
