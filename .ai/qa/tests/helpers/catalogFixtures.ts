import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';

type ProductFixtureInput = {
  title: string;
  sku: string;
};

export async function createProductFixture(
  request: APIRequestContext,
  token: string,
  input: ProductFixtureInput,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/catalog/products', {
    token,
    data: {
      title: input.title,
      sku: input.sku,
      description:
        'Long enough description for SEO checks in QA automation flows. This text keeps the create validation satisfied.',
    },
  });
  expect(response.ok(), `Failed to create product fixture: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy();
  return body.id as string;
}

export async function deleteCatalogProductIfExists(
  request: APIRequestContext,
  token: string | null,
  productId: string | null,
): Promise<void> {
  if (!token || !productId) return;
  try {
    await apiRequest(request, 'DELETE', `/api/catalog/products?id=${encodeURIComponent(productId)}`, { token });
  } catch {
    return;
  }
}

