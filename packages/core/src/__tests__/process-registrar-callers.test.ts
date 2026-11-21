import { asValue, createContainer, InjectionMode } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { getProcessDiRegistrar } from '@open-mercato/shared/lib/di/process-registrar'
import { register as registerCart } from '../modules/cart/di'
import { register as registerPromotions } from '../modules/promotions/di'
import type { CartService } from '../modules/cart/lib/cartService'
import type { PromotionsServiceImpl } from '../modules/promotions/lib/promotions-service'

function container(): AppContainer {
  return createContainer({ injectionMode: InjectionMode.CLASSIC })
}

describe.each(['legacy', 'process'] as const)('%s registrar caller ownership', (mode) => {
  test('cart and promotions dispatch through the caller command bus with its current auth', async () => {
    const root = container()
    if (mode === 'process') {
      await getProcessDiRegistrar(registerCart)!(root)
      await getProcessDiRegistrar(registerPromotions)!(root)
    }
    const callers = ['first', 'second'].map((name) => {
      const caller = mode === 'process' ? root.createScope() : container()
      if (mode === 'legacy') {
        registerCart(caller)
        registerPromotions(caller)
      }
      const auth = { sub: name, tenantId: `tenant-${name}`, orgId: `org-${name}` }
      const execute = jest.fn(async () => ({ result: name }))
      caller.register({ auth: asValue(auth), commandBus: asValue({ execute }) })
      return { caller, auth, execute }
    })
    await Promise.all(callers.map(async ({ caller, auth, execute }) => {
      const cart = caller.resolve<CartService>('cartService')
      const promotions = caller.resolve<PromotionsServiceImpl>('promotionsService')
      await cart.lock({ cartId: 'cart', checkoutSessionId: 'checkout', tenantId: auth.tenantId, organizationId: auth.orgId })
      await promotions.reserveCode({ codeString: 'SAVE', cartId: 'cart', customerId: null })
      expect(execute).toHaveBeenNthCalledWith(1, 'cart.lock', expect.objectContaining({
        ctx: expect.objectContaining({ container: caller, auth, selectedOrganizationId: auth.orgId }),
      }))
      expect(execute).toHaveBeenNthCalledWith(2, 'promotions.code.reserve', expect.objectContaining({
        ctx: expect.objectContaining({ container: caller, auth, selectedOrganizationId: auth.orgId }),
      }))
      const changedAuth = { ...auth, sub: `${auth.sub}-updated` }
      caller.register('auth', asValue(changedAuth))
      await promotions.reserveCode({ codeString: 'SAVE', cartId: 'cart', customerId: null })
      expect(execute).toHaveBeenLastCalledWith('promotions.code.reserve', expect.objectContaining({
        ctx: expect.objectContaining({ auth: changedAuth }),
      }))
    }))
    expect(callers[0].caller.resolve('cartService')).not.toBe(callers[1].caller.resolve('cartService'))
    expect(callers[0].caller.resolve('promotionCacheService')).not.toBe(callers[1].caller.resolve('promotionCacheService'))
  })
})
