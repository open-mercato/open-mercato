import { dropUnauthorizedDetailIncludes } from '../detailIncludeAccess'

function containerWith(grants: string[]) {
  const userHasAllFeatures = jest.fn(async (_userId: string, required: string[]) =>
    required.every((feature) => grants.includes(feature)),
  )
  return {
    userHasAllFeatures,
    container: { resolve: (name: string) => (name === 'rbacService' ? { userHasAllFeatures } : undefined) },
  }
}

const auth = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-home' }

describe('dropUnauthorizedDetailIncludes', () => {
  it('drops deals when the caller lacks customers.deals.view', async () => {
    const { container } = containerWith(['customers.people.view'])
    const includeTokens = new Set(['deals', 'addresses'])
    await dropUnauthorizedDetailIncludes({ includeTokens, container, auth, scope: null })
    expect(Array.from(includeTokens)).toEqual(['addresses'])
  })

  it('keeps deals and people when the caller holds the matching features', async () => {
    const { container } = containerWith(['customers.deals.view', 'customers.people.view'])
    const includeTokens = new Set(['deals', 'people'])
    await dropUnauthorizedDetailIncludes({ includeTokens, container, auth, scope: null })
    expect(Array.from(includeTokens)).toEqual(['deals', 'people'])
  })

  it('drops people when the caller lacks customers.people.view', async () => {
    const { container } = containerWith(['customers.deals.view'])
    const includeTokens = new Set(['deals', 'people'])
    await dropUnauthorizedDetailIncludes({ includeTokens, container, auth, scope: null })
    expect(Array.from(includeTokens)).toEqual(['deals'])
  })

  it('checks features in the selected organization scope', async () => {
    const { container, userHasAllFeatures } = containerWith(['customers.deals.view'])
    const includeTokens = new Set(['deals'])
    await dropUnauthorizedDetailIncludes({
      includeTokens,
      container,
      auth,
      scope: { tenantId: 'tenant-1', selectedId: 'org-selected' },
    })
    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['customers.deals.view'], {
      tenantId: 'tenant-1',
      organizationId: 'org-selected',
    })
  })

  it('fails closed without a caller subject or rbac service', async () => {
    const includeTokens = new Set(['deals', 'people', 'todos'])
    await dropUnauthorizedDetailIncludes({
      includeTokens,
      container: { resolve: () => undefined },
      auth: { sub: 'user-1', tenantId: 'tenant-1' },
      scope: null,
    })
    expect(Array.from(includeTokens)).toEqual(['todos'])

    const { container, userHasAllFeatures } = containerWith(['customers.deals.view'])
    const anonymousTokens = new Set(['deals'])
    await dropUnauthorizedDetailIncludes({ includeTokens: anonymousTokens, container, auth: { sub: null }, scope: null })
    expect(anonymousTokens.size).toBe(0)
    expect(userHasAllFeatures).not.toHaveBeenCalled()
  })

  it('skips the rbac lookup when no gated include is requested', async () => {
    const { container, userHasAllFeatures } = containerWith([])
    const includeTokens = new Set(['addresses', 'todos'])
    await dropUnauthorizedDetailIncludes({ includeTokens, container, auth, scope: null })
    expect(Array.from(includeTokens)).toEqual(['addresses', 'todos'])
    expect(userHasAllFeatures).not.toHaveBeenCalled()
  })
})
