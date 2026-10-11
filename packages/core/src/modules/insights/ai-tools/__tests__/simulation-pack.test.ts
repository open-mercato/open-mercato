import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { SimulationRunDetail } from '../../lib/simulation/views'
import { buildSimulationRunText } from '../simulation-pack'

const translations: Record<string, string> = {
  'insights.ai.simulation.run': 'Simulation {kind} ({status}).',
  'insights.ai.simulation.group': '{group}: {total} records — {cells}.',
  'insights.ai.simulation.groupSuppressed': '{group}: fewer than {k} records, hidden for privacy.',
  'insights.ai.simulation.measures': '{group} amounts: {measures}.',
  'insights.ai.simulation.fewerThanK': 'fewer than {k}',
  'insights.ai.simulation.truncated': 'The run reached its budget, so the counts are partial.',
  'insights.ai.simulation.dataNotice': 'Counts only.',
  'insights.simulation.status.completed': 'completed',
}

const translate = ((key: string, fallbackOrParams?: unknown, maybeParams?: unknown) => {
  const params = (typeof fallbackOrParams === 'object' && fallbackOrParams !== null ? fallbackOrParams : maybeParams) as
    | Record<string, string | number>
    | undefined
  const template = translations[key] ?? key
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (params && name in params ? String(params[name]) : match))
}) as TranslateFn

function priceRunDetail(groups: NonNullable<SimulationRunDetail['result']>['groups']): SimulationRunDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'catalog.price_backtest',
    kindLabelKey: null,
    status: 'completed',
    result: { k: 10, truncated: false, groups, summary: null },
  } as unknown as SimulationRunDetail
}

describe('simulation result AI summary', () => {
  it('words group totals neutrally and lists the measures of a visible group', () => {
    const detail = priceRunDetail([
      {
        key: 'orders:EUR:net',
        labelKey: null,
        sampleResourceKind: null,
        total: 22,
        suppressed: false,
        cells: [
          { key: 'priced_from_row', count: 12, suppressed: null, samples: [] },
          { key: 'manual_override', count: 10, suppressed: null, samples: [] },
          { key: 'cannot_tell', count: 0, suppressed: null, samples: [] },
        ],
        warnings: [],
        flags: [],
        measures: [
          { key: 'current_revenue', cell: 'priced_from_row', value: '864.00', currencyCode: 'EUR' },
          { key: 'revenue_delta', cell: 'priced_from_row', value: '90.00', currencyCode: 'EUR' },
        ],
      },
    ])

    const { text } = buildSimulationRunText(detail, translate)

    expect(text).toContain('22 records')
    expect(text).not.toContain('events')
    expect(text).toContain('amounts: "current_revenue"=864.00 "EUR", "revenue_delta"=90.00 "EUR".')
  })

  it('never reveals measures or counts of a suppressed group', () => {
    const detail = priceRunDetail([
      {
        key: 'quotes:EUR:net',
        labelKey: null,
        sampleResourceKind: null,
        total: null,
        suppressed: true,
        cells: [],
        warnings: [],
        flags: [],
        measures: [{ key: 'revenue_delta', cell: 'priced_from_row', value: '5.00', currencyCode: 'EUR' }],
      },
    ])

    const { text } = buildSimulationRunText(detail, translate)

    expect(text).toContain('fewer than 10 records, hidden for privacy')
    expect(text).not.toContain('5.00')
    expect(text).not.toContain('amounts')
  })
})
