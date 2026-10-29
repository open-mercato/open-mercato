// Unit tests for `ledger.createLedgerAccount`'s place in the posting lock
// protocol (#6340 review of 2026-10-26, N1): the account type is read with
// `for share` inside the same transaction as the prefix check and the
// insert, as `updateLedgerAccount` already does.
export {}

import { LockMode } from '@mikro-orm/core'
import { LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../../data/entities'
import { buildFakeCtx, buildFakeEm } from './support/fakeEntityManager'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const writeEms: unknown[] = []

jest.mock('@open-mercato/shared/lib/commands/runCrudCommandWrite', () => ({
  runCrudCommandWrite: jest.fn(async ({ em, phases }: { em: unknown; phases: Array<() => unknown> }) => {
    writeEms.push(em)
    for (const phase of phases) await phase()
  }),
}))

const ORG = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'
const GROUP_ID = '33333333-3333-4333-8333-333333333333'
const TYPE_ID = '44444444-4444-4444-8444-444444444444'

type CreateHandler = { execute: (input: unknown, ctx: unknown) => Promise<{ ledgerAccountId: string }> }

function loadCreateCommand(): CreateHandler {
  let handler: unknown
  jest.isolateModules(() => {
    require('../ledgerAccounts')
    handler = registerCommand.mock.calls.find(([candidate]) => candidate.id === 'ledger.createLedgerAccount')?.[0]
  })
  if (!handler) throw new Error('ledger.createLedgerAccount was not registered')
  return handler as CreateHandler
}

function seedPolishType(em: ReturnType<typeof buildFakeEm>) {
  em.seed(LedgerAccountGroup, { id: GROUP_ID, organizationId: ORG, tenantId: TENANT, jurisdiction: 'PL', code: '4' })
  em.seed(LedgerAccountType, {
    id: TYPE_ID,
    organizationId: ORG,
    tenantId: TENANT,
    number: '402',
    name: 'Usługi obce',
    normalBalance: 'DEBIT',
    accountGroupId: GROUP_ID,
    deletedAt: null,
  })
}

describe('ledger.createLedgerAccount — lock protocol (N1)', () => {
  beforeEach(() => {
    registerCommand.mockClear()
    writeEms.length = 0
  })

  it('reads the account type with for share inside the write transaction, before the insert', async () => {
    const em = buildFakeEm()
    seedPolishType(em)
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    const result = await loadCreateCommand().execute(
      { organizationId: ORG, tenantId: TENANT, number: '402-05', accountTypeId: TYPE_ID },
      ctx,
    )

    expect(em.transactional).toHaveBeenCalledTimes(1)
    const typeLock = em.findOne.mock.calls.findIndex(
      ([entity, where, options]) =>
        (entity as { name: string }).name === LedgerAccountType.name &&
        (where as { id?: string }).id === TYPE_ID &&
        (options as { lockMode?: LockMode } | undefined)?.lockMode === LockMode.PESSIMISTIC_READ,
    )
    expect(typeLock).toBe(0)
    expect(writeEms).toEqual([em])
    const created = em.tables.get(LedgerAccount.name) ?? []
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ id: result.ledgerAccountId, number: '402-05', accountTypeId: TYPE_ID })
  })

  it('rejects a number outside the type prefix without writing', async () => {
    const em = buildFakeEm()
    seedPolishType(em)
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(
      loadCreateCommand().execute({ organizationId: ORG, tenantId: TENANT, number: '411-01', accountTypeId: TYPE_ID }, ctx),
    ).rejects.toMatchObject({ status: 400 })
    expect(em.tables.get(LedgerAccount.name) ?? []).toHaveLength(0)
    expect(writeEms).toHaveLength(0)
  })
})
