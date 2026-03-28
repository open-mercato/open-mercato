import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

type JsonRecord = Record<string, unknown>;

/**
 * TC-CRM-026: Canonical Interactions API — CRUD, Lifecycle, Pagination & Projection
 *
 * Verifies the canonical /api/customers/interactions endpoints:
 * - Create, list, update, complete, cancel, delete
 * - Cursor-based pagination
 * - Status and type filtering
 * - Next-interaction projection recomputation on the parent entity
 */
test.describe('TC-CRM-026: Canonical Interactions API', () => {
  test('should perform full CRUD lifecycle on interactions', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let interactionId: string | null = null;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA CRM026 Co ${Date.now()}`);

      // --- CREATE ---
      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'call',
          title: 'CRM-026 follow-up call',
          scheduledAt: '2026-06-01T10:00:00Z',
        },
      });
      expect(createRes.status()).toBe(201);
      const created = await readJsonSafe<JsonRecord>(createRes);
      interactionId = typeof created?.id === 'string' ? created.id : null;
      expect(interactionId).toBeTruthy();

      // --- LIST ---
      const listRes = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${companyId}&limit=10`, { token });
      expect(listRes.ok()).toBeTruthy();
      const listBody = await readJsonSafe<JsonRecord>(listRes);
      const items = Array.isArray(listBody?.items) ? (listBody!.items as JsonRecord[]) : [];
      const found = items.find((i) => i.id === interactionId);
      expect(found).toBeTruthy();
      expect(found?.title).toBe('CRM-026 follow-up call');
      expect(found?.interactionType).toBe('call');
      expect(found?.status).toBe('planned');

      // --- UPDATE ---
      const updateRes = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token,
        data: { id: interactionId, title: 'CRM-026 updated title' },
      });
      expect(updateRes.ok()).toBeTruthy();

      const listAfterUpdate = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${companyId}&limit=10`, { token });
      const updatedItems = ((await readJsonSafe<JsonRecord>(listAfterUpdate))?.items as JsonRecord[]) ?? [];
      const updatedRow = updatedItems.find((i) => i.id === interactionId);
      expect(updatedRow?.title).toBe('CRM-026 updated title');

      // --- COMPLETE ---
      const completeRes = await apiRequest(request, 'POST', '/api/customers/interactions/complete', {
        token,
        data: { id: interactionId },
      });
      expect(completeRes.ok()).toBeTruthy();

      const listAfterComplete = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${companyId}&limit=10`, { token });
      const completedItems = ((await readJsonSafe<JsonRecord>(listAfterComplete))?.items as JsonRecord[]) ?? [];
      const completedRow = completedItems.find((i) => i.id === interactionId);
      expect(completedRow?.status).toBe('done');

      // --- DELETE ---
      const deleteRes = await apiRequest(request, 'DELETE', `/api/customers/interactions?id=${interactionId}`, { token });
      expect(deleteRes.ok()).toBeTruthy();
      interactionId = null;

      const listAfterDelete = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${companyId}&limit=10`, { token });
      const deletedItems = ((await readJsonSafe<JsonRecord>(listAfterDelete))?.items as JsonRecord[]) ?? [];
      expect(deletedItems.some((i) => i.id === interactionId)).toBeFalsy();
    } finally {
      if (interactionId) {
        await apiRequest(request, 'DELETE', `/api/customers/interactions?id=${interactionId}`, { token: token! });
      }
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('should cancel an interaction', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let interactionId: string | null = null;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA CRM026 Cancel ${Date.now()}`);

      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: { entityId: companyId, interactionType: 'meeting', title: 'CRM-026 cancel test', scheduledAt: '2026-07-01T14:00:00Z' },
      });
      expect(createRes.status()).toBe(201);
      const created = await readJsonSafe<JsonRecord>(createRes);
      interactionId = typeof created?.id === 'string' ? created.id : null;

      const cancelRes = await apiRequest(request, 'POST', '/api/customers/interactions/cancel', {
        token,
        data: { id: interactionId },
      });
      expect(cancelRes.ok()).toBeTruthy();

      const listRes = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${companyId}&limit=10`, { token });
      const items = ((await readJsonSafe<JsonRecord>(listRes))?.items as JsonRecord[]) ?? [];
      const row = items.find((i) => i.id === interactionId);
      expect(row?.status).toBe('canceled');
    } finally {
      if (interactionId) {
        await apiRequest(request, 'DELETE', `/api/customers/interactions?id=${interactionId}`, { token: token! }).catch(() => {});
      }
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('should support cursor pagination', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    const interactionIds: string[] = [];

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA CRM026 Pag ${Date.now()}`);

      // Create 3 interactions
      for (let i = 0; i < 3; i++) {
        const res = await apiRequest(request, 'POST', '/api/customers/interactions', {
          token,
          data: {
            entityId: companyId,
            interactionType: 'call',
            title: `CRM-026 pag ${i}`,
            scheduledAt: `2026-0${6 + i}-01T10:00:00Z`,
          },
        });
        const body = await readJsonSafe<JsonRecord>(res);
        if (typeof body?.id === 'string') interactionIds.push(body.id);
      }
      expect(interactionIds.length).toBe(3);

      // Page 1: limit=2
      const page1Res = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${companyId}&limit=2`, { token });
      expect(page1Res.ok()).toBeTruthy();
      const page1 = await readJsonSafe<JsonRecord>(page1Res);
      const page1Items = Array.isArray(page1?.items) ? (page1!.items as JsonRecord[]) : [];
      expect(page1Items.length).toBe(2);
      expect(typeof page1?.nextCursor).toBe('string');

      // Page 2: use cursor
      const page2Res = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${companyId}&limit=2&cursor=${page1!.nextCursor}`, { token });
      expect(page2Res.ok()).toBeTruthy();
      const page2 = await readJsonSafe<JsonRecord>(page2Res);
      const page2Items = Array.isArray(page2?.items) ? (page2!.items as JsonRecord[]) : [];
      expect(page2Items.length).toBe(1);

      // Verify no duplicates
      const allIds = [...page1Items.map((i) => i.id), ...page2Items.map((i) => i.id)];
      expect(new Set(allIds).size).toBe(allIds.length);
    } finally {
      for (const id of interactionIds) {
        await apiRequest(request, 'DELETE', `/api/customers/interactions?id=${id}`, { token: token! }).catch(() => {});
      }
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('should filter by status and interactionType', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    const interactionIds: string[] = [];

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA CRM026 Filter ${Date.now()}`);

      // Create a call (planned) and a meeting (planned, then complete it)
      const callRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: { entityId: companyId, interactionType: 'call', title: 'CRM-026 filter call', scheduledAt: '2026-08-01T10:00:00Z' },
      });
      const call = await readJsonSafe<JsonRecord>(callRes);
      if (typeof call?.id === 'string') interactionIds.push(call.id);

      const meetingRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: { entityId: companyId, interactionType: 'meeting', title: 'CRM-026 filter meeting', scheduledAt: '2026-09-01T14:00:00Z' },
      });
      const meeting = await readJsonSafe<JsonRecord>(meetingRes);
      if (typeof meeting?.id === 'string') interactionIds.push(meeting.id);

      // Complete the meeting
      await apiRequest(request, 'POST', '/api/customers/interactions/complete', {
        token,
        data: { id: meeting?.id },
      });

      // Filter by status=planned
      const plannedRes = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${companyId}&status=planned`, { token });
      const plannedItems = ((await readJsonSafe<JsonRecord>(plannedRes))?.items as JsonRecord[]) ?? [];
      expect(plannedItems.every((i) => i.status === 'planned')).toBeTruthy();
      expect(plannedItems.some((i) => i.id === call?.id)).toBeTruthy();
      expect(plannedItems.some((i) => i.id === meeting?.id)).toBeFalsy();

      // Filter by interactionType=call
      const callsRes = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${companyId}&interactionType=call`, { token });
      const callItems = ((await readJsonSafe<JsonRecord>(callsRes))?.items as JsonRecord[]) ?? [];
      expect(callItems.every((i) => i.interactionType === 'call')).toBeTruthy();
    } finally {
      for (const id of interactionIds) {
        await apiRequest(request, 'DELETE', `/api/customers/interactions?id=${id}`, { token: token! }).catch(() => {});
      }
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('should recompute next-interaction projection on the parent entity', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    const interactionIds: string[] = [];

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA CRM026 Proj ${Date.now()}`);

      // Create two planned interactions: Apr 1 and May 1
      const aprRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: { entityId: companyId, interactionType: 'call', title: 'April call', scheduledAt: '2026-04-01T10:00:00Z' },
      });
      const apr = await readJsonSafe<JsonRecord>(aprRes);
      if (typeof apr?.id === 'string') interactionIds.push(apr.id);

      const mayRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: { entityId: companyId, interactionType: 'meeting', title: 'May meeting', scheduledAt: '2026-05-01T14:00:00Z' },
      });
      const may = await readJsonSafe<JsonRecord>(mayRes);
      if (typeof may?.id === 'string') interactionIds.push(may.id);

      // Check projection: earliest planned = Apr 1
      const detail1 = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}?include=interactions`, { token });
      const detail1Body = await readJsonSafe<JsonRecord>(detail1);
      const company1 = detail1Body?.company as JsonRecord | undefined;
      expect(company1?.nextInteractionAt).toBeTruthy();
      expect(String(company1?.nextInteractionAt)).toContain('2026-04-01');
      expect(company1?.nextInteractionName).toBe('April call');

      // Complete the April interaction
      await apiRequest(request, 'POST', '/api/customers/interactions/complete', {
        token,
        data: { id: apr?.id },
      });

      // Projection should switch to May
      const detail2 = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}?include=interactions`, { token });
      const detail2Body = await readJsonSafe<JsonRecord>(detail2);
      const company2 = detail2Body?.company as JsonRecord | undefined;
      expect(String(company2?.nextInteractionAt)).toContain('2026-05-01');
      expect(company2?.nextInteractionName).toBe('May meeting');

      // Cancel the May interaction
      await apiRequest(request, 'POST', '/api/customers/interactions/cancel', {
        token,
        data: { id: may?.id },
      });

      // Projection should clear (no planned interactions left)
      const detail3 = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}?include=interactions`, { token });
      const detail3Body = await readJsonSafe<JsonRecord>(detail3);
      const company3 = detail3Body?.company as JsonRecord | undefined;
      expect(company3?.nextInteractionAt).toBeNull();
      expect(company3?.nextInteractionName).toBeNull();
    } finally {
      for (const id of interactionIds) {
        await apiRequest(request, 'DELETE', `/api/customers/interactions?id=${id}`, { token: token! }).catch(() => {});
      }
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
