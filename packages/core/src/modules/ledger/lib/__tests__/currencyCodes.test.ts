import type { EntityManager } from '@mikro-orm/postgresql'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import { currencyCodeOrId, loadCurrencyCodes } from '../currencyCodes'

const PLN_ID = '11111111-1111-4111-8111-111111111111'
const EUR_ID = '22222222-2222-4222-8222-222222222222'
const UNKNOWN_ID = '33333333-3333-4333-8333-333333333333'
const scope = { organizationId: 'org-a', tenantId: 'tenant-a' }

function emReturning(rows: Array<{ id: string; code: unknown }>) {
  const find = jest.fn().mockResolvedValue(rows)
  return { em: { find } as unknown as EntityManager, find }
}

describe('loadCurrencyCodes', () => {
  it('reads each distinct currency once, in the entry organization and tenant', async () => {
    const { em, find } = emReturning([{ id: PLN_ID, code: 'PLN' }, { id: EUR_ID, code: 'EUR' }])

    const codes = await loadCurrencyCodes(em, [PLN_ID, EUR_ID, PLN_ID], scope)

    expect(find).toHaveBeenCalledTimes(1)
    expect(find).toHaveBeenCalledWith(
      Currency,
      { id: { $in: [PLN_ID, EUR_ID] }, organizationId: 'org-a', tenantId: 'tenant-a' },
      { fields: ['id', 'code'] },
    )
    expect([...codes.entries()]).toEqual([[PLN_ID, 'PLN'], [EUR_ID, 'EUR']])
  })

  it('does not filter out soft-deleted currencies, so a posted line keeps its code', async () => {
    const { em, find } = emReturning([{ id: EUR_ID, code: 'EUR' }])

    await loadCurrencyCodes(em, [EUR_ID], scope)

    expect(find.mock.calls[0][1]).not.toHaveProperty('deletedAt')
  })

  it('skips the query when there are no currencies to resolve', async () => {
    const { em, find } = emReturning([])

    const codes = await loadCurrencyCodes(em, ['', ''], scope)

    expect(find).not.toHaveBeenCalled()
    expect(codes.size).toBe(0)
  })

  it('ignores a blank code, so the identifier fallback applies', async () => {
    const { em } = emReturning([{ id: PLN_ID, code: '  ' }, { id: EUR_ID, code: ' EUR ' }])

    const codes = await loadCurrencyCodes(em, [PLN_ID, EUR_ID], scope)

    expect(codes.has(PLN_ID)).toBe(false)
    expect(codes.get(EUR_ID)).toBe('EUR')
  })
})

describe('currencyCodeOrId', () => {
  const codes = new Map([[PLN_ID, 'PLN'], [EUR_ID, 'EUR']])

  it('returns the resolved code', () => {
    expect(currencyCodeOrId(codes, PLN_ID)).toBe('PLN')
    expect(currencyCodeOrId(codes, EUR_ID)).toBe('EUR')
  })

  it('falls back to the identifier when the code cannot be resolved', () => {
    expect(currencyCodeOrId(codes, UNKNOWN_ID)).toBe(UNKNOWN_ID)
    expect(currencyCodeOrId(new Map(), UNKNOWN_ID)).toBe(UNKNOWN_ID)
  })
})
