import { expect, type Locator, type Page } from '@playwright/test';
import { apiRequest, getAuthToken } from './api';

type DocumentKind = 'quote' | 'order';

type CreateDocumentOptions = {
  kind: DocumentKind;
  customerQuery?: string;
  channelQuery?: string;
  preferApi?: boolean;
  token?: string;
};

type ChannelListItem = {
  id?: string | null;
  name?: string | null;
  code?: string | null;
  isActive?: boolean | null;
};

type CustomerAddressListItem = {
  id?: string | null;
  name?: string | null;
  purpose?: string | null;
  company_name?: string | null;
  companyName?: string | null;
  address_line1?: string | null;
  addressLine1?: string | null;
  address_line2?: string | null;
  addressLine2?: string | null;
  building_number?: string | null;
  buildingNumber?: string | null;
  flat_number?: string | null;
  flatNumber?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

type DocumentAddressPayload = {
  customerAddressId?: string;
  name?: string;
  purpose?: string;
  companyName?: string;
  addressLine1: string;
  addressLine2?: string;
  buildingNumber?: string;
  flatNumber?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

type SalesOrderLineListItem = {
  id?: string | null;
};

type PaymentMethodListItem = {
  id?: string | null;
  name?: string | null;
  code?: string | null;
  isActive?: boolean | null;
};

type AddLineOptions = {
  name: string;
  quantity: number;
  unitPriceGross: number;
  taxClassName?: string;
};

type AddAdjustmentOptions = {
  label: string;
  kindLabel?: string;
  netAmount: number;
};

const TEST_WAIT_TIMEOUT_MS = 10_000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCurrencyAmount(value: string): number {
  const normalized = value.replace(/,/g, '');
  const matches = normalized.match(/-?\$[0-9]+(?:\.[0-9]{2})?/g);
  const lastMatch = matches?.[matches.length - 1];
  if (!lastMatch) {
    throw new Error(`Could not parse currency from: ${value}`);
  }
  return Number.parseFloat(lastMatch.replace('$', ''));
}

function normalizeAdjustmentKindValue(kindLabel: string): string {
  return kindLabel.trim().toLowerCase().replace(/\s+/g, '_');
}

function readId(payload: unknown, keys: string[]): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const map = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = map[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  for (const value of Object.values(map)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = readId(value, keys);
      if (nested) return nested;
    }
  }
  return null;
}

function readListItems<T>(payload: { result?: { items?: T[] }; items?: T[] } | null): T[] {
  return Array.isArray(payload?.result?.items)
    ? payload.result.items
    : Array.isArray(payload?.items)
      ? payload.items
      : [];
}

function resolveOrderIdFromPage(page: Page): string | null {
  const match = page.url().match(/\/backend\/sales\/(?:documents|orders)\/([0-9a-f-]{36})/i);
  return match?.[1] ?? null;
}

async function ensureSalesDocumentFixtures(
  page: Page,
  options: CreateDocumentOptions,
): Promise<{
  customerQuery: string;
  channelQuery: string;
  customerEntityId?: string | null;
  channelId?: string | null;
  customerAddressId?: string | null;
  authToken?: string | null;
}> {
  let customerQuery = options.customerQuery;
  let channelQuery = options.channelQuery;
  let customerEntityId: string | null = null;
  let channelId: string | null = null;
  let customerAddressId: string | null = null;

  if (customerQuery && channelQuery) {
    return { customerQuery, channelQuery, authToken: options.token ?? null };
  }

  const token = await getAuthToken(page.request, 'admin').catch(() => null);
  if (!token) {
    if (!customerQuery) {
      customerQuery = `QA Sales Customer ${Date.now()}`;
      await page.goto('/backend/customers/companies/create');
      await page.locator('form').getByRole('textbox').first().fill(customerQuery);
      await page.getByPlaceholder('https://example.com').fill('https://example.com');
      await page.locator('form').getByRole('button', { name: /Create Company/i }).click();
      await expect(page).toHaveURL(/\/backend\/customers\/companies\/[0-9a-f-]{36}$/i);
    }
    if (!channelQuery) {
      const timestamp = Date.now();
      channelQuery = `QA Sales Channel ${timestamp}`;
      const channelCode = `qa-sales-channel-${timestamp}`;
      await page.goto('/backend/sales/channels');
      await page.getByRole('link', { name: /Add channel/i }).click();
      const createForm = page.locator('form').first();
      await createForm.getByRole('textbox').nth(0).fill(channelQuery);
      await createForm.getByRole('textbox').nth(1).fill(channelCode);
      await page.getByRole('button', { name: /Create channel|Create/i }).last().click();
      await expect(page).toHaveURL(/\/backend\/sales\/channels$/i);
    }
    return {
      customerQuery,
      channelQuery,
      authToken: options.token ?? null,
    };
  }

  if (!customerQuery) {
    const companyName = `QA Sales Customer ${Date.now()}`;
    const companyResponse = await apiRequest(page.request, 'POST', '/api/customers/companies', {
      token,
      data: { displayName: companyName },
    }).catch(() => null);
    if (companyResponse && companyResponse.ok()) {
      const companyBody = (await companyResponse.json().catch(() => null)) as unknown;
      customerEntityId = readId(companyBody, ['id', 'entityId', 'companyId']);
      if (customerEntityId) {
        await apiRequest(page.request, 'POST', '/api/customers/addresses', {
          token,
          data: {
            entityId: customerEntityId,
            name: 'Primary',
            purpose: 'Shipping',
            addressLine1: '100 QA Street',
            city: 'Austin',
            postalCode: '78701',
            country: 'US',
            isPrimary: true,
          },
        }).then(async (response) => {
          const body = (await response.json().catch(() => null)) as unknown;
          customerAddressId = readId(body, ['id', 'addressId']);
        }).catch(() => {});
        customerQuery = companyName;
      }
    }
    if (!customerQuery) {
      customerQuery = 'Copperleaf';
    }
  }

  if (!channelQuery) {
    const existingChannelsResponse = await apiRequest(
      page.request,
      'GET',
      '/api/sales/channels?page=1&pageSize=20&isActive=true',
      { token },
    ).catch(() => null);
    const existingChannelsBody = (await existingChannelsResponse?.json().catch(() => null)) as { items?: ChannelListItem[] } | null;
    const existingChannels = Array.isArray(existingChannelsBody?.items) ? existingChannelsBody.items : [];
    const preferredExistingChannel =
      existingChannels.find((item) => item.code === 'online' && item.isActive !== false) ??
      existingChannels.find((item) => item.isActive !== false);
    if (preferredExistingChannel?.name) {
      channelQuery = preferredExistingChannel.name;
      channelId = preferredExistingChannel.id ?? null;
    } else {
      const timestamp = Date.now();
      const channelName = `QA Sales Channel ${timestamp}`;
      const channelCode = `qa-sales-channel-${timestamp}`;
      const channelResponse = await apiRequest(page.request, 'POST', '/api/sales/channels', {
        token,
        data: {
          name: channelName,
          code: channelCode,
        },
      }).catch(() => null);
      if (channelResponse && channelResponse.ok()) {
        channelQuery = channelName;
        const channelBody = (await channelResponse.json().catch(() => null)) as unknown;
        channelId = readId(channelBody, ['id', 'channelId']);
      } else {
        channelQuery = 'online';
      }
    }
  }

  return {
    customerQuery: customerQuery ?? 'Copperleaf',
    channelQuery: channelQuery ?? 'online',
    customerEntityId,
    channelId,
    customerAddressId,
    authToken: token,
  };
}

async function selectFirstAddressIfAvailable(page: Page): Promise<void> {
  // Radix Select: trigger has placeholder text "Select address" rendered inside
  const addressTrigger = page
    .locator('[role="combobox"]')
    .filter({ hasText: /Select address/i })
    .first();
  if ((await addressTrigger.count()) === 0) return;
  if (!(await addressTrigger.isEnabled().catch(() => false))) return;

  await addressTrigger.click();
  // Pick the first available option from the portal-rendered listbox
  const firstOption = page.getByRole('option').first();
  if ((await firstOption.count()) === 0) {
    // Close listbox if no options
    await page.keyboard.press('Escape');
    return;
  }
  await firstOption.click();
}

async function ensureShippingMethodFixture(page: Page): Promise<void> {
  const token = await getAuthToken(page.request, 'admin').catch(() => null);
  if (!token) return;

  const existing = await apiRequest(
    page.request,
    'GET',
    '/api/sales/shipping-methods?page=1&pageSize=1&isActive=true',
    { token },
  ).catch(() => null);
  const existingBody = (await existing?.json().catch(() => null)) as { result?: { items?: unknown[] } } | null;
  const existingItems = Array.isArray(existingBody?.result?.items) ? existingBody?.result?.items : [];
  if (existingItems.length > 0) return;

  const stamp = Date.now();
  await apiRequest(page.request, 'POST', '/api/sales/shipping-methods', {
    token,
    data: {
      name: `QA Shipping Method ${stamp}`,
      code: `qa-shipping-${stamp}`,
      isActive: true,
      currencyCode: 'USD',
      baseRateNet: '10.00',
      baseRateGross: '10.00',
    },
  }).catch(() => {});
}

function lookupRootFromInput(input: Locator): Locator {
  return input.locator('xpath=ancestor::div[contains(@class,"space-y-3")][1]');
}

async function waitForLookupIdle(root: Locator): Promise<void> {
  await root
    .getByText(/Searching…|Searching\.\.\.|Loading…|Loading\.\.\./i)
    .first()
    .waitFor({ state: 'hidden', timeout: 1_200 })
    .catch(() => {});
}

async function waitForOptionalTextToDisappear(scope: Locator, pattern: RegExp, timeout = 2_500): Promise<void> {
  await scope.getByText(pattern).first().waitFor({ state: 'hidden', timeout }).catch(() => {});
}

async function waitForStableVisibility(locator: Locator, timeout = TEST_WAIT_TIMEOUT_MS): Promise<void> {
  await expect(locator).toBeVisible({ timeout });
  let stableChecks = 0;
  const deadline = Date.now() + Math.min(timeout, 2_000);
  while (Date.now() < deadline) {
    if (await locator.isVisible().catch(() => false)) {
      stableChecks += 1;
      if (stableChecks >= 3) return;
    } else {
      stableChecks = 0;
    }
    await locator.page().waitForTimeout(50).catch(() => {});
  }
}

async function waitForDialogFieldReady(
  dialog: Locator,
  field: Locator,
  loadingPattern?: RegExp,
): Promise<void> {
  await expect(dialog).toBeVisible({ timeout: TEST_WAIT_TIMEOUT_MS });
  if (loadingPattern) {
    await waitForOptionalTextToDisappear(dialog, loadingPattern, TEST_WAIT_TIMEOUT_MS);
  }
  await waitForStableVisibility(field, TEST_WAIT_TIMEOUT_MS);
  await field.scrollIntoViewIfNeeded().catch(() => {});
}

async function recoverGenericErrorPageIfPresent(page: Page): Promise<boolean> {
  const errorHeading = page.getByRole('heading', { name: /^Something went wrong$/i }).first();
  if (!(await errorHeading.isVisible().catch(() => false))) return false;
  const retryButton = page.getByRole('button', { name: /Try again/i }).first();
  if (await retryButton.isVisible().catch(() => false)) {
    await retryButton.click().catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  } else {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  return true;
}

async function resolveCustomerEntityId(
  page: Page,
  token: string,
  customerQuery: string,
): Promise<string | null> {
  const params = new URLSearchParams({ page: '1', pageSize: '5', search: customerQuery });
  const response = await apiRequest(page.request, 'GET', `/api/customers/companies?${params.toString()}`, { token }).catch(() => null);
  const body = (await response?.json().catch(() => null)) as {
    result?: { items?: Array<Record<string, unknown>> };
    items?: Array<Record<string, unknown>>;
  } | null;
  const items = Array.isArray(body?.result?.items)
    ? body.result.items
    : Array.isArray(body?.items)
      ? body.items
      : [];
  const exactMatch = items.find((item) => {
    const displayName = typeof item.displayName === 'string'
      ? item.displayName
      : typeof item.display_name === 'string'
        ? item.display_name
        : '';
    return displayName.trim().toLowerCase() === customerQuery.trim().toLowerCase();
  }) ?? items[0];
  return exactMatch ? readId(exactMatch, ['id', 'entityId', 'companyId']) : null;
}

function toDocumentAddressPayload(address: CustomerAddressListItem): DocumentAddressPayload | null {
  const addressLine1 = typeof address.addressLine1 === 'string'
    ? address.addressLine1
    : typeof address.address_line1 === 'string'
      ? address.address_line1
      : null;
  if (!addressLine1) return null;
  return {
    customerAddressId: typeof address.id === 'string' ? address.id : undefined,
    name: typeof address.name === 'string' ? address.name : undefined,
    purpose: typeof address.purpose === 'string' ? address.purpose : undefined,
    companyName: typeof address.companyName === 'string'
      ? address.companyName
      : typeof address.company_name === 'string'
        ? address.company_name
        : undefined,
    addressLine1,
    addressLine2: typeof address.addressLine2 === 'string'
      ? address.addressLine2
      : typeof address.address_line2 === 'string'
        ? address.address_line2
        : undefined,
    buildingNumber: typeof address.buildingNumber === 'string'
      ? address.buildingNumber
      : typeof address.building_number === 'string'
        ? address.building_number
        : undefined,
    flatNumber: typeof address.flatNumber === 'string'
      ? address.flatNumber
      : typeof address.flat_number === 'string'
        ? address.flat_number
        : undefined,
    city: typeof address.city === 'string' ? address.city : undefined,
    region: typeof address.region === 'string' ? address.region : undefined,
    postalCode: typeof address.postalCode === 'string'
      ? address.postalCode
      : typeof address.postal_code === 'string'
        ? address.postal_code
        : undefined,
    country: typeof address.country === 'string' ? address.country : undefined,
  };
}

async function ensureCustomerAddressFixture(
  page: Page,
  token: string,
  customerEntityId: string,
  preferredAddressId?: string | null,
): Promise<DocumentAddressPayload | null> {
  const existingResponse = await apiRequest(
    page.request,
    'GET',
    `/api/customers/addresses?page=1&pageSize=20&entityId=${customerEntityId}`,
    { token },
  ).catch(() => null);
  const existingBody = (await existingResponse?.json().catch(() => null)) as {
    result?: { items?: CustomerAddressListItem[] };
    items?: CustomerAddressListItem[];
  } | null;
  const existingItems = Array.isArray(existingBody?.result?.items)
    ? existingBody.result.items
    : Array.isArray(existingBody?.items)
      ? existingBody.items
      : [];
  const preferredAddress = existingItems.find((item) => item.id === preferredAddressId)
    ?? existingItems.find((item) => item.purpose?.toLowerCase() === 'shipping')
    ?? existingItems[0];
  const preferredPayload = preferredAddress ? toDocumentAddressPayload(preferredAddress) : null;
  if (preferredPayload) return preferredPayload;

  const createResponse = await apiRequest(page.request, 'POST', '/api/customers/addresses', {
    token,
    data: {
      entityId: customerEntityId,
      name: 'Primary',
      purpose: 'Shipping',
      addressLine1: '100 QA Street',
      city: 'Austin',
      postalCode: '78701',
      country: 'US',
      isPrimary: true,
    },
  }).catch(() => null);
  const createBody = (await createResponse?.json().catch(() => null)) as unknown;
  const createdAddressId = readId(createBody, ['id', 'addressId']);
  if (!createResponse?.ok() || !createdAddressId) return null;
  return {
    customerAddressId: createdAddressId,
    name: 'Primary',
    purpose: 'Shipping',
    addressLine1: '100 QA Street',
    city: 'Austin',
    postalCode: '78701',
    country: 'US',
  };
}

async function resolveSalesChannelId(page: Page, token: string, channelQuery: string): Promise<string | null> {
  const resolveItems = async (search?: string): Promise<ChannelListItem[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '5', isActive: 'true' });
    if (search && search.trim().length > 0) params.set('search', search.trim());
    const response = await apiRequest(page.request, 'GET', `/api/sales/channels?${params.toString()}`, {
      token,
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { result?: { items?: ChannelListItem[] }; items?: ChannelListItem[] } | null;
    return Array.isArray(body?.result?.items)
      ? body.result.items
      : Array.isArray(body?.items)
        ? body.items
        : [];
  };
  const initialItems = await resolveItems(channelQuery);
  const items = initialItems.length > 0 ? initialItems : await resolveItems();
  const normalizedQuery = channelQuery.trim().toLowerCase();
  const exactMatch = items.find((item) => item.name?.trim().toLowerCase() === normalizedQuery)
    ?? items.find((item) => item.code?.trim().toLowerCase() === normalizedQuery)
    ?? items.find((item) => item.code === 'online')
    ?? items[0];
  return exactMatch?.id ?? null;
}

async function resolveOrderLineId(page: Page, token: string, orderId: string): Promise<string | null> {
  const response = await apiRequest(page.request, 'GET', `/api/sales/order-lines?page=1&pageSize=20&orderId=${orderId}`, {
    token,
  }).catch(() => null);
  const body = (await response?.json().catch(() => null)) as {
    result?: { items?: SalesOrderLineListItem[] };
    items?: SalesOrderLineListItem[];
  } | null;
  const items = readListItems(body);
  return items.find((item) => typeof item.id === 'string' && item.id.length > 0)?.id ?? null;
}

async function resolveShippingMethodId(page: Page, token: string): Promise<string | null> {
  const response = await apiRequest(
    page.request,
    'GET',
    '/api/sales/shipping-methods?page=1&pageSize=20&isActive=true',
    { token },
  ).catch(() => null);
  const body = (await response?.json().catch(() => null)) as {
    result?: { items?: ChannelListItem[] };
    items?: ChannelListItem[];
  } | null;
  const items = readListItems(body);
  const preferred = items.find((item) => item.code === 'standard-ground')
    ?? items.find((item) => item.name?.toLowerCase().includes('standard'))
    ?? items[0];
  return preferred?.id ?? null;
}

async function resolvePaymentMethodId(page: Page, token: string): Promise<string | null> {
  const response = await apiRequest(
    page.request,
    'GET',
    '/api/sales/payment-methods?page=1&pageSize=20&isActive=true',
    { token },
  ).catch(() => null);
  const body = (await response?.json().catch(() => null)) as {
    result?: { items?: PaymentMethodListItem[] };
    items?: PaymentMethodListItem[];
  } | null;
  const items = readListItems(body);
  const preferred = items.find((item) => item.code === 'bank-transfer')
    ?? items.find((item) => item.name?.toLowerCase().includes('bank'))
    ?? items[0];
  return preferred?.id ?? null;
}

async function refreshSalesDocumentPage(page: Page, activeTabName: 'Shipments' | 'Payments'): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await ensureSalesDocumentReady(page);
  const tab = page.getByRole('button', { name: new RegExp(`^${activeTabName}$`, 'i') }).first();
  await waitForStableVisibility(tab, TEST_WAIT_TIMEOUT_MS).catch(() => {});
  await tab.click().catch(() => {});
}

async function addShipmentViaApi(
  page: Page,
  shipmentNumber: string,
  trackingNumber: string,
): Promise<boolean> {
  const token = await getAuthToken(page.request, 'admin').catch(() => null);
  const orderId = resolveOrderIdFromPage(page);
  if (!token || !orderId) return false;
  const [orderLineId, shippingMethodId] = await Promise.all([
    resolveOrderLineId(page, token, orderId),
    resolveShippingMethodId(page, token),
  ]);
  if (!orderLineId) return false;
  const response = await apiRequest(page.request, 'POST', '/api/sales/shipments', {
    token,
    data: {
      orderId,
      shipmentNumber,
      ...(shippingMethodId ? { shippingMethodId } : {}),
      trackingNumbers: [trackingNumber],
      shippedAt: new Date().toISOString(),
      currencyCode: 'USD',
      items: [{ orderLineId, quantity: '1' }],
    },
  }).catch(() => null);
  if (!response?.ok()) return false;
  await refreshSalesDocumentPage(page, 'Shipments');
  return true;
}

async function addPaymentViaApi(page: Page, amount: number): Promise<boolean> {
  const token = await getAuthToken(page.request, 'admin').catch(() => null);
  const orderId = resolveOrderIdFromPage(page);
  if (!token || !orderId) return false;
  const paymentMethodId = await resolvePaymentMethodId(page, token);
  const response = await apiRequest(page.request, 'POST', '/api/sales/payments', {
    token,
    data: {
      orderId,
      ...(paymentMethodId ? { paymentMethodId } : {}),
      amount: amount.toFixed(2),
      currencyCode: 'USD',
      receivedAt: new Date().toISOString(),
    },
  }).catch(() => null);
  if (!response?.ok()) return false;
  await refreshSalesDocumentPage(page, 'Payments');
  return true;
}

async function createSalesDocumentFixture(
  page: Page,
  token: string,
  kind: DocumentKind,
  customerQuery: string,
  channelQuery: string,
  ids?: { customerEntityId?: string | null; channelId?: string | null; customerAddressId?: string | null },
): Promise<string> {
  const customerEntityId =
    ids?.customerEntityId ??
    await resolveCustomerEntityId(page, token, customerQuery);
  const channelId =
    ids?.channelId ??
    await resolveSalesChannelId(page, token, channelQuery);
  const payload: Record<string, unknown> = {
    currencyCode: 'USD',
  };
  if (customerEntityId) payload.customerEntityId = customerEntityId;
  if (channelId) payload.channelId = channelId;

  const response = await apiRequest(page.request, 'POST', kind === 'quote' ? '/api/sales/quotes' : '/api/sales/orders', {
    token,
    data: payload,
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok()) {
    throw new Error(`Failed to create sales ${kind} fixture via API.`);
  }
  const id = readId(body, ['id', kind === 'quote' ? 'quoteId' : 'orderId']);
  if (!id) {
    throw new Error(`Missing sales ${kind} id in API fallback response.`);
  }

  if (customerEntityId) {
    const address = await ensureCustomerAddressFixture(page, token, customerEntityId, ids?.customerAddressId);
    if (address) {
      await apiRequest(page.request, 'POST', '/api/sales/document-addresses', {
        token,
        data: {
          documentId: id,
          documentKind: kind,
          ...address,
        },
      }).catch(() => {});
    }
  }

  return id;
}

async function waitForDocumentLoaded(page: Page, timeout = TEST_WAIT_TIMEOUT_MS): Promise<boolean> {
  const itemsButton = page.getByRole('button', { name: /^Items$/i }).first();
  if (await itemsButton.isVisible().catch(() => false)) return true;
  const loadingIndicator = page.getByText(/Loading document…|Loading document\.\.\./i).first();
  const isLoading = await loadingIndicator.isVisible().catch(() => false);
  if (isLoading) {
    await loadingIndicator.waitFor({ state: 'hidden', timeout }).catch(() => {});
  }
  return await itemsButton.waitFor({ state: 'visible', timeout: Math.min(timeout, 5_000) }).then(() => true).catch(() => false);
}

async function openSalesDocumentPage(page: Page, id: string, kind: DocumentKind): Promise<void> {
  const documentUrl = `/backend/sales/documents/${id}?kind=${kind}`;
  await page.goto(documentUrl, { waitUntil: 'domcontentloaded' });

  if (await waitForDocumentLoaded(page, TEST_WAIT_TIMEOUT_MS)) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const recovered = await recoverGenericErrorPageIfPresent(page);
    if (recovered) {
      if (await waitForDocumentLoaded(page, TEST_WAIT_TIMEOUT_MS)) return;
      continue;
    }
    await page.goto(documentUrl, { waitUntil: 'domcontentloaded' });
    if (await waitForDocumentLoaded(page, TEST_WAIT_TIMEOUT_MS)) return;
  }
  await expect(page.getByRole('button', { name: /^Items$/i }).first()).toBeVisible({
    timeout: TEST_WAIT_TIMEOUT_MS,
  });
}

async function ensureSalesDocumentReady(page: Page): Promise<void> {
  if (await waitForDocumentLoaded(page, TEST_WAIT_TIMEOUT_MS)) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const recovered = await recoverGenericErrorPageIfPresent(page);
    if (recovered) {
      if (await waitForDocumentLoaded(page, TEST_WAIT_TIMEOUT_MS)) return;
      continue;
    }
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    if (await waitForDocumentLoaded(page, TEST_WAIT_TIMEOUT_MS)) return;
  }
  await expect(page.getByRole('button', { name: /^Items$/i }).first()).toBeVisible({
    timeout: TEST_WAIT_TIMEOUT_MS,
  });
}

async function selectAnyLookupOption(root: Locator): Promise<boolean> {
  const selectButton = root.getByRole('button', { name: /^Select$/i }).first();
  if (await selectButton.isVisible().catch(() => false)) {
    await selectButton.click().catch(() => {});
    return true;
  }

  const row = root.locator('[role="button"]').first();
  if (await row.isVisible().catch(() => false)) {
    await row.click().catch(() => {});
    return true;
  }

  return false;
}

async function selectLookupValue(
  input: Locator,
  query: string,
  preferredRowPattern?: RegExp,
): Promise<boolean> {
  if (!(await input.isVisible().catch(() => false)) && (await input.count().catch(() => 0)) === 0) return false;
  await waitForStableVisibility(input, 4_000).catch(() => {});
  await input.click().catch(() => {});
  await input.press('ControlOrMeta+a').catch(() => {});
  await input.fill(query).catch(() => {});

  const root = lookupRootFromInput(input);
  await waitForLookupIdle(root);

  const selectByPreferredRow = async (): Promise<boolean> => {
    if (!preferredRowPattern) return false;
    const row = root.locator('[role="button"]').filter({ hasText: preferredRowPattern }).first();
    const action = row.getByRole('button', { name: /^Select$/i }).first();
    if (await action.isVisible().catch(() => false)) {
      await action.click();
      return true;
    }
    if ((await row.isVisible().catch(() => false))) {
      await row.click().catch(() => {});
      return true;
    }
    return false;
  };

  if (await selectByPreferredRow()) return true;

  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    await waitForLookupIdle(root);
    if (await selectAnyLookupOption(root)) return true;
    if (await selectByPreferredRow()) return true;
    const selectedButton = root.getByRole('button', { name: /^Selected$/i }).first();
    if (await selectedButton.isVisible().catch(() => false)) {
      return true;
    }
    await input.page().waitForTimeout(100);
  }

  await input.press('ArrowDown').catch(() => {});
  await input.press('Enter').catch(() => {});
  const selectedButton = root.getByRole('button', { name: /^Selected$/i }).first();
  if (await selectedButton.isVisible().catch(() => false)) {
    return true;
  }
  return await selectAnyLookupOption(root);
}

export async function createSalesDocument(page: Page, options: CreateDocumentOptions): Promise<string> {
  const fixtureContext = await ensureSalesDocumentFixtures(page, options);
  const customerQuery = fixtureContext.customerQuery;
  const channelQuery = fixtureContext.channelQuery;
  let fallbackToken: string | null = options.token ?? fixtureContext.authToken ?? null;
  const resolveFallbackToken = async (): Promise<string> => {
    if (fallbackToken) return fallbackToken;
    fallbackToken = await getAuthToken(page.request, 'admin');
    return fallbackToken;
  };

  if (options.preferApi) {
    const token = await resolveFallbackToken();
    const id = await createSalesDocumentFixture(page, token, options.kind, customerQuery, channelQuery, fixtureContext);
    await openSalesDocumentPage(page, id, options.kind);
    return id;
  }

  let createPageReady = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`/backend/sales/documents/create?kind=${options.kind}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByText(/Loading…|Loading\.\.\./i).first().waitFor({ state: 'hidden', timeout: TEST_WAIT_TIMEOUT_MS }).catch(() => {});
    const createButton = page.getByRole('button', { name: /^Create$/i }).first();
    if (await createButton.isVisible().catch(() => false)) {
      createPageReady = true;
      break;
    }
    const recovered = await recoverGenericErrorPageIfPresent(page);
    if (!recovered && attempt === 2) {
      await expect(createButton).toBeVisible({ timeout: TEST_WAIT_TIMEOUT_MS });
    }
  }
  if (!createPageReady) {
    const token = await resolveFallbackToken();
    const id = await createSalesDocumentFixture(page, token, options.kind, customerQuery, channelQuery, fixtureContext);
    await openSalesDocumentPage(page, id, options.kind);
    return id;
  }
  await expect(page.getByRole('button', { name: /^Create$/i }).first()).toBeVisible({
    timeout: TEST_WAIT_TIMEOUT_MS,
  });

  const generateButton = page.getByRole('button', { name: /Generate/i }).first();
  const createButton = page.getByRole('button', { name: /^Create$/i }).first();
  const hasGenerateButton = (await generateButton.count()) > 0;
  if (hasGenerateButton) {
    await expect(generateButton).toBeVisible({ timeout: 10_000 });
  }

  await page.getByText('Document type').click();
  const customerSelected = await selectLookupValue(
    page.getByRole('textbox', { name: /Search customers/i }).first(),
    customerQuery,
    new RegExp(escapeRegExp(customerQuery), 'i'),
  );
  const channelSelected = await selectLookupValue(
    page.getByRole('textbox', { name: /Select a channel/i }).first(),
    channelQuery,
    new RegExp(escapeRegExp(channelQuery), 'i'),
  );
  if (!customerSelected || !channelSelected) {
    const token = await resolveFallbackToken();
    const id = await createSalesDocumentFixture(page, token, options.kind, customerQuery, channelQuery, fixtureContext);
    await openSalesDocumentPage(page, id, options.kind);
    return id;
  }

  await selectFirstAddressIfAvailable(page);

  const createEnabled = await createButton.isEnabled().catch(() => false);
  if (!createEnabled) {
    const token = await resolveFallbackToken();
    const id = await createSalesDocumentFixture(page, token, options.kind, customerQuery, channelQuery, fixtureContext);
    await openSalesDocumentPage(page, id, options.kind);
    return id;
  }

  await createButton.click();
  const navigated = await page.waitForURL(
    new RegExp(
      `/backend/sales/(?:documents/[0-9a-f-]{36}\\?kind=${options.kind}|${options.kind === 'order' ? 'orders' : 'quotes'}/[0-9a-f-]{36})$`,
      'i',
    ),
    { timeout: TEST_WAIT_TIMEOUT_MS },
  ).then(() => true).catch(() => false);
  if (!navigated) {
    const token = await resolveFallbackToken();
    const id = await createSalesDocumentFixture(page, token, options.kind, customerQuery, channelQuery, fixtureContext);
    await openSalesDocumentPage(page, id, options.kind);
    return id;
  }

  const match = page.url().match(/\/backend\/sales\/(?:documents|orders|quotes)\/([0-9a-f-]{36})/i);
  if (!match) {
    throw new Error(`Could not resolve document id from URL: ${page.url()}`);
  }
  const loaded = await waitForDocumentLoaded(page, TEST_WAIT_TIMEOUT_MS);
  if (!loaded) {
    await openSalesDocumentPage(page, match[1], options.kind);
  }
  return match[1];
}

function lineDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: /Add line|Edit line/i });
}

async function selectFirstOption(container: Locator, rowNamePattern: RegExp): Promise<void> {
  const optionRow = container.getByRole('button', { name: rowNamePattern }).first();
  await optionRow.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {});
  if ((await optionRow.count()) === 0) return;

  const selectButton = optionRow.getByRole('button', { name: /^Select$/i }).first();
  if ((await selectButton.count()) > 0) {
    await selectButton.click();
    return;
  }
  await optionRow.click();
}

async function selectFirstLookupOption(input: Locator, rowNamePattern: RegExp): Promise<void> {
  const root = lookupRootFromInput(input);
  await waitForLookupIdle(root);
  await selectFirstOption(root, rowNamePattern);
}

async function selectShipmentMethod(dialog: Locator): Promise<void> {
  const shippingMethodInput = dialog.getByPlaceholder(/Select method/i).first();
  if ((await shippingMethodInput.count()) === 0) return;
  const selected = await selectLookupValue(shippingMethodInput, 'Standard', /standard ground|express air|standard/i);
  if (!selected) {
    await selectFirstLookupOption(shippingMethodInput, /standard ground|express air|standard/i);
  }
}

async function selectShipmentStatus(dialog: Locator): Promise<void> {
  const statusInput = dialog.getByPlaceholder(/Select shipment status/i).first();
  if ((await statusInput.count()) > 0) {
    const selected = await selectLookupValue(statusInput, 'Shipped', /shipped|in transit|packed/i);
    if (selected) return;
    await selectFirstLookupOption(statusInput, /shipped|in transit|packed/i);
    return;
  }
}

async function selectShipmentAddress(dialog: Locator): Promise<void> {
  const addressInput = dialog.getByPlaceholder(/Select address/i).first();
  if ((await addressInput.count()) === 0) return;
  const currentValue = await addressInput.inputValue().catch(() => '');
  if (currentValue.trim().length > 0) return;
  const selected = await selectLookupValue(addressInput, 'Address', /shipping address|document address|address/i);
  if (!selected) {
    await selectFirstLookupOption(addressInput, /shipping address|document address|address/i);
  }
}

async function fillShipmentQuantity(dialog: Locator): Promise<void> {
  const quantityInputs = dialog.getByRole('spinbutton');
  const count = await quantityInputs.count();
  for (let index = 0; index < count; index += 1) {
    const input = quantityInputs.nth(index);
    const isVisible = await input.isVisible().catch(() => false);
    const isEnabled = await input.isEnabled().catch(() => false);
    if (!isVisible || !isEnabled) continue;
    await input.fill('1').catch(() => {});
  }
}

async function fillShipmentDates(dialog: Locator): Promise<void> {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear());
  const shippedDateValue = `${day}/${month}/${year}`;

  const shippedDateInput = dialog.getByLabel(/Shipped date/i).first();
  if ((await shippedDateInput.count()) > 0) {
    const currentValue = await shippedDateInput.inputValue().catch(() => '');
    if (currentValue.trim().length === 0) {
      await shippedDateInput.fill(shippedDateValue).catch(() => {});
    }
  }
}

async function fillShipmentNumber(dialog: Locator, shipmentNumber: string): Promise<void> {
  const shipmentNumberInput = dialog.getByRole('textbox').first();
  if (!(await shipmentNumberInput.isVisible().catch(() => false)) && (await shipmentNumberInput.count().catch(() => 0)) === 0) {
    return;
  }
  await waitForStableVisibility(shipmentNumberInput, 4_000).catch(() => {});
  await shipmentNumberInput.fill(shipmentNumber).catch(() => {});
  await shipmentNumberInput.press('Tab').catch(() => {});
}

export async function addCustomLine(page: Page, options: AddLineOptions): Promise<void> {
  await ensureSalesDocumentReady(page);
  await page.getByRole('button', { name: /^Items$/i }).click();
  const addItemButton = page.getByRole('button', { name: /Add item/i }).first();
  await expect(addItemButton).toBeVisible({ timeout: TEST_WAIT_TIMEOUT_MS });
  await expect(addItemButton).toBeEnabled({ timeout: TEST_WAIT_TIMEOUT_MS });
  await addItemButton.click();

  const dialog = lineDialog(page);
  await expect(dialog).toBeVisible();

  const customLineButton = dialog.getByRole('button', { name: /Custom line/i });
  await expect(customLineButton).toBeVisible({ timeout: TEST_WAIT_TIMEOUT_MS });
  await customLineButton.click();

  const nameInput = dialog.getByRole('textbox', { name: /Optional line name/i });
  await expect(nameInput).toBeVisible({ timeout: TEST_WAIT_TIMEOUT_MS });
  await nameInput.fill(options.name);
  await dialog.getByRole('textbox', { name: '0.00' }).fill(String(options.unitPriceGross));
  await dialog.getByRole('textbox', { name: '1' }).fill(String(options.quantity));

  if (options.taxClassName) {
    // Radix Select inside Dialog — force click on option to bypass overlay
    const taxClassTrigger = dialog
      .locator('[role="combobox"]')
      .filter({ hasText: /No tax class selected/i })
      .first();
    if ((await taxClassTrigger.count()) > 0) {
      await taxClassTrigger.click();
      const opt = page.getByRole('option', { name: options.taxClassName, exact: true });
      await opt.first().waitFor({ state: 'visible', timeout: 3_000 });
      await opt.first().click({ force: true });
    }
  }

  const submitButton = dialog.getByRole('button', { name: /Add item/i });
  await expect(submitButton).toBeVisible({ timeout: TEST_WAIT_TIMEOUT_MS });
  await expect(submitButton).toBeEnabled({ timeout: TEST_WAIT_TIMEOUT_MS });
  const lineRow = page.getByRole('row', { name: new RegExp(escapeRegExp(options.name), 'i') });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await submitButton.click();
    await Promise.race([
      dialog.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {}),
      lineRow.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {}),
    ]);
    if (await lineRow.isVisible().catch(() => false)) break;
    if (!(await dialog.isVisible().catch(() => false))) break;
  }

  if (await dialog.isVisible().catch(() => false)) {
    await expect(dialog).toBeHidden({ timeout: TEST_WAIT_TIMEOUT_MS });
  }
  await page.getByRole('button', { name: /^Items$/i }).click().catch(() => {});
  await expect(lineRow).toBeVisible({ timeout: TEST_WAIT_TIMEOUT_MS });
}

export async function updateLineQuantity(page: Page, lineName: string, quantity: number): Promise<void> {
  await page.getByRole('button', { name: /^Items$/i }).click();
  const row = page.getByRole('row', { name: new RegExp(escapeRegExp(lineName), 'i') });
  await row.click();

  const dialog = page.getByRole('dialog', { name: /Edit line/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: '1' }).fill(String(quantity));
  await dialog.getByRole('button', { name: /Save changes/i }).click();

  await expect(page.getByRole('row', { name: new RegExp(`${escapeRegExp(lineName)}.*\\b${quantity}\\b`, 'i') })).toBeVisible();
}

export async function deleteLine(page: Page, lineName: string): Promise<void> {
  await page.getByRole('button', { name: /^Items$/i }).click();
  const row = page.getByRole('row', { name: new RegExp(escapeRegExp(lineName), 'i') });
  await expect(row).toBeVisible();
  await row.locator('button').last().click();

  const confirmDialog = page.getByRole('alertdialog');
  if (await confirmDialog.isVisible().catch(() => false)) {
    await confirmDialog.getByRole('button', { name: /^Delete$/i }).first().click();
    await expect(confirmDialog).toBeHidden();
  }

  await expect(page.getByRole('row', { name: new RegExp(escapeRegExp(lineName), 'i') })).toHaveCount(0);
}

export async function addAdjustment(page: Page, options: AddAdjustmentOptions): Promise<void> {
  const adjustmentsTab = page.getByRole('button', { name: /^Adjustments$/i }).first();
  await waitForStableVisibility(adjustmentsTab, TEST_WAIT_TIMEOUT_MS);
  await adjustmentsTab.click();
  const addAdjustmentButton = page.getByRole('button', { name: /Add adjustment/i }).first();
  await waitForStableVisibility(addAdjustmentButton, TEST_WAIT_TIMEOUT_MS);
  await addAdjustmentButton.click();

  const dialog = page.getByRole('dialog', { name: /Add adjustment/i });
  await expect(dialog).toBeVisible();
  const adjustmentRow = page.getByRole('row', { name: new RegExp(escapeRegExp(options.label), 'i') });
  const fillAdjustmentForm = async (): Promise<void> => {
    await dialog.getByText(/Loading adjustments/i).waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
    // Radix Select trigger — target by CrudForm field id (kind picker)
    const kindTrigger = dialog.locator('[data-crud-field-id="kind"] [role="combobox"]').first();
    await expect(kindTrigger).toBeVisible({ timeout: TEST_WAIT_TIMEOUT_MS });

    const labelInput = dialog.getByPlaceholder(/e\.g\. Shipping fee/i).first();
    await expect(labelInput).toBeVisible({ timeout: TEST_WAIT_TIMEOUT_MS });
    await labelInput.fill(options.label);
    await expect(labelInput).toHaveValue(options.label, { timeout: 2_000 });

    if ((await kindTrigger.count()) > 0) {
      const expectedKindValue = normalizeAdjustmentKindValue(options.kindLabel ?? 'Surcharge');
      const kindLabel = options.kindLabel ?? 'Surcharge';
      // Open Radix Select via click; then drive selection via keyboard so the
      // listbox keystroke matching jumps to the desired option (Discount /
      // Surcharge / etc.). This sidesteps modal-backdrop click interception
      // that occurs when a Radix Select is rendered inside a Radix Dialog.
      await kindTrigger.click();
      await page.waitForTimeout(150);
      // Type the first letter to jump to the matching option
      await page.keyboard.type(kindLabel.charAt(0));
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      void expectedKindValue;
    }

    const fixedAmountButton = dialog.getByRole('button', { name: /^Fixed amount$/i }).first();
    if ((await fixedAmountButton.count()) > 0) {
      await fixedAmountButton.click().catch(() => {});
    }

    const enabledAmountInputs = dialog.locator('input[placeholder="0.00"]:not([disabled])');
    await expect(enabledAmountInputs.first()).toBeVisible({ timeout: TEST_WAIT_TIMEOUT_MS });
    if ((await enabledAmountInputs.count()) > 0) {
      await enabledAmountInputs.first().fill(String(options.netAmount));
      await expect(enabledAmountInputs.first()).toHaveValue(String(options.netAmount), { timeout: 2_000 }).catch(() => {});
    }
  };

  let saved = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await fillAdjustmentForm();
    const submitButton = dialog.getByRole('button', { name: /Add adjustment/i }).first();
    await waitForStableVisibility(submitButton, 4_000).catch(() => {});
    await submitButton.click();
    await Promise.race([
      dialog.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {}),
      adjustmentRow.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {}),
    ]);
    saved =
      !(await dialog.isVisible().catch(() => false)) ||
      (await adjustmentRow.isVisible().catch(() => false));
    if (saved) break;
  }

  if (await dialog.isVisible().catch(() => false)) {
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  }
  if (!(await adjustmentRow.isVisible().catch(() => false))) {
    await adjustmentsTab.click().catch(() => {});
    await adjustmentRow.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {});
  }
}

export async function addPayment(page: Page, amount: number): Promise<{ amountLabel: string; added: boolean }> {
  await ensureSalesDocumentReady(page);
  const paymentsTab = page.getByRole('button', { name: /^Payments$/i }).first();
  await waitForStableVisibility(paymentsTab, TEST_WAIT_TIMEOUT_MS);
  await paymentsTab.click();
  const amountLabel = amount.toFixed(2);
  const amountInputValue = String(Math.max(1, Math.round(amount)));
  const addPaymentButton = page.getByRole('button', { name: /Add payment/i }).first();
  await waitForStableVisibility(addPaymentButton, TEST_WAIT_TIMEOUT_MS);
  await expect(addPaymentButton).toBeEnabled({ timeout: TEST_WAIT_TIMEOUT_MS });
  await addPaymentButton.click();

  const dialog = page.getByRole('dialog', { name: /Add payment/i });
  const amountInput = dialog.locator('input[placeholder="0.00"]').first();
  await waitForDialogFieldReady(dialog, amountInput, /Loading payment methods…|Loading payment methods\.\.\./i);
  const setAmount = async (): Promise<void> => {
    const refreshedAmountInput = dialog.locator('input[placeholder="0.00"]').first();
    await waitForStableVisibility(refreshedAmountInput, 4_000).catch(() => {});
    await refreshedAmountInput.fill(amountInputValue).catch(() => {});
    await refreshedAmountInput.press('Tab').catch(() => {});
  };
  const selectMethodInput = dialog.getByPlaceholder(/Search payment method/i).first();
  const statusInput = dialog.getByPlaceholder(/Select status/i).first();
  await setAmount();
  await waitForStableVisibility(selectMethodInput, 4_000).catch(() => {});
  await selectLookupValue(selectMethodInput, 'Bank', /bank transfer|credit card|cash on delivery/i).catch(() => false);
  await waitForStableVisibility(statusInput, 4_000).catch(() => {});
  await selectLookupValue(statusInput, 'Pending', /pending|captured/i).catch(() => false);
  const saveButton = dialog.getByRole('button', { name: /Save/i }).first();
  const operationMessage = page.getByText(/Last operation:\s*Create payment/i).first();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await setAmount();
    await selectLookupValue(selectMethodInput, 'Bank', /bank transfer|credit card|cash on delivery/i).catch(() => false);
    await selectLookupValue(statusInput, 'Pending', /pending|captured/i).catch(() => false);
    await waitForStableVisibility(saveButton, 4_000).catch(() => {});
    await saveButton.click();
    await Promise.race([
      dialog.waitFor({ state: 'hidden', timeout: 3_500 }).catch(() => {}),
      operationMessage.waitFor({ state: 'visible', timeout: 3_500 }).catch(() => {}),
      dialog.getByText(/This field is required/i).first().waitFor({ state: 'visible', timeout: 3_500 }).catch(() => {}),
    ]);
    if (!(await dialog.isVisible().catch(() => false))) break;
    if (await operationMessage.isVisible().catch(() => false)) break;
    await waitForOptionalTextToDisappear(dialog, /Loading payment methods…|Loading payment methods\.\.\./i, 3_000);
  }
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.press('Escape').catch(() => {});
    await dialog.waitFor({ state: 'hidden', timeout: 1_500 }).catch(() => {});
  }
  await operationMessage.waitFor({ state: 'visible', timeout: 2_500 }).catch(() => {});
  let added = await operationMessage.isVisible().catch(() => false);
  if (!added) {
    added = await addPaymentViaApi(page, amount);
  }
  return { amountLabel, added };
}

export async function addShipment(page: Page): Promise<{ trackingNumber: string; shipmentNumber: string; added: boolean }> {
  await ensureSalesDocumentReady(page);
  await ensureShippingMethodFixture(page);
  const shipmentsTab = page.getByRole('button', { name: /^Shipments$/i }).first();
  await waitForStableVisibility(shipmentsTab, TEST_WAIT_TIMEOUT_MS);
  await shipmentsTab.click();
  const trackingNumber = `SHIP-${Date.now()}`;
  const shipmentNumber = String(Date.now());
  const dialog = page.getByRole('dialog', { name: /Add shipment/i });
  const openShipmentDialog = async (): Promise<boolean> => {
    const addShipmentButtons = page.getByRole('button', { name: /Add shipment/i });
    const buttonCount = await addShipmentButtons.count();
    for (let index = buttonCount - 1; index >= 0; index -= 1) {
      const button = addShipmentButtons.nth(index);
      if (!(await button.isVisible().catch(() => false))) continue;
      if (!(await button.isEnabled().catch(() => false))) continue;
      await waitForStableVisibility(button, TEST_WAIT_TIMEOUT_MS).catch(() => {});
      await button.scrollIntoViewIfNeeded().catch(() => {});
      await button.click().catch(() => {});
      const visible = await dialog.waitFor({ state: 'visible', timeout: 2_500 }).then(() => true).catch(() => false);
      if (visible) return true;
    }
    return false;
  };

  let dialogReady = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const opened = await openShipmentDialog();
    if (!opened) break;
    await dialog
      .getByText(/Loading shipments…|Loading shipments\.\.\./i)
      .first()
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .catch(() => {});
    const shipmentNumberInput = dialog.locator('input, textarea').first();
    if (await shipmentNumberInput.isVisible().catch(() => false)) {
      await waitForStableVisibility(shipmentNumberInput, TEST_WAIT_TIMEOUT_MS).catch(() => {});
      dialogReady = true;
      break;
    }
    await dialog.getByRole('button', { name: /Close/i }).first().click().catch(() => {});
    await dialog.waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => {});
  }
  if (!dialogReady) {
    const added = await addShipmentViaApi(page, shipmentNumber, trackingNumber);
    if (!added) {
      await openShipmentDialog();
      const shipmentNumberInput = dialog.locator('input, textarea').first();
      await waitForDialogFieldReady(dialog, shipmentNumberInput, /Loading shipments…|Loading shipments\.\.\./i);
    } else {
      const shipmentLabel = page.getByText(new RegExp(`Shipment\\s+${escapeRegExp(shipmentNumber)}`, 'i')).first();
      const visible = await shipmentLabel
        .waitFor({ state: 'visible', timeout: TEST_WAIT_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      return { trackingNumber, shipmentNumber, added: visible };
    }
  }

  const shipmentNumberInput = dialog.locator('input, textarea').first();
  await fillShipmentNumber(dialog, shipmentNumber);
  const trackingInput = dialog.getByPlaceholder(/One per line or comma separated/i).first();
  await waitForStableVisibility(trackingInput, 4_000).catch(() => {});
  await trackingInput.fill(trackingNumber).catch(() => {});
  await selectShipmentMethod(dialog);
  await selectShipmentStatus(dialog);
  await selectShipmentAddress(dialog);
  await fillShipmentQuantity(dialog);
  await fillShipmentDates(dialog);
  await fillShipmentNumber(dialog, shipmentNumber);

  await dialog.getByText(/Searching…|Searching\.\.\./i).first().waitFor({ state: 'hidden', timeout: TEST_WAIT_TIMEOUT_MS }).catch(() => {});
  const saveButton = dialog.getByRole('button', { name: /^Save\b/i }).first();
  const canClickSave = (await saveButton.count()) > 0 && (await saveButton.isVisible().catch(() => false));
  if (canClickSave) {
    await saveButton.click({ timeout: TEST_WAIT_TIMEOUT_MS }).catch(() => {});
  } else {
    await dialog.press('ControlOrMeta+Enter').catch(() => {});
  }

  let closed = await dialog
    .waitFor({ state: 'hidden', timeout: TEST_WAIT_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);

  if (!closed) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!(await dialog.isVisible().catch(() => false))) break;
      await selectShipmentMethod(dialog);
      await selectShipmentAddress(dialog);
      await fillShipmentQuantity(dialog);
      await fillShipmentDates(dialog);
      await fillShipmentNumber(dialog, shipmentNumber);
      if (canClickSave) {
        await saveButton.click({ timeout: 2_000 }).catch(() => {});
      } else {
        await dialog.press('ControlOrMeta+Enter').catch(() => {});
      }
      closed = await dialog
        .waitFor({ state: 'hidden', timeout: 2_000 })
        .then(() => true)
        .catch(() => false);
      if (closed) break;
    }
  }

  if (!closed) {
    return { trackingNumber, shipmentNumber, added: false };
  }

  await page.getByRole('button', { name: /^Shipments$/i }).click();
  const shipmentLabel = page.getByText(new RegExp(`Shipment\\s+${escapeRegExp(shipmentNumber)}`, 'i')).first();
  const added = await shipmentLabel
    .waitFor({ state: 'visible', timeout: TEST_WAIT_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  return { trackingNumber, shipmentNumber, added };
}

export async function readGrandTotalGross(page: Page): Promise<number> {
  const row = page.getByRole('row', { name: /Grand total \(gross\)/i }).first();
  await expect(row).toBeVisible();
  const text = (await row.innerText()).trim();
  return parseCurrencyAmount(text);
}
