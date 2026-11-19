import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  cleanupSecondTenantActor,
  createSecondTenantActor,
  createStoreFixture,
  deleteStoreIfExists,
  uniqueStamp,
  type SecondTenantActor,
} from '../../ecommerce/__integration__/helpers';

/**
 * TC-ASSIST-001: assisted selling store settings API.
 * Source: .ai/specs/2026-09-22-assisted-selling.md §10.1 rows `GET /settings/:storeId` and
 * `PUT /settings/:storeId` (step AS1). The "authoring sees it" half of the cross-organization row
 * needs authoring (AS3) and is covered there.
 */
const SETTINGS_PATH = (storeId: string) => `/api/assisted_selling/settings/${storeId}`;
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at';

type SettingsBody = {
  ok?: boolean;
  result?: {
    storeId: string;
    mode: string;
    proposalTtlSeconds: number;
    maxProposalLines: number;
    conversationRetentionDays: number;
    idleCloseDays: number;
    updatedAt: string | null;
  };
};

test.describe('TC-ASSIST-001: assisted selling store settings API', () => {
  test.describe.configure({ timeout: 120_000 });

  test('defaults, validation, save and optimistic locking on one store', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let storeId: string | null = null;
    try {
      storeId = await createStoreFixture(request, token, { stamp });

      const defaults = await apiRequest(request, 'GET', SETTINGS_PATH(storeId), { token });
      expect(defaults.status()).toBe(200);
      expect((await readJsonSafe<SettingsBody>(defaults))?.result).toEqual({
        storeId,
        mode: 'off',
        proposalTtlSeconds: 259200,
        maxProposalLines: 50,
        conversationRetentionDays: 365,
        idleCloseDays: 30,
        updatedAt: null,
      });

      for (const body of [
        { mode: 'ai' },
        { mode: 'both' },
        { aiProposalsRequireRepApproval: true },
        { aiAgentUserId: '66666666-6666-4666-8666-666666666666' },
        { proposalTtlSeconds: 3599 },
        { proposalTtlSeconds: 1209601 },
        { maxProposalLines: 0 },
        { maxProposalLines: 101 },
        { conversationRetentionDays: 0 },
        { conversationRetentionDays: 3651 },
        { idleCloseDays: 0 },
        { idleCloseDays: 366 },
      ]) {
        const refused = await apiRequest(request, 'PUT', SETTINGS_PATH(storeId), { token, data: body });
        expect(refused.status(), `PUT ${JSON.stringify(body)} must be 400`).toBe(400);
      }

      const saved = await apiRequest(request, 'PUT', SETTINGS_PATH(storeId), {
        token,
        data: { mode: 'rep', maxProposalLines: 100, idleCloseDays: 7 },
      });
      expect(saved.status()).toBe(200);
      const savedResult = (await readJsonSafe<SettingsBody>(saved))?.result;
      expect(savedResult).toMatchObject({ mode: 'rep', maxProposalLines: 100, idleCloseDays: 7, proposalTtlSeconds: 259200 });
      expect(savedResult?.updatedAt).toBeTruthy();

      const reloaded = await apiRequest(request, 'GET', SETTINGS_PATH(storeId), { token });
      expect((await readJsonSafe<SettingsBody>(reloaded))?.result).toMatchObject({
        mode: 'rep',
        maxProposalLines: 100,
        idleCloseDays: 7,
        updatedAt: savedResult?.updatedAt,
      });

      const current = await apiRequest(request, 'PUT', SETTINGS_PATH(storeId), {
        token,
        data: { mode: 'off' },
        headers: { [LOCK_HEADER]: savedResult!.updatedAt! },
      });
      expect(current.status()).toBe(200);

      const stale = await apiRequest(request, 'PUT', SETTINGS_PATH(storeId), {
        token,
        data: { mode: 'rep' },
        headers: { [LOCK_HEADER]: savedResult!.updatedAt! },
      });
      expect(stale.status(), 'a stale version must be refused').toBe(409);

      const afterConflict = await apiRequest(request, 'GET', SETTINGS_PATH(storeId), { token });
      expect((await readJsonSafe<SettingsBody>(afterConflict))?.result?.mode).toBe('off');
    } finally {
      await deleteStoreIfExists(request, token, storeId);
    }
  });

  test('unknown stores and another tenant\'s store answer 404', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    let storeId: string | null = null;
    let actor: SecondTenantActor | null = null;
    try {
      const unknown = await apiRequest(request, 'GET', SETTINGS_PATH('77777777-7777-4777-8777-777777777777'), { token });
      expect(unknown.status()).toBe(404);

      const malformed = await apiRequest(request, 'GET', SETTINGS_PATH('not-a-uuid'), { token });
      expect(malformed.status()).toBe(400);

      storeId = await createStoreFixture(request, token, { stamp });
      actor = await createSecondTenantActor(request, superadminToken, stamp, ['assisted_selling.*', 'ecommerce.*']);

      const foreignRead = await apiRequest(request, 'GET', SETTINGS_PATH(storeId), { token: actor.token });
      expect(foreignRead.status(), 'tenant B read of a tenant-A store must 404').toBe(404);

      const foreignWrite = await apiRequest(request, 'PUT', SETTINGS_PATH(storeId), {
        token: actor.token,
        data: { mode: 'rep' },
      });
      expect(foreignWrite.status(), 'tenant B write of a tenant-A store must 404').toBe(404);

      const untouched = await apiRequest(request, 'GET', SETTINGS_PATH(storeId), { token });
      expect((await readJsonSafe<SettingsBody>(untouched))?.result?.updatedAt).toBeNull();
    } finally {
      await cleanupSecondTenantActor(request, superadminToken, actor);
      await deleteStoreIfExists(request, token, storeId);
    }
  });

  test('the seeded employee role cannot read or write settings', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const employeeToken = await getAuthToken(request, 'employee');
    const stamp = uniqueStamp();
    let storeId: string | null = null;
    try {
      storeId = await createStoreFixture(request, adminToken, { stamp });
      const read = await apiRequest(request, 'GET', SETTINGS_PATH(storeId), { token: employeeToken });
      expect(read.status()).toBe(403);
      const write = await apiRequest(request, 'PUT', SETTINGS_PATH(storeId), {
        token: employeeToken,
        data: { mode: 'rep' },
      });
      expect(write.status()).toBe(403);
    } finally {
      await deleteStoreIfExists(request, adminToken, storeId);
    }
  });
});
