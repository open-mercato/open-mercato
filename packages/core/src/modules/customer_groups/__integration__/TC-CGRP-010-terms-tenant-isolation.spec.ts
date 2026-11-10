import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomerGroupFixture,
  createCustomerGroupMembershipFixture,
  createCustomerGroupTermsFixture,
  deleteCustomerGroupIfExists,
  deleteCustomerGroupMembershipIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  CUSTOMER_GROUPS_FEATURES,
  cleanupSecondTenantActor,
  createSecondTenantActor,
  fixturePriority,
  uniqueStamp,
  type SecondTenantActor,
} from './helpers';

/**
 * TC-CGRP-010: Phase 2 routes, tenant isolation.
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §13 — "every
 * route in §9, each asserting tenant isolation with a second-tenant fixture."
 * Mirrors TC-CGRP-001's second-tenant pattern for the two Phase 2 routes.
 *
 * `GET/PUT /api/customer_groups/customer-groups/:id/terms`: the route loads the GROUP first
 * (`loadGroupOrThrow`, scoped by `tenantId: scope.tenantId`) before it ever
 * looks at a terms row, so a tenant-B token sending the exact tenant-A group
 * id gets a 404 from the group lookup itself — tenant B genuinely has no such
 * group, proving the group-existence check (not just the terms lookup) is
 * tenant-scoped.
 *
 * `GET /api/customer_groups/customer-groups/explain-terms?customerId=`: before
 * resolving anything, the route checks that the customer is a live
 * `customer_entities` row of the CALLER's tenant, visible in the caller's
 * organization scope (`lib/customerScope.ts`). A tenant-A customer sent with a
 * tenant-B token does not exist in tenant B, so the route answers 404 and no
 * tenant-A group or terms data appears anywhere in the response.
 */
const GROUPS_PATH = '/api/customer_groups/customer-groups';
const EXPLAIN_TERMS_PATH = '/api/customer_groups/customer-groups/explain-terms';
const TERMS_FEATURES = [
  ...CUSTOMER_GROUPS_FEATURES,
  'customer_groups.terms.view',
  'customer_groups.terms.manage',
];

test.describe('TC-CGRP-010: Phase 2 (terms) tenant isolation', () => {
  test('a tenant-A group\'s terms are invisible and unreachable from tenant B, and explain-terms leaks nothing for a tenant-A customer', async ({
    request,
  }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();

    let memberCustomerId: string | null = null;
    let groupId: string | null = null;
    let membershipId: string | null = null;
    let actor: SecondTenantActor | null = null;

    try {
      memberCustomerId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `CGRP010 Member ${stamp}`,
        displayName: `QA CGRP010 Member ${stamp}`,
      });
      groupId = await createCustomerGroupFixture(request, adminToken, {
        code: `qa-cgrp-010-${stamp}`,
        name: `QA CGRP 010 Group ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });
      await createCustomerGroupTermsFixture(request, adminToken, {
        groupId,
        paymentTermsDays: 45,
        allowPurchaseOnAccount: true,
      });
      membershipId = await createCustomerGroupMembershipFixture(request, adminToken, {
        groupId,
        customerId: memberCustomerId,
      });

      actor = await createSecondTenantActor(request, superadminToken, stamp, TERMS_FEATURES);

      // GET terms: tenant B sending the exact tenant-A group id must 404, not
      // leak a terms row.
      const getResponse = await apiRequest(request, 'GET', `${GROUPS_PATH}/${groupId}/terms`, {
        token: actor.token,
      });
      expect(getResponse.status(), 'tenant B GET terms for a tenant-A group id should 404').toBe(404);

      // PUT terms: tenant B must not be able to create/overwrite a terms row
      // under the tenant-A group id either.
      const putResponse = await apiRequest(request, 'PUT', `${GROUPS_PATH}/${groupId}/terms`, {
        token: actor.token,
        data: { paymentTermsDays: 999 },
      });
      expect(putResponse.status(), 'tenant B PUT terms for a tenant-A group id should 404').toBe(404);

      // The tenant-A terms row survives untouched under tenant A's own token.
      const survivorResponse = await apiRequest(request, 'GET', `${GROUPS_PATH}/${groupId}/terms`, {
        token: adminToken,
      });
      expect(survivorResponse.status()).toBe(200);
      const survivorBody = await readJsonSafe<{ terms?: { paymentTermsDays?: number | null } }>(survivorResponse);
      expect(
        survivorBody?.terms?.paymentTermsDays,
        'tenant-A terms must be unaffected by tenant-B attempts',
      ).toBe(45);

      // explain-terms: the tenant-A customer does not exist in tenant B, so the
      // customer scope check answers 404 before any group or terms resolution.
      const explainResponse = await apiRequest(
        request,
        'GET',
        `${EXPLAIN_TERMS_PATH}?customerId=${encodeURIComponent(memberCustomerId)}`,
        { token: actor.token },
      );
      expect(explainResponse.status(), 'tenant B explain-terms for a tenant-A customerId should be 404').toBe(404);
      const explainBody = await readJsonSafe<{ groups?: unknown; fields?: unknown }>(explainResponse);
      expect(explainBody?.groups, 'the 404 body must not carry any resolved groups').toBeUndefined();
      expect(explainBody?.fields, 'the 404 body must not carry any resolved terms').toBeUndefined();

      // Sanity: the SAME customerId under tenant A's own token still resolves
      // the real terms (proves the tenant-B 404 above is genuine isolation, not
      // a broken route).
      const ownerExplainResponse = await apiRequest(
        request,
        'GET',
        `${EXPLAIN_TERMS_PATH}?customerId=${encodeURIComponent(memberCustomerId)}`,
        { token: adminToken },
      );
      expect(ownerExplainResponse.status()).toBe(200);
      const ownerExplainBody = await readJsonSafe<{
        fields?: Record<string, { value: unknown; sourceGroupId: string | null }>;
      }>(ownerExplainResponse);
      expect(ownerExplainBody?.fields?.paymentTermsDays).toMatchObject({ value: 45, sourceGroupId: groupId });
    } finally {
      await deleteCustomerGroupMembershipIfExists(request, adminToken, membershipId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', memberCustomerId);
      await deleteCustomerGroupIfExists(request, adminToken, groupId);
      await cleanupSecondTenantActor(request, superadminToken, actor);
    }
  });
});
