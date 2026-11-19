import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  PROMOTIONS_PATH,
  createCodeFixture,
  deleteCodeIfExists,
  deletePromotionIfExists,
  getPromotionDetail,
  promotionTreePath,
} from '../../promotions/__integration__/helpers';
import type { CartResponseEnvelope, CartView } from '../lib/cartView';
import {
  CART_CURRENT_PATH,
  CART_LINES_PATH,
  CART_PROMOTIONS_PATH,
  cartStorefrontRequest,
  cleanupCartProductFixture,
  cleanupCartStorefrontFixture,
  createCartProductFixture,
  createCartStorefrontFixture,
  createStorefrontCart,
  deleteCartRowIfExists,
  uniqueStamp,
  type CartProductFixture,
  type CartStorefrontFixture,
} from './helpers';

const DISCOUNT_PERCENT = 10;

const scenarios = [
  { name: 'single tax rate', secondPrice: { unitPriceGross: 60, taxRate: 20 } },
  { name: 'mixed tax rates', secondPrice: { unitPriceGross: 55, taxRate: 10 } },
];

function expectTotals(totals: CartView['totals'], net: number, gross: number, tax: number) {
  expect(totals.subtotalNetAmount, 'net subtotal').toBeCloseTo(net, 4);
  expect(totals.grandTotalGrossAmount, 'gross grand total').toBeCloseTo(gross, 4);
  expect(totals.taxTotalAmount, 'tax total').toBeCloseTo(tax, 4);
}

for (const { name, secondPrice } of scenarios) {
  test(`TC-CART-TOT-06: percentage order discount reduces gross-priced cart tax with ${name}`, async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const codeString = `QA-TOT-06-${stamp}`.toUpperCase();
    const lines = [
      { unitPriceGross: 120, taxRate: 20, quantity: 2 },
      { ...secondPrice, quantity: 3 },
    ];
    const gross = lines.reduce((total, line) => total + line.unitPriceGross * line.quantity, 0);
    const net = lines.reduce(
      (total, line) => total + line.unitPriceGross * line.quantity * 100 / (100 + line.taxRate),
      0,
    );
    const tax = gross - net;
    const netDiscount = net * DISCOUNT_PERCENT / 100;
    const grossDiscount = gross * DISCOUNT_PERCENT / 100;
    const taxDiscount = grossDiscount - netDiscount;

    let store: CartStorefrontFixture | null = null;
    let cart: Awaited<ReturnType<typeof createStorefrontCart>> | null = null;
    let promotionId: string | null = null;
    let codeId: string | null = null;
    const products: CartProductFixture[] = [];

    try {
      store = await createCartStorefrontFixture(request, token);
      const code = await createCodeFixture(request, token, { code: codeString });
      codeId = code.id;
      const promotionResponse = await apiRequest(request, 'POST', PROMOTIONS_PATH, {
        token,
        data: { name: `QA Cart Tax ${stamp}`, order: 0, active: true, eligibleCurrencies: ['EUR'] },
      });
      expect(promotionResponse.status(), await promotionResponse.text()).toBe(201);
      promotionId = expectId((await readJsonSafe<{ id?: string }>(promotionResponse))?.id, 'promotion id');
      const promotion = await getPromotionDetail(request, token, promotionId);
      const rootId = expectId(promotion.ruleGroupTree?.id, 'promotion root group id');
      const treeResponse = await apiRequest(request, 'PUT', promotionTreePath(promotionId), {
        token,
        data: {
          updatedAt: promotion.updatedAt,
          root: {
            id: rootId,
            operator: 'and',
            sortOrder: 0,
            children: [],
            rules: [{ ruleType: 'code', config: { codeId } }],
            benefits: [{
              benefitType: 'cart_discount',
              appliesTo: 'order',
              config: {
                discountType: 'percentage',
                value: String(DISCOUNT_PERCENT),
                maxDiscount: null,
                labels: { en: `${DISCOUNT_PERCENT}% off` },
              },
            }],
          },
        },
      });
      expect(treeResponse.status(), await treeResponse.text()).toBe(200);

      cart = await createStorefrontCart(store.hostname);
      for (const [index, { quantity, ...grossPrice }] of lines.entries()) {
        const product = await createCartProductFixture(request, token, {
          stamp,
          label: `tot-06-${index}`,
          salesChannelId: store.salesChannelId,
          grossPrice,
        });
        products.push(product);
        const add = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
          method: 'POST',
          cartToken: cart.token,
          body: { productId: product.productId, quantity: String(quantity) },
        });
        expect(add.status, add.text).toBe(201);
      }

      const before = await cartStorefrontRequest(store.hostname, CART_CURRENT_PATH, {
        method: 'GET',
        cartToken: cart.token,
      });
      expect(before.status, before.text).toBe(200);
      const { cart: original } = before.body as CartResponseEnvelope;
      expect(original.taxMode).toBe('gross');
      expect(original.promotions).toEqual([]);
      expectTotals(original.totals, net, gross, tax);

      const apply = await cartStorefrontRequest(store.hostname, CART_PROMOTIONS_PATH, {
        method: 'POST',
        cartToken: cart.token,
        body: { codeString },
      });
      expect(apply.status, apply.text).toBe(200);
      const { cart: discounted } = apply.body as CartResponseEnvelope;
      expect(discounted.promotions).toHaveLength(1);
      const [adjustment] = discounted.promotions;
      expect(adjustment).toMatchObject({ promotionId, code: codeString, scope: 'order', cartLineId: null });
      expect(Number(adjustment.amountNet), 'signed promotion net amount').toBeCloseTo(-netDiscount, 4);
      expect(Number(adjustment.amountGross), 'signed promotion gross amount').toBeCloseTo(-grossDiscount, 4);
      expectTotals(discounted.totals, net - netDiscount, gross - grossDiscount, tax - taxDiscount);
    } finally {
      if (cart && store && promotionId) {
        await cartStorefrontRequest(store.hostname, `${CART_PROMOTIONS_PATH}/${promotionId}`, {
          method: 'DELETE',
          cartToken: cart.token,
        }).catch(() => undefined);
      }
      if (cart) await deleteCartRowIfExists(cart.cartId);
      await deletePromotionIfExists(request, token, promotionId);
      await deleteCodeIfExists(request, token, codeId);
      for (const product of products) await cleanupCartProductFixture(request, token, product);
      await cleanupCartStorefrontFixture(request, token, store);
    }
  });
}
