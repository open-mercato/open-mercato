import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness';
import {
  createCodeFixture,
  deleteCodeIfExists,
  codeDetailQueryPath,
  CODES_PATH,
  CODES_USE_PATH,
  uniqueStamp,
} from './helpers';
import { readCodeRow } from './helpers/db';

/**
 * TC-PROM-084: undoing a code update must not reactivate a code that was used up after
 * that update. `codes/use` deactivates a single-use static code once it is spent, outside
 * the action log, so the update stays the latest undoable action for the code.
 */
test.describe('TC-PROM-084: code update undo keeps a used-up code inactive', () => {
  test('undo of a rename after the code was spent restores the name but leaves the code inactive', async ({ request }) => {
    skipIfUndoTestsDisabled();
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const originalName = `QA PROM 084 ${stamp}`;
    const codeString = `QA-PROM-084-${stamp}`.toUpperCase();
    let codeId: string | null = null;

    try {
      const fixture = await createCodeFixture(request, token, {
        name: originalName,
        type: 'static',
        code: codeString,
        usage: 'single',
        active: true,
      });
      codeId = fixture.id;

      const updateResponse = await apiRequest(request, 'PUT', CODES_PATH, {
        token,
        data: { id: codeId, name: `${originalName} renamed` },
      });
      expect(updateResponse.status(), 'PUT /api/promotions/codes should succeed').toBe(200);
      const updateOperation = expectOperation(updateResponse, 'promotions code update');

      const useResponse = await apiRequest(request, 'POST', CODES_USE_PATH, {
        token,
        data: { codeId, codeString, cartId: randomUUID(), customerId: null, type: 'static' },
      });
      expect(useResponse.status(), 'POST /api/promotions/codes/use should succeed').toBe(200);
      const spentRow = await readCodeRow(codeId);
      expect(spentRow?.used).toBe(1);
      expect(spentRow?.active).toBe(false);

      await undoOk(request, token, updateOperation.undoToken, 'promotions code update');

      const detailResponse = await apiRequest(request, 'GET', codeDetailQueryPath(codeId), { token });
      expect(detailResponse.status()).toBe(200);
      const detail = await readJsonSafe<{ items?: Array<{ id: string; name: string; active: boolean }> }>(detailResponse);
      const item = detail?.items?.find((entry) => entry.id === codeId);
      expect(item?.name).toBe(originalName);
      expect(item?.active, 'a used-up single-use code must stay inactive after the undo').toBe(false);

      const finalRow = await readCodeRow(codeId);
      expect(finalRow?.used).toBe(1);
      expect(finalRow?.active).toBe(false);
    } finally {
      await deleteCodeIfExists(request, token, codeId);
    }
  });
});
