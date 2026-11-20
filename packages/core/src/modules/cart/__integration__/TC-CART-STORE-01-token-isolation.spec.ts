import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  CART_CURRENT_PATH,
  CART_LINES_PATH,
  CART_PROMOTIONS_PATH,
  cartStorefrontRequest,
  cleanupCartStorefrontFixture,
  cleanupSecondTenantCartActor,
  createCartStorefrontFixture,
  createSecondTenantCartActor,
  createStorefrontCart,
  deleteCartRowIfExists,
  uniqueStamp,
  type CartStorefrontFixture,
  type SecondTenantCartActor,
} from './helpers'

export const integrationMeta = {
  dependsOnModules: ['cart', 'ecommerce', 'customer_accounts', 'sales'],
}

test('TC-CART-STORE-01: another store cannot read, reprice or mutate a cart in the same organization', async ({ request }) => {
  const setupToken = await getAuthToken(request, 'superadmin')
  let actor: SecondTenantCartActor | null = null
  let storeA: CartStorefrontFixture | null = null
  let storeB: CartStorefrontFixture | null = null
  let cartA: { cartId: string; token: string } | null = null
  let cartB: { cartId: string; token: string } | null = null

  try {
    actor = await createSecondTenantCartActor(request, setupToken, uniqueStamp())
    storeA = await createCartStorefrontFixture(request, actor.token)
    storeB = await createCartStorefrontFixture(request, actor.token)
    expect(storeA.organizationId).toBe(storeB.organizationId)
    expect(storeA.storeId).not.toBe(storeB.storeId)
    cartA = await createStorefrontCart(storeA.hostname)
    cartB = await createStorefrontCart(storeB.hostname)

    for (const [store, cart] of [[storeA, cartA], [storeB, cartB]] as const) {
      const control = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, {
        method: 'GET',
        cartToken: cart.token,
      })
      expect(control.status, control.text).toBe(200)
    }

    const before = await withClient(async (client) => {
      const result = await client.query<Record<string, unknown>>(
        'select * from carts where id = $1 and tenant_id = $2 and organization_id = $3',
        [cartA!.cartId, storeA!.tenantId, storeA!.organizationId],
      )
      return result.rows[0]
    })
    expect(before).toBeDefined()

    const attempts = [
      { method: 'GET', path: CART_CURRENT_PATH },
      { method: 'POST', path: CART_PROMOTIONS_PATH, body: { codeString: 'QA-cross-store' } },
      { method: 'POST', path: CART_LINES_PATH, body: { productId: randomUUID(), quantity: '1' } },
    ]

    for (const attempt of attempts) {
      const crossStore = await cartStorefrontRequest(storeB.hostname, attempt.path, {
        method: attempt.method as 'GET' | 'POST',
        cartToken: cartA.token,
        body: attempt.body,
      })
      const unknown = await cartStorefrontRequest(storeB.hostname, attempt.path, {
        method: attempt.method as 'GET' | 'POST',
        cartToken: randomUUID(),
        body: attempt.body,
      })
      expect(crossStore.status, crossStore.text).toBe(404)
      expect(unknown.status, unknown.text).toBe(404)
      expect(crossStore.body).toEqual(unknown.body)
    }

    const after = await withClient(async (client) => {
      const result = await client.query<Record<string, unknown>>(
        'select * from carts where id = $1 and tenant_id = $2 and organization_id = $3',
        [cartA!.cartId, storeA!.tenantId, storeA!.organizationId],
      )
      return result.rows[0]
    })
    expect(after).toEqual(before)
    const ownStore = await cartStorefrontRequest(storeA.hostname, CART_CURRENT_PATH, {
      method: 'GET',
      cartToken: cartA.token,
    })
    expect(ownStore.status, ownStore.text).toBe(200)
  } finally {
    if (cartB) await deleteCartRowIfExists(cartB.cartId)
    if (cartA) await deleteCartRowIfExists(cartA.cartId)
    if (storeB && actor) await cleanupCartStorefrontFixture(request, actor.token, storeB)
    if (storeA && actor) await cleanupCartStorefrontFixture(request, actor.token, storeA)
    await cleanupSecondTenantCartActor(request, setupToken, actor)
  }
})

