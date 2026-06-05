import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-CRM-CRUDFORM-002: Company CrudForm persists scalars, dictionary refs + custom fields (#2466).
 *
 * The customers `company` surface is a rich-field CrudForm: base scalars (displayName,
 * description, primaryEmail/Phone), company-profile scalars (legalName, brandName, domain,
 * websiteUrl, industry, sizeBucket, annualRevenue), dictionary-backed free-string fields
 * (status, lifecycleStage, source), and three custom-field kinds (select `relationship_health`,
 * multiline `executive_notes`, boolean `customer_marketing_case`). Proves create + update
 * round-trip every value.
 *
 * The fourth ce.ts company custom field, `renewal_quarter`, is intentionally NOT covered: its
 * key collides with the entity's own `renewal_quarter` scalar column (`CustomerEntity.renewalQuarter`,
 * set via the camelCase `renewalQuarter` payload key). The scalar shadows the custom field in the
 * query-index projection, so the custom field cannot round-trip through the index-backed list read.
 * That collision is a data-model issue outside the scope of this test-coverage change.
 *
 * Verified contract (from `api/companies/route.ts`):
 * - `makeCrudRoute`: POST→201 `{id, companyId}`, PUT (body `id`)→200, DELETE `?id=`. Scope is
 *   injected server-side via `withScopedPayload` — never sent.
 * - The list read filters by `?ids=` (comma-separated), so a custom `readById`.
 * - Request bodies camelCase; list responses snake_case (`legal_name`, `website_url`,
 *   `annual_revenue`, …). `annualRevenue` is a decimal column returned as a string, so the
 *   `readById` coerces it to a number for deep-equality comparison.
 * - PUT is a partial update — omitted scalars (legalName/brandName/primaryEmail) and omitted
 *   custom fields (`executive_notes`) are retained, asserted after update.
 * - The dictionary-backed fields accept arbitrary strings at the API layer, so the spec stays
 *   self-contained without seeding dictionary entries.
 *
 * Self-contained: the company is created and deleted by `runCrudFormRoundTrip`; it has no
 * dependents so the cleanup DELETE succeeds. Custom-field definitions are module seedDefaults
 * (always installed by `initialize`), not example/demo data.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const COMPANIES_PATH = '/api/customers/companies';

async function readCompanyByIds(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${COMPANIES_PATH}?ids=${encodeURIComponent(id)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), `read-back companies failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response);
  const record = (body?.items ?? []).find((item) => item.id === id) ?? null;
  // annual_revenue is a decimal column serialized as a string; coerce so deep-equality holds.
  if (record && record.annual_revenue != null) {
    record.annual_revenue = Number(record.annual_revenue);
  }
  return record;
}

test.describe('TC-CRM-CRUDFORM-002: Company CrudForm persists scalars, dictionary refs + custom fields', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips scalars, profile fields + custom fields on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();

    await runCrudFormRoundTrip({
      request,
      token,
      collectionPath: COMPANIES_PATH,
      readById: (id) => readCompanyByIds(request, token, id),
      create: {
        payload: {
          displayName: `QA CRUDFORM Company ${stamp}`,
          description: 'Original company description',
          primaryEmail: `qa.company.${stamp}@crudform.example`,
          primaryPhone: '+14155552671',
          status: 'prospect',
          lifecycleStage: 'opportunity',
          source: 'inbound',
          legalName: 'QA CRUDFORM Industries Inc.',
          brandName: 'CRUDFORM',
          domain: `crudform-${stamp}.example`,
          websiteUrl: 'https://crudform.example',
          industry: 'Software',
          sizeBucket: '51-200',
          annualRevenue: 2500000,
          cf_relationship_health: 'healthy',
          cf_executive_notes: 'Strategic account; exec sponsor engaged.',
          cf_customer_marketing_case: true,
        },
      },
      expectAfterCreate: {
        scalars: {
          display_name: `QA CRUDFORM Company ${stamp}`,
          description: 'Original company description',
          primary_email: `qa.company.${stamp}@crudform.example`,
          primary_phone: '+14155552671',
          status: 'prospect',
          lifecycle_stage: 'opportunity',
          source: 'inbound',
          legal_name: 'QA CRUDFORM Industries Inc.',
          brand_name: 'CRUDFORM',
          domain: `crudform-${stamp}.example`,
          website_url: 'https://crudform.example',
          industry: 'Software',
          size_bucket: '51-200',
          annual_revenue: 2500000,
        },
        customFields: {
          relationship_health: 'healthy',
          executive_notes: 'Strategic account; exec sponsor engaged.',
          customer_marketing_case: true,
        },
      },
      update: {
        payload: (id) => ({
          id,
          displayName: `QA CRUDFORM Company ${stamp} EDITED`,
          description: 'Updated company description',
          industry: 'Fintech',
          sizeBucket: '201-500',
          annualRevenue: 5000000,
          status: 'customer',
          cf_relationship_health: 'at_risk',
          cf_customer_marketing_case: false,
        }),
      },
      expectAfterUpdate: {
        scalars: {
          display_name: `QA CRUDFORM Company ${stamp} EDITED`,
          description: 'Updated company description',
          industry: 'Fintech',
          size_bucket: '201-500',
          annual_revenue: 5000000,
          status: 'customer',
          // Partial update retains untouched scalars.
          legal_name: 'QA CRUDFORM Industries Inc.',
          brand_name: 'CRUDFORM',
          primary_email: `qa.company.${stamp}@crudform.example`,
        },
        customFields: {
          relationship_health: 'at_risk',
          customer_marketing_case: false,
          // Custom-field update is per-key partial — the omitted key is retained.
          executive_notes: 'Strategic account; exec sponsor engaged.',
        },
      },
    });
  });
});
