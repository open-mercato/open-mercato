import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { deleteCustomerGroupIfExists } from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import {
  CUSTOMER_GROUPS_FEATURES,
  cleanupSecondTenantActor,
  createSecondTenantActor,
  uniqueStamp,
  type SecondTenantActor,
} from './helpers';

/**
 * TC-CGRP-008: Reconciliation lists orphans and `--adopt` creates inactive
 * placeholders.
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §13, §8.2.
 *
 * `POST /api/customer_groups/customer-groups/reconcile/adopt` reuses
 * `scanOrphanedCustomerGroupReferences` + `adoptOrphanedCustomerGroups` from
 * `lib/reconcile.ts` — the exact functions the `customer_groups reconcile
 * --adopt` CLI command also calls, so this HTTP-level proof covers the CLI's
 * behavior too. Uses a `sales_tax_rates` row as the orphan fixture (see
 * TC-CGRP-004's doc comment for why it's the lightest fixture that reaches
 * the scan).
 *
 * The adopt endpoint is tenant-wide (it takes no ids and adopts EVERY orphan
 * the scan finds), so the whole orphan → adopt → cleanup cycle runs inside a
 * freshly provisioned second tenant. Running it in the shared admin tenant
 * would permanently convert any other spec's in-flight or leftover orphan
 * into a placeholder group this spec never cleans up.
 */
const RECONCILE_PATH = '/api/customer_groups/customer-groups/reconcile';
const RECONCILE_ADOPT_PATH = '/api/customer_groups/customer-groups/reconcile/adopt';
const GROUPS_PATH = '/api/customer_groups/customer-groups';
const TAX_RATES_PATH = '/api/sales/tax-rates';
const ACTOR_FEATURES = [...CUSTOMER_GROUPS_FEATURES, 'sales.settings.manage'];

type OrphanRow = { groupId: string; salesTaxRateCount: number };
type AdoptedRow = { groupId: string; code: string };

test.describe('TC-CGRP-008: reconciliation lists orphans and adopt creates inactive placeholders', () => {
  test('adopt creates an inactive CustomerGroup reusing the orphaned id, then the orphan disappears on re-scan', async ({
    request,
  }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    const orphanGroupId = randomUUID();

    let actor: SecondTenantActor | null = null;
    let token: string | null = null;
    let taxRateId: string | null = null;
    let adoptedGroupIds: string[] = [];

    try {
      actor = await createSecondTenantActor(request, superadminToken, stamp, ACTOR_FEATURES);
      token = actor.token;

      const taxRateResponse = await apiRequest(request, 'POST', TAX_RATES_PATH, {
        token,
        data: { name: `QA CGRP 008 Tax ${stamp}`, code: `qa-cgrp-008-${stamp}`, rate: 5, customerGroupId: orphanGroupId },
      });
      expect(taxRateResponse.status(), 'orphan tax-rate fixture create should be 201').toBe(201);
      taxRateId = (await readJsonSafe<{ id?: string }>(taxRateResponse))?.id ?? null;
      expect(taxRateId, 'orphan tax-rate fixture should return an id').toBeTruthy();

      // 1) Scan lists the orphan.
      const scanResponse = await apiRequest(request, 'GET', RECONCILE_PATH, { token });
      expect(scanResponse.status(), 'reconcile scan should be 200').toBe(200);
      const scanBody = await readJsonSafe<{ orphans?: OrphanRow[] }>(scanResponse);
      const orphanEntry = (scanBody?.orphans ?? []).find((row) => row.groupId === orphanGroupId);
      expect(orphanEntry, 'the orphaned customer_group_id should be listed by the scan').toBeTruthy();
      expect(orphanEntry?.salesTaxRateCount, 'the orphan entry should count the fixture tax-rate row').toBeGreaterThanOrEqual(
        1,
      );

      // 2) Adopt creates an inactive placeholder group reusing the same id.
      const adoptResponse = await apiRequest(request, 'POST', RECONCILE_ADOPT_PATH, { token, data: {} });
      expect(adoptResponse.status(), 'reconcile adopt should be 200').toBe(200);
      const adoptBody = await readJsonSafe<{ ok?: boolean; adopted?: AdoptedRow[] }>(adoptResponse);
      expect(adoptBody?.ok, 'adopt should report ok').toBe(true);
      adoptedGroupIds = (adoptBody?.adopted ?? []).map((row) => row.groupId);
      const adoptedEntry = (adoptBody?.adopted ?? []).find((row) => row.groupId === orphanGroupId);
      expect(adoptedEntry, 'adopt response should include the orphaned group id').toBeTruthy();

      const adoptedGroupResponse = await apiRequest(
        request,
        'GET',
        `${GROUPS_PATH}?id=${encodeURIComponent(orphanGroupId)}`,
        { token },
      );
      expect(adoptedGroupResponse.status(), 'GET the adopted group should be 200').toBe(200);
      const adoptedGroupBody = await readJsonSafe<{ items?: Array<{ id: string; is_active: boolean; kind: string }> }>(
        adoptedGroupResponse,
      );
      const adoptedGroup = (adoptedGroupBody?.items ?? [])[0];
      expect(adoptedGroup, 'the adopted group should now be a real CustomerGroup row at the orphaned id').toBeTruthy();
      expect(adoptedGroup?.is_active, 'the adopted placeholder group must be inactive').toBe(false);

      // 3) Re-scan no longer lists it — the reference now resolves.
      const rescanResponse = await apiRequest(request, 'GET', RECONCILE_PATH, { token });
      const rescanBody = await readJsonSafe<{ orphans?: OrphanRow[] }>(rescanResponse);
      expect(
        (rescanBody?.orphans ?? []).some((row) => row.groupId === orphanGroupId),
        'after adopt, the same id must no longer be listed as an orphan',
      ).toBe(false);
    } finally {
      await deleteGeneralEntityIfExists(request, token, TAX_RATES_PATH, taxRateId);
      for (const groupId of new Set([...adoptedGroupIds, orphanGroupId])) {
        await deleteCustomerGroupIfExists(request, token, groupId);
      }
      await cleanupSecondTenantActor(request, superadminToken, actor);
    }
  });
});
