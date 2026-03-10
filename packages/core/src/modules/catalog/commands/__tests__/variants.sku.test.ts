export {}

import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const registerCommand = jest.fn()

const FAKE_PRODUCT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tenantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  taxRateId: null,
  taxRate: null,
}

const FAKE_VARIANT = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  organizationId: FAKE_PRODUCT.organizationId,
  tenantId: FAKE_PRODUCT.tenantId,
  sku: 'SKU-OLD',
  isDefault: false,
  isActive: true,
  product: { id: FAKE_PRODUCT.id },
  deletedAt: null,
  taxRateId: null,
  taxRate: null,
}

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  buildChanges: jest.fn().mockReturnValue([]),
  requireId: jest.fn((input: Record<string, unknown>) => input.id as string),
  parseWithCustomFields: jest.fn((schema: unknown, raw: unknown) => ({ parsed: raw, custom: {} })),
  setCustomFieldsIfAny: jest.fn().mockResolvedValue(undefined),
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
  emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: jest.fn().mockResolvedValue({}),
  buildCustomFieldResetMap: jest.fn().mockReturnValue({}),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn().mockResolvedValue([]),
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    catalog: {
      catalog_product_variant: 'catalog:catalog_product_variant',
      catalog_product_price: 'catalog:catalog_product_price',
      catalog_product: 'catalog:catalog_product',
    },
  },
}))

jest.mock('#generated/entities/catalog_product_variant', () => ({}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
}))

jest.mock('@open-mercato/core/modules/sales/data/entities', () => ({
  SalesTaxRate: class SalesTaxRate {},
}))

jest.mock('../shared', () => ({
  cloneJson: (v: unknown) => JSON.parse(JSON.stringify(v)),
  ensureOrganizationScope: jest.fn(),
  ensureTenantScope: jest.fn(),
  emitCatalogQueryIndexEvent: jest.fn().mockResolvedValue(undefined),
  extractUndoPayload: jest.fn().mockReturnValue(null),
  requireProduct: jest.fn().mockResolvedValue(FAKE_PRODUCT),
  toNumericString: (v: unknown) => (v == null ? null : String(v)),
  randomSuffix: () => 'abc',
  getErrorConstraint: (error: unknown) => {
    const e = error as Record<string, unknown>
    return typeof e.constraint === 'string' ? e.constraint : null
  },
  getErrorMessage: (error: unknown) => {
    const e = error as Record<string, unknown>
    return typeof e.message === 'string' ? e.message : ''
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkuConstraintError(): UniqueConstraintViolationException {
  const err = new UniqueConstraintViolationException(
    new Error('duplicate key value violates unique constraint "catalog_product_variants_sku_unique"')
  )
  ;(err as unknown as Record<string, unknown>).constraint = 'catalog_product_variants_sku_unique'
  return err
}

function makeSkuConstraintErrorMessageOnly(): UniqueConstraintViolationException {
  // constraint property not set — only the message contains the constraint name
  return new UniqueConstraintViolationException(
    new Error('duplicate key value violates unique constraint "catalog_product_variants_sku_unique"')
  )
}

function makeOtherConstraintError(): UniqueConstraintViolationException {
  const err = new UniqueConstraintViolationException(new Error('unique constraint violation "some_other_idx"'))
  ;(err as unknown as Record<string, unknown>).constraint = 'some_other_idx'
  return err
}

function buildEm(flushError?: unknown) {
  const variantRecord = { ...FAKE_VARIANT }
  const em: Record<string, unknown> = {
    findOne: jest.fn().mockImplementation(async (_entity: unknown, filter: Record<string, unknown>) => {
      if (filter?.id === FAKE_VARIANT.id) return variantRecord
      return null
    }),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({
      ...payload,
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      organizationId: FAKE_PRODUCT.organizationId,
      tenantId: FAKE_PRODUCT.tenantId,
      isDefault: payload.isDefault ?? false,
      product: { id: FAKE_PRODUCT.id },
    })),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: flushError
      ? jest.fn().mockRejectedValue(flushError)
      : jest.fn().mockResolvedValue(undefined),
    nativeDelete: jest.fn().mockResolvedValue(0),
    getReference: jest.fn().mockReturnValue(null),
  }
  ;(em as Record<string, unknown>).fork = jest.fn().mockReturnValue(em)
  return em
}

function buildCtx(em: Record<string, unknown>) {
  return {
    container: {
      resolve: jest.fn((token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        return undefined
      }),
    },
    auth: {
      sub: 'user-1',
      tenantId: FAKE_PRODUCT.tenantId,
      orgId: FAKE_PRODUCT.organizationId,
    },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  }
}

async function runCommand(
  command: { execute: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown> },
  input: Record<string, unknown>,
  flushError?: unknown
): Promise<{ result?: unknown; error?: unknown }> {
  const em = buildEm(flushError)
  try {
    const result = await command.execute(input, buildCtx(em))
    return { result }
  } catch (error) {
    return { error }
  }
}

// ---------------------------------------------------------------------------
// Load commands — top-level mocks are already in place; no isolateModules
// needed so instanceof checks work against the same class registry.
// ---------------------------------------------------------------------------

let createCommand: { execute: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown> }
let updateCommand: { execute: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown> }

beforeAll(() => {
  require('../variants')
  createCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.variants.create')?.[0]
  updateCommand = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'catalog.variants.update')?.[0]
})

const CREATE_INPUT = {
  productId: FAKE_PRODUCT.id,
  organizationId: FAKE_PRODUCT.organizationId,
  tenantId: FAKE_PRODUCT.tenantId,
  sku: '123',
}

const UPDATE_INPUT = {
  id: FAKE_VARIANT.id,
  organizationId: FAKE_PRODUCT.organizationId,
  tenantId: FAKE_PRODUCT.tenantId,
  sku: '123',
}

// ---------------------------------------------------------------------------
// createVariantCommand — SKU uniqueness
// ---------------------------------------------------------------------------

describe('createVariantCommand — SKU uniqueness handling', () => {
  it('throws CrudHttpError 400 with fieldErrors.sku when flush fails with SKU constraint via constraint property', async () => {
    expect(createCommand).toBeDefined()
    const { error } = await runCommand(createCommand, CREATE_INPUT, makeSkuConstraintError())
    expect(error).toBeInstanceOf(CrudHttpError)
    expect((error as CrudHttpError).status).toBe(400)
    expect(((error as CrudHttpError).body as Record<string, Record<string, string>>).fieldErrors?.sku).toBeDefined()
  })

  it('throws CrudHttpError 400 with fieldErrors.sku when constraint name is only in error message', async () => {
    expect(createCommand).toBeDefined()
    const { error } = await runCommand(createCommand, CREATE_INPUT, makeSkuConstraintErrorMessageOnly())
    expect(error).toBeInstanceOf(CrudHttpError)
    expect((error as CrudHttpError).status).toBe(400)
    expect(((error as CrudHttpError).body as Record<string, Record<string, string>>).fieldErrors?.sku).toBeDefined()
  })

  it('rethrows unrelated UniqueConstraintViolationException unchanged', async () => {
    expect(createCommand).toBeDefined()
    const otherError = makeOtherConstraintError()
    const { error } = await runCommand(createCommand, CREATE_INPUT, otherError)
    expect(error).toBe(otherError)
  })

  it('rethrows plain non-ORM error unchanged', async () => {
    expect(createCommand).toBeDefined()
    const plainError = new Error('unexpected db failure')
    const { error } = await runCommand(createCommand, CREATE_INPUT, plainError)
    expect(error).toBe(plainError)
  })
})

// ---------------------------------------------------------------------------
// updateVariantCommand — SKU uniqueness
// ---------------------------------------------------------------------------

describe('updateVariantCommand — SKU uniqueness handling', () => {
  it('throws CrudHttpError 400 with fieldErrors.sku when flush fails with SKU constraint', async () => {
    expect(updateCommand).toBeDefined()
    const { error } = await runCommand(updateCommand, UPDATE_INPUT, makeSkuConstraintError())
    expect(error).toBeInstanceOf(CrudHttpError)
    expect((error as CrudHttpError).status).toBe(400)
    expect(((error as CrudHttpError).body as Record<string, Record<string, string>>).fieldErrors?.sku).toBeDefined()
  })

  it('rethrows unrelated UniqueConstraintViolationException unchanged', async () => {
    expect(updateCommand).toBeDefined()
    const otherError = makeOtherConstraintError()
    const { error } = await runCommand(updateCommand, UPDATE_INPUT, otherError)
    expect(error).toBe(otherError)
  })

  it('rethrows plain non-ORM error unchanged', async () => {
    expect(updateCommand).toBeDefined()
    const plainError = new Error('unexpected db failure')
    const { error } = await runCommand(updateCommand, UPDATE_INPUT, plainError)
    expect(error).toBe(plainError)
  })
})
