/**
 * KPI presentation rules (spec §8.5) — PURE.
 */

import {
  METRIC_RATE_FAIR,
  METRIC_RATE_GOOD,
  METRIC_TONE_CLASS,
  formatRate,
  rateTone,
} from '../metrics/metrics-display'

describe('rateTone', () => {
  test('no denominator is neutral, never an error tone', () => {
    // "Nothing terminated in this window" is not a failure; a red cell would
    // send an operator hunting for a problem that does not exist.
    expect(rateTone(null)).toBe('neutral')
  })

  test('the thresholds are inclusive at their lower bound', () => {
    expect(rateTone(METRIC_RATE_GOOD)).toBe('success')
    expect(rateTone(METRIC_RATE_GOOD - 0.001)).toBe('warning')
    expect(rateTone(METRIC_RATE_FAIR)).toBe('warning')
    expect(rateTone(METRIC_RATE_FAIR - 0.001)).toBe('error')
  })

  test('a perfect rate is success and a total failure is the error tone', () => {
    expect(rateTone(1)).toBe('success')
    expect(rateTone(0)).toBe('error')
  })
})

describe('formatRate', () => {
  test('renders whole percents and null for no denominator', () => {
    expect(formatRate(null)).toBeNull()
    expect(formatRate(0)).toBe('0%')
    expect(formatRate(1)).toBe('100%')
    expect(formatRate(0.875)).toBe('88%')
  })
})

describe('METRIC_TONE_CLASS', () => {
  test('every tone maps to a DS status token, never a raw Tailwind shade', () => {
    for (const className of Object.values(METRIC_TONE_CLASS)) {
      expect(className).toMatch(/^text-(status-[a-z]+-text|muted-foreground)$/)
    }
  })

  test('covers every tone rateTone can return', () => {
    const tones = [rateTone(null), rateTone(1), rateTone(0.9), rateTone(0)]
    for (const tone of tones) {
      expect(METRIC_TONE_CLASS[tone]).toBeDefined()
    }
  })
})
