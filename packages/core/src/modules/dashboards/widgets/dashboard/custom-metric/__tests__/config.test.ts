/**
 * @jest-environment node
 */
import { DEFAULT_SETTINGS, hydrateSettings } from '../config'

describe('custom metric widget settings', () => {
  test('falls back to safe defaults for garbage input', () => {
    expect(hydrateSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(hydrateSettings('bad settings')).toEqual(DEFAULT_SETTINGS)
    expect(hydrateSettings({
      entityType: 42,
      metricField: '',
      aggregate: 'median',
      groupByField: false,
      granularity: 'minute',
      limit: 'nope',
      visualization: 'scatter',
      title: 12,
      dateRangeMode: 'tenant',
      dateRangePreset: 'forever',
    })).toEqual(DEFAULT_SETTINGS)
  })

  test('clamps limit to the maximum supported by widget-data settings', () => {
    expect(hydrateSettings({ limit: 200 }).limit).toBe(20)
    expect(hydrateSettings({ limit: 0 }).limit).toBe(1)
  })
})
