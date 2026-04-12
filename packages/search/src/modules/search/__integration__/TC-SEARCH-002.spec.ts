import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures';
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

type SearchHit = {
  entityId?: string;
  source?: string;
  presenter?: {
    title?: string | null;
  } | null;
};

type SearchResponse = {
  results?: SearchHit[];
};

async function isFulltextConfigured(
  request: APIRequestContext,
  token: string,
): Promise<boolean> {
  const response = await apiRequest(request, 'GET', '/api/search/settings', { token });
  expect(response.ok(), `Failed to read search settings: ${response.status()}`).toBeTruthy();
  const body = await readJsonSafe<{ fulltextConfigured?: boolean }>(response);
  return body?.fulltextConfigured === true;
}

async function reindexFulltextEntity(
  request: APIRequestContext,
  token: string,
  entityId: string,
): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/search/reindex', {
    token,
    data: {
      action: 'reindex',
      entityId,
      useQueue: false,
    },
  });
  const body = await readJsonSafe<Record<string, unknown>>(response);
  expect(
    response.ok(),
    `Failed to reindex ${entityId}: ${response.status()} ${JSON.stringify(body ?? {})}`,
  ).toBeTruthy();
}

async function searchTitles(
  request: APIRequestContext,
  token: string,
  query: string,
  entityId: string,
): Promise<string[]> {
  const params = new URLSearchParams({
    q: query,
    strategies: 'fulltext',
    entityTypes: entityId,
    limit: '10',
  });
  const response = await apiRequest(request, 'GET', `/api/search/search?${params.toString()}`, {
    token,
  });
  const body = await readJsonSafe<SearchResponse>(response);
  expect(response.ok(), `Search failed for "${query}": ${response.status()}`).toBeTruthy();
  const results = Array.isArray(body?.results) ? body.results : [];
  return results
    .filter((result) => result.source === 'fulltext')
    .map((result) => result.presenter?.title)
    .filter((title): title is string => typeof title === 'string' && title.length > 0);
}

async function waitForSearchTitle(
  request: APIRequestContext,
  token: string,
  query: string,
  entityId: string,
  expectedTitle: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const titles = await searchTitles(request, token, query, entityId);
        return titles.includes(expectedTitle);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

async function createPersonSearchFixture(
  request: APIRequestContext,
  token: string,
  input: {
    displayName: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    primaryEmail: string;
    primaryPhone: string;
  },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/people', {
    token,
    data: input,
  });
  const body = await readJsonSafe<{ id?: unknown; entityId?: unknown; personId?: unknown }>(response);
  expect(response.ok(), `Failed to create person fixture: ${response.status()}`).toBeTruthy();
  return expectId(body?.id ?? body?.entityId ?? body?.personId, 'Expected person fixture id');
}

async function createProductSearchFixture(
  request: APIRequestContext,
  token: string,
  input: {
    title: string;
    sku: string;
    metadataToken: string;
  },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/catalog/products', {
    token,
    data: {
      title: input.title,
      sku: input.sku,
      description: `Search QA product ${input.title}`,
      metadata: {
        qaHiddenSearchToken: input.metadataToken,
      },
    },
  });
  const body = await readJsonSafe<{ id?: unknown }>(response);
  expect(response.ok(), `Failed to create product fixture: ${response.status()}`).toBeTruthy();
  return expectId(body?.id, 'Expected product fixture id');
}

/**
 * TC-SEARCH-002: Fulltext search respects field-policy searchable boundaries
 */
test.describe('TC-SEARCH-002: Fulltext search respects field-policy searchable boundaries', () => {
  let token = '';

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin');
  });

  test('searches person profile searchable fields without matching hash-only email fields', async ({ request }) => {
    const fulltextConfigured = await isFulltextConfigured(request, token);
    test.skip(!fulltextConfigured, 'Fulltext search is not configured in this runtime.');

    const stamp = `${Date.now()}-person`;
    const displayName = `QA Search Person ${stamp}`;
    const firstName = `Searchable${stamp}`;
    const lastName = 'Coverage';
    const jobTitle = `Signal ${stamp}`;
    const emailToken = `masked-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
    const primaryEmail = `${emailToken}@example.test`;
    const primaryPhone = '+14155550123';

    let personEntityId: string | null = null;

    try {
      personEntityId = await createPersonSearchFixture(request, token, {
        displayName,
        firstName,
        lastName,
        jobTitle,
        primaryEmail,
        primaryPhone,
      });

      await reindexFulltextEntity(request, token, 'customers:customer_person_profile');
      await waitForSearchTitle(
        request,
        token,
        firstName,
        'customers:customer_person_profile',
        displayName,
      );
      await waitForSearchTitle(
        request,
        token,
        jobTitle,
        'customers:customer_person_profile',
        displayName,
      );

      const emailTitles = await searchTitles(
        request,
        token,
        primaryEmail,
        'customers:customer_person_profile',
      );
      expect(emailTitles).not.toContain(displayName);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personEntityId);
    }
  });

  test('searches product searchable fields without matching excluded metadata fields', async ({ request }) => {
    const fulltextConfigured = await isFulltextConfigured(request, token);
    test.skip(!fulltextConfigured, 'Fulltext search is not configured in this runtime.');

    const stamp = `${Date.now()}-product`;
    const title = `QA Search Product ${stamp}`;
    const sku = `QA-SEARCH-${Date.now()}`;
    const metadataToken = `hidden-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;

    let productId: string | null = null;

    try {
      productId = await createProductSearchFixture(request, token, {
        title,
        sku,
        metadataToken,
      });

      await reindexFulltextEntity(request, token, 'catalog:catalog_product');
      await waitForSearchTitle(request, token, title, 'catalog:catalog_product', title);

      const metadataTitles = await searchTitles(
        request,
        token,
        metadataToken,
        'catalog:catalog_product',
      );
      expect(metadataTitles).not.toContain(title);
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
