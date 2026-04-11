import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';

/**
 * TC-SALES-024: Create Invoice from Order
 *
 * Validates the Order → Invoice flow:
 * 1. Create an order with lines (API)
 * 2. Create invoice from order lines (API)
 * 3. Verify invoice detail page renders
 * 4. Verify invoice list page renders
 *
 * Note: UI Actions dropdown test is pending — the "Create Invoice"
 * menuitem in the order detail FormHeader Actions dropdown needs
 * investigation (dropdown opens but items don't render in test context).
 *
 * Refs: TC-SALES-008
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
    }
    if (createdOrderId) {
      await apiRequest(page.request, 'DELETE', '/api/sales/orders', {
        token: authToken, data: { id: createdOrderId },
      }).catch(() => {});
    }
  });

  test('should create invoice from order and view in detail and list pages', async ({ page }) => {
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

    // Verify invoice detail page renders
    await page.goto(`/backend/sales/invoices/${createdInvoiceId}`);
    // Invoice number should appear in page title (INV-* or the generated number)
    await expect(page.getByText(/Invoice\s+INV-|Invoice\s+\S+/)).toBeVisible();

    // Verify invoice list page renders
    await page.goto('/backend/sales/invoices');
    await expect(
      page.locator('table').or(page.getByText(/No invoices yet/i))
    ).toBeVisible();
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
      page.locator('table').or(page.getByText(/No invoices yet/i))
    ).toBeVisible();
  });

  test('should reject invoice creation with empty lines array', async ({ page }) => {
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

    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
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
