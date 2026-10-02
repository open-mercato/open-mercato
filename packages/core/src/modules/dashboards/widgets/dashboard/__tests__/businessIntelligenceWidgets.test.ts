/**
 * @jest-environment node
 */
import healthScoreWidget from '../business-health-score/widget'
import {
  DEFAULT_SETTINGS as HEALTH_DEFAULT_SETTINGS,
  hydrateSettings as hydrateHealthSettings,
} from '../business-health-score/config'

import needsAttentionWidget from '../needs-attention/widget'
import {
  DEFAULT_SETTINGS as ATTENTION_DEFAULT_SETTINGS,
  hydrateSettings as hydrateAttentionSettings,
} from '../needs-attention/config'

import executiveBriefWidget from '../executive-brief/widget'
import {
  DEFAULT_SETTINGS as BRIEF_DEFAULT_SETTINGS,
  hydrateSettings as hydrateBriefSettings,
} from '../executive-brief/config'

describe('Business Intelligence Widgets Configuration & Metadata', () => {
  describe('Business Health Score Widget', () => {
    it('declares correct metadata', () => {
      expect(healthScoreWidget.metadata).toMatchObject({
        id: 'dashboards.analytics.businessHealthScore',
        title: 'Business Health Score',
        category: 'analytics',
        defaultSize: 'sm',
        features: ['analytics.view'],
      })
      expect(healthScoreWidget.metadata.tags).toContain('health')
    })

    it('hydrates valid settings', () => {
      const hydrated = hydrateHealthSettings({
        dateRange: 'last_quarter',
        showComparison: false,
      })
      expect(hydrated).toEqual({
        dateRange: 'last_quarter',
        showComparison: false,
      })
    })

    it('falls back to default settings on invalid inputs', () => {
      expect(hydrateHealthSettings(null)).toEqual(HEALTH_DEFAULT_SETTINGS)
      expect(hydrateHealthSettings('invalid')).toEqual(HEALTH_DEFAULT_SETTINGS)
      expect(hydrateHealthSettings({ dateRange: 'not_a_preset', showComparison: 'yes' })).toEqual(HEALTH_DEFAULT_SETTINGS)
    })

    it('dehydrates settings correctly', () => {
      const dehydrated = healthScoreWidget.dehydrateSettings?.({
        dateRange: 'last_30_days',
        showComparison: true,
      })
      expect(dehydrated).toEqual({
        dateRange: 'last_30_days',
        showComparison: true,
      })
    })
  })

  describe('Needs Attention Widget', () => {
    it('declares correct metadata', () => {
      expect(needsAttentionWidget.metadata).toMatchObject({
        id: 'dashboards.analytics.needsAttention',
        title: 'Needs Attention',
        category: 'analytics',
        defaultSize: 'md',
        features: ['analytics.view'],
      })
      expect(needsAttentionWidget.metadata.tags).toContain('alerts')
    })

    it('hydrates valid settings', () => {
      const hydrated = hydrateAttentionSettings({
        dateRange: 'last_month',
        showComparison: true,
      })
      expect(hydrated).toEqual({
        dateRange: 'last_month',
        showComparison: true,
      })
    })

    it('falls back to default settings on invalid inputs', () => {
      expect(hydrateAttentionSettings(null)).toEqual(ATTENTION_DEFAULT_SETTINGS)
      expect(hydrateAttentionSettings({ dateRange: 'foo' })).toEqual(ATTENTION_DEFAULT_SETTINGS)
    })

    it('dehydrates settings correctly', () => {
      const dehydrated = needsAttentionWidget.dehydrateSettings?.({
        dateRange: 'this_year',
        showComparison: false,
      })
      expect(dehydrated).toEqual({
        dateRange: 'this_year',
        showComparison: false,
      })
    })
  })

  describe('Executive Brief Widget', () => {
    it('declares correct metadata', () => {
      expect(executiveBriefWidget.metadata).toMatchObject({
        id: 'dashboards.analytics.executiveBrief',
        title: 'Executive Brief',
        category: 'analytics',
        defaultSize: 'md',
        features: ['analytics.view'],
      })
      expect(executiveBriefWidget.metadata.tags).toContain('executive')
    })

    it('hydrates valid settings', () => {
      const hydrated = hydrateBriefSettings({
        dateRange: 'last_year',
        showComparison: false,
      })
      expect(hydrated).toEqual({
        dateRange: 'last_year',
        showComparison: false,
      })
    })

    it('falls back to default settings on invalid inputs', () => {
      expect(hydrateBriefSettings(null)).toEqual(BRIEF_DEFAULT_SETTINGS)
      expect(hydrateBriefSettings(undefined)).toEqual(BRIEF_DEFAULT_SETTINGS)
    })

    it('dehydrates settings correctly', () => {
      const dehydrated = executiveBriefWidget.dehydrateSettings?.({
        dateRange: 'today',
        showComparison: true,
      })
      expect(dehydrated).toEqual({
        dateRange: 'today',
        showComparison: true,
      })
    })
  })
})
