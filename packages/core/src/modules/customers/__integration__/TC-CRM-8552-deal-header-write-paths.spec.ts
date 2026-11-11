import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import {
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures';

/**
 * TC-CRM-8552: write paths of the rebuilt deal detail header.
 *
 * The header stage dropdown and the Won/Lost buttons were replaced by a clickable stage
 * strip (`PipelineStepper`) and a "Close deal" popover (`DealClosureActionBar`). This
 * covers each path end to end: a segment click persists the stage, a dirty form makes
 * the strip read-only, Close deal > Won shows the outcome, and Close deal > Lost opens
 * the loss dialog without closing the deal. Below `sm` the strip collapses to the current
 * stage plus a "Move stage" menu, covered at a 390px viewport with the same guards.
 *
 * Self-contained: every test creates its own pipeline, stages and deal through the API
 * and removes them in `finally`.
 */
type DealFixtures = {
  token: string;
  pipelineId: string;
  stageIds: [string, string];
  dealId: string;
  title: string;
};

async function createDealOnTwoStagePipeline(
  request: APIRequestContext,
  token: string,
  name: string,
  created: { pipelineId: string | null; stageIds: string[]; dealId: string | null },
): Promise<DealFixtures> {
  const stamp = Date.now();
  const title = `${name} deal ${stamp}`;
  const pipelineId = await createPipelineFixture(request, token, { name: `${name} pipeline ${stamp}` });
  created.pipelineId = pipelineId;
  const firstStageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'First stage', order: 0 });
  created.stageIds.push(firstStageId);
  const secondStageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Second stage', order: 1 });
  created.stageIds.push(secondStageId);
  const dealId = await createDealFixture(request, token, { title, pipelineId, pipelineStageId: firstStageId });
  created.dealId = dealId;
  return { token, pipelineId, stageIds: [firstStageId, secondStageId], dealId, title };
}

async function cleanUp(
  request: APIRequestContext,
  token: string | null,
  created: { pipelineId: string | null; stageIds: string[]; dealId: string | null },
): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/customers/deals', created.dealId);
  for (const stageId of created.stageIds) {
    await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
  }
  await deleteEntityByBody(request, token, '/api/customers/pipelines', created.pipelineId);
}

async function readDeal(request: APIRequestContext, token: string, dealId: string): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token });
  expect(response.ok(), `GET deal ${dealId} should succeed`).toBe(true);
  const body = await readJsonSafe<{ deal?: Record<string, unknown> }>(response);
  return body?.deal ?? {};
}

async function openDeal(page: Page, fixtures: DealFixtures) {
  await login(page, 'admin');
  await page.goto(`/backend/customers/deals/${fixtures.dealId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: fixtures.title })).toBeVisible({ timeout: 20_000 });
  const strip = page.getByRole('list', { name: /^Pipeline progress/ });
  await expect(strip.getByText('Second stage')).toBeVisible();
  return strip;
}

async function openDealOnPhone(page: Page, fixtures: DealFixtures) {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'admin');
  await page.goto(`/backend/customers/deals/${fixtures.dealId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: fixtures.title })).toBeVisible({ timeout: 20_000 });
  const compact = page.getByRole('group', { name: /^Pipeline progress/ });
  await expect(compact).toBeVisible();
  await expect(compact).toContainText('First stage');
  await expect(page.getByRole('list', { name: /^Pipeline progress/ })).toBeHidden();
  return compact;
}

async function chooseCloseDealOutcome(page: Page, outcome: 'Won' | 'Lost') {
  await page.getByRole('button', { name: 'Close deal' }).click();
  await page.getByRole('button', { name: outcome, exact: true }).click();
}

test.describe('TC-CRM-8552: deal header write paths', () => {
  test('a stage segment click persists the stage', async ({ page, request }) => {
    const created = { pipelineId: null as string | null, stageIds: [] as string[], dealId: null as string | null };
    let token: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const fixtures = await createDealOnTwoStagePipeline(request, token, 'TC-CRM-8552 stage', created);
      const strip = await openDeal(page, fixtures);

      await strip.getByRole('button', { name: /Second stage/ }).click();

      await expect(strip.locator('li[aria-current="step"]')).toContainText('Second stage');
      await expect
        .poll(async () => (await readDeal(request, fixtures.token, fixtures.dealId)).pipelineStageId)
        .toBe(fixtures.stageIds[1]);
    } finally {
      await cleanUp(request, token, created);
    }
  });

  test('a dirty form makes the stage strip read-only', async ({ page, request }) => {
    test.slow();
    const created = { pipelineId: null as string | null, stageIds: [] as string[], dealId: null as string | null };
    let token: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const fixtures = await createDealOnTwoStagePipeline(request, token, 'TC-CRM-8552 dirty', created);
      const strip = await openDeal(page, fixtures);
      await expect(strip.getByRole('button', { name: /Second stage/ })).toBeVisible();

      const titleInput = page.locator('[data-crud-field-id="title"]').getByRole('textbox');
      await page.getByRole('button', { name: 'Expand form panel' }).click();
      await titleInput.fill(`${fixtures.title} edited`);
      await expect(titleInput).toHaveValue(`${fixtures.title} edited`);

      await expect(strip.getByRole('button')).toHaveCount(0);
      await expect(strip.getByText('Second stage')).toBeVisible();
      expect((await readDeal(request, fixtures.token, fixtures.dealId)).pipelineStageId).toBe(fixtures.stageIds[0]);
    } finally {
      await cleanUp(request, token, created);
    }
  });

  test('Close deal, Won, shows the outcome on the strip', async ({ page, request }) => {
    const created = { pipelineId: null as string | null, stageIds: [] as string[], dealId: null as string | null };
    let token: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const fixtures = await createDealOnTwoStagePipeline(request, token, 'TC-CRM-8552 won', created);
      const strip = await openDeal(page, fixtures);

      await chooseCloseDealOutcome(page, 'Won');

      const summaryDialog = page.getByRole('dialog').filter({ hasText: fixtures.title });
      await expect(summaryDialog).toBeVisible({ timeout: 15_000 });
      await page.keyboard.press('Escape');
      await expect(summaryDialog).toBeHidden();

      await expect(strip.getByRole('listitem').last()).toHaveText('Won');
      await expect(page.getByRole('button', { name: 'Close deal' })).toHaveCount(0);
      await expect(strip.getByRole('button')).toHaveCount(0);
      expect((await readDeal(request, fixtures.token, fixtures.dealId)).closureOutcome).toBe('won');
    } finally {
      await cleanUp(request, token, created);
    }
  });

  test('Close deal, Lost, opens the loss dialog and leaves the deal open until confirmed', async ({ page, request }) => {
    const created = { pipelineId: null as string | null, stageIds: [] as string[], dealId: null as string | null };
    let token: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const fixtures = await createDealOnTwoStagePipeline(request, token, 'TC-CRM-8552 lost', created);
      await openDeal(page, fixtures);

      await chooseCloseDealOutcome(page, 'Lost');

      const lossDialog = page.getByRole('dialog', { name: 'Mark deal as Lost?' });
      await expect(lossDialog).toBeVisible();
      await expect(lossDialog).toContainText(fixtures.title);
      expect((await readDeal(request, fixtures.token, fixtures.dealId)).closureOutcome ?? null).toBeNull();
    } finally {
      await cleanUp(request, token, created);
    }
  });

  test('on a phone, the Move stage menu persists the stage', async ({ page, request }) => {
    const created = { pipelineId: null as string | null, stageIds: [] as string[], dealId: null as string | null };
    let token: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const fixtures = await createDealOnTwoStagePipeline(request, token, 'TC-CRM-8552 phone', created);
      const compact = await openDealOnPhone(page, fixtures);

      await compact.getByRole('button', { name: 'Move stage' }).click();
      const menu = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Second stage', exact: true }) });
      await expect(menu.getByRole('button', { name: 'First stage', exact: true })).toBeDisabled();
      await menu.getByRole('button', { name: 'Second stage', exact: true }).click();

      await expect(compact).toContainText('Second stage');
      await expect
        .poll(async () => (await readDeal(request, fixtures.token, fixtures.dealId)).pipelineStageId)
        .toBe(fixtures.stageIds[1]);
    } finally {
      await cleanUp(request, token, created);
    }
  });

  test('on a phone, a dirty form hides the Move stage menu', async ({ page, request }) => {
    test.slow();
    const created = { pipelineId: null as string | null, stageIds: [] as string[], dealId: null as string | null };
    let token: string | null = null;
    try {
      token = await getAuthToken(request, 'admin');
      const fixtures = await createDealOnTwoStagePipeline(request, token, 'TC-CRM-8552 phone dirty', created);
      const compact = await openDealOnPhone(page, fixtures);
      await expect(compact.getByRole('button', { name: 'Move stage' })).toBeVisible();

      const titleInput = page.locator('[data-crud-field-id="title"]').getByRole('textbox');
      await expect(titleInput).toBeVisible();
      await titleInput.fill(`${fixtures.title} edited`);
      await expect(titleInput).toHaveValue(`${fixtures.title} edited`);

      await expect(compact.getByRole('button', { name: 'Move stage' })).toHaveCount(0);
      await expect(compact).toContainText('First stage');
      expect((await readDeal(request, fixtures.token, fixtures.dealId)).pipelineStageId).toBe(fixtures.stageIds[0]);
    } finally {
      await cleanUp(request, token, created);
    }
  });
});
