import {
  calculateMetricPerformanceMultiplier,
  calculateHealthScore,
  identifyAttentionItems,
  generateExecutiveBrief,
  fetchBusinessIntelligenceMetrics,
  HEALTH_SCORE_WEIGHTS,
  type BusinessMetrics,
  type MetricTrend,
} from '../businessIntelligence'

describe('businessIntelligence utility', () => {
  describe('calculateMetricPerformanceMultiplier', () => {
    it('returns neutral 0.5 for missing or null trend', () => {
      expect(calculateMetricPerformanceMultiplier(undefined)).toBe(0.5)
      expect(calculateMetricPerformanceMultiplier({ current: null, previous: null, change: null, direction: 'unchanged' })).toBe(0.5)
      expect(calculateMetricPerformanceMultiplier({ current: 10, previous: null, change: Number.NaN, direction: 'unchanged' })).toBe(0.5)
    })

    it('returns neutral 0.5 for stable trends within ±2%', () => {
      expect(calculateMetricPerformanceMultiplier({ current: 100, previous: 100, change: 0, direction: 'unchanged' })).toBe(0.5)
      expect(calculateMetricPerformanceMultiplier({ current: 101, previous: 100, change: 1.5, direction: 'up' })).toBe(0.5)
      expect(calculateMetricPerformanceMultiplier({ current: 98.5, previous: 100, change: -1.5, direction: 'down' })).toBe(0.5)
    })

    it('scales up to 1.0 for positive growth >= 20%', () => {
      expect(calculateMetricPerformanceMultiplier({ current: 120, previous: 100, change: 20, direction: 'up' })).toBe(1.0)
      expect(calculateMetricPerformanceMultiplier({ current: 150, previous: 100, change: 50, direction: 'up' })).toBe(1.0)
    })

    it('scales down to 0.0 for negative decline <= -20%', () => {
      expect(calculateMetricPerformanceMultiplier({ current: 80, previous: 100, change: -20, direction: 'down' })).toBe(0.0)
      expect(calculateMetricPerformanceMultiplier({ current: 50, previous: 100, change: -50, direction: 'down' })).toBe(0.0)
    })

    it('linearly interpolates intermediate positive and negative values', () => {
      // +11% is halfway between +2% and +20% -> 0.75
      const midUp = calculateMetricPerformanceMultiplier({ current: 111, previous: 100, change: 11, direction: 'up' })
      expect(midUp).toBeCloseTo(0.75, 2)

      // -11% is halfway between -2% and -20% -> 0.25
      const midDown = calculateMetricPerformanceMultiplier({ current: 89, previous: 100, change: -11, direction: 'down' })
      expect(midDown).toBeCloseTo(0.25, 2)
    })
  })

  describe('calculateHealthScore', () => {
    it('returns 100 and healthy status when all metrics have strong positive growth', () => {
      const metrics: BusinessMetrics = {
        revenue: { current: 12000, previous: 10000, change: 20, direction: 'up' },
        orders: { current: 125, previous: 100, change: 25, direction: 'up' },
        averageOrderValue: { current: 120, previous: 100, change: 20, direction: 'up' },
        newCustomers: { current: 60, previous: 50, change: 20, direction: 'up' },
      }

      const result = calculateHealthScore(metrics)
      expect(result.score).toBe(100)
      expect(result.status).toBe('healthy')
      expect(result.breakdown).toHaveLength(4)
      expect(result.summary).toContain('Solid business performance')
    })

    it('returns 0 and critical status when all metrics have severe declines', () => {
      const metrics: BusinessMetrics = {
        revenue: { current: 7000, previous: 10000, change: -30, direction: 'down' },
        orders: { current: 70, previous: 100, change: -30, direction: 'down' },
        averageOrderValue: { current: 75, previous: 100, change: -25, direction: 'down' },
        newCustomers: { current: 35, previous: 50, change: -30, direction: 'down' },
      }

      const result = calculateHealthScore(metrics)
      expect(result.score).toBe(0)
      expect(result.status).toBe('critical')
      expect(result.summary).toContain('Critical performance alert')
    })

    it('returns 50 and watch status for completely flat metrics', () => {
      const metrics: BusinessMetrics = {
        revenue: { current: 10000, previous: 10000, change: 0, direction: 'unchanged' },
        orders: { current: 100, previous: 100, change: 0, direction: 'unchanged' },
        averageOrderValue: { current: 100, previous: 100, change: 0, direction: 'unchanged' },
        newCustomers: { current: 50, previous: 50, change: 0, direction: 'unchanged' },
      }

      const result = calculateHealthScore(metrics)
      expect(result.score).toBe(50)
      expect(result.status).toBe('watch')
    })

    it('gracefully handles missing/null metric objects without crashing', () => {
      const metrics: BusinessMetrics = {}
      const result = calculateHealthScore(metrics)

      // Each gets 50% neutral multiplier: (35*0.5) + (25*0.5) + (20*0.5) + (20*0.5) = 17.5 + 12.5 + 10 + 10 = 50
      expect(result.score).toBe(50)
      expect(result.status).toBe('watch')
      expect(result.summary).toContain('Insufficient comparison data')
    })

    it('weights match specification: 35 + 25 + 20 + 20 = 100', () => {
      const totalWeight =
        HEALTH_SCORE_WEIGHTS.revenue +
        HEALTH_SCORE_WEIGHTS.orders +
        HEALTH_SCORE_WEIGHTS.averageOrderValue +
        HEALTH_SCORE_WEIGHTS.newCustomers
      expect(totalWeight).toBe(100)
    })
  })

  describe('identifyAttentionItems', () => {
    it('flags critical revenue drops >= 10%', () => {
      const metrics: BusinessMetrics = {
        revenue: { current: 8800, previous: 10000, change: -12.0, direction: 'down' },
      }
      const items = identifyAttentionItems(metrics)
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: 'critical',
            metricKey: 'revenue',
            description: 'Revenue decreased by 12.0% compared with the previous period.',
          }),
        ])
      )
    })

    it('flags warning revenue drops between 5% and 10%', () => {
      const metrics: BusinessMetrics = {
        revenue: { current: 9350, previous: 10000, change: -6.5, direction: 'down' },
      }
      const items = identifyAttentionItems(metrics)
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: 'warning',
            metricKey: 'revenue',
            title: 'Revenue Softening',
          }),
        ])
      )
    })

    it('flags critical order volume drops >= 15%', () => {
      const metrics: BusinessMetrics = {
        orders: { current: 80, previous: 100, change: -20.0, direction: 'down' },
      }
      const items = identifyAttentionItems(metrics)
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: 'critical',
            metricKey: 'orders',
            title: 'Severe Order Volume Drop',
          }),
        ])
      )
    })

    it('flags divergence when customer growth is positive but orders decline', () => {
      const metrics: BusinessMetrics = {
        newCustomers: { current: 120, previous: 100, change: 20.0, direction: 'up' },
        orders: { current: 95, previous: 100, change: -5.0, direction: 'down' },
      }
      const items = identifyAttentionItems(metrics)
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: 'warning',
            title: 'Order Volume Trailing Customer Growth',
          }),
        ])
      )
    })

    it('flags positive expansion milestones', () => {
      const metrics: BusinessMetrics = {
        revenue: { current: 12000, previous: 10000, change: 20.0, direction: 'up' },
        newCustomers: { current: 130, previous: 100, change: 30.0, direction: 'up' },
      }
      const items = identifyAttentionItems(metrics)
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: 'positive', metricKey: 'revenue' }),
          expect.objectContaining({ severity: 'positive', metricKey: 'newCustomers' }),
        ])
      )
    })

    it('prioritizes critical items before warning and positive items', () => {
      const metrics: BusinessMetrics = {
        revenue: { current: 8500, previous: 10000, change: -15.0, direction: 'down' }, // critical
        averageOrderValue: { current: 90, previous: 100, change: -10.0, direction: 'down' }, // warning
        newCustomers: { current: 130, previous: 100, change: 30.0, direction: 'up' }, // positive
      }
      const items = identifyAttentionItems(metrics)
      expect(items.length).toBeGreaterThanOrEqual(3)
      expect(items[0].severity).toBe('critical')
      expect(items[1].severity).toBe('warning')
      expect(items[2].severity).toBe('positive')
    })

    it('returns empty array when all metrics are stable within normal range', () => {
      const metrics: BusinessMetrics = {
        revenue: { current: 10100, previous: 10000, change: 1.0, direction: 'up' },
        orders: { current: 100, previous: 100, change: 0, direction: 'unchanged' },
      }
      const items = identifyAttentionItems(metrics)
      expect(items).toHaveLength(0)
    })
  })

  describe('generateExecutiveBrief', () => {
    it('generates a concise, deterministic executive brief with key takeaways', () => {
      const metrics: BusinessMetrics = {
        revenue: { current: 11800, previous: 10000, change: 18.0, direction: 'up' },
        orders: { current: 105, previous: 100, change: 5.0, direction: 'up' },
        newCustomers: { current: 121, previous: 100, change: 21.0, direction: 'up' },
      }

      const brief = generateExecutiveBrief(metrics)
      expect(brief.status).toBe('healthy')
      expect(brief.headline).toBe('Business Performance Healthy')
      expect(brief.narrative).toContain('Revenue increased 18.0% and customer growth increased 21.0%')
      expect(brief.narrative).toContain('Order growth is trailing customer growth and should be monitored.')
      expect(brief.keyTakeaways).toEqual([
        'Revenue increased 18.0% compared with the previous period.',
        'Order count increased 5.0% compared with the previous period.',
        'New customer acquisition increased 21.0% compared with the previous period.',
      ])
    })

    it('generates an appropriate narrative for critical downturns', () => {
      const metrics: BusinessMetrics = {
        revenue: { current: 8000, previous: 10000, change: -20.0, direction: 'down' },
        orders: { current: 75, previous: 100, change: -25.0, direction: 'down' },
      }

      const brief = generateExecutiveBrief(metrics)
      expect(brief.status).toBe('critical')
      expect(brief.headline).toBe('Business Performance Requires Urgent Attention')
      expect(brief.narrative).toContain('Multiple performance indicators are contracting significantly.')
    })

    it('handles empty metrics gracefully without crashing', () => {
      const brief = generateExecutiveBrief({})
      expect(brief.status).toBe('watch')
      expect(brief.keyTakeaways).toHaveLength(0)
      expect(brief.narrative).toContain('Insufficient comparative metrics')
    })
  })

  describe('fetchBusinessIntelligenceMetrics', () => {
    it('dispatches all 4 queries and correctly maps responses into BusinessMetrics', async () => {
      const mockFetcher = jest.fn(async (body: any) => {
        if (body.entityType === 'sales:orders' && body.metric.aggregate === 'sum') {
          return { value: 50000, comparison: { value: 40000, change: 25.0, direction: 'up' } }
        }
        if (body.entityType === 'sales:orders' && body.metric.aggregate === 'count') {
          return { value: 200, comparison: { value: 180, change: 11.1, direction: 'up' } }
        }
        if (body.entityType === 'sales:orders' && body.metric.aggregate === 'avg') {
          return { value: 250, comparison: { value: 222, change: 12.6, direction: 'up' } }
        }
        if (body.entityType === 'customers:entities') {
          return { value: 50, comparison: { value: 40, change: 25.0, direction: 'up' } }
        }
        return { value: null }
      })

      const metrics = await fetchBusinessIntelligenceMetrics(
        { dateRange: 'this_month', showComparison: true },
        mockFetcher as any
      )

      expect(mockFetcher).toHaveBeenCalledTimes(4)
      expect(metrics.revenue?.current).toBe(50000)
      expect(metrics.revenue?.change).toBe(25.0)
      expect(metrics.orders?.current).toBe(200)
      expect(metrics.averageOrderValue?.current).toBe(250)
      expect(metrics.newCustomers?.current).toBe(50)
    })
  })
})
