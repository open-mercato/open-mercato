/** @jest-environment node */
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ensureTagPermission } from '@open-mercato/core/modules/sales/api/tags/route'

const translate = (_key: string, fallback?: string) => fallback ?? _key

function makeCtx(grantedFeatures: string[]): { ctx: CrudCtx; checkedFeatures: string[][] } {
  const checkedFeatures: string[][] = []
  const rbac = {
    userHasAllFeatures: jest.fn(async (_sub: string, required: string[]) => {
      checkedFeatures.push(required)
      return required.every((feature) => grantedFeatures.includes(feature))
    }),
  }
  const ctx = {
    container: { resolve: (token: string) => (token === 'rbacService' ? rbac : null) },
    auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
    selectedOrganizationId: 'org-1',
  } as unknown as CrudCtx
  return { ctx, checkedFeatures }
}

// Tags are shared between orders and quotes, so either kind's feature must authorize the route.
// These pins would fail if the route regressed to the old orders-only metadata guard — the bug
// where a quote-only manager was offered a tag editor whose POST predictably 403'd.
describe('sales tags route — kind-agnostic permissions', () => {
  it.each([
    ['sales.orders.view'],
    ['sales.quotes.view'],
  ])('allows reads with %s alone', async (feature) => {
    const { ctx } = makeCtx([feature])
    await expect(ensureTagPermission(ctx, 'view', translate)).resolves.toBeUndefined()
  })

  it.each([
    ['sales.orders.manage'],
    ['sales.quotes.manage'],
  ])('allows writes with %s alone', async (feature) => {
    const { ctx } = makeCtx([feature])
    await expect(ensureTagPermission(ctx, 'manage', translate)).resolves.toBeUndefined()
  })

  it('rejects reads without either view feature, naming the alternatives', async () => {
    const { ctx } = makeCtx(['sales.returns.create'])
    await expect(ensureTagPermission(ctx, 'view', translate)).rejects.toMatchObject({
      status: 403,
      body: { requiredFeatures: ['sales.orders.view', 'sales.quotes.view'] },
    })
  })

  it('rejects writes when the caller only holds the view features', async () => {
    const { ctx, checkedFeatures } = makeCtx(['sales.orders.view', 'sales.quotes.view'])
    await expect(ensureTagPermission(ctx, 'manage', translate)).rejects.toBeInstanceOf(CrudHttpError)
    // Each alternative is checked on its own: userHasAllFeatures is all-of, so a combined
    // list would demand BOTH manage features — the very bug this route just shed.
    expect(checkedFeatures).toEqual([['sales.orders.manage'], ['sales.quotes.manage']])
  })

  it('rejects unauthenticated callers with 401 before consulting rbac', async () => {
    const rbac = { userHasAllFeatures: jest.fn() }
    const ctx = {
      container: { resolve: () => rbac },
      auth: null,
    } as unknown as CrudCtx
    await expect(ensureTagPermission(ctx, 'view', translate)).rejects.toMatchObject({ status: 401 })
    expect(rbac.userHasAllFeatures).not.toHaveBeenCalled()
  })
})
