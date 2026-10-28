import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CustomerEntity } from '../../data/entities'

const COMPANY_ID = '11111111-1111-4111-8111-111111111111'

function makeEm() {
  return {
    fork: jest.fn(),
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
  }
}

describe('customers.companies.update prepare (#7032)', () => {
  it('loads the before snapshot on a forked EntityManager, never on the request one', async () => {
    const requestEm = makeEm()
    const snapshotEm = makeEm()
    requestEm.fork.mockReturnValue(snapshotEm)
    const ctx = {
      container: { resolve: (name: string) => (name === 'em' ? requestEm : undefined) },
      auth: null,
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    } as unknown as CommandRuntimeContext

    const handler = commandRegistry.get('customers.companies.update') as CommandHandler<unknown, unknown>
    expect(handler?.prepare).toBeDefined()

    await handler.prepare!({ id: COMPANY_ID, legalName: 'Repro Legal 2' }, ctx)

    expect(requestEm.fork).toHaveBeenCalledTimes(1)
    expect(snapshotEm.findOne).toHaveBeenCalledWith(CustomerEntity, expect.objectContaining({ id: COMPANY_ID }))
    expect(requestEm.findOne).not.toHaveBeenCalled()
  })
})
