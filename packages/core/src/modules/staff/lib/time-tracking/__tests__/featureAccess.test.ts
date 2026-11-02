import { resolveFeatureAccess } from '../featureAccess'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const container = (rbac: unknown) => ({ resolve: () => rbac })

describe('resolveFeatureAccess', () => {
  it('answers from the service and returns the grants alongside', async () => {
    const rbac = {
      userHasAllFeatures: async () => true,
      getGrantedFeatures: async () => ['staff.*'],
    }
    await expect(resolveFeatureAccess(container(rbac), 'u1', ['staff.x'], scope)).resolves.toEqual({
      allowed: true,
      grantedFeatures: ['staff.*'],
      resolved: true,
    })
  })

  it('denies when the check throws, and says it could not resolve', async () => {
    // The regression: nine call sites used to swallow this into an empty array,
    // so a manager was silently demoted to their own project memberships and
    // nothing anywhere recorded why.
    const rbac = {
      userHasAllFeatures: async () => { throw new Error('[internal] rbac down') },
      getGrantedFeatures: async () => ['staff.*'],
    }
    const access = await resolveFeatureAccess(container(rbac), 'u1', ['staff.x'], scope)
    expect(access).toEqual({ allowed: false, grantedFeatures: [], resolved: false })
  })

  it('keeps the decision when only the grant list fails', async () => {
    // The list is a convenience for guards and enrichers; losing it must not
    // change who is allowed to do what.
    const rbac = {
      userHasAllFeatures: async () => true,
      getGrantedFeatures: async () => { throw new Error('[internal] list unavailable') },
    }
    const access = await resolveFeatureAccess(container(rbac), 'u1', ['staff.x'], scope)
    expect(access.allowed).toBe(true)
    expect(access.resolved).toBe(false)
    expect(access.grantedFeatures).toEqual([])
  })

  it('will not call an empty grant list an answer when the service cannot produce one', async () => {
    // `resolved` exists to separate "RBAC said nothing was granted" from "RBAC was
    // never asked". A service without `getGrantedFeatures` is the second case, so
    // reporting it as the first would hand a caller a fabricated authoritative
    // empty list. The decision itself is unaffected — it came from the service.
    const rbac = { userHasAllFeatures: async () => true }
    const access = await resolveFeatureAccess(container(rbac), 'u1', ['staff.x'], scope)
    expect(access).toEqual({ allowed: true, grantedFeatures: [], resolved: false })
  })

  it('denies when the service cannot answer at all', async () => {
    await expect(resolveFeatureAccess(container({}), 'u1', ['staff.x'], scope)).resolves.toMatchObject({
      allowed: false,
      resolved: false,
    })
    await expect(resolveFeatureAccess(container(undefined), 'u1', ['staff.x'], scope)).resolves.toMatchObject({
      allowed: false,
    })
  })

  it('denies an unauthenticated caller, and that is a resolved answer', async () => {
    // No user is a definite "no", not a failed lookup — the distinction is the
    // whole reason `resolved` exists.
    const access = await resolveFeatureAccess(container({ userHasAllFeatures: async () => true }), null, ['x'], scope)
    expect(access).toEqual({ allowed: false, grantedFeatures: [], resolved: true })
  })

  it('never reads a non-boolean answer as permission', async () => {
    const rbac = { userHasAllFeatures: async () => ('yes' as unknown as boolean) }
    await expect(resolveFeatureAccess(container(rbac), 'u1', ['x'], scope)).resolves.toMatchObject({ allowed: false })
  })

  it('denies when resolving the container throws', async () => {
    const bad = { resolve: () => { throw new Error('[internal] no container') } }
    await expect(resolveFeatureAccess(bad, 'u1', ['x'], scope)).resolves.toMatchObject({ allowed: false, resolved: false })
  })
})
