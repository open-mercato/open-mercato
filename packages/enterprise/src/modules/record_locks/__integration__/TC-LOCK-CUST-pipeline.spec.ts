import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createPipelineFixture,
  createPipelineStageFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  cleanupPipeline,
  cleanupPipelineStage,
  getPipelineStageUpdatedAt,
  getPipelineUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updatePipelineName,
  updatePipelineStageLabel,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CUST-pipeline: Phase 2 record-locks coverage for the customers pipeline
 * + pipeline-stage config entities (`customers:customer_pipeline`,
 * `customers:customer_pipeline_stage`).
 *
 * These edit through hand-written routes that dispatch the migrated
 * `customers.pipelines.update` / `customers.pipeline-stages.update` commands —
 * the only place the optimistic-lock floor can run (no makeCrudRoute decorator).
 * Phase 2 added the async DI-aware seam to both commands, so a stale edit 409s.
 * (Stage *reorder* is a position write and stays exempt — not exercised here.)
 *
 * Self-contained: creates its own pipeline + stage via the API, restores settings
 * and removes both in `finally`.
 */
test.describe('TC-LOCK-CUST-pipeline: optimistic conflict on pipeline + stage edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale pipeline edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let pipelineId: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.pipeline'],
      });

      const suffix = `${Date.now()}`;
      pipelineId = await createPipelineFixture(request, adminToken, { name: `QA Lock Pipeline ${suffix}` });

      const baseUpdatedAt = await getPipelineUpdatedAt(request, adminToken, pipelineId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updatePipelineName(request, adminToken, pipelineId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBe(200);

      const stale = await updatePipelineName(request, adminToken, pipelineId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getPipelineUpdatedAt(request, adminToken, pipelineId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updatePipelineName(request, adminToken, pipelineId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBe(200);
    } finally {
      await cleanupPipeline(request, adminToken, pipelineId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });

  test('a stale pipeline-stage edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.pipelineStage'],
      });

      const suffix = `${Date.now()}`;
      pipelineId = await createPipelineFixture(request, adminToken, { name: `QA Lock Stage Pipeline ${suffix}` });
      stageId = await createPipelineStageFixture(request, adminToken, { pipelineId, label: `QA Stage ${suffix}` });

      const baseUpdatedAt = await getPipelineStageUpdatedAt(request, adminToken, pipelineId, stageId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updatePipelineStageLabel(request, adminToken, stageId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBe(200);

      const stale = await updatePipelineStageLabel(request, adminToken, stageId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getPipelineStageUpdatedAt(request, adminToken, pipelineId, stageId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updatePipelineStageLabel(request, adminToken, stageId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBe(200);
    } finally {
      await cleanupPipelineStage(request, adminToken, stageId);
      await cleanupPipeline(request, adminToken, pipelineId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
