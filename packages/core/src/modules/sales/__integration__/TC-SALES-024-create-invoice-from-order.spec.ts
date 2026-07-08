import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';

/**
 * TC-SALES-024: Create Invoice from Order
 *
 * Validates the Order → Invoice flow:
 * 1. Create an order with lines (API)
 * 2. Create invoice from order lines (API) — asserting the created invoice
 *    lines keep their `orderLineId` linkage (regression net for the bug where
 *    invoice/credit-memo lines persisted with order_line_id NULL)
 * 3. Verify invoice detail page renders (invoice-number heading)
 * 4. Verify invoice list page renders
 * 5. Drive the real UI path: order detail → FormHeader "Actions" dropdown →
 *    "Create invoice" menuitem → redirected to the new invoice detail page.
 *    The dropdown trigger only renders after the page's async feature-check
 *    (POST /api/auth/feature-check for sales.invoices.manage) resolves, and
 *    ActionsDropdown opens on hover AND toggles on click — a bare click can
 *    hover-open then click-close in one gesture, which is why the menu items
 *    previously appeared "not to render in test context". The open+assert
 *    retry pattern below (same as TC-LOCK-OSS-027) handles both.
 *
 * Refs: TC-SALES-008, TC-LOCK-OSS-027
 */
test.describe('TC-SALES-024: Create Invoice from Order', () => {
  let authToken: string | null = null;
  let createdOrderId: string | null = null;
  let createdInvoiceId: string | null = null;

  test.afterEach(async ({ page }) => {
    if (!authToken) return;
    if (createdInvoiceId) {
      await apiRequest(page.request, 'DELETE', '/api/sales/invoices', {
        token: authToken, data: { id: createdInvoiceId },
      }).catch(() => {});
      createdInvoiceId = null;
    }
    if (createdOrderId) {
      await apiRequest(page.request, 'DELETE', '/api/sales/orders', {
        token: authToken, data: { id: createdOrderId },
      }).catch(() => {});
      createdOrderId = null;
    }
  });

  test('should create invoice from order and view in detail and list pages', async ({ page }) => {
    test.slow();
    await login(page, 'admin');
    authToken = await getAuthToken(page.request, 'admin');

    // Create order via API
    const orderResponse = await apiRequest(page.request, 'POST', '/api/sales/orders', {
      token: authToken,
      data: { currencyCode: 'USD' },
    });
    expect(orderResponse.ok()).toBeTruthy();
    const orderBody = await orderResponse.json() as Record<string, unknown>;
    createdOrderId = (orderBody.orderId ?? orderBody.id) as string;
    expect(createdOrderId).toBeTruthy();

    // Add line to order
    const lineResponse = await apiRequest(page.request, 'POST', '/api/sales/order-lines', {
      token: authToken,
      data: {
        orderId: createdOrderId,
        productName: `QA TC-024 Product ${Date.now()}`,
        sku: 'QA-024-SKU',
        quantity: '3',
        unitPriceGross: '100.00',
        unitPriceNet: '81.30',
        taxRate: '23',
        taxAmount: '56.10',
        totalNetAmount: '243.90',
        totalGrossAmount: '300.00',
        currencyCode: 'USD',
      },
    });
    expect(lineResponse.ok()).toBeTruthy();

    // Fetch order lines
    const linesResult = await apiRequest(page.request, 'GET', `/api/sales/order-lines?orderId=${createdOrderId}&pageSize=100`, { token: authToken });
    const linesBody = await linesResult.json() as { items?: Array<Record<string, unknown>> };
    const orderLines = linesBody?.items ?? [];
    expect(orderLines.length).toBeGreaterThan(0);

    // Create invoice from order lines via API
    const invoiceResponse = await apiRequest(page.request, 'POST', '/api/sales/invoices', {
      token: authToken,
      data: {
        orderId: createdOrderId,
        currencyCode: 'USD',
        lines: orderLines.map((line: Record<string, unknown>, i: number) => ({
          orderLineId: line['id'],
          lineNumber: i + 1,
          name: line['productName'] ?? line['description'] ?? 'Item',
          ...(line['sku'] ? { sku: line['sku'] } : {}),
          quantity: line['quantity'] ?? '1',
          currencyCode: 'USD',
          unitPriceNet: line['unitPriceNet'] ?? '0',
          unitPriceGross: line['unitPriceGross'] ?? '0',
          taxRate: line['taxRate'] ?? '0',
          taxAmount: line['taxAmount'] ?? '0',
          totalNetAmount: line['totalNetAmount'] ?? '0',
          totalGrossAmount: line['totalGrossAmount'] ?? '0',
        })),
        subtotalNetAmount: '243.90',
        subtotalGrossAmount: '300.00',
        taxTotalAmount: '56.10',
        grandTotalNetAmount: '243.90',
        grandTotalGrossAmount: '300.00',
      },
    });
    if (!invoiceResponse.ok()) {
      const errBody = await invoiceResponse.text().catch(() => 'no body');
      throw new Error(`Invoice creation failed (${invoiceResponse.status()}): ${errBody}`);
    }
    const invoiceBody = await invoiceResponse.json() as Record<string, unknown>;
    createdInvoiceId = (invoiceBody.invoiceId ?? invoiceBody.id) as string;
    expect(createdInvoiceId).toBeTruthy();

    // Regression net: the created invoice lines must keep their order-line
    // linkage (order_line_id was silently dropped to NULL before the fix).
    const detailResponse = await apiRequest(page.request, 'GET', `/api/sales/invoices/${createdInvoiceId}`, { token: authToken });
    expect(detailResponse.status()).toBe(200);
    const detailBody = await detailResponse.json() as {
      invoiceNumber?: string;
      lines?: Array<Record<string, unknown>>;
    };
    const invoiceLines = detailBody.lines ?? [];
    expect(invoiceLines.length).toBe(orderLines.length);
    const sentOrderLineIds = orderLines.map((line) => String(line['id'])).sort();
    const roundTrippedOrderLineIds = invoiceLines.map((line) => String(line['orderLineId'] ?? '')).sort();
    expect(roundTrippedOrderLineIds).toEqual(sentOrderLineIds);

    // Verify invoice detail page renders with the invoice-number heading
    // (FormHeader mode="detail" renders `Invoice <number>` as an h1; matching
    // loose text would also hit static copy like "Invoice Detail").
    const invoiceNumber = String(detailBody.invoiceNumber ?? '');
    expect(invoiceNumber.length).toBeGreaterThan(0);
    await page.goto(`/backend/sales/invoices/${createdInvoiceId}`);
    await expect(page.getByRole('heading', { name: `Invoice ${invoiceNumber}` })).toBeVisible();

    // Verify invoice list page renders
    await page.goto('/backend/sales/invoices');
    await expect(
      page.locator('table').or(page.getByText(/No invoices yet/i)).first()
    ).toBeVisible();
  });

  test('should create invoice from the order detail Actions dropdown (UI flow)', async ({ page }) => {
    test.slow();
    await login(page, 'admin');
    authToken = await getAuthToken(page.request, 'admin');

    // Create order with one line via API
    const orderResponse = await apiRequest(page.request, 'POST', '/api/sales/orders', {
      token: authToken,
      data: { currencyCode: 'USD' },
    });
    expect(orderResponse.ok()).toBeTruthy();
    const orderBody = await orderResponse.json() as Record<string, unknown>;
    createdOrderId = (orderBody.orderId ?? orderBody.id) as string;
    expect(createdOrderId).toBeTruthy();

    const lineResponse = await apiRequest(page.request, 'POST', '/api/sales/order-lines', {
      token: authToken,
      data: {
        orderId: createdOrderId,
        productName: `QA TC-024 UI Product ${Date.now()}`,
        sku: 'QA-024-UI-SKU',
        quantity: '1',
        unitPriceGross: '100.00',
        unitPriceNet: '81.30',
        taxRate: '23',
        taxAmount: '18.70',
        totalNetAmount: '81.30',
        totalGrossAmount: '100.00',
        currencyCode: 'USD',
      },
    });
    expect(lineResponse.ok()).toBeTruthy();

    await page.goto(`/backend/sales/documents/${createdOrderId}?kind=order`);

    // The "Create invoice" action is gated behind an async feature-check
    // (POST /api/auth/feature-check); the Actions trigger only mounts once
    // canCreateInvoice flips true, so wait for it instead of a fixed pause.
    // Exact "Actions" — a substring match could also grab topbar buttons.
    const actionsTrigger = page.getByRole('button', { name: 'Actions', exact: true });
    await expect(actionsTrigger).toBeVisible({ timeout: 20_000 });

    // ActionsDropdown opens on hover and toggles on click, so a single click
    // can hover-open then click-close in one gesture. Retry open + assert
    // atomically until the menuitem is visible (same pattern as TC-LOCK-OSS-027).
    const createInvoiceItem = page.getByRole('menuitem', { name: /^Create invoice$/i });
    await expect(async () => {
      await actionsTrigger.click();
      await expect(createInvoiceItem).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });
    await createInvoiceItem.click();

    // Success redirects to the created invoice detail page.
    await page.waitForURL(/\/backend\/sales\/invoices\/[0-9a-f-]{36}/i, { timeout: 30_000 });
    const urlMatch = page.url().match(/\/backend\/sales\/invoices\/([0-9a-f-]{36})/i);
    createdInvoiceId = urlMatch ? urlMatch[1] : null;
    expect(createdInvoiceId).toBeTruthy();

    // The UI-created invoice also keeps the order-line linkage.
    const detailResponse = await apiRequest(page.request, 'GET', `/api/sales/invoices/${createdInvoiceId}`, { token: authToken });
    expect(detailResponse.status()).toBe(200);
    const detailBody = await detailResponse.json() as {
      invoiceNumber?: string;
      orderId?: string | null;
      lines?: Array<Record<string, unknown>>;
    };
    expect(detailBody.orderId).toBe(createdOrderId);
    const uiInvoiceLines = detailBody.lines ?? [];
    expect(uiInvoiceLines.length).toBeGreaterThan(0);
    for (const line of uiInvoiceLines) {
      expect(typeof line['orderLineId']).toBe('string');
      expect(String(line['orderLineId']).length).toBeGreaterThan(0);
    }

    // Landed on the invoice detail page with the invoice-number heading.
    const invoiceNumber = String(detailBody.invoiceNumber ?? '');
    expect(invoiceNumber.length).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: `Invoice ${invoiceNumber}` })).toBeVisible();
  });

  test('should create invoice via direct API call', async ({ page }) => {
    await login(page, 'admin');
    authToken = await getAuthToken(page.request, 'admin');

    const response = await apiRequest(page.request, 'POST', '/api/sales/invoices', {
      token: authToken,
      data: {
        currencyCode: 'USD',
        lines: [{
          name: `QA Direct Invoice ${Date.now()}`,
          sku: 'QA-DIRECT-024',
          quantity: '2',
          currencyCode: 'USD',
          unitPriceNet: '81.30',
          unitPriceGross: '100.00',
          taxRate: '23',
          taxAmount: '37.40',
          totalNetAmount: '162.60',
          totalGrossAmount: '200.00',
        }],
        subtotalNetAmount: '162.60',
        subtotalGrossAmount: '200.00',
        taxTotalAmount: '37.40',
        grandTotalNetAmount: '162.60',
        grandTotalGrossAmount: '200.00',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json() as Record<string, unknown>;
    createdInvoiceId = (body.invoiceId ?? body.id) as string;
    expect(createdInvoiceId).toBeTruthy();

    // Verify list page
    await page.goto('/backend/sales/invoices');
    await expect(
      page.locator('table').or(page.getByText(/No invoices yet/i)).first()
    ).toBeVisible();
  });

  test('should handle invoice creation with empty lines array', async ({ page }) => {
    await login(page, 'admin');
    authToken = await getAuthToken(page.request, 'admin');

    // Create an order to reference
    const orderResponse = await apiRequest(page.request, 'POST', '/api/sales/orders', {
      token: authToken,
      data: { currencyCode: 'USD' },
    });
    expect(orderResponse.ok()).toBeTruthy();
    const orderBody = await orderResponse.json() as Record<string, unknown>;
    createdOrderId = (orderBody.orderId ?? orderBody.id) as string;

    const response = await apiRequest(page.request, 'POST', '/api/sales/invoices', {
      token: authToken,
      data: {
        orderId: createdOrderId,
        currencyCode: 'USD',
        lines: [],
        subtotalNetAmount: '0',
        subtotalGrossAmount: '0',
        taxTotalAmount: '0',
        grandTotalNetAmount: '0',
        grandTotalGrossAmount: '0',
      },
    });

    // The invoice API treats `lines` as optional — an empty array is accepted.
    // If accepted, clean up the created invoice; otherwise expect a 4xx rejection.
    if (response.ok()) {
      const body = await response.json() as Record<string, unknown>;
      createdInvoiceId = (body.invoiceId ?? body.id) as string;
      expect(createdInvoiceId).toBeTruthy();
    } else {
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
    }
  });

  test('should reject invoice creation without currencyCode', async ({ page }) => {
    await login(page, 'admin');
    authToken = await getAuthToken(page.request, 'admin');

    const response = await apiRequest(page.request, 'POST', '/api/sales/invoices', {
      token: authToken,
      data: {
        lines: [{
          name: 'Missing Currency Test',
          quantity: '1',
          unitPriceNet: '10.00',
          unitPriceGross: '12.30',
          taxRate: '23',
          taxAmount: '2.30',
          totalNetAmount: '10.00',
          totalGrossAmount: '12.30',
        }],
        subtotalNetAmount: '10.00',
        subtotalGrossAmount: '12.30',
        taxTotalAmount: '2.30',
        grandTotalNetAmount: '10.00',
        grandTotalGrossAmount: '12.30',
      },
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });

  test('should reject a second invoice for the same order with 409', async ({ page }) => {
    await login(page, 'admin');
    authToken = await getAuthToken(page.request, 'admin');

    const orderResponse = await apiRequest(page.request, 'POST', '/api/sales/orders', {
      token: authToken,
      data: { currencyCode: 'USD' },
    });
    expect(orderResponse.ok()).toBeTruthy();
    const orderBody = await orderResponse.json() as Record<string, unknown>;
    createdOrderId = (orderBody.orderId ?? orderBody.id) as string;
    expect(createdOrderId).toBeTruthy();

    const buildInvoicePayload = () => ({
      orderId: createdOrderId,
      currencyCode: 'USD',
      lines: [],
      subtotalNetAmount: '0',
      subtotalGrossAmount: '0',
      taxTotalAmount: '0',
      grandTotalNetAmount: '0',
      grandTotalGrossAmount: '0',
    });

    const firstResponse = await apiRequest(page.request, 'POST', '/api/sales/invoices', {
      token: authToken,
      data: buildInvoicePayload(),
    });
    expect(firstResponse.ok()).toBeTruthy();
    const firstBody = await firstResponse.json() as Record<string, unknown>;
    createdInvoiceId = (firstBody.invoiceId ?? firstBody.id) as string;
    expect(createdInvoiceId).toBeTruthy();

    const secondResponse = await apiRequest(page.request, 'POST', '/api/sales/invoices', {
      token: authToken,
      data: buildInvoicePayload(),
    });
    expect(secondResponse.status()).toBe(409);
    const secondBody = await secondResponse.json().catch(() => ({})) as Record<string, unknown>;
    expect(secondBody.code).toBe('sales.invoices.duplicate_for_order');
    expect(secondBody.existingInvoiceId).toBe(createdInvoiceId);
  });

  test('should handle invoice with non-existent orderId reference', async ({ page }) => {
    await login(page, 'admin');
    authToken = await getAuthToken(page.request, 'admin');

    const fakeOrderId = '00000000-0000-4000-a000-000000000000';

    const response = await apiRequest(page.request, 'POST', '/api/sales/invoices', {
      token: authToken,
      data: {
        orderId: fakeOrderId,
        currencyCode: 'USD',
        lines: [{
          name: 'Non-Existent Order Test',
          sku: 'QA-FAKE-ORDER',
          quantity: '1',
          currencyCode: 'USD',
          unitPriceNet: '50.00',
          unitPriceGross: '61.50',
          taxRate: '23',
          taxAmount: '11.50',
          totalNetAmount: '50.00',
          totalGrossAmount: '61.50',
        }],
        subtotalNetAmount: '50.00',
        subtotalGrossAmount: '61.50',
        taxTotalAmount: '11.50',
        grandTotalNetAmount: '50.00',
        grandTotalGrossAmount: '61.50',
      },
    });

    // The orderId is a loose FK reference — the API may accept it (201) or reject it (4xx).
    // If accepted, clean up the created invoice.
    if (response.ok()) {
      const body = await response.json() as Record<string, unknown>;
      createdInvoiceId = (body.invoiceId ?? body.id) as string;
      expect(createdInvoiceId).toBeTruthy();
    } else {
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
    }
  });
});
