/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTimeEntry, StaffTimeProject } from '../../../data/entities'
import { decorateTimeEntryRows } from '../timeEntryDecoration'

const tenantId = 'tenant-1'
const organizationId = 'org-1'

function createEm(): EntityManager {
  const find = async (entity: unknown) => {
    if (entity === StaffTimeEntry) {
      return [
        { id: 'e-jpy', rateOverrideAmount: null, rateCurrencyCode: null },
        { id: 'e-kwd', rateOverrideAmount: '123.4567', rateCurrencyCode: 'KWD' },
      ]
    }
    if (entity === StaffTimeProject) {
      return [{ id: 'p-jpy', hourlyRate: '12345678901234.567', currencyCode: 'JPY' }]
    }
    return []
  }
  return { fork: () => ({ find }) } as unknown as EntityManager
}

const container = {
  resolve: <T,>(name: string): T => {
    throw new Error(`[internal] ${name} is not registered`)
  },
}

function rows() {
  return [
    { id: 'e-jpy', time_project_id: 'p-jpy', rounded_minutes: 7, is_billable: true },
    { id: 'e-kwd', time_project_id: 'p-jpy', rounded_minutes: 7, is_billable: true },
  ]
}

describe('decorateTimeEntryRows cost', () => {
  it('rounds each entry cost to its currency decimals and keeps the rate exact', async () => {
    const decorated: Record<string, unknown>[] = rows()
    await decorateTimeEntryRows(decorated, { em: createEm(), tenantId, organizationId, canSeeRates: true, container })
    expect(decorated[0]).toMatchObject({ currencyCode: 'JPY', cost: 1440329205144 })
    expect(decorated[1]).toMatchObject({ currencyCode: 'KWD', cost: 14.403 })
  })

  it('falls back to 2 decimals without a container', async () => {
    const decorated: Record<string, unknown>[] = rows()
    await decorateTimeEntryRows(decorated, { em: createEm(), tenantId, organizationId, canSeeRates: true })
    expect(decorated[1]).toMatchObject({ cost: 14.4 })
  })
})

describe('decorateTimeEntryRows costExact', () => {
  it('publishes the exact cost string beside the float cost', async () => {
    const decorated: Record<string, unknown>[] = rows()
    await decorateTimeEntryRows(decorated, { em: createEm(), tenantId, organizationId, canSeeRates: true, container })
    expect(decorated[0]).toMatchObject({ cost: 1440329205144, costExact: '1440329205144' })
    expect(decorated[1]).toMatchObject({ cost: 14.403, costExact: '14.403' })
  })

  it('keeps digits beyond float precision in costExact', async () => {
    const em = {
      fork: () => ({
        find: async (entity: unknown) => {
          if (entity === StaffTimeEntry) {
            return [{ id: 'e-big', rateOverrideAmount: '1234567890123456789.12', rateCurrencyCode: 'KWD' }]
          }
          if (entity === StaffTimeProject) return [{ id: 'p-jpy', hourlyRate: null, currencyCode: 'JPY' }]
          return []
        },
      }),
    } as unknown as EntityManager
    const decorated: Record<string, unknown>[] = [
      { id: 'e-big', time_project_id: 'p-jpy', rounded_minutes: 60, is_billable: true },
    ]
    await decorateTimeEntryRows(decorated, { em, tenantId, organizationId, canSeeRates: true, container })
    expect(decorated[0].costExact).toBe('1234567890123456789.12')
    expect(decorated[0].cost).toBe(1234567890123456789.12)
  })

  it('gives a non-billable entry a null costExact, like its cost', async () => {
    const decorated: Record<string, unknown>[] = [
      { id: 'e-jpy', time_project_id: 'p-jpy', rounded_minutes: 7, is_billable: false },
    ]
    await decorateTimeEntryRows(decorated, { em: createEm(), tenantId, organizationId, canSeeRates: true, container })
    expect(decorated[0]).toMatchObject({ cost: null, costExact: null })
  })

  it('adds neither cost nor costExact for a caller without the rates feature', async () => {
    const decorated: Record<string, unknown>[] = rows()
    await decorateTimeEntryRows(decorated, { em: createEm(), tenantId, organizationId, canSeeRates: false, container })
    for (const row of decorated) {
      expect(row).not.toHaveProperty('cost')
      expect(row).not.toHaveProperty('costExact')
    }
  })
})
