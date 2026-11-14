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
import {
  cleanupSecondTenantActor,
  createSecondTenantActor,
  uniqueStamp,
  type SecondTenantActor,
} from './helpers';

/**
 * TC-CGRP-032: operator provisioning (`POST …/credit-accounts`, G13/D-R5-5) and the
 * read-only ledger (`GET …/credit-accounts/:id/ledger`, §9) — Step 1.11.
 *
 * - create returns the account shape; a second create for the same customer and
 *   currency answers `409 credit_account_exists`; the body is `.strict()`, requires
 *   `creditLimit`, and enforces the hold-reason invariant;
 * - the ledger is newest first, paginated (`pageSize ≤ 100`) and returns `note`;
 * - a second tenant and a second organization of the same tenant can neither create an
 *   account for this customer nor read this account's ledger (both answer like an
 *   unknown id);
 * - `credit.view` alone reads the ledger but cannot create; a caller without
 *   `credit.view` cannot read the ledger.
 *
 * No route writes ledger entries yet (`/adjust` is Step 1.12, reservations come from
 * checkout), so the entries are inserted through `pg`, the same "no create API yet"
 * convention TC-CGRP-031 follows for the account itself.
 */
const CREDIT_ACCOUNTS_PATH = '/api/customer_groups/customer-groups/credit-accounts';
const COMPANIES_PATH = '/api/customers/companies';

function ledgerPath(accountId: string, query = ''): string {
  return `${CREDIT_ACCOUNTS_PATH}/${encodeURIComponent(accountId)}/ledger${query}`;
}

async function insertLedgerEntries(input: {
  tenantId: string;
  organizationId: string;
  accountId: string;
  stamp: string;
}): Promise<void> {
  await withClient(async (client) => {
    const entries = [
      { type: 'adjust', amount: '100.00', balance: '100.00', note: `Opening balance ${input.stamp}`, minutesAgo: 30 },
      { type: 'reserve', amount: '50.00', balance: '150.00', note: null, minutesAgo: 20 },
      { type: 'adjust', amount: '-25.00', balance: '125.00', note: `Payment received ${input.stamp}`, minutesAgo: 10 },
    ];
    for (const [index, entry] of entries.entries()) {
      await client.query(
        `insert into customer_credit_ledger_entries
           (id, tenant_id, organization_id, credit_account_id, entry_type, amount, source_type, idempotency_key,
            balance_after, created_by_actor_type, note, created_at)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, 'manual', $6, $7, 'staff_user', $8,
                 now() - ($9 || ' minutes')::interval)`,
        [
          input.tenantId,
          input.organizationId,
          input.accountId,
          entry.type,
          entry.amount,
          `qa-cgrp-032-${input.stamp}-${index}`,
          entry.balance,
          entry.note,
          String(entry.minutesAgo),
        ],
      );
    }
  });
}

async function deleteCreditAccountFixture(id: string | null): Promise<void> {
  if (!id) return;
  await withClient(async (client) => {
    await client.query('delete from customer_credit_ledger_entries where credit_account_id = $1', [id]);
    await client.query('delete from customer_credit_accounts where id = $1', [id]);
  }).catch(() => undefined);
}

type LedgerBody = {
  items?: Array<{ id: string; entryType: string; amount: string; balanceAfter: string; note: string | null }>;
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};

test.describe('TC-CGRP-032: credit account provisioning and ledger', () => {
  test('create, duplicate refusal, ledger paging, tenant/org isolation and ACL', async ({ request }) => {
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
    let viewOnlyRoleId: string | null = null;
    let viewOnlyUserId: string | null = null;
    let noCreditRoleId: string | null = null;
    let noCreditUserId: string | null = null;

    try {
      companyId = await createCompanyFixture(request, adminToken, `QA CGRP 032 Company ${stamp}`);

      // --- create: shape ---
      const createResponse = await apiRequest(request, 'POST', CREDIT_ACCOUNTS_PATH, {
        token: adminToken,
        data: { customerId: companyId, currencyCode: 'usd', creditLimit: '2500.5' },
      });
      expect(createResponse.status(), 'admin create should be 201').toBe(201);
      const created = await readJsonSafe<{
        id?: string;
        organizationId?: string;
        customerId?: string;
        currencyCode?: string;
        creditLimit?: string;
        isOnHold?: boolean;
        updatedAt?: string | null;
      }>(createResponse);
      expect(typeof created?.id).toBe('string');
      accountId = created?.id ?? null;
      expect(created).toMatchObject({
        organizationId: orgA,
        customerId: companyId,
        currencyCode: 'USD',
        creditLimit: '2500.50',
        isOnHold: false,
      });
      expect(typeof created?.updatedAt).toBe('string');

      const listResponse = await apiRequest(
        request,
        'GET',
        `${CREDIT_ACCOUNTS_PATH}?customerId=${encodeURIComponent(companyId)}`,
        { token: adminToken },
      );
      expect(listResponse.status()).toBe(200);
      const listBody = await readJsonSafe<{ items?: Array<{ id: string; credit_limit?: string }> }>(listResponse);
      expect((listBody?.items ?? []).find((item) => item.id === accountId)?.credit_limit).toBe('2500.50');

      // --- duplicate create ---
      const duplicateResponse = await apiRequest(request, 'POST', CREDIT_ACCOUNTS_PATH, {
        token: adminToken,
        data: { customerId: companyId, currencyCode: 'USD', creditLimit: 10 },
      });
      expect(duplicateResponse.status(), 'duplicate create must 409').toBe(409);
      expect((await readJsonSafe<{ code?: string }>(duplicateResponse))?.code).toBe('credit_account_exists');

      // --- body validation ---
      const smuggledScopeResponse = await apiRequest(request, 'POST', CREDIT_ACCOUNTS_PATH, {
        token: adminToken,
        data: { customerId: companyId, currencyCode: 'EUR', creditLimit: 10, organizationId: randomUUID() },
      });
      expect(smuggledScopeResponse.status(), 'strict body must reject organizationId').toBe(400);
      const missingLimitResponse = await apiRequest(request, 'POST', CREDIT_ACCOUNTS_PATH, {
        token: adminToken,
        data: { customerId: companyId, currencyCode: 'EUR' },
      });
      expect(missingLimitResponse.status(), 'creditLimit is required').toBe(400);
      const holdWithoutReasonResponse = await apiRequest(request, 'POST', CREDIT_ACCOUNTS_PATH, {
        token: adminToken,
        data: { customerId: companyId, currencyCode: 'EUR', creditLimit: 10, isOnHold: true },
      });
      expect(holdWithoutReasonResponse.status(), 'isOnHold without holdReason must 400').toBe(400);
      const unknownCustomerResponse = await apiRequest(request, 'POST', CREDIT_ACCOUNTS_PATH, {
        token: adminToken,
        data: { customerId: randomUUID(), currencyCode: 'EUR', creditLimit: 10 },
      });
      expect(unknownCustomerResponse.status(), 'unknown customer must 400').toBe(400);

      // --- ledger: newest first, paginated, note returned ---
      await insertLedgerEntries({ tenantId, organizationId: orgA, accountId: accountId!, stamp });

      const firstPageResponse = await apiRequest(request, 'GET', ledgerPath(accountId!, '?pageSize=2'), {
        token: adminToken,
      });
      expect(firstPageResponse.status(), 'admin ledger should be 200').toBe(200);
      const firstPage = await readJsonSafe<LedgerBody>(firstPageResponse);
      expect(firstPage).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
      expect((firstPage?.items ?? []).map((entry) => [entry.entryType, entry.amount, entry.balanceAfter])).toEqual([
        ['adjust', '-25.00', '125.00'],
        ['reserve', '50.00', '150.00'],
      ]);
      expect(firstPage?.items?.[0]?.note).toBe(`Payment received ${stamp}`);
      expect(firstPage?.items?.[1]?.note).toBeNull();

      const secondPageResponse = await apiRequest(request, 'GET', ledgerPath(accountId!, '?pageSize=2&page=2'), {
        token: adminToken,
      });
      const secondPage = await readJsonSafe<LedgerBody>(secondPageResponse);
      expect((secondPage?.items ?? []).map((entry) => entry.note)).toEqual([`Opening balance ${stamp}`]);

      const oversizedPageResponse = await apiRequest(request, 'GET', ledgerPath(accountId!, '?pageSize=101'), {
        token: adminToken,
      });
      expect(oversizedPageResponse.status(), 'pageSize above 100 must 400').toBe(400);

      const unknownAccountResponse = await apiRequest(request, 'GET', ledgerPath(randomUUID()), { token: adminToken });
      expect(unknownAccountResponse.status(), 'unknown account must 404').toBe(404);

      // --- cross-TENANT isolation ---
      crossTenantActor = await createSecondTenantActor(request, superadminToken, stamp, [
        'customer_groups.credit.view',
        'customer_groups.credit.manage',
      ]);
      const crossTenantLedgerResponse = await apiRequest(request, 'GET', ledgerPath(accountId!), {
        token: crossTenantActor.token,
      });
      expect(crossTenantLedgerResponse.status(), 'cross-tenant ledger must 404').toBe(404);
      const crossTenantCreateResponse = await apiRequest(request, 'POST', CREDIT_ACCOUNTS_PATH, {
        token: crossTenantActor.token,
        data: { customerId: companyId, currencyCode: 'GBP', creditLimit: 10 },
      });
      expect(crossTenantCreateResponse.status(), 'cross-tenant create for a foreign customer must 400').toBe(400);

      // --- cross-ORGANIZATION isolation (same tenant) ---
      orgB = await createOrganizationFixture(request, adminToken, { name: `QA CGRP 032 Org B ${stamp}`, tenantId });
      orgBRoleId = await createRoleFixture(request, adminToken, { name: `QA CGRP 032 Org B Role ${stamp}`, tenantId });
      await setRoleAclFeatures(request, adminToken, {
        roleId: orgBRoleId,
        features: ['customer_groups.credit.view', 'customer_groups.credit.manage'],
        organizations: [orgB],
      });
      const orgBEmail = `qa-cgrp-032-orgb-${stamp}@test.invalid`;
      orgBUserId = await createUserFixture(request, adminToken, {
        email: orgBEmail,
        password: 'Valid1!Pass',
        organizationId: orgB,
        roles: [orgBRoleId],
      });
      const orgBToken = await getAuthToken(request, orgBEmail, 'Valid1!Pass');
      const orgBLedgerResponse = await apiRequest(request, 'GET', ledgerPath(accountId!), { token: orgBToken });
      expect(orgBLedgerResponse.status(), 'org-B ledger must 404').toBe(404);
      const orgBCreateResponse = await apiRequest(request, 'POST', CREDIT_ACCOUNTS_PATH, {
        token: orgBToken,
        data: { customerId: companyId, currencyCode: 'GBP', creditLimit: 10 },
      });
      expect(orgBCreateResponse.status(), 'org-B create for an org-A customer must 400').toBe(400);

      // --- ACL: credit.view reads the ledger but cannot create ---
      viewOnlyRoleId = await createRoleFixture(request, adminToken, { name: `QA CGRP 032 View Only ${stamp}`, tenantId });
      await setRoleAclFeatures(request, adminToken, {
        roleId: viewOnlyRoleId,
        features: ['customer_groups.credit.view'],
        organizations: [orgA],
      });
      const viewOnlyEmail = `qa-cgrp-032-viewonly-${stamp}@test.invalid`;
      viewOnlyUserId = await createUserFixture(request, adminToken, {
        email: viewOnlyEmail,
        password: 'Valid1!Pass',
        organizationId: orgA,
        roles: [viewOnlyRoleId],
      });
      const viewOnlyToken = await getAuthToken(request, viewOnlyEmail, 'Valid1!Pass');
      const viewOnlyLedgerResponse = await apiRequest(request, 'GET', ledgerPath(accountId!), { token: viewOnlyToken });
      expect(viewOnlyLedgerResponse.status(), 'credit.view reads the ledger').toBe(200);
      const viewOnlyCreateResponse = await apiRequest(request, 'POST', CREDIT_ACCOUNTS_PATH, {
        token: viewOnlyToken,
        data: { customerId: companyId, currencyCode: 'GBP', creditLimit: 10 },
      });
      expect(viewOnlyCreateResponse.status(), 'credit.view alone cannot create').toBe(403);

      // --- ACL: no credit.view, no ledger ---
      noCreditRoleId = await createRoleFixture(request, adminToken, { name: `QA CGRP 032 No Credit ${stamp}`, tenantId });
      await setRoleAclFeatures(request, adminToken, {
        roleId: noCreditRoleId,
        features: ['customer_groups.groups.view'],
        organizations: [orgA],
      });
      const noCreditEmail = `qa-cgrp-032-nocredit-${stamp}@test.invalid`;
      noCreditUserId = await createUserFixture(request, adminToken, {
        email: noCreditEmail,
        password: 'Valid1!Pass',
        organizationId: orgA,
        roles: [noCreditRoleId],
      });
      const noCreditToken = await getAuthToken(request, noCreditEmail, 'Valid1!Pass');
      const noCreditLedgerResponse = await apiRequest(request, 'GET', ledgerPath(accountId!), { token: noCreditToken });
      expect(noCreditLedgerResponse.status(), 'a caller without credit.view must 403').toBe(403);
    } finally {
      await deleteUserIfExists(request, adminToken, noCreditUserId);
      await deleteRoleIfExists(request, adminToken, noCreditRoleId);
      await deleteUserIfExists(request, adminToken, viewOnlyUserId);
      await deleteRoleIfExists(request, adminToken, viewOnlyRoleId);
      await deleteUserIfExists(request, adminToken, orgBUserId);
      await deleteRoleIfExists(request, adminToken, orgBRoleId);
      await deleteOrganizationIfExists(request, adminToken, orgB);
      await cleanupSecondTenantActor(request, superadminToken, crossTenantActor);
      await deleteCreditAccountFixture(accountId);
      await deleteEntityIfExists(request, adminToken, COMPANIES_PATH, companyId);
    }
  });
});
