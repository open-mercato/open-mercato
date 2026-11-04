import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createCompanyFixture,
  createPersonFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

const DEAL_ENTITY_ID = 'customers:customer_deal';

async function createCustomFieldDefinition(
  request: APIRequestContext,
  token: string,
  input: { key: string; label: string },
): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/entities/definitions', {
    token,
    data: {
      entityId: DEAL_ENTITY_ID,
      key: input.key,
      kind: 'text',
      configJson: {
        label: input.label,
        validation: [],
      },
    },
  });
  expect(response.status(), 'POST /api/entities/definitions should create the deal custom field').toBe(200);
}

async function deleteCustomFieldDefinition(
  request: APIRequestContext,
  token: string | null,
  key: string,
): Promise<void> {
  if (!token) return;
  const response = await apiRequest(request, 'DELETE', '/api/entities/definitions', {
    token,
    data: {
      entityId: DEAL_ENTITY_ID,
      key,
    },
  });
  expect([200, 404]).toContain(response.status());
}

/**
 * TC-CRM-071: Create deal (UX redesign) — two-column custom layout
 * Source spec: .ai/specs/2026-05-24-create-deal-page-ux-redesign.md
 *
 * Pure frontend redesign of /backend/customers/deals/create. The deal API/entity/command
 * are unchanged, so this exercises the new custom-composed layout end to end: fill the
 * required title plus value/probability/custom field, link a person and a company through the avatar/
 * building chip search fields, submit via the primary "Create deal" action, and assert the
 * redirect back to the deals list plus the new deal showing up there.
 *
 * Self-contained: the linkable person + company are created via API in setup and everything
 * (deal + fixtures) is cleaned up in the finally block. No reliance on seeded/demo data.
 */
test.describe('TC-CRM-071: Create deal (UX redesign)', () => {
  test.setTimeout(180_000);

  test('creates a deal with linked person and company from the redesigned create page', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    const personName = `QA TC-CRM-071 Person ${stamp}`;
    const companyName = `QA TC-CRM-071 Co ${stamp}`;
    const dealTitle = `QA TC-CRM-071 Deal ${stamp}`;
    const customFieldKey = `qa_crm_071_${stamp}`;
    const customFieldLabel = `QA CRM 071 Field ${stamp}`;
    const customFieldValue = `Implementation note ${stamp}`;

    let token: string | null = null;
    let personId: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request);
      await createCustomFieldDefinition(request, token, {
        key: customFieldKey,
        label: customFieldLabel,
      });
      companyId = await createCompanyFixture(request, token, companyName);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM071 ${stamp}`,
        displayName: personName,
      });

      await login(page, 'admin');
      await page.goto('/backend/customers/deals/create', { waitUntil: 'domcontentloaded' });

      // Readiness: the pinned action bar renders the back-link; the page title lives in the app
      // breadcrumb and an sr-only h1 (#5109). Wait for the link plus the required field before
      // interacting.
      await expect(page.getByRole('link', { name: /Back to deals/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('heading', { level: 1, name: 'Create deal' })).toBeAttached();

      // CRITICAL — wait for the form to be fully hydrated before typing. Deal title lives in client
      // state and the "Create deal" submit button stays disabled until the async custom-field load
      // resolves (`submitDisabled = !customFieldsLoaded`). Client registries hydrate lazily, so filling
      // inputs before hydration completes lets React reset the controlled values when it attaches —
      // the title silently clears and submit is then blocked by "Title is required" (the form never
      // POSTs, the test times out, and its required custom-field definition is orphaned tenant-wide,
      // which cascades into the retry). Gating on the enabled submit button guarantees hydration +
      // custom fields are ready, so every subsequent fill sticks.
      const submitButton = page.getByRole('button', { name: 'Create deal', exact: true }).first();
      await expect(submitButton).toBeEnabled({ timeout: 30_000 });

      // DealFormField associates each <Label> with its control via useId/htmlFor, so the required
      // title field exposes the accessible label "Deal title" (plus a "*" required marker) — target it
      // by label rather than relying on DOM order.
      const titleInput = page.getByLabel(/Deal title/i);
      await expect(titleInput).toBeVisible();
      await titleInput.fill(dealTitle);

      // Probability and the custom attributes sit under "More details" (#5109). The fixture's
      // required custom field opens the disclosure on load; expand it explicitly otherwise.
      const moreDetailsToggle = page.getByRole('button', { name: 'More details', exact: true });
      await expect(moreDetailsToggle).toBeVisible();
      if ((await moreDetailsToggle.getAttribute('aria-expanded')) !== 'true') await moreDetailsToggle.click();
      await expect(moreDetailsToggle).toHaveAttribute('aria-expanded', 'true');

      // Value + probability use SuffixInput (currency-code / % adornment); both render placeholder "0".
      const valueInput = page.getByPlaceholder('0').first();
      await valueInput.fill('5000');
      const probabilityInput = page.getByPlaceholder('0').nth(1);
      await probabilityInput.fill('60');

      const customFieldInput = page.getByLabel(customFieldLabel);
      await expect(customFieldInput).toBeVisible({ timeout: 10_000 });
      await customFieldInput.fill(customFieldValue);

      // Link the fixture person: type into the People search field, then pick the suggestion
      // chip (rendered as a Button whose accessible name is the person's display name).
      const peopleSearch = page.getByPlaceholder('Search people by name or email…');
      await expect(peopleSearch).toBeVisible();
      await peopleSearch.fill(personName);
      const personSuggestion = page.getByRole('button', { name: personName, exact: true });
      await expect(personSuggestion).toBeVisible({ timeout: 10_000 });
      await personSuggestion.click();
      // Selected chip carries a remove control labelled "Remove <name>" — proves the link stuck.
      await expect(page.getByRole('button', { name: `Remove ${personName}` })).toBeVisible();

      // Link the fixture company the same way.
      const companySearch = page.getByPlaceholder('Search companies by name or domain…');
      await expect(companySearch).toBeVisible();
      await companySearch.fill(companyName);
      const companySuggestion = page.getByRole('button', { name: companyName, exact: true });
      await expect(companySuggestion).toBeVisible({ timeout: 10_000 });
      await companySuggestion.click();
      await expect(page.getByRole('button', { name: `Remove ${companyName}` })).toBeVisible();

      // Submit via the primary "Create deal" action. Only one such button is rendered — in the
      // first section card's actions slot. `.first()` is defensive (works even if a future
      // injection adds another). Wait for the POST to confirm the mutation landed before
      // asserting navigation — under CI load the client redirect can lag behind the click,
      // which made a bare URL assertion flaky.
      const createDealResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === 'POST' && url.pathname === '/api/customers/deals';
      });
      await page.getByRole('button', { name: 'Create deal', exact: true }).first().click();
      const createDealResponse = await createDealResponsePromise;
      expect(createDealResponse.status(), `POST /api/customers/deals returned ${createDealResponse.status()}`).toBe(201);

      // Success → navigate back to the deals list.
      await expect(page).toHaveURL(/\/backend\/customers\/deals$/, { timeout: 30_000 });

      // Verify the new deal is listed (search by its unique title).
      const searchByTitle = page.getByPlaceholder(/Search by title/i);
      await expect(searchByTitle).toBeVisible({ timeout: 30_000 });
      await searchByTitle.fill(dealTitle);
      const dealRow = page.locator('tr').filter({ hasText: dealTitle }).first();
      await expect(dealRow).toBeVisible({ timeout: 10_000 });

      // Verify via API too, and capture the id for cleanup.
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals?search=${encodeURIComponent(dealTitle)}&pageSize=10`,
        { token },
      );
      expect(listResponse.ok(), `GET /api/customers/deals returned ${listResponse.status()}`).toBeTruthy();
      const listPayload = (await readJsonSafe(listResponse)) as { items?: Array<{ id?: string; title?: string }> };
      const created = (listPayload.items ?? []).find((item) => item.title === dealTitle);
      expect(created, 'created deal not found via API').toBeTruthy();
      dealId = typeof created?.id === 'string' ? created.id : null;
      expect(dealId, 'created deal has no id').toBeTruthy();

      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals/${encodeURIComponent(dealId!)}`,
        { token },
      );
      expect(detailResponse.ok(), `GET /api/customers/deals/:id returned ${detailResponse.status()}`).toBeTruthy();
      const detailPayload = (await readJsonSafe(detailResponse)) as {
        customFields?: Record<string, unknown>;
        deal?: { pipelineId?: string | null; pipelineStageId?: string | null };
      };
      expect(detailPayload.customFields?.[customFieldKey]).toBe(customFieldValue);

      // The form starts on the default pipeline and its first stage (#5109).
      const pipelinesResponse = await apiRequest(request, 'GET', '/api/customers/pipelines', { token });
      expect(pipelinesResponse.ok(), `GET /api/customers/pipelines returned ${pipelinesResponse.status()}`).toBeTruthy();
      const pipelinesPayload = (await readJsonSafe(pipelinesResponse)) as {
        items?: Array<{ id: string; isDefault?: boolean }>;
      };
      const pipelines = pipelinesPayload.items ?? [];
      const defaultPipeline = pipelines.find((entry) => entry.isDefault) ?? pipelines[0] ?? null;
      expect(detailPayload.deal?.pipelineId ?? null).toBe(defaultPipeline?.id ?? null);
      if (defaultPipeline) {
        const stagesResponse = await apiRequest(
          request,
          'GET',
          `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(defaultPipeline.id)}`,
          { token },
        );
        expect(stagesResponse.ok(), `GET /api/customers/pipeline-stages returned ${stagesResponse.status()}`).toBeTruthy();
        const stagesPayload = (await readJsonSafe(stagesResponse)) as {
          items?: Array<{ id: string; order: number }>;
        };
        const firstStage = [...(stagesPayload.items ?? [])].sort((left, right) => left.order - right.order)[0] ?? null;
        expect(detailPayload.deal?.pipelineStageId ?? null).toBe(firstStage?.id ?? null);
      }
    } finally {
      // Best-effort: resolve the deal id by title if the UI flow failed before the API check.
      if (token && !dealId) {
        try {
          const lookup = await apiRequest(
            request,
            'GET',
            `/api/customers/deals?search=${encodeURIComponent(dealTitle)}&pageSize=10`,
            { token },
          );
          const payload = (await readJsonSafe(lookup)) as { items?: Array<{ id?: string; title?: string }> };
          const match = (payload.items ?? []).find((item) => item.title === dealTitle);
          if (match && typeof match.id === 'string') dealId = match.id;
        } catch {
          // ignore — cleanup is best-effort
        }
      }
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteCustomFieldDefinition(request, token, customFieldKey);
    }
  });

  test('a failed stage lookup blocks saving, shows a retry, and recovers', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    const dealTitle = `QA TC-CRM-071 Retry ${stamp}`;
    let token: string | null = null;
    let dealId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    const postedDeals: Array<Record<string, unknown>> = [];

    try {
      token = await getAuthToken(request);
      pipelineId = await createPipelineFixture(request, token, { name: `QA TC-CRM-071 Pipeline ${stamp}` });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: `QA TC-CRM-071 Stage ${stamp}`, order: 0 });
      await login(page, 'admin');

      await page.route('**/api/customers/pipelines', async (route) => {
        const upstream = await route.fetch();
        const body = (await upstream.json()) as { items?: Array<{ id: string }> };
        const items = (body.items ?? [])
          .filter((pipeline) => pipeline.id === pipelineId)
          .map((pipeline) => ({ ...pipeline, isDefault: true }));
        await route.fulfill({ response: upstream, json: { ...body, items } });
      });

      let failStages = true;
      await page.route('**/api/customers/pipeline-stages?**', async (route) => {
        if (failStages) {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Injected failure' }) });
          return;
        }
        await route.fallback();
      });
      page.on('request', (sent) => {
        if (sent.method() === 'POST' && new URL(sent.url()).pathname === '/api/customers/deals') {
          postedDeals.push(sent.postDataJSON() as Record<string, unknown>);
        }
      });

      await page.goto('/backend/customers/deals/create', { waitUntil: 'domcontentloaded' });
      const failure = page.getByRole('alert').filter({ hasText: 'Could not load the stages of this pipeline.' });
      await expect(failure).toBeVisible({ timeout: 30_000 });
      const submitButton = page.getByRole('button', { name: 'Create deal', exact: true }).first();
      await expect(submitButton).toBeDisabled();

      const titleInput = page.getByLabel(/Deal title/i);
      await titleInput.fill(dealTitle);
      await expect(titleInput).toHaveValue(dealTitle);
      await expect(submitButton).toBeDisabled();
      expect(postedDeals, 'no deal is sent while the stages are unresolved').toHaveLength(0);

      failStages = false;
      await failure.getByRole('button', { name: 'Try again' }).click();
      await expect(failure).toHaveCount(0);
      const selectedStage = page.locator('[data-crud-field-id="pipelineStageId"]').getByRole('button', { pressed: true });
      await expect(selectedStage).toBeVisible({ timeout: 30_000 });
      await expect(titleInput, 'the retry keeps what was typed').toHaveValue(dealTitle);

      await expect(submitButton).toBeEnabled({ timeout: 30_000 });
      const saved = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/customers/deals' && response.request().method() === 'POST',
      );
      await submitButton.click();
      const response = await saved;
      expect(response.status()).toBe(201);
      const created = (await response.json()) as { id?: string; entityId?: string };
      dealId = created.id ?? created.entityId ?? null;
      expect(postedDeals).toHaveLength(1);
      expect(postedDeals[0].pipelineId, 'the deal is created on the selected pipeline').toBe(pipelineId);
      expect(postedDeals[0].pipelineStageId, 'the recovered stage is submitted').toBe(stageId);
    } finally {
      await page.unroute('**/api/customers/pipeline-stages?**');
      await page.unroute('**/api/customers/pipelines');
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });
});
