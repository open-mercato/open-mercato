export {}

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  buildChanges: jest.fn().mockReturnValue([]),
  requireId: jest.fn((input: Record<string, unknown>) => input.id),
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
  emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/commands/scope', () => ({
  ensureOrganizationScope: jest.fn(),
  ensureSameScope: jest.fn(),
  ensureTenantScope: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/commands/undo', () => ({
  extractUndoPayload: jest.fn().mockReturnValue(null),
}))

jest.mock('@open-mercato/shared/lib/crud/errors', () => {
  class CrudHttpError extends Error {
    status: number
    body: Record<string, unknown>
    constructor(status: number, body: Record<string, unknown>) {
      super(String(body.error ?? 'CrudHttpError'))
      this.status = status
      this.body = body
    }
  }
  return { CrudHttpError, assertFound: jest.fn() }
})

// Delegate findOneWithDecryption to em.findOne so both requireProduct (uses
// em.findOne directly) and command code (uses findOneWithDecryption) are
// controlled through the same em.findOne mock.
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn().mockImplementation(
    (em: Record<string, Function>, entity: unknown, filter: unknown, opts?: unknown) =>
      em.find(entity, filter, opts),
  ),
  findOneWithDecryption: jest.fn().mockImplementation(
    (em: Record<string, Function>, entity: unknown, filter: unknown, opts?: unknown) =>
      em.findOne(entity, filter, opts),
  ),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../../lib/unitResolution', () => ({
  resolveCanonicalUnitCode: jest.fn().mockImplementation(
    async (_em: unknown, params: { unitCode: string }) => params.unitCode,
  ),
}))

const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const CONVERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function createMockEm() {
  const em = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({
      ...payload,
      id: payload.id ?? CONVERSION_ID,
    })),
    remove: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    fork: jest.fn(),
    getReference: jest.fn().mockImplementation((_entity: unknown, id: string) => ({ id })),
  }
  em.fork.mockReturnValue(em)
  return em
}

function createMockCtx(em: ReturnType<typeof createMockEm>) {
  const dataEngine = {
    markOrmEntityChange: jest.fn(),
  }
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'em') return em
      if (token === 'dataEngine') return dataEngine
      return undefined
    }),
  }
  return {
    container,
    auth: {
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: ORG_ID,
    },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
}

function loadCommands() {
  let createCmd: Record<string, unknown> | undefined
  let updateCmd: Record<string, unknown> | undefined
  let deleteCmd: Record<string, unknown> | undefined

  jest.isolateModules(() => {
    require('../productUnitConversions')
    for (const [cmd] of registerCommand.mock.calls as Array<[Record<string, unknown>]>) {
      if (cmd.id === 'catalog.product-unit-conversions.create') createCmd = cmd
      if (cmd.id === 'catalog.product-unit-conversions.update') updateCmd = cmd
      if (cmd.id === 'catalog.product-unit-conversions.delete') deleteCmd = cmd
    }
  })

  return { createCmd, updateCmd, deleteCmd }
}

describe('catalog.product-unit-conversions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  describe('command registration', () => {
    it('registers create, update, and delete commands', () => {
      const { createCmd, updateCmd, deleteCmd } = loadCommands()
      expect(createCmd).toBeDefined()
      expect(updateCmd).toBeDefined()
      expect(deleteCmd).toBeDefined()
    })
  })

  describe('create command', () => {
    it('creates a unit conversion and returns the conversionId', async () => {
      const { createCmd } = loadCommands()
      const em = createMockEm()

      const product = {
        id: PRODUCT_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        deletedAt: null,
      }
      em.findOne.mockResolvedValueOnce(product)

      const ctx = createMockCtx(em)
      const execute = (createCmd as Record<string, Function>).execute

      const result = await execute(
        {
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          productId: PRODUCT_ID,
          unitCode: 'kg',
          toBaseFactor: 1000,
        },
        ctx,
      )

      expect(result).toHaveProperty('conversionId')
      expect(em.create).toHaveBeenCalledTimes(1)
      expect(em.persist).toHaveBeenCalledTimes(1)
      expect(em.flush).toHaveBeenCalledTimes(1)
    })

    it('rejects when toBaseFactor is invalid', async () => {
      const { createCmd } = loadCommands()
      const em = createMockEm()
      const ctx = createMockCtx(em)
      const execute = (createCmd as Record<string, Function>).execute

      await expect(
        execute(
          {
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
            productId: PRODUCT_ID,
            unitCode: 'kg',
            toBaseFactor: null,
          },
          ctx,
        ),
      ).rejects.toThrow()
    })
  })

  describe('update command', () => {
    it('updates an existing conversion', async () => {
      const { updateCmd } = loadCommands()
      const em = createMockEm()

      const existingRecord = {
        id: CONVERSION_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        product: {
          id: PRODUCT_ID,
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          defaultSalesUnit: null,
        },
        unitCode: 'kg',
        toBaseFactor: '1000',
        sortOrder: 0,
        isActive: true,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }
      em.findOne.mockResolvedValueOnce(existingRecord)

      const ctx = createMockCtx(em)
      const execute = (updateCmd as Record<string, Function>).execute

      const result = await execute(
        {
          id: CONVERSION_ID,
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          sortOrder: 5,
        },
        ctx,
      )

      expect(result).toEqual({ conversionId: CONVERSION_ID })
      expect(existingRecord.sortOrder).toBe(5)
      expect(em.flush).toHaveBeenCalledTimes(1)
    })

    it('throws 404 when conversion is not found', async () => {
      const { updateCmd } = loadCommands()
      const em = createMockEm()

      const ctx = createMockCtx(em)
      const execute = (updateCmd as Record<string, Function>).execute

      await expect(
        execute(
          {
            id: CONVERSION_ID,
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
          },
          ctx,
        ),
      ).rejects.toMatchObject({
        status: 404,
      })
    })

    it('rejects deactivating conversion when it matches default sales unit', async () => {
      const { updateCmd } = loadCommands()
      const em = createMockEm()

      const existingRecord = {
        id: CONVERSION_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        product: {
          id: PRODUCT_ID,
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          defaultSalesUnit: 'kg',
        },
        unitCode: 'kg',
        toBaseFactor: '1000',
        sortOrder: 0,
        isActive: true,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }
      em.findOne.mockResolvedValueOnce(existingRecord)

      const ctx = createMockCtx(em)
      const execute = (updateCmd as Record<string, Function>).execute

      await expect(
        execute(
          {
            id: CONVERSION_ID,
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
            isActive: false,
          },
          ctx,
        ),
      ).rejects.toMatchObject({
        status: 409,
        body: { error: 'uom.default_sales_unit_conversion_required' },
      })
    })
  })

  describe('delete command', () => {
    it('deletes an existing conversion', async () => {
      const { deleteCmd } = loadCommands()
      const em = createMockEm()

      const existingRecord = {
        id: CONVERSION_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        product: {
          id: PRODUCT_ID,
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          defaultSalesUnit: null,
        },
        unitCode: 'm2',
        toBaseFactor: '1',
        sortOrder: 0,
        isActive: true,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }
      em.findOne.mockResolvedValueOnce(existingRecord)

      const ctx = createMockCtx(em)
      const execute = (deleteCmd as Record<string, Function>).execute

      const result = await execute(
        {
          id: CONVERSION_ID,
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
        },
        ctx,
      )

      expect(result).toEqual({ conversionId: CONVERSION_ID })
      expect(em.remove).toHaveBeenCalledWith(existingRecord)
      expect(em.flush).toHaveBeenCalledTimes(1)
    })

    it('throws 404 when conversion is not found', async () => {
      const { deleteCmd } = loadCommands()
      const em = createMockEm()

      const ctx = createMockCtx(em)
      const execute = (deleteCmd as Record<string, Function>).execute

      await expect(
        execute(
          {
            id: CONVERSION_ID,
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
          },
          ctx,
        ),
      ).rejects.toMatchObject({
        status: 404,
      })
    })

    it('rejects deleting conversion that matches default sales unit', async () => {
      const { deleteCmd } = loadCommands()
      const em = createMockEm()

      const existingRecord = {
        id: CONVERSION_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        product: {
          id: PRODUCT_ID,
          organizationId: ORG_ID,
          tenantId: TENANT_ID,
          defaultSalesUnit: 'm2',
        },
        unitCode: 'm2',
        toBaseFactor: '1',
        sortOrder: 0,
        isActive: true,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }
      em.findOne.mockResolvedValueOnce(existingRecord)

      const ctx = createMockCtx(em)
      const execute = (deleteCmd as Record<string, Function>).execute

      await expect(
        execute(
          {
            id: CONVERSION_ID,
            organizationId: ORG_ID,
            tenantId: TENANT_ID,
          },
          ctx,
        ),
      ).rejects.toMatchObject({
        status: 409,
        body: { error: 'uom.default_sales_unit_conversion_required' },
      })
    })
  })
})
