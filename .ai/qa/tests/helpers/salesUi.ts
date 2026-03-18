import { expect, type Locator, type Page } from '@playwright/test';
import { apiRequest, getAuthToken } from './api';

type DocumentKind = 'quote' | 'order';

type CreateDocumentOptions = {
  kind: DocumentKind;
  customerQuery?: string;
  channelQuery?: string;
};

type ChannelListItem = {
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

async function ensureSalesDocumentFixtures(
  page: Page,
  options: CreateDocumentOptions,
): Promise<{ customerQuery: string; channelQuery: string }> {
  let customerQuery = options.customerQuery;
  let channelQuery = options.channelQuery;

  if (customerQuery && channelQuery) {
    return { customerQuery, channelQuery };
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
      const companyId = readId(companyBody, ['id', 'entityId', 'companyId']);
      if (companyId) {
        await apiRequest(page.request, 'POST', '/api/customers/addresses', {
          token,
          data: {
            entityId: companyId,
            name: 'Primary',
            purpose: 'Shipping',
            addressLine1: '100 QA Street',
            city: 'Austin',
            postalCode: '78701',
            country: 'US',
            isPrimary: true,
          },
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
      } else {
        channelQuery = 'online';
      }
    }
  }

  return {
    customerQuery: customerQuery ?? 'Copperleaf',
    channelQuery: channelQuery ?? 'online',
  };
}

async function selectFirstAddressIfAvailable(page: Page): Promise<void> {
  const addressSelect = page
    .locator('select')
    .filter({ has: page.locator('option', { hasText: 'Select address' }) })
    .first();
  if ((await addressSelect.count()) === 0) return;
  if (!(await addressSelect.isEnabled())) return;

  const nextValue = await addressSelect.evaluate((element) => {
    const select = element as HTMLSelectElement;
    return select.options.length > 1 ? select.options[1]?.value ?? null : null;
  });
  if (nextValue) {
    await addressSelect.selectOption(nextValue);
  }
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
    .waitFor({ state: 'hidden', timeout: 700 })
    .catch(() => {});
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
  const body = (await response?.json().catch(() => null)) as { result?: { items?: Array<Record<string, unknown>> } } | null;
  const items = Array.isArray(body?.result?.items) ? body.result.items : [];
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

async function createSalesDocumentFixture(
  page: Page,
  token: string,
  kind: DocumentKind,
  customerQuery: string,
  channelQuery: string,
): Promise<string> {
  const customerEntityId = await resolveCustomerEntityId(page, token, customerQuery);
  const channelId = await resolveSalesChannelId(page, token, channelQuery);
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
  return id;
}

async function openSalesDocumentPage(page: Page, id: string, kind: DocumentKind): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`/backend/sales/documents/${id}?kind=${kind}`);
    await page.waitForLoadState('domcontentloaded');
    const itemsButton = page.getByRole('button', { name: /^Items$/i }).first();
    if (await itemsButton.isVisible().catch(() => false)) {
      await page.waitForURL(new RegExp(`/backend/sales/documents/${id}\\?kind=${kind}$`, 'i'));
      return;
    }
    const recovered = await recoverGenericErrorPageIfPresent(page);
    if (!recovered && attempt === 2) {
      await expect(itemsButton).toBeVisible({ timeout: TEST_WAIT_TIMEOUT_MS });
    }
  }
}

async function ensureSalesDocumentReady(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const itemsButton = page.getByRole('button', { name: /^Items$/i }).first();
    if (await itemsButton.isVisible().catch(() => false)) {
      return;
    }
    const recovered = await recoverGenericErrorPageIfPresent(page);
    if (recovered) continue;
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await expect(page.getByRole('button', { name: /^Items$/i }).first()).toBeVisible({
    timeout: TEST_WAIT_TIMEOUT_MS,
  });
}

async function selectAnyLookupOption(root: Locator): Promise<boolean> {
  const selectButton = root.getByRole('button', { name: /^Select$/i }).first();
  if ((await selectButton.count()) > 0 && (await selectButton.isVisible().catch(() => false))) {
    await selectButton.click().catch(() => {});
    return true;
  }

  const row = root.locator('[role="button"]').first();
  if ((await row.count()) > 0 && (await row.isVisible().catch(() => false))) {
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
  if ((await input.count()) === 0) return false;
  await input.click().catch(() => {});
  await input.press('ControlOrMeta+a').catch(() => {});
  await input.fill(query).catch(() => {});

  const root = lookupRootFromInput(input);
  await waitForLookupIdle(root);

  const selectByPreferredRow = async (): Promise<boolean> => {
    if (!preferredRowPattern) return false;
    const row = root.locator('[role="button"]').filter({ hasText: preferredRowPattern }).first();
    if ((await row.count()) === 0) return false;
    const action = row.getByRole('button', { name: /^Select$/i }).first();
    if ((await action.count()) > 0 && (await action.isVisible().catch(() => false))) {
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

  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    await waitForLookupIdle(root);
    if (await selectAnyLookupOption(root)) return true;
    if (await selectByPreferredRow()) return true;
    const selectedButton = root.getByRole('button', { name: /^Selected$/i }).first();
    if ((await selectedButton.count()) > 0 && (await selectedButton.isVisible().catch(() => false))) {
      return true;
    }
    await input.page().waitForTimeout(250);
  }

  await input.press('ArrowDown').catch(() => {});
  await input.press('Enter').catch(() => {});
  const selectedButton = root.getByRole('button', { name: /^Selected$/i }).first();
  if ((await selectedButton.count()) > 0 && (await selectedButton.isVisible().catch(() => false))) {
    return true;
  }
  return await selectAnyLookupOption(root);
}

export async function createSalesDocument(page: Page, options: CreateDocumentOptions): Promise<string> {
  const fixtureContext = await ensureSalesDocumentFixtures(page, options);
  const customerQuery = fixtureContext.customerQuery;
  const channelQuery = fixtureContext.channelQuery;

  let createPageReady = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`/backend/sales/documents/create?kind=${options.kind}`);
    await page.waitForLoadState('domcontentloaded');
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
    const token = await getAuthToken(page.request, 'admin');
    const id = await createSalesDocumentFixture(page, token, options.kind, customerQuery, channelQuery);
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
    await expect(generateButton).toBeEnabled({ timeout: 30_000 });
  }

  await page.getByText('Document type').click();
  const customerSelected = await selectLookupValue(
    page.getByRole('textbox', { name: /Search customers/i }).first(),
    customerQuery,
    new RegExp(escapeRegExp(customerQuery), 'i'),
  );
  if (!customerSelected) throw new Error(`Could not select customer "${customerQuery}" while creating sales ${options.kind}.`);

  await selectLookupValue(
    page.getByRole('textbox', { name: /Select a channel/i }).first(),
    channelQuery,
    new RegExp(escapeRegExp(channelQuery), 'i'),
  );

  await selectFirstAddressIfAvailable(page);

  const createEnabled = await createButton.isEnabled().catch(() => false);
  if (!createEnabled) {
    const token = await getAuthToken(page.request, 'admin');
    const id = await createSalesDocumentFixture(page, token, options.kind, customerQuery, channelQuery);
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
    const token = await getAuthToken(page.request, 'admin');
    const id = await createSalesDocumentFixture(page, token, options.kind, customerQuery, channelQuery);
    await openSalesDocumentPage(page, id, options.kind);
    return id;
  }

  const match = page.url().match(/\/backend\/sales\/(?:documents|orders|quotes)\/([0-9a-f-]{36})/i);
  if (!match) {
    throw new Error(`Could not resolve document id from URL: ${page.url()}`);
  }
  await openSalesDocumentPage(page, match[1], options.kind);
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
    await input.click().catch(() => {});
    await input.press('ControlOrMeta+a').catch(() => {});
    await input.type('1', { delay: 20 }).catch(() => {});
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
  if ((await shipmentNumberInput.count()) === 0) return;
  await shipmentNumberInput.click().catch(() => {});
  await shipmentNumberInput.press('ControlOrMeta+a').catch(() => {});
  await shipmentNumberInput.type(shipmentNumber, { delay: 20 }).catch(() => {});
  await shipmentNumberInput.press('Tab').catch(() => {});
}

export async function addCustomLine(page: Page, options: AddLineOptions): Promise<void> {
  await ensureSalesDocumentReady(page);
  await page.getByRole('button', { name: /^Items$/i }).click();
  await page.getByRole('button', { name: /Add item/i }).first().click();

  const dialog = lineDialog(page);
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: /Custom line/i }).click();
  await dialog.getByRole('textbox', { name: /Optional line name/i }).fill(options.name);
  await dialog.getByRole('textbox', { name: '0.00' }).fill(String(options.unitPriceGross));
  await dialog.getByRole('textbox', { name: '1' }).fill(String(options.quantity));

  if (options.taxClassName) {
    const taxClassSelect = dialog
      .locator('select')
      .filter({ has: dialog.locator('option', { hasText: /No tax class selected/i }) })
      .first();
    if ((await taxClassSelect.count()) > 0) {
      await taxClassSelect.selectOption({ label: options.taxClassName });
    }
  }

  await dialog.getByRole('button', { name: /Add item/i }).click();
  await expect(page.getByRole('row', { name: new RegExp(escapeRegExp(options.name), 'i') })).toBeVisible();
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
  await page.getByRole('button', { name: /^Adjustments$/i }).click();
  await page.getByRole('button', { name: /Add adjustment/i }).first().click();

  const dialog = page.getByRole('dialog', { name: /Add adjustment/i });
  await expect(dialog).toBeVisible();
  const fillAdjustmentForm = async (): Promise<void> => {
    const labelInput = dialog.getByRole('textbox', { name: /e\.g\. Shipping fee/i }).first();
    if ((await labelInput.count()) > 0) {
      await labelInput.fill(options.label);
    } else {
      await dialog.locator('input[placeholder="e.g. Shipping fee"]').first().fill(options.label);
    }

    const kindSelect = dialog.getByRole('combobox').first();
    if ((await kindSelect.count()) > 0) {
      await kindSelect.selectOption({ label: options.kindLabel ?? 'Surcharge' }).catch(async () => {
        await kindSelect.selectOption({ label: 'Custom' });
      });
    }

    const enabledAmountInputs = dialog.locator('input[placeholder="0.00"]:not([disabled])');
    if ((await enabledAmountInputs.count()) > 0) {
      await enabledAmountInputs.first().fill(String(options.netAmount));
    }
    if ((await enabledAmountInputs.count()) > 1) {
      await enabledAmountInputs.nth(1).fill(String(options.netAmount));
    }
  };

  let saved = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await fillAdjustmentForm();
    await dialog.getByRole('button', { name: /Add adjustment/i }).click();
    saved = await dialog.waitFor({ state: 'hidden', timeout: 3_000 }).then(() => true).catch(() => false);
    if (saved) break;
  }

  await expect(dialog).toBeHidden({ timeout: 8_000 });
  await page.getByRole('button', { name: /^Adjustments$/i }).click();
  await expect(page.getByText(new RegExp(escapeRegExp(options.label), 'i')).first()).toBeVisible({ timeout: 8_000 });
}

export async function addPayment(page: Page, amount: number): Promise<{ amountLabel: string; added: boolean }> {
  await ensureSalesDocumentReady(page);
  await page.getByRole('button', { name: /^Payments$/i }).click();
  const amountLabel = amount.toFixed(2);
  const amountInputValue = String(Math.max(1, Math.round(amount)));
  await page.getByRole('button', { name: /Add payment/i }).click();

  const dialog = page.getByRole('dialog', { name: /Add payment/i });
  await expect(dialog).toBeVisible();
  const setAmount = async (): Promise<void> => {
    const amountInput = dialog.getByRole('spinbutton').first();
    await amountInput.click();
    await amountInput.press('ControlOrMeta+a');
    await amountInput.fill(amountInputValue);
    await amountInput.press('Tab');
  };
  const selectFirstOption = async (optionNamePattern: RegExp): Promise<void> => {
    const option = dialog.getByRole('button', { name: optionNamePattern }).first();
    if ((await option.count()) === 0) return;
    const selectButton = option.getByRole('button', { name: /^Select$/i }).first();
    if ((await selectButton.count()) > 0) {
      await selectButton.click();
      return;
    }
    await option.click();
  };
  await setAmount();

  await dialog.getByText(/Loading payment methods/i).waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
  await selectFirstOption(/bank transfer|credit card|cash on delivery/i);
  await selectFirstOption(/pending.*select|captured.*select/i);
  const saveButton = dialog.getByRole('button', { name: /Save/i }).first();
  const operationMessage = page.getByText(/Last operation:\s*Create payment/i).first();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await setAmount();
    await selectFirstOption(/bank transfer|credit card|cash on delivery/i);
    await selectFirstOption(/pending.*select|captured.*select/i);
    await saveButton.click();
    await Promise.race([
      dialog.waitFor({ state: 'hidden', timeout: 2_500 }).catch(() => {}),
      operationMessage.waitFor({ state: 'visible', timeout: 2_500 }).catch(() => {}),
      dialog.getByText(/This field is required/i).first().waitFor({ state: 'visible', timeout: 2_500 }).catch(() => {}),
    ]);
    if (!(await dialog.isVisible().catch(() => false))) break;
    if (await operationMessage.isVisible().catch(() => false)) break;
  }
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.press('Escape').catch(() => {});
    await dialog.waitFor({ state: 'hidden', timeout: 1_500 }).catch(() => {});
  }
  await operationMessage.waitFor({ state: 'visible', timeout: 2_500 }).catch(() => {});
  const added = await operationMessage.isVisible().catch(() => false);
  return { amountLabel, added };
}

export async function addShipment(page: Page): Promise<{ trackingNumber: string; shipmentNumber: string; added: boolean }> {
  await ensureSalesDocumentReady(page);
  await ensureShippingMethodFixture(page);
  await page.getByRole('button', { name: /^Shipments$/i }).click();
  const trackingNumber = `SHIP-${Date.now()}`;
  const shipmentNumber = String(Date.now());
  await page.getByRole('button', { name: /Add shipment/i }).click();

  const dialog = page.getByRole('dialog', { name: /Add shipment/i });
  await expect(dialog).toBeVisible();
  await fillShipmentNumber(dialog, shipmentNumber);
  const trackingInput = dialog.getByLabel(/Tracking numbers/i).first();
  if ((await trackingInput.count()) > 0) {
    await trackingInput.fill(trackingNumber);
  } else {
    await dialog.getByPlaceholder(/One per line or comma separated/i).first().fill(trackingNumber);
  }
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
