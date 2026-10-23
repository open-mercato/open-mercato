// `posting_rules.reconcileCostRing` with a `periodId` that does not name a
// live fiscal period of the caller's tenant/organization must be rejected,
// not widened into an organization-wide sweep.
export {}

import { FiscalPeriod } from '../../../ledger/data/entities'
import {
  ORG,
  OTHER_ACCOUNT_ID,
  SOURCE_ACCOUNT_ID,
  TENANT,
  buildFakeCommandBus,
  buildFakeEm,
  seedEntry,
  seedNonZespol4Account,
  seedSettings,
  seedZespol4Account,
} from '../../lib/__tests__/support/fixtures'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands'),
  registerCommand,
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))
jest.mock('../../../ledger/events', () => ({ emitLedgerEvent: jest.fn(async () => undefined) }))

type Handler = { execute: (input: unknown, ctx: unknown) => Promise<unknown> }

function loadHandler(): Handler {
  let handler: unknown
  jest.isolateModules(() => {
    require('../reconcileCostRing')
    handler = registerCommand.mock.calls.find(([candidate]: [{ id: string }]) => candidate.id === 'posting_rules.reconcileCostRing')?.[0]
  })
  if (!handler) throw new Error('[internal] posting_rules.reconcileCostRing was not registered')
  return handler as Handler
}

const PERIOD_ID = '44444444-4444-4444-8444-444444444444'
const FOREIGN_ORG = '99999999-9999-4999-8999-999999999999'

function setup() {
  const em = buildFakeEm()
  seedZespol4Account(em, SOURCE_ACCOUNT_ID)
  seedNonZespol4Account(em, OTHER_ACCOUNT_ID)
  seedSettings(em)
  seedEntry(em, 'entry-1', [
    { id: 'line-1', accountId: SOURCE_ACCOUNT_ID, debit: '100.00' },
    { id: 'line-2', accountId: OTHER_ACCOUNT_ID, credit: '100.00' },
  ])
  const bus = buildFakeCommandBus(em)
  const ctx = {
    container: { resolve: jest.fn((token: string) => (token === 'em' ? em : token === 'commandBus' ? bus : undefined)) },
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG, isSuperAdmin: false },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
  return { em, bus, ctx }
}

describe('posting_rules.reconcileCostRing — periodId', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('rejects an unknown period with 404 and posts nothing', async () => {
    const { bus, ctx } = setup()
    await expect(
      loadHandler().execute({ organizationId: ORG, tenantId: TENANT, periodId: PERIOD_ID }, ctx),
    ).rejects.toMatchObject({ status: 404 })
    expect(bus.postCalls).toHaveLength(0)
  })

  it('rejects another organization\'s period with 404 and posts nothing', async () => {
    const { em, bus, ctx } = setup()
    em.seed(FiscalPeriod, {
      id: PERIOD_ID,
      organizationId: FOREIGN_ORG,
      tenantId: TENANT,
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-30'),
      deletedAt: null,
    })
    await expect(
      loadHandler().execute({ organizationId: ORG, tenantId: TENANT, periodId: PERIOD_ID }, ctx),
    ).rejects.toMatchObject({ status: 404 })
    expect(bus.postCalls).toHaveLength(0)
  })
})
