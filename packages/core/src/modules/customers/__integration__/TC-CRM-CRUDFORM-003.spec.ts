import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCompanyFixture,
  createPersonFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-CRM-CRUDFORM-003: Deal CrudForm persists scalars, references, multiselect + custom fields (#2466).
 *
 * The customers `deal` surface is the richest customers CrudForm: scalars (title, description,
 * status, valueAmount, valueCurrency, probability, source, expectedCloseAt), pipeline reference
 * fields (pipelineId, pipelineStageId), two multiselect/array associations (personIds,
 * companyIds), and four custom-field kinds (select `competitive_risk`, select
 * `implementation_complexity`, integer `estimated_seats`, boolean `requires_legal_review`).
 * Proves create + update round-trip every value.
 *
 * Why this spec reads back via the DETAIL endpoint (not the `?ids=` list, unlike the person /
 * company specs):
 * - The deal LIST serves custom values from the query-index projection. The deal UPDATE runs
 *   through a transactional command (`withAtomicFlush` + a separate `setCustomFields` flush +
 *   post-commit side effects), so under CI load the projection can lag and an immediate list
 *   read intermittently returns `[]` custom values. The detail GET (`/api/customers/deals/{id}`)
 *   resolves custom fields LIVE from EAV, so persistence is asserted deterministically. The
 *   same race is documented in `TC-CRM-CF-MULTI-EDIT-001`.
 * - Writes still go through the collection route (`POST`/`PUT`/`DELETE /api/customers/deals`) —
 *   exactly what the deal CrudForm submits — so route fidelity is preserved.
 *
 * The `readById` adapter normalizes the detail shape to what the harness expects:
 * - `valueAmount`/`probability` are decimal columns serialized as strings → coerced to numbers.
 * - `linkedPersonIds`/`linkedCompanyIds` → `personIds`/`companyIds` (sorted for order-stable
 *   deep-equality).
 * - `customFields` (a bare-keyed object) → `customValues` so the harness custom-field resolver
 *   reads it.
 *
 * `expectedCloseAt` is computed at runtime (never a static future literal) so the spec does not
 * trip the time-bomb scanner; the create/update payload and expectation derive from the same
 * ISO value, so the round-trip assertion is exact.
 *
 * Self-contained: creates its own company, two people, pipeline + stage; deletes them in
 * `finally` (the deal is deleted by `runCrudFormRoundTrip`). Custom-field definitions are module
 * seedDefaults (always installed by `initialize`), not example/demo data.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const DEALS_PATH = '/api/customers/deals';
const COMPANIES_PATH = '/api/customers/companies';
const PEOPLE_PATH = '/api/customers/people';
const PIPELINES_PATH = '/api/customers/pipelines';
const PIPELINE_STAGES_PATH = '/api/customers/pipeline-stages';

type DealDetailBody = {
  deal?: CrudRecord & { id?: string; valueAmount?: string | number | null; probability?: string | number | null };
  linkedPersonIds?: string[];
  linkedCompanyIds?: string[];
  customFields?: Record<string, unknown>;
};

async function readDealDetail(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(request, 'GET', `${DEALS_PATH}/${encodeURIComponent(id)}`, { token });
  expect(response.status(), `read-back deal detail failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<DealDetailBody>(response);
  const deal = body?.deal;
  if (!deal || deal.id !== id) return null;
  return {
    ...deal,
    valueAmount: deal.valueAmount == null ? null : Number(deal.valueAmount),
    probability: deal.probability == null ? null : Number(deal.probability),
    personIds: [...(body?.linkedPersonIds ?? [])].sort(),
    companyIds: [...(body?.linkedCompanyIds ?? [])].sort(),
    customValues: body?.customFields ?? {},
  };
}

test.describe('TC-CRM-CRUDFORM-003: Deal CrudForm persists scalars, references, multiselect + custom fields', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips scalars, pipeline refs, person/company arrays + custom fields on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();

    const closeAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    closeAt.setUTCHours(0, 0, 0, 0);
    const expectedCloseAtIso = closeAt.toISOString();
    const closeAt2 = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000);
    closeAt2.setUTCHours(0, 0, 0, 0);
    const expectedCloseAtIso2 = closeAt2.toISOString();

    let companyId: string | null = null;
    let personAId: string | null = null;
    let personBId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;

    try {
      companyId = await createCompanyFixture(request, token, `QA CRUDFORM Deal Company ${stamp}`);
      personAId = await createPersonFixture(request, token, {
        firstName: 'Grace',
        lastName: 'Hopper',
        displayName: `QA CRUDFORM Deal Person A ${stamp}`,
      });
      personBId = await createPersonFixture(request, token, {
        firstName: 'Alan',
        lastName: 'Turing',
        displayName: `QA CRUDFORM Deal Person B ${stamp}`,
      });
      pipelineId = await createPipelineFixture(request, token, { name: `QA CRUDFORM Pipeline ${stamp}` });
      stageId = await createPipelineStageFixture(request, token, {
        pipelineId,
        label: `QA CRUDFORM Stage ${stamp}`,
        order: 0,
      });

      await runCrudFormRoundTrip({
        request,
        token,
        collectionPath: DEALS_PATH,
        readById: (id) => readDealDetail(request, token, id),
        create: {
          payload: {
            title: `QA CRUDFORM Deal ${stamp}`,
            description: 'Original deal description',
            status: 'open',
            valueAmount: 50000,
            valueCurrency: 'USD',
            probability: 40,
            source: 'outbound',
            expectedCloseAt: expectedCloseAtIso,
            pipelineId,
            pipelineStageId: stageId,
            companyIds: [companyId],
            personIds: [personAId],
            cf_competitive_risk: 'medium',
            cf_implementation_complexity: 'standard',
            cf_estimated_seats: 25,
            cf_requires_legal_review: true,
          },
        },
        expectAfterCreate: {
          scalars: {
            title: `QA CRUDFORM Deal ${stamp}`,
            description: 'Original deal description',
            status: 'open',
            valueAmount: 50000,
            valueCurrency: 'USD',
            probability: 40,
            source: 'outbound',
            expectedCloseAt: expectedCloseAtIso,
            pipelineId,
            pipelineStageId: stageId,
            personIds: [personAId],
            companyIds: [companyId],
          },
          customFields: {
            competitive_risk: 'medium',
            implementation_complexity: 'standard',
            estimated_seats: 25,
            requires_legal_review: true,
          },
        },
        update: {
          payload: (id) => ({
            id,
            title: `QA CRUDFORM Deal ${stamp} EDITED`,
            description: 'Updated deal description',
            valueAmount: 75000,
            valueCurrency: 'EUR',
            probability: 75,
            expectedCloseAt: expectedCloseAtIso2,
            // Multiselect replace: swap the linked person, keep the company (sent explicitly).
            personIds: [personBId],
            companyIds: [companyId],
            cf_competitive_risk: 'high',
            cf_implementation_complexity: 'complex',
            cf_estimated_seats: 60,
            cf_requires_legal_review: false,
          }),
        },
        expectAfterUpdate: {
          scalars: {
            title: `QA CRUDFORM Deal ${stamp} EDITED`,
            description: 'Updated deal description',
            valueAmount: 75000,
            valueCurrency: 'EUR',
            probability: 75,
            expectedCloseAt: expectedCloseAtIso2,
            personIds: [personBId],
            companyIds: [companyId],
            // Partial update retains untouched scalars.
            status: 'open',
            source: 'outbound',
          },
          customFields: {
            competitive_risk: 'high',
            implementation_complexity: 'complex',
            estimated_seats: 60,
            requires_legal_review: false,
          },
        },
      });
    } finally {
      await deleteEntityByBody(request, token, PIPELINE_STAGES_PATH, stageId);
      await deleteEntityByBody(request, token, PIPELINES_PATH, pipelineId);
      await deleteEntityIfExists(request, token, PEOPLE_PATH, personAId);
      await deleteEntityIfExists(request, token, PEOPLE_PATH, personBId);
      await deleteEntityIfExists(request, token, COMPANIES_PATH, companyId);
    }
  });
});
