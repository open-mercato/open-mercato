import { MetadataStorage } from '@mikro-orm/core'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'

const registerCommand = jest.fn()
const findOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => `${key}|${fallback ?? ''}`,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const TAX_RATE_ID = '55555555-5555-4555-8555-555555555555'
const PRODUCT = {
  id: '44444444-4444-4444-8444-444444444444',
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  taxRateId: null,
  taxRate: null,
}

jest.mock('../shared', () => ({
  ...jest.requireActual('../shared'),
  requireProduct: jest.fn(async () => PRODUCT),
}))

const metadataError = new Error('[internal] Metadata for entity SalesTaxRate not found')

function buildContext() {
  const em = {
    fork: jest.fn(),
    getMetadata: () => new MetadataStorage(),
    findOne: jest.fn().mockRejectedValue(metadataError),
  }
  em.fork.mockReturnValue(em)
  const ctx = {
    container: { resolve: jest.fn((token: string) => (token === 'em' ? em : undefined)) },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
  return { ctx: ctx as unknown as Parameters<CommandHandler['execute']>[1], em }
}

function command(id: string): CommandHandler<Record<string, unknown>, unknown> {
  const handler = registerCommand.mock.calls.map(([cmd]) => cmd).find((cmd) => cmd.id === id)
  if (!handler) throw new Error(`[internal] ${id} not registered`)
  return handler
}

beforeAll(() => {
  require('../products')
  require('../variants')
})

beforeEach(() => {
  findOneWithDecryption.mockReset().mockRejectedValue(metadataError)
})

describe('catalog tax class lookups when the sales module is disabled', () => {
  it('rejects a product tax class with the existing translated 400 instead of querying SalesTaxRate', async () => {
    const { ctx } = buildContext()
    await expect(
      command('catalog.products.create').execute(
        { title: 'Plain product', organizationId: ORG_ID, tenantId: TENANT_ID, taxRateId: TAX_RATE_ID },
        ctx,
      ),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'catalog.products.errors.taxClassNotFound|Tax class not found' },
    })
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('rejects a variant tax class with a translated 400 instead of querying SalesTaxRate', async () => {
    const { ctx, em } = buildContext()
    await expect(
      command('catalog.variants.create').execute(
        { productId: PRODUCT.id, name: 'Plain variant', organizationId: ORG_ID, tenantId: TENANT_ID, taxRateId: TAX_RATE_ID },
        ctx,
      ),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'catalog.products.errors.taxClassNotFound|Tax class not found' },
    })
    expect(em.findOne).not.toHaveBeenCalled()
  })
})
