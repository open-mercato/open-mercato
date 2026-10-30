import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { deserializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata';
import {
  cleanupSecondTenantActor,
  createSecondTenantActor,
  uniqueStamp,
  type SecondTenantActor,
} from './helpers';

/**
 * TC-CGRP-033: manual credit settlement route (`POST
 * …/credit-accounts/:id/adjust`, D-R5-2/G7/G20) — Step 1.12.
 *
 * - a positive adjustment increases exposure, a negative one lowers it (the
 *   manual-settlement path D-R5-2 names for a tenant with no payments
 *   integration); both append a `adjust` ledger entry with the required note;
 * - the body is `.strict()`, `amount` must be a non-zero signed decimal string
 *   with at most 2 fraction digits, and `note` is required;
 * - undoing the posted adjustment (via the generic
 *   `/api/audit_logs/audit-logs/actions/undo` route and the `x-om-operation`
 *   undo token the route returns) appends the INVERSE entry rather than
 *   deleting the original — both rows remain in the ledger (G20);
 * - ACL: `credit.adjust` is required; `credit.view`/`credit.manage` alone are
 *   not enough;
 * - a second tenant, and a second organization of the same tenant, can
 *   neither adjust nor read this account (unknown-id shape, no 403 leak).
 */
const CREDIT_ACCOUNTS_PATH = '/api/customer_groups/customer-groups/credit-accounts';
const COMPANIES_PATH = '/api/customers/companies';
const UNDO_PATH = '/api/audit_logs/audit-logs/actions/undo';

function adjustPath(accountId: string): string {
  return `${CREDIT_ACCOUNTS_PATH}/${encodeURIComponent(accountId)}/adjust`;
}

function ledgerPath(accountId: string, query = ''): string {
  return `${CREDIT_ACCOUNTS_PATH}/${encodeURIComponent(accountId)}/ledger${query}`;
}

async function deleteCreditAccountFixture(id: string | null): Promise<void> {
  if (!id) return;
  await withClient(async (client) => {
    await client.query('delete from customer_credit_ledger_entries where credit_account_id = $1', [id]);
    await client.query('delete from customer_credit_accounts where id = $1', [id]);
  }).catch(() => undefined);
}

type EntryBody = {
  entryId?: string;
  creditAccountId?: string;
  entryType?: string;
  amount?: string;
  balanceAfter?: string;
  relatedEntryId?: string | null;
};

type LedgerBody = {
  items?: Array<{ id: string; entryType: string; amount: string; balanceAfter: string; relatedEntryId: string | null; note: string | null }>;
  total?: number;
};

test.describe('TC-CGRP-033: manual credit adjustment (/adjust)', () => {
  test('post, ledger shape, undo appends the inverse, validation, ACL and isolation', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { tenantId, organizationId: orgA } = getTokenContext(adminToken);
    const stamp = uniqueStamp();

    let companyId: string | null = null;
    let accountId: string | null = null;
    let crossTenantActor: SecondTenantActor | null = null;
    let orgB: string | null = null;
    let orgBRoleId: string | null = null;
    let orgBUserId: string | null = null;
    let viewManageOnlyRoleId: string | null = null;
    let viewManageOnlyUserId: string | null = null;
    let viewAdjustRoleId: string | null = null;
    let viewAdjustUserId: string | null = null;

    try {
      companyId = await createCompanyFixture(request, adminToken, `QA CGRP 033 Company ${stamp}`);

      const createResponse = await apiRequest(request, 'POST', CREDIT_ACCOUNTS_PATH, {
        token: adminToken,
        data: { customerId: companyId, currencyCode: 'USD', creditLimit: '1000.00' },
      });
      expect(createResponse.status(), 'admin create should be 201').toBe(201);
      accountId = ((await readJsonSafe<{ id?: string }>(createResponse))?.id) ?? null;
      expect(typeof accountId).toBe('string');

      // --- positive adjustment: increases exposure, appends an `adjust` entry ---
      const upResponse = await request.fetch(adjustPath(accountId!), {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        data: { amount: '150.00', note: `Correction up ${stamp}` },
      });
      expect(upResponse.status(), 'positive adjustment should be 200').toBe(200);
      const upBody = (await readJsonSafe<{ entry?: EntryBody }>(upResponse))?.entry;
      expect(upBody).toMatchObject({ creditAccountId: accountId, entryType: 'adjust', amount: '150.00', balanceAfter: '150.00' });
      const forwardEntryId = upBody?.entryId;
      expect(typeof forwardEntryId).toBe('string');

      const operation = deserializeOperationMetadata(upResponse.headers()['x-om-operation']);
      expect(operation?.undoToken, 'the /adjust response must carry an undo token (G20)').toBeTruthy();
      expect(operation?.commandId).toBe('customer_groups.credit.adjust');

      const listAfterUp = await apiRequest(request, 'GET', `${CREDIT_ACCOUNTS_PATH}?customerId=${encodeURIComponent(companyId)}`, {
        token: adminToken,
      });
      const listAfterUpBody = await readJsonSafe<{ items?: Array<{ id: string; exposure?: string | null }> }>(listAfterUp);
      expect((listAfterUpBody?.items ?? []).find((item) => item.id === accountId)?.exposure).toBe('150.00');

      // --- negative adjustment: the manual-settlement path (D-R5-2) ---
      const downResponse = await request.fetch(adjustPath(accountId!), {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        data: { amount: '-50.00', note: `Payment received, settled manually ${stamp}` },
      });
      expect(downResponse.status(), 'negative adjustment should be 200').toBe(200);
      const downBody = (await readJsonSafe<{ entry?: EntryBody }>(downResponse))?.entry;
      expect(downBody).toMatchObject({ entryType: 'adjust', amount: '-50.00', balanceAfter: '100.00' });

      const listAfterDown = await apiRequest(request, 'GET', `${CREDIT_ACCOUNTS_PATH}?customerId=${encodeURIComponent(companyId)}`, {
        token: adminToken,
      });
      const listAfterDownBody = await readJsonSafe<{ items?: Array<{ id: string; exposure?: string | null }> }>(listAfterDown);
      expect((listAfterDownBody?.items ?? []).find((item) => item.id === accountId)?.exposure).toBe('100.00');

      // --- validation: .strict() body, zero amount, missing note ---
      const zeroResponse = await apiRequest(request, 'POST', adjustPath(accountId!), {
        token: adminToken,
        data: { amount: '0.00', note: 'zero is not a correction' },
      });
      expect(zeroResponse.status(), 'zero amount must 400').toBe(400);
      const missingNoteResponse = await apiRequest(request, 'POST', adjustPath(accountId!), {
        token: adminToken,
        data: { amount: '10.00' },
      });
      expect(missingNoteResponse.status(), 'missing note must 400').toBe(400);
      const malformedAmountResponse = await apiRequest(request, 'POST', adjustPath(accountId!), {
        token: adminToken,
        data: { amount: '10.999', note: 'too many decimals' },
      });
      expect(malformedAmountResponse.status(), 'more than 2dp must 400').toBe(400);
      const smuggledScopeResponse = await apiRequest(request, 'POST', adjustPath(accountId!), {
        token: adminToken,
        data: { amount: '10.00', note: 'x', organizationId: randomUUID() },
      });
      expect(smuggledScopeResponse.status(), 'strict body must reject organizationId').toBe(400);

      // --- undo appends the INVERSE entry, never a delete (G20) ---
      const undoResponse = await apiRequest(request, 'POST', UNDO_PATH, {
        token: adminToken,
        data: { undoToken: operation?.undoToken },
      });
      expect(undoResponse.status(), `undo failed: ${undoResponse.status()} ${await undoResponse.text()}`).toBe(200);

      const ledgerResponse = await apiRequest(request, 'GET', ledgerPath(accountId!, '?pageSize=10'), { token: adminToken });
      const ledgerBody = await readJsonSafe<LedgerBody>(ledgerResponse);
      const entries = ledgerBody?.items ?? [];
      expect(entries).toHaveLength(3);
      // The forward +150.00 entry is still present (never deleted) ...
      expect(entries.some((entry) => entry.id === forwardEntryId && entry.amount === '150.00')).toBe(true);
      // ... and a new -150.00 reversal, linked to it, now sits beside it.
      const reversal = entries.find((entry) => entry.relatedEntryId === forwardEntryId);
      expect(reversal?.amount).toBe('-150.00');

      const listAfterUndo = await apiRequest(request, 'GET', `${CREDIT_ACCOUNTS_PATH}?customerId=${encodeURIComponent(companyId)}`, {
        token: adminToken,
      });
      const listAfterUndoBody = await readJsonSafe<{ items?: Array<{ id: string; exposure?: string | null }> }>(listAfterUndo);
      // 150 (forward) - 50 (settle) - 150 (reversal) = -50.00
      expect((listAfterUndoBody?.items ?? []).find((item) => item.id === accountId)?.exposure).toBe('-50.00');

      // --- cross-TENANT isolation ---
      crossTenantActor = await createSecondTenantActor(request, superadminToken, stamp, [
        'customer_groups.credit.view',
        'customer_groups.credit.manage',
        'customer_groups.credit.adjust',
      ]);
      const crossTenantAdjustResponse = await apiRequest(request, 'POST', adjustPath(accountId!), {
        token: crossTenantActor.token,
        data: { amount: '5.00', note: 'cross-tenant attempt' },
      });
      expect(crossTenantAdjustResponse.status(), 'cross-tenant adjust must 404').toBe(404);

      // --- cross-ORGANIZATION isolation (same tenant) ---
      orgB = await createOrganizationFixture(request, adminToken, { name: `QA CGRP 033 Org B ${stamp}`, tenantId });
      orgBRoleId = await createRoleFixture(request, adminToken, { name: `QA CGRP 033 Org B Role ${stamp}`, tenantId });
      await setRoleAclFeatures(request, adminToken, {
        roleId: orgBRoleId,
        features: ['customer_groups.credit.view', 'customer_groups.credit.manage', 'customer_groups.credit.adjust'],
        organizations: [orgB],
      });
      const orgBEmail = `qa-cgrp-033-orgb-${stamp}@test.invalid`;
      orgBUserId = await createUserFixture(request, adminToken, {
        email: orgBEmail,
        password: 'Valid1!Pass',
        organizationId: orgB,
        roles: [orgBRoleId],
      });
      const orgBToken = await getAuthToken(request, orgBEmail, 'Valid1!Pass');
      const orgBAdjustResponse = await apiRequest(request, 'POST', adjustPath(accountId!), {
        token: orgBToken,
        data: { amount: '5.00', note: 'org-B attempt' },
      });
      expect(orgBAdjustResponse.status(), 'org-B adjust must 404').toBe(404);

      // --- ACL: credit.view + credit.manage alone cannot adjust ---
      viewManageOnlyRoleId = await createRoleFixture(request, adminToken, { name: `QA CGRP 033 No Adjust ${stamp}`, tenantId });
      await setRoleAclFeatures(request, adminToken, {
        roleId: viewManageOnlyRoleId,
        features: ['customer_groups.credit.view', 'customer_groups.credit.manage'],
        organizations: [orgA],
      });
      const noAdjustEmail = `qa-cgrp-033-noadjust-${stamp}@test.invalid`;
      viewManageOnlyUserId = await createUserFixture(request, adminToken, {
        email: noAdjustEmail,
        password: 'Valid1!Pass',
        organizationId: orgA,
        roles: [viewManageOnlyRoleId],
      });
      const noAdjustToken = await getAuthToken(request, noAdjustEmail, 'Valid1!Pass');
      const noAdjustResponse = await apiRequest(request, 'POST', adjustPath(accountId!), {
        token: noAdjustToken,
        data: { amount: '5.00', note: 'credit.manage alone is not enough' },
      });
      expect(noAdjustResponse.status(), 'credit.view/.manage alone must 403').toBe(403);

      // --- ACL: a caller WITH credit.adjust (+ credit.view) succeeds ---
      viewAdjustRoleId = await createRoleFixture(request, adminToken, { name: `QA CGRP 033 Adjust Only ${stamp}`, tenantId });
      await setRoleAclFeatures(request, adminToken, {
        roleId: viewAdjustRoleId,
        features: ['customer_groups.credit.view', 'customer_groups.credit.adjust'],
        organizations: [orgA],
      });
      const adjustOnlyEmail = `qa-cgrp-033-adjustonly-${stamp}@test.invalid`;
      viewAdjustUserId = await createUserFixture(request, adminToken, {
        email: adjustOnlyEmail,
        password: 'Valid1!Pass',
        organizationId: orgA,
        roles: [viewAdjustRoleId],
      });
      const adjustOnlyToken = await getAuthToken(request, adjustOnlyEmail, 'Valid1!Pass');
      const adjustOnlyResponse = await apiRequest(request, 'POST', adjustPath(accountId!), {
        token: adjustOnlyToken,
        data: { amount: '5.00', note: 'credit.adjust alone is enough' },
      });
      expect(adjustOnlyResponse.status(), 'credit.adjust (+ credit.view) succeeds').toBe(200);
    } finally {
      await deleteUserIfExists(request, adminToken, viewAdjustUserId);
      await deleteRoleIfExists(request, adminToken, viewAdjustRoleId);
      await deleteUserIfExists(request, adminToken, viewManageOnlyUserId);
      await deleteRoleIfExists(request, adminToken, viewManageOnlyRoleId);
      await deleteUserIfExists(request, adminToken, orgBUserId);
      await deleteRoleIfExists(request, adminToken, orgBRoleId);
      await deleteOrganizationIfExists(request, adminToken, orgB);
      await cleanupSecondTenantActor(request, superadminToken, crossTenantActor);
      await deleteCreditAccountFixture(accountId);
      await deleteEntityIfExists(request, adminToken, COMPANIES_PATH, companyId);
    }
  });
});
