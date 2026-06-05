import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-CRM-CRUDFORM-001: Person CrudForm persists scalars, dictionary refs + custom fields (#2466).
 *
 * The customers `person` surface is a rich-field CrudForm: base scalars (displayName,
 * description, primaryEmail/Phone), person-profile scalars (firstName, lastName, jobTitle,
 * department, seniority, timezone, preferredName, linkedInUrl, twitterUrl), a company link FK
 * (companyEntityId), dictionary-backed free-string fields (status, lifecycleStage, source),
 * and three custom-field kinds (select `buying_role`, text `preferred_pronouns`, boolean
 * `newsletter_opt_in`). Proves create + update round-trip every value.
 *
 * Verified contract (from `api/people/route.ts`):
 * - `makeCrudRoute`: POST→201 `{id, personId}`, PUT (body `id`)→200, DELETE `?id=`. Scope
 *   (organizationId/tenantId) is injected server-side via `withScopedPayload` — never sent.
 * - The list read filters by `?ids=` (comma-separated), so a custom `readById`.
 * - Request bodies camelCase; list responses snake_case (`display_name`, `company_entity_id`,
 *   …). Custom fields submit as `cf_<key>` and the harness resolver reads them back regardless
 *   of shape.
 * - PUT is a partial update — omitted scalars (firstName/lastName/companyEntityId/primaryEmail)
 *   are retained, asserted after update.
 * - The dictionary-backed fields (status/lifecycleStage/source) accept arbitrary strings at the
 *   API layer, so the spec stays self-contained without seeding dictionary entries (mirrors the
 *   resources reference spec skipping example-seeded dictionary values).
 * - `tags` is the person multiselect but is not surfaced on the list response, so multiselect
 *   round-trip is covered on the deal surface (TC-CRM-CRUDFORM-003) where the API returns it.
 *
 * Self-contained: creates its own company (for the companyEntityId link), deletes it in
 * `finally`. The person itself is deleted by `runCrudFormRoundTrip`. Custom-field definitions
 * are module seedDefaults (always installed by `initialize`), not example/demo data.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const PEOPLE_PATH = '/api/customers/people';
const COMPANIES_PATH = '/api/customers/companies';

async function readPersonByIds(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${PEOPLE_PATH}?ids=${encodeURIComponent(id)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), `read-back people failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response);
  return (body?.items ?? []).find((item) => item.id === id) ?? null;
}

test.describe('TC-CRM-CRUDFORM-001: Person CrudForm persists scalars, dictionary refs + custom fields', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips scalars, profile fields, company link + custom fields on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    let companyId: string | null = null;

    try {
      companyId = await createCompanyFixture(request, token, `QA CRUDFORM Person Company ${stamp}`);

      await runCrudFormRoundTrip({
        request,
        token,
        collectionPath: PEOPLE_PATH,
        readById: (id) => readPersonByIds(request, token, id),
        create: {
          payload: {
            firstName: 'Ada',
            lastName: 'Lovelace',
            displayName: `QA CRUDFORM Person ${stamp}`,
            description: 'Original person description',
            primaryEmail: `qa.person.${stamp}@crudform.example`,
            primaryPhone: '+14155552671',
            jobTitle: 'Chief Analyst',
            department: 'Engineering',
            seniority: 'senior',
            timezone: 'America/New_York',
            preferredName: 'Ada',
            linkedInUrl: 'https://www.linkedin.com/in/ada-crudform',
            twitterUrl: 'https://twitter.com/ada_crudform',
            companyEntityId: companyId,
            status: 'active',
            lifecycleStage: 'lead',
            source: 'referral',
            cf_buying_role: 'champion',
            cf_preferred_pronouns: 'she/her',
            cf_newsletter_opt_in: true,
          },
        },
        expectAfterCreate: {
          scalars: {
            display_name: `QA CRUDFORM Person ${stamp}`,
            description: 'Original person description',
            first_name: 'Ada',
            last_name: 'Lovelace',
            primary_email: `qa.person.${stamp}@crudform.example`,
            primary_phone: '+14155552671',
            job_title: 'Chief Analyst',
            department: 'Engineering',
            seniority: 'senior',
            timezone: 'America/New_York',
            preferred_name: 'Ada',
            linked_in_url: 'https://www.linkedin.com/in/ada-crudform',
            twitter_url: 'https://twitter.com/ada_crudform',
            company_entity_id: companyId,
            status: 'active',
            lifecycle_stage: 'lead',
            source: 'referral',
          },
          customFields: {
            buying_role: 'champion',
            preferred_pronouns: 'she/her',
            newsletter_opt_in: true,
          },
        },
        update: {
          payload: (id) => ({
            id,
            displayName: `QA CRUDFORM Person ${stamp} EDITED`,
            description: 'Updated person description',
            jobTitle: 'VP Engineering',
            seniority: 'executive',
            status: 'customer',
            lifecycleStage: 'customer',
            cf_buying_role: 'economic_buyer',
            cf_preferred_pronouns: 'they/them',
            cf_newsletter_opt_in: false,
          }),
        },
        expectAfterUpdate: {
          scalars: {
            display_name: `QA CRUDFORM Person ${stamp} EDITED`,
            description: 'Updated person description',
            job_title: 'VP Engineering',
            seniority: 'executive',
            status: 'customer',
            lifecycle_stage: 'customer',
            // Partial update retains untouched scalars.
            first_name: 'Ada',
            last_name: 'Lovelace',
            primary_email: `qa.person.${stamp}@crudform.example`,
            company_entity_id: companyId,
          },
          customFields: {
            buying_role: 'economic_buyer',
            preferred_pronouns: 'they/them',
            newsletter_opt_in: false,
          },
        },
      });
    } finally {
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId);
    }
  });
});
