import { buildReservationSearchOrFilters } from '../listSearch'

function createCtx(queryImpl: jest.Mock) {
  return {
    auth: { tenantId: 'tenant-1', orgId: 'org-1' },
    selectedOrganizationId: 'org-1',
    organizationIds: ['org-1'],
    container: {
      resolve: (name: string) => {
        if (name === 'queryEngine') return { query: queryImpl }
        throw new Error(`[internal] unexpected resolve: ${name}`)
      },
    },
  } as never
}

describe('buildReservationSearchOrFilters', () => {
  it('matches serial number plus warehouse and variant ids from label search', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ items: [{ id: 'wh-1' }] })
      .mockResolvedValueOnce({ items: [{ id: 'var-1' }, { id: 'var-2' }] })

    const orFilters = await buildReservationSearchOrFilters(
      createCtx(query),
      'Midnight',
      (value) => value.replace(/%/g, '\\%'),
    )

    expect(orFilters).toEqual([
      { serial_number: { $ilike: '%Midnight%' } },
      { warehouse_id: { $in: ['wh-1'] } },
      { catalog_variant_id: { $in: ['var-1', 'var-2'] } },
    ])
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('falls back to serial-only search when label lookups return nothing', async () => {
    const query = jest.fn().mockResolvedValue({ items: [] })

    const orFilters = await buildReservationSearchOrFilters(
      createCtx(query),
      'SN-9',
      (value) => value,
    )

    expect(orFilters).toEqual([{ serial_number: { $ilike: '%SN-9%' } }])
  })
})
