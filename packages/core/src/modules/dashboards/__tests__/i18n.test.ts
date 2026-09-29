import { describe, expect, it } from '@jest/globals'

import es from '../i18n/es.json'
import pl from '../i18n/pl.json'

describe('dashboard translations', () => {
  it('preserves Polish diacritics in comparison labels', () => {
    expect(pl).toMatchObject({
      'dashboards.analytics.comparison.vsLastMonth': 'vs poprzedni miesiąc',
      'dashboards.analytics.comparison.vsLastQuarter': 'vs poprzedni kwartał',
      'dashboards.analytics.comparison.vsLastWeek': 'vs poprzedni tydzień',
      'dashboards.analytics.comparison.vsMonthBefore': 'vs miesiąc wcześniej',
      'dashboards.analytics.comparison.vsQuarterBefore': 'vs kwartał wcześniej',
      'dashboards.analytics.comparison.vsWeekBefore': 'vs tydzień wcześniej',
      'dashboards.analytics.comparison.vsYearBefore': 'vs rok wcześniej',
    })
  })

  it('preserves Spanish diacritics in comparison labels', () => {
    expect(es).toMatchObject({
      'dashboards.analytics.comparison.vsPrevious30Days': 'vs 30 días anteriores',
      'dashboards.analytics.comparison.vsPrevious7Days': 'vs 7 días anteriores',
      'dashboards.analytics.comparison.vsPrevious90Days': 'vs 90 días anteriores',
      'dashboards.analytics.comparison.vsPreviousPeriod': 'vs período anterior',
    })
  })
})
