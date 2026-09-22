import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomerGroupFixture,
  createCustomerGroupTermsFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-014: optimistic-lock conflict on `PUT /api/customer-groups/:id/terms`
 * at the INTEGRATION level (real HTTP, real DB row), proving the guard the
 * unit test in `api/customer-groups/[id]/terms/__tests__/route.test.ts`
 * already covers with a mocked EntityManager.
 *
 * Mirrors `catalog/__integration__/TC-LOCK-OSS-006.spec.ts`'s two-session
 * pattern (see `sales/__integration__/__concurrent_edit_pattern.md`): both
 * sessions start from the same pre-edit `updatedAt` (t0). Session A wins (its
 * PUT carries the fresh header) and advances the row to t1. The stale
 * session B — still carrying t0 — must be refused with the structured 409
 * body (`OPTIMISTIC_LOCK_CONFLICT_ERROR`/`_CODE`, `expectedUpdatedAt: t0`,
 * `currentUpdatedAt` advanced past t0).
 */
const GROUPS_PATH = '/api/customer-groups';

function termsPath(groupId: string): string {
  return `${GROUPS_PATH}/${groupId}/terms`;
}

test.describe('TC-CGRP-014: optimistic-lock conflict on PUT /api/customer-groups/:id/terms', () => {
  test('a stale updatedAt token is refused with 409 after a concurrent update advances the row', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();

    let groupId: string | null = null;

    try {
      groupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-014-${stamp}`,
        name: `QA CGRP 014 Group ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });

      // Creation needs no lock header (nothing to conflict with yet).
      const created = await createCustomerGroupTermsFixture(request, token, {
        groupId,
        paymentTermsDays: 15,
      });
      const t0 = created.updatedAt;
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Session A: fresh t0 lock token, wins.
      const sessionAResponse = await apiRequest(request, 'PUT', termsPath(groupId), {
        token,
        data: { paymentTermsDays: 30 },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: t0 },
      });
      expect(sessionAResponse.status(), 'session A (fresh t0) PUT should win').toBe(200);
      const sessionABody = await readJsonSafe<{ terms?: { updatedAt?: string; paymentTermsDays?: number } }>(
        sessionAResponse,
      );
      const t1 = sessionABody?.terms?.updatedAt;
      expect(typeof t1, 'terms row should expose an advanced updatedAt after session A').toBe('string');
      expect(t1, 'updatedAt must advance after session A').not.toBe(t0);
      expect(sessionABody?.terms?.paymentTermsDays).toBe(30);

      // Session B: stale t0 lock token, refused.
      const sessionBResponse = await apiRequest(request, 'PUT', termsPath(groupId), {
        token,
        data: { paymentTermsDays: 45 },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: t0 },
      });
      expect(sessionBResponse.status(), 'stale session B PUT should be refused with 409').toBe(409);
      const sessionBBody = await readJsonSafe<Record<string, unknown>>(sessionBResponse);
      expect(sessionBBody).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        expectedUpdatedAt: t0,
      });
      expect(typeof sessionBBody?.currentUpdatedAt, 'conflict body includes currentUpdatedAt as ISO string').toBe(
        'string',
      );
      expect(sessionBBody?.currentUpdatedAt).not.toBe(t0);

      // The row still reflects session A's write; session B's rejected edit
      // never landed.
      const survivorResponse = await apiRequest(request, 'GET', termsPath(groupId), { token });
      expect(survivorResponse.status()).toBe(200);
      const survivorBody = await readJsonSafe<{ terms?: { paymentTermsDays?: number } }>(survivorResponse);
      expect(survivorBody?.terms?.paymentTermsDays, 'the rejected session B write must not have applied').toBe(30);
    } finally {
      await deleteCustomerGroupIfExists(request, token, groupId);
    }
  });
});
