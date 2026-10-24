import companyLookupWidget from '../widgets/injection/company-lookup/widget'
import integrationStatusWidget from '../widgets/injection/integration-status/widget'
import { injectionTable } from '../widgets/injection-table'

function tableWidgetIds(): string[] {
  return Object.values(injectionTable).flatMap((slot) =>
    (Array.isArray(slot) ? slot : [slot]).map((entry) => (typeof entry === 'string' ? entry : entry.widgetId)),
  )
}

describe('gus_regon injection wiring', () => {
  it('maps every injection-table entry to a declared widget id', () => {
    const declared = new Set([companyLookupWidget.metadata.id, integrationStatusWidget.metadata.id])
    for (const widgetId of tableWidgetIds()) {
      expect(declared.has(widgetId)).toBe(true)
    }
  })

  it('mounts the company card only on the customers companyForm host', () => {
    expect(injectionTable['crud-form:customers.company']).toEqual([
      expect.objectContaining({ widgetId: 'gus_regon.injection.company-lookup' }),
    ])
    expect(Object.keys(injectionTable).sort()).toEqual(['crud-form:customers.company', 'integrations.detail:gus_regon'])
  })
})
