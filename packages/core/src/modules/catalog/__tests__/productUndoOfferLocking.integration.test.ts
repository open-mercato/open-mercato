/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { StartedTestContainer } from 'testcontainers'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import {
  CatalogOffer,
  CatalogOptionSchemaTemplate,
  CatalogPriceHistoryEntry,
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductPrice,
  CatalogProductTag,
  CatalogProductTagAssignment,
  CatalogProductUnitConversion,
  CatalogProductVariant,
  CatalogProductVariantRelation,
} from '../data/entities'
import '../commands/products'
import '../commands/offers'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((em: { find: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.find(...args.slice(0, 3))),
  findOneWithDecryption: jest.fn((em: { findOne: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.findOne(...args.slice(0, 3))),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'catalog_offer_undo_lock_test'
const DATABASE_USER = 'catalog_offer_undo_lock'
const DATABASE_PASSWORD = 'catalog_offer_undo_lock'
const CASE_TIMEOUT_MS = 30_000
const WAITER_POLL_MS = 25
const WAITER_TIMEOUT_MS = 10_000

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type Handler = {
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
  undo: (args: { logEntry: unknown; ctx: unknown }) => Promise<void>
}

type OfferState = { id: string; channelId: string; title: string }

type Seed = { tenantId: string; organizationId: string; productId: string; offerId: string; channelId: string }

function handler(id: string): Handler {
  const registered = commandRegistry.get(id) as unknown as Handler | undefined
  if (!registered) throw new Error(`[internal] command ${id} is not registered`)
  return registered
}

function offerSnapshot(seed: Seed, title: string) {
  return {
    id: seed.offerId,
    channelId: seed.channelId,
    title,
    description: null,
    defaultMediaId: null,
    defaultMediaUrl: null,
    metadata: null,
    isActive: true,
  }
}

function productSnapshot(seed: Seed, title: string, offers: ReturnType<typeof offerSnapshot>[]) {
  const now = new Date().toISOString()
  return {
    id: seed.productId,
    organizationId: seed.organizationId,
    tenantId: seed.tenantId,
    title,
    subtitle: null,
    description: null,
    sku: null,
    handle: null,
    taxRateId: null,
    taxRate: null,
    productType: 'simple',
    statusEntryId: null,
    primaryCurrencyCode: null,
    defaultUnit: null,
    defaultSalesUnit: null,
    defaultSalesUnitQuantity: '1',
    uomRoundingScale: 4,
    uomRoundingMode: 'half_up',
    unitPriceEnabled: false,
    weightValue: null,
    weightUnit: null,
    dimensions: null,
    metadata: null,
    customFieldsetCode: null,
    optionSchemaId: null,
    isConfigurable: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    offers,
    categoryIds: [],
    tags: [],
    custom: {},
  }
}

describeWithPostgres('catalog product update undo against a concurrent offer writer on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null
  const dataEngine = new Proxy({}, { get: () => async () => undefined })

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  function catalogCtx(seed: Seed, heldEm: EntityManager | null = null) {
    const root = rootEm()
    return {
      auth: { sub: randomUUID(), tenantId: seed.tenantId, orgId: seed.organizationId, roles: [], isSuperAdmin: false },
      selectedOrganizationId: seed.organizationId,
      organizationScope: null,
      organizationIds: null,
      container: {
        resolve: (name: string) => {
          if (name === 'em') {
            return new Proxy(root, {
              get(object, property) {
                if (property === 'fork' && heldEm) return () => heldEm
                const value = Reflect.get(object, property, object)
                return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(object) : value
              },
            })
          }
          if (name === 'dataEngine') return dataEngine
          return undefined
        },
      } as unknown as AwilixContainer,
    }
  }

  async function seedProduct(offerTitle: string): Promise<Seed> {
    const seed: Seed = {
      tenantId: randomUUID(),
      organizationId: randomUUID(),
      productId: randomUUID(),
      offerId: randomUUID(),
      channelId: randomUUID(),
    }
    const scope = { tenantId: seed.tenantId, organizationId: seed.organizationId }
    const em = rootEm()
    const product = em.create(CatalogProduct, { ...scope, id: seed.productId, title: 'New title', productType: 'simple', isConfigurable: false, isActive: true })
    em.create(CatalogOffer, { ...scope, id: seed.offerId, product, channelId: seed.channelId, title: offerTitle, isActive: true })
    await em.flush()
    return seed
  }

  function undoEntry(seed: Seed, beforeOffers: ReturnType<typeof offerSnapshot>[], afterOffers: ReturnType<typeof offerSnapshot>[]) {
    return {
      commandPayload: {
        undo: {
          before: productSnapshot(seed, 'Old title', beforeOffers),
          after: productSnapshot(seed, 'New title', afterOffers),
        },
      },
    }
  }

  async function readOffers(seed: Seed): Promise<OfferState[]> {
    return rootEm().execute<OfferState[]>(
      'select id, channel_id as "channelId", title from catalog_product_offers where product_id = ? order by id',
      [seed.productId],
    )
  }

  async function waitForLockWaiters(count: number): Promise<void> {
    const deadline = Date.now() + WAITER_TIMEOUT_MS
    while (Date.now() < deadline) {
      const rows = await rootEm().execute<Array<{ waiting: number }>>(
        `select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      )
      if (rows[0].waiting >= count) return
      await new Promise((resolve) => setTimeout(resolve, WAITER_POLL_MS))
    }
    throw new Error(`[internal] no transaction started waiting on a row lock within ${WAITER_TIMEOUT_MS}ms`)
  }

  async function undoAcrossHeldOfferEdit(seed: Seed, logEntry: unknown, editedTitle: string) {
    const writerEm = rootEm()
    await writerEm.begin()
    let committed = false
    try {
      await handler('catalog.offers.update').execute({ id: seed.offerId, title: editedTitle }, catalogCtx(seed, writerEm))
      const undoing = handler('catalog.products.update').undo({ logEntry, ctx: catalogCtx(seed) })
      await waitForLockWaiters(1)
      await writerEm.commit()
      committed = true
      await undoing
    } finally {
      if (!committed) await writerEm.rollback()
    }
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: DATABASE_NAME,
        POSTGRES_USER: DATABASE_USER,
        POSTGRES_PASSWORD: DATABASE_PASSWORD,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: [
        CatalogOptionSchemaTemplate,
        CatalogProduct,
        CatalogProductUnitConversion,
        CatalogProductCategory,
        CatalogProductCategoryAssignment,
        CatalogProductTag,
        CatalogProductTagAssignment,
        CatalogOffer,
        CatalogProductVariant,
        CatalogProductVariantRelation,
        CatalogPriceKind,
        CatalogProductPrice,
        CatalogPriceHistoryEntry,
      ],
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
  }, 30_000)

  it('keeps an offer the update created when it is edited while the undo reads it', async () => {
    const seed = await seedProduct('Created by update')
    const logEntry = undoEntry(seed, [], [offerSnapshot(seed, 'Created by update')])

    await undoAcrossHeldOfferEdit(seed, logEntry, 'Edited during undo')

    expect(await readOffers(seed)).toEqual([{ id: seed.offerId, channelId: seed.channelId, title: 'Edited during undo' }])
    await handler('catalog.products.update').undo({ logEntry, ctx: catalogCtx(seed) })
    expect(await readOffers(seed)).toEqual([{ id: seed.offerId, channelId: seed.channelId, title: 'Edited during undo' }])
  }, CASE_TIMEOUT_MS)

  it('keeps an offer edit made while the undo reads it instead of restoring the old values', async () => {
    const seed = await seedProduct('Updated')
    const logEntry = undoEntry(seed, [offerSnapshot(seed, 'Original')], [offerSnapshot(seed, 'Updated')])

    await undoAcrossHeldOfferEdit(seed, logEntry, 'Edited during undo')

    expect(await readOffers(seed)).toEqual([{ id: seed.offerId, channelId: seed.channelId, title: 'Edited during undo' }])
    await handler('catalog.products.update').undo({ logEntry, ctx: catalogCtx(seed) })
    expect(await readOffers(seed)).toEqual([{ id: seed.offerId, channelId: seed.channelId, title: 'Edited during undo' }])
  }, CASE_TIMEOUT_MS)

  it('still reverts an offer nobody edited after the update', async () => {
    const removed = await seedProduct('Created by update')
    await handler('catalog.products.update').undo({
      logEntry: undoEntry(removed, [], [offerSnapshot(removed, 'Created by update')]),
      ctx: catalogCtx(removed),
    })
    expect(await readOffers(removed)).toEqual([])

    const restored = await seedProduct('Updated')
    await handler('catalog.products.update').undo({
      logEntry: undoEntry(restored, [offerSnapshot(restored, 'Original')], [offerSnapshot(restored, 'Updated')]),
      ctx: catalogCtx(restored),
    })
    expect(await readOffers(restored)).toEqual([{ id: restored.offerId, channelId: restored.channelId, title: 'Original' }])
  }, CASE_TIMEOUT_MS)
})
