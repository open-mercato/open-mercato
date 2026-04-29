import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-043: Undo parity for scheduled interactions
 * Spec: .ai/specs/2026-04-23-crm-post-upgrade-bug-fixes.md Phase 3 (Q3)
 *
 * Verifies that every interactions write path emits the `x-om-operation`
 * response header so the browser operation store can register an undo token.
 *
 * Covers the three mutations behind the "Undo last action" banner:
 *   - POST   /api/customers/interactions          (create, both planned + done)
 *   - POST   /api/customers/interactions/complete (transition planned -> done)
 *   - POST   /api/customers/interactions/cancel   (transition planned -> canceled)
 *
 * All three must return an `x-om-operation` header whose undoToken is accepted
 * by `POST /api/audit_logs/audit-logs/actions/undo`.
 */
test.describe('TC-CRM-043: Interaction write paths emit x-om-operation + support undo', () => {
  test('create, complete, and cancel all expose undo tokens that the undo endpoint accepts', async ({
    request,
  }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    let personEntityId: string | null = null;
    const stamp = Date.now();
    const createdIds: string[] = [];

    function extractUndoMetadata(headers: Record<string, string>): {
      undoToken: string | null;
      commandId: string | null;
      resourceId: string | null;
    } {
      const raw = headers['x-om-operation'] ?? null;
      if (!raw || !raw.startsWith('omop:')) {
        return { undoToken: null, commandId: null, resourceId: null };
      }
      const encoded = raw.slice('omop:'.length);
      try {
        const parsed = JSON.parse(decodeURIComponent(encoded)) as {
          undoToken?: string;
          commandId?: string;
          resourceId?: string;
        };
        return {
          undoToken: typeof parsed.undoToken === 'string' ? parsed.undoToken : null,
          commandId: typeof parsed.commandId === 'string' ? parsed.commandId : null,
          resourceId: typeof parsed.resourceId === 'string' ? parsed.resourceId : null,
        };
      } catch {
        return { undoToken: null, commandId: null, resourceId: null };
      }
    }

    async function performAndVerifyUndo(
      method: 'POST',
      path: string,
      data: Record<string, unknown>,
      expectedCommandId: string,
    ): Promise<string> {
      const res = await apiRequest(request, method, path, { token: token!, data });
      expect(res.ok(), `${path} should succeed (${res.status()})`).toBeTruthy();
      const meta = extractUndoMetadata(res.headers());
      expect(
        meta.undoToken,
        `${path} must emit an undo token via x-om-operation header`,
      ).toBeTruthy();
      expect(meta.commandId).toBe(expectedCommandId);
      const undoRes = await apiRequest(
        request,
        'POST',
        '/api/audit_logs/audit-logs/actions/undo',
        { token: token!, data: { undoToken: meta.undoToken } },
      );
      expect(
        undoRes.ok(),
        `undo endpoint must accept token from ${path} (${undoRes.status()})`,
      ).toBeTruthy();
      return meta.resourceId ?? '';
    }

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-043 Co ${stamp}`);
      personEntityId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TC043-${stamp}`,
        displayName: `QA TC-CRM-043 ${stamp}`,
        companyEntityId: companyId,
      });

      const scheduledAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: personEntityId,
          interactionType: 'meeting',
          title: `QA TC-CRM-043 scheduled ${stamp}`,
          status: 'planned',
          scheduledAt,
        },
      });
      expect(createRes.ok()).toBeTruthy();
      const createMeta = extractUndoMetadata(createRes.headers());
      expect(createMeta.undoToken, 'create must emit undo token').toBeTruthy();
      expect(createMeta.commandId).toBe('customers.interactions.create');
      const interactionId = createMeta.resourceId;
      expect(interactionId, 'create response should include resourceId').toBeTruthy();
      if (interactionId) createdIds.push(interactionId);

      const completeScheduledAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      const completeCreate = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: personEntityId,
          interactionType: 'meeting',
          title: `QA TC-CRM-043 complete-me ${stamp}`,
          status: 'planned',
          scheduledAt: completeScheduledAt,
        },
      });
      const completeTargetId = extractUndoMetadata(completeCreate.headers()).resourceId;
      expect(completeTargetId).toBeTruthy();
      if (completeTargetId) createdIds.push(completeTargetId);

      await performAndVerifyUndo(
        'POST',
        '/api/customers/interactions/complete',
        { id: completeTargetId },
        'customers.interactions.complete',
      );

      const cancelScheduledAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
      const cancelCreate = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: personEntityId,
          interactionType: 'meeting',
          title: `QA TC-CRM-043 cancel-me ${stamp}`,
          status: 'planned',
          scheduledAt: cancelScheduledAt,
        },
      });
      const cancelTargetId = extractUndoMetadata(cancelCreate.headers()).resourceId;
      expect(cancelTargetId).toBeTruthy();
      if (cancelTargetId) createdIds.push(cancelTargetId);

      await performAndVerifyUndo(
        'POST',
        '/api/customers/interactions/cancel',
        { id: cancelTargetId },
        'customers.interactions.cancel',
      );
    } finally {
      for (const id of createdIds) {
        await deleteEntityIfExists(request, token, '/api/customers/interactions', id);
      }
      await deleteEntityIfExists(request, token, '/api/customers/people', personEntityId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
