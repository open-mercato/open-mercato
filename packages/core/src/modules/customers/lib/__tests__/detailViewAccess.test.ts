import { resolveCustomerDetailView } from '../detailViewAccess'

describe('resolveCustomerDetailView', () => {
  const scope = { tenantId: 'tenant', organizationId: 'org' }

  it('applies the scoped grant list independently to aliases and related records', async () => {
    const getGrantedFeatures = jest.fn(async () => ['customers.activities.*'])
    const request = new Request('https://example.invalid/?include=Notes,ADDRESSES,deals&include=tasks')
    const { view, include, cacheAccess } = await resolveCustomerDetailView(
      { getGrantedFeatures }, 'api_key:reader', scope, request,
    )

    expect(getGrantedFeatures).toHaveBeenCalledTimes(1)
    expect(getGrantedFeatures).toHaveBeenCalledWith('api_key:reader', scope)
    expect(include).toEqual(new Set(['addresses', 'comments']))
    expect(view).toEqual({ activities: true, deals: false, interactions: false, people: false })
    expect(cacheAccess).toBe('activities')
  })

  it('allows legacy aliases with their matching view permissions', async () => {
    const getGrantedFeatures = jest.fn(async () => ['customers.*'])
    const request = new Request('https://example.invalid/?include=notes,tasks,people,unknown')
    const { include } = await resolveCustomerDetailView({ getGrantedFeatures }, 'user', scope, request)

    expect(include).toEqual(new Set(['comments', 'people', 'todos']))
  })
})
