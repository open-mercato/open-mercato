/**
 * Shared real-PostgreSQL harness for the cart real-command race suites (#9183 scenarios 1/2).
 * The suites that import it drive the REAL registered commands (`cart.lock`,
 * `cart.lines.update`/`.remove`, `cart.proposal.accept` -> `cart.merge` -> `cart.reprice`)
 * through the REAL `CommandBus`, each call on its own request-scoped container and forked
 * `EntityManager`, against a real database. Nothing here re-implements a lock key or a
 * conditional update: every advisory lock, row lock and guarded `nativeUpdate` a test
 * observes is taken by production code.
 *
 * Real, as production wires it:
 * - `em`: a fork of a real MikroORM `EntityManager` per request container, like
 *   `createRequestContainer()`; the cart, catalog and customer_groups tables come from the
 *   entity metadata;
 * - `commandBus`: `CommandBus` itself (handler lookup, interceptors, post-commit cache and
 *   side-effect flush). It is subclassed only to add the `before:<id>`/`after:<id>`
 *   checkpoints described below;
 * - `catalogBuyerPricingService` (`DefaultCatalogBuyerPricingService` over
 *   `DefaultCatalogPricingService`), `catalogScopedProductService`
 *   (`DefaultCatalogScopedProductService`) and `salesCalculationService`
 *   (`DefaultSalesCalculationService`), reading and pricing the seeded catalog rows;
 * - customer_groups, registered through its own `di.ts`: terms resolution feeds
 *   `Cart.requiresApproval`, and `customerPurchaseApprovalServiceFactory` builds the real
 *   approval service `cart.lock`'s approval gate reads inside its transaction.
 *
 * Stubbed or absent, and why that cannot hide a locking bug:
 * - `promotionsService`: a "no promotion applies" evaluator (`appliedPromotions: []`). The
 *   promotions engine has its own tables, cache and rule tree, and no cart lock depends on
 *   its result. Its `evaluate` call runs inside every cart write transaction (after the
 *   line-mutation guard), which makes it the in-transaction pause point.
 * - `dataEngine`: a sink. It only receives CRUD/index side effects, which run after commit.
 * - `actionLogService`, `cache`, the event bus: unregistered. `CommandBus` skips audit
 *   logging and cache invalidation when they are absent, and `emitCartEvent` logs instead
 *   of publishing. All three run after the write transaction commits.
 * - `policyResolutionService`: unregistered (availability is a soft peer of cart), so
 *   quantity rules come from the catalog product alone.
 *
 * Checkpoints are the only orchestration. A test arms a named checkpoint; the next call
 * that reaches it signals `reached` and blocks until the test calls `release()`. They sit
 * at real call boundaries between production steps: around a command-bus dispatch, and on
 * peer-service calls (`promotions.evaluate`, `pricing.resolveLinePrice`,
 * `catalog.loadScopedProducts`, `approval.getApproval`). Waiting on the database is
 * observed through `pg_stat_activity` (`waitForLockWaiters`), never through sleeps.
 *
 * Database: `OM_CART_PG_URL` names a throwaway database explicitly; otherwise, under
 * `OM_PG_INTEGRATION=1` (the `test:pg-integration` CI job), each suite starts its own
 * disposable Postgres container. The schema is refreshed on start, so never point
 * `OM_CART_PG_URL` at a development or shared database.
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { asValue, createContainer, type AwilixContainer } from 'awilix'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import {
  CommandBus,
  type CommandExecuteResult,
  type CommandExecutionOptions,
  type CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
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
} from '../../../../catalog/data/entities'
import { DefaultCatalogPricingService } from '../../../../catalog/services/catalogPricingService'
import {
  DefaultCatalogBuyerPricingService,
  type CatalogBuyerPricingService,
} from '../../../../catalog/services/catalogBuyerPricingService'
import {
  DefaultCatalogScopedProductService,
  type CatalogScopedProductService,
} from '../../../../catalog/services/catalogScopedProductService'
import { DefaultSalesCalculationService } from '../../../../sales/services/salesCalculationService'
import {
  CustomerCreditAccount,
  CustomerCreditLedgerEntry,
  CustomerGroup,
  CustomerGroupMembership,
  CustomerGroupTerms,
  CustomerPurchaseApproval,
} from '../../../../customer_groups/data/entities'
import { register as registerCustomerGroupsDi } from '../../../../customer_groups/di'
import type { CustomerPurchaseApprovalService } from '../../../../customer_groups/services/customerPurchaseApprovalService'
import type { PromotionsService } from '../../../../promotions/lib/types'
import { Cart, CartIdempotencyKey, CartLine, CartMergeLog, CartPromotionApplication } from '../../../data/entities'
import type { ResolvedCartRouteContext } from '../../../lib/routeContext'
import { signAcceptanceToken } from '../../../lib/acceptanceToken'
import '../../cart'
import '../../lines'
import '../../lock'
import '../../merge'
import '../../proposal'

const EXPLICIT_URL = process.env.OM_CART_PG_URL ?? ''

export const cartRacesRunAgainstPostgres = Boolean(EXPLICIT_URL) || process.env.OM_PG_INTEGRATION === '1'

export type TenantScope = { tenantId: string; organizationId: string }

export type CheckpointName =
  | 'promotions.evaluate'
  | 'pricing.resolveLinePrice'
  | 'catalog.loadScopedProducts'
  | 'approval.getApproval'
  | `before:${string}`
  | `after:${string}`

export type ArmedCheckpoint = {
  /** Resolves once a call reaches the checkpoint (that call is now blocked). */
  reached: Promise<void>
  /** Lets the blocked call continue. */
  release: () => void
}

type PendingCheckpoint = { name: CheckpointName; signalReached: () => void; released: Promise<void>; release: () => void }

export class CheckpointRegistry {
  private readonly armed = new Map<CheckpointName, PendingCheckpoint[]>()
  private readonly issued: PendingCheckpoint[] = []

  arm(name: CheckpointName): ArmedCheckpoint {
    let signalReached: () => void = () => undefined
    let release: () => void = () => undefined
    const reached = new Promise<void>((resolve) => {
      signalReached = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending: PendingCheckpoint = { name, signalReached, released, release }
    const queue = this.armed.get(name) ?? []
    queue.push(pending)
    this.armed.set(name, queue)
    this.issued.push(pending)
    return { reached, release }
  }

  async pass(name: CheckpointName): Promise<void> {
    const queue = this.armed.get(name)
    const next = queue?.shift()
    if (!next) return
    next.signalReached()
    await next.released
  }

  /**
   * Teardown: releases every checkpoint this test armed (so a call a failed assertion left
   * blocked can finish and give its connection back) and returns the names of those that
   * were armed but never reached.
   */
  releaseAll(): CheckpointName[] {
    const unreached = Array.from(this.armed.values()).flatMap((queue) => queue.map((pending) => pending.name))
    for (const pending of this.issued) pending.release()
    this.issued.length = 0
    this.armed.clear()
    return unreached
  }
}

class CheckpointedCommandBus extends CommandBus {
  constructor(private readonly checkpoints: CheckpointRegistry) {
    super()
  }

  override async execute<TInput = unknown, TResult = unknown>(
    commandId: string,
    options: CommandExecutionOptions<TInput>,
  ): Promise<CommandExecuteResult<TResult>> {
    await this.checkpoints.pass(`before:${commandId}`)
    const outcome = await super.execute<TInput, TResult>(commandId, options)
    await this.checkpoints.pass(`after:${commandId}`)
    return outcome
  }
}

class CheckpointedBuyerPricingService implements CatalogBuyerPricingService {
  constructor(
    private readonly inner: CatalogBuyerPricingService,
    private readonly checkpoints: CheckpointRegistry,
  ) {}

  async resolveLinePrice(
    ...args: Parameters<CatalogBuyerPricingService['resolveLinePrice']>
  ): ReturnType<CatalogBuyerPricingService['resolveLinePrice']> {
    await this.checkpoints.pass('pricing.resolveLinePrice')
    return this.inner.resolveLinePrice(...args)
  }
}

class CheckpointedScopedProductService implements CatalogScopedProductService {
  constructor(
    private readonly inner: CatalogScopedProductService,
    private readonly checkpoints: CheckpointRegistry,
  ) {}

  async loadScopedProducts(
    ...args: Parameters<CatalogScopedProductService['loadScopedProducts']>
  ): ReturnType<CatalogScopedProductService['loadScopedProducts']> {
    await this.checkpoints.pass('catalog.loadScopedProducts')
    return this.inner.loadScopedProducts(...args)
  }
}

function withApprovalCheckpoint(
  service: CustomerPurchaseApprovalService,
  checkpoints: CheckpointRegistry,
): CustomerPurchaseApprovalService {
  const wrapped: CustomerPurchaseApprovalService = Object.create(service)
  wrapped.getApproval = async (input) => {
    await checkpoints.pass('approval.getApproval')
    return service.getApproval(input)
  }
  return wrapped
}

function createNoPromotionsService(
  checkpoints: CheckpointRegistry,
): Pick<PromotionsService, 'evaluate' | 'extendReservation'> {
  return {
    async evaluate() {
      await checkpoints.pass('promotions.evaluate')
      return { appliedPromotions: [] }
    },
    async extendReservation() {
      return undefined
    },
  }
}

const dataEngineSink = {
  markOrmEntityChange: (): void => undefined,
  flushOrmEntityChanges: async (): Promise<void> => undefined,
  setCustomFields: async (): Promise<void> => undefined,
}

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown }

export type TrackedCall<T> = {
  isSettled: () => boolean
  settled: Promise<Settled<T>>
}

export function track<T>(promise: Promise<T>): TrackedCall<T> {
  let done = false
  const settled = promise.then(
    (value): Settled<T> => {
      done = true
      return { ok: true, value }
    },
    (error: unknown): Settled<T> => {
      done = true
      return { ok: false, error }
    },
  )
  return { isSettled: () => done, settled }
}

function describeOutcome(outcome: Settled<unknown>): string {
  if (outcome.ok) return 'succeeded'
  return isCrudHttpError(outcome.error)
    ? `failed with ${outcome.error.status} ${JSON.stringify(outcome.error.body)}`
    : `failed with ${String(outcome.error)}`
}

/** Waits for `checkpoint`, failing fast if `call` settles first (it can then never reach it). */
export async function reachedBy(checkpoint: ArmedCheckpoint, call: TrackedCall<unknown>): Promise<void> {
  const first = await Promise.race([
    checkpoint.reached.then(() => null),
    call.settled.then((outcome) => outcome),
  ])
  if (first) throw new Error(`[internal] the call settled before reaching its checkpoint: it ${describeOutcome(first)}`)
}

export function expectFulfilled<T>(outcome: Settled<T>): T {
  if (!outcome.ok) throw new Error(`[internal] expected the command to succeed, it ${describeOutcome(outcome)}`)
  return outcome.value
}

export function expectHttpRejection(outcome: Settled<unknown>): { status: number; body: Record<string, unknown> } {
  if (outcome.ok) throw new Error('[internal] expected the command to be refused, it succeeded')
  if (!isCrudHttpError(outcome.error)) {
    throw new Error(`[internal] expected a CrudHttpError refusal, got: ${String(outcome.error)}`)
  }
  return { status: outcome.error.status, body: outcome.error.body ?? {} }
}

/** `advisory`: a `pg_advisory_xact_lock` wait; `row`: a row/tuple lock wait; `any`: either. */
export type LockWaitKind = 'advisory' | 'row' | 'any'

export type SeededProduct = {
  productId: string
  priceKindId: string
  /** min 1, max 4: net 10, gross 12, tax 20 %. */
  baseTierRowId: string
  /** min 5: net 9, gross 10.80, tax 20 %. */
  bulkTierRowId: string
}

export type CartLineSeed = {
  product: SeededProduct
  quantity: number
  /** Seeds the line already flagged `product_unavailable` (pair it with an inactive product). */
  flagged?: boolean
}

export type SeededCart = {
  cartId: string
  lineIds: string[]
  routeContext: ResolvedCartRouteContext
}

export type ApprovalPolicyFixture = {
  /** `Cart.requiresApproval` turns true above this goods gross amount. */
  approvalRequiredAbove: number
  /** Gross amount the seeded, already-approved approval covers. */
  approvedAmountGross: number
}

export type CartRaceHarness = {
  orm: MikroORM
  checkpoints: CheckpointRegistry
  newTenant(): TenantScope
  requestContext(scope: TenantScope): CommandRuntimeContext
  run<TInput, TResult>(commandId: string, input: TInput, scope: TenantScope): Promise<TResult>
  seedPricedProduct(scope: TenantScope, options?: { isActive?: boolean }): Promise<SeededProduct>
  seedBasketCart(scope: TenantScope, lines: CartLineSeed[], options?: { approval?: ApprovalPolicyFixture }): Promise<SeededCart>
  seedProposal(
    scope: TenantScope,
    target: SeededCart,
    product: SeededProduct,
    quantity: number,
  ): Promise<{ proposalCartId: string; proposalLineId: string; acceptanceToken: string }>
  /** What `POST /proposals/:id/preview` hands the buyer: a token bound to both carts' current `updatedAt`. */
  mintAcceptanceToken(proposalCartId: string, targetCartId: string): Promise<string>
  readCart(cartId: string): Promise<Cart>
  readActiveLines(cartId: string): Promise<CartLine[]>
  countMergeLogs(targetCartId: string): Promise<number>
  /** Sessions blocked on a lock whose current statement names `recordId` (a cart or line id). */
  countLockWaiters(kind: LockWaitKind, recordId: string): Promise<number>
  /** Polls until `atLeast` such sessions wait, or until `unlessSettled` settles (so a test can assert it did not). */
  waitForLockWaiters(kind: LockWaitKind, recordId: string, atLeast: number, unlessSettled: TrackedCall<unknown>): Promise<void>
  /** Holds `SELECT … FOR UPDATE` on one row in its own transaction until `release()`. */
  holdRowLock(table: 'carts' | 'cart_lines', id: string): Promise<{ release: () => Promise<void> }>
  /** Test teardown: releases armed checkpoints and held row locks; returns never-reached checkpoints. */
  releaseAll(): Promise<CheckpointName[]>
  close(): Promise<void>
}

const CART_ENTITIES = [Cart, CartLine, CartPromotionApplication, CartIdempotencyKey, CartMergeLog]
const CATALOG_ENTITIES = [
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
]
const CUSTOMER_GROUP_ENTITIES = [
  CustomerGroup,
  CustomerGroupMembership,
  CustomerGroupTerms,
  CustomerCreditAccount,
  CustomerCreditLedgerEntry,
  CustomerPurchaseApproval,
]

const POLL_INTERVAL_MS = 20
const WAIT_TIMEOUT_MS = 10_000

async function acquireDatabaseUrl(): Promise<{ url: string; release: () => Promise<void> }> {
  if (EXPLICIT_URL) return { url: EXPLICIT_URL, release: async () => undefined }
  const { GenericContainer, Wait } = await import('testcontainers')
  const container: StartedTestContainer = await new GenericContainer('postgres:16')
    .withEnvironment({ POSTGRES_USER: 'cart_race', POSTGRES_PASSWORD: 'cart_race', POSTGRES_DB: 'cart_race' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .withStartupTimeout(60_000)
    .start()
  return {
    url: `postgres://cart_race:cart_race@${container.getHost()}:${container.getMappedPort(5432)}/cart_race`,
    release: async () => {
      await container.stop()
    },
  }
}

export async function startCartRaceHarness(contextName: string): Promise<CartRaceHarness> {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'cart-race-harness-acceptance-token-secret-0001'
  const database = await acquireDatabaseUrl()
  const orm = await MikroORM.init({
    contextName,
    clientUrl: database.url,
    entities: [...CART_ENTITIES, ...CATALOG_ENTITIES, ...CUSTOMER_GROUP_ENTITIES],
    metadataProvider: ReflectMetadataProvider,
    debug: false,
    pool: { min: 0, max: 24 },
    driverOptions: { connectionTimeoutMillis: 5_000 },
  })
  await orm.schema.refresh()

  const checkpoints = new CheckpointRegistry()
  const commandBus = new CheckpointedCommandBus(checkpoints)
  const pricing = new CheckpointedBuyerPricingService(
    new DefaultCatalogBuyerPricingService(new DefaultCatalogPricingService(null)),
    checkpoints,
  )
  const scopedProducts = new CheckpointedScopedProductService(new DefaultCatalogScopedProductService(), checkpoints)
  const salesCalculation = new DefaultSalesCalculationService(null)
  const promotions = createNoPromotionsService(checkpoints)

  function buildRequestContainer(): AwilixContainer {
    const container = createContainer()
    container.register({
      em: asValue(orm.em.fork()),
      commandBus: asValue(commandBus),
      dataEngine: asValue(dataEngineSink),
      catalogBuyerPricingService: asValue(pricing),
      catalogScopedProductService: asValue(scopedProducts),
      salesCalculationService: asValue(salesCalculation),
      promotionsService: asValue(promotions),
    })
    registerCustomerGroupsDi(container)
    const approvalFactory = container.resolve<(em: EntityManager) => CustomerPurchaseApprovalService>(
      'customerPurchaseApprovalServiceFactory',
    )
    container.register({
      customerPurchaseApprovalServiceFactory: asValue((em: EntityManager) =>
        withApprovalCheckpoint(approvalFactory(em), checkpoints),
      ),
    })
    return container
  }

  function requestContext(scope: TenantScope): CommandRuntimeContext {
    return {
      container: buildRequestContainer(),
      auth: { sub: 'cart-race-harness', tenantId: scope.tenantId, orgId: scope.organizationId },
      organizationScope: null,
      selectedOrganizationId: scope.organizationId,
      organizationIds: [scope.organizationId],
    }
  }

  const inFlightCalls = new Set<Promise<void>>()

  function run<TInput, TResult>(commandId: string, input: TInput, scope: TenantScope): Promise<TResult> {
    const execution = commandBus
      .execute<TInput, TResult>(commandId, { input, ctx: requestContext(scope) })
      .then(({ result }) => result)
    const settled = execution.then(
      () => undefined,
      () => undefined,
    )
    inFlightCalls.add(settled)
    void settled.then(() => inFlightCalls.delete(settled))
    return execution
  }

  // A failed assertion can leave a command mid-flight (a checkpoint or row lock is released
  // in teardown, and it then runs on). Closing the ORM under it would hang the pool, so
  // teardown waits for every call this harness started before it moves on.
  async function drainInFlightCalls(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<'timed_out'>((resolve) => {
      timer = setTimeout(() => resolve('timed_out'), WAIT_TIMEOUT_MS)
    })
    const outcome = await Promise.race([Promise.all(Array.from(inFlightCalls)).then(() => 'drained' as const), deadline])
    if (timer) clearTimeout(timer)
    if (outcome === 'timed_out') {
      throw new Error(`[internal] ${inFlightCalls.size} cart command(s) still running after teardown released every checkpoint`)
    }
  }

  async function seedPricedProduct(scope: TenantScope, options: { isActive?: boolean } = {}): Promise<SeededProduct> {
    const em = orm.em.fork()
    const suffix = randomUUID().slice(0, 8)
    const priceKind = em.create(CatalogPriceKind, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      code: `regular-${suffix}`,
      title: 'Regular',
      displayMode: 'including-tax',
      isPromotion: false,
      isActive: true,
    })
    const product = em.create(CatalogProduct, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      title: `Race product ${suffix}`,
      sku: `RACE-${suffix}`,
      productType: 'simple',
      isConfigurable: false,
      isActive: options.isActive ?? true,
    })
    em.persist([priceKind, product])
    await em.flush()
    const baseTier = em.create(CatalogProductPrice, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      product,
      priceKind,
      kind: 'regular',
      currencyCode: 'USD',
      minQuantity: 1,
      maxQuantity: 4,
      unitPriceNet: '10.0000',
      unitPriceGross: '12.0000',
      taxRate: '20.0000',
    })
    const bulkTier = em.create(CatalogProductPrice, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      product,
      priceKind,
      kind: 'regular',
      currencyCode: 'USD',
      minQuantity: 5,
      maxQuantity: null,
      unitPriceNet: '9.0000',
      unitPriceGross: '10.8000',
      taxRate: '20.0000',
    })
    em.persist([baseTier, bulkTier])
    await em.flush()
    return { productId: product.id, priceKindId: priceKind.id, baseTierRowId: baseTier.id, bulkTierRowId: bulkTier.id }
  }

  function buildRouteContext(scope: TenantScope, storeId: string, customerUserId: string | null): ResolvedCartRouteContext {
    return {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      storeId,
      channel: 'storefront',
      assortmentScope: null,
      buyerDigest: 'cart-race-digest',
      customerId: null,
      customerIds: [],
      customerGroupIds: [],
      customerUserId,
      currencyCode: 'USD',
      locale: 'en-US',
      taxMode: 'gross',
      salesChannelId: null,
      priceKindId: null,
    }
  }

  async function seedApprovalPolicy(scope: TenantScope, approvalRequiredAbove: number): Promise<void> {
    const em = orm.em.fork()
    const group = em.create(CustomerGroup, {
      tenantId: scope.tenantId,
      code: `default-${randomUUID().slice(0, 8)}`,
      name: 'Default buyers',
      kind: 'b2b',
      priority: 0,
      isDefault: true,
      isActive: true,
    })
    em.persist(group)
    await em.flush()
    em.persist(
      em.create(CustomerGroupTerms, {
        tenantId: scope.tenantId,
        groupId: group.id,
        approvalRequiredAbove: String(approvalRequiredAbove),
        termsCurrencyCode: 'USD',
      }),
    )
    await em.flush()
  }

  async function seedBasketCart(
    scope: TenantScope,
    lineSeeds: CartLineSeed[],
    options: { approval?: ApprovalPolicyFixture } = {},
  ): Promise<SeededCart> {
    const em = orm.em.fork()
    const now = new Date()
    const storeId = randomUUID()
    const customerUserId = options.approval ? randomUUID() : null
    if (options.approval) await seedApprovalPolicy(scope, options.approval.approvalRequiredAbove)
    const cart = em.create(Cart, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      tokenHash: randomUUID(),
      storeId,
      kind: 'basket',
      channel: 'storefront',
      status: 'active',
      currencyCode: 'USD',
      locale: 'en-US',
      taxMode: 'gross',
      buyerDigest: 'cart-race-digest',
      customerUserId,
      totals: {},
      totalsComputedAt: now,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    })
    em.persist(cart)
    await em.flush()
    const lines = lineSeeds.map(({ product, quantity, flagged }, index) =>
      em.create(CartLine, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        cartId: cart.id,
        lineNumber: index + 1,
        productId: product.productId,
        name: `Race product line ${index + 1}`,
        quantity: String(quantity),
        unitPriceNet: quantity >= 5 ? '9.0000' : '10.0000',
        unitPriceGross: quantity >= 5 ? '10.8000' : '12.0000',
        taxRate: '20.0000',
        priceKindId: product.priceKindId,
        priceRowId: quantity >= 5 ? product.bulkTierRowId : product.baseTierRowId,
        priceTierMinQuantity: quantity >= 5 ? 5 : 1,
        pricedAt: now,
        lineTotals: {},
        origin: 'customer',
        flagState: flagged ? 'product_unavailable' : null,
        addedByActorType: 'buyer',
        configuration: { raceLine: index + 1 },
      }),
    )
    em.persist(lines)
    await em.flush()
    if (options.approval && customerUserId) {
      const approval = em.create(CustomerPurchaseApproval, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        customerId: randomUUID(),
        requestedByActorType: 'customer_user',
        requestedByActorId: customerUserId,
        subjectType: 'cart',
        subjectId: cart.id,
        amountGross: String(options.approval.approvedAmountGross),
        currencyCode: 'USD',
        approvalPolicy: 'merchant',
        status: 'approved',
        buyerDecision: 'not_required',
        merchantDecision: 'approved',
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      })
      em.persist(approval)
      await em.flush()
      cart.approvalId = approval.id
      await em.flush()
    }
    return {
      cartId: cart.id,
      lineIds: lines.map((line) => line.id),
      routeContext: buildRouteContext(scope, storeId, customerUserId),
    }
  }

  async function seedProposal(
    scope: TenantScope,
    target: SeededCart,
    product: SeededProduct,
    quantity: number,
  ): Promise<{ proposalCartId: string; proposalLineId: string; acceptanceToken: string }> {
    const em = orm.em.fork()
    const now = new Date()
    const proposal = em.create(Cart, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      tokenHash: randomUUID(),
      storeId: target.routeContext.storeId,
      kind: 'proposal',
      proposedToCartId: target.cartId,
      channel: 'storefront',
      status: 'active',
      currencyCode: 'USD',
      locale: 'en-US',
      taxMode: 'gross',
      buyerDigest: 'cart-race-digest',
      totals: {},
      totalsComputedAt: now,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    })
    em.persist(proposal)
    await em.flush()
    const proposalLine = em.create(CartLine, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      cartId: proposal.id,
      lineNumber: 1,
      productId: product.productId,
      name: 'Suggested by sales rep',
      quantity: String(quantity),
      unitPriceNet: '10.0000',
      unitPriceGross: '12.0000',
      taxRate: '20.0000',
      priceKindId: product.priceKindId,
      priceRowId: product.baseTierRowId,
      priceTierMinQuantity: 1,
      pricedAt: now,
      lineTotals: {},
      origin: 'customer',
      addedByActorType: 'rep',
      addedByActorId: randomUUID(),
      configuration: { proposal: true },
    })
    em.persist(proposalLine)
    await em.flush()
    const acceptanceToken = await mintAcceptanceToken(proposal.id, target.cartId)
    return { proposalCartId: proposal.id, proposalLineId: proposalLine.id, acceptanceToken }
  }

  async function mintAcceptanceToken(proposalCartId: string, targetCartId: string): Promise<string> {
    const fresh = orm.em.fork()
    const storedProposal = await fresh.findOneOrFail(Cart, { id: proposalCartId })
    const storedTarget = await fresh.findOneOrFail(Cart, { id: targetCartId })
    return signAcceptanceToken({
      proposalCartId: storedProposal.id,
      targetCartId: storedTarget.id,
      proposalUpdatedAt: storedProposal.updatedAt.toISOString(),
      targetUpdatedAt: storedTarget.updatedAt.toISOString(),
    })
  }

  async function readCart(cartId: string): Promise<Cart> {
    return orm.em.fork().findOneOrFail(Cart, { id: cartId })
  }

  async function readActiveLines(cartId: string): Promise<CartLine[]> {
    return orm.em.fork().find(CartLine, { cartId, deletedAt: null }, { orderBy: { lineNumber: 'asc' } })
  }

  async function countMergeLogs(targetCartId: string): Promise<number> {
    return orm.em.fork().count(CartMergeLog, { targetCartId })
  }

  async function countLockWaiters(kind: LockWaitKind, recordId: string): Promise<number> {
    const waitEventClause =
      kind === 'advisory'
        ? `and wait_event = 'advisory'`
        : kind === 'row'
          ? `and wait_event in ('transactionid', 'tuple')`
          : ''
    const rows = await orm.em.fork().execute<Array<{ waiting: number }>>(
      `select count(*)::int as waiting from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock' ${waitEventClause}
         and position(? in query) > 0`,
      [recordId],
    )
    return rows[0]?.waiting ?? 0
  }

  async function waitForLockWaiters(
    kind: LockWaitKind,
    recordId: string,
    atLeast: number,
    unlessSettled: TrackedCall<unknown>,
  ): Promise<void> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (unlessSettled.isSettled()) return
      if ((await countLockWaiters(kind, recordId)) >= atLeast) return
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    throw new Error(`[internal] timed out waiting for ${atLeast} ${kind} lock waiter(s) on ${recordId}`)
  }

  const heldRowLocks = new Set<() => Promise<void>>()

  async function holdRowLock(table: 'carts' | 'cart_lines', id: string): Promise<{ release: () => Promise<void> }> {
    let signalAcquired: () => void = () => undefined
    let signalRelease: () => void = () => undefined
    const acquired = new Promise<void>((resolve) => {
      signalAcquired = resolve
    })
    const releaseRequested = new Promise<void>((resolve) => {
      signalRelease = resolve
    })
    const holding = orm.em.fork().transactional(async (trx) => {
      await trx.execute(`select id from ${table} where id = ? for update`, [id])
      signalAcquired()
      await releaseRequested
    })
    await Promise.race([acquired, holding])
    const release = async (): Promise<void> => {
      heldRowLocks.delete(release)
      signalRelease()
      await holding
    }
    heldRowLocks.add(release)
    return { release }
  }

  async function releaseHeldRowLocks(): Promise<void> {
    for (const release of Array.from(heldRowLocks)) await release()
  }

  return {
    orm,
    checkpoints,
    newTenant: () => ({ tenantId: randomUUID(), organizationId: randomUUID() }),
    requestContext,
    run,
    seedPricedProduct,
    seedBasketCart,
    seedProposal,
    mintAcceptanceToken,
    readCart,
    readActiveLines,
    countMergeLogs,
    countLockWaiters,
    waitForLockWaiters,
    holdRowLock,
    releaseAll: async () => {
      const unreached = checkpoints.releaseAll()
      await releaseHeldRowLocks()
      await drainInFlightCalls()
      return unreached
    },
    close: async () => {
      try {
        checkpoints.releaseAll()
        await releaseHeldRowLocks()
        await drainInFlightCalls()
        await orm.close(true)
      } finally {
        await database.release()
      }
    },
  }
}
