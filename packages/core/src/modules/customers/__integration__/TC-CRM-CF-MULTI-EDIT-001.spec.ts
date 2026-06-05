import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createCompanyFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

const DEAL_ENTITY_ID = 'customers:customer_deal';

/**
 * TC-CRM-CF-MULTI-EDIT-001
 *
 * Regression for: multichoice / array custom-field values save on CREATE but
 * silently revert on EDIT for deals (reported on the deal detail edit page).
 *
 * Root cause: `useDealFormHandlers` spread the bare-keyed `payload.custom`
 * (e.g. `{ requires_legal_review: true }`) directly into the deal update body.
 * The deal update route's `splitCustomFieldPayload` only routes
 * `customFields` / `customValues` / `cf_` / `cf:` entries to the custom-field
 * writer; bare keys fell into `base` and `dealUpdateSchema.parse` dropped them,
 * so no `setCustomFields` write ran on edit. The CREATE path always wrapped the
 * values under `customFields`, which is why creation persisted them.
 *
 * The fix sends custom-field values under `customFields` on edit too. This test
 * pins the contract at the API layer: a deal updated with a different multi-value
 * set must persist the NEW array and drop the OLD values, and a deal updated with
 * the legacy bare-key shape must NOT persist (proving why the wrapper matters).
 *
 * Self-contained: creates its own custom-field definition + company + deal and
 * cleans everything up in finally. No reliance on seeded data.
 */

async function createMultiSelectDealDefinition(
  request: APIRequestContext,
  token: string,
  input: { key: string; label: string; options: string[] },
): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/entities/definitions', {
    token,
    data: {
      entityId: DEAL_ENTITY_ID,
      key: input.key,
      kind: 'select',
      configJson: {
        label: input.label,
        multi: true,
        options: input.options,
      },
    },
  });
  expect(
    response.status(),
    'POST /api/entities/definitions should create the multi-select deal field',
  ).toBe(200);
}

async function deleteDealDefinition(
  request: APIRequestContext,
  token: string | null,
  key: string,
): Promise<void> {
  if (!token) return;
  const response = await apiRequest(request, 'DELETE', '/api/entities/definitions', {
    token,
    data: { entityId: DEAL_ENTITY_ID, key },
  });
  expect([200, 404]).toContain(response.status());
}

/**
 * Reads `customValues` from the deal LIST endpoint, which serves them from the
 * query INDEX (not the live EAV detail read). The index is now updated
 * synchronously in the write path — the data engine awaits `query_index.upsert_one`
 * so the projection row is committed before the write returns — which makes an
 * immediate read after a write deterministic. Reading the index here (rather than
 * detouring to the live-EAV detail endpoint) exercises the exact surface that
 * regressed: multichoice `customValues` reverting on edit.
 */
async function fetchDealCustomValues(
  request: APIRequestContext,
  token: string,
  dealId: string,
): Promise<Record<string, unknown>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/customers/deals?id=${encodeURIComponent(dealId)}&page=1&pageSize=1`,
    { token },
  );
  expect(response.ok(), `GET /api/customers/deals failed: ${response.status()}`).toBeTruthy();
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response);
  const item = Array.isArray(body?.items) ? body?.items?.[0] : undefined;
  expect(item, 'deal should be returned by list-by-id query').toBeTruthy();
  const record = item as Record<string, unknown>;
  return record.customValues && typeof record.customValues === 'object'
    ? (record.customValues as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).sort();
  if (value === null || value === undefined) return [];
  return [String(value)];
}

test.describe('TC-CRM-CF-MULTI-EDIT-001: deal multichoice custom field persists on edit', () => {
  test('updating a deal multi-select replaces the old values (regression)', async ({ request }) => {
    const stamp = Date.now();
    const fieldKey = `qa_cf_multi_${stamp}`;
    const fieldLabel = `QA Multi ${stamp}`;
    const options = ['alpha', 'beta', 'gamma', 'delta'];

    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request);
      await createMultiSelectDealDefinition(request, token, {
        key: fieldKey,
        label: fieldLabel,
        options,
      });
      companyId = await createCompanyFixture(request, token, `QA CF Multi Co ${stamp}`);

      // CREATE with an initial multi-value set (the path that already worked).
      const createRes = await apiRequest(request, 'POST', '/api/customers/deals', {
        token,
        data: {
          title: `QA CF Multi Deal ${stamp}`,
          companyIds: [companyId],
          customFields: { [fieldKey]: ['alpha', 'beta'] },
        },
      });
      expect(createRes.ok(), `create deal failed: ${createRes.status()}`).toBeTruthy();
      const createBody = await readJsonSafe<{ id?: string }>(createRes);
      dealId = typeof createBody?.id === 'string' ? createBody.id : null;
      expect(dealId, 'create deal should return an id').toBeTruthy();

      // Immediate query-index read (see fetchDealCustomValues) — consistent post-write.
      const afterCreate = await fetchDealCustomValues(request, token, dealId as string);
      expect(asStringArray(afterCreate[fieldKey])).toEqual(['alpha', 'beta']);

      // EDIT to a DIFFERENT multi-value set using the `customFields` wrapper —
      // the shape the fixed `useDealFormHandlers` now sends.
      const updateRes = await apiRequest(request, 'PUT', '/api/customers/deals', {
        token,
        data: {
          id: dealId,
          title: `QA CF Multi Deal ${stamp} edited`,
          customFields: { [fieldKey]: ['gamma', 'delta'] },
        },
      });
      expect(updateRes.ok(), `update deal failed: ${updateRes.status()}`).toBeTruthy();

      // New set persists, and the old values (alpha/beta) are gone.
      const afterUpdate = await fetchDealCustomValues(request, token, dealId as string);
      expect(asStringArray(afterUpdate[fieldKey])).toEqual(['delta', 'gamma']);
      expect(asStringArray(afterUpdate[fieldKey])).not.toContain('alpha');
      expect(asStringArray(afterUpdate[fieldKey])).not.toContain('beta');
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteDealDefinition(request, token, fieldKey);
    }
  });

  test('legacy bare-key edit body does NOT persist custom fields (proves the wrapper is required)', async ({ request }) => {
    const stamp = Date.now() + 1;
    const fieldKey = `qa_cf_bare_${stamp}`;
    const fieldLabel = `QA Bare ${stamp}`;
    const options = ['one', 'two', 'three'];

    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request);
      await createMultiSelectDealDefinition(request, token, {
        key: fieldKey,
        label: fieldLabel,
        options,
      });
      companyId = await createCompanyFixture(request, token, `QA CF Bare Co ${stamp}`);

      const createRes = await apiRequest(request, 'POST', '/api/customers/deals', {
        token,
        data: {
          title: `QA CF Bare Deal ${stamp}`,
          companyIds: [companyId],
          customFields: { [fieldKey]: ['one'] },
        },
      });
      expect(createRes.ok(), `create deal failed: ${createRes.status()}`).toBeTruthy();
      const createBody = await readJsonSafe<{ id?: string }>(createRes);
      dealId = typeof createBody?.id === 'string' ? createBody.id : null;
      expect(dealId, 'create deal should return an id').toBeTruthy();

      // Reproduce the OLD buggy edit body: bare key spread into the root.
      const updateRes = await apiRequest(request, 'PUT', '/api/customers/deals', {
        token,
        data: {
          id: dealId,
          title: `QA CF Bare Deal ${stamp} edited`,
          [fieldKey]: ['two', 'three'],
        },
      });
      expect(updateRes.ok(), `update deal failed: ${updateRes.status()}`).toBeTruthy();

      // The bare key is dropped by dealUpdateSchema.parse → custom value unchanged.
      const afterUpdate = await fetchDealCustomValues(request, token, dealId as string);
      expect(asStringArray(afterUpdate[fieldKey])).toEqual(['one']);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteDealDefinition(request, token, fieldKey);
    }
  });
});
