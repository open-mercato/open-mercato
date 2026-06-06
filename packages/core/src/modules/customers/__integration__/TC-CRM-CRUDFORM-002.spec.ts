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
 * Verified contract (from `api/companies/route.ts` + `api/companies/[id]/route.ts`):
 * - `makeCrudRoute`: POST→201 `{id, companyId}`, PUT (body `id`)→200, DELETE `?id=`. Scope is
 *   injected server-side via `withScopedPayload` — never sent.
 * - Writes go through the makeCrud collection route; read-back uses the DETAIL GET
 *   `/api/customers/companies/{id}` and re-maps its camelCase `company`/`profile`/`customFields`
 *   payload to the snake_case keys asserted here. The detail route reads live from the entity +
 *   profile tables, so it is immune to the makeCrud list (`?ids=`) response cache that
 *   `ENABLE_CRUD_API_CACHE=true` keeps — an immediate post-update `?ids=` read can otherwise
 *   serve a stale create-era response when cache invalidation races under CI load (the failure
 *   this spec originally hit: after-update `industry` read back as the create value).
 * - Request bodies camelCase; custom fields submit as `cf_<key>` and the detail route returns
 *   them as a bare-keyed `customFields` object (mapped to `customValues` for the harness resolver).
 *   `annualRevenue` is a decimal column returned as a string, so the `readById` coerces it to a
 *   number for deep-equality comparison.
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

type CompanyDetailBody = {
  company?: CrudRecord & { id?: string };
  profile?: (CrudRecord & { annualRevenue?: string | number | null }) | null;
  customFields?: Record<string, unknown>;
};

// Read back through the detail GET (live entity + profile read) rather than the makeCrud
// `?ids=` list, whose response the CRUD API cache can serve stale on an immediate post-update
// read. Re-map the camelCase detail payload to the snake_case keys the assertions expect.
async function readCompanyById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(request, 'GET', `${COMPANIES_PATH}/${encodeURIComponent(id)}`, { token });
  expect(response.status(), `read-back company detail failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<CompanyDetailBody>(response);
  const company = body?.company;
  if (!company || company.id !== id) return null;
  const profile = body?.profile ?? {};
  const annualRevenue = profile.annualRevenue;
  return {
    id: company.id,
    display_name: company.displayName,
    description: company.description,
    primary_email: company.primaryEmail,
    primary_phone: company.primaryPhone,
    status: company.status,
    lifecycle_stage: company.lifecycleStage,
    source: company.source,
    legal_name: profile.legalName,
    brand_name: profile.brandName,
    domain: profile.domain,
    website_url: profile.websiteUrl,
    industry: profile.industry,
    size_bucket: profile.sizeBucket,
    // annual_revenue is a decimal column serialized as a string; coerce so deep-equality holds.
    annual_revenue: annualRevenue == null ? null : Number(annualRevenue),
    customValues: body?.customFields ?? {},
  };
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
      readById: (id) => readCompanyById(request, token, id),
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
