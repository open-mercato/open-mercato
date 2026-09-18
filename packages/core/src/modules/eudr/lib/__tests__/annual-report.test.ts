import {
  accumulateSupplementaryQuantities,
  buildAnnualReportCsv,
  type AnnualReport,
} from '../annual-report'

function reportWithCommodities(
  byCommodity: AnnualReport['statements']['byCommodity'],
): AnnualReport {
  return {
    year: 2026,
    generatedAt: '2026-07-22T10:00:00.000Z',
    statements: {
      total: byCommodity.reduce((total, commodity) => total + commodity.count, 0),
      byStatus: {},
      byCommodity,
    },
  }
}

describe('accumulateSupplementaryQuantities', () => {
  it('groups normalized units separately and accumulates exact thousandths', () => {
    expect(accumulateSupplementaryQuantities([
      { unit: ' kg ', quantity: '0.001' },
      { unit: 'KG', quantity: 0.002 },
      { unit: 'l', quantity: '1.250' },
      { unit: ' L ', quantity: 2.75 },
      { unit: null, quantity: '100.000' },
      { unit: '   ', quantity: '200.000' },
    ])).toEqual([
      { unit: 'KG', quantity: '0.003' },
      { unit: 'L', quantity: '4.000' },
    ])
  })

  it('skips malformed quantities while preserving valid sums and serialization', () => {
    const supplementaryQuantities = accumulateSupplementaryQuantities([
      { unit: 'kg', quantity: '1.250' },
      { unit: 'KG', quantity: 'malformed' },
      { unit: 'kg', quantity: '0.750' },
    ])

    expect(supplementaryQuantities).toEqual([
      { unit: 'KG', quantity: '2.000' },
    ])
    expect(buildAnnualReportCsv(reportWithCommodities([
      {
        commodity: 'wood',
        count: 1,
        quantityKg: '3.000',
        supplementaryQuantities,
      },
    ])).content.split('\n')[1]).toBe('wood,1,3.000,KG,2.000')
  })
})

describe('buildAnnualReportCsv', () => {
  it('serializes the expected header and one row per commodity-unit pair', () => {
    const result = buildAnnualReportCsv(reportWithCommodities([
      {
        commodity: 'wood',
        count: 2,
        quantityKg: '10.000',
        supplementaryQuantities: [
          { unit: 'M3', quantity: '2.500' },
          { unit: 'KG', quantity: '1.000' },
        ],
      },
      {
        commodity: 'cocoa',
        count: 1,
        quantityKg: '3.500',
        supplementaryQuantities: [],
      },
    ]))

    expect(result.contentType).toBe('text/csv; charset=utf-8')
    expect(result.content.split('\n')).toEqual([
      'commodity,count,quantityKg,supplementaryUnit,supplementaryQuantity',
      'wood,2,10.000,M3,2.500',
      'wood,2,10.000,KG,1.000',
      'cocoa,1,3.500,,',
    ])
  })

  it('neutralizes formula-like supplementary units through the shared serializer', () => {
    const result = buildAnnualReportCsv(reportWithCommodities([
      {
        commodity: 'wood',
        count: 1,
        quantityKg: '1.000',
        supplementaryQuantities: [
          { unit: '=HYPERLINK("http://x")', quantity: '1.000' },
          { unit: '+1', quantity: '2.000' },
          { unit: '@cmd', quantity: '3.000' },
        ],
      },
    ]))

    expect(result.content.split('\n').slice(1)).toEqual([
      'wood,1,1.000,"\'=HYPERLINK(""http://x"")",1.000',
      "wood,1,1.000,'+1,2.000",
      "wood,1,1.000,'@cmd,3.000",
    ])
  })

  it('quotes comma and quote characters in string cells', () => {
    const result = buildAnnualReportCsv(reportWithCommodities([
      {
        commodity: 'wood, "premium"',
        count: 1,
        quantityKg: '2.000',
        supplementaryQuantities: [{ unit: 'm,"3"', quantity: '1.000' }],
      },
    ]))

    expect(result.content.split('\n')[1]).toBe('"wood, ""premium""",1,2.000,"m,""3""",1.000')
  })

  it('serializes an empty report with the header only', () => {
    expect(buildAnnualReportCsv(reportWithCommodities([])).content).toBe(
      'commodity,count,quantityKg,supplementaryUnit,supplementaryQuantity',
    )
  })
})
