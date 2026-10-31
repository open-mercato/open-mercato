import { randomUUID } from 'node:crypto'
import { TransactionContext } from '@mikro-orm/core'
import { MikroORM } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { createMemoryStrategy, runWithCacheTenant } from '@open-mercato/cache'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import * as promotionEntities from '@open-mercato/core/modules/promotions/data/entities'
import { PromotionsServiceImpl } from '@open-mercato/core/modules/promotions/lib/promotions-service'
import { PromotionCacheService, buildPromotionTreeCacheKey, buildPromotionUsageCounterCacheKey, invalidatePromotionTreeCache, invalidatePromotionUsageCounterCache } from '@open-mercato/core/modules/promotions/services/promotion-cache'
import * as cartEntities from '../../data/entities'
import { buildPromotionsEffectsPhase } from '../promotionContext'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('cart promotion evaluation with no spare PostgreSQL connection', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM | undefined

  function database(): MikroORM {
    if (!orm) throw new Error('[internal] cart test ORM is not initialized')
    return orm
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_USER: 'cart_test', POSTGRES_PASSWORD: 'cart_test', POSTGRES_DB: 'cart_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .withStartupTimeout(60_000)
      .start()
    orm = await MikroORM.init({
      contextName: 'cart',
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: 'cart_test',
      password: 'cart_test',
      dbName: 'cart_test',
      entities: [...Object.values(promotionEntities), ...Object.values(cartEntities), Currency],
      pool: { min: 0, max: 1 },
      driverOptions: { connectionTimeoutMillis: 1000 },
    })
    await orm.schema.create()
    await orm.em.fork().execute(`
      create table catalog_product_categories (
        id uuid, tenant_id uuid, organization_id uuid, ancestor_ids jsonb, deleted_at timestamp
      );
      create table catalog_product_category_assignments (
        product_id uuid, category_id uuid, tenant_id uuid, organization_id uuid
      );
      create table catalog_product_tag_assignments (
        product_id uuid, tag_id uuid, tenant_id uuid, organization_id uuid
      );
    `)
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  it.each(['commit', 'rollback'] as const)('evaluates category, budget and currency reads inside the cart transaction on %s', async (outcome) => {
    const em = database().em.fork()
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const now = new Date()
    const productId = randomUUID()
    const categoryId = randomUUID()
    await em.execute('insert into catalog_product_categories values (?, ?, ?, ?::jsonb, null)', [
      categoryId, scope.tenantId, scope.organizationId, '[]',
    ])
    await em.execute('insert into catalog_product_category_assignments values (?, ?, ?, ?)', [
      productId, categoryId, scope.tenantId, scope.organizationId,
    ])
    const cart = em.create(cartEntities.Cart, {
      ...scope,
      tokenHash: randomUUID(),
      channel: 'storefront',
      currencyCode: 'USD',
      locale: 'en',
      taxMode: 'net',
      buyerDigest: 'test',
      totals: {},
      totalsComputedAt: now,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    })
    em.persist(cart)
    await em.flush()
    const line = em.create(cartEntities.CartLine, {
      ...scope,
      cartId: cart.id,
      lineNumber: 1,
      productId,
      name: 'Test product',
      quantity: '1',
      unitPriceNet: '10',
      unitPriceGross: '10',
      taxRate: '0',
      pricedAt: now,
      lineTotals: {},
      addedByActorType: 'buyer',
    })
    const promotion = em.create(promotionEntities.Promotion, {
      ...scope, name: 'Test promotion', order: 0, active: true, maxBudget: '100', budgetCurrency: 'USD',
    })
    em.persist([line, promotion, em.create(Currency, {
      ...scope, code: 'USD', name: 'Test currency', decimalPlaces: 3,
      isBase: false, isActive: true, createdAt: now, updatedAt: now,
    })])
    await em.flush()
    const group = em.create(promotionEntities.RuleGroup, { ...scope, promotionId: promotion.id, operator: 'and' })
    em.persist(group)
    await em.flush()
    em.persist([
      em.create(promotionEntities.Rule, {
        ...scope, promotionId: promotion.id, ruleGroupId: group.id, ruleType: 'category',
        config: { operator: 'gte', categoryId, quantity: 1 },
      }),
      em.create(promotionEntities.Benefit, {
        ...scope, promotionId: promotion.id, ruleGroupId: group.id, benefitType: 'product_discount', appliesTo: 'line',
        config: { discountType: 'fixed', value: '0.1234', maxDiscount: null, labels: { en: 'Test benefit' } },
      }),
      em.create(promotionEntities.PromotionUsage, {
        tenantId: scope.tenantId, organizationId: randomUUID(), promotionId: promotion.id,
        orderId: randomUUID(), orderType: 'order', currency: 'USD', totalDiscountAmount: '1000', effectsSnapshot: [],
      }),
    ])
    await em.flush()

    const services: Record<string, unknown> = {
      em: database().em.fork(),
      auth: { tenantId: scope.tenantId, orgId: scope.organizationId },
      salesCalculationService: {},
    }
    const container = {
      resolve<T = unknown>(name: string): T {
        if (!(name in services)) throw new Error(`[internal] unregistered test service ${name}`)
        return services[name] as T
      },
    }
    services.promotionCacheService = new PromotionCacheService(container)
    services.promotionsService = new PromotionsServiceImpl(container)
    const phase = buildPromotionsEffectsPhase({
      em, container, cart, lines: [line], assortmentScope: undefined, tenantScope: scope, now,
      adjustments: [], warnings: [], createdGiftLines: [], removedGiftLines: [],
    })
    const failure = new Error('[internal] roll back the cart mutation')
    const mutation = withAtomicFlush(em, [
      async () => { await em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [`cart:lines:${cart.id}`]) },
      phase,
      async () => {
        expect(Number(line.discountTotalNet)).toBe(-0.123)
        if (outcome === 'rollback') throw failure
      },
    ], { transaction: true })

    if (outcome === 'rollback') await expect(mutation).rejects.toBe(failure)
    else await mutation
    expect(TransactionContext.getEntityManager()).toBeUndefined()
    const reader = database().em.fork()
    const storedLine = await reader.findOneOrFail(cartEntities.CartLine, { id: line.id, ...scope })
    const applications = await reader.count(cartEntities.CartPromotionApplication, { cartId: cart.id, ...scope })
    if (outcome === 'rollback') {
      expect(storedLine.discountTotalNet).toBeNull()
      expect(applications).toBe(0)
    } else {
      expect(Number(storedLine.discountTotalNet)).toBe(-0.123)
      expect(applications).toBe(1)
    }
  })

  it.each([
    ['default', 'request'], ['cart', 'request'], ['default', 'global'], ['cart', 'global'],
  ] as const)('ignores an unrelated %s manager with a registered %s manager', async (name, managerKind) => {
    const unrelated = await MikroORM.init({
      contextName: name, dbName: 'unrelated', entities: [Currency],
    })
    const scope = { tenantId: randomUUID(), orgId: randomUUID() }
    const services: Record<string, unknown> = { em: managerKind === 'global' ? database().em : database().em.fork(), auth: scope }
    const container = { resolve<T = unknown>(key: string): T { return services[key] as T } }
    const service = new PromotionCacheService(container)
    services.promotionCacheService = service
    const facade = new PromotionsServiceImpl(container)
    const foreignRead = jest.spyOn(unrelated.em.getDriver(), 'find').mockRejectedValue(new Error('[internal] unexpected foreign driver read'))
    const foreignLookup = jest.spyOn(unrelated.em.getDriver(), 'findOne').mockRejectedValue(new Error('[internal] unexpected foreign driver lookup'))
    try {
      await TransactionContext.create(unrelated.em.fork(), async () => {
        expect(await service.getActivePromotions(scope.tenantId, scope.orgId)).toEqual([])
        const result = await facade.evaluate({
          items: [], currency: 'USD', evaluatedAt: new Date().toISOString(), codes: [],
          buyer: { customerId: null, customerIds: [], customerGroupIds: [] },
          customerOrderCount: null, cartWeight: null,
        })
        expect(result.appliedPromotions).toEqual([])
        expect(foreignRead).not.toHaveBeenCalled()
        expect(foreignLookup).not.toHaveBeenCalled()
      })
    } finally {
      await unrelated.close(true)
    }
  })

  it.each([
    ['cold', 'commit'], ['cold', 'rollback'], ['warm', 'commit'], ['warm', 'rollback'],
  ] as const)('keeps %s shared cache isolated from promotion changes on %s', async (cacheState, outcome) => {
    const em = database().em.fork()
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const promotion = em.create(promotionEntities.Promotion, {
      ...scope, name: 'Committed promotion', order: 0, active: true, maxBudget: '100', budgetCurrency: 'USD',
    })
    em.persist(promotion)
    await em.flush()
    em.persist(em.create(promotionEntities.RuleGroup, { ...scope, promotionId: promotion.id, operator: 'and' }))
    await em.flush()
    const cache = createMemoryStrategy()
    const services: Record<string, unknown> = { em: database().em.fork(), cache }
    const container = { resolve<T = unknown>(key: string): T { return services[key] as T } }
    const service = new PromotionCacheService(container)
    const treeKey = buildPromotionTreeCacheKey(scope.tenantId, scope.organizationId)
    const counterKey = buildPromotionUsageCounterCacheKey(scope.tenantId, scope.organizationId, promotion.id)
    if (cacheState === 'warm') await service.getActivePromotions(scope.tenantId, scope.organizationId)
    const treeBefore = await runWithCacheTenant(scope.tenantId, () => cache.get(treeKey))
    const counterBefore = await runWithCacheTenant(scope.tenantId, () => cache.get(counterKey))
    const failure = new Error('[internal] discard transactional promotion changes')
    const mutation = TransactionContext.create(em, () => withAtomicFlush(em, [
      () => {
        promotion.name = 'Transaction promotion'
        em.persist(em.create(promotionEntities.PromotionUsage, {
          ...scope, promotionId: promotion.id, orderId: randomUUID(), orderType: 'order',
          currency: 'USD', totalDiscountAmount: '25', effectsSnapshot: [],
        }))
      },
      async () => {
        const current = await service.getActivePromotions(scope.tenantId, scope.organizationId)
        expect(current[0].name).toBe('Transaction promotion')
        expect(Number(current[0].totalDiscountGranted)).toBe(25)
        expect(await runWithCacheTenant(scope.tenantId, () => cache.get(treeKey))).toEqual(treeBefore)
        expect(await runWithCacheTenant(scope.tenantId, () => cache.get(counterKey))).toEqual(counterBefore)
        if (outcome === 'rollback') throw failure
      },
    ], { transaction: true }))
    if (outcome === 'rollback') await expect(mutation).rejects.toBe(failure)
    else {
      await mutation
      await invalidatePromotionTreeCache(cache, scope.tenantId, scope.organizationId)
      await invalidatePromotionUsageCounterCache(cache, scope.tenantId, scope.organizationId, promotion.id)
    }
    const committed = await service.getActivePromotions(scope.tenantId, scope.organizationId)
    expect(committed[0].name).toBe(outcome === 'rollback' ? 'Committed promotion' : 'Transaction promotion')
    expect(Number(committed[0].totalDiscountGranted)).toBe(outcome === 'rollback' ? 0 : 25)
    expect(TransactionContext.getEntityManager('cart')).toBeUndefined()
  })
})
