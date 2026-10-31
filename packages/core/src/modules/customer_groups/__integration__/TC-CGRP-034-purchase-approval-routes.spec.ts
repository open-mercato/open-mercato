import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
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
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  customerTestPassword,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
  type CustomerRoleFixture,
  type CustomerUserFixture,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures';
import {
  cleanupSecondTenantActor,
  createSecondTenantActor,
  uniqueStamp,
  type SecondTenantActor,
} from './helpers';

/**
 * TC-CGRP-034: staff + portal purchase-approval routes (G5/G7/D-R5-7, Step 2.6).
 *
 * `CustomerPurchaseApproval` has no create route (the spec names only cart
 * commands as a source, out of this Step's scope), so every fixture row is
 * inserted directly via `withClient`.
 *
 * - staff `GET/POST …/approvals*` is feature-gated (`.view` lists/reads,
 *   `.decide` is required separately to decide) and tenant/organization-scoped
 *   (cross-tenant/cross-org answers the unknown-id shape, never a 403 leak);
 * - portal `GET/POST …/portal/approvals*` scopes every route to the caller's
 *   own company — a request for another company's approval answers 404, the
 *   same body as an unknown id;
 * - a `…portal.approvals.view`-only (buyer) role can list/read/withdraw its own
 *   requests but not decide; a `…view + …decide` (portal_admin-like) role sees
 *   the whole company's requests and can decide; a role with neither feature
 *   (viewer) gets nothing.
 */
const STAFF_APPROVALS_PATH = '/api/customer_groups/customer-groups/approvals';
const PORTAL_APPROVALS_PATH = '/api/customer_groups/portal/approvals';

function staffDecidePath(id: string): string {
  return `${STAFF_APPROVALS_PATH}/${encodeURIComponent(id)}/decide`;
}
function portalDetailPath(id: string): string {
  return `${PORTAL_APPROVALS_PATH}/${encodeURIComponent(id)}`;
}
function portalDecidePath(id: string): string {
  return `${PORTAL_APPROVALS_PATH}/${encodeURIComponent(id)}/decide`;
}
function portalWithdrawPath(id: string): string {
  return `${PORTAL_APPROVALS_PATH}/${encodeURIComponent(id)}/withdraw`;
}

type SeedApprovalInput = {
  tenantId: string;
  organizationId: string;
  customerId: string;
  requestedByActorType: 'customer_user' | 'staff_user';
  requestedByActorId: string;
  approvalPolicy: 'buyer' | 'merchant' | 'both';
  amountGross?: string;
  currencyCode?: string;
};

async function seedPendingApproval(input: SeedApprovalInput): Promise<string> {
  const buyerDecision = input.approvalPolicy === 'merchant' ? 'not_required' : 'pending';
  const merchantDecision = input.approvalPolicy === 'buyer' ? 'not_required' : 'pending';
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into customer_purchase_approvals
        (organization_id, tenant_id, customer_id, requested_by_actor_type, requested_by_actor_id,
         subject_type, subject_id, amount_gross, currency_code, approval_policy, status,
         buyer_decision, merchant_decision, expires_at)
       values ($1, $2, $3, $4, $5, 'cart', $6, $7, $8, $9, 'pending', $10, $11, now() + interval '14 days')
       returning id`,
      [
        input.organizationId,
        input.tenantId,
        input.customerId,
        input.requestedByActorType,
        input.requestedByActorId,
        randomUUID(),
        input.amountGross ?? '450.00',
        input.currencyCode ?? 'USD',
        input.approvalPolicy,
        buyerDecision,
        merchantDecision,
      ],
    );
    return result.rows[0].id;
  });
}

async function readApprovalStatus(id: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<{ status: string }>(
      'select status from customer_purchase_approvals where id = $1',
      [id],
    );
    return result.rows[0]?.status ?? null;
  });
}

async function deleteApprovalFixtures(ids: Array<string | null>): Promise<void> {
  const live = ids.filter((id): id is string => Boolean(id));
  if (!live.length) return;
  await withClient(async (client) => {
    await client.query('delete from customer_purchase_approvals where id = any($1::uuid[])', [live]);
  }).catch(() => undefined);
}

test.describe('TC-CGRP-034: purchase approval staff + portal routes', () => {
  test('staff decide is feature-gated and tenant/organization-scoped', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { tenantId, organizationId: orgA } = getTokenContext(adminToken);
    const stamp = uniqueStamp();

    let companyId: string | null = null;
    let approvalId: string | null = null;
    let crossTenantActor: SecondTenantActor | null = null;
    let orgB: string | null = null;
    let orgBRoleId: string | null = null;
    let orgBUserId: string | null = null;
    let viewOnlyRoleId: string | null = null;
    let viewOnlyUserId: string | null = null;
    let viewDecideRoleId: string | null = null;
    let viewDecideUserId: string | null = null;

    try {
      companyId = await createCustomerCompanyFixture(request, adminToken, `QA CGRP 034 Company ${stamp}`);
      approvalId = await seedPendingApproval({
        tenantId,
        organizationId: orgA,
        customerId: companyId,
        requestedByActorType: 'customer_user',
        requestedByActorId: randomUUID(),
        approvalPolicy: 'merchant',
      });

      // --- view-only staff: can list/read, cannot decide ---
      viewOnlyRoleId = await createRoleFixture(request, adminToken, { name: `QA CGRP 034 View Only ${stamp}`, tenantId });
      await setRoleAclFeatures(request, adminToken, {
        roleId: viewOnlyRoleId,
        features: ['customer_groups.approvals.view'],
        organizations: [orgA],
      });
      const viewOnlyEmail = `qa-cgrp-034-view-${stamp}@test.invalid`;
      viewOnlyUserId = await createUserFixture(request, adminToken, {
        email: viewOnlyEmail,
        password: 'Valid1!Pass',
        organizationId: orgA,
        roles: [viewOnlyRoleId],
      });
      const viewOnlyToken = await getAuthToken(request, viewOnlyEmail, 'Valid1!Pass');

      const listResponse = await apiRequest(request, 'GET', `${STAFF_APPROVALS_PATH}?customerId=${encodeURIComponent(companyId)}`, {
        token: viewOnlyToken,
      });
      expect(listResponse.status(), 'view-only list should be 200').toBe(200);
      const listBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(listResponse);
      expect((listBody?.items ?? []).some((item) => item.id === approvalId)).toBe(true);

      const detailResponse = await apiRequest(request, 'GET', `${STAFF_APPROVALS_PATH}/${approvalId}`, { token: viewOnlyToken });
      expect(detailResponse.status(), 'view-only detail should be 200').toBe(200);

      const deniedDecide = await apiRequest(request, 'POST', staffDecidePath(approvalId!), {
        token: viewOnlyToken,
        data: { decision: 'approved' },
      });
      expect(deniedDecide.status(), 'view-only decide must 403').toBe(403);

      // --- view + decide staff: can decide ---
      viewDecideRoleId = await createRoleFixture(request, adminToken, { name: `QA CGRP 034 Decide ${stamp}`, tenantId });
      await setRoleAclFeatures(request, adminToken, {
        roleId: viewDecideRoleId,
        features: ['customer_groups.approvals.view', 'customer_groups.approvals.decide'],
        organizations: [orgA],
      });
      const decideEmail = `qa-cgrp-034-decide-${stamp}@test.invalid`;
      viewDecideUserId = await createUserFixture(request, adminToken, {
        email: decideEmail,
        password: 'Valid1!Pass',
        organizationId: orgA,
        roles: [viewDecideRoleId],
      });
      const decideToken = await getAuthToken(request, decideEmail, 'Valid1!Pass');

      const decideResponse = await apiRequest(request, 'POST', staffDecidePath(approvalId!), {
        token: decideToken,
        data: { decision: 'approved', note: 'Looks fine' },
      });
      expect(decideResponse.status(), 'view+decide should decide 200').toBe(200);
      expect(await readApprovalStatus(approvalId!)).toBe('approved');

      // --- deciding again must 409 (no longer pending) ---
      const redecide = await apiRequest(request, 'POST', staffDecidePath(approvalId!), {
        token: decideToken,
        data: { decision: 'rejected' },
      });
      expect(redecide.status(), 're-deciding a resolved approval must 409').toBe(409);

      // --- cross-TENANT isolation ---
      crossTenantActor = await createSecondTenantActor(request, superadminToken, stamp, [
        'customer_groups.approvals.view',
        'customer_groups.approvals.decide',
      ]);
      const crossTenantList = await apiRequest(request, 'GET', STAFF_APPROVALS_PATH, { token: crossTenantActor.token });
      const crossTenantListBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(crossTenantList);
      expect((crossTenantListBody?.items ?? []).some((item) => item.id === approvalId)).toBe(false);
      const crossTenantDetail = await apiRequest(request, 'GET', `${STAFF_APPROVALS_PATH}/${approvalId}`, {
        token: crossTenantActor.token,
      });
      expect(crossTenantDetail.status(), 'cross-tenant detail must 404').toBe(404);

      // --- cross-ORGANIZATION isolation (same tenant) ---
      orgB = await createOrganizationFixture(request, adminToken, { name: `QA CGRP 034 Org B ${stamp}`, tenantId });
      orgBRoleId = await createRoleFixture(request, adminToken, { name: `QA CGRP 034 Org B Role ${stamp}`, tenantId });
      await setRoleAclFeatures(request, adminToken, {
        roleId: orgBRoleId,
        features: ['customer_groups.approvals.view', 'customer_groups.approvals.decide'],
        organizations: [orgB],
      });
      const orgBEmail = `qa-cgrp-034-orgb-${stamp}@test.invalid`;
      orgBUserId = await createUserFixture(request, adminToken, {
        email: orgBEmail,
        password: 'Valid1!Pass',
        organizationId: orgB,
        roles: [orgBRoleId],
      });
      const orgBToken = await getAuthToken(request, orgBEmail, 'Valid1!Pass');
      const orgBDetail = await apiRequest(request, 'GET', `${STAFF_APPROVALS_PATH}/${approvalId}`, { token: orgBToken });
      expect(orgBDetail.status(), 'org-B detail must 404').toBe(404);
      const orgBDecide = await apiRequest(request, 'POST', staffDecidePath(approvalId!), {
        token: orgBToken,
        data: { decision: 'approved' },
      });
      expect(orgBDecide.status(), 'org-B decide must 404').toBe(404);
    } finally {
      await deleteUserIfExists(request, adminToken, viewOnlyUserId);
      await deleteRoleIfExists(request, adminToken, viewOnlyRoleId);
      await deleteUserIfExists(request, adminToken, viewDecideUserId);
      await deleteRoleIfExists(request, adminToken, viewDecideRoleId);
      await deleteUserIfExists(request, adminToken, orgBUserId);
      await deleteRoleIfExists(request, adminToken, orgBRoleId);
      await deleteOrganizationIfExists(request, adminToken, orgB);
      await cleanupSecondTenantActor(request, superadminToken, crossTenantActor);
      await deleteApprovalFixtures([approvalId]);
      await deleteCustomerCompanyFixture(request, adminToken, companyId);
    }
  });

  test('portal approvals scope to the caller\'s own company; buyer decides nothing, viewer sees nothing', async ({ request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId: orgA } = getTokenContext(adminToken);
    const stamp = uniqueStamp();

    let companyA: string | null = null;
    let companyB: string | null = null;
    let viewerRole: CustomerRoleFixture | null = null;
    let buyerRole: CustomerRoleFixture | null = null;
    let adminRole: CustomerRoleFixture | null = null;
    let viewerUser: CustomerUserFixture | null = null;
    let buyerUser: CustomerUserFixture | null = null;
    let portalAdminUser: CustomerUserFixture | null = null;
    const approvalIds: Array<string | null> = [];

    try {
      companyA = await createCustomerCompanyFixture(request, adminToken, `QA CGRP 034 Company A ${stamp}`);
      companyB = await createCustomerCompanyFixture(request, adminToken, `QA CGRP 034 Company B ${stamp}`);

      // Three portal roles mirroring D-R5-7's grant plan exactly (declared per-test
      // rather than relying on the tenant's seeded defaults, so the assertions hold
      // regardless of whether `sync-customer-role-acls` has run against this fixture
      // tenant).
      viewerRole = await createCustomerRoleFixture(request, adminToken, {
        name: `QA CGRP 034 Viewer ${stamp}`,
        features: [],
      });
      buyerRole = await createCustomerRoleFixture(request, adminToken, {
        name: `QA CGRP 034 Buyer ${stamp}`,
        features: ['customer_groups.portal.approvals.view'],
      });
      adminRole = await createCustomerRoleFixture(request, adminToken, {
        name: `QA CGRP 034 Portal Admin ${stamp}`,
        features: ['customer_groups.portal.approvals.view', 'customer_groups.portal.approvals.decide'],
      });

      viewerUser = await createCustomerUserFixture(request, adminToken, {
        password: customerTestPassword(),
        roleIds: [viewerRole.id],
        customerEntityId: companyA,
      });
      buyerUser = await createCustomerUserFixture(request, adminToken, {
        password: customerTestPassword(),
        roleIds: [buyerRole.id],
        customerEntityId: companyA,
      });
      portalAdminUser = await createCustomerUserFixture(request, adminToken, {
        password: customerTestPassword(),
        roleIds: [adminRole.id],
        customerEntityId: companyA,
      });

      // The buyer's own request (policy "buyer" — the buyer slot decides it).
      const buyerOwnApprovalId = await seedPendingApproval({
        tenantId,
        organizationId: orgA,
        customerId: companyA,
        requestedByActorType: 'customer_user',
        requestedByActorId: buyerUser.id,
        approvalPolicy: 'buyer',
      });
      approvalIds.push(buyerOwnApprovalId);

      // A second request by the same buyer, to withdraw.
      const buyerWithdrawApprovalId = await seedPendingApproval({
        tenantId,
        organizationId: orgA,
        customerId: companyA,
        requestedByActorType: 'customer_user',
        requestedByActorId: buyerUser.id,
        approvalPolicy: 'both',
      });
      approvalIds.push(buyerWithdrawApprovalId);

      // A request by someone else at the SAME company (visible to the portal-admin
      // holder, not to the plain buyer).
      const otherRequesterApprovalId = await seedPendingApproval({
        tenantId,
        organizationId: orgA,
        customerId: companyA,
        requestedByActorType: 'customer_user',
        requestedByActorId: randomUUID(),
        approvalPolicy: 'merchant',
      });
      approvalIds.push(otherRequesterApprovalId);

      // The portal-admin's own request, to exercise the self-decision guard.
      const portalAdminOwnApprovalId = await seedPendingApproval({
        tenantId,
        organizationId: orgA,
        customerId: companyA,
        requestedByActorType: 'customer_user',
        requestedByActorId: portalAdminUser.id,
        approvalPolicy: 'buyer',
      });
      approvalIds.push(portalAdminOwnApprovalId);

      // A different company's request — the cross-company disclosure check.
      const otherCompanyApprovalId = await seedPendingApproval({
        tenantId,
        organizationId: orgA,
        customerId: companyB,
        requestedByActorType: 'customer_user',
        requestedByActorId: randomUUID(),
        approvalPolicy: 'both',
      });
      approvalIds.push(otherCompanyApprovalId);

      // --- viewer: no portal approval feature at all ---
      const viewerSession = await portalLogin(request, { email: viewerUser.email, password: viewerUser.password, tenantId });
      const viewerList = await request.fetch(PORTAL_APPROVALS_PATH, { headers: portalCookieHeaders(viewerSession) });
      expect(viewerList.status(), 'viewer list must 403 (no portal view feature)').toBe(403);

      // --- buyer: view + withdraw own requests, cannot decide, cannot see others' ---
      const buyerSession = await portalLogin(request, { email: buyerUser.email, password: buyerUser.password, tenantId });
      const buyerListResponse = await request.fetch(PORTAL_APPROVALS_PATH, { headers: portalCookieHeaders(buyerSession) });
      expect(buyerListResponse.status(), 'buyer list should be 200').toBe(200);
      const buyerListBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(buyerListResponse);
      const buyerVisibleIds = new Set((buyerListBody?.items ?? []).map((item) => item.id));
      expect(buyerVisibleIds.has(buyerOwnApprovalId)).toBe(true);
      expect(buyerVisibleIds.has(buyerWithdrawApprovalId)).toBe(true);
      expect(buyerVisibleIds.has(otherRequesterApprovalId), 'buyer must not see another requester\'s approval').toBe(false);

      const buyerDetailOwn = await request.fetch(portalDetailPath(buyerOwnApprovalId), { headers: portalCookieHeaders(buyerSession) });
      expect(buyerDetailOwn.status(), 'buyer can read their own approval').toBe(200);

      const buyerDetailOther = await request.fetch(portalDetailPath(otherRequesterApprovalId), { headers: portalCookieHeaders(buyerSession) });
      expect(buyerDetailOther.status(), 'buyer reading another requester\'s approval must 404').toBe(404);

      const buyerDetailOtherCompany = await request.fetch(portalDetailPath(otherCompanyApprovalId), { headers: portalCookieHeaders(buyerSession) });
      expect(buyerDetailOtherCompany.status(), 'buyer reading another company\'s approval must 404').toBe(404);

      const buyerDecideAttempt = await request.fetch(portalDecidePath(buyerOwnApprovalId), {
        method: 'POST',
        headers: { ...portalCookieHeaders(buyerSession), 'Content-Type': 'application/json' },
        data: { decision: 'approved' },
      });
      expect(buyerDecideAttempt.status(), 'buyer decide must 403 (missing decide feature)').toBe(403);

      const buyerWithdraw = await request.fetch(portalWithdrawPath(buyerWithdrawApprovalId), {
        method: 'POST',
        headers: portalCookieHeaders(buyerSession),
      });
      expect(buyerWithdraw.status(), 'buyer withdraw of their own request should be 200').toBe(200);
      expect(await readApprovalStatus(buyerWithdrawApprovalId)).toBe('withdrawn');

      const buyerWithdrawOther = await request.fetch(portalWithdrawPath(otherRequesterApprovalId), {
        method: 'POST',
        headers: portalCookieHeaders(buyerSession),
      });
      expect(buyerWithdrawOther.status(), 'buyer withdrawing another requester\'s approval must 404 (not visible)').toBe(404);

      // --- portal admin: sees the whole company, can decide, cannot decide their own ---
      const adminSession = await portalLogin(request, { email: portalAdminUser.email, password: portalAdminUser.password, tenantId });
      const adminListResponse = await request.fetch(PORTAL_APPROVALS_PATH, { headers: portalCookieHeaders(adminSession) });
      const adminListBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(adminListResponse);
      const adminVisibleIds = new Set((adminListBody?.items ?? []).map((item) => item.id));
      expect(adminVisibleIds.has(otherRequesterApprovalId), 'a …decide holder sees the whole company').toBe(true);
      expect(adminVisibleIds.has(otherCompanyApprovalId), 'a …decide holder never sees another company').toBe(false);

      const adminDecide = await request.fetch(portalDecidePath(otherRequesterApprovalId), {
        method: 'POST',
        headers: { ...portalCookieHeaders(adminSession), 'Content-Type': 'application/json' },
        data: { decision: 'approved' },
      });
      expect(adminDecide.status(), 'portal admin decide should be 200').toBe(200);

      const adminSelfDecide = await request.fetch(portalDecidePath(portalAdminOwnApprovalId), {
        method: 'POST',
        headers: { ...portalCookieHeaders(adminSession), 'Content-Type': 'application/json' },
        data: { decision: 'approved' },
      });
      expect(adminSelfDecide.status(), 'self-decision must 403').toBe(403);

      const adminCrossCompanyDetail = await request.fetch(portalDetailPath(otherCompanyApprovalId), { headers: portalCookieHeaders(adminSession) });
      expect(adminCrossCompanyDetail.status(), 'cross-company detail must 404 even for a decide holder').toBe(404);
    } finally {
      const cleanupToken = await getAuthToken(request, 'admin');
      await deleteCustomerUserFixture(request, cleanupToken, viewerUser?.id ?? null);
      await deleteCustomerUserFixture(request, cleanupToken, buyerUser?.id ?? null);
      await deleteCustomerUserFixture(request, cleanupToken, portalAdminUser?.id ?? null);
      await deleteCustomerRoleFixture(request, cleanupToken, viewerRole?.id ?? null);
      await deleteCustomerRoleFixture(request, cleanupToken, buyerRole?.id ?? null);
      await deleteCustomerRoleFixture(request, cleanupToken, adminRole?.id ?? null);
      await deleteApprovalFixtures(approvalIds);
      await deleteCustomerCompanyFixture(request, cleanupToken, companyB);
      await deleteCustomerCompanyFixture(request, cleanupToken, companyA);
    }
  });
});
