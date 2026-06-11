import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createDealFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import { withClient } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures';

/**
 * TC-CRM-2939: deals list keeps reading customer_deals when stray doc-storage rows exist
 * Source: https://github.com/open-mercato/open-mercato/issues/2939
 *
 * `customers:customer_deal` is a table-backed ORM entity that is ALSO declared as a
 * module custom entity in ce.ts (for its custom-field set). Before the fix, a single
 * `custom_entities_storage` row for that entity type made HybridQueryEngine re-classify
 * the whole entity type as doc-storage-backed, so `/api/customers/deals` (list, kanban
 * lanes, MCP) returned only the stray doc rows while the aggregate endpoint kept
 * counting the real table rows.
 *
 * The write path is now gated too (#2942 hardening): `/api/entities/records` rejects
 * system entity ids, so the stray row is seeded directly in the database — exactly the
 * state of an environment poisoned before the gate existed (e.g. on v0.6.4). The engine
 * guard must keep the deals list on the base table even then.
 */
test.describe('TC-CRM-2939: deals list ignores stray doc-storage rows', () => {
  test('records API rejects system entity writes and the deals list stays table-backed despite legacy stray rows', async ({ request }) => {
    let token: string | null = null;
    let dealId: string | null = null;
    let strayRecordId: string | null = null;
    const dealTitle = `QA TC-CRM-2939 Deal ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      dealId = await createDealFixture(request, token, { title: dealTitle });

      // 1) The poison path is closed: generic record writes for a table-backed
      //    system entity are rejected outright.
      const strayWrite = await apiRequest(request, 'POST', '/api/entities/records', {
        token,
        data: {
          entityId: 'customers:customer_deal',
          values: { competitive_risk: 'high' },
        },
      });
      expect(strayWrite.status(), `POST /api/entities/records for customers:customer_deal returned ${strayWrite.status()}`).toBe(400);
      const strayWriteBody = (await readJsonSafe(strayWrite)) as { code?: string } | null;
      expect(strayWriteBody?.code, 'system-entity rejection code').toBe('system_entity_records_blocked');

      // 2) Defense in depth for environments poisoned BEFORE the gate existed:
      //    seed the stray doc row directly and assert the deals list ignores it.
      strayRecordId = randomUUID();
      await withClient(async (client) => {
        await client.query(
          `INSERT INTO custom_entities_storage (entity_type, entity_id, organization_id, tenant_id, doc, created_at, updated_at)
           VALUES ($1, $2, NULL, NULL, $3::jsonb, now(), now())`,
          ['customers:customer_deal', strayRecordId, JSON.stringify({ id: strayRecordId, title: 'TC-CRM-2939 stray doc row' })],
        );
      });

      const listResponse = await apiRequest(request, 'GET', '/api/customers/deals?pageSize=100&sortField=createdAt&sortDir=desc', { token });
      expect(listResponse.status(), `GET /api/customers/deals returned ${listResponse.status()}`).toBe(200);
      const listPayload = (await readJsonSafe(listResponse)) as { items?: Array<{ id?: string }>; total?: number } | null;
      const listedIds = (listPayload?.items ?? [])
        .map((item) => item?.id)
        .filter((value): value is string => typeof value === 'string');

      expect(listedIds, 'table-backed deal must stay visible in the deals list').toContain(dealId);
      expect(listedIds, 'stray doc-storage record must not surface in the deals list').not.toContain(strayRecordId);
    } finally {
      if (strayRecordId) {
        await withClient(async (client) => {
          await client.query('DELETE FROM custom_entities_storage WHERE entity_id = $1 AND entity_type = $2', [strayRecordId, 'customers:customer_deal']);
        }).catch(() => undefined);
      }
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
    }
  });
});
