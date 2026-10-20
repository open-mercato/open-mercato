// `posting_rules.lockFiscalPeriod` — the period-close guard (Invariant 4).
export {}

import { FiscalPeriod } from '../../../ledger/data/entities'
import {
  ORG,
  OTHER_ACCOUNT_ID,
  SOURCE_ACCOUNT_ID,
  TENANT,
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

type Handler = { execute: (input: unknown, ctx: unknown) => Promise<unknown> }

function loadHandler(): Handler {
  let handler: unknown
  jest.isolateModules(() => {
    require('../lockFiscalPeriod')
    handler = registerCommand.mock.calls.find(([candidate]: [{ id: string }]) => candidate.id === 'posting_rules.lockFiscalPeriod')?.[0]
  })
  if (!handler) throw new Error('[internal] posting_rules.lockFiscalPeriod was not registered')
  return handler as Handler
}

const PERIOD_ID = '44444444-4444-4444-8444-444444444444'
const FOREIGN_TENANT = '88888888-8888-4888-8888-888888888888'

function setup() {
  const em = buildFakeEm()
  seedZespol4Account(em, SOURCE_ACCOUNT_ID)
  seedNonZespol4Account(em, OTHER_ACCOUNT_ID)
  seedSettings(em)
  const execute = jest.fn(async (commandId: string, options: { input: { id: string } }) => {
    if (commandId !== 'ledger.lockFiscalPeriod') throw new Error(`[internal] unexpected command ${commandId}`)
    return { result: { id: options.input.id, isLocked: true, updatedAt: '2026-10-01T00:00:00.000Z' }, logEntry: null }
  })
  const ctx = {
    container: { resolve: jest.fn((token: string) => (token === 'em' ? em : token === 'commandBus' ? { execute } : undefined)) },
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG, isSuperAdmin: false },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
  return { em, execute, ctx }
}

function seedPeriod(em: ReturnType<typeof buildFakeEm>, overrides: Record<string, unknown> = {}) {
  em.seed(FiscalPeriod, {
    id: PERIOD_ID,
    organizationId: ORG,
    tenantId: TENANT,
    startDate: new Date('2026-09-01'),
    endDate: new Date('2026-09-30'),
    isLocked: false,
    deletedAt: null,
    ...overrides,
  })
}

const lockInput = { organizationId: ORG, tenantId: TENANT, periodId: PERIOD_ID }

describe('posting_rules.lockFiscalPeriod', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('rejects an unknown period with 404 and never calls ledger.lockFiscalPeriod', async () => {
    const { em, execute, ctx } = setup()
    seedEntry(em, 'entry-oct', [{ id: 'l-oct', accountId: SOURCE_ACCOUNT_ID, debit: '10.00' }], { operationDate: '2026-10-02' })
    await expect(loadHandler().execute(lockInput, ctx)).rejects.toMatchObject({ status: 404 })
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects another tenant\'s period with 404 and never calls ledger.lockFiscalPeriod', async () => {
    const { em, execute, ctx } = setup()
    seedPeriod(em, { tenantId: FOREIGN_TENANT })
    await expect(loadHandler().execute(lockInput, ctx)).rejects.toMatchObject({ status: 404 })
    expect(execute).not.toHaveBeenCalled()
  })
})
