import type { QueryEngine } from '@open-mercato/shared/lib/query/types'

const translations: Record<string, string> = {
  'warranty_claims.search.openClaim': 'Localized open claim',
  'warranty_claims.status.in_review': 'W trakcie przeglądu',
}

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    t: (key: string, fallback: string) => translations[key] ?? fallback,
  })),
}))

import { searchConfig } from '../search'

describe('warranty claims search indexing', () => {
  it('paginates claim lines in stable pages no larger than 100', async () => {
    const query = jest.fn(async (_entityId: string, options: { page: { page: number; pageSize: number } }) => {
      const page = options.page.page
      const items = page === 1
        ? Array.from({ length: 100 }, (_, index) => ({ id: `line-${index + 1}`, line_no: index + 1, sku: `SKU-${index + 1}` }))
        : [{ id: 'line-101', line_no: 101, sku: 'SKU-101' }]
      return { items, total: 101, page, pageSize: options.page.pageSize }
    })
    const entity = searchConfig.entities[0]
    const source = await entity.buildSource?.({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      queryEngine: { query } as unknown as QueryEngine,
      record: { id: 'claim-1', claim_number: 'WTY-1' },
      customFields: {},
    })

    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls.map(([, options]) => options.page)).toEqual([
      { page: 1, pageSize: 100 },
      { page: 2, pageSize: 100 },
    ])
    expect(source?.text).toContain('Line SKU: SKU-101')
  })

  it('writes the awaited localized presenter into the indexed source', async () => {
    const query = jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 100 }))
    const source = await searchConfig.entities[0].buildSource?.({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      queryEngine: { query } as unknown as QueryEngine,
      record: {
        id: 'claim-1',
        claim_number: 'WTY-1',
        customer_name: 'Ada Lovelace',
        claim_type: 'repair',
        status: 'in_review',
      },
      customFields: {},
    })

    expect(source?.presenter?.subtitle).toBe('Ada Lovelace — repair — W trakcie przeglądu')
    expect(source?.presenter?.badge).toBeUndefined()
    expect(source?.links).toEqual([{ href: '/backend/warranty_claims/claim-1', label: 'WTY-1', kind: 'primary' }])
  })

  it('localizes the secondary result action', async () => {
    const links = await searchConfig.entities[0].resolveLinks?.({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      record: { id: 'claim-1' },
      customFields: {},
    })

    expect(links).toEqual([{ href: '/backend/warranty_claims/claim-1', label: 'Localized open claim', kind: 'secondary' }])
  })

  it('renders the localized claim status in the subtitle rather than the unrendered badge', async () => {
    const presenter = await searchConfig.entities[0].formatResult?.({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      record: {
        id: 'claim-1',
        claim_number: 'WTY-1',
        customer_name: 'Ada Lovelace',
        claim_type: 'repair',
        status: 'in_review',
      },
      customFields: {},
    })

    expect(presenter?.subtitle).toBe('Ada Lovelace — repair — W trakcie przeglądu')
    expect(presenter?.badge).toBeUndefined()
  })

  it('omits the status segment when a claim has no status', async () => {
    const presenter = await searchConfig.entities[0].formatResult?.({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      record: { id: 'claim-1', claim_number: 'WTY-1', customer_name: 'Ada Lovelace' },
      customFields: {},
    })

    expect(presenter?.subtitle).toBe('Ada Lovelace')
  })
})
