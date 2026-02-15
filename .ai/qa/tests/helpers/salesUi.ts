import { expect, type Locator, type Page } from '@playwright/test';
import { apiRequest, getAuthToken } from './api';

type DocumentKind = 'quote' | 'order';

type CreateDocumentOptions = {
  kind: DocumentKind;
  customerQuery?: string;
  channelQuery?: string;
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
    return {
      customerQuery: customerQuery ?? 'Copperleaf',
      channelQuery: channelQuery ?? 'online',
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
      }
      customerQuery = companyName;
    } else {
      customerQuery = 'Copperleaf';
    }
  }

  if (!channelQuery) {
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

export async function createSalesDocument(page: Page, options: CreateDocumentOptions): Promise<string> {
  const fixtureContext = await ensureSalesDocumentFixtures(page, options);
  const customerQuery = fixtureContext.customerQuery;
  const channelQuery = fixtureContext.channelQuery;

  await page.goto('/backend/sales/documents/create');
  await page.getByRole('button', { name: new RegExp(`^${options.kind === 'order' ? 'Order' : 'Quote'}$`, 'i') }).click();

  await page.getByRole('textbox', { name: /Search customers/i }).fill(customerQuery);
  await page
    .getByRole('button', { name: new RegExp(`${escapeRegExp(customerQuery)}.*Select`, 'i') })
    .first()
    .click();

  await page.getByRole('textbox', { name: /Select a channel/i }).fill(channelQuery);
  const channelSelect = page
    .getByRole('button', { name: /Select$/i })
    .filter({ hasText: new RegExp(escapeRegExp(channelQuery), 'i') })
    .first();
  if ((await channelSelect.count()) > 0) {
    await channelSelect.click();
  } else {
    await page.getByRole('button', { name: /Select$/i }).first().click();
  }

  await selectFirstAddressIfAvailable(page);

  await page.getByRole('button', { name: /^Create$/i }).first().click();
  await expect(page).toHaveURL(new RegExp(`/backend/sales/documents/[0-9a-f-]{36}\\?kind=${options.kind}$`, 'i'));

  const match = page.url().match(/\/backend\/sales\/documents\/([0-9a-f-]{36})\?kind=/i);
  if (!match) {
    throw new Error(`Could not resolve document id from URL: ${page.url()}`);
  }
  return match[1];
}

function lineDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: /Add line|Edit line/i });
}

async function selectFirstOption(container: Locator, rowNamePattern: RegExp): Promise<void> {
  const optionRow = container.getByRole('button', { name: rowNamePattern }).first();
  await optionRow.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if ((await optionRow.count()) === 0) return;

  const selectButton = optionRow.getByRole('button', { name: /^Select$/i }).first();
  if ((await selectButton.count()) > 0) {
    await selectButton.click();
    return;
  }
  await optionRow.click();
}

async function selectShipmentMethod(dialog: Locator): Promise<void> {
  const shippingMethodInput = dialog.getByPlaceholder(/Select method/i).first();
  if ((await shippingMethodInput.count()) === 0) return;
  await shippingMethodInput.click().catch(() => {});
  await shippingMethodInput.press('ControlOrMeta+a').catch(() => {});
  await shippingMethodInput.type('Standard', { delay: 20 }).catch(() => {});
  await shippingMethodInput.press('Enter').catch(() => {});
  await selectFirstOption(dialog, /standard ground|express air|select/i);
}

async function selectShipmentStatus(dialog: Locator): Promise<void> {
  const statusInput = dialog.getByPlaceholder(/Select shipment status/i).first();
  if ((await statusInput.count()) > 0) {
    await statusInput.click().catch(() => {});
    await statusInput.press('ControlOrMeta+a').catch(() => {});
    await statusInput.type('Shipped', { delay: 20 }).catch(() => {});
    await statusInput.press('Enter').catch(() => {});
  }
  await selectFirstOption(dialog, /shipped.*select|in transit.*select|packed.*select|select/i);
}

async function selectShipmentAddress(dialog: Locator): Promise<void> {
  const addressInput = dialog.getByPlaceholder(/Select address/i).first();
  if ((await addressInput.count()) === 0) return;
  const currentValue = await addressInput.inputValue().catch(() => '');
  if (currentValue.trim().length > 0) return;
  if ((await addressInput.count()) > 0) {
    await addressInput.click().catch(() => {});
    await addressInput.press('Enter').catch(() => {});
  }
  await selectFirstOption(dialog, /shipping address|select/i);
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

async function clickFirstSelectAction(page: Page): Promise<boolean> {
  const selectAction = page.getByRole('button', { name: /^Select$/i }).first();
  if (await selectAction.isVisible().catch(() => false)) {
    await selectAction.click().catch(() => {});
    return true;
  }
  return false;
}

export async function addCustomLine(page: Page, options: AddLineOptions): Promise<void> {
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
    await amountInput.type(amountInputValue, { delay: 20 });
    await amountInput.press('Tab');
  };
  await setAmount();

  await dialog.getByText(/Loading payment methods/i).waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {});
  const paymentMethodOption = dialog.getByRole('button', { name: /bank transfer|credit card|cash on delivery/i }).first();
  if ((await paymentMethodOption.count()) > 0) {
    const methodSelectButton = paymentMethodOption.getByRole('button', { name: /^Select$/i }).first();
    if ((await methodSelectButton.count()) > 0) {
      await methodSelectButton.click();
    } else {
      await paymentMethodOption.click();
    }
  }
  const paymentStatusOption = dialog.getByRole('button', { name: /pending.*select|captured.*select/i }).first();
  if ((await paymentStatusOption.count()) > 0) {
    const statusSelectButton = paymentStatusOption.getByRole('button', { name: /^Select$/i }).first();
    if ((await statusSelectButton.count()) > 0) {
      await statusSelectButton.click();
    } else {
      await paymentStatusOption.click();
    }
  }
  await setAmount();
  await dialog.getByRole('button', { name: /Save/i }).click();
  if (await dialog.getByText(/This field is required/i).isVisible().catch(() => false)) {
    await setAmount();
    await dialog.getByRole('button', { name: /Save/i }).click();
  }
  await expect(dialog).toBeHidden({ timeout: 8_000 });
  await page.getByText(/Last operation:\s*Create payment/i).first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  const added = await page.getByText(/Last operation:\s*Create payment/i).first().isVisible().catch(() => false);
  return { amountLabel, added };
}

export async function addShipment(page: Page): Promise<{ trackingNumber: string; added: boolean }> {
  await page.getByRole('button', { name: /^Shipments$/i }).click();
  const trackingNumber = `SHIP-${Date.now()}`;
  await page.getByRole('button', { name: /Add shipment/i }).click();

  const dialog = page.getByRole('dialog', { name: /Add shipment/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').first().fill(trackingNumber);

  await selectShipmentMethod(dialog);
  await clickFirstSelectAction(page);
  await selectShipmentStatus(dialog);
  await clickFirstSelectAction(page);
  await selectShipmentAddress(dialog);
  await clickFirstSelectAction(page);
  await fillShipmentQuantity(dialog);

  await dialog.getByText(/Searching…|Searching\.\.\./i).first().waitFor({ state: 'hidden', timeout: 6_000 }).catch(() => {});
  let closed = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await dialog.getByText(/Searching…|Searching\.\.\./i).first().waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
    await selectShipmentMethod(dialog);
    await clickFirstSelectAction(page);
    await selectShipmentStatus(dialog);
    await clickFirstSelectAction(page);
    await selectShipmentAddress(dialog);
    await clickFirstSelectAction(page);
    await fillShipmentQuantity(dialog);
    await dialog.getByRole('button', { name: /Save/i }).first().click({ force: true });
    closed = await dialog.waitFor({ state: 'hidden', timeout: 4_000 }).then(() => true).catch(() => false);
    if (!closed) {
      await dialog.press('ControlOrMeta+Enter').catch(() => {});
      closed = await dialog.waitFor({ state: 'hidden', timeout: 2_000 }).then(() => true).catch(() => false);
    }
    if (closed) break;

    const unrecoverableAddressError = await dialog
      .getByText(/Add an address to this document before creating a shipment/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (unrecoverableAddressError) break;
  }
  if (closed) {
    await expect(page.getByText(trackingNumber).first()).toBeVisible();
    return { trackingNumber, added: true };
  }
  const closeButton = dialog.getByRole('button', { name: /Close/i }).first();
  if ((await closeButton.count()) > 0) {
    await closeButton.click().catch(() => {});
  } else {
    await dialog.press('Escape').catch(() => {});
  }
  await dialog.waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => {});
  return { trackingNumber, added: false };
}

export async function readGrandTotalGross(page: Page): Promise<number> {
  const row = page.getByRole('row', { name: /Grand total \(gross\)/i }).first();
  await expect(row).toBeVisible();
  const text = (await row.innerText()).trim();
  return parseCurrencyAmount(text);
}
