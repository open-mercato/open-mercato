export {}

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('catalog.products.create', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it.each([null, undefined])('preserves firstListedAt %s during creation', async (firstListedAt) => {
    let createCommand: unknown
    jest.isolateModules(() => {
      require('../products')
      createCommand = registerCommand.mock.calls.find(([command]) => command.id === 'catalog.products.create')?.[0]
    })
    const stopAfterCreate = new Error('stop after create')
    const create = jest.fn((_entity: unknown, _payload: Record<string, unknown>) => {
      throw stopAfterCreate
    })
    const em = { create, fork: jest.fn() }
    em.fork.mockReturnValue(em)
    const organizationId = '22222222-2222-4222-8222-222222222222'
    const tenantId = '33333333-3333-4333-8333-333333333333'
    const context = {
      container: { resolve: jest.fn(() => em) },
      auth: { tenantId, orgId: organizationId },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }
    const command = createCommand as { execute: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown> }

    await expect(command.execute({ title: 'Product', organizationId, tenantId, firstListedAt }, context)).rejects.toBe(stopAfterCreate)
    const payload = create.mock.calls[0][1]
    expect(payload.firstListedAt).toEqual(firstListedAt === undefined ? payload.createdAt : null)
  })

  it('invalidates the offers list cache alias on create so a stale offers list is not served after the write (#7721)', async () => {
    let createCommand: any
    jest.isolateModules(() => {
      require('../products')
      createCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.products.create')?.[0]
    })
    expect(createCommand).toBeDefined()

    const afterSnapshot = {
      id: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      gtuCodes: [],
      offers: [
        {
          id: 'offer-1',
          channelId: 'channel-1',
          title: 'New offer',
          isActive: true,
        },
      ],
      tags: [],
      categoryIds: [],
      custom: null,
    }

    const log = await createCommand.buildLog({
      result: { productId: afterSnapshot.id },
      snapshots: { after: afterSnapshot },
    })

    expect(log?.context?.cacheAliases).toEqual(
      expect.arrayContaining(['catalog.product', 'catalog.offer']),
    )
  })
})
