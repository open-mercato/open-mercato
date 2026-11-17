/**
 * #8268 review Major 1 (re-review, M1). `promotions/di.ts` registers `promotionsService`
 * with `asFunction(() => new PromotionsServiceImpl(container)).scoped().proxy()`, closing
 * over the exact `container` its own `register(container)` call received — never
 * whatever container a LATER caller happens to resolve from. `PromotionsServiceImpl`
 * reads the caller's trusted auth scope with `this.container.resolve('auth')`
 * (`lib/promotions-service.ts`'s `resolvePromotionsServiceScope`), so a caller that wants
 * `promotionsService.evaluate()` to see a scope it supplies MUST call `.register({ auth:
 * ... })` on that SAME container object — never on a local resolver-overlay shim
 * (`@open-mercato/shared/lib/di/scopedContainer#buildScopedContainerFromResolve`), whose
 * `.register()` only shadows resolution for its OWN direct callers and is invisible to
 * `promotionsService`'s already-bound closure.
 *
 * This is the real promotions DI registration end to end (no mock in place of
 * `promotions/di.ts` or `PromotionsServiceImpl`) — the exact gap `assisted_selling`'s
 * `reauthorOnMerge.ts` and `checkout`'s `recover-stuck-submits.worker.ts` hit when their
 * own container was only ever a bound `resolve` function (no real Awilix container to
 * `.register()` against).
 */
import { asValue, createContainer, InjectionMode, type AwilixContainer } from 'awilix'
import { register as registerPromotionsDi } from '../di'
import { buildScopedContainerFromResolve } from '@open-mercato/shared/lib/di/scopedContainer'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { PromotionsService } from '../lib/types'

const SCOPE_REQUIRED_ERROR = '[internal] Tenant and organization scope are required to evaluate promotions'

function buildRealContainer(): AwilixContainer {
  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  // Minimal stand-ins: `evaluate()` with an empty `items` array never reaches catalog
  // lookups (`resolveCategoryIdsForProducts` short-circuits on `productIds.length === 0`),
  // and `resolveCurrencyFractionDigits` swallows any `em` failure and falls back to
  // `undefined` — so this suite does not need a real MikroORM `EntityManager`.
  container.register({ em: asValue({}) })
  registerPromotionsDi(container)
  // Override the REAL `promotionCacheService`'s with a trivial stub so `evaluate()` can
  // run to completion — this test is about auth-scope VISIBILITY, not promotion lookup.
  container.register({ promotionCacheService: asValue({ getActivePromotions: async () => [] }) })
  return container
}

async function captureThrown(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return undefined
  } catch (err) {
    return err
  }
}

function evaluateInput() {
  return {
    items: [] as const,
    currency: 'USD',
    evaluatedAt: new Date().toISOString(),
    buyer: { customerIds: [], customerGroupIds: [] } as any,
  }
}

describe('promotionsService auth-scope visibility across container shapes (M1)', () => {
  test('a local resolver-overlay register() override is invisible to promotionsService — it still fails closed', async () => {
    const container = buildRealContainer()
    const overlay = buildScopedContainerFromResolve(container.resolve.bind(container))
    overlay.register({ auth: asValue({ tenantId: 'tenant-1', orgId: 'org-1' }) })

    const promotionsService = overlay.resolve<PromotionsService>('promotionsService')
    const error = await captureThrown(() => promotionsService.evaluate(evaluateInput()))

    expect(error).toBeDefined()
    expect(isCrudHttpError(error)).toBe(true)
    expect((error as { status: number }).status).toBe(400)
    expect((error as { body?: { error?: string } }).body?.error).toBe(SCOPE_REQUIRED_ERROR)
  })

  test('register() on the REAL container IS visible to promotionsService — the fix', async () => {
    const container = buildRealContainer()
    container.register({ auth: asValue({ tenantId: 'tenant-1', orgId: 'org-1' }) })

    const promotionsService = container.resolve<PromotionsService>('promotionsService')
    const error = await captureThrown(() => promotionsService.evaluate(evaluateInput()))

    // No scope-required 400 — the auth override registered on the real container reached
    // `promotionsService`'s own `this.container.resolve('auth')` call.
    expect(error).toBeUndefined()
  })
})
