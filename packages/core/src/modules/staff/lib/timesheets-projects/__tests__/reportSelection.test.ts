import { resolveReportSelection, type ReportSelectionProject } from '../reportSelection'

function project(overrides: Partial<ReportSelectionProject> = {}): ReportSelectionProject {
  return {
    id: 'p1',
    name: 'Nordvik — migracja B2B',
    customerId: 'c1',
    customerName: 'Nordvik Retail AB',
    currencyCode: 'PLN',
    ...overrides,
  }
}

describe('resolveReportSelection', () => {
  it('blocks an empty selection', () => {
    expect(resolveReportSelection([])).toEqual({ ok: false, reason: 'empty', offenders: [] })
  })

  it('allows a single project', () => {
    const result = resolveReportSelection([project()])
    expect(result).toMatchObject({ ok: true, customerId: 'c1', currencyCode: 'PLN', projectIds: ['p1'] })
  })

  it('allows several projects of the same customer and currency', () => {
    const result = resolveReportSelection([
      project(),
      project({ id: 'p2', name: 'Nordvik — utrzymanie' }),
    ])
    expect(result).toMatchObject({ ok: true, customerId: 'c1', projectIds: ['p1', 'p2'] })
  })

  it('blocks a selection spanning two customers and names them', () => {
    const result = resolveReportSelection([
      project(),
      project({ id: 'p2', customerId: 'c2', customerName: 'Grupa Ambra' }),
    ])
    expect(result).toEqual({
      ok: false,
      reason: 'multiple_customers',
      offenders: ['Nordvik Retail AB', 'Grupa Ambra'],
    })
  })

  it('blocks a selection spanning two currencies and names them', () => {
    const result = resolveReportSelection([
      project(),
      project({ id: 'p2', currencyCode: 'EUR' }),
    ])
    expect(result).toEqual({ ok: false, reason: 'multiple_currencies', offenders: ['PLN', 'EUR'] })
  })

  it('blocks a selection containing a project without a customer and names it', () => {
    const result = resolveReportSelection([
      project(),
      project({ id: 'p2', name: 'Projekt wewnętrzny', customerId: null, customerName: null }),
    ])
    expect(result).toEqual({
      ok: false,
      reason: 'missing_customer',
      offenders: ['Projekt wewnętrzny'],
    })
  })

  it('ignores projects with no currency set when checking currencies', () => {
    const result = resolveReportSelection([
      project(),
      project({ id: 'p2', currencyCode: null }),
    ])
    expect(result).toMatchObject({ ok: true, currencyCode: 'PLN' })
  })

  it('falls back to the customer id when the snapshot has no name', () => {
    const result = resolveReportSelection([
      project({ customerName: null }),
      project({ id: 'p2', customerId: 'c2', customerName: null }),
    ])
    expect(result).toEqual({ ok: false, reason: 'multiple_customers', offenders: ['c1', 'c2'] })
  })
})
