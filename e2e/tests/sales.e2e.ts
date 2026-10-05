import { z } from 'zod';
import { test, expect, unique } from './support/fixtures';

/**
 * Sales documents.
 * Ported from .ai/qa/scenarios/TC-SALES-001 and TC-INT-001.
 *
 * Quotes and orders are numbered documents with no delete endpoint the demo
 * exposes, so these tests leave their documents behind, exactly as the
 * Playwright originals do.
 */
test.describe('sales', { tags: ['sales'], session: 'admin' }, () => {
  test('TC-SALES-001 creates a quote and adds a custom line', async ({ app, agent, web, stamp }) => {
    const lineName = `${stamp} Consulting`;
    await app.open('/backend/sales/documents/create?kind=quote');

    await agent.act('Create the quote for the customer {customer} on the sales channel {channel}. Pick the first address if one is offered.', {
      params: { customer: 'Brightside Solar', channel: 'Mercato Fashion Online' },
    });
    await expect(web).toHaveURL(/\/backend\/sales\/(documents|quotes)\/[0-9a-f-]{36}/i, { timeout: 60_000 });

    await agent.act('On the Items tab, add a custom line named {name} with quantity {quantity} and a unit price of {price}', {
      params: { name: unique(lineName), quantity: 2, price: 30 },
    });

    const totals = await agent.extract('the line total and the grand total shown for this quote, as numbers without currency symbols', {
      schema: z.object({ lineTotal: z.number(), grandTotal: z.number() }),
    });
    expect(Math.round(totals.lineTotal * 100) / 100).toBe(60);
    expect(totals.grandTotal >= 60).toBe(true);
    await agent.assert(`the items table has a row "${lineName}" with quantity 2`);
  });

  test('TC-INT-001 a quote becomes an order that is shipped and paid', { timeout: 420_000 }, async ({ app, agent, web, stamp }) => {
    const lineName = `${stamp} Service`;
    await app.open('/backend/sales/documents/create?kind=quote');

    await agent.act('Create the quote for the customer {customer} on the sales channel {channel}. Pick the first address if one is offered.', {
      params: { customer: 'Brightside Solar', channel: 'Mercato Fashion Online' },
    });
    await expect(web).toHaveURL(/\/backend\/sales\/(documents|quotes)\/[0-9a-f-]{36}/i, { timeout: 60_000 });

    await agent.act('On the Items tab, add a custom line named {name} with quantity 1 and a unit price of 50', { params: { name: unique(lineName) } });
    await agent.act('Convert this quote to an order using the Actions menu, confirming if asked');
    await agent.assert(`an order document is showing (not a quote) and its items include a line named "${lineName}"`);

    await agent.act('On the Shipments tab, record a shipment for the whole order with any tracking number, accepting the defaults');
    await agent.assert('the Shipments tab lists exactly one shipment for this order');

    await agent.act('On the Payments tab, record a payment of 50 with any available payment method');
    const payments = await agent.extract('the total amount paid shown on the Payments tab, as a number without currency symbols', {
      schema: z.object({ paidTotal: z.number() }),
    });
    expect(Math.round(payments.paidTotal * 100) / 100).toBe(50);
  });
});
