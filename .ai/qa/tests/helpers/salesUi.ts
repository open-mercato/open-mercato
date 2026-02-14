import { expect, type Locator, type Page } from '@playwright/test';

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
  const customerQuery = options.customerQuery ?? 'Copperleaf';
  const channelQuery = options.channelQuery ?? 'online';

  await page.goto('/backend/sales/documents/create');
  await page.getByRole('button', { name: new RegExp(`^${options.kind === 'order' ? 'Order' : 'Quote'}$`, 'i') }).click();

  await page.getByRole('textbox', { name: /Search customers/i }).fill(customerQuery);
  await page
    .getByRole('button', { name: new RegExp(`${escapeRegExp(customerQuery)}.*Select`, 'i') })
    .first()
    .click();

  await page.getByRole('textbox', { name: /Select a channel/i }).fill(channelQuery);
  await page
    .getByRole('button', { name: /Select$/i })
    .filter({ hasText: /online|field-sales|fashion-online/i })
    .first()
    .click();

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

  await dialog.getByRole('textbox', { name: /e\.g\. Shipping fee/i }).fill(options.label);
  if (options.kindLabel) {
    const kindSelect = dialog.locator('select').filter({ has: dialog.locator('option', { hasText: 'Discount' }) }).first();
    if ((await kindSelect.count()) > 0) {
      await kindSelect.selectOption({ label: options.kindLabel });
    }
  }
  await dialog.getByRole('textbox', { name: '0.00' }).nth(1).fill(String(options.netAmount));
  await dialog.getByRole('textbox', { name: '0.00' }).nth(2).fill(String(options.netAmount));
  await dialog.getByRole('button', { name: /Add adjustment/i }).click();

  await expect(page.getByRole('row', { name: new RegExp(escapeRegExp(options.label), 'i') })).toBeVisible();
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

  const shippingMethodInput = dialog.getByRole('textbox', { name: /Select method/i }).first();
  await shippingMethodInput.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  const shippingMethodRequired = dialog.getByText('This field is required').first();
  const shippingMethodRow = dialog.getByRole('button', { name: /standard ground|express air/i }).first();
  await shippingMethodRow.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  if ((await shippingMethodRow.count()) > 0) {
    const rowSelectButton = shippingMethodRow.getByRole('button', { name: /^Select$/i }).first();
    if ((await rowSelectButton.count()) > 0) {
      await rowSelectButton.click();
    } else {
      await shippingMethodRow.click();
    }
  }
  if (await shippingMethodRequired.isVisible().catch(() => false)) {
    const firstSelectButton = dialog.getByRole('button', { name: /^Select$/i }).first();
    if ((await firstSelectButton.count()) > 0) {
      await firstSelectButton.click();
    }
  }

  const shipmentStatusOption = dialog.getByRole('button', { name: /shipped.*select|in transit.*select/i }).first();
  if ((await shipmentStatusOption.count()) > 0) {
    const statusSelectButton = shipmentStatusOption.getByRole('button', { name: /^Select$/i }).first();
    if ((await statusSelectButton.count()) > 0) {
      await statusSelectButton.click();
    } else {
      await shipmentStatusOption.click();
    }
  }

  const selectedAddress = dialog.getByRole('button', { name: /shipping address.*selected/i }).first();
  if ((await selectedAddress.count()) === 0) {
    const firstAddressOption = dialog.getByRole('button', { name: /shipping address/i }).first();
    if ((await firstAddressOption.count()) > 0) {
      const addressSelectButton = firstAddressOption.getByRole('button', { name: /^Select$/i }).first();
      if ((await addressSelectButton.count()) > 0) {
        await addressSelectButton.click();
      } else {
        await firstAddressOption.click();
      }
    }
  }

  const quantityInput = dialog.getByRole('spinbutton').first();
  if ((await quantityInput.count()) > 0) {
    await quantityInput.fill('1');
  }

  await dialog.getByText(/Searching…|Searching\.\.\./i).first().waitFor({ state: 'hidden', timeout: 4_000 }).catch(() => {});
  if (await shippingMethodRequired.isVisible().catch(() => false)) {
    return { trackingNumber, added: false };
  }

  await dialog.getByRole('button', { name: /Save/i }).click();
  const closed = await dialog.waitFor({ state: 'hidden', timeout: 8_000 }).then(() => true).catch(() => false);
  if (closed) {
    await expect(page.getByText(trackingNumber).first()).toBeVisible();
    return { trackingNumber, added: true };
  }
  return { trackingNumber, added: false };
}
