import { test, expect, unique } from './support/fixtures';
import { idFromUrl } from './support/api';

const PRODUCTS = '/api/catalog/products';
const CATEGORIES = '/api/catalog/categories';

/**
 * Catalog.
 * Ported from .ai/qa/scenarios/TC-CAT-001, 004, 007.
 */
test.describe('catalog', { tags: ['catalog'], session: 'admin' }, () => {
  test('TC-CAT-001 creates a product with a SKU', async ({ app, agent, api, stamp, web, screen }) => {
    const title = `${stamp} Sneaker`;
    const sku = stamp.replace(/\s+/g, '-').toUpperCase();
    await app.open('/backend/catalog/products');

    await agent.act(
      'Create a new product titled {title} with the description {description}, and set its SKU to {sku} (the SKU lives on the Variants tab). Submit the form.',
      {
        params: {
          title: unique(title),
          sku: unique(sku),
          description: 'A lightweight everyday sneaker created by the agentic end-to-end suite to verify the product creation flow.',
        },
      },
    );

    await expect(web).toHaveURL(/\/backend\/catalog\/products\/[0-9a-f-]{36}$/i, { timeout: 60_000 });
    const productId = idFromUrl(await web.url());
    api.track(PRODUCTS, productId);
    // A replayed step lands here before the product page has loaded; the title is the load's proof.
    await expect(screen.getByText(title).first()).toBeVisible({ timeout: 30_000 });
    await agent.assert(`the product page for "${title}" is showing`);

    const products = await api.list<{ id: string; sku: string | null; title: string }>(`${PRODUCTS}?search=${encodeURIComponent(title)}&pageSize=20`);
    const created = products.find((product) => product.id === productId);
    expect(created?.title).toBe(title);
  });

  test('TC-CAT-007 creates a root category', async ({ app, agent, api, stamp }) => {
    const name = `${stamp} Category`;
    await app.open('/backend/catalog/categories');

    await agent.act('Create a new top-level category named {name} with no parent. Submit the form.', { params: { name: unique(name) } });
    await agent.assert(`a category named "${name}" now exists in the categories view`);

    const categories = await api.list<{ id: string; name: string }>(`${CATEGORIES}?search=${encodeURIComponent(name)}&pageSize=50`);
    const created = categories.find((category) => category.name === name);
    expect(created).toBeTruthy();
    api.track(CATEGORIES, created?.id);
  });

  test('TC-CAT-004 deletes a product from the list', async ({ app, agent, api, stamp }) => {
    const title = `${stamp} Discontinued`;
    const productId = await api.create(PRODUCTS, {
      title,
      sku: `${stamp.replace(/\s+/g, '-').toUpperCase()}-DEL`,
      description: 'Long enough description for SEO checks in QA automation flows. This text keeps the create validation satisfied.',
    });
    await app.open('/backend/catalog/products');

    await agent.act('Find the product {title} in the list, delete it, and confirm the deletion', { params: { title: unique(title) } });
    await agent.assert(`the products list no longer contains "${title}"`);

    await expect
      .poll(async () => {
        const products = await api.list<{ id: string }>(`${PRODUCTS}?search=${encodeURIComponent(title)}&pageSize=20`);
        return products.some((product) => product.id === productId);
      }, { timeout: 30_000 })
      .toBe(false);
  });
});
