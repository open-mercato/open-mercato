import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { seedPendingActionInDb, deletePendingActionInDb } from './helpers/aiAssistantFixtures';

const ACTIONS = '/api/ai_assistant/ai/actions';
const AGENT_ID = 'catalog.merchandising_assistant';
const BULK_TOOL = 'catalog.bulk_update_products';

type Cleanup = () => Promise<void>;

type ProductState = { title: string; version: string };

type ConfirmBody = {
  ok?: boolean;
  pendingAction?: {
    status?: string;
    failedRecords?: Array<{ recordId: string; error: { code: string; message: string } }> | null;
  };
};

async function readProductState(productId: string): Promise<ProductState> {
  return withClient(async (client) => {
    const result = await client.query<{ title: string; updated_at: Date }>(
      'select title, updated_at from catalog_products where id = $1',
      [productId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`[internal] product ${productId} not found`);
    return { title: row.title, version: new Date(row.updated_at).toISOString() };
  });
}

async function attachPreviewRecords(
  pendingActionId: string,
  records: Array<{ recordId: string; recordVersion: string; title: string; before: string }>,
): Promise<void> {
  const diffs = records.map((entry) => ({
    recordId: entry.recordId,
    entityType: 'catalog.product',
    label: entry.before,
    fieldDiff: [{ field: 'title', before: entry.before, after: entry.title }],
    recordVersion: entry.recordVersion,
  }));
  await withClient(async (client) => {
    await client.query('update ai_pending_actions set records = $2::jsonb, target_entity_type = $3 where id = $1', [
      pendingActionId,
      JSON.stringify(diffs),
      'catalog.product',
    ]);
  });
}

async function createProduct(request: APIRequestContext, token: string, label: string, cleanups: Cleanup[]): Promise<string> {
  const stamp = randomUUID().slice(0, 8);
  const productId = await createProductFixture(request, token, {
    title: `IT stale ${label} ${stamp}`,
    sku: `IT-STALE-${label}-${stamp}`,
  });
  cleanups.push(() => deleteCatalogProductIfExists(request, token, productId));
  return productId;
}

test.describe('TC-AI-ACTIONS-STALE-010: bulk confirm never writes rows the recheck marked stale', () => {
  test('a product edited after preview keeps the human edit; the fresh product gets the AI edit', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId: adminId } = getTokenScope(adminToken);
    const cleanups: Cleanup[] = [];
    try {
      const productA = await createProduct(request, adminToken, 'A', cleanups);
      const productB = await createProduct(request, adminToken, 'B', cleanups);
      const previewA = await readProductState(productA);
      const previewB = await readProductState(productB);
      const aiTitleA = `AI A ${randomUUID().slice(0, 8)}`;
      const aiTitleB = `AI B ${randomUUID().slice(0, 8)}`;

      const row = await seedPendingActionInDb({
        tenantId,
        organizationId: organizationId || null,
        createdByUserId: adminId,
        agentId: AGENT_ID,
        toolName: BULK_TOOL,
        normalizedInput: {
          records: [
            { recordId: productA, title: aiTitleA },
            { recordId: productB, title: aiTitleB },
          ],
        },
      });
      cleanups.push(() => deletePendingActionInDb(row.id));
      await attachPreviewRecords(row.id, [
        { recordId: productA, recordVersion: previewA.version, title: aiTitleA, before: previewA.title },
        { recordId: productB, recordVersion: previewB.version, title: aiTitleB, before: previewB.title },
      ]);

      const humanTitleB = `Human B ${randomUUID().slice(0, 8)}`;
      const humanEdit = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token: adminToken,
        data: { id: productB, title: humanTitleB },
      });
      expect(humanEdit.ok(), `human edit of B should succeed: ${humanEdit.status()}`).toBeTruthy();
      const afterHumanB = await readProductState(productB);
      expect(afterHumanB.version, 'the human edit must move B past its preview version').not.toBe(previewB.version);

      const confirm = await apiRequest(request, 'POST', `${ACTIONS}/${row.id}/confirm`, { token: adminToken, data: {} });
      expect(confirm.status()).toBe(200);
      const body = await readJsonSafe<ConfirmBody>(confirm);
      expect(body?.ok).toBe(true);
      expect(body?.pendingAction?.status).toBe('confirmed');
      const failed = body?.pendingAction?.failedRecords ?? [];
      expect(failed.map((entry) => entry.recordId)).toEqual([productB]);
      expect(failed[0]?.error.code).toBe('stale_version');

      expect((await readProductState(productA)).title, 'fresh row A is written').toBe(aiTitleA);
      const finalB = await readProductState(productB);
      expect(finalB.title, 'stale row B keeps the human edit').toBe(humanTitleB);
      expect(finalB.version, 'stale row B is not written at all').toBe(afterHumanB.version);
    } finally {
      for (const cleanup of cleanups.reverse()) {
        await cleanup().catch(() => undefined);
      }
    }
  });

  test('a repeated record runs only its previewed entry; the unseen second entry is never written', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId: adminId } = getTokenScope(adminToken);
    const cleanups: Cleanup[] = [];
    try {
      const productC = await createProduct(request, adminToken, 'C', cleanups);
      const previewC = await readProductState(productC);
      const approvedTitle = `AI C approved ${randomUUID().slice(0, 8)}`;
      const unseenTitle = `AI C unseen ${randomUUID().slice(0, 8)}`;

      const row = await seedPendingActionInDb({
        tenantId,
        organizationId: organizationId || null,
        createdByUserId: adminId,
        agentId: AGENT_ID,
        toolName: BULK_TOOL,
        normalizedInput: {
          records: [
            { recordId: productC, title: approvedTitle },
            { recordId: productC, title: unseenTitle },
          ],
        },
      });
      cleanups.push(() => deletePendingActionInDb(row.id));
      await attachPreviewRecords(row.id, [
        { recordId: productC, recordVersion: previewC.version, title: approvedTitle, before: previewC.title },
      ]);

      const confirm = await apiRequest(request, 'POST', `${ACTIONS}/${row.id}/confirm`, { token: adminToken, data: {} });
      expect(confirm.status()).toBe(200);
      const body = await readJsonSafe<ConfirmBody>(confirm);
      expect(body?.pendingAction?.status).toBe('confirmed');
      expect(body?.pendingAction?.failedRecords ?? []).toEqual([]);
      expect((await readProductState(productC)).title, 'only the previewed entry is applied').toBe(approvedTitle);
    } finally {
      for (const cleanup of cleanups.reverse()) {
        await cleanup().catch(() => undefined);
      }
    }
  });

  test('an input row whose id does not exactly match a previewed row is reported and not written', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId: adminId } = getTokenScope(adminToken);
    const cleanups: Cleanup[] = [];
    try {
      const productD = await createProduct(request, adminToken, 'D', cleanups);
      const productE = await createProduct(request, adminToken, 'E', cleanups);
      const previewD = await readProductState(productD);
      const previewE = await readProductState(productE);
      const aiTitleD = `AI D ${randomUUID().slice(0, 8)}`;
      const aiTitleE = `AI E ${randomUUID().slice(0, 8)}`;
      const upperE = productE.toUpperCase();
      expect(upperE, 'the fixture id must contain letters').not.toBe(productE);

      const row = await seedPendingActionInDb({
        tenantId,
        organizationId: organizationId || null,
        createdByUserId: adminId,
        agentId: AGENT_ID,
        toolName: BULK_TOOL,
        normalizedInput: {
          records: [
            { recordId: productD, title: aiTitleD },
            { recordId: upperE, title: aiTitleE },
          ],
        },
      });
      cleanups.push(() => deletePendingActionInDb(row.id));
      await attachPreviewRecords(row.id, [
        { recordId: productD, recordVersion: previewD.version, title: aiTitleD, before: previewD.title },
        { recordId: productE, recordVersion: previewE.version, title: previewE.title, before: previewE.title },
      ]);

      const confirm = await apiRequest(request, 'POST', `${ACTIONS}/${row.id}/confirm`, { token: adminToken, data: {} });
      expect(confirm.status()).toBe(200);
      const body = await readJsonSafe<ConfirmBody>(confirm);
      expect(body?.pendingAction?.status).toBe('confirmed');
      const failed = body?.pendingAction?.failedRecords ?? [];
      expect(failed.map((entry) => [entry.recordId, entry.error.code])).toEqual([[upperE, 'record_not_previewed']]);
      expect((await readProductState(productD)).title).toBe(aiTitleD);
      const finalE = await readProductState(productE);
      expect(finalE.title, 'the row previewed without a change keeps its title').toBe(previewE.title);
      expect(finalE.version).toBe(previewE.version);
    } finally {
      for (const cleanup of cleanups.reverse()) {
        await cleanup().catch(() => undefined);
      }
    }
  });
});
