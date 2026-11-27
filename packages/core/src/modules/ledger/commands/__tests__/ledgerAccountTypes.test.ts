// Unit tests for `ledger.updateLedgerAccountType` when a type is assigned to
// a PL group without a number change (#6340 review of 2026-10-26, N2): the
// type's existing accounts must already start with the type number, or the
// change is refused. Refused rather than cascaded: these accounts have no old
// prefix to swap, so a cascade would mean inventing numbers (decision recorded
// in the #5663 spec, Commands → updateLedgerAccountType).
export {}

import { LedgerAccount, LedgerAccountGroup, LedgerAccountType } from '../../data/entities'
import { buildFakeCtx, buildFakeEm } from './support/fakeEntityManager'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/runCrudCommandWrite', () => ({
  runCrudCommandWrite: jest.fn(async ({ phases }: { phases: Array<() => unknown> }) => {
    for (const phase of phases) await phase()
  }),
}))

const ORG = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'
const PL_GROUP_ID = '33333333-3333-4333-8333-333333333333'
const TYPE_ID = '44444444-4444-4444-8444-444444444444'

type UpdateHandler = { execute: (input: unknown, ctx: unknown) => Promise<{ ledgerAccountTypeId: string }> }

function loadUpdateCommand(): UpdateHandler {
  let handler: unknown
  jest.isolateModules(() => {
    require('../ledgerAccountTypes')
    handler = registerCommand.mock.calls.find(([candidate]) => candidate.id === 'ledger.updateLedgerAccountType')?.[0]
  })
  if (!handler) throw new Error('ledger.updateLedgerAccountType was not registered')
  return handler as UpdateHandler
}

function seedUngroupedTypeWithAccount(em: ReturnType<typeof buildFakeEm>, accountNumber: string) {
  em.seed(LedgerAccountGroup, { id: PL_GROUP_ID, organizationId: ORG, tenantId: TENANT, jurisdiction: 'PL', code: '4' })
  const type = em.seed(LedgerAccountType, {
    id: TYPE_ID,
    organizationId: ORG,
    tenantId: TENANT,
    number: '402',
    name: 'Usługi obce',
    normalBalance: 'DEBIT',
    accountGroupId: null,
    deletedAt: null,
  })
  em.seed(LedgerAccount, {
    id: '55555555-5555-4555-8555-555555555555',
    organizationId: ORG,
    tenantId: TENANT,
    number: accountNumber,
    accountTypeId: TYPE_ID,
    deletedAt: null,
  })
  return type
}

describe('ledger.updateLedgerAccountType — assigning a PL group (N2)', () => {
  beforeEach(() => registerCommand.mockClear())

  it('refuses the group when an existing account does not start with the type number', async () => {
    const em = buildFakeEm()
    const type = seedUngroupedTypeWithAccount(em, '999')
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(loadUpdateCommand().execute({ id: TYPE_ID, accountGroupId: PL_GROUP_ID }, ctx)).rejects.toMatchObject({
      status: 409,
      message: 'ledger.errors.accountTypeGroupAccountsPrefix',
    })
    expect(type.accountGroupId).toBeNull()
  })

  it('accepts the group when every existing account already starts with the type number', async () => {
    const em = buildFakeEm()
    const type = seedUngroupedTypeWithAccount(em, '402-01')
    const { ctx } = buildFakeCtx(em, { organizationId: ORG, tenantId: TENANT })

    await expect(loadUpdateCommand().execute({ id: TYPE_ID, accountGroupId: PL_GROUP_ID }, ctx)).resolves.toEqual({
      ledgerAccountTypeId: TYPE_ID,
    })
    expect(type.accountGroupId).toBe(PL_GROUP_ID)
  })
})
