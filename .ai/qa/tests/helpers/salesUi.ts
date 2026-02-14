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

export async function addPayment(page: Page, amount: number): Promise<void> {
  await page.getByRole('button', { name: /^Payments$/i }).click();
  await page.getByRole('button', { name: /Add payment/i }).click();

  const dialog = page.getByRole('dialog', { name: /Add payment/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('spinbutton').first().fill(String(amount));
  await dialog.getByRole('button', { name: /Select$/i }).first().click();
  await dialog.getByRole('button', { name: /Save/i }).click();
}

export async function addShipment(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Shipments$/i }).click();
  await page.getByRole('button', { name: /Add shipment/i }).click();

  const dialog = page.getByRole('dialog', { name: /Add shipment/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').first().fill(`SHIP-${Date.now()}`);
  await dialog.getByRole('button', { name: /Select$/i }).first().click();
  await dialog.getByRole('button', { name: /Save/i }).click();
}
