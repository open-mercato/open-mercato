import { asValue, createContainer, InjectionMode, type AwilixContainer } from 'awilix'
import { register as registerPromotionsDi } from '../di'
import { buildScopedContainerFromResolve } from '@open-mercato/shared/lib/di/scopedContainer'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EvaluateInput, PromotionsService } from '../lib/types'

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

function evaluateInput(): EvaluateInput {
  return {
    items: [],
    currency: 'USD',
    evaluatedAt: new Date().toISOString(),
    buyer: { customerId: null, customerIds: [], customerGroupIds: [] },
    customerOrderCount: null,
    cartWeight: null,
    codes: [],
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

  test('a real child scope supplies private auth to its promotions service', async () => {
    const parent = buildRealContainer()
    const child = parent.createScope()
    const sibling = parent.createScope()
    try {
      child.register({ auth: asValue({ tenantId: 'tenant-1', orgId: 'org-1' }) })
      await expect(child.resolve<PromotionsService>('promotionsService').evaluate(evaluateInput())).resolves.toBeDefined()
      for (const scope of [parent, sibling]) {
        await expect(scope.resolve<PromotionsService>('promotionsService').evaluate(evaluateInput()))
          .rejects.toMatchObject({ status: 400, body: { error: SCOPE_REQUIRED_ERROR } })
      }
    } finally {
      await Promise.all([child.dispose(), sibling.dispose()])
      await parent.dispose()
    }
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
