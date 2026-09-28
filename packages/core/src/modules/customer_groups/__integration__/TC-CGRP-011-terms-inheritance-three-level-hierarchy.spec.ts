import { randomUUID } from 'node:crypto';
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
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-011: THE PHASE 2 GATE — "terms inheritance resolves per field
 * across a 3-level hierarchy with sourceGroupId correct for each."
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §6.1/§13 —
 * Phase 2 acceptance criteria (US-C2).
 *
 * Builds a real 3-level group hierarchy over HTTP: grandparent → parent
 * (`parentId` = grandparent) → child (`parentId` = parent). Terms are set
 * ONLY on the grandparent, for ONE field (`paymentTermsDays`); parent and
 * child are left without a terms row entirely, exercising the "no row for
 * this group, keep walking the ancestor chain" branch of `resolveTerms()`
 * (`termsFieldIsSet` treats an absent row as unset for every field).
 *
 * A customer is a member of only the CHILD group.
 * `GET /api/customer_groups/customer-groups/explain-terms?customerId=` must resolve:
 *   - `paymentTermsDays.value` === the grandparent's value (not null/default)
 *   - `paymentTermsDays.sourceGroupId` === the grandparent's id (not the
 *     child's — proves the ancestor walk, not a shallow "own group only" read)
 *   - `paymentTermsDays.path` === [child, parent, grandparent] in that exact
 *     order (the visible ancestor breadcrumb the spec's explain panel needs)
 *
 * Every OTHER field is asserted to stay at the tenant default (null /
 * `sourceGroupId: null` / empty path) since it was never set anywhere in the
 * chain — proving per-field independence, not "the whole terms row inherited."
 */
const GROUPS_PATH = '/api/customer_groups/customer-groups';
const EXPLAIN_TERMS_PATH = '/api/customer_groups/customer-groups/explain-terms';

test.describe('TC-CGRP-011: Phase 2 gate — per-field terms inheritance across a 3-level hierarchy', () => {
  test('a field set only on the grandparent resolves for a child-group member with the grandparent as sourceGroupId and full ancestor path', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const customerId = randomUUID();

    let grandparentId: string | null = null;
    let parentId: string | null = null;
    let childId: string | null = null;
    let membershipId: string | null = null;

    try {
      grandparentId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-011-gp-${stamp}`,
        name: `QA CGRP 011 Grandparent ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });
      parentId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-011-p-${stamp}`,
        name: `QA CGRP 011 Parent ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 2),
        parentId: grandparentId,
      });
      childId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-011-c-${stamp}`,
        name: `QA CGRP 011 Child ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 3),
        parentId,
      });

      await createCustomerGroupTermsFixture(request, token, {
        groupId: grandparentId,
        paymentTermsDays: 60,
      });

      membershipId = await createCustomerGroupMembershipFixture(request, token, {
        groupId: childId,
        customerId,
      });

      const response = await apiRequest(
        request,
        'GET',
        `${EXPLAIN_TERMS_PATH}?customerId=${encodeURIComponent(customerId)}`,
        { token },
      );
      expect(response.status()).toBe(200);
      const body = await readJsonSafe<{
        groups?: Array<{ id: string }>;
        fields?: Record<
          string,
          { value: unknown; sourceGroupId: string | null; path: Array<{ id: string; code: string; name: string }> }
        >;
      }>(response);

      expect(body?.groups?.map((g) => g.id), 'the customer resolves exactly the child group as its own membership').toEqual([
        childId,
      ]);

      const paymentTermsDays = body?.fields?.paymentTermsDays;
      expect(paymentTermsDays?.value, 'paymentTermsDays must resolve the grandparent value, not null').toBe(60);
      expect(
        paymentTermsDays?.sourceGroupId,
        'paymentTermsDays.sourceGroupId must be the GRANDPARENT id, not the child\'s',
      ).toBe(grandparentId);
      expect(
        paymentTermsDays?.path?.map((g) => g.id),
        'paymentTermsDays.path must contain all three groups in child -> parent -> grandparent order',
      ).toEqual([childId, parentId, grandparentId]);

      // Every other field was never set anywhere in the chain: tenant default,
      // no source, no path. Proves resolution is per-field, not "copy the
      // grandparent's whole terms row."
      for (const field of ['priceKindId', 'approvalRequiredAbove', 'minOrderValue'] as const) {
        expect(body?.fields?.[field], `${field} must stay at the tenant default (never set)`).toMatchObject({
          value: null,
          sourceGroupId: null,
          path: [],
        });
      }
      // `allowPurchaseOnAccount` is the one non-nullable-column field (see
      // `termsFieldIsSet` in services/customerGroupsService.ts): the grandparent's
      // terms row exists (created above), so this field counts as "set" there even
      // though its value is the schema default `false` — unlike the nullable fields
      // above, a terms row can never leave just this one field unset. It therefore
      // resolves the same way paymentTermsDays does: value from, and sourced to, the
      // grandparent, with the same ancestor path.
      const allowPurchaseOnAccount = body?.fields?.allowPurchaseOnAccount;
      expect(allowPurchaseOnAccount?.value, 'allowPurchaseOnAccount resolves to its false default value').toBe(false);
      expect(
        allowPurchaseOnAccount?.sourceGroupId,
        'allowPurchaseOnAccount.sourceGroupId must be the grandparent — any existing terms row defines this field, even at its default',
      ).toBe(grandparentId);
      expect(
        allowPurchaseOnAccount?.path?.map((g) => g.id),
        'allowPurchaseOnAccount.path must contain all three groups in child -> parent -> grandparent order',
      ).toEqual([childId, parentId, grandparentId]);
    } finally {
      await deleteCustomerGroupMembershipIfExists(request, token, membershipId);
      await deleteCustomerGroupIfExists(request, token, childId);
      await deleteCustomerGroupIfExists(request, token, parentId);
      await deleteCustomerGroupIfExists(request, token, grandparentId);
    }
  });
});
