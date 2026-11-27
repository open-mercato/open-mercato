import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import {
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { CONFLICT_DIALOG_TESTID } from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi';
import {
  buildScopeCookieFromToken,
  cleanupDeal,
  getDealTitle,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateDeal,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CRM-9379: a deal's own header stage change must not make the next
 * "Deal details" save look like another user's edit (#9379).
 *
 * The stage button saves through the page's guarded mutation, the details form
 * through CrudForm. The record_locks widget keeps its action-log baseline per
 * form id, so both saves have to share one id: otherwise the form keeps the
 * baseline from before the stage change and its next save opens "Conflict
 * detected" although nobody else touched the deal.
 *
 * Sharing the id must not mix up the two operations when a real conflict
 * happens: "Keep my changes" after a conflicting header stage change has to
 * retry that stage change, not submit the details form that shares its id.
 *
 * Self-contained: creates its own pipeline, two stages and a deal via the API,
 * restores the lock settings and deletes everything in `finally`.
 */

type DealFixture = {
  pipelineId: string | null;
  firstStageId: string | null;
  secondStageId: string | null;
  dealId: string | null;
};

async function createDealWithTwoStages(
  request: APIRequestContext,
  adminToken: string,
  fixture: DealFixture,
  labels: { pipeline: string; firstStage: string; secondStage: string; title: string },
): Promise<void> {
  fixture.pipelineId = await createPipelineFixture(request, adminToken, { name: labels.pipeline });
  fixture.firstStageId = await createPipelineStageFixture(request, adminToken, {
    pipelineId: fixture.pipelineId,
    label: labels.firstStage,
    order: 1,
  });
  fixture.secondStageId = await createPipelineStageFixture(request, adminToken, {
    pipelineId: fixture.pipelineId,
    label: labels.secondStage,
    order: 2,
  });
  fixture.dealId = await createDealFixture(request, adminToken, {
    title: labels.title,
    pipelineId: fixture.pipelineId,
    pipelineStageId: fixture.firstStageId,
  });
}

async function cleanupDealWithStages(request: APIRequestContext, adminToken: string, fixture: DealFixture): Promise<void> {
  await cleanupDeal(request, adminToken, fixture.dealId);
  await deleteEntityIfExists(request, adminToken, '/api/customers/pipeline-stages', fixture.firstStageId);
  await deleteEntityIfExists(request, adminToken, '/api/customers/pipeline-stages', fixture.secondStageId);
  await deleteEntityIfExists(request, adminToken, '/api/customers/pipelines', fixture.pipelineId);
}

async function openDealWithDetailsPanel(
  page: Page,
  dealId: string,
  firstStageLabel: string,
  title: string,
): Promise<{ stageTrigger: Locator; titleInput: Locator }> {
  await login(page, 'admin');
  await page.goto(`/backend/customers/deals/${dealId}`, { waitUntil: 'domcontentloaded' });

  const stageTrigger = page.locator('button[aria-haspopup="dialog"]').filter({ hasText: firstStageLabel });
  await expect(stageTrigger).toBeVisible({ timeout: 60_000 });

  // The details form sits in a collapsed side panel. Open it BEFORE the stage
  // change, so the form's lock widget takes its baseline from the older log.
  const formLockAcquired = page
    .waitForResponse(
      (response) => response.url().includes('/api/record_locks/acquire') && response.ok(),
      { timeout: 20_000 },
    )
    .catch(() => null);
  await page.getByRole('button', { name: 'Expand form panel' }).click();
  const titleInput = page.locator('[data-crud-field-id="title"] input').first();
  await expect(titleInput).toHaveValue(title, { timeout: 60_000 });
  await formLockAcquired;

  return { stageTrigger, titleInput };
}

async function pickStage(page: Page, stageTrigger: Locator, stageLabel: string): Promise<void> {
  // The opened form focuses its first field a moment later, which can close the
  // stage list again. Reopen it until the pick lands.
  const stageOption = page.getByRole('dialog').getByRole('button', { name: stageLabel });
  await expect(async () => {
    if (!(await stageOption.isVisible())) await stageTrigger.click({ timeout: 3_000 });
    await stageOption.click({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

test.describe('TC-LOCK-CRM-9379: deal header stage change then details save', () => {
  test.describe.configure({ timeout: 180_000 });

  test('saving the details form after an own header stage change raises no conflict', async ({ page, request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const firstStageLabel = `QA 9379 First ${stamp}`;
    const secondStageLabel = `QA 9379 Second ${stamp}`;
    const originalTitle = `QA TC-LOCK-CRM-9379 ${stamp}`;
    const savedTitle = `${originalTitle} saved`;

    let previousSettings: RecordLockSettings | null = null;
    const fixture: DealFixture = { pipelineId: null, firstStageId: null, secondStageId: null, dealId: null };

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.deal'],
      });

      await createDealWithTwoStages(request, adminToken, fixture, {
        pipeline: `QA 9379 Pipeline ${stamp}`,
        firstStage: firstStageLabel,
        secondStage: secondStageLabel,
        title: originalTitle,
      });

      const { stageTrigger, titleInput } = await openDealWithDetailsPanel(
        page,
        fixture.dealId as string,
        firstStageLabel,
        originalTitle,
      );

      await pickStage(page, stageTrigger, secondStageLabel);
      await expect(page.getByText('Deal stage updated.').first()).toBeVisible({ timeout: 30_000 });
      await expect(
        page.locator('button[aria-haspopup="dialog"]').filter({ hasText: secondStageLabel }),
      ).toBeVisible({ timeout: 30_000 });

      await titleInput.fill(savedTitle);
      await expect(titleInput).toHaveValue(savedTitle);

      const lockValidation = page.waitForResponse(
        (response) => response.url().includes('/api/record_locks/validate'),
        { timeout: 30_000 },
      );
      await page.getByRole('button', { name: 'Save', exact: true }).click();

      const validation = await lockValidation;
      const validationBody = (await validation.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
      expect(
        validationBody?.ok,
        `record lock validation refused the save: ${validation.status()} ${validationBody?.code ?? ''}`,
      ).toBe(true);

      await expect(page.getByText('Deal updated.').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(CONFLICT_DIALOG_TESTID)).toHaveCount(0);
      await expect
        .poll(async () => getDealTitle(request, adminToken, fixture.dealId as string), { timeout: 15_000 })
        .toBe(savedTitle);
    } finally {
      await cleanupDealWithStages(request, adminToken, fixture);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });

  test('Keep my changes after a conflicting header stage change retries the stage change', async ({ page, request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');
    const superadminScopeCookie = buildScopeCookieFromToken(superadminToken);
    const superadminScopeHeaders = superadminScopeCookie ? { cookie: superadminScopeCookie } : undefined;
    const stamp = Date.now();
    const firstStageLabel = `QA 9379 KM First ${stamp}`;
    const secondStageLabel = `QA 9379 KM Second ${stamp}`;
    const originalTitle = `QA TC-LOCK-CRM-9379 KM ${stamp}`;
    const incomingTitle = `${originalTitle} incoming`;

    let previousSettings: RecordLockSettings | null = null;
    const fixture: DealFixture = { pipelineId: null, firstStageId: null, secondStageId: null, dealId: null };

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.deal'],
        allowIncomingOverride: true,
      });

      await createDealWithTwoStages(request, adminToken, fixture, {
        pipeline: `QA 9379 KM Pipeline ${stamp}`,
        firstStage: firstStageLabel,
        secondStage: secondStageLabel,
        title: originalTitle,
      });
      const dealId = fixture.dealId as string;

      const { stageTrigger } = await openDealWithDetailsPanel(page, dealId, firstStageLabel, originalTitle);

      const incomingUpdate = await updateDeal(request, superadminToken, dealId, incomingTitle, undefined, superadminScopeHeaders);
      expect(incomingUpdate.status, 'another user saves the deal while the page is open').toBe(200);

      await pickStage(page, stageTrigger, secondStageLabel);
      const conflictDialog = page.getByTestId(CONFLICT_DIALOG_TESTID);
      await expect(conflictDialog).toBeVisible({ timeout: 30_000 });

      const dealWrites: Array<Record<string, unknown>> = [];
      page.on('request', (sent) => {
        if (sent.method() !== 'PUT' || !new URL(sent.url()).pathname.endsWith('/api/customers/deals')) return;
        dealWrites.push((sent.postDataJSON() ?? {}) as Record<string, unknown>);
      });

      await conflictDialog.getByRole('button', { name: 'Keep my changes', exact: true }).click();

      await expect
        .poll(() => dealWrites.length, { timeout: 30_000, message: 'Keep my changes sends a deal write' })
        .toBeGreaterThan(0);
      expect(dealWrites[0], 'Keep my changes retries the selected header stage change').toMatchObject({
        id: dealId,
        pipelineStageId: fixture.secondStageId,
      });
      expect(
        dealWrites.filter((body) => 'title' in body),
        'the details form sharing the lock id is not submitted',
      ).toHaveLength(0);
      await expect
        .poll(async () => getDealTitle(request, adminToken, dealId), { timeout: 15_000 })
        .toBe(incomingTitle);
    } finally {
      await cleanupDealWithStages(request, adminToken, fixture);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
