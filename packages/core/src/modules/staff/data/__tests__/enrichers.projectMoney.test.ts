/** @jest-environment node */
const mockComputeProjectFinancials = jest.fn()
const mockResolveProjectAmountDecimalPlaces = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async () => null),
}))

jest.mock('../../lib/timesheets-projects/computeProjectHoursTrend', () => ({
  computeProjectHoursTrend: jest.fn(async () => new Map()),
}))

jest.mock('../../lib/timesheets-projects/computeProjectFinancials', () => ({
  computeProjectFinancials: (...args: unknown[]) => mockComputeProjectFinancials(...args),
  resolveProjectAmountDecimalPlaces: (...args: unknown[]) => mockResolveProjectAmountDecimalPlaces(...args),
}))

jest.mock('../../lib/timesheets-projects/listProjectMembersPreview', () => ({
  listProjectMembersPreview: jest.fn(async () => new Map()),
}))

import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { enrichers } from '../enrichers'

const PROJECT_ID = 'project-1'
const portfolioEnricher = enrichers.find((enricher) => enricher.id === 'staff.timesheets-projects-portfolio')!

type PortfolioMoney = {
  hourlyRate?: number | null
  hourlyRateExact?: string | null
  cost?: number | null
  costExact?: string | null
}

function context(canSeeRates: boolean): EnricherContext {
  const project = { id: PROJECT_ID, hourlyRate: '1234567890123456789.1200', currencyCode: 'KWD', customerSnapshot: null }
  return {
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    em: { fork: () => ({ find: async () => [project] }) },
    container: {
      resolve: (name: string) => {
        if (name === 'rbacService') {
          return {
            userHasAllFeatures: async (_userId: string, features: string[]) =>
              canSeeRates || !features.includes('staff.timesheets.rates.view'),
          }
        }
        return undefined
      },
    },
  } as unknown as EnricherContext
}

describe('staff.timesheets-projects-portfolio money', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveProjectAmountDecimalPlaces.mockResolvedValue({ [PROJECT_ID]: 3 })
    mockComputeProjectFinancials.mockResolvedValue(
      new Map([
        [
          PROJECT_ID,
          { totalMinutes: 60, billableMinutes: 60, cost: 1234567890123456789.12, costExact: '1234567890123456789.12' },
        ],
      ]),
    )
  })

  it('publishes exact rate and cost strings beside the floats for a holder of the rates feature', async () => {
    const [row] = await portfolioEnricher.enrichMany!([{ id: PROJECT_ID }], context(true))
    const money = (row as { _staff: PortfolioMoney })._staff

    expect(money).toMatchObject({
      hourlyRate: 1234567890123456789.12,
      hourlyRateExact: '1234567890123456789.12',
      cost: 1234567890123456789.12,
      costExact: '1234567890123456789.12',
    })
    expect(mockResolveProjectAmountDecimalPlaces).toHaveBeenCalledTimes(1)
    expect(mockComputeProjectFinancials).toHaveBeenCalledWith(
      expect.objectContaining({ amountDecimalPlacesByProjectId: { [PROJECT_ID]: 3 } }),
    )
  })

  it('omits every money field, exact ones included, and skips the currency lookup without the rates feature', async () => {
    const [row] = await portfolioEnricher.enrichMany!([{ id: PROJECT_ID }], context(false))
    const money = (row as { _staff: PortfolioMoney })._staff

    for (const key of ['hourlyRate', 'hourlyRateExact', 'cost', 'costExact']) {
      expect(money).not.toHaveProperty(key)
    }
    expect(mockResolveProjectAmountDecimalPlaces).not.toHaveBeenCalled()
    expect(mockComputeProjectFinancials).toHaveBeenCalledWith(
      expect.objectContaining({ amountDecimalPlacesByProjectId: {} }),
    )
  })
})
