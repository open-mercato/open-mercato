import { resolveMoneyVisibility, RATES_FEATURE } from '../moneyVisibility'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function container(rbac: unknown) {
  return { resolve: () => rbac }
}

describe('resolveMoneyVisibility', () => {
  it('shows money when the service grants the feature', async () => {
    const rbac = { userHasAllFeatures: jest.fn(async () => true) }
    await expect(resolveMoneyVisibility(container(rbac), 'user-1', scope)).resolves.toBe(true)
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith('user-1', [RATES_FEATURE], scope)
  })

  it('hides money when the service refuses', async () => {
    const rbac = { userHasAllFeatures: async () => false }
    await expect(resolveMoneyVisibility(container(rbac), 'user-1', scope)).resolves.toBe(false)
  })

  it('hides money when the grant read throws', async () => {
    // The regression this exists for: three report routes previously read
    // `grantedFeatures === null || authorize(...)`, so an RBAC outage handed
    // rates and costs to any report viewer. None of those routes requires
    // `rates.view` in its metadata, so nothing else stood in the way.
    const rbac = { userHasAllFeatures: async () => { throw new Error('[internal] rbac down') } }
    await expect(resolveMoneyVisibility(container(rbac), 'user-1', scope)).resolves.toBe(false)
  })

  it('hides money when the service is unavailable', async () => {
    await expect(resolveMoneyVisibility(container(undefined), 'user-1', scope)).resolves.toBe(false)
    await expect(resolveMoneyVisibility(container({}), 'user-1', scope)).resolves.toBe(false)
  })

  it('hides money for an unauthenticated caller', async () => {
    const rbac = { userHasAllFeatures: async () => true }
    await expect(resolveMoneyVisibility(container(rbac), null, scope)).resolves.toBe(false)
  })

  it('authorizes from the service, never from the grant array', async () => {
    // Delegating to `resolveFeatureAccess` must not reintroduce local matching of
    // a grant list: the service is the authority because it is the only path that
    // carries `isSuperAdmin`, and two surfaces reading the array their own way is
    // how the same person got two different answers.
    const rbac = {
      userHasAllFeatures: async () => false,
      getGrantedFeatures: async () => [RATES_FEATURE],
    }
    await expect(resolveMoneyVisibility(container(rbac), 'user-1', scope)).resolves.toBe(false)
  })

  it('keeps money visible when only the grant list read fails', async () => {
    const rbac = {
      userHasAllFeatures: async () => true,
      getGrantedFeatures: async () => { throw new Error('[internal] list unavailable') },
    }
    await expect(resolveMoneyVisibility(container(rbac), 'user-1', scope)).resolves.toBe(true)
  })

  it('never treats a non-boolean answer as permission', async () => {
    const rbac = { userHasAllFeatures: async () => ('yes' as unknown as boolean) }
    await expect(resolveMoneyVisibility(container(rbac), 'user-1', scope)).resolves.toBe(false)
  })
})
