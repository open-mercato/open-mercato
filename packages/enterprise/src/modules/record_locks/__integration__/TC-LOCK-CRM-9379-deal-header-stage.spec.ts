import { expect, test } from '@playwright/test';
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
  cleanupDeal,
  getDealTitle,
  getRecordLockSettings,
  saveRecordLockSettings,
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
 * Self-contained: creates its own pipeline, two stages and a deal via the API,
 * restores the lock settings and deletes everything in `finally`.
 */
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
    let pipelineId: string | null = null;
    let firstStageId: string | null = null;
    let secondStageId: string | null = null;
    let dealId: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.deal'],
      });

      pipelineId = await createPipelineFixture(request, adminToken, { name: `QA 9379 Pipeline ${stamp}` });
      firstStageId = await createPipelineStageFixture(request, adminToken, {
        pipelineId,
        label: firstStageLabel,
        order: 1,
      });
      secondStageId = await createPipelineStageFixture(request, adminToken, {
        pipelineId,
        label: secondStageLabel,
        order: 2,
      });
      dealId = await createDealFixture(request, adminToken, {
        title: originalTitle,
        pipelineId,
        pipelineStageId: firstStageId,
      });

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
      await expect(titleInput).toHaveValue(originalTitle, { timeout: 60_000 });
      await formLockAcquired;

      // The opened form focuses its first field a moment later, which can close the
      // stage list again. Reopen it until the pick lands.
      const stageOption = page.getByRole('dialog').getByRole('button', { name: secondStageLabel });
      await expect(async () => {
        if (!(await stageOption.isVisible())) await stageTrigger.click({ timeout: 3_000 });
        await stageOption.click({ timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
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
      await expect.poll(async () => getDealTitle(request, adminToken, dealId as string), { timeout: 15_000 }).toBe(savedTitle);
    } finally {
      await cleanupDeal(request, adminToken, dealId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/pipeline-stages', firstStageId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/pipeline-stages', secondStageId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/pipelines', pipelineId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
