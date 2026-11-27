const syncAgentPrincipalsMock = jest.fn(async () => ({ synced: 0 }))
const listAgentEntriesMock = jest.fn(() => [{ id: 'deals.health_check' }])

jest.mock('../lib/identity/syncAgentPrincipals', () => ({
  syncAgentPrincipals: (...args: unknown[]) => syncAgentPrincipalsMock(...(args as [])),
}))

jest.mock('../lib/sdk/defineAgent', () => ({
  ensureAgentsLoaded: jest.fn(async () => undefined),
  listAgentEntries: () => listAgentEntriesMock(),
}))

import { setup } from '../setup'

function makeContainer() {
  return {
    hasRegistration: () => false,
    resolve: (name: string) => {
      throw new Error(`[internal] unexpected registration: ${name}`)
    },
  }
}

describe('agent_orchestrator setup principals', () => {
  beforeEach(() => {
    syncAgentPrincipalsMock.mockClear()
  })

  it('syncs declared agent principals for an organization created after tenant init', async () => {
    const container = makeContainer()

    await setup.onOrganizationCreated?.({
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-2',
    } as never)

    expect(syncAgentPrincipalsMock).toHaveBeenCalledWith(
      container,
      { tenantId: 'tenant-1', organizationId: 'organization-2' },
      { agents: [{ id: 'deals.health_check' }] },
    )
  })

  it('does not abort organization creation when the principal sync fails', async () => {
    syncAgentPrincipalsMock.mockRejectedValueOnce(new Error('db down'))

    await expect(
      setup.onOrganizationCreated?.({
        container: makeContainer(),
        tenantId: 'tenant-1',
        organizationId: 'organization-3',
      } as never),
    ).resolves.toBeUndefined()
  })
})
