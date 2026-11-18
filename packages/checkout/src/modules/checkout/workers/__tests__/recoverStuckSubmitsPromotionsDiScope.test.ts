/**
 * #8268 review Major 1 (re-review, M1). `recover-stuck-submits.worker.test.ts` proves the
 * worker passes the REAL per-job container straight through to `continueOrderOutcome`
 * (identity), with `continueOrderOutcome` itself always mocked. Nothing yet runs that real
 * container through the REAL `continueOrderOutcome` -> `promotionsService.useCode`/
 * `.registerUsage` chain this module's own `commands/submit.ts` (step 6c) actually calls
 * before payment — the exact gap the M1 re-review named, mirroring
 * `assisted_selling/lib/__tests__/reauthorOnMergePromotionsDiScope.test.ts`'s identical fix
 * on the reauthor-on-merge side.
 *
 * What is REAL: `recoverOneStuckSubmit` (the worker's own exported recovery function) and
 * `continueOrderOutcome` (never mocked here), the real `CommandBus` dispatch, and
 * `promotions/di.ts`'s own `promotionsService` registration plus the real
 * `PromotionsServiceImpl.useCode`/`.registerUsage` (only `promotionCacheService` is a
 * fixture, same precedent as the assisted_selling suite and
 * `promotionsDiContainerScope.test.ts#buildRealContainer`). `sales.orders.update` is a
 * stand-in registered under its real command id (same precedent as
 * `order-usage-lifecycle-undo-redelivery.integration.test.ts`'s `sales_orders` stand-in) —
 * this suite does not exercise sales' own order-confirmation side effects, only that
 * `confirmOrderAndComplete` reaches and completes past them.
 *
 * The session is seeded `submitStartedAt` 31 minutes in the past — past
 * `RECOVERY_GIVE_UP_MS` (30 min) — so a thrown failure does not just log and wait for the
 * next tick; it escalates straight to `compensateByCancellingOrder`. If `recoverOneStuckSubmit`
 * ever regresses to building `continueOrderOutcome`'s container from a bound `resolve` alone
 * (no real `.register()`), `promotionsService.useCode`'s own `resolvePromotionsServiceAuthAndScope`
 * fails closed (400, scope required): `continueOrderOutcome` throws `409
 * promotion_unavailable`, and — because the session is already past the give-up window —
 * `recoverOneStuckSubmit` cancels the order. This suite's "resumes, never cancels" assertion
 * fails exactly then.
 */
import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus, registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { register as registerPromotionsDi } from '@open-mercato/core/modules/promotions/di'
import type { NormalizedPromotion, PromotionsService } from '@open-mercato/core/modules/promotions/lib/types'
import { CheckoutSession } from '../../data/entities'
import { recoverOneStuckSubmit } from '../recover-stuck-submits.worker'

jest.mock('../../lib/sessionEvents', () => ({ writeSessionEvent: jest.fn(async () => undefined) }))
jest.mock('../../events', () => ({ emitCheckoutEvent: jest.fn(async () => undefined) }))

const TENANT_ID = 'tenant-recover-promo-1'
const ORG_ID = 'org-recover-promo-1'
const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }
const CART_ID = 'cart-recover-promo-1'
const ORDER_ID = 'order-recover-promo-1'
const QUOTE_ID = 'quote-recover-promo-1'
const PROMO_CODE_ID = 'promo-code-recover-1'

const SALES_ORDERS_UPDATE_COMMAND_ID = 'sales.orders.update'

function makeSession(): CheckoutSession {
  return {
    id: 'session-recover-promo-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    cartId: CART_ID,
    linkId: null,
    status: 'submitting',
    submitAttempt: 1,
    // Past `RECOVERY_GIVE_UP_MS` (30 min) — a thrown failure here escalates to
    // `compensateByCancellingOrder` instead of just waiting for the next tick.
    submitStartedAt: new Date(Date.now() - 31 * 60 * 1000),
    submitProgress: 'document_created',
    stockReservationKey: null,
    creditReservationKey: null,
    salesQuoteId: QUOTE_ID,
    salesOrderId: ORDER_ID,
    paymentMethodCode: 'on_account',
    outcomeKind: null,
    currencyCode: 'USD',
  } as unknown as CheckoutSession
}

type KyselyRows = {
  carts: Row[]
  cart_promotion_applications: Row[]
  dictionary_entries: Row[]
  sales_order_lines: Row[]
}
type Row = Record<string, any>

function fakeKysely(rows: KyselyRows) {
  return () => ({
    selectFrom(table: keyof KyselyRows) {
      let data = rows[table] ?? []
      const node: Row = {
        innerJoin: () => node,
        select: () => node,
        where: (...args: unknown[]) => {
          // Only `dictionary_entries.normalized_value in [...]` matters for this suite's
          // single lookup (`resolveSalesOrderStatusEntryId`) — every other `.where()` is a
          // tenant/organization/scope filter this fixture already seeds correctly for.
          if (table === 'dictionary_entries' && args[0] === 'dictionary_entries.normalized_value') {
            const candidates = args[2] as string[]
            data = data.filter((row) => candidates.includes(row.normalized_value))
          }
          return node
        },
        execute: async () => data,
        executeTakeFirst: async () => data[0],
      }
      return node
    },
  })
}

function makeFakeEm(rows: KyselyRows) {
  const sessions = [makeSession()]
  const em: Row = {
    getKysely: fakeKysely(rows),
    nativeUpdate: async (Cls: unknown, where: Row, data: Row) => {
      if (Cls !== CheckoutSession) return 0
      const matching = sessions.filter((row) => Object.entries(where).every(([k, v]) => {
        if (k === 'status' && v && typeof v === 'object' && '$in' in v) return (v.$in as string[]).includes(row.status)
        return (row[k] ?? null) === (v ?? null)
      }))
      matching.forEach((row) => Object.assign(row, data))
      return matching.length
    },
    create: (_Cls: unknown, data: Row) => ({ ...data }),
    persist: () => undefined,
    flush: async () => undefined,
    transactional: async (callback: (tx: Row) => Promise<unknown>) => callback(em),
  }
  em.fork = () => em
  return { em, sessions }
}

function buildRealMatchingPromotion(): NormalizedPromotion {
  return {
    id: 'promo-recover-1',
    name: 'Real Promo Recovery Test',
    order: 0,
    cumulative: true,
    tags: [],
    excludedTags: [],
    excludeFlags: {},
    eligibleCurrencies: [],
    startsAt: null,
    endsAt: null,
    maxBudget: null,
    budgetCurrency: null,
    totalDiscountGranted: '0',
    rootGroup: {
      operator: 'and',
      rules: [{ type: 'code', config: { codeId: PROMO_CODE_ID } }],
      benefits: [
        {
          type: 'cart_discount',
          appliesTo: 'order',
          config: { discountType: 'percentage', value: '10', maxDiscount: null, labels: { en: 'Real recovery promo' } },
        },
      ],
      children: [],
    },
  }
}

/** Builds the REAL Awilix container `continueOrderOutcome` receives as `container` — real
 * `promotions/di.ts` registration (only `promotionCacheService` swapped for a fixture), a
 * real `CommandBus` dispatching to a `sales.orders.update` stand-in, and the cart/promotion
 * rows step 6c actually reads via `em.getKysely()`. */
function buildRealContainer(em: Row) {
  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  const commandBus = new CommandBus()
  container.register({ em: asValue(em), commandBus: asValue(commandBus) })
  registerPromotionsDi(container)
  container.register({
    promotionCacheService: asValue({ getActivePromotions: async () => [buildRealMatchingPromotion()] }),
  })
  return container
}

const salesOrdersUpdateStandIn: CommandHandler<unknown, { ok: true }> = {
  id: SALES_ORDERS_UPDATE_COMMAND_ID,
  isUndoable: false,
  async execute() {
    return { ok: true }
  },
}

// `promotionsService.useCode`/`.registerUsage` (`commands/submit.ts` step 6c) both dispatch
// through the real `CommandBus` by id — the SAME container-identity dependency as `evaluate()`,
// reached through `resolvePromotionsServiceAuthAndScope` this time instead of
// `resolvePromotionsServiceScope`.
const useCodeCalls: Array<{ input: unknown; ctx: CommandRuntimeContext }> = []
const registerUsageCalls: Array<{ input: unknown; ctx: CommandRuntimeContext }> = []
const promotionsCodeUseStandIn: CommandHandler<unknown, { ok: true }> = {
  id: 'promotions.code.use',
  isUndoable: false,
  async execute(input, ctx) {
    useCodeCalls.push({ input, ctx })
    return { ok: true }
  },
}
const promotionsUsageRegisterStandIn: CommandHandler<unknown, { ok: true; budgetExceeded: string[] }> = {
  id: 'promotions.usage.register',
  isUndoable: false,
  async execute(input, ctx) {
    registerUsageCalls.push({ input, ctx })
    return { ok: true, budgetExceeded: [] }
  },
}

registerCommand(salesOrdersUpdateStandIn)
registerCommand(promotionsCodeUseStandIn)
registerCommand(promotionsUsageRegisterStandIn)

describe('recoverOneStuckSubmit — real promotions DI scope (M1 re-review)', () => {
  beforeEach(() => {
    useCodeCalls.length = 0
    registerUsageCalls.length = 0
  })

  test('resumes an on-account order past step 6c under the real container, applying the real promotion code to the real cart — never cancels the order', async () => {
    const rows: KyselyRows = {
      carts: [{ id: CART_ID, tenant_id: TENANT_ID, organization_id: ORG_ID, customer_id: 'customer-recover-1' }],
      cart_promotion_applications: [
        {
          cart_id: CART_ID,
          tenant_id: TENANT_ID,
          organization_id: ORG_ID,
          promotion_id: 'promo-recover-1',
          code: 'SAVE10',
          code_id: PROMO_CODE_ID,
          code_type: 'static',
          effect: { type: 'CART_DISCOUNT', amountNet: '-10.91', amountGross: '-12.00' },
          amount_net: '-10.91',
          amount_gross: '-12.00',
        },
      ],
      dictionary_entries: [{ id: 'status-entry-confirmed', normalized_value: 'confirmed' }],
      sales_order_lines: [],
    }
    const { em, sessions } = makeFakeEm(rows)
    const container = buildRealContainer(em)

    await recoverOneStuckSubmit(container as unknown as CommandRuntimeContext['container'], em, sessions[0], SCOPE)

    // The real `promotionsService.useCode`/`.registerUsage` resolved `auth` off the SAME
    // real container this call received — never threw the scope-required 400 the M1
    // regression would, so neither escalated to `compensateByCancellingOrder`.
    expect(useCodeCalls).toHaveLength(1)
    expect(useCodeCalls[0].input).toMatchObject({ codeId: PROMO_CODE_ID, codeString: 'SAVE10', cartId: CART_ID, orderId: ORDER_ID, customerId: 'customer-recover-1' })
    expect(registerUsageCalls).toHaveLength(1)
    expect(registerUsageCalls[0].input).toMatchObject({
      orderId: ORDER_ID,
      appliedPromotions: [expect.objectContaining({ promotionId: 'promo-recover-1' })],
    })

    // Resumed all the way through — the session reached `completed`, never `failed`
    // (the shape `compensateByCancellingOrder` would have left it in).
    expect(sessions[0].status).toBe('completed')
    expect(sessions[0].submitProgress).toBe('finalized')
  })

  test('escalates to cancelling the order when the container really has no register() (sanity check on the fixture itself)', async () => {
    const rows: KyselyRows = {
      carts: [{ id: CART_ID, tenant_id: TENANT_ID, organization_id: ORG_ID, customer_id: null }],
      cart_promotion_applications: [
        {
          cart_id: CART_ID,
          tenant_id: TENANT_ID,
          organization_id: ORG_ID,
          promotion_id: 'promo-recover-1',
          code: 'SAVE10',
          code_id: PROMO_CODE_ID,
          code_type: 'static',
          effect: { type: 'CART_DISCOUNT', amountNet: '-10.91', amountGross: '-12.00' },
          amount_net: '-10.91',
          amount_gross: '-12.00',
        },
      ],
      dictionary_entries: [
        { id: 'status-entry-confirmed', normalized_value: 'confirmed' },
        { id: 'status-entry-canceled', normalized_value: 'canceled' },
      ],
      sales_order_lines: [],
    }
    const { em, sessions } = makeFakeEm(rows)
    const realContainer = buildRealContainer(em)
    // The exact pre-fix shape: a bound-`resolve`-only shim with no `register()` at all —
    // `continueOrderOutcome`'s own `container.register({ auth: ... })` call throws a
    // TypeError, which (unlike the scope-required 400) still proves the same point: without
    // a real container reaching this call, the resume cannot complete and the session, being
    // past the give-up window, is cancelled instead of resumed.
    const noRegisterContainer = { resolve: realContainer.resolve.bind(realContainer) }

    await recoverOneStuckSubmit(noRegisterContainer as unknown as CommandRuntimeContext['container'], em, sessions[0], SCOPE)

    expect(useCodeCalls).toHaveLength(0)
    expect(sessions[0].status).toBe('failed')
  })
})
