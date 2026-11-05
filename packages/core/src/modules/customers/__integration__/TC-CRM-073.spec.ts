import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CRM-073: Pipeline Stage Optional Appearance UI
 */
test.describe('TC-CRM-073: Pipeline Stage Optional Appearance UI', () => {
  test('should create a pipeline stage without color or icon from settings', async ({ page, request }) => {
    const token = await getAuthToken(request);
    const timestamp = Date.now();
    const pipelineName = `QA optional appearance ${timestamp}`;
    const stageName = `QA stage no appearance ${timestamp}`;
    let pipelineId: string | null = null;

    try {
      await login(page, 'admin');
      await page.goto('/backend/config/customers/pipeline-stages');

      await page.getByRole('button', { name: /add pipeline/i }).click();
      const pipelineDialog = page.getByRole('dialog', { name: /create pipeline/i });
      await expect(pipelineDialog).toBeVisible();
      await pipelineDialog.getByRole('textbox', { name: /pipeline name/i }).fill(pipelineName);
      await pipelineDialog.getByRole('button', { name: /^save$/i }).click();

      await expect(page.getByText(pipelineName, { exact: false })).toBeVisible();
      const pipelinesRes = await apiRequest(request, 'GET', '/api/customers/pipelines', { token });
      expect(pipelinesRes.ok(), `GET pipelines failed: ${pipelinesRes.status()}`).toBeTruthy();
      const pipelinesBody = await pipelinesRes.json() as Record<string, unknown>;
      const pipelines = pipelinesBody.items as Array<Record<string, unknown>>;
      const pipeline = pipelines.find((item) => item.name === pipelineName);
      expect(pipeline?.id, 'Created pipeline should be visible through API').toBeTruthy();
      pipelineId = pipeline?.id as string;

      await page.getByRole('button', { name: /add stage/i }).click();
      const stageDialog = page.getByRole('dialog', { name: /create stage/i });
      await expect(stageDialog).toBeVisible();
      await stageDialog.getByRole('textbox', { name: /stage name/i }).fill(stageName);
      await stageDialog.getByRole('button', { name: /^save$/i }).click();

      await expect(page.getByText(stageName, { exact: true })).toBeVisible();

      const stagesRes = await apiRequest(
        request,
        'GET',
        `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(pipelineId)}`,
        { token },
      );
      expect(stagesRes.ok(), `GET stages failed: ${stagesRes.status()}`).toBeTruthy();
      const stagesBody = await stagesRes.json() as Record<string, unknown>;
      const stages = stagesBody.items as Array<Record<string, unknown>>;
      const stage = stages.find((item) => item.label === stageName);
      expect(stage?.color).toBeNull();
      expect(stage?.icon).toBeNull();
    } finally {
      if (pipelineId) {
        await apiRequest(request, 'DELETE', '/api/customers/pipelines', { token, data: { id: pipelineId } }).catch(() => {});
      }
    }
  });
});
