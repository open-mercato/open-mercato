import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { resolveIntegrationDatabaseUrl, withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { expectOperation, skipIfUndoTestsDisabled, undoOk, redoOk } from '@open-mercato/core/helpers/integration/undoHarness';
import {
  createCodeFixture,
  deleteCodeIfExists,
  codeDetailQueryPath,
  CODES_PATH,
  CODES_RESERVE_PATH,
  CODES_USE_PATH,
  uniqueStamp,
} from './helpers';
import { readCodeRow } from './helpers/db';

/**
 * TC-PROM-084: undoing a code update must not reactivate a code that was used up after
 * that update. `codes/use` deactivates a single-use static code once it is spent, outside
 * the action log, so the update stays the latest undoable action for the code.
 *
 * The second test races the undo against a real redemption: a raw Postgres session holds
 * the cart's reservation row lock so `POST /api/promotions/codes/use` is observed holding
 * the code row lock (with `used` already raised) while it waits; the undo is then
 * observed waiting behind that redemption before the reservation lock is released.
 */
test.describe('TC-PROM-084: code update undo keeps a used-up code inactive', () => {
  test('undo and redo of a full-form rename keep the spent code inactive', async ({ request }) => {
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
        data: { id: codeId, name: `${originalName} renamed`, active: true },
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

      await redoOk(request, token, updateOperation.logId, 'redo promotions code update');
      const redoneResponse = await apiRequest(request, 'GET', codeDetailQueryPath(codeId), { token });
      expect(redoneResponse.status()).toBe(200);
      const redoneDetail = await readJsonSafe<{ items?: Array<{ id: string; name: string; active: boolean }> }>(redoneResponse);
      const redoneItem = redoneDetail?.items?.find((entry) => entry.id === codeId);
      expect(redoneItem?.name).toBe(`${originalName} renamed`);
      expect(redoneItem?.active, 'redo must not reactivate a spent code').toBe(false);

      const finalRow = await readCodeRow(codeId);
      expect(finalRow?.used).toBe(1);
      expect(finalRow?.active).toBe(false);
    } finally {
      await deleteCodeIfExists(request, token, codeId);
    }
  });

  test('undo racing a redemption decides the active flag from the committed redemption', async ({ request }) => {
    skipIfUndoTestsDisabled();
    test.setTimeout(90_000);
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const codeString = `QA-PROM-084R-${stamp}`.toUpperCase();
    const cartId = randomUUID();
    let codeId: string | null = null;
    const holder = new Client({ connectionString: resolveIntegrationDatabaseUrl() });
    let holderOpen = false;
    const pendingRequests: Array<Promise<unknown>> = [];

    try {
      const fixture = await createCodeFixture(request, token, {
        name: `QA PROM 084R ${stamp}`,
        type: 'static',
        code: codeString,
        usage: 'single',
        active: true,
      });
      codeId = fixture.id;

      const updateResponse = await apiRequest(request, 'PUT', CODES_PATH, {
        token,
        data: { id: codeId, usage: 'unlimited' },
      });
      expect(updateResponse.status(), 'PUT /api/promotions/codes should succeed').toBe(200);
      const updateOperation = expectOperation(updateResponse, 'promotions code update');

      const reserveResponse = await apiRequest(request, 'POST', CODES_RESERVE_PATH, {
        token,
        data: { codeString, cartId, customerId: null },
      });
      expect(reserveResponse.status(), 'POST /api/promotions/codes/reserve should succeed').toBe(200);

      await holder.connect();
      holderOpen = true;
      const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      await holder.query('begin');
      const lockedReservation = await holder.query(
        'select id from promotion_code_reservations where code_id = $1 and cart_id = $2 for update',
        [codeId, cartId],
      );
      expect(lockedReservation.rowCount, 'the reservation row must exist to be locked').toBe(1);

      const waitingOn = (blockerPid: number) =>
        withClient(async (client) => {
          const result = await client.query<{ pid: number }>(
            `select pid from pg_stat_activity
              where wait_event_type = 'Lock' and $1 = any(pg_blocking_pids(pid))`,
            [blockerPid],
          );
          return result.rows.map((row) => row.pid);
        });

      const usePromise = apiRequest(request, 'POST', CODES_USE_PATH, {
        token,
        data: { codeId, codeString, cartId, customerId: null, type: 'static' },
      });
      pendingRequests.push(usePromise);
      let usePid = 0;
      await expect
        .poll(
          async () => {
            usePid = (await waitingOn(holderPid))[0] ?? 0;
            return usePid;
          },
          { message: 'codes/use must hold the code row lock while it waits on the reservation row', timeout: 20_000 },
        )
        .toBeGreaterThan(0);

      const undoPromise = undoOk(request, token, updateOperation.undoToken, 'promotions code update');
      pendingRequests.push(undoPromise.catch(() => undefined));
      await expect
        .poll(async () => (await waitingOn(usePid)).length, {
          message: 'the undo must wait on the redemption',
          timeout: 20_000,
        })
        .toBeGreaterThan(0);

      await holder.query('commit');
      const useResponse = await usePromise;
      expect(useResponse.status(), 'the redemption should succeed').toBe(200);
      await undoPromise;

      const finalRow = await withClient(async (client) => {
        const result = await client.query<{ used: number; usage: string; active: boolean }>(
          'select used, usage, active from promotion_codes where id = $1',
          [codeId],
        );
        return result.rows[0] ?? null;
      });
      expect(finalRow?.usage, 'undo restores the single-use mode').toBe('single');
      expect(finalRow?.used).toBe(1);
      expect(finalRow?.active, 'a single-use code redeemed during the undo must end inactive').toBe(false);

      const reuseResponse = await apiRequest(request, 'POST', CODES_USE_PATH, {
        token,
        data: { codeId, codeString, cartId: randomUUID(), customerId: null, type: 'static' },
      });
      expect(reuseResponse.status(), 'the spent code must not be usable again').toBe(422);
    } finally {
      if (holderOpen) {
        await holder.query('rollback').catch(() => undefined);
        await holder.end().catch(() => undefined);
      }
      await Promise.allSettled(pendingRequests);
      await deleteCodeIfExists(request, token, codeId);
    }
  });
});
