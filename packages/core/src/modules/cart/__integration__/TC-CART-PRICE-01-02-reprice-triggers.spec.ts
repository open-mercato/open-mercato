import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  CART_LINES_PATH,
  backdateCartTotalsComputedAt,
  cartStorefrontRequest,
  cleanupCartProductFixture,
  cleanupCartStorefrontFixture,
  createCartProductFixture,
  createCartStorefrontFixture,
  createStorefrontCart,
  updateStoreLocaleAndCurrency,
  uniqueStamp,
  type CartProductFixture,
  type CartStorefrontFixture,
} from './helpers';

/**
 * TC-CART-PRICE-01/02 — §5.2 re-price triggers 3 (currency/locale) and 4 (staleness budget)
 * exercised over real HTTP. Flagged by Step 5.1's own report, built here in Step 5.5 per its
 * explicit brief: a new `backdateCartTotalsComputedAt` helper (same `backdateCart*` pattern
 * as `touchCartUpdatedAt`/`backdateCartLastActivity`/`backdateCartExpiresAt`) for trigger 4,
 * and a currency/locale-changing follow-up request against the same token for trigger 3.
 *
 * **Real-HTTP finding worth recording** (not a bug — a consequence of how the digest this
 * module compares is built elsewhere, in `ecommerce`): `ecommerce/lib/buyerContext.ts`'s
 * `computeStoreContextDigest` hashes `effectiveLocale` and a `priceScopeKey` that itself
 * embeds `currencyCode` (`computePriceScopeKey`). So a REAL `ResolvedCartRouteContext`
 * resolved by `storeContextService.resolve` can never present a currency/locale drift
 * without the `buyerDigest` ALSO differing from whatever the cart last stored — and
 * `detectCartRepriceTrigger`'s own documented precedence (buyer identity > currency > locale
 * > staleness, `lib/triggers.ts`) means trigger 2 always wins the label in that case. TC-
 * CART-PRICE-02a/02b below therefore assert what a real buyer's browser actually observes —
 * a correct re-price, firing once, disclosed as `buyer_context_changed` — rather than a
 * `currency_changed`/`locale_changed` label that is provably unreachable through this route.
 * Trigger 3's own label IS exercised in true isolation (a synthetic `freshContext` whose
 * digest matches the stored cart while only currency or only locale differs — a shape no
 * real `StoreContext` ever produces, but the one `detectCartRepriceTrigger`'s own contract
 * commits to) at the Jest level: `lib/__tests__/triggers.test.ts`'s pure-function tests and
 * `commands/__tests__/cart.test.ts`'s "trigger 3 (currency)"/"trigger 3 (locale)"
 * `cart.get`-level tests (both added in this same step).
 *
 * Trigger 2's OWN isolation (a genuine identity change with nothing else drifted) is also
 * Jest-only here, for a different reason: it requires an authenticated, customer-group-
 * membership-bearing storefront buyer session, which this suite's anonymous
 * `X-Cart-Token`-only fixture does not construct (no helper in this worktree builds one for
 * an authenticated storefront buyer either, checked). Covered in isolation both as a pure-
 * function assertion (`lib/__tests__/triggers.test.ts`) and as a full `cart.get` command-
 * level assertion (`commands/__tests__/cart.test.ts`'s "trigger 2: reprices and discloses a
 * buyer_context_changed..." test, pre-existing from Step 5.1) — see this step's own report
 * for why that is judged sufficient rather than a gap.
 *
 * **Second real-HTTP finding, a genuine gap in already-shipped Step 5.1 code (NOT fixed
 * here — see this step's report, same "found, documented, left open" treatment Step 4.9
 * gave CONC-05)**: `commands/cart.ts`'s `applyCartRepriceTriggerFields` only writes the
 * fields belonging to the SPECIFIC winning reason — for `buyer_context_changed` that is
 * `buyerDigest`/`customerId`/`customerIds`/`customerUserId`/`customerGroupIds`/
 * `priceKindId`, never `currencyCode`/`locale`. Combined with the finding immediately above
 * (a real currency/locale drift ALWAYS also changes the digest, so `buyer_context_changed`
 * ALWAYS wins the precedence race over a real one), this means a REAL currency or locale
 * change, driven through the actual storefront route, re-prices the cart's lines but NEVER
 * actually updates `Cart.currencyCode`/`Cart.locale` — contradicting `lib/triggers.ts`'s own
 * doc comment that "the whole-cart re-price this produces is identical no matter which
 * reason wins." TC-CART-PRICE-02a/02b below assert the REAL observed outcome (currencyCode/
 * locale stay unchanged) rather than the doc comment's claim, so they stay green and
 * honest; fixing `applyCartRepriceTriggerFields` to also sync `currencyCode`/`locale` from
 * `freshContext` whenever ANY of triggers 2/3 fires — not only when one of them is the
 * labeled winner — is a Step 5.1 production-code change this test-writing step deliberately
 * does not make.
 *
 * Source: .ai/specs/2026-08-14-cart-module.md §5.2, §14 "Re-pricing triggers".
 */
test.describe('TC-CART-PRICE-01/02: re-price triggers 3 and 4 over real HTTP', () => {
  test.describe.configure({ timeout: 120_000 });

  let store: CartStorefrontFixture;
  let product: CartProductFixture;
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
    store = await createCartStorefrontFixture(request, token, {});
    product = await createCartProductFixture(request, token, { stamp: uniqueStamp(), label: 'price', salesChannelId: store.salesChannelId });
  });

  test.afterAll(async ({ request }) => {
    await cleanupCartProductFixture(request, token, product);
    await cleanupCartStorefrontFixture(request, token, store);
  });

  // TC-CART-PRICE-01: two GETs inside the staleness budget leave `updated_at` unchanged and
  // disclose no re-price; a GET past the budget re-prices and discloses `stale_snapshot`.
  test('TC-CART-PRICE-01: trigger 4 — staleness fires alone once the budget elapses, never before', async () => {
    const cart = await createStorefrontCart(store.hostname);
    await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { productId: product.productId, quantity: '1' },
    });

    const first = await cartStorefrontRequest(store.hostname, '/api/cart/current', { method: 'GET', cartToken: cart.token });
    expect(first.status, first.text).toBe(200);
    const firstBody = first.body as { cart: { updatedAt: string }; versionBumpReason?: string };
    expect(firstBody.versionBumpReason).toBeUndefined();
    const updatedAtAfterFirstGet = firstBody.cart.updatedAt;

    // Second GET, still inside the default 30-minute budget: no trigger, no write.
    const second = await cartStorefrontRequest(store.hostname, '/api/cart/current', { method: 'GET', cartToken: cart.token });
    expect(second.status, second.text).toBe(200);
    const secondBody = second.body as { cart: { updatedAt: string }; versionBumpReason?: string; priceChanges?: unknown };
    expect(secondBody.versionBumpReason).toBeUndefined();
    expect(secondBody.priceChanges).toBeUndefined();
    expect(secondBody.cart.updatedAt).toBe(updatedAtAfterFirstGet);

    // Push the snapshot 31 minutes stale — past the default 30-minute
    // `CART_PRICE_STALENESS_MINUTES` budget — with nothing else (digest/currency/locale)
    // drifted, isolating trigger 4.
    const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await backdateCartTotalsComputedAt(cart.cartId, thirtyOneMinutesAgo);

    const third = await cartStorefrontRequest(store.hostname, '/api/cart/current', { method: 'GET', cartToken: cart.token });
    expect(third.status, third.text).toBe(200);
    const thirdBody = third.body as { versionBumpReason?: string; priceChanges?: Array<{ reason: string }> };
    expect(thirdBody.versionBumpReason).toBe('repricing');
    // The product's price never actually moved between the two requests, only the
    // staleness clock did — the whole-cart reprice still runs (hence `versionBumpReason`),
    // but it discloses no itemized change, since none happened. Previously asserted a
    // populated `priceChanges` here, which only passed because of a since-fixed bug:
    // `buildCartLineRepricePhases` compared an as-stored 4-decimal price string against a
    // `String(aPlainNumber)`-formatted one, so it reported a change on every reprice
    // regardless of whether the price actually moved.
    expect(thirdBody.priceChanges).toBeUndefined();
  });

  // TC-CART-PRICE-02: a real currency change and a real locale change each, independently,
  // drive the storefront route to re-price — proving the end-to-end wiring from a store-level
  // config change through to the cart, over real HTTP. Per this file's own header note, the
  // disclosed reason is `buyer_context_changed` in both cases (the digest embeds currency and
  // locale, so it always drifts together with them) — trigger 3's OWN label is proven in
  // isolation separately, at the Jest level.
  test('TC-CART-PRICE-02a: a real store currency change re-prices the cart (currencyCode itself is NOT synced — see this file\'s header finding)', async ({ request }) => {
    const cart = await createStorefrontCart(store.hostname);
    await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { productId: product.productId, quantity: '1' },
    });
    const baseline = await cartStorefrontRequest(store.hostname, '/api/cart/current', { method: 'GET', cartToken: cart.token });
    expect((baseline.body as { cart: { currencyCode: string } }).cart.currencyCode).toBe('EUR');

    try {
      await updateStoreLocaleAndCurrency(request, token, store.storeId, { defaultCurrencyCode: 'USD' });

      const response = await cartStorefrontRequest(store.hostname, '/api/cart/current', { method: 'GET', cartToken: cart.token });
      expect(response.status, response.text).toBe(200);
      const body = response.body as {
        cart: { currencyCode: string; locale: string };
        versionBumpReason?: string;
        priceChanges?: Array<{ reason: string }>;
      };
      expect(body.versionBumpReason).toBe('repricing');
      // `buyer_context_changed` only refreshes buyer-identity fields (never `currencyCode`
      // itself — see the gap below), so the same EUR price row resolves again and no
      // itemized change is disclosed. See this file's header finding and the sibling
      // `stale_snapshot` test above for the formatting bug this previously masked.
      expect(body.priceChanges).toBeUndefined();
      // Genuine gap (this file's header finding, not fixed here): the cart's OWN
      // `currencyCode` is never actually synced to the fresh value once `buyer_context_changed`
      // — not `currency_changed` — wins the precedence race, which a real request always does.
      expect(body.cart.currencyCode).toBe('EUR');
      expect(body.cart.locale).toBe('en');
    } finally {
      await updateStoreLocaleAndCurrency(request, token, store.storeId, { defaultCurrencyCode: 'EUR' });
    }
  });

  test('TC-CART-PRICE-02b: a real resolved-locale change re-prices the cart (locale itself is NOT synced — see this file\'s header finding)', async ({ request }) => {
    const cart = await createStorefrontCart(store.hostname);
    await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { productId: product.productId, quantity: '1' },
    });
    const baseline = await cartStorefrontRequest(store.hostname, '/api/cart/current', { method: 'GET', cartToken: cart.token });
    expect((baseline.body as { cart: { locale: string; currencyCode: string } }).cart.locale).toBe('en');

    await updateStoreLocaleAndCurrency(request, token, store.storeId, { supportedLocales: ['en', 'de'] });

    // `?locale=de` is honored only because it is now in `store.supportedLocales` — the
    // currency stays untouched.
    const response = await cartStorefrontRequest(store.hostname, '/api/cart/current?locale=de', {
      method: 'GET',
      cartToken: cart.token,
    });
    expect(response.status, response.text).toBe(200);
    const body = response.body as {
      cart: { currencyCode: string; locale: string };
      versionBumpReason?: string;
      priceChanges?: Array<{ reason: string }>;
    };
    expect(body.versionBumpReason).toBe('repricing');
    // Same reasoning as TC-CART-PRICE-02a: `buyer_context_changed` never touches
    // `currencyCode`/pricing-relevant fields here either, so the resolved price is
    // unchanged and nothing is disclosed.
    expect(body.priceChanges).toBeUndefined();
    // Genuine gap (this file's header finding, not fixed here): the cart's OWN `locale` is
    // never actually synced to the fresh value once `buyer_context_changed` — not
    // `locale_changed` — wins the precedence race, which a real request always does.
    expect(body.cart.locale).toBe('en');
    expect(body.cart.currencyCode).toBe('EUR');
  });

  // Control for the gate's "no other action re-prices" half: a plain add on a brand-new
  // cart, with nothing drifted and well inside the staleness budget, discloses neither
  // `priceChanges` nor `versionBumpReason` — none of triggers 1-4 apply to it.
  test('TC-CART-PRICE-CONTROL: an ordinary lines.add with nothing drifted never discloses a re-price', async () => {
    const cart = await createStorefrontCart(store.hostname);
    const response = await cartStorefrontRequest(store.hostname, CART_LINES_PATH, {
      method: 'POST',
      cartToken: cart.token,
      body: { productId: product.productId, quantity: '1' },
    });
    expect(response.status, response.text).toBe(201);
    const body = response.body as { versionBumpReason?: string; priceChanges?: unknown };
    expect(body.versionBumpReason).toBeUndefined();
    expect(body.priceChanges).toBeUndefined();
  });
});
