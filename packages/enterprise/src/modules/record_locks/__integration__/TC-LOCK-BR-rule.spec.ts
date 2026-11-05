import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/businessRulesFixtures';
import {
  getBusinessRuleUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateBusinessRuleName,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-BR-rule: Phase 6 record-locks coverage for the BUSINESS RULE entity
 * (`business_rules.rule`).
 *
 * Business rules are edited on a `CrudForm` detail page (`backend/rules/[id]`).
 * The hand-rolled PUT route (`api/rules`) calls `enforceCommandOptimisticLock`
 * on the rule's `updated_at`. The form captures `updatedAt` at load and replays
 * it via the OSS optimistic-lock header; a stale value 409s, a fresh-version
 * edit succeeds. Presence is mounted on the detail page so the merge dialog
 * surfaces the concurrent-edit 409.
 *
 * Self-contained: creates its own business rule, restores settings and deletes
 * the rule in `finally`.
 */
test.describe('TC-LOCK-BR-rule: optimistic conflict on business rule edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale business-rule edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');
    const scope = getTokenScope(adminToken);

    let previousSettings: RecordLockSettings | null = null;
    let ruleId: string | null = null;
    const suffix = `${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['business_rules.rule'],
      });

      ruleId = await createBusinessRuleFixture(request, adminToken, {
        ruleId: `QA_LOCK_BR_${suffix}`,
        ruleName: `QA Lock Rule ${suffix}`,
        description: 'Record-locks coverage',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        eventType: 'beforeSave',
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        successActions: null,
        failureActions: null,
        enabled: true,
        priority: 100,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      });

      const baseUpdatedAt = await getBusinessRuleUpdatedAt(request, adminToken, ruleId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateBusinessRuleName(request, adminToken, ruleId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateBusinessRuleName(request, adminToken, ruleId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getBusinessRuleUpdatedAt(request, adminToken, ruleId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateBusinessRuleName(request, adminToken, ruleId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await deleteBusinessRuleIfExists(request, adminToken, ruleId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
