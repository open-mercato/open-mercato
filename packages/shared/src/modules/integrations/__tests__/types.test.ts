import type * as IntegrationTypes from '../types'

describe('integration registry', () => {
  afterEach(() => {
    jest.requireActual<typeof IntegrationTypes>('../types').clearRegisteredIntegrations()
  })

  it('shares registrations across isolated module instances', () => {
    let firstRegistry: typeof IntegrationTypes | undefined
    let secondRegistry: typeof IntegrationTypes | undefined

    jest.isolateModules(() => {
      firstRegistry = jest.requireActual<typeof IntegrationTypes>('../types')
    })

    firstRegistry?.clearRegisteredIntegrations()
    firstRegistry?.registerIntegration({
      id: 'sync_excel',
      title: 'Excel / CSV Import',
      providerKey: 'excel',
    })

    jest.isolateModules(() => {
      secondRegistry = jest.requireActual<typeof IntegrationTypes>('../types')
    })

    expect(secondRegistry?.getIntegration('sync_excel')?.providerKey).toBe('excel')
  })

  it('clears bundles and integrations from the shared registry state', () => {
    const registry = jest.requireActual<typeof IntegrationTypes>('../types')

    registry.registerIntegration({ id: 'sync_excel', title: 'Excel / CSV Import' })
    registry.registerBundle({
      id: 'bundle_1',
      title: 'Bundle',
      description: 'Bundle description',
      credentials: { fields: [] },
    })

    registry.clearRegisteredIntegrations()

    expect(registry.getAllIntegrations()).toEqual([])
    expect(registry.getAllBundles()).toEqual([])
  })
})
